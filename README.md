# 持久化记忆 Chatbot 技术规格（Next.js + LangGraph + SeekDB + 阿里云百炼）

## 1. 目标与范围

### 1.1 目标
- 构建一个支持**持久化记忆**的多轮对话 chatbot。
- 支持以下记忆能力：
  - **短期记忆**：同一会话内上下文连续（线程级）。
  - **长期记忆**：跨会话保存用户偏好、事实、任务进度（用户级）。
- 支持**MCP 工具调用**与**Skills 能力编排**（用于外部系统操作和复杂任务复用）。
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
- `DASHSCOPE_MODEL`
- `DASHSCOPE_BASE_URL`
- `SEEKDB_HOST`
- `SEEKDB_PORT`
- `SEEKDB_USER`
- `SEEKDB_PASSWORD`
- `SEEKDB_DATABASE`
- `AUTH_JWT_SECRET`
- `AUTH_TENANT_CLAIM`
- `AUTH_USER_CLAIM`
- `ALLOW_INSECURE_CONTEXT`（仅本地调试可设为 `1`）

---

## 7. Next.js 接口设计（最小可用）

### 7.1 `POST /api/chat`
请求头（客户端需携带 JWT，服务端中间件会校验并注入身份头）：
```text
Authorization: Bearer <jwt-token>
```

中间件注入（内部）：
```text
x-tenant-id: <from-jwt-claim>
x-user-id: <from-jwt-claim>
```

请求：
```json
{
  "threadId": "th-001",
  "message": "我下周去上海出差，帮我记住我偏好高铁"
}
```

响应：
- SSE/流式文本（推荐）
- 附带 `traceId` 便于排障

### 7.2 可选接口
- `GET /api/memories`：查看当前身份下记忆（身份来自 JWT）
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

## 13. Vercel 部署补充（新增）

后续部署在 Vercel 时，建议在设计阶段就做以下约束：

### 13.1 运行时选择
- `api/chat` 与所有需要访问 SeekDB 的接口，统一使用 **Node.js Runtime**。
- 不建议放在 Edge Runtime（数据库驱动与 TCP 连接能力受限，且调试复杂度更高）。

Next.js Route Handler 示例：
```ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
```

### 13.2 SeekDB 连接管理（Serverless 关键点）
- Serverless 场景下函数实例会频繁冷启动，避免“每次请求都新建连接”。
- 使用 `globalThis` 缓存 `SeekdbClient`（warm 实例复用连接）。
- 为连接失败增加重试与超时控制，避免请求堆积。
- 设置合理并发上限，防止短时流量导致连接风暴。

### 13.3 网络与区域
- Vercel region 尽量靠近 SeekDB 与百炼服务部署区域，降低 RTT。
- 若 SeekDB 仅内网可访问，需要提前设计网络方案：
  - 方案 A：开放公网入口 + 白名单 + TLS；
  - 方案 B：在同 VPC 部署中间层服务，对 Vercel 暴露 HTTPS API（推荐更易控）。

### 13.4 环境变量与密钥
- 在 Vercel Project Settings 中配置：
  - `DASHSCOPE_API_KEY`
  - `DASHSCOPE_MODEL`
  - `DASHSCOPE_BASE_URL`
  - `SEEKDB_HOST`
  - `SEEKDB_PORT`
  - `SEEKDB_USER`
  - `SEEKDB_PASSWORD`
  - `SEEKDB_DATABASE`
  - `AUTH_JWT_SECRET`
  - `AUTH_TENANT_CLAIM`
  - `AUTH_USER_CLAIM`
  - `ALLOW_INSECURE_CONTEXT`（生产环境必须为 `0`）
- 区分 `Preview` / `Production` 两套变量，避免测试数据污染生产记忆。

### 13.5 流式响应与超时
- `POST /api/chat` 采用流式输出（SSE 或 Web Streams）。
- 长链路节点（检索+生成+写回）要设置超时与降级：
  - 检索失败：回退无记忆回答；
  - 写回失败：不影响当次回复，异步补偿。

### 13.6 定时任务（可选）
- 用 Vercel Cron 执行离线任务：
  - 记忆摘要压缩
  - 过期记忆清理（TTL）
  - 低质量记忆回收

---

## 14. MCP 与 Skills 支持（新增）

> 说明：系统实现不依赖 context7；外部能力扩展统一通过 MCP 与 Skills 机制完成。

### 14.1 设计目标
- **MCP（Model Context Protocol）**：统一接入外部工具与资源（如工单、日历、CRM、内部知识接口）。
- **Skills**：将“可复用任务流程”封装为高层能力（如“创建出差计划”“汇总周报”“生成采购清单”）。
- 让模型从“只会回答”升级为“可执行任务 + 可持续记忆”的 agent。

### 14.2 架构落点
```text
User Message
   -> LangGraph Planner
      -> Skill Router (是否命中某个 Skill)
         -> Skill Executor (多步逻辑)
      -> MCP Router (选择 MCP server/tool)
         -> MCP Tool Call
      -> Memory Writer (写回执行结果/用户偏好)
```

### 14.3 LangGraph 节点扩展建议
在现有节点基础上新增：
1. `planActions`
   - 判断本轮是“直接回答”还是“调用 Skill/MCP”。
2. `routeSkill`
   - 依据意图与参数完整度选择 Skill。
3. `executeSkill`
   - 执行结构化任务（可内部调用多个 MCP 工具）。
4. `routeMcpTool`
   - 选择具体 MCP server 与 tool。
5. `executeMcpTool`
   - 执行工具调用并返回结果。
6. `validateToolResult`
   - 校验输出结构、必要字段、业务约束。
7. `persistActionMemory`
   - 将关键执行结果写入长期记忆（便于后续追问）。

### 14.4 Skills 规范（建议）
每个 Skill 建议采用统一描述：
- `name`: 技能名（唯一）
- `description`: 适用场景
- `inputSchema`: 入参 JSON Schema
- `steps`: 执行步骤（可包含 MCP 调用）
- `outputSchema`: 输出 JSON Schema
- `onFailure`: 失败回退策略

示例：
```ts
type SkillDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (ctx: SkillContext) => Promise<SkillResult>;
};
```

### 14.5 MCP 调用治理
- **白名单机制**：仅允许调用注册过的 server/tool。
- **参数校验**：调用前做 schema 校验，避免危险输入。
- **超时与重试**：单次调用超时（如 8-15s），幂等工具可重试。
- **审计日志**：记录 `toolName/args/resultSummary/traceId`。
- **最小权限**：按租户/用户下发工具权限，不做全量开放。

### 14.6 与记忆系统的结合
Skill/MCP 执行后不应全量落库，建议仅沉淀“高价值结果”：
- 用户稳定偏好（例：默认高铁、偏好英文邮件）
- 持续任务状态（例：报销流程进行到审批节点）
- 外部系统关键事实（例：订单号、预约时间）

推荐 metadata 增补：
- `sourceType`: `"chat" | "mcp" | "skill"`
- `sourceName`: MCP tool 名或 Skill 名
- `confidence`: number（0-1）
- `actionTraceId`: string

### 14.7 Vercel 上的实现提醒（MCP/Skills）
- MCP/Skills 执行链路放在 Node.js Runtime。
- 技能注册表（Skill Registry）建议以代码静态注册 + 配置开关。
- 外部调用较慢时可拆成“同步回复 + 异步补偿”（防止函数超时）。

---

这份 spec 可以直接作为实现蓝图；并已兼容 Vercel + MCP + Skills 约束。下一步可按此拆分为：
1) 数据层模块（SeekDB Repository）  
2) LangGraph 节点模块（含 MCP/Skills 路由）  
3) Next.js API 与前端流式交互  
4) Skill Registry + MCP Adapter 模块  
5) 观测与治理模块。

---

## 15. 执行计划（落地文档）

详细的里程碑、Issue 清单、验收标准见：

- `docs/IMPLEMENTATION_PLAN.md`

---

## 16. 上线运行手册

Vercel 发布、Cron、观测与回滚说明见：

- `docs/DEPLOYMENT_RUNBOOK.md`
- `docs/PERF_REPORT_TEMPLATE.md`
- `docs/ISSUE_PROGRESS.md`
- `docs/LOADTEST_EXECUTION_CHECKLIST.md`

常用辅助命令：

- `npm run auth:jwt:generate -- --tenant-id t1 --user-id u1`
- `npm run loadtest:chat:report -- --url <endpoint> --jwt-token <token>`
- `npm run loadtest:chat:report:autojwt -- --url <endpoint> --tenant-id t1 --user-id u1`
- `npm run loadtest:scenarios -- --url <endpoint> --tenant-id t1 --user-id u1`
- `npm run issue26:prepare -- --report-dir ./artifacts/loadtest-scenarios`
- `npm run issue26:finalize -- --report-dir ./artifacts/loadtest-scenarios`