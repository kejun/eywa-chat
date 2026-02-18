#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const PRESET_SCENARIOS = {
  smoke: {
    requests: 20,
    concurrency: 2,
    timeoutMs: 30_000,
    thresholds: {
      minSuccessRate: 1,
      maxP95TotalMs: 8_000,
      maxP95FirstTokenMs: 2_500,
    },
  },
  baseline: {
    requests: 100,
    concurrency: 10,
    timeoutMs: 35_000,
    thresholds: {
      minSuccessRate: 0.99,
      maxP95TotalMs: 6_000,
      maxP95FirstTokenMs: 2_000,
    },
  },
  stress: {
    requests: 300,
    concurrency: 30,
    timeoutMs: 45_000,
    thresholds: {
      minSuccessRate: 0.95,
      maxP95TotalMs: 10_000,
      maxP95FirstTokenMs: 3_500,
    },
  },
};

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function readArg(name, fallback = "") {
  const flag = `--${name}`;
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && idx + 1 < process.argv.length) {
    return process.argv[idx + 1];
  }
  return fallback;
}

function readProfiles() {
  const raw = readArg("profiles", "smoke,baseline,stress");
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function runNodeScript(scriptPath, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      stdio: "inherit",
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise();
      } else {
        rejectPromise(new Error(`${scriptPath} exited with code ${code}`));
      }
    });

    child.on("error", rejectPromise);
  });
}

function formatMs(value) {
  if (typeof value !== "number") {
    return "N/A";
  }
  return `${value.toFixed(1)}ms`;
}

function formatRate(value) {
  if (typeof value !== "number") {
    return "N/A";
  }
  return `${(value * 100).toFixed(2)}%`;
}

function printUsage() {
  console.log(`Usage:
  node scripts/loadtest-scenarios.mjs \\
    --url "https://<preview-domain>/api/chat" \\
    --tenant-id "t-loadtest" \\
    --user-id "u-loadtest" \\
    [--secret "<AUTH_JWT_SECRET>"] \\
    [--profiles "smoke,baseline,stress"] \\
    [--report-dir "./artifacts/loadtest-scenarios"]

Options:
  --url             Chat API URL (default: http://localhost:3000/api/chat)
  --tenant-id       Tenant for generated JWT (default: t-loadtest)
  --user-id         User for generated JWT (default: u-loadtest)
  --secret          JWT secret override (optional)
  --profiles        Comma list of scenario names (smoke,baseline,stress)
  --message         Override test message
  --report-dir      Output directory
  --thread-prefix   Prefix for generated thread id
  --help            Show this help
`);
}

function evaluateScenario(summary, thresholds) {
  const successRate = summary?.totals?.successRate;
  const p95Total = summary?.latency?.total?.p95;
  const p95FirstToken = summary?.latency?.firstToken?.p95;

  const checks = {
    successRate: typeof successRate === "number" && successRate >= thresholds.minSuccessRate,
    p95Total: typeof p95Total === "number" && p95Total <= thresholds.maxP95TotalMs,
    p95FirstToken:
      typeof p95FirstToken === "number" && p95FirstToken <= thresholds.maxP95FirstTokenMs,
  };

  return {
    pass: checks.successRate && checks.p95Total && checks.p95FirstToken,
    checks,
    successRate,
    p95Total,
    p95FirstToken,
  };
}

async function run() {
  if (hasFlag("help")) {
    printUsage();
    return;
  }

  const url = readArg("url", "http://localhost:3000/api/chat");
  const tenantId = readArg("tenant-id", "t-loadtest");
  const userId = readArg("user-id", "u-loadtest");
  const secret = readArg("secret", "");
  const message = readArg("message", "");
  const threadPrefix = readArg("thread-prefix", "scenario");
  const profiles = readProfiles();

  const invalidProfiles = profiles.filter((profile) => !PRESET_SCENARIOS[profile]);
  if (invalidProfiles.length > 0) {
    throw new Error(`Unknown profiles: ${invalidProfiles.join(", ")}`);
  }

  const reportDir = resolve(
    readArg("report-dir", `./artifacts/loadtest-scenarios-${Date.now()}`),
  );
  await mkdir(reportDir, { recursive: true });

  const scenarioResults = [];

  for (const profile of profiles) {
    const preset = PRESET_SCENARIOS[profile];
    const summaryPath = `${reportDir}/${profile}-summary.json`;
    const reportPath = `${reportDir}/${profile}-report.md`;
    const args = [
      "--url",
      url,
      "--requests",
      String(preset.requests),
      "--concurrency",
      String(preset.concurrency),
      "--timeout-ms",
      String(preset.timeoutMs),
      "--tenant-id",
      tenantId,
      "--user-id",
      userId,
      "--thread-prefix",
      `${threadPrefix}-${profile}`,
      "--summary-out",
      summaryPath,
      "--report-out",
      reportPath,
      "--report-title",
      `Chat API Loadtest - ${profile}`,
    ];

    if (secret) {
      args.push("--secret", secret);
    }
    if (message) {
      args.push("--message", message);
    }

    console.log(`\n=== Running scenario: ${profile} ===`);

    try {
      await runNodeScript("./scripts/loadtest-chat-report-with-jwt.mjs", args);
      const summaryRaw = await readFile(summaryPath, "utf8");
      const summary = JSON.parse(summaryRaw);
      const evaluated = evaluateScenario(summary, preset.thresholds);
      scenarioResults.push({
        profile,
        summaryPath,
        reportPath,
        thresholds: preset.thresholds,
        ...evaluated,
      });
    } catch (error) {
      scenarioResults.push({
        profile,
        summaryPath,
        reportPath,
        thresholds: preset.thresholds,
        pass: false,
        checks: {
          successRate: false,
          p95Total: false,
          p95FirstToken: false,
        },
        successRate: null,
        p95Total: null,
        p95FirstToken: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const overviewPath = `${reportDir}/OVERVIEW.md`;
  const tableRows = scenarioResults
    .map((item) => {
      return `| ${item.profile} | ${item.pass ? "PASS" : "FAIL"} | ${formatRate(
        item.successRate,
      )} | ${formatMs(item.p95Total)} | ${formatMs(item.p95FirstToken)} | \`${item.summaryPath}\` | \`${item.reportPath}\` |`;
    })
    .join("\n");

  const thresholdRows = scenarioResults
    .map((item) => {
      return `| ${item.profile} | >= ${(item.thresholds.minSuccessRate * 100).toFixed(
        1,
      )}% | <= ${item.thresholds.maxP95TotalMs}ms | <= ${
        item.thresholds.maxP95FirstTokenMs
      }ms |`;
    })
    .join("\n");

  const failures = scenarioResults.filter((item) => !item.pass);
  const failureSection =
    failures.length === 0
      ? "无。"
      : failures
          .map((item) => `- ${item.profile}: ${item.error ?? "SLO threshold not met"}`)
          .join("\n");

  const overview = `# Loadtest Scenario Overview

- URL: ${url}
- Tenant/User: ${tenantId}/${userId}
- Profiles: ${profiles.join(", ")}
- Generated At: ${new Date().toISOString()}

## Thresholds

| Scenario | Success Rate | P95 Total | P95 First Token |
|---|---:|---:|---:|
${thresholdRows}

## Results

| Scenario | Status | Success Rate | P95 Total | P95 First Token | Summary | Report |
|---|---|---:|---:|---:|---|---|
${tableRows}

## Failures

${failureSection}
`;

  await writeFile(overviewPath, overview, "utf8");

  console.log(`\nOverview report: ${overviewPath}`);
  if (failures.length > 0) {
    console.error("One or more scenarios failed SLO checks.");
    process.exit(1);
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
