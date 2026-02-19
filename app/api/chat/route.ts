import { z } from "zod";
import { resolveRequestIdentity } from "@/lib/auth/context";
import { runChatGraph } from "@/lib/chat";
import { logger } from "@/lib/logger";
import { recordMetric } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ChatRequestSchema = z.object({
  threadId: z.string().min(1),
  message: z.string().min(1),
});

function splitForStreaming(text: string): string[] {
  const normalized = text.trim();
  if (!normalized) {
    return [];
  }

  const chunks: string[] = [];
  for (let index = 0; index < normalized.length; index += 20) {
    chunks.push(normalized.slice(index, index + 20));
  }
  return chunks;
}

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function createSseEncoder() {
  const encoder = new TextEncoder();
  return (event: string, payload: Record<string, unknown>) =>
    encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function buildActionDonePayload(state: Awaited<ReturnType<typeof runChatGraph>>) {
  const plannedAction = state.plannedAction;
  const summary = state.actionSummary || undefined;
  const error = state.actionValidationError || undefined;
  const memoryCandidateCount = state.actionMemoryCandidates.length;
  const sourceMessage = state.userMessage || undefined;
  const output = isPlainObject(state.actionOutput) && Object.keys(state.actionOutput).length > 0
    ? state.actionOutput
    : undefined;

  let executorName: string | undefined;
  let args: Record<string, unknown> | undefined;

  if (plannedAction === "skill") {
    executorName = state.selectedSkill || undefined;
    args = isPlainObject(state.skillArgs) && Object.keys(state.skillArgs).length > 0
      ? state.skillArgs
      : undefined;
  } else if (plannedAction === "mcp") {
    executorName = state.selectedTool || undefined;
    args = isPlainObject(state.toolArgs) && Object.keys(state.toolArgs).length > 0
      ? state.toolArgs
      : undefined;
  }

  if (
    plannedAction === "chat" &&
    !summary &&
    !error &&
    memoryCandidateCount === 0 &&
    !executorName &&
    !args &&
    !output
  ) {
    return null;
  }

  return {
    plannedAction,
    executorName,
    summary,
    error,
    sourceMessage,
    args,
    output,
    memoryCandidateCount,
  };
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const payload = await request.json().catch(() => null);
  const parsed = ChatRequestSchema.safeParse(payload);

  if (!parsed.success) {
    recordMetric({
      name: "chat.request.total",
      value: 1,
      unit: "count",
      tags: { status: "bad_request" },
    });
    return new Response(
      JSON.stringify({
        error: "Invalid chat payload",
        issues: parsed.error.issues,
      }),
      {
        status: 400,
        headers: {
          "content-type": "application/json",
        },
      },
    );
  }

  const identityResult = await resolveRequestIdentity(request);
  if (!identityResult.ok) {
    recordMetric({
      name: "chat.request.total",
      value: 1,
      unit: "count",
      tags: { status: "unauthorized" },
    });

    return new Response(
      JSON.stringify({
        error: identityResult.error,
      }),
      {
        status: identityResult.status,
        headers: {
          "content-type": "application/json",
          "x-trace-id": identityResult.traceId,
        },
      },
    );
  }

  const { identity } = identityResult;
  const traceId = identity.traceId;
  const sendSse = createSseEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const pushEvent = (event: string, body: Record<string, unknown>) => {
        controller.enqueue(sendSse(event, body));
      };

      pushEvent("meta", { traceId });

      try {
        const finalState = await runChatGraph({
          tenantId: identity.tenantId,
          userId: identity.userId,
          threadId: parsed.data.threadId,
          userMessage: parsed.data.message,
          traceId,
        });

        for (const chunk of splitForStreaming(finalState.response)) {
          pushEvent("token", { text: chunk });
          await wait(15);
        }

        pushEvent("done", {
          traceId,
          retrievedCount: finalState.retrievedMemories.length,
          persistedCount: finalState.persistedCount,
          action: buildActionDonePayload(finalState),
        });

        recordMetric({
          name: "chat.request.total",
          value: 1,
          unit: "count",
          tags: { status: "success" },
        });
        recordMetric({
          name: "chat.request.duration",
          value: Date.now() - startedAt,
          unit: "ms",
          tags: { status: "success" },
        });
        recordMetric({
          name: "chat.memories.retrieved",
          value: finalState.retrievedMemories.length,
          unit: "count",
        });
        recordMetric({
          name: "chat.memories.persisted",
          value: finalState.persistedCount,
          unit: "count",
        });
      } catch (error) {
        logger.error("chat-route-failed", {
          traceId,
          reason: error instanceof Error ? error.message : String(error),
        });

        const fallbackText =
          "服务暂时不可用，我已记录你的请求。请稍后重试，或告诉我你希望我先处理哪一步。";
        for (const chunk of splitForStreaming(fallbackText)) {
          pushEvent("token", { text: chunk });
          await wait(15);
        }
        pushEvent("done", { traceId, degraded: true });

        recordMetric({
          name: "chat.request.total",
          value: 1,
          unit: "count",
          tags: { status: "degraded" },
        });
        recordMetric({
          name: "chat.request.duration",
          value: Date.now() - startedAt,
          unit: "ms",
          tags: { status: "degraded" },
        });
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-trace-id": traceId,
    },
  });
}
