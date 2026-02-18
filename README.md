# 持久化记忆 Chatbot 技术规格（Next.js + LangGraph + SeekDB + 阿里云百炼）

## 1. 目标与范围

### 1.1 目标
- 构建一个支持**持久化记忆**的多轮对话 chatbot。
- 支持以下记忆能力：
  - **短期记忆**：同一会话内上下文连续（线程级）。
  - **长期记忆**：跨会话保存用户偏好、事实、任务进度（用户级）。
- 检索层使用 seekdb-js，支持：
  - 语义向量检索（`query`）
  - 混合检索（`hybridSearch`，RRF 融合）
- 编排层使用 LangGraph，实现可观察、可恢复、可扩展的多节点工作流。
- 生成模型使用阿里云百炼（DashScope/Qwen）。

### 1.2 非目标（当前版本）
- 暂不做复杂权限系统（仅基础多租户隔离）。
- 暂不做训练级别的个性化模型微调。
- 暂不做跨模态（图像/音频）记忆。

---

## 2. 总体架构

```text
Next.js Web UI
   -> /api/chat (streaming)
      -> LangGraph Runtime
         -> Node A: 输入处理/意图判断
         -> Node B: 记忆检索（SeekDB hybridSearch/query）
         -> Node C: 响应生成（百炼模型）
         -> Node D: 记忆抽取与写回（SeekDB upsert/update）
      -> 返回流式 tokens 到前端
```

### 关键分层
1. **应用层（Next.js）**：鉴权、会话管理、流式输出。
2. **编排层（LangGraph）**：状态机与节点流程，失败重试与分支控制。
3. **记忆层（SeekDB）**：
   - 长期记忆（用户画像、偏好、事实、任务）
   - 对话摘要（压缩存储，降低 token 成本）
4. **模型层（DashScope）**：Qwen 对话模型 + Qwen embedding（建议同生态）。

---

## 3. 记忆模型设计

### 3.1 Collection 规划
- `memory_entries`（主集合）
  - `document`: 记忆文本（可检索正文）
  - `metadata`: 结构化信息（过滤、排序、治理）

建议 metadata 字段：
- `tenantId`: string
- `userId`: string
- `threadId`: string（可空，长期记忆可无）
- `memoryType`: `"profile" | "preference" | "fact" | "task" | "summary"`
- `importance`: number（1-5）
- `createdAt`: number（unix ms）
- `lastAccessAt`: number（unix ms）
- `expiresAt`: number | null（可选 TTL）
- `sourceMessageId`: string
- `version`: number
- `tags`: string[]

### 3.2 记忆粒度
- **原子记忆**：单条事实、偏好、约束（便于更新和删除）。
- **摘要记忆**：每 N 轮生成会话摘要（降低上下文长度）。
- **任务记忆**：用户明确目标与待办（利于持续执行型对话）。

---

## 4. 检索策略（SeekDB）

优先用混合检索（关键词 + 向量）：
- 关键词匹配处理显式实体（产品名、日期、术语）
- 向量检索处理语义相似（同义表达、上下文隐含意图）
- RRF 融合提升稳定性

### 4.1 推荐检索流程
1. 组装 query（当前用户输入 + 线程摘要）
2. `hybridSearch` 召回 topK（如 20）
3. 按 `tenantId/userId` 强过滤，防止串租户
4. 二次打分（可选）：加入 `importance` 与 `recency` 衰减
5. 截断为最终注入模型的 memory topN（如 6-10 条）

### 4.2 seekdb-js 示例（混合检索）

```ts
const results = await memoryCollection.hybridSearch({
  query: {
    whereDocument: { $contains: userQuery },
    where: {
      tenantId,
      userId,
      memoryType: { $in: ["profile", "preference", "fact", "task", "summary"] },
    },
    nResults: 30,
  },
  knn: {
    queryTexts: [userQuery],
    where: { tenantId, userId },
    nResults: 30,
  },
  rank: {
    rrf: {
      rankWindowSize: 100,
      rankConstant: 60,
    },
  },
  nResults: 10,
  include: ["documents", "metadatas"],
});
```

### 4.3 记忆写回（upsert）

```ts
await memoryCollection.upsert({
  ids: memoryId, // 建议使用稳定 ID，如 hash(userId + memoryKey)
  documents: normalizedMemoryText,
  metadatas: {
    tenantId,
    userId,
    threadId,
    memoryType: "preference",
    importance: 4,
    createdAt: Date.now(),
    lastAccessAt: Date.now(),
    sourceMessageId,
    version: 1,
    tags: ["language", "tone"],
  },
});
```

---

## 5. LangGraph 工作流设计

### 5.1 State 定义（示意）
```ts
type ChatState = {
  tenantId: string;
  userId: string;
  threadId: string;
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  retrievedMemories: Array<{ id: string; content: string; score?: number }>;
  memoryWriteCandidates: Array<{ key: string; content: string; type: string }>;
  response?: string;
};
```

### 5.2 节点建议
1. `classifyIntent`
   - 判断是否需要记忆检索（闲聊可低配检索）
2. `retrieveMemories`
   - 调用 SeekDB `hybridSearch/query`
3. `generateResponse`
   - 组装 prompt（系统指令 + 近期消息 + 记忆）
   - 调用百炼模型生成回复
4. `extractMemoryCandidates`
   - 从本轮 user/assistant 中提取“值得长期保存”的记忆
5. `persistMemories`
   - 去重后 `upsert/update`
6. `finalize`
   - 更新 `lastAccessAt`、打点日志

### 5.3 分支控制
- 低价值输入（如“嗯嗯”“收到”）可跳过写回。
- 高风险内容（PII/敏感信息）先脱敏再入库，必要时拒存。

---

## 6. 百炼模型接入建议

### 6.1 聊天模型
- 建议先使用 `qwen-plus` 或同等级通用模型（按成本/延迟调整）。
- 通过 OpenAI 兼容接口接入（便于 LangChain/LangGraph 统一调用）。

### 6.2 Embedding 模型
- 推荐使用 seekdb-js 的 `@seekdb/qwen`（`QwenEmbeddingFunction`）。
- 保持“生成模型与 embedding 模型同语言生态”，中文检索稳定性更高。

### 6.3 关键环境变量
- `DASHSCOPE_API_KEY`
- `SEEKDB_HOST`
- `SEEKDB_PORT`
- `SEEKDB_USER`
- `SEEKDB_PASSWORD`
- `SEEKDB_DATABASE`

---

## 7. Next.js 接口设计（最小可用）

### 7.1 `POST /api/chat`
请求：
```json
{
  "tenantId": "t1",
  "userId": "u1",
  "threadId": "th-001",
  "message": "我下周去上海出差，帮我记住我偏好高铁"
}
```

响应：
- SSE/流式文本（推荐）
- 附带 `traceId` 便于排障

### 7.2 可选接口
- `GET /api/memories?userId=...`：调试查看记忆
- `DELETE /api/memories/:id`：用户可控删除（合规要求）
- `POST /api/memories/compact`：手动触发摘要压缩

---

## 8. 记忆治理与合规

1. **多租户强隔离**：所有读写必须携带 `tenantId + userId` 过滤。
2. **可删除权**：用户可查看、删除、重建记忆。
3. **数据最小化**：只存“有用记忆”，不存整段原始对话。
4. **TTL 策略**：
   - `summary/task`：中长期保留
   - 低重要度 `fact`：到期自动清理
5. **敏感信息策略**：
   - 正则 + 模型双检测（身份证号/手机号/银行卡等）
   - 入库前脱敏或拒绝存储

---

## 9. 观测与评估

### 9.1 运行指标
- 平均响应时延（P50/P95）
- 记忆检索命中率（人工标注集）
- 记忆写回成功率
- token 成本（输入/输出）

### 9.2 质量指标
- 记忆正确引用率（是否用对了历史信息）
- 记忆污染率（错误信息被持久化）
- 跨轮任务完成率（多轮目标达成）

---

## 10. 迭代路线图

### Phase 1（MVP）
- 单租户、单语言（中文）
- `hybridSearch + upsert` 主链路跑通
- 基础记忆类型：`preference/fact/summary`

### Phase 2（增强）
- 加入记忆去重与冲突解决（旧偏好覆盖）
- 引入“重要度打分”与 recency 衰减
- 增加可视化调试页面（memory trace）

### Phase 3（生产化）
- 多租户 + 合规能力完善
- 灰度发布与 A/B（不同召回参数）
- 成本优化（分层模型与缓存）

---

## 11. 实施注意事项（结合 seekdb-js）

基于 seekdb-js 文档，以下接口是本项目的关键：
- collection 写入：`add / upsert / update`
- 召回：`query / hybridSearch`
- 管理：`get / delete / count / peek / describe`
- 过滤：`$eq/$in/$gte/$contains/$and/$or` 等

建议：
- 统一使用 `upsert` 处理“新增/更新”混合场景。
- 检索优先 `hybridSearch`，失败时回退 `query`。
- 用 metadata 做强约束过滤（tenantId/userId/memoryType）。

---

## 12. 待确认问题（上线前必须定）

1. 长期记忆的“冲突策略”：
   - 新偏好是否覆盖旧偏好？
   - 覆盖规则按时间还是按置信度？
2. 用户可见性：
   - 是否提供“你记住了什么”的 UI？
3. 保留周期：
   - 默认保留多久？是否支持用户自定义？
4. 低置信度记忆：
   - 是否进入待审核区而不是直接入库？

---

这份 spec 可以直接作为实现蓝图；下一步可按此拆分为：
1) 数据层模块（SeekDB Repository）  
2) LangGraph 节点模块  
3) Next.js API 与前端流式交互  
4) 观测与治理模块。