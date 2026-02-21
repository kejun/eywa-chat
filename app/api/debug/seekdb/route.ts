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
    SEEKDB_PASSWORD: env.SEEKDB_PASSWORD ? "***" : undefined,
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
    const collection = await getMemoryCollection();
    
    // Get collection stats
    const count = await collection.count();
    
    // Test basic query with actual data
    let queryTest = "not tested";
    let queryResults = 0;
    try {
      const testResult = await collection.query({
        queryTexts: ["记忆"],
        where: {},
        nResults: 5,
        include: ["documents", "metadatas"],
      });
      queryResults = testResult.ids?.[0]?.length || 0;
      queryTest = queryResults > 0 ? `success (${queryResults} results)` : "empty result";
    } catch (e) {
      queryTest = `failed: ${e instanceof Error ? e.message : String(e)}`;
    }

    // Test hybrid search
    let hybridTest = "not tested";
    let hybridResults = 0;
    try {
      const hybridResult = await collection.hybridSearch({
        query: {
          whereDocument: { $contains: "" },
          where: {},
          nResults: 5,
        },
        knn: {
          queryTexts: ["记忆"],
          where: {},
          nResults: 5,
        },
        rank: { rrf: {} },
        nResults: 5,
        include: ["documents", "metadatas", "distances"],
      });
      hybridResults = hybridResult.ids?.[0]?.length || 0;
      hybridTest = hybridResults > 0 ? `success (${hybridResults} results)` : "empty result";
    } catch (e) {
      hybridTest = `failed: ${e instanceof Error ? e.message : String(e)}`;
    }

    return NextResponse.json({
      status: "ok",
      config,
      collection: {
        name: collection.name,
        count,
      },
      tests: {
        basicQuery: { result: queryTest, count: queryResults },
        hybridSearch: { result: hybridTest, count: hybridResults },
      },
    });
  } catch (error) {
    logger.error("debug-seekdb-failed", {
      reason: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({
      status: "error",
      config,
      error: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}
