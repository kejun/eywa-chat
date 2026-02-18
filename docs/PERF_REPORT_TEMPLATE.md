# Chat API 压测报告模板

## 1. 测试信息

- 日期：
- 测试人：
- 分支 / Commit：
- 环境：
  - Vercel Project / Environment：
  - 区域：
  - 模型：`DASHSCOPE_MODEL`
  - SeekDB 实例：

## 2. 测试配置

- URL：
- 请求总数：
- 并发数：
- 超时：
- 测试消息：
- 身份上下文：
  - `x-tenant-id`：
  - `x-user-id`：

## 3. 执行命令

```bash
npm run loadtest:chat -- \
  --url "<chat-endpoint>" \
  --requests 100 \
  --concurrency 10 \
  --tenant-id "t-loadtest" \
  --user-id "u-loadtest" \
  --output "./artifacts/loadtest-summary.json"
```

## 4. 结果摘要

- 总请求：
- 成功：
- 失败：
- 成功率：
- 吞吐（RPS）：
- 总耗时：

### 延迟（总时延）
- P50：
- P95：
- Max：

### 延迟（首 token）
- P50：
- P95：
- Max：

## 5. 失败样本

- 错误类型分布：
- Top N 失败样本（含 traceId）：

## 6. 资源与成本观察

- 模型 token 使用量（估算）：
- SeekDB 查询延迟：
- 命中率（retrieved memories > 0）：

## 7. 结论

- 是否满足 SLO：
- 主要瓶颈：
- 需要优化项：
  1.
  2.
  3.

## 8. 后续行动

- [ ] 行动项 1
- [ ] 行动项 2
- [ ] 行动项 3
