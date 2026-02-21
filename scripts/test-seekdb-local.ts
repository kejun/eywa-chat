/**
 * SeekDB 本地测试 - 测试 localhost 的 SeekDB
 * 
 * 用法：
 * 1. 确保本地有 SeekDB: docker run -d --name seekdb -p 2881:2881 oceanbase/seekdb:latest
 * 2. npx tsx scripts/test-seekdb-local.ts
 */

import { SeekdbClient } from "seekdb";

async function main() {
  console.log("=== SeekDB 本地测试 ===\n");
  
  const client = new SeekdbClient({
    host: "localhost",
    port: 2881,
    user: "admin",
    password: "",
    database: "chatbot_memory",
  });
  
  try {
    console.log("1. 连接并获取集合...");
    const collection = await client.getOrCreateCollection({
      name: "memory_entries",
    });
    console.log(`   ✅ 集合：${collection.name}`);
    
    console.log("\n2. 插入测试数据...");
    const testMemories = [
      {
        id: "test_001",
        content: "我的名字是张三",
        metadata: {
          tenantId: "test",
          userId: "user1",
          memoryType: "profile",
        },
      },
      {
        id: "test_002",
        content: "我喜欢吃川菜",
        metadata: {
          tenantId: "test",
          userId: "user1",
          memoryType: "preference",
        },
      },
      {
        id: "test_003",
        content: "我住在北京",
        metadata: {
          tenantId: "test",
          userId: "user1",
          memoryType: "profile",
        },
      },
    ];
    
    for (const mem of testMemories) {
      await collection.upsert({
        ids: [mem.id],
        documents: [mem.content],
        metadatas: [mem.metadata],
      });
    }
    console.log(`   ✅ 插入 ${testMemories.length} 条测试数据`);
    
    console.log("\n3. 统计...");
    const count = await collection.count();
    console.log(`   📊 总记录数：${count}`);
    
    console.log("\n4. 向量查询测试 ('名字')...");
    const queryResult = await collection.query({
      queryTexts: ["名字"],
      nResults: 5,
      include: ["documents", "metadatas", "distances"],
    });
    
    const queryCount = queryResult.ids?.[0]?.length || 0;
    console.log(`   返回 ${queryCount} 条结果`);
    
    if (queryCount > 0) {
      console.log("\n   匹配结果:");
      for (let i = 0; i < queryCount; i++) {
        const doc = queryResult.documents?.[0]?.[i];
        const dist = queryResult.distances?.[0]?.[i];
        const meta = queryResult.metadatas?.[0]?.[i];
        console.log(`   [${i + 1}] ${doc} (距离：${dist?.toFixed(4)}, 类型：${meta?.memoryType})`);
      }
    } else {
      console.log("   ⚠️ 无结果");
    }
    
    console.log("\n5. 混合搜索测试 ('喜欢')...");
    const hybridResult = await collection.hybridSearch({
      query: {
        whereDocument: { $contains: "" },
        nResults: 5,
      },
      knn: {
        queryTexts: ["喜欢"],
        nResults: 5,
      },
      rank: { rrf: {} },
      nResults: 5,
      include: ["documents", "metadatas"],
    });
    
    const hybridCount = hybridResult.ids?.[0]?.length || 0;
    console.log(`   返回 ${hybridCount} 条结果`);
    
    if (hybridCount > 0) {
      console.log("\n   匹配结果:");
      for (let i = 0; i < hybridCount; i++) {
        const doc = hybridResult.documents?.[0]?.[i];
        const meta = hybridResult.metadatas?.[0]?.[i];
        console.log(`   [${i + 1}] ${doc} (类型：${meta?.memoryType})`);
      }
    } else {
      console.log("   ⚠️ 无结果");
    }
    
    console.log("\n6. 带过滤查询 (tenant=test, userId=user1)...");
    const filteredResult = await collection.query({
      queryTexts: ["名字"],
      where: {
        tenantId: "test",
        userId: "user1",
      },
      nResults: 5,
      include: ["documents", "metadatas"],
    });
    
    const filteredCount = filteredResult.ids?.[0]?.length || 0;
    console.log(`   返回 ${filteredCount} 条结果`);
    
    if (filteredCount > 0) {
      console.log("\n   匹配结果:");
      for (let i = 0; i < filteredCount; i++) {
        const doc = filteredResult.documents?.[0]?.[i];
        console.log(`   [${i + 1}] ${doc}`);
      }
    }
    
    await client.close();
    console.log("\n✅ 测试完成");
    
  } catch (error) {
    console.error("\n❌ 测试失败:", error instanceof Error ? error.message : String(error));
    await client.close();
    process.exit(1);
  }
}

main().catch(console.error);
