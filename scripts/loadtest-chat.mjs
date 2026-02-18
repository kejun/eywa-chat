#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

function readArg(name, fallback) {
  const flag = `--${name}`;
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && idx + 1 < process.argv.length) {
    return process.argv[idx + 1];
  }
  return fallback;
}

function readNumberArg(name, fallback) {
  const value = Number(readArg(name, String(fallback)));
  return Number.isFinite(value) ? value : fallback;
}

function percentile(values, p) {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  const index = Math.min(Math.max(rank, 0), sorted.length - 1);
  return sorted[index];
}

function parseSseBlock(rawBlock) {
  const lines = rawBlock.split("\n");
  let event = "message";
  const dataParts = [];

  for (const line of lines) {
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      dataParts.push(line.slice("data:".length).trim());
    }
  }

  const dataText = dataParts.join("\n");
  let data;
  if (dataText) {
    try {
      data = JSON.parse(dataText);
    } catch {
      data = { raw: dataText };
    }
  } else {
    data = {};
  }

  return { event, data };
}

async function runOneRequest(input) {
  const abortController = new AbortController();
  const timeout = setTimeout(() => {
    abortController.abort();
  }, input.timeoutMs);

  const startedAt = performance.now();
  let firstTokenMs = null;
  let tokenCount = 0;
  let traceId = "";
  let doneEvent = false;

  try {
    const response = await fetch(input.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tenant-id": input.tenantId,
        "x-user-id": input.userId,
      },
      body: JSON.stringify({
        threadId: `${input.threadPrefix}-${input.id}`,
        message: input.message,
      }),
      signal: abortController.signal,
    });

    if (!response.ok || !response.body) {
      return {
        ok: false,
        status: response.status,
        id: input.id,
        totalMs: performance.now() - startedAt,
        error: `HTTP ${response.status}`,
      };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      let separatorIndex = buffer.indexOf("\n\n");
      while (separatorIndex >= 0) {
        const block = buffer.slice(0, separatorIndex).trim();
        buffer = buffer.slice(separatorIndex + 2);

        if (block.length > 0) {
          const parsed = parseSseBlock(block);
          if (parsed.event === "meta" && parsed.data && typeof parsed.data === "object") {
            traceId =
              typeof parsed.data.traceId === "string" ? parsed.data.traceId : traceId;
          }
          if (parsed.event === "token") {
            tokenCount += 1;
            if (firstTokenMs === null) {
              firstTokenMs = performance.now() - startedAt;
            }
          }
          if (parsed.event === "done") {
            doneEvent = true;
          }
        }

        separatorIndex = buffer.indexOf("\n\n");
      }
    }

    return {
      ok: doneEvent,
      status: response.status,
      id: input.id,
      totalMs: performance.now() - startedAt,
      firstTokenMs: firstTokenMs ?? performance.now() - startedAt,
      tokenCount,
      traceId,
      error: doneEvent ? undefined : "missing done event",
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      id: input.id,
      totalMs: performance.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function run() {
  const url = readArg("url", "http://localhost:3000/api/chat");
  const requests = readNumberArg("requests", 20);
  const concurrency = readNumberArg("concurrency", 5);
  const timeoutMs = readNumberArg("timeout-ms", 30000);
  const tenantId = readArg("tenant-id", "t-loadtest");
  const userId = readArg("user-id", "u-loadtest");
  const message = readArg("message", "请记住我偏好高铁，并回复已记录。");
  const threadPrefix = readArg("thread-prefix", "loadtest");
  const outputPath = readArg("output", "");

  const totalStartedAt = performance.now();
  const results = [];
  let nextId = 0;

  async function worker() {
    while (true) {
      const currentId = nextId;
      nextId += 1;
      if (currentId >= requests) {
        return;
      }

      const result = await runOneRequest({
        id: currentId,
        url,
        tenantId,
        userId,
        message,
        threadPrefix,
        timeoutMs,
      });
      results.push(result);
      const statusLabel = result.ok ? "OK" : "FAIL";
      const traceInfo = result.traceId ? ` trace=${result.traceId}` : "";
      console.log(
        `[${statusLabel}] #${currentId} total=${result.totalMs.toFixed(1)}ms${traceInfo}${
          result.error ? ` error=${result.error}` : ""
        }`,
      );
    }
  }

  const workers = Array.from({ length: Math.max(1, concurrency) }, () => worker());
  await Promise.all(workers);

  const totalDurationMs = performance.now() - totalStartedAt;
  const success = results.filter((item) => item.ok);
  const failed = results.filter((item) => !item.ok);
  const totalLatencies = success.map((item) => item.totalMs);
  const firstTokenLatencies = success
    .map((item) => item.firstTokenMs)
    .filter((value) => typeof value === "number");

  const summary = {
    config: {
      url,
      requests,
      concurrency,
      timeoutMs,
      tenantId,
      userId,
      threadPrefix,
      message,
    },
    totals: {
      durationMs: totalDurationMs,
      requests,
      success: success.length,
      failed: failed.length,
      successRate: requests > 0 ? success.length / requests : 0,
      throughputRps: totalDurationMs > 0 ? (success.length * 1000) / totalDurationMs : 0,
    },
    latency: {
      total: {
        p50: percentile(totalLatencies, 50),
        p95: percentile(totalLatencies, 95),
        max: totalLatencies.length ? Math.max(...totalLatencies) : 0,
      },
      firstToken: {
        p50: percentile(firstTokenLatencies, 50),
        p95: percentile(firstTokenLatencies, 95),
        max: firstTokenLatencies.length ? Math.max(...firstTokenLatencies) : 0,
      },
    },
    failures: failed.slice(0, 20),
  };

  console.log("\n=== Load Test Summary ===");
  console.log(JSON.stringify(summary, null, 2));

  if (outputPath) {
    await writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    console.log(`Summary written to: ${outputPath}`);
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
