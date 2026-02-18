import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron/auth";
import { logger } from "@/lib/logger";
import { memoryRepository } from "@/lib/memory";
import { recordMetric } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized cron request" }, { status: 401 });
  }

  const startedAt = Date.now();

  try {
    const totalMemories = await memoryRepository.countAllMemories();

    // Phase-1 先保留占位能力，后续补摘要压缩策略。
    const compactedCount = 0;

    recordMetric({
      name: "cron.memory_compact.duration",
      value: Date.now() - startedAt,
      unit: "ms",
    });
    recordMetric({
      name: "cron.memory_compact.compacted_count",
      value: compactedCount,
      unit: "count",
    });

    logger.info("cron-memory-compact-finished", {
      totalMemories,
      compactedCount,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({
      ok: true,
      compactedCount,
      totalMemories,
      durationMs: Date.now() - startedAt,
      note: "summary compaction is a phase-2 task",
    });
  } catch (error) {
    logger.error("cron-memory-compact-failed", {
      reason: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
