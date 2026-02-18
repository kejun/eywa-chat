import { Annotation } from "@langchain/langgraph";
import type { MemoryEntry, UpsertMemoryInput } from "@/lib/memory";

export const ChatStateAnnotation = Annotation.Root({
  tenantId: Annotation<string>,
  userId: Annotation<string>,
  threadId: Annotation<string>,
  userMessage: Annotation<string>,
  traceId: Annotation<string>,
  shouldRetrieve: Annotation<boolean>({
    default: () => true,
  }),
  retrievedMemories: Annotation<MemoryEntry[]>({
    default: () => [],
  }),
  response: Annotation<string>({
    default: () => "",
  }),
  memoryWriteCandidates: Annotation<UpsertMemoryInput[]>({
    default: () => [],
  }),
  persistedCount: Annotation<number>({
    default: () => 0,
  }),
});

export type ChatState = typeof ChatStateAnnotation.State;

export type ChatGraphInput = {
  tenantId: string;
  userId: string;
  threadId: string;
  userMessage: string;
  traceId: string;
};
