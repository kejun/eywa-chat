import type { MemoryEntry } from "@/lib/memory";

export function buildSystemPrompt(memories: MemoryEntry[]): string {
  const memorySection =
    memories.length > 0
      ? memories
          .map(
            (memory, index) =>
              `${index + 1}. [${memory.metadata.memoryType}] ${memory.content}`,
          )
          .join("\n")
      : "暂无可用记忆。";

  return [
    "你是一个具备长期记忆能力的中文助手。",
    "回答要求：准确、简洁、可执行。",
    "优先使用“历史记忆”中的信息来保持一致性；若记忆与用户当前输入冲突，以当前输入为准。",
    "",
    "历史记忆：",
    memorySection,
  ].join("\n");
}
