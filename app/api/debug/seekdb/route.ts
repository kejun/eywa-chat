import { NextResponse } from "next/server";
import { getMemoryCollection } from "@/lib/seekdb/client";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const collection = await getMemoryCollection();
    
    // Get collection stats
    const count = await collection.count();
    
    // Test basic query
    let queryTest = "not tested";
    try {
      const testResult = await collection.query({
        queryTexts: ["test"],
        nResults: 1,
      });
      queryTest = testResult.ids.length > 0 ? "success" : "empty result";
    } catch (e) {
      queryTest = `failed: ${e instanceof Error ? e.message : String(e)}`;
    }

    // Test hybrid search
    let hybridTest = "not tested";
    try {
      const hybridResult = await collection.hybridSearch({
        query: {
          whereDocument: { $contains: "test" },
          nResults: 1,
        },
        knn: {
          queryTexts: ["test"],
          nResults: 1,
        },
        rank: { rrf: {} },
        nResults: 1,
      });
      hybridTest = hybridResult.ids.length > 0 ? "success" : "empty result";
    } catch (e) {
      hybridTest = `failed: ${e instanceof Error ? e.message : String(e)}`;
    }

    return NextResponse.json({
      status: "ok",
      collection: {
        name: collection.name,
        count,
      },
      tests: {
        basicQuery: queryTest,
        hybridSearch: hybridTest,
      },
    });
  } catch (error) {
    logger.error("debug-seekdb-failed", {
      reason: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}
