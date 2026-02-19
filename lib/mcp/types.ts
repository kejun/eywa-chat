import type { z } from "zod";
import type { UpsertMemoryInput } from "@/lib/memory";

export type McpExecutionContext = {
  tenantId: string;
  userId: string;
  threadId: string;
  traceId: string;
  allowedTools?: string[];
};

export type McpToolResult = {
  status: "success" | "failed";
  summary: string;
  output?: Record<string, unknown>;
  memoryCandidates?: UpsertMemoryInput[];
};

export type McpToolDefinition<TSchema extends z.ZodTypeAny = z.ZodTypeAny> = {
  name: string;
  description: string;
  inputSchema: TSchema;
  timeoutMs?: number;
  retryable?: boolean;
  execute: (context: McpExecutionContext, args: z.infer<TSchema>) => Promise<McpToolResult>;
};
