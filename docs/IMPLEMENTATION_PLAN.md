# 持久化记忆 Chatbot 执行计划（Vercel + MCP + Skills）

## 1. 目标

在 3 周内完成一个可上线的 MVP，满足：
- 持久化记忆（短期 + 长期）
- 混合检索（SeekDB）
- LangGraph 编排
- 阿里云百炼模型
- MCP 与 Skills 扩展
- 可部署到 Vercel（Preview + Production）

---

## 2. 执行原则

1. **先可运行，再做增强**：先拿到端到端主链路，再迭代质量能力。
2. **先冻结策略，再写代码**：冲突覆盖、TTL、低置信度等规则必须先定。
3. **失败不阻断主回复**：检索/写回/工具失败应有降级路径。
4. **强隔离优先**：tenant/user 身份只来自服务端会话，不信任客户端传值。
5. **可观测是上线前置条件**：traceId、节点耗时、工具审计日志必须具备。

---

## 3. 冻结决策清单（Day 0）

> 这 6 项不确定，开发会持续返工。建议 Day 0 完成评审并锁定。

1. 身份策略：`tenantId/userId` 仅从服务端鉴权上下文获取  
2. 记忆冲突策略：同 `memoryKey` 新值覆盖（保留 `version` 递增）  
3. 记忆 TTL：按 `memoryType` 配置保留周期  
4. 低置信度记忆：丢弃 or 待审池  
5. MCP 权限模型：server/tool 白名单 + 最小权限  
6. 首版 SLO：P95 延迟、错误率、token 成本上限

---

## 4. 里程碑与时间线（3 周）

## M0（W1 D1-D2）工程骨架
目标：建立可运行、可部署、可观测的基础工程。

交付：
- Next.js（App Router + TS strict）
- `/api/health` 基础路由（Node runtime）
- 环境变量 schema 校验（zod）
- 基础日志与 traceId

验收：
- 本地可启动
- Vercel Preview 可部署
- 健康检查可用

## M1（W1 D3-D4）记忆数据层（SeekDB）
目标：完成记忆存储与检索核心能力。

交付：
- `SeekdbClient` singleton（serverless 复用连接）
- `MemoryRepository`
  - `retrieveMemories`（`hybridSearch` + `query` fallback）
  - `upsertMemories`
  - `deleteMemory`
  - `listMemories`
- 基础脚本/测试用例

验收：
- 端到端验证增删改查
- 混合检索可返回相关记忆

## M2（W1 D5 ~ W2 D1）对话主链路（LangGraph）
目标：实现可用聊天能力（含记忆注入与写回）。

交付：
- 图节点：
  - `classifyIntent`
  - `retrieveMemories`
  - `generateResponse`
  - `extractMemoryCandidates`
  - `persistMemories`
- `POST /api/chat` 流式输出
- 错误降级策略（检索失败不阻断）

验收：
- 多轮对话可引用历史偏好
- 写回失败不影响本轮回答

## M3（W2 D2-D3）记忆治理
目标：提升记忆质量，降低污染和漂移。

交付：
- 去重与冲突解决（基于 `memoryKey`）
- `importance` + recency 规则
- 低置信度过滤
- PII 脱敏策略（入库前）

验收：
- 冲突样例行为符合策略
- 敏感信息不会以明文入库

## M4（W2 D4-D5）MCP + Skills MVP
目标：支持可执行任务能力。

交付：
- `SkillRegistry`（静态注册 + 开关）
- `McpAdapter`（白名单、参数校验、超时、重试）
- LangGraph 扩展节点：
  - `planActions`
  - `routeSkill`
  - `executeSkill`
  - `routeMcpTool`
  - `executeMcpTool`
  - `validateToolResult`
  - `persistActionMemory`
- 至少 1 个 Skill + 1 个 MCP 工具联通

验收：
- 能完成一次真实工具调用任务
- 工具失败有可解释降级与日志

## M5（W3 D1-D3）上线强化
目标：补齐可观测与运维能力。

交付：
- 指标埋点（P50/P95、成功率、token）
- 审计日志（toolName/args/resultSummary/traceId）
- 记忆质量看板基础数据
- 回滚策略文档

验收：
- 出现异常可通过 traceId 快速定位
- 关键指标可被采集并可视化

## M6（W3 D4-D5）Vercel 上线
目标：完成预发到生产发布。

交付：
- Preview/Production 双环境变量配置
- Vercel Cron（TTL 清理、摘要压缩）
- 上线 Checklist + 回归报告

验收：
- Production 稳定运行
- 满足首版 SLO

---

## 5. GitHub Issue 清单（建议直接创建）

以下为可直接复制的 issue 标题与范围。

### Epic A: Platform & Runtime
- A1: 初始化 Next.js + TypeScript strict + Node runtime 路由
- A2: 增加环境变量 schema 校验与启动时失败保护
- A3: 增加统一 traceId 与日志中间件

### Epic B: Memory Core (SeekDB)
- B1: 实现 SeekDB client singleton（Vercel serverless 复用）
- B2: 实现 MemoryRepository.retrieve（hybridSearch + fallback）
- B3: 实现 MemoryRepository.upsert/update/delete/list
- B4: 增加 memory metadata 规范与 version 规则

### Epic C: Chat Orchestration (LangGraph)
- C1: 实现 ChatState 与基础节点（classify/retrieve/generate）
- C2: 接入百炼模型并支持流式输出
- C3: 实现 memory candidate 抽取与持久化写回
- C4: 增加异常降级策略与错误边界

### Epic D: MCP + Skills
- D1: 设计 SkillDefinition 与 SkillRegistry
- D2: 实现 MCP Adapter（白名单、参数校验、超时重试）
- D3: LangGraph 增加 plan/router/execute/validate 节点
- D4: 实现工具调用审计日志与权限校验

### Epic E: Vercel & Production Readiness
- E1: 配置 Preview/Production 环境变量与密钥管理
- E2: 增加指标采集与 traceId 全链路关联
- E3: 实现 Vercel Cron：摘要压缩 + TTL 清理
- E4: 编写上线与回滚手册，完成压测报告

---

## 6. 每个 Issue 模板（复制即用）

```md
## 背景
为什么要做这件事？

## 目标
- [ ] 目标 1
- [ ] 目标 2

## 实施内容
- [ ] 任务 1
- [ ] 任务 2
- [ ] 任务 3

## 验收标准（DoD）
- [ ] 功能验收通过
- [ ] 异常路径覆盖
- [ ] 日志与指标可观测

## 依赖项
- 依赖 Issue: #

## 风险与回滚
- 风险：
- 回滚方式：
```

---

## 7. 风险台账（首版）

1. **越权风险**：客户端伪造 tenant/user  
   - 对策：服务端鉴权注入身份，强过滤
2. **记忆污染**：低质量事实被持久化  
   - 对策：置信度阈值 + 待审池
3. **Serverless 连接风暴**：高并发下频繁建连  
   - 对策：singleton + 超时 + 并发治理
4. **外部工具不稳定**：MCP 调用超时/失败  
   - 对策：超时、重试、降级、审计
5. **成本不可控**：token 与检索放大  
   - 对策：摘要压缩、topK 限制、分层模型

---

## 8. 成功标准（MVP）

- 功能：多轮对话能稳定引用用户历史偏好
- 稳定性：MCP/写回失败不阻断主回复
- 安全：无跨租户记忆泄露
- 运维：关键路径可追踪可告警
- 部署：Vercel Production 可持续运行
