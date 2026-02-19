# Issue Progress Matrix

> Updated at: 2026-02-18  
> Branch: `cursor/chatbot-memory-technical-spec-0334`  
> Latest commit: see branch HEAD (`git rev-parse --short HEAD`)

## 说明

- 当前运行环境的 GitHub token 对 issue **无写权限**（comment/close 返回 403）。
- 因此本文件用于同步“代码实现状态 -> issue 状态”，便于仓库管理员手动关单。

---

## Epic 状态

| Epic | Title | Status | Notes |
|---|---|---|---|
| #2 | Epic A: Platform & Runtime | Ready to close | A1/A2/A3 已完成并通过静态校验 |
| #3 | Epic B: Memory Core (SeekDB) | Ready to close | B1/B2/B3/B4 已完成（检索+写回+metadata/version） |
| #4 | Epic C: Chat Orchestration (LangGraph) | Ready to close | C1/C2/C3/C4 已完成（含降级） |
| #6 | Epic D: MCP + Skills | Ready to close | D1/D2/D3/D4 已完成（白名单/校验/审计） |
| #7 | Epic E: Vercel & Production Readiness | Partially done | E1/E2/E3 已完成；E4 文档与工具已完成，真实性能压测需在目标环境执行 |

---

## Task 状态

| Issue | Title | Status | Evidence |
|---|---|---|---|
| #8 | [A1] 初始化 Next.js + TypeScript strict + Node runtime 路由 | Done | `app/`, `next.config.ts`, `tsconfig.json`, `app/api/health/route.ts` |
| #9 | [A2] 增加环境变量 schema 校验与启动时失败保护 | Done | `lib/env.ts`, `scripts/validate-env.mjs`, `.env.example` |
| #10 | [A3] 增加统一 traceId 与日志中间件 | Done | `middleware.ts`, `lib/logger.ts` |
| #11 | [B1] 实现 SeekDB client singleton（Vercel serverless 复用） | Done | `lib/seekdb/client.ts` |
| #12 | [B2] 实现 MemoryRepository.retrieve（hybridSearch + fallback） | Done | `lib/memory/repository.ts` (`retrieveMemories`) |
| #13 | [B3] 实现 MemoryRepository.upsert/update/delete/list | Done | `lib/memory/repository.ts` + `/api/memories` |
| #14 | [B4] 增加 memory metadata 规范与 version 规则 | Done | `lib/memory/types.ts`, `version` 递增逻辑 |
| #15 | [C1] 实现 ChatState 与基础节点（classify/retrieve/generate） | Done | `lib/chat/state.ts`, `lib/chat/graph.ts` |
| #16 | [C2] 接入百炼模型并支持流式输出 | Done | `lib/chat/model.ts`, `app/api/chat/route.ts` |
| #17 | [C3] 实现 memory candidate 抽取与持久化写回 | Done | `lib/chat/memory-extractor.ts`, `persist` nodes |
| #18 | [C4] 增加异常降级策略与错误边界 | Done | chat/memory/tool fallback paths in `lib/chat/graph.ts`, `/api/chat` |
| #19 | [D1] 设计 SkillDefinition 与 SkillRegistry | Done | `lib/skills/types.ts`, `lib/skills/registry.ts` |
| #20 | [D2] 实现 MCP Adapter（白名单、参数校验、超时重试） | Done | `lib/mcp/adapter.ts`, `lib/mcp/types.ts` |
| #21 | [D3] LangGraph 增加 plan/router/execute/validate 节点 | Done | action nodes in `lib/chat/graph.ts` |
| #22 | [D4] 实现工具调用审计日志与权限校验 | Done | `mcp-tool-executed` logging + allowedTools checks |
| #23 | [E1] 配置 Preview/Production 环境变量与密钥管理 | Done (Doc/Code) | `README.md`, `docs/DEPLOYMENT_RUNBOOK.md`, env schema |
| #24 | [E2] 增加指标采集与 traceId 全链路关联 | Done | `lib/observability/*`, `/api/metrics`, traceId middleware |
| #25 | [E3] 实现 Vercel Cron：摘要压缩 + TTL 清理 | Done (Phase-1) | `/api/cron/memory-ttl`, `/api/cron/memory-compact` |
| #26 | [E4] 编写上线与回滚手册，完成压测报告 | Partially done | runbook+模板+loadtest scripts 已完成；请按 `docs/LOADTEST_EXECUTION_CHECKLIST.md` 执行并贴结果 |

---

## 建议人工关单顺序

1. 先关闭：#8 ~ #25（#26 除外）  
2. 对 #26：补一次预发/生产压测报告后关闭  
3. 关闭 Epic：#2 #3 #4 #6，最后视 #26 结果关闭 #7

---

## 管理员可执行命令（示例）

```bash
# 关闭已完成任务
gh issue close 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25

# 关闭已完成 Epic
gh issue close 2 3 4 6

# #26 与 #7 建议在真实压测报告完成后再关闭
```
