import { Annotation } from "@langchain/langgraph";
import type { MemoryEntry, UpsertMemoryInput } from "@/lib/memory";

export const ChatStateAnnotation = Annotation.Root({
  tenantId: Annotation<string>,
  userId: Annotation<string>,
  threadId: Annotation<string>,
  userMessage: Annotation<string>,
  traceId: Annotation<string>,
  plannedAction: Annotation<"chat" | "skill" | "mcp">({
    reducer: (_left, right) => right,
    default: () => "chat",
  }),
  selectedSkill: Annotation<string>({
    reducer: (_left, right) => right,
    default: () => "",
  }),
  skillArgs: Annotation<Record<string, unknown>>({
    reducer: (_left, right) => right,
    default: () => ({}),
  }),
  selectedTool: Annotation<string>({
    reducer: (_left, right) => right,
    default: () => "",
  }),
  toolArgs: Annotation<Record<string, unknown>>({
    reducer: (_left, right) => right,
    default: () => ({}),
  }),
  actionSummary: Annotation<string>({
    reducer: (_left, right) => right,
    default: () => "",
  }),
  actionValidationError: Annotation<string>({
    reducer: (_left, right) => right,
    default: () => "",
  }),
  actionMemoryCandidates: Annotation<UpsertMemoryInput[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
  shouldRetrieve: Annotation<boolean>({
    reducer: (_left, right) => right,
    default: () => true,
  }),
  retrievedMemories: Annotation<MemoryEntry[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
  response: Annotation<string>({
    reducer: (_left, right) => right,
    default: () => "",
  }),
  memoryWriteCandidates: Annotation<UpsertMemoryInput[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
  persistedCount: Annotation<number>({
    reducer: (_left, right) => right,
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
