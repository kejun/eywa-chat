/**
 * SeekDB 简单检索测试 - 直接连接，绕过 env 验证
 * 
 * 用法：npx tsx scripts/test-seekdb-simple.ts
 */

import { SeekdbClient } from "seekdb";

// 直接从 .env.local 读取（如果存在）
import * as dotenv from "dotenv";
import * as path from "path";

const envPath = path.resolve(process.cwd(), ".env.local");
console.log(`加载环境变量：${envPath}`);
dotenv.config({ path: envPath });

const SEEKDB_HOST = process.env.SEEKDB_HOST || "43.160.241.135";
const SEEKDB_PORT = parseInt(process.env.SEEKDB_PORT || "2881", 10);
const SEEKDB_USER = process.env.SEEKDB_USER || "admin";
const SEEKDB_PASSWORD = process.env.SEEKDB_PASSWORD || "";
const SEEKDB_DATABASE = process.env.SEEKDB_DATABASE || "chatbot_memory";

async function main() {
  console.log("=== SeekDB 检索测试 (简化版) ===\n");
  console.log(`连接：${SEEKDB_HOST}:${SEEKDB_PORT}/${SEEKDB_DATABASE}\n`);
  
  const client = new SeekdbClient({
    host: SEEKDB_HOST,
    port: SEEKDB_PORT,
    user: SEEKDB_USER,
    password: SEEKDB_PASSWORD,
    database: SEEKDB_DATABASE,
  });
  
  try {
    // 1. 获取集合
    console.log("1. 获取集合...");
    const collection = await client.getOrCreateCollection({
      name: "memory_entries",
    });
    console.log(`   ✅ 集合：${collection.name}`);
    
    // 2. 统计
    console.log("\n2. 数据统计...");
    const count = await collection.count();
    console.log(`   📊 总记录数：${count}`);
    
    // 3. 全量获取测试
    console.log("\n3. 全量获取前 10 条...");
    const allResult = await collection.get({
      include: ["documents", "metadatas"],
      limit: 10,
    });
    
    const resultCount = allResult.ids?.length || 0;
    console.log(`   ✅ 获取 ${resultCount} 条记录\n`);
    
    if (resultCount > 0) {
      console.log("记忆列表:");
      for (let i = 0; i < resultCount; i++) {
        const doc = allResult.documents?.[i];
        const meta = allResult.metadatas?.[i];
        console.log(`[${i + 1}] [${meta?.memoryType}] ${doc?.substring(0, 60)}...`);
        console.log(`    Tenant: ${meta?.tenantId}, User: ${meta?.userId}`);
      }
    }
    
    // 4. 向量查询测试
    console.log("\n4. 向量查询测试 (queryTexts: '名字')...");
    try {
      const queryResult = await collection.query({
        queryTexts: ["名字"],
        nResults: 5,
        include: ["documents", "metadatas", "distances"],
      });
      
      const queryCount = queryResult.ids?.[0]?.length || 0;
      console.log(`   ✅ 返回 ${queryCount} 条结果`);
      
      if (queryCount > 0) {
        console.log("\n   匹配结果:");
        for (let i = 0; i < Math.min(3, queryCount); i++) {
          const doc = queryResult.documents?.[0]?.[i];
          const dist = queryResult.distances?.[0]?.[i];
          console.log(`   [${i + 1}] ${doc?.substring(0, 50)}... (距离：${dist?.toFixed(4)})`);
        }
      } else {
        console.log("   ⚠️ 无结果 - 向量搜索可能未正常工作");
      }
    } catch (e) {
      console.log(`   ❌ 失败：${e instanceof Error ? e.message : String(e)}`);
    }
    
    // 5. 混合搜索测试
    console.log("\n5. 混合搜索测试 (hybridSearch)...");
    try {
      const hybridResult = await collection.hybridSearch({
        query: {
          whereDocument: { $contains: "" },
          nResults: 5,
        },
        knn: {
          queryTexts: ["名字"],
          nResults: 5,
        },
        rank: { rrf: {} },
        nResults: 5,
        include: ["documents", "metadatas"],
      });
      
      const hybridCount = hybridResult.ids?.[0]?.length || 0;
      console.log(`   ✅ 返回 ${hybridCount} 条结果`);
      
      if (hybridCount > 0) {
        console.log("\n   匹配结果:");
        for (let i = 0; i < Math.min(3, hybridCount); i++) {
          const doc = hybridResult.documents?.[0]?.[i];
          console.log(`   [${i + 1}] ${doc?.substring(0, 50)}...`);
        }
      } else {
        console.log("   ⚠️ 无结果 - 混合搜索可能未正常工作");
      }
    } catch (e) {
      console.log(`   ❌ 失败：${e instanceof Error ? e.message : String(e)}`);
    }
    
    // 6. 带过滤的查询
    console.log("\n6. 带用户过滤的查询...");
    try {
      const filteredResult = await collection.query({
        queryTexts: ["名字"],
        where: {
          tenantId: "test-mem2",
          userId: "user-mem2",
        },
        nResults: 5,
        include: ["documents", "metadatas"],
      });
      
      const filteredCount = filteredResult.ids?.[0]?.length || 0;
      console.log(`   ✅ (test-mem2/user-mem2) 返回 ${filteredCount} 条结果`);
      
      if (filteredCount > 0) {
        console.log("\n   结果:");
        for (let i = 0; i < filteredCount; i++) {
          const doc = filteredResult.documents?.[0]?.[i];
          console.log(`   - ${doc}`);
        }
      }
    } catch (e) {
      console.log(`   ❌ 失败：${e instanceof Error ? e.message : String(e)}`);
    }
    
    await client.close();
    console.log("\n=== 测试完成 ===");
    
  } catch (error) {
    console.error("\n❌ 测试失败:", error instanceof Error ? error.message : String(error));
    await client.close();
    process.exit(1);
  }
}

main().catch(console.error);
