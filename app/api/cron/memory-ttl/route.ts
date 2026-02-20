import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron/auth";
import { logger } from "@/lib/logger";
import { memoryRepositoryInstance as memoryRepository } from "@/lib/memory";
import { recordMetric } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized cron request" }, { status: 401 });
  }

  const startedAt = Date.now();

  try {
    const beforeCount = await memoryRepository.countAllMemories();
    await memoryRepository.deleteExpiredMemories();
    const afterCount = await memoryRepository.countAllMemories();
    const deletedCount = Math.max(0, beforeCount - afterCount);

    recordMetric({
      name: "cron.memory_ttl.duration",
      value: Date.now() - startedAt,
      unit: "ms",
    });
    recordMetric({
      name: "cron.memory_ttl.deleted_count",
      value: deletedCount,
      unit: "count",
    });

    logger.info("cron-memory-ttl-finished", {
      beforeCount,
      afterCount,
      deletedCount,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({
      ok: true,
      beforeCount,
      afterCount,
      deletedCount,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    logger.error("cron-memory-ttl-failed", {
      reason: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
