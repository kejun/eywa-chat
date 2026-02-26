import type { UpsertMemoryInput } from "@/lib/memory";
import { extractRememberCommandContent, hasMemoryWriteIntent } from "@/lib/chat/memory-intent";

function detectMemoryType(message: string): UpsertMemoryInput["memoryType"] {
  if (/我喜欢|我偏好|偏向|习惯/.test(message)) {
    return "preference";
  }

  if (/我叫|我是|我的名字/.test(message)) {
    return "profile";
  }

  if (/任务|待办|todo|提醒/.test(message)) {
    return "task";
  }

  return "fact";
}

function shouldPersist(message: string): boolean {
  return hasMemoryWriteIntent(message);
}

function deriveMemoryContent(message: string): string {
  return extractRememberCommandContent(message);
}

function deriveMemoryKey(message: string): string {
  const condensed = message
    .trim()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s+/g, " ")
    .slice(0, 36);
  return condensed || "memory";
}

export function extractMemoryCandidates(input: {
  tenantId: string;
  userId: string;
  threadId: string;
  userMessage: string;
  traceId: string;
}): UpsertMemoryInput[] {
  const message = input.userMessage.trim();

  if (!message || !shouldPersist(message)) {
    return [];
  }

  return [
    {
      tenantId: input.tenantId,
      userId: input.userId,
      threadId: input.threadId,
      memoryType: detectMemoryType(message),
      key: deriveMemoryKey(message),
      content: deriveMemoryContent(message),
      importance: /必须|务必|一定/.test(message) ? 5 : 3,
      sourceMessageId: input.traceId,
      tags: ["auto-extracted"],
      sourceType: "chat",
      sourceName: "rule-based-extractor",
      confidence: 0.72,
      actionTraceId: input.traceId,
    },
  ];
}
