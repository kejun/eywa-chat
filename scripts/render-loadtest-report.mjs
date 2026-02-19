#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

function readArg(name, fallback = "") {
  const flag = `--${name}`;
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && idx + 1 < process.argv.length) {
    return process.argv[idx + 1];
  }
  return fallback;
}

function formatMs(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "N/A";
  }
  return `${value.toFixed(1)} ms`;
}

function formatPercent(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "N/A";
  }
  return `${(value * 100).toFixed(2)}%`;
}

async function run() {
  const summaryPath = readArg("summary");
  if (!summaryPath) {
    console.error("Missing required argument: --summary <path-to-summary.json>");
    process.exit(1);
  }

  const outPath = readArg("out", `./artifacts/loadtest-report-${Date.now()}.md`);
  const title = readArg("title", "Chat API 压测简报");

  const raw = await readFile(summaryPath, "utf8");
  const summary = JSON.parse(raw);

  const now = new Date().toISOString();
  const failures = Array.isArray(summary.failures) ? summary.failures : [];
  const failurePreview = failures
    .slice(0, 10)
    .map((item) => `- #${item.id} status=${item.status} error=${item.error ?? "unknown"}`)
    .join("\n");

  const markdown = `# ${title}

- 生成时间: ${now}
- 来源文件: \`${summaryPath}\`

## 测试配置

- URL: ${summary.config?.url ?? "N/A"}
- 请求数: ${summary.config?.requests ?? "N/A"}
- 并发: ${summary.config?.concurrency ?? "N/A"}
- 超时: ${summary.config?.timeoutMs ?? "N/A"} ms
- 鉴权模式: ${summary.config?.authMode ?? "N/A"}

## 总览

| 指标 | 值 |
|---|---|
| Success | ${summary.totals?.success ?? "N/A"} |
| Failed | ${summary.totals?.failed ?? "N/A"} |
| Success Rate | ${formatPercent(summary.totals?.successRate)} |
| Throughput (RPS) | ${
    typeof summary.totals?.throughputRps === "number"
      ? summary.totals.throughputRps.toFixed(2)
      : "N/A"
  } |
| Total Duration | ${formatMs(summary.totals?.durationMs)} |

## 延迟

### 总时延
- P50: ${formatMs(summary.latency?.total?.p50)}
- P95: ${formatMs(summary.latency?.total?.p95)}
- Max: ${formatMs(summary.latency?.total?.max)}

### 首 Token 延迟
- P50: ${formatMs(summary.latency?.firstToken?.p50)}
- P95: ${formatMs(summary.latency?.firstToken?.p95)}
- Max: ${formatMs(summary.latency?.firstToken?.max)}

## 失败样本（前 10 条）

${failurePreview || "无失败样本"}
`;

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, markdown, "utf8");
  console.log(`Load test report written to: ${outPath}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
