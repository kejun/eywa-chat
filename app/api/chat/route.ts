import { headers } from "next/headers";
import { z } from "zod";
import { runChatGraph } from "@/lib/chat";
import { logger } from "@/lib/logger";
import { recordMetric } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ChatRequestSchema = z.object({
  tenantId: z.string().min(1),
  userId: z.string().min(1),
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

  const requestHeaders = await headers();
  const traceId = requestHeaders.get("x-trace-id") ?? crypto.randomUUID();
  const sendSse = createSseEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const pushEvent = (event: string, body: Record<string, unknown>) => {
        controller.enqueue(sendSse(event, body));
      };

      pushEvent("meta", { traceId });

      try {
        const finalState = await runChatGraph({
          tenantId: parsed.data.tenantId,
          userId: parsed.data.userId,
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
