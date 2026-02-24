import { logger } from "@/lib/logger";
import { memoryRepositoryInstance as memoryRepository } from "@/lib/memory";
import { recordMetric } from "@/lib/observability";

type ScheduledJobHandler = () => Promise<Record<string, unknown>>;

const scheduledJobs: Record<string, ScheduledJobHandler> = {
  "memory-ttl": async () => {
    const startedAt = Date.now();
    const beforeCount = await memoryRepository.countAllMemories();
    await memoryRepository.deleteExpiredMemories();
    const afterCount = await memoryRepository.countAllMemories();
    const deletedCount = Math.max(0, beforeCount - afterCount);
    const durationMs = Date.now() - startedAt;

    recordMetric({
      name: "cron.memory_ttl.duration",
      value: durationMs,
      unit: "ms",
    });
    recordMetric({
      name: "cron.memory_ttl.deleted_count",
      value: deletedCount,
      unit: "count",
    });
    recordMetric({
      name: "cron.schedule.duration",
      value: durationMs,
      unit: "ms",
      tags: { jobId: "memory-ttl" },
    });

    logger.info("cron-memory-ttl-finished", {
      beforeCount,
      afterCount,
      deletedCount,
      durationMs,
    });

    return {
      ok: true,
      beforeCount,
      afterCount,
      deletedCount,
      durationMs,
    };
  },
  "memory-compact": async () => {
    const startedAt = Date.now();
    const totalMemories = await memoryRepository.countAllMemories();
    // Phase-1: keep compact placeholder behavior and expose via generic scheduler.
    const compactedCount = 0;
    const durationMs = Date.now() - startedAt;

    recordMetric({
      name: "cron.memory_compact.duration",
      value: durationMs,
      unit: "ms",
    });
    recordMetric({
      name: "cron.memory_compact.compacted_count",
      value: compactedCount,
      unit: "count",
    });
    recordMetric({
      name: "cron.schedule.duration",
      value: durationMs,
      unit: "ms",
      tags: { jobId: "memory-compact" },
    });

    logger.info("cron-memory-compact-finished", {
      totalMemories,
      compactedCount,
      durationMs,
    });

    return {
      ok: true,
      compactedCount,
      totalMemories,
      durationMs,
      note: "summary compaction is a phase-2 task",
    };
  },
};

export function listScheduledJobs() {
  return Object.keys(scheduledJobs);
}

export async function runScheduledJob(jobId: string): Promise<Record<string, unknown>> {
  const handler = scheduledJobs[jobId];
  if (!handler) {
    return {
      ok: false,
      error: `Unknown scheduled job: ${jobId}`,
      availableJobs: listScheduledJobs(),
    };
  }

  try {
    return await handler();
  } catch (error) {
    logger.error("cron-schedule-job-failed", {
      jobId,
      reason: error instanceof Error ? error.message : String(error),
    });
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error",
      jobId,
    };
  }
}
