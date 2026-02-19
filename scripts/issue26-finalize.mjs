#!/usr/bin/env node

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve, dirname } from "node:path";
import { spawn } from "node:child_process";

function readArg(name, fallback = "") {
  const flag = `--${name}`;
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && idx + 1 < process.argv.length) {
    return process.argv[idx + 1];
  }
  return fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
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

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function run() {
  const reportDirArg = readArg("report-dir");
  if (!reportDirArg) {
    console.error("Missing required argument: --report-dir <artifacts-directory>");
    process.exit(1);
  }

  const reportDir = resolve(reportDirArg);
  const issueNumber = readArg("issue", "26");
  const epicNumber = readArg("epic", "7");
  const repo = readArg("repo", "kejun/eywa-chat");
  const outPath = resolve(readArg("out", `${reportDir}/ISSUE-26-FINAL-STEPS.md`));

  await runNodeScript("./scripts/prepare-issue26-closure.mjs", ["--report-dir", reportDir]);

  const closurePath = `${reportDir}/ISSUE-26-CLOSURE.md`;
  const commentPath = `${reportDir}/ISSUE-26-COMMENT.md`;
  const commandsPath = `${reportDir}/ISSUE-26-CLOSE-COMMANDS.sh`;
  const overviewPath = `${reportDir}/OVERVIEW.md`;

  const required = [closurePath, commentPath, commandsPath, overviewPath];
  const missing = [];
  for (const file of required) {
    // eslint-disable-next-line no-await-in-loop
    if (!(await exists(file))) {
      missing.push(file);
    }
  }

  if (missing.length > 0) {
    console.error("Missing required artifacts:");
    for (const file of missing) {
      console.error(`- ${file}`);
    }
    process.exit(1);
  }

  const closureText = await readFile(closurePath, "utf8");
  const isPass = closureText.includes("Overall Result: **PASS**");

  const commentCommand = `gh issue comment ${issueNumber} --repo ${repo} --body-file "${commentPath}"`;
  const closeIssueCommand = `gh issue close ${issueNumber} --repo ${repo}`;
  const closeEpicCommand = `gh issue close ${epicNumber} --repo ${repo}`;

  const markdown = `# Issue #${issueNumber} Final Closure Steps

- Generated At: ${new Date().toISOString()}
- Report Dir: \`${reportDir}\`
- Closure Status: **${isPass ? "PASS" : "FAIL"}**

## Step 1: Post loadtest result comment

\`\`\`bash
${commentCommand}
\`\`\`

## Step 2: Close issue #${issueNumber}

${
  isPass
    ? "Thresholds are satisfied; close the issue after posting the comment."
    : "Do NOT close yet. Re-run loadtests after fixes."
}

\`\`\`bash
${closeIssueCommand}
\`\`\`

## Step 3: Close Epic #${epicNumber}

Only after issue #${issueNumber} is closed successfully:

\`\`\`bash
${closeEpicCommand}
\`\`\`

## References

- Overview: \`${overviewPath}\`
- Closure draft: \`${closurePath}\`
- Comment template: \`${commentPath}\`
- Close commands: \`${commandsPath}\`
`;

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, markdown, "utf8");

  console.log(`Final closure steps written to: ${outPath}`);
  console.log(`\n${isPass ? "PASS detected" : "FAIL detected"} for issue #${issueNumber}.`);
  console.log(`Next command:\n${commentCommand}`);

  if (hasFlag("strict-pass") && !isPass) {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
