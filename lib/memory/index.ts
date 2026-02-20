export * from "@/lib/memory/types";

import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { memoryRepository, MemoryRepository } from "@/lib/memory/repository";
import { inMemoryMemoryRepository, InMemoryMemoryRepository } from "@/lib/memory/in-memory-repository";

// Auto-detect: use in-memory repository if SeekDB is not configured
const hasSeekdbConfig = Boolean(
  env.SEEKDB_HOST &&
  env.SEEKDB_PORT &&
  env.SEEKDB_USER &&
  env.SEEKDB_PASSWORD &&
  env.SEEKDB_DATABASE
);

export const memoryRepositoryInstance: MemoryRepository | InMemoryMemoryRepository = hasSeekdbConfig
  ? memoryRepository
  : inMemoryMemoryRepository;

if (!hasSeekdbConfig) {
  logger.warn("using-in-memory-repository", {
    message: "SeekDB is not configured. Using in-memory repository for development/demo purposes.",
    hint: "Memory will not persist across server restarts. Configure SEEKDB_* environment variables for production use.",
  });
}

export { memoryRepository, MemoryRepository };
export { inMemoryMemoryRepository, InMemoryMemoryRepository };
