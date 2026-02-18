import { SeekdbClient, type Collection } from "seekdb";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

const MEMORY_COLLECTION_NAME = "memory_entries";

type GlobalSeekdbCache = typeof globalThis & {
  __seekdbClient?: SeekdbClient;
  __memoryCollectionPromise?: Promise<Collection>;
};

function createSeekdbClient() {
  return new SeekdbClient({
    host: env.SEEKDB_HOST,
    port: env.SEEKDB_PORT,
    user: env.SEEKDB_USER,
    password: env.SEEKDB_PASSWORD,
    database: env.SEEKDB_DATABASE,
  });
}

export function getSeekdbClient(): SeekdbClient {
  const globalCache = globalThis as GlobalSeekdbCache;

  if (!globalCache.__seekdbClient) {
    globalCache.__seekdbClient = createSeekdbClient();
    logger.info("seekdb-client-created", {
      host: env.SEEKDB_HOST,
      port: env.SEEKDB_PORT,
      database: env.SEEKDB_DATABASE,
    });
  }

  return globalCache.__seekdbClient;
}

export async function getMemoryCollection(): Promise<Collection> {
  const globalCache = globalThis as GlobalSeekdbCache;

  if (!globalCache.__memoryCollectionPromise) {
    globalCache.__memoryCollectionPromise = getSeekdbClient().getOrCreateCollection({
      name: MEMORY_COLLECTION_NAME,
    });
  }

  return globalCache.__memoryCollectionPromise;
}

export async function closeSeekdbClient(): Promise<void> {
  const globalCache = globalThis as GlobalSeekdbCache;
  if (globalCache.__seekdbClient) {
    await globalCache.__seekdbClient.close();
    delete globalCache.__seekdbClient;
    delete globalCache.__memoryCollectionPromise;
  }
}
