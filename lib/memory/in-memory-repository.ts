import { logger } from "@/lib/logger";
import type { MemoryEntry, MemoryMetadata, RetrieveMemoryInput, UpsertMemoryInput } from "@/lib/memory/types";
import { buildMemoryId, buildMemoryKey, MemoryMetadataSchema } from "@/lib/memory/types";

const memoryStore = new Map<string, MemoryEntry>();

export class InMemoryMemoryRepository {
  async retrieveMemories(input: RetrieveMemoryInput): Promise<MemoryEntry[]> {
    const queryText = input.queryText.toLowerCase().trim();
    if (!queryText) {
      return [];
    }

    const entries: MemoryEntry[] = [];
    for (const entry of memoryStore.values()) {
      if (entry.metadata.tenantId !== input.tenantId || entry.metadata.userId !== input.userId) {
        continue;
      }
      if (input.threadId && entry.metadata.threadId !== input.threadId) {
        continue;
      }
      if (entry.content.toLowerCase().includes(queryText)) {
        entries.push(entry);
      }
    }

    entries.sort((a, b) => {
      const scoreA = a.metadata.importance ?? 3;
      const scoreB = b.metadata.importance ?? 3;
      return scoreB - scoreA;
    });

    return entries.slice(0, input.nResults ?? 8);
  }

  async upsertMemories(inputs: UpsertMemoryInput[]): Promise<Array<{ id: string; memoryKey: string; version: number }>> {
    if (inputs.length === 0) {
      return [];
    }

    const now = Date.now();
    const result: Array<{ id: string; memoryKey: string; version: number }> = [];

    for (const input of inputs) {
      const memoryKey = buildMemoryKey({
        tenantId: input.tenantId,
        userId: input.userId,
        memoryType: input.memoryType,
        key: input.key,
      });

      const id = buildMemoryId(memoryKey);
      const existing = memoryStore.get(id);
      const version = existing ? existing.metadata.version + 1 : 1;

      const metadata: MemoryMetadata = {
        tenantId: input.tenantId,
        userId: input.userId,
        threadId: input.threadId,
        memoryType: input.memoryType,
        memoryKey,
        importance: input.importance ?? 3,
        createdAt: existing?.metadata.createdAt ?? now,
        lastAccessAt: now,
        expiresAt: input.expiresAt ?? null,
        sourceMessageId: input.sourceMessageId ?? "system",
        version,
        tags: input.tags ?? [],
        sourceType: input.sourceType,
        sourceName: input.sourceName,
        confidence: input.confidence,
        actionTraceId: input.actionTraceId,
      };

      const entry: MemoryEntry = {
        id,
        content: input.content,
        metadata,
      };

      memoryStore.set(id, entry);
      result.push({ id, memoryKey, version });

      logger.info("memory-upserted-in-memory", {
        id,
        memoryKey,
        version,
        contentLength: input.content.length,
      });
    }

    return result;
  }

  async listMemories(input: { tenantId: string; userId: string; memoryType?: string; limit?: number; offset?: number }): Promise<MemoryEntry[]> {
    const entries: MemoryEntry[] = [];
    for (const entry of memoryStore.values()) {
      if (entry.metadata.tenantId !== input.tenantId || entry.metadata.userId !== input.userId) {
        continue;
      }
      if (input.memoryType && entry.metadata.memoryType !== input.memoryType) {
        continue;
      }
      entries.push(entry);
    }

    const offset = input.offset ?? 0;
    const limit = input.limit ?? 20;
    return entries.slice(offset, offset + limit);
  }

  async deleteMemories(input: { tenantId: string; userId: string; ids?: string[]; memoryKey?: string }): Promise<void> {
    if (input.ids) {
      for (const id of input.ids) {
        memoryStore.delete(id);
      }
    }
    if (input.memoryKey) {
      const id = buildMemoryId(input.memoryKey);
      memoryStore.delete(id);
    }
  }

  async clear(): Promise<void> {
    memoryStore.clear();
  }

  async count(): Promise<number> {
    return memoryStore.size;
  }
}

export const inMemoryMemoryRepository = new InMemoryMemoryRepository();
