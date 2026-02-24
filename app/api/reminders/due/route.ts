import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveRequestIdentity } from "@/lib/auth/context";
import { logger } from "@/lib/logger";
import { memoryRepositoryInstance as memoryRepository } from "@/lib/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const QuerySchema = z.object({
  threadId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(20).optional(),
});

export async function GET(request: Request) {
  const identityResult = await resolveRequestIdentity(request);
  if (!identityResult.ok) {
    return NextResponse.json(
      { error: identityResult.error },
      {
        status: identityResult.status,
        headers: {
          "x-trace-id": identityResult.traceId,
        },
      },
    );
  }

  const { identity } = identityResult;
  const query = QuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams.entries()),
  );
  if (!query.success) {
    return NextResponse.json(
      { error: "Invalid query", issues: query.error.issues },
      { status: 400 },
    );
  }

  const now = Date.now();
  const limit = query.data.limit ?? 10;

  try {
    const taskMemories = await memoryRepository.listMemories({
      tenantId: identity.tenantId,
      userId: identity.userId,
      memoryType: "task",
      limit: 100,
      offset: 0,
    });

    const dueReminders = taskMemories
      .filter((entry) => {
        const metadata = entry.metadata;
        if (query.data.threadId && metadata.threadId !== query.data.threadId) {
          return false;
        }
        if (!metadata.tags.includes("reminder_pending")) {
          return false;
        }
        return Boolean(metadata.expiresAt && metadata.expiresAt <= now);
      })
      .sort((a, b) => (a.metadata.expiresAt ?? 0) - (b.metadata.expiresAt ?? 0))
      .slice(0, limit);

    await Promise.all(
      dueReminders.map((reminder) =>
        memoryRepository.deleteMemories({
          tenantId: identity.tenantId,
          userId: identity.userId,
          memoryKey: reminder.metadata.memoryKey,
        }),
      ),
    );

    return NextResponse.json({
      reminders: dueReminders.map((entry) => ({
        id: entry.id,
        text: entry.content,
        threadId: entry.metadata.threadId ?? null,
        dueAt: entry.metadata.expiresAt ?? null,
      })),
    });
  } catch (error) {
    logger.error("reminder-due-fetch-failed", {
      traceId: identity.traceId,
      reason: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch reminders" },
      { status: 500 },
    );
  }
}
