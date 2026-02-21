import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { getSeekdbClient, getMemoryCollection } from "@/lib/seekdb/client";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const config = {
    SEEKDB_HOST: env.SEEKDB_HOST,
    SEEKDB_PORT: env.SEEKDB_PORT,
    SEEKDB_USER: env.SEEKDB_USER,
    SEEKDB_PASSWORD: env.SEEKDB_PASSWORD ? "***" : "(empty)",
    SEEKDB_DATABASE: env.SEEKDB_DATABASE,
    hasConfig: Boolean(env.SEEKDB_HOST && env.SEEKDB_PORT && env.SEEKDB_USER && env.SEEKDB_DATABASE),
  };

  if (!config.hasConfig) {
    return NextResponse.json({
      status: "not-configured",
      config,
    }, { status: 400 });
  }

  try {
    const client = getSeekdbClient();
    
    // Step 1: Test basic connection by getting collection
    logger.info("seekdb-debug-start", { host: config.SEEKDB_HOST, port: config.SEEKDB_PORT });
    
    const collection = await getMemoryCollection();
    logger.info("seekdb-collection-ready", { name: collection.name });
    
    // Step 2: Get collection stats
    const count = await collection.count();
    logger.info("seekdb-count", { count });
    
    // Step 3: Test basic query
    let queryTest = "not tested";
    let queryResults = 0;
    let queryError = "";
    try {
      const testResult = await collection.query({
        queryTexts: ["test"],
        where: {},
        nResults: 5,
        include: ["documents", "metadatas"],
      });
      queryResults = testResult.ids?.[0]?.length || 0;
      queryTest = queryResults > 0 ? `success (${queryResults} results)` : "empty result";
    } catch (e) {
      queryError = e instanceof Error ? e.message : String(e);
      queryTest = `failed`;
      logger.warn("seekdb-query-failed", { error: queryError });
    }

    // Step 4: Test hybrid search
    let hybridTest = "not tested";
    let hybridResults = 0;
    let hybridError = "";
    try {
      const hybridResult = await collection.hybridSearch({
        query: {
          whereDocument: { $contains: "" },
          where: {},
          nResults: 5,
        },
        knn: {
          queryTexts: ["test"],
          where: {},
          nResults: 5,
        },
        rank: { rrf: {} },
        nResults: 5,
        include: ["documents", "metadatas"],
      });
      hybridResults = hybridResult.ids?.[0]?.length || 0;
      hybridTest = hybridResults > 0 ? `success (${hybridResults} results)` : "empty result";
    } catch (e) {
      hybridError = e instanceof Error ? e.message : String(e);
      hybridTest = `failed`;
      logger.warn("seekdb-hybrid-search-failed", { error: hybridError });
    }

    return NextResponse.json({
      status: "ok",
      config,
      collection: {
        name: collection.name,
        count,
      },
      tests: {
        basicQuery: { 
          result: queryTest, 
          count: queryResults,
          error: queryError || undefined,
        },
        hybridSearch: { 
          result: hybridTest, 
          count: hybridResults,
          error: hybridError || undefined,
        },
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("debug-seekdb-failed", {
      reason: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json({
      status: "error",
      config,
      error: errorMessage,
      timestamp: new Date().toISOString(),
    }, { status: 500 });
  }
}
