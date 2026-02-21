import { SeekdbClient, type Collection } from "seekdb";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

const MEMORY_COLLECTION_NAME = "memory_entries";

type GlobalSeekdbCache = typeof globalThis & {
  __seekdbClient?: SeekdbClient;
  __memoryCollectionPromise?: Promise<Collection>;
};

function createSeekdbClient() {
  if (!env.SEEKDB_HOST || !env.SEEKDB_PORT || !env.SEEKDB_USER || !env.SEEKDB_PASSWORD || !env.SEEKDB_DATABASE) {
    logger.warn("seekdb-not-configured", {
      message: "SeekDB is not configured. Memory persistence will be disabled.",
      hint: "Set SEEKDB_HOST, SEEKDB_PORT, SEEKDB_USER, SEEKDB_PASSWORD, and SEEKDB_DATABASE environment variables.",
    });
    throw new Error("SeekDB not configured");
  }

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
    const client = getSeekdbClient();
    globalCache.__memoryCollectionPromise = client.getOrCreateCollection({
      name: MEMORY_COLLECTION_NAME,
      metadata: {
        description: "Chatbot memory entries with vector embeddings",
      },
    }).then(async (collection) => {
      logger.info("seekdb-collection-ready", {
        name: MEMORY_COLLECTION_NAME,
      });
      return collection;
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
