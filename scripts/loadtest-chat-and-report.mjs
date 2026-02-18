#!/usr/bin/env node

import { spawn } from "node:child_process";

function readArg(name, fallback = "") {
  const flag = `--${name}`;
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && idx + 1 < process.argv.length) {
    return process.argv[idx + 1];
  }
  return fallback;
}

function removeArg(args, name) {
  const flag = `--${name}`;
  const idx = args.indexOf(flag);
  if (idx >= 0) {
    const next = idx + 1;
    if (next < args.length) {
      args.splice(idx, 2);
    } else {
      args.splice(idx, 1);
    }
  }
}

function runNodeScript(scriptPath, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      stdio: "inherit",
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${scriptPath} exited with code ${code}`));
      }
    });

    child.on("error", reject);
  });
}

async function run() {
  const timestamp = Date.now();
  const summaryOut = readArg("summary-out", `./artifacts/loadtest-summary-${timestamp}.json`);
  const reportOut = readArg("report-out", `./artifacts/loadtest-report-${timestamp}.md`);
  const reportTitle = readArg("report-title", "Chat API 压测简报");

  const passthroughArgs = process.argv.slice(2);
  removeArg(passthroughArgs, "summary-out");
  removeArg(passthroughArgs, "report-out");
  removeArg(passthroughArgs, "report-title");
  removeArg(passthroughArgs, "output");

  await runNodeScript("./scripts/loadtest-chat.mjs", [
    ...passthroughArgs,
    "--output",
    summaryOut,
  ]);

  await runNodeScript("./scripts/render-loadtest-report.mjs", [
    "--summary",
    summaryOut,
    "--out",
    reportOut,
    "--title",
    reportTitle,
  ]);

  console.log(`\nArtifacts:\n- summary: ${summaryOut}\n- report: ${reportOut}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
