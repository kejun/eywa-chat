export * from "@/lib/memory/types";

import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { memoryRepository, MemoryRepository } from "@/lib/memory/repository";
import { inMemoryMemoryRepository, InMemoryMemoryRepository } from "@/lib/memory/in-memory-repository";
import { vercelKVMemoryRepository, VercelKVMemoryRepository } from "@/lib/memory/vercel-kv-repository";

// Auto-detect storage backend priority:
// 1. Vercel KV (if VERCEL_KV_URL is set) - Best for Vercel deployment
// 2. SeekDB (if SEEKDB_* are set) - Best for self-hosted
// 3. In-Memory (fallback) - Development only

const hasVercelKV = Boolean(process.env.VERCEL_KV_URL || process.env.KV_REST_API_URL);
const hasSeekdbConfig = Boolean(
  env.SEEKDB_HOST &&
  env.SEEKDB_PORT &&
  env.SEEKDB_USER !== undefined &&
  env.SEEKDB_DATABASE
);
// Note: SEEKDB_PASSWORD can be empty string for auth-less setups

let selectedBackend: 'vercel-kv' | 'seekdb' | 'in-memory';
let repositoryInstance: MemoryRepository | InMemoryMemoryRepository | VercelKVMemoryRepository;

if (hasVercelKV) {
  selectedBackend = 'vercel-kv';
  repositoryInstance = vercelKVMemoryRepository;
  logger.info('memory-backend-selected', {
    backend: 'vercel-kv',
    reason: 'VERCEL_KV_URL or KV_REST_API_URL is configured',
  });
} else if (hasSeekdbConfig) {
  selectedBackend = 'seekdb';
  repositoryInstance = memoryRepository;
  logger.info('memory-backend-selected', {
    backend: 'seekdb',
    host: env.SEEKDB_HOST,
  });
} else {
  selectedBackend = 'in-memory';
  repositoryInstance = inMemoryMemoryRepository;
  logger.warn('memory-backend-selected', {
    backend: 'in-memory',
    reason: 'No persistent storage configured',
    hint: 'Configure VERCEL_KV_URL for Vercel deployment or SEEKDB_* for self-hosted',
  });
}

export const memoryRepositoryInstance = repositoryInstance;
export { memoryRepository, MemoryRepository };
export { inMemoryMemoryRepository, InMemoryMemoryRepository };
export { vercelKVMemoryRepository, VercelKVMemoryRepository };
export type MemoryBackend = typeof selectedBackend;
export const currentMemoryBackend = selectedBackend;
