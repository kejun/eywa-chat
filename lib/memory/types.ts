import { createHash } from "node:crypto";
import { z } from "zod";

export const MemoryTypeSchema = z.enum([
  "profile",
  "preference",
  "fact",
  "task",
  "summary",
]);

export type MemoryType = z.infer<typeof MemoryTypeSchema>;

export const MemorySourceTypeSchema = z.enum(["chat", "mcp", "skill"]);

export type MemorySourceType = z.infer<typeof MemorySourceTypeSchema>;

export const MemoryMetadataSchema = z.object({
  tenantId: z.string().min(1),
  userId: z.string().min(1),
  threadId: z.string().min(1).optional(),
  memoryType: MemoryTypeSchema,
  memoryKey: z.string().min(1),
  importance: z.number().int().min(1).max(5),
  createdAt: z.number().int().positive(),
  lastAccessAt: z.number().int().positive(),
  expiresAt: z.number().int().positive().nullable(),
  sourceMessageId: z.string().min(1),
  version: z.number().int().positive(),
  tags: z.array(z.string()),
  sourceType: MemorySourceTypeSchema.optional(),
  sourceName: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  actionTraceId: z.string().optional(),
});

export type MemoryMetadata = z.infer<typeof MemoryMetadataSchema>;

export type MemoryEntry = {
  id: string;
  content: string;
  metadata: MemoryMetadata;
  distance?: number | null;
};

export type UpsertMemoryInput = {
  tenantId: string;
  userId: string;
  threadId?: string;
  memoryType: MemoryType;
  key: string;
  content: string;
  importance?: number;
  sourceMessageId?: string;
  tags?: string[];
  expiresAt?: number | null;
  sourceType?: MemorySourceType;
  sourceName?: string;
  confidence?: number;
  actionTraceId?: string;
};

export type RetrieveMemoryInput = {
  tenantId: string;
  userId: string;
  queryText: string;
  threadId?: string;
  memoryTypes?: MemoryType[];
  nResults?: number;
};

export type ListMemoryInput = {
  tenantId: string;
  userId: string;
  memoryType?: MemoryType;
  limit?: number;
  offset?: number;
};

export function sanitizeMemoryKey(key: string): string {
  return key.trim().toLowerCase().replace(/\s+/g, "_");
}

export function buildMemoryKey(input: {
  tenantId: string;
  userId: string;
  memoryType: MemoryType;
  key: string;
}): string {
  return [
    input.tenantId,
    input.userId,
    input.memoryType,
    sanitizeMemoryKey(input.key),
  ].join(":");
}

export function buildMemoryId(memoryKey: string): string {
  const digest = createHash("sha256").update(memoryKey).digest("hex");
  return `mem_${digest.slice(0, 32)}`;
}
