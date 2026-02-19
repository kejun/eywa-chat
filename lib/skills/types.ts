import type { z } from "zod";
import type { UpsertMemoryInput } from "@/lib/memory";

export type SkillContext = {
  tenantId: string;
  userId: string;
  threadId: string;
  traceId: string;
  userMessage: string;
};

export type SkillResult = {
  status: "success" | "failed";
  summary: string;
  output?: Record<string, unknown>;
  memoryCandidates?: UpsertMemoryInput[];
};

export type SkillMatchResult<TSchema extends z.ZodTypeAny = z.ZodTypeAny> = {
  score: number;
  args: z.infer<TSchema>;
};

export type SkillDefinition<TSchema extends z.ZodTypeAny = z.ZodTypeAny> = {
  name: string;
  description: string;
  inputSchema: TSchema;
  match: (message: string) => SkillMatchResult<TSchema> | null;
  run: (context: SkillContext, args: z.infer<TSchema>) => Promise<SkillResult>;
};
