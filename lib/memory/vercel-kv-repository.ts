import { kv } from '@vercel/kv';
import { logger } from '@/lib/logger';
import type { MemoryEntry, MemoryMetadata, RetrieveMemoryInput, UpsertMemoryInput } from '@/lib/memory/types';
import { buildMemoryId, buildMemoryKey, MemoryMetadataSchema } from '@/lib/memory/types';

const MEMORY_PREFIX = 'memory:';
const METADATA_PREFIX = 'memory:meta:';

export class VercelKVMemoryRepository {
  /**
   * 向量相似度检索（简化版 - 基于关键词匹配）
   * Vercel KV 不支持向量搜索，这里用关键词匹配降级
   */
  async retrieveMemories(input: RetrieveMemoryInput): Promise<MemoryEntry[]> {
    const queryText = input.queryText.toLowerCase().trim();
    if (!queryText) {
      return [];
    }

    try {
      // 获取所有该用户的记忆键
      const pattern = `${MEMORY_PREFIX}${input.tenantId}:${input.userId}:*`;
      const keys = await kv.keys(pattern);
      
      if (!keys || keys.length === 0) {
        return [];
      }

      // 批量读取
      const entries: MemoryEntry[] = [];
      for (const key of keys) {
        const content = await kv.get<string>(key);
        const metadata = await kv.get<MemoryMetadata>(`${METADATA_PREFIX}${key}`);
        
        if (!content || !metadata) {
          continue;
        }

        // 简单的关键词匹配
        if (content.toLowerCase().includes(queryText)) {
          entries.push({
            id: metadata.memoryKey,
            content,
            metadata,
          });
        }
      }

      // 按重要性和相关性排序
      entries.sort((a, b) => {
        const scoreA = (a.metadata.importance ?? 3) + (a.content.toLowerCase().includes(queryText) ? 1 : 0);
        const scoreB = (b.metadata.importance ?? 3) + (b.content.toLowerCase().includes(queryText) ? 1 : 0);
        return scoreB - scoreA;
      });

      return entries.slice(0, input.nResults ?? 8);
    } catch (error) {
      logger.error('kv-retrieve-memories-failed', {
        tenantId: input.tenantId,
        userId: input.userId,
        reason: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * 保存记忆
   */
  async upsertMemories(inputs: UpsertMemoryInput[]): Promise<Array<{ id: string; memoryKey: string; version: number }>> {
    if (inputs.length === 0) {
      return [];
    }

    const now = Date.now();
    const result: Array<{ id: string; memoryKey: string; version: number }> = [];

    try {
      const pipeline = kv.pipeline();
      
      for (const input of inputs) {
        const memoryKey = buildMemoryKey({
          tenantId: input.tenantId,
          userId: input.userId,
          memoryType: input.memoryType,
          key: input.key,
        });

        const id = buildMemoryId(memoryKey);
        const metadataKey = `${METADATA_PREFIX}${id}`;
        const contentKey = `${MEMORY_PREFIX}${id}`;

        // 获取现有版本
        const existingMeta = await kv.get<MemoryMetadata>(metadataKey);
        const version = existingMeta ? existingMeta.version + 1 : 1;

        const metadata: MemoryMetadata = {
          tenantId: input.tenantId,
          userId: input.userId,
          threadId: input.threadId,
          memoryType: input.memoryType,
          memoryKey,
          importance: input.importance ?? 3,
          createdAt: existingMeta?.createdAt ?? now,
          lastAccessAt: now,
          expiresAt: input.expiresAt ?? null,
          sourceMessageId: input.sourceMessageId ?? 'system',
          version,
          tags: input.tags ?? [],
          sourceType: input.sourceType,
          sourceName: input.sourceName,
          confidence: input.confidence,
          actionTraceId: input.actionTraceId,
        };

        // 添加到管道
        pipeline.set(contentKey, input.content);
        pipeline.set(metadataKey, metadata);

        // 如果有过期时间，设置 TTL
        if (input.expiresAt) {
          const ttlSeconds = Math.floor((input.expiresAt - now) / 1000);
          if (ttlSeconds > 0) {
            pipeline.expire(contentKey, ttlSeconds);
            pipeline.expire(metadataKey, ttlSeconds);
          }
        }

        result.push({ id, memoryKey, version });

        logger.info('memory-upserted-kv', {
          id,
          memoryKey,
          version,
          contentLength: input.content.length,
        });
      }

      await pipeline.exec();
      return result;
    } catch (error) {
      logger.error('kv-upsert-memories-failed', {
        reason: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * 列出记忆
   */
  async listMemories(input: { 
    tenantId: string; 
    userId: string; 
    memoryType?: string; 
    limit?: number; 
    offset?: number 
  }): Promise<MemoryEntry[]> {
    try {
      const pattern = `${MEMORY_PREFIX}${input.tenantId}:${input.userId}:*`;
      const keys = await kv.keys(pattern);
      
      if (!keys || keys.length === 0) {
        return [];
      }

      const entries: MemoryEntry[] = [];
      for (const key of keys) {
        const content = await kv.get<string>(key);
        const metadata = await kv.get<MemoryMetadata>(`${METADATA_PREFIX}${key}`);
        
        if (!content || !metadata) {
          continue;
        }

        if (input.memoryType && metadata.memoryType !== input.memoryType) {
          continue;
        }

        entries.push({
          id: metadata.memoryKey,
          content,
          metadata,
        });
      }

      const offset = input.offset ?? 0;
      const limit = input.limit ?? 20;
      return entries.slice(offset, offset + limit);
    } catch (error) {
      logger.error('kv-list-memories-failed', {
        reason: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * 删除记忆
   */
  async deleteMemories(input: { 
    tenantId: string; 
    userId: string; 
    ids?: string[]; 
    memoryKey?: string 
  }): Promise<void> {
    try {
      const pipeline = kv.pipeline();

      if (input.ids) {
        for (const id of input.ids) {
          pipeline.del(`${MEMORY_PREFIX}${id}`);
          pipeline.del(`${METADATA_PREFIX}${id}`);
        }
      }

      if (input.memoryKey) {
        const id = buildMemoryId(input.memoryKey);
        pipeline.del(`${MEMORY_PREFIX}${id}`);
        pipeline.del(`${METADATA_PREFIX}${id}`);
      }

      await pipeline.exec();
    } catch (error) {
      logger.error('kv-delete-memories-failed', {
        reason: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * 清除所有记忆（开发用）
   */
  async clear(): Promise<void> {
    logger.warn('kv-clear-all-memories', {
      message: 'Clearing all memories from Vercel KV',
    });
    // 注意：Vercel KV 不支持批量删除 pattern，需要手动实现
  }

  /**
   * 计数
   */
  async count(): Promise<number> {
    try {
      const pattern = `${MEMORY_PREFIX}*`;
      const keys = await kv.keys(pattern);
      return keys ? keys.length : 0;
    } catch (error) {
      logger.error('kv-count-memories-failed', {
        reason: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  async countAllMemories(): Promise<number> {
    return this.count();
  }

  async deleteExpiredMemories(scope?: { tenantId?: string; userId?: string }): Promise<void> {
    try {
      const pattern = `${MEMORY_PREFIX}*`;
      const keys = await kv.keys(pattern);
      if (!keys || keys.length === 0) {
        return;
      }

      const now = Date.now();
      for (const key of keys) {
        const entry = await kv.get<{ metadata?: { expiresAt?: number; tenantId?: string; userId?: string } }>(key);
        if (!entry?.metadata?.expiresAt || entry.metadata.expiresAt > now) {
          continue;
        }
        if (scope?.tenantId && entry.metadata.tenantId !== scope.tenantId) {
          continue;
        }
        if (scope?.userId && entry.metadata.userId !== scope.userId) {
          continue;
        }
        await kv.del(key);
      }
    } catch (error) {
      logger.error('kv-delete-expired-memories-failed', {
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export const vercelKVMemoryRepository = new VercelKVMemoryRepository();
