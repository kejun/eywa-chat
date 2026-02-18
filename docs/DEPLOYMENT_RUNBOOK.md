# Deployment Runbook (Vercel)

## 1. 环境分层

在 Vercel 中分开维护以下环境变量：

- Preview
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
  - `ALLOW_INSECURE_CONTEXT`（生产必须为 `0`）
  - `CRON_SECRET`（可选）
- Production（与 Preview 分离，不复用凭据）

## 2. 发布前检查

1. CI 通过：
   - `npm run check`
2. 身份上下文：
   - 客户端必须携带：`Authorization: Bearer <jwt-token>`
   - 中间件负责校验 JWT，并在内部注入：
     - `x-tenant-id`
     - `x-user-id`
   - 不应依赖客户端 body 传入 tenant/user 身份。
3. 关键路由检查：
   - `GET /api/health`
   - `POST /api/chat`
   - `GET /api/memories/search`
   - `GET /api/tools`
4. 安全检查：
   - Cron 路由启用 `CRON_SECRET`
   - 无测试密钥泄露到前端

## 3. Vercel Cron 配置建议

建议创建两条 Cron：

1. 每日执行过期清理
   - URL: `/api/cron/memory-ttl`
2. 每日执行摘要压缩（当前为占位）
   - URL: `/api/cron/memory-compact`

请求头建议附带：

```text
Authorization: Bearer <CRON_SECRET>
```

## 4. 上线后观察

通过 `GET /api/metrics` 观察：

- `chat.request.total`
- `chat.request.duration`
- `chat.memories.retrieved`
- `chat.memories.persisted`
- `cron.memory_ttl.deleted_count`

## 4.1 压测建议

可在预发环境执行：

```bash
npm run loadtest:chat:report -- \
  --url "https://<preview-domain>/api/chat" \
  --requests 100 \
  --concurrency 10 \
  --jwt-token "<loadtest-jwt-token>" \
  --summary-out "./artifacts/loadtest-summary.json" \
  --report-out "./artifacts/loadtest-report.md"
```

压测结果可按模板沉淀：`docs/PERF_REPORT_TEMPLATE.md`

## 5. 回滚策略

1. 在 Vercel 回滚到上一个稳定 deployment。
2. 若问题来自配置：
   - 回滚环境变量到前一版本
3. 若问题来自数据：
   - 暂停 Cron 清理任务
   - 执行人工排查后恢复

## 6. 故障应急

1. `/api/chat` 大面积失败：
   - 检查 DashScope 凭据与模型可用性
   - 检查 SeekDB 连通性
2. 记忆检索异常：
   - 检查 `memory_entries` 集合状态
   - 查看 `memory-hybrid-search-failed` 日志
3. 工具调用异常：
   - 检查 MCP 白名单与工具输入 schema
