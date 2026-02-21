/**
 * SeekDB 检索测试脚本
 * 
 * 用法：npx tsx scripts/test-seekdb-retrieval.ts
 */

import { getSeekdbClient, getMemoryCollection } from "../lib/seekdb/client";
import { env } from "../lib/env";

async function main() {
  console.log("=== SeekDB 检索测试 ===\n");
  
  // 1. 检查配置
  console.log("1. 环境配置:");
  console.log(`   SEEKDB_HOST: ${env.SEEKDB_HOST || "❌ 未设置"}`);
  console.log(`   SEEKDB_PORT: ${env.SEEKDB_PORT || "❌ 未设置"}`);
  console.log(`   SEEKDB_USER: ${env.SEEKDB_USER || "❌ 未设置"}`);
  console.log(`   SEEKDB_DATABASE: ${env.SEEKDB_DATABASE || "❌ 未设置"}`);
  console.log(`   SEEKDB_PASSWORD: ${env.SEEKDB_PASSWORD ? "***" : "(空密码)"}`);
  console.log();

  try {
    // 2. 连接测试
    console.log("2. 连接测试...");
    const client = getSeekdbClient();
    console.log("   ✅ SeekDB 客户端创建成功");
    
    // 3. 获取集合
    console.log("\n3. 获取集合...");
    const collection = await getMemoryCollection();
    console.log(`   ✅ 集合名称：${collection.name}`);
    
    // 4. 统计数据
    console.log("\n4. 数据统计...");
    const count = await collection.count();
    console.log(`   📊 总记录数：${count}`);
    console.log();
    
    // 5. 测试纯文本查询（不依赖向量）
    console.log("5. 测试纯文本查询 (queryTexts)...");
    try {
      const queryResult = await collection.query({
        queryTexts: ["名字"],
        nResults: 5,
        include: ["documents", "metadatas", "distances"],
      });
      
      const resultCount = queryResult.ids?.[0]?.length || 0;
      console.log(`   ✅ 查询成功，返回 ${resultCount} 条结果`);
      
      if (resultCount > 0) {
        console.log("\n   前 3 条结果:");
        for (let i = 0; i < Math.min(3, resultCount); i++) {
          const doc = queryResult.documents?.[0]?.[i];
          const meta = queryResult.metadatas?.[0]?.[i];
          const dist = queryResult.distances?.[0]?.[i];
          console.log(`   [${i + 1}] ${doc?.substring(0, 50)}...`);
          console.log(`       类型：${meta?.memoryType}, 距离：${dist?.toFixed(4)}`);
        }
      } else {
        console.log("   ⚠️ 无结果返回");
      }
    } catch (e) {
      console.log(`   ❌ 查询失败：${e instanceof Error ? e.message : String(e)}`);
    }
    console.log();
    
    // 6. 测试混合搜索
    console.log("6. 测试混合搜索 (hybridSearch)...");
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
        include: ["documents", "metadatas", "distances"],
      });
      
      const resultCount = hybridResult.ids?.[0]?.length || 0;
      console.log(`   ✅ 混合搜索成功，返回 ${resultCount} 条结果`);
      
      if (resultCount > 0) {
        console.log("\n   前 3 条结果:");
        for (let i = 0; i < Math.min(3, resultCount); i++) {
          const doc = hybridResult.documents?.[0]?.[i];
          const meta = hybridResult.metadatas?.[0]?.[i];
          console.log(`   [${i + 1}] ${doc?.substring(0, 50)}...`);
          console.log(`       类型：${meta?.memoryType}`);
        }
      } else {
        console.log("   ⚠️ 无结果返回");
      }
    } catch (e) {
      console.log(`   ❌ 混合搜索失败：${e instanceof Error ? e.message : String(e)}`);
    }
    console.log();
    
    // 7. 测试 get 全部数据
    console.log("7. 测试全量获取 (get)...");
    try {
      const allResult = await collection.get({
        include: ["documents", "metadatas"],
        limit: 10,
      });
      
      const resultCount = allResult.ids?.length || 0;
      console.log(`   ✅ 获取成功，返回 ${resultCount} 条记录`);
      
      if (resultCount > 0) {
        console.log("\n   最新 5 条记忆:");
        for (let i = 0; i < Math.min(5, resultCount); i++) {
          const doc = allResult.documents?.[i];
          const meta = allResult.metadatas?.[i];
          console.log(`   [${i + 1}] [${meta?.memoryType}] ${doc?.substring(0, 40)}...`);
          console.log(`       Tenant: ${meta?.tenantId}, User: ${meta?.userId}`);
        }
      }
    } catch (e) {
      console.log(`   ❌ 获取失败：${e instanceof Error ? e.message : String(e)}`);
    }
    console.log();
    
    // 8. 测试带过滤的查询
    console.log("8. 测试带用户过滤的查询...");
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
      
      const resultCount = filteredResult.ids?.[0]?.length || 0;
      console.log(`   ✅ 过滤查询成功 (test-mem2/user-mem2)，返回 ${resultCount} 条结果`);
      
      if (resultCount > 0) {
        console.log("\n   结果:");
        for (let i = 0; i < resultCount; i++) {
          const doc = filteredResult.documents?.[0]?.[i];
          console.log(`   - ${doc}`);
        }
      }
    } catch (e) {
      console.log(`   ❌ 过滤查询失败：${e instanceof Error ? e.message : String(e)}`);
    }
    
  } catch (error) {
    console.error("\n❌ 测试失败:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
  
  console.log("\n=== 测试完成 ===");
}

main().catch(console.error);
