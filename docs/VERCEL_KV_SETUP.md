# Vercel KV 记忆存储配置指南

## 🎯 什么是 Vercel KV？

**Vercel KV** 是 Vercel 提供的托管 Redis 服务，完全集成在 Vercel 平台中。

**优势**：
- ✅ 零运维 - 无需管理服务器
- ✅ 自动扩展 - 根据流量自动调整
- ✅ 免费额度 - 每月 10MB 存储 + 25 万次操作
- ✅ 全球边缘 - 低延迟访问
- ✅ 原生集成 - Vercel Dashboard 直接配置

---

## 🚀 快速开始（5 分钟）

### 步骤 1：在 Vercel 创建 KV 数据库

1. 访问 [vercel.com/dashboard](https://vercel.com/dashboard)
2. 进入你的项目 **eywa-chat**
3. 点击 **Storage** 标签
4. 点击 **Create Database** → 选择 **KV**
5. 输入名称：`eywa-chat-kv`
6. 选择区域：**选择离你用户最近的**（推荐 `sin1` 新加坡）
7. 点击 **Create**

### 步骤 2：连接到项目

创建后会自动连接，如果没有：
1. 在 KV 页面点击 **Connect**
2. 选择 **eywa-chat** 项目
3. 选择环境：**Production** 和 **Preview** 都勾选
4. 点击 **Connect**

### 步骤 3：验证环境变量

Vercel 会自动添加以下环境变量：
- `KV_URL`
- `KV_REST_API_URL`
- `KV_REST_API_TOKEN`
- `KV_REST_API_READ_ONLY_TOKEN`

✅ 无需手动配置！

### 步骤 4：重新部署

在 Vercel Dashboard 点击 **Redeploy**，或推送代码触发自动部署。

### 步骤 5：测试

访问应用，发送消息让 AI 记住某事，刷新页面检查是否还记得。

---

## 📊 免费额度 vs 付费计划

### Hobby（免费）
- **存储**: 10 MB
- **操作**: 25 万次/月
- **延迟**: <50ms（边缘）
- **适合**: 个人项目、小型应用

### Pro（$20/月 + $0.21/GB）
- **存储**: 1 GB 起
- **操作**: 250 万次/月
- **额外操作**: $0.21/百万次
- **适合**: 生产环境、中小团队

### Enterprise（联系销售）
- **定制配额**
- **专属支持**

---

## 💡 优化建议

### 1. 控制记忆大小

每条约 500-1000 字节，10MB 可存储约 **10,000-20,000 条记忆**。

### 2. 设置过期时间

临时记忆设置 TTL，自动清理：
```typescript
{
  expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000 // 7 天后过期
}
```

### 3. 定期清理

使用 Cron Job 定期清理过期记忆：
```bash
# 已有的 cron job 会自动清理
/api/cron/memory-ttl
```

### 4. 监控使用量

在 Vercel Dashboard → Storage → KV 查看：
- 存储使用量
- 操作次数
- 延迟统计

---

## 🔧 高级配置

### 本地开发使用 Vercel KV

```bash
# 安装 Vercel CLI
npm i -g vercel

# 拉取环境变量
vercel link
vercel env pull
```

这会生成 `.env.local` 文件，包含 KV 连接信息。

### 手动配置（不推荐）

如果自动连接失败，可以手动添加环境变量：

在 Vercel Dashboard → Settings → Environment Variables：

```
KV_URL=redis://default:PASSWORD@HOST:PORT
KV_REST_API_URL=https://HOST.upstash.io
KV_REST_API_TOKEN=TOKEN
```

---

## 📈 性能对比

| 方案 | 延迟 | 成本 | 运维难度 |
|------|------|------|----------|
| **Vercel KV** | <50ms | $0 起 | ⭐ 零运维 |
| SeekDB（自建） | 100-500ms | $6/月起 | ⭐⭐⭐ 需维护 |
| 内存模式 | <10ms | $0 | ⭐ 零运维（但重启丢失） |

---

## ❓ 常见问题

### Q: 免费额度够用吗？

**A:** 对于个人项目完全够用。

计算示例：
- 每天 100 次对话
- 每次保存 2 条记忆 = 200 次写入
- 每月 = 6,000 次写入
- 免费额度 25 万次 = **可用 40 个月**

### Q: 数据会丢失吗？

**A:** 不会。Vercel KV 基于 Upstash，提供持久化存储。

### Q: 可以迁移到其他 Redis 吗？

**A:** 可以。标准 Redis 协议，随时导出导入。

### Q: 支持向量搜索吗？

**A:** ❌ 不支持。当前实现是关键词匹配降级方案。

如果需要向量搜索，建议：
1. 使用 **Supabase pgvector**（PostgreSQL）
2. 使用 **Pinecone**（专用向量数据库）
3. 使用 **Qdrant**（自托管向量数据库）

---

## 🔄 从 SeekDB 迁移到 Vercel KV

如果你之前用 SeekDB，迁移很简单：

### 1. 创建 Vercel KV（如上）

### 2. 更新环境变量

删除 SEEKDB_* 变量，Vercel 会自动使用 KV。

### 3. 重新部署

```bash
git push
```

### 4. 旧数据处理

SeekDB 中的记忆不会自动迁移。如需迁移：

```typescript
// 临时脚本：从 SeekDB 导出，导入到 Vercel KV
const oldMemories = await seekdbCollection.query(...);
for (const memory of oldMemories) {
  await kv.set(`memory:${memory.id}`, memory.document);
  await kv.set(`memory:meta:${memory.id}`, memory.metadata);
}
```

---

## 🎯 下一步

1. ✅ 创建 Vercel KV 数据库
2. ✅ 连接到项目
3. ✅ 重新部署 eywa-chat
4. ✅ 测试记忆功能
5. ⏳ 监控使用量（第一周）

---

**需要帮助？** 

- 📖 Vercel KV 文档：https://vercel.com/docs/storage/vercel-kv
- 💬 GitHub Issues: https://github.com/kejun/eywa-chat/issues

---

*最后更新：2026-02-21*
