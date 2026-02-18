import type { GetResult, QueryResult, Where } from "seekdb";
import { getMemoryCollection } from "@/lib/seekdb/client";
import { logger } from "@/lib/logger";
import {
  MemoryMetadataSchema,
  buildMemoryId,
  buildMemoryKey,
  type ListMemoryInput,
  type MemoryEntry,
  type MemoryMetadata,
  type RetrieveMemoryInput,
  type UpsertMemoryInput,
} from "@/lib/memory/types";

const DEFAULT_RESULTS = 8;
const MAX_RESULTS = 50;
const RESULT_MULTIPLIER = 3;

function normalizeResults(value?: number): number {
  if (!value) {
    return DEFAULT_RESULTS;
  }
  return Math.min(Math.max(1, value), MAX_RESULTS);
}

function parseMemoryMetadata(value: unknown): MemoryMetadata | null {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = MemoryMetadataSchema.safeParse(value);
  if (!parsed.success) {
    logger.warn("memory-metadata-invalid", {
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
    return null;
  }
  return parsed.data;
}

function mapQueryResultToEntries(result: QueryResult<MemoryMetadata>): MemoryEntry[] {
  const ids = result.ids[0] ?? [];
  const documents = result.documents?.[0] ?? [];
  const metadatas = result.metadatas?.[0] ?? [];
  const distances = result.distances?.[0] ?? [];

  const now = Date.now();
  const entries: MemoryEntry[] = [];

  for (let idx = 0; idx < ids.length; idx += 1) {
    const id = ids[idx];
    const document = documents[idx];
    const metadata = parseMemoryMetadata(metadatas[idx]);
    const distance = distances[idx];

    if (!id || document === null || document === undefined || !metadata) {
      continue;
    }
    if (metadata.expiresAt && metadata.expiresAt <= now) {
      continue;
    }

    entries.push({
      id,
      content: document,
      metadata,
      distance,
    });
  }

  return entries;
}

function mapGetResultToEntries(result: GetResult<MemoryMetadata>): MemoryEntry[] {
  const entries: MemoryEntry[] = [];
  const now = Date.now();

  for (let idx = 0; idx < result.ids.length; idx += 1) {
    const id = result.ids[idx];
    const document = result.documents?.[idx];
    const metadata = parseMemoryMetadata(result.metadatas?.[idx]);

    if (document === null || document === undefined || !metadata) {
      continue;
    }
    if (metadata.expiresAt && metadata.expiresAt <= now) {
      continue;
    }

    entries.push({
      id,
      content: document,
      metadata,
    });
  }

  return entries;
}

function buildWhereFilter(input: {
  tenantId: string;
  userId: string;
  threadId?: string;
  memoryTypes?: MemoryMetadata["memoryType"][];
}): Where {
  const where: Record<string, unknown> = {
    tenantId: input.tenantId,
    userId: input.userId,
  };

  if (input.threadId) {
    where.threadId = input.threadId;
  }

  if (input.memoryTypes && input.memoryTypes.length > 0) {
    where.memoryType = {
      $in: input.memoryTypes,
    };
  }

  return where as Where;
}

export class MemoryRepository {
  async retrieveMemories(input: RetrieveMemoryInput): Promise<MemoryEntry[]> {
    const queryText = input.queryText.trim();
    if (!queryText) {
      return [];
    }

    const nResults = normalizeResults(input.nResults);
    const wideResults = normalizeResults(nResults * RESULT_MULTIPLIER);
    const where = buildWhereFilter(input);
    const collection = await getMemoryCollection();

    try {
      const hybridResult = await collection.hybridSearch<MemoryMetadata>({
        query: {
          whereDocument: { $contains: queryText },
          where,
          nResults: wideResults,
        },
        knn: {
          queryTexts: [queryText],
          where,
          nResults: wideResults,
        },
        rank: { rrf: {} },
        nResults,
        include: ["documents", "metadatas", "distances"],
      });

      const entries = mapQueryResultToEntries(hybridResult).slice(0, nResults);
      await this.touchMemoryAccess(entries.map((entry) => entry.id));
      return entries;
    } catch (error) {
      logger.warn("memory-hybrid-search-failed", {
        tenantId: input.tenantId,
        userId: input.userId,
        reason: error instanceof Error ? error.message : String(error),
      });
    }

    const vectorResult = await collection.query<MemoryMetadata>({
      queryTexts: [queryText],
      where,
      nResults,
      include: ["documents", "metadatas", "distances"],
    });

    const fallbackEntries = mapQueryResultToEntries(vectorResult).slice(0, nResults);
    await this.touchMemoryAccess(fallbackEntries.map((entry) => entry.id));
    return fallbackEntries;
  }

  async upsertMemories(inputs: UpsertMemoryInput[]): Promise<
    Array<{
      id: string;
      memoryKey: string;
      version: number;
    }>
  > {
    if (inputs.length === 0) {
      return [];
    }

    const collection = await getMemoryCollection();
    const now = Date.now();
    const prepared = inputs.map((input) => {
      const memoryKey = buildMemoryKey({
        tenantId: input.tenantId,
        userId: input.userId,
        memoryType: input.memoryType,
        key: input.key,
      });

      return {
        ...input,
        memoryKey,
        id: buildMemoryId(memoryKey),
      };
    });

    const existingResult = await collection.get<MemoryMetadata>({
      ids: prepared.map((item) => item.id),
      include: ["metadatas"],
    });

    const existingById = new Map<string, MemoryMetadata>();
    for (let idx = 0; idx < existingResult.ids.length; idx += 1) {
      const existingId = existingResult.ids[idx];
      const metadata = parseMemoryMetadata(existingResult.metadatas?.[idx]);
      if (metadata) {
        existingById.set(existingId, metadata);
      }
    }

    const ids: string[] = [];
    const documents: string[] = [];
    const metadatas: MemoryMetadata[] = [];
    const result: Array<{
      id: string;
      memoryKey: string;
      version: number;
    }> = [];

    for (const item of prepared) {
      const previous = existingById.get(item.id);
      const version = previous ? previous.version + 1 : 1;
      const metadata: MemoryMetadata = {
        tenantId: item.tenantId,
        userId: item.userId,
        threadId: item.threadId,
        memoryType: item.memoryType,
        memoryKey: item.memoryKey,
        importance: item.importance ?? 3,
        createdAt: previous?.createdAt ?? now,
        lastAccessAt: now,
        expiresAt: item.expiresAt ?? null,
        sourceMessageId: item.sourceMessageId ?? "system",
        version,
        tags: item.tags ?? [],
        sourceType: item.sourceType,
        sourceName: item.sourceName,
        confidence: item.confidence,
        actionTraceId: item.actionTraceId,
      };

      ids.push(item.id);
      documents.push(item.content);
      metadatas.push(metadata);
      result.push({
        id: item.id,
        memoryKey: item.memoryKey,
        version,
      });
    }

    await collection.upsert({
      ids,
      documents,
      metadatas,
    });

    return result;
  }

  async listMemories(input: ListMemoryInput): Promise<MemoryEntry[]> {
    const collection = await getMemoryCollection();
    const where = buildWhereFilter({
      tenantId: input.tenantId,
      userId: input.userId,
      memoryTypes: input.memoryType ? [input.memoryType] : undefined,
    });

    const result = await collection.get<MemoryMetadata>({
      where,
      include: ["documents", "metadatas"],
      limit: input.limit ?? 20,
      offset: input.offset ?? 0,
    });

    return mapGetResultToEntries(result);
  }

  async deleteMemories(input: {
    tenantId: string;
    userId: string;
    ids?: string[];
    memoryKey?: string;
  }): Promise<void> {
    if (!input.ids?.length && !input.memoryKey) {
      throw new Error("deleteMemories requires ids or memoryKey");
    }

    const collection = await getMemoryCollection();
    const where: Record<string, unknown> = {
      tenantId: input.tenantId,
      userId: input.userId,
    };

    if (input.memoryKey) {
      where.memoryKey = input.memoryKey;
    }

    await collection.delete({
      ids: input.ids,
      where: where as Where,
    });
  }

  async touchMemoryAccess(ids: string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }

    const collection = await getMemoryCollection();
    const existing = await collection.get<MemoryMetadata>({
      ids,
      include: ["metadatas"],
    });

    if (!existing.ids.length) {
      return;
    }

    const now = Date.now();
    const updateIds: string[] = [];
    const updateMetadatas: MemoryMetadata[] = [];

    for (let idx = 0; idx < existing.ids.length; idx += 1) {
      const metadata = parseMemoryMetadata(existing.metadatas?.[idx]);
      if (!metadata) {
        continue;
      }

      updateIds.push(existing.ids[idx]);
      updateMetadatas.push({
        ...metadata,
        lastAccessAt: now,
      });
    }

    if (updateIds.length === 0) {
      return;
    }

    await collection.update({
      ids: updateIds,
      metadatas: updateMetadatas,
    });
  }
}

export const memoryRepository = new MemoryRepository();
