#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const SCENARIOS = ["smoke", "baseline", "stress"];

const THRESHOLDS = {
  smoke: {
    minSuccessRate: 1,
    maxP95TotalMs: 8_000,
    maxP95FirstTokenMs: 2_500,
  },
  baseline: {
    minSuccessRate: 0.99,
    maxP95TotalMs: 6_000,
    maxP95FirstTokenMs: 2_000,
  },
  stress: {
    minSuccessRate: 0.95,
    maxP95TotalMs: 10_000,
    maxP95FirstTokenMs: 3_500,
  },
};

function readArg(name, fallback = "") {
  const flag = `--${name}`;
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && idx + 1 < process.argv.length) {
    return process.argv[idx + 1];
  }
  return fallback;
}

function formatMs(value) {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(1)}ms` : "N/A";
}

function formatRate(value) {
  return typeof value === "number" && Number.isFinite(value)
    ? `${(value * 100).toFixed(2)}%`
    : "N/A";
}

async function readJson(path) {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw);
}

function evaluateScenario(summary, threshold) {
  const successRate = summary?.totals?.successRate;
  const p95Total = summary?.latency?.total?.p95;
  const p95FirstToken = summary?.latency?.firstToken?.p95;

  const checks = {
    successRate: typeof successRate === "number" && successRate >= threshold.minSuccessRate,
    p95Total: typeof p95Total === "number" && p95Total <= threshold.maxP95TotalMs,
    p95FirstToken:
      typeof p95FirstToken === "number" && p95FirstToken <= threshold.maxP95FirstTokenMs,
  };

  return {
    pass: checks.successRate && checks.p95Total && checks.p95FirstToken,
    checks,
    successRate,
    p95Total,
    p95FirstToken,
    totalRequests: summary?.totals?.requests,
    successRequests: summary?.totals?.success,
    failedRequests: summary?.totals?.failed,
    throughputRps: summary?.totals?.throughputRps,
    url: summary?.config?.url ?? "N/A",
  };
}

function buildResultTable(rows) {
  const header =
    "| Scenario | Status | Success Rate | P95 Total | P95 First Token | Requests | Success | Failed | Throughput |\n|---|---|---:|---:|---:|---:|---:|---:|---:|";

  const body = rows
    .map((item) => {
      if (item.missing) {
        return `| ${item.scenario} | MISSING | N/A | N/A | N/A | N/A | N/A | N/A | N/A |`;
      }
      return `| ${item.scenario} | ${item.pass ? "PASS" : "FAIL"} | ${formatRate(
        item.successRate,
      )} | ${formatMs(item.p95Total)} | ${formatMs(item.p95FirstToken)} | ${
        item.totalRequests ?? "N/A"
      } | ${item.successRequests ?? "N/A"} | ${item.failedRequests ?? "N/A"} | ${
        typeof item.throughputRps === "number" ? item.throughputRps.toFixed(2) : "N/A"
      } |`;
    })
    .join("\n");

  return `${header}\n${body}`;
}

function buildThresholdTable() {
  const header =
    "| Scenario | Success Rate | P95 Total | P95 First Token |\n|---|---:|---:|---:|";
  const body = SCENARIOS.map((scenario) => {
    const threshold = THRESHOLDS[scenario];
    return `| ${scenario} | >= ${(threshold.minSuccessRate * 100).toFixed(2)}% | <= ${
      threshold.maxP95TotalMs
    }ms | <= ${threshold.maxP95FirstTokenMs}ms |`;
  }).join("\n");
  return `${header}\n${body}`;
}

async function run() {
  const reportDir = readArg("report-dir");
  if (!reportDir) {
    console.error("Missing required argument: --report-dir <artifacts-directory>");
    process.exit(1);
  }

  const absoluteDir = resolve(reportDir);
  const outPath = resolve(readArg("out", `${absoluteDir}/ISSUE-26-CLOSURE.md`));
  const commentOutPath = resolve(readArg("comment-out", `${absoluteDir}/ISSUE-26-COMMENT.md`));
  const commandsOutPath = resolve(
    readArg("commands-out", `${absoluteDir}/ISSUE-26-CLOSE-COMMANDS.sh`),
  );
  const scenarioRows = [];
  const missingArtifacts = [];

  for (const scenario of SCENARIOS) {
    const summaryPath = `${absoluteDir}/${scenario}-summary.json`;
    const reportPath = `${absoluteDir}/${scenario}-report.md`;

    try {
      const summary = await readJson(summaryPath);
      const evaluated = evaluateScenario(summary, THRESHOLDS[scenario]);
      scenarioRows.push({
        scenario,
        summaryPath,
        reportPath,
        ...evaluated,
      });
    } catch {
      scenarioRows.push({
        scenario,
        summaryPath,
        reportPath,
        missing: true,
      });
      missingArtifacts.push(summaryPath);
    }
  }

  const allPresent = missingArtifacts.length === 0;
  const allPass = allPresent && scenarioRows.every((row) => row.pass === true);
  const generatedAt = new Date().toISOString();
  const firstUrl = scenarioRows.find((row) => row.url)?.url ?? "N/A";

  const artifactsList = scenarioRows
    .map((row) => `- ${row.scenario}: \`${row.summaryPath}\` / \`${row.reportPath}\``)
    .join("\n");

  const failureReasons = scenarioRows
    .filter((row) => row.missing || row.pass === false)
    .map((row) => {
      if (row.missing) {
        return `- ${row.scenario}: missing summary artifact`;
      }
      return `- ${row.scenario}: threshold failed (successRate=${formatRate(
        row.successRate,
      )}, p95Total=${formatMs(row.p95Total)}, p95FirstToken=${formatMs(row.p95FirstToken)})`;
    })
    .join("\n");

  const markdown = `# Issue #26 Closure Draft

- Generated At: ${generatedAt}
- Report Directory: \`${absoluteDir}\`
- Target URL: ${firstUrl}
- Overall Result: **${allPass ? "PASS" : "FAIL"}**

## Thresholds

${buildThresholdTable()}

## Scenario Results

${buildResultTable(scenarioRows)}

## Artifacts

${artifactsList}

## Notes

${
  allPass
    ? "All scenario thresholds are met. #26 can be closed, and Epic #7 can be closed afterward."
    : `Not ready for closure.\n${failureReasons || "- unknown failure"}`
}

## Suggested Issue Comment

\`\`\`md
Loadtest execution finished.

Overall: **${allPass ? "PASS" : "FAIL"}**
Target: ${firstUrl}
Generated: ${generatedAt}

${buildResultTable(scenarioRows)}

Artifacts:
${artifactsList}
${allPass ? "\nReady to close #26." : "\nKeep #26 open until thresholds are met."}
\`\`\`

## Suggested Commands

\`\`\`bash
${
  allPass
    ? "gh issue close 26\n# then close Epic E\ngh issue close 7"
    : "# Do not close #26 yet\n# rerun loadtest after fixes"
}
\`\`\`
`;

  const issueComment = `Loadtest execution finished.

Overall: **${allPass ? "PASS" : "FAIL"}**
Target: ${firstUrl}
Generated: ${generatedAt}

${buildResultTable(scenarioRows)}

Artifacts:
${artifactsList}
${allPass ? "\nReady to close #26." : "\nKeep #26 open until thresholds are met."}
`;

  const closeCommands = `#!/usr/bin/env bash
set -euo pipefail

${
  allPass
    ? "# Close issue #26 and Epic #7\n" +
      "gh issue close 26\n" +
      "gh issue close 7\n"
    : "# Not ready to close #26. Re-run loadtests after fixes.\n" +
      "echo \"Not ready: thresholds not met.\" && exit 1\n"
}
`;

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, markdown, "utf8");
  await writeFile(commentOutPath, issueComment, "utf8");
  await writeFile(commandsOutPath, closeCommands, "utf8");

  console.log(`Issue #26 closure draft written to: ${outPath}`);
  console.log(`Issue #26 comment template written to: ${commentOutPath}`);
  console.log(`Issue #26 close commands written to: ${commandsOutPath}`);
  if (!allPass) {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
