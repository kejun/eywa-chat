import { SeekdbClient, type Collection } from "seekdb";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

const MEMORY_COLLECTION_NAME = "memory_entries";

type GlobalSeekdbCache = typeof globalThis & {
  __seekdbClient?: SeekdbClient;
  __memoryCollectionPromise?: Promise<Collection>;
};

function createSeekdbClient() {
  // SEEKDB_PASSWORD can be empty for auth-less setups
  const { SEEKDB_HOST, SEEKDB_PORT, SEEKDB_USER, SEEKDB_PASSWORD, SEEKDB_DATABASE } = env;
  
  if (!SEEKDB_HOST || !SEEKDB_PORT || SEEKDB_USER === undefined || !SEEKDB_DATABASE) {
    logger.warn("seekdb-not-configured", {
      message: "SeekDB is not configured. Memory persistence will be disabled.",
      hint: "Set SEEKDB_HOST, SEEKDB_PORT, SEEKDB_USER, and SEEKDB_DATABASE environment variables.",
    });
    throw new Error("SeekDB not configured");
  }

  return new SeekdbClient({
    host: SEEKDB_HOST,
    port: SEEKDB_PORT,
    user: SEEKDB_USER,
    password: SEEKDB_PASSWORD || "",
    database: SEEKDB_DATABASE,
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
