# 🎉 在 Vercel 上部署 SeekDB（使用 Vercel KV）

## ✅ 问题已解决！

之前的问题：**Vercel 无法运行 SeekDB**（Serverless 架构，不支持长期服务）

现在的方案：**使用 Vercel KV** - Vercel 原生的 Redis 存储服务

---

## 🚀 3 步完成部署

### 步骤 1：创建 Vercel KV 数据库

1. 访问 [vercel.com](https://vercel.com)
2. 进入 **eywa-chat** 项目
3. 点击 **Storage** 标签页
4. 点击 **Create Database**
5. 选择 **KV**
6. 填写信息：
   - **Name**: `eywa-chat-kv`
   - **Region**: `Singapore (sin1)` ← 推荐，离中国最近
7. 点击 **Create**

### 步骤 2：连接到项目

创建后会自动连接。如果没有：

1. 在 KV 页面点击 **Connect**
2. 选择 **eywa-chat** 项目
3. 勾选 **Production** 和 **Preview**
4. 点击 **Connect**

✅ Vercel 会自动添加环境变量，无需手动配置！

### 步骤 3：重新部署

推送代码会自动触发部署，或手动操作：

```bash
git pull origin main
git push
```

或在 Vercel Dashboard 点击 **Redeploy**。

---

## ✅ 验证部署

### 1. 检查环境变量

在 Vercel Dashboard → Settings → Environment Variables

应该看到：
- ✅ `KV_URL`
- ✅ `KV_REST_API_URL`
- ✅ `KV_REST_API_TOKEN`

### 2. 查看部署日志

部署完成后，查看日志确认使用了 Vercel KV：

```
[INFO] memory-backend-selected { backend: 'vercel-kv' }
```

### 3. 测试记忆功能

1. 访问你的应用：https://eywa-chat-chi.vercel.app
2. 发送："记住我的名字是张三"
3. 等待 AI 回复确认
4. **刷新页面**
5. 询问："我叫什么名字？"
6. ✅ 如果回答"张三"，说明记忆持久化成功！

---

## 💰 成本说明

### 免费额度（Hobby 计划）
- **存储**: 10 MB
- **操作**: 25 万次/月
- **价格**: $0

### 实际使用估算

假设每天：
- 100 次对话
- 每次保存 2 条记忆 = 200 次写入
- 每月 = 6,000 次写入

**结论**: 免费额度可用 **40 个月**！🎉

### 超出后价格
- **额外存储**: $0.21/GB/月
- **额外操作**: $0.21/百万次

---

## 📊 对比方案

| 特性 | Vercel KV | SeekDB（自建） | 内存模式 |
|------|-----------|----------------|----------|
| **运维难度** | ⭐ 零运维 | ⭐⭐⭐ 需维护 | ⭐ 零运维 |
| **成本** | $0 起 | $6/月起 | $0 |
| **持久化** | ✅ 永久 | ✅ 永久 | ❌ 重启丢失 |
| **延迟** | <50ms | 100-500ms | <10ms |
| **扩展性** | ✅ 自动 | ❌ 手动 | ❌ 无 |
| **适合场景** | 生产环境 | 大数据量 | 开发测试 |

---

## 🔧 管理工具

### Vercel Dashboard

访问：https://vercel.com/dashboard/storage/kv

可以查看：
- 存储使用量
- 操作次数统计
- 延迟监控
- 连接信息

### CLI 工具

```bash
# 安装 Vercel CLI
npm i -g vercel

# 查看 KV 数据
vercel kv list

# 获取值
vercel kv get memory:xxx

# 设置值
vercel kv set key value

# 删除值
vercel kv del key
```

### Redis GUI 客户端

可以使用任何 Redis 客户端连接：

1. 在 Vercel KV 页面点击 **Connect**
2. 复制 **Redis Connection String**
3. 粘贴到 Redis Insight、Another Redis Desktop Manager 等工具

---

## 📈 监控与优化

### 1. 定期检查使用量

每周查看一次：
- Vercel Dashboard → Storage → KV

### 2. 设置告警（可选）

当接近限额时收到通知：
- 存储 > 8MB
- 操作 > 20 万次/月

### 3. 清理过期数据

已有的 Cron Job 会自动清理：
```
/api/cron/memory-ttl - 每日凌晨清理过期记忆
```

### 4. 优化记忆大小

每条记忆控制在 1KB 以内：
- 简洁的内容
- 合理的过期时间
- 定期归档旧记忆

---

## ❓ 常见问题

### Q: 需要修改代码吗？

**A:** ❌ 不需要！代码已自动适配。

只要环境变量存在，系统会自动使用 Vercel KV。

### Q: 原来的 SeekDB 数据会迁移吗？

**A:** ❌ 不会自动迁移。

如需迁移，需要手动导出导入。但通常直接从新数据开始即可。

### Q: 可以切换回 SeekDB 吗？

**A:** ✅ 可以。

只需在 Vercel 添加 SEEKDB_* 环境变量，系统会优先使用 SeekDB。

### Q: 支持向量搜索吗？

**A:** ❌ 当前版本是关键词匹配。

如果需要向量搜索，可以考虑：
- Supabase pgvector
- Pinecone
- Qdrant

### Q: 数据安全吗？

**A:** ✅ 非常安全。

- Vercel KV 基于 Upstash（知名 Redis 托管商）
- 数据加密存储
- 私有网络连接
- 符合 SOC2 Type II 认证

---

## 🎯 下一步

1. ✅ 创建 Vercel KV 数据库
2. ✅ 连接到项目
3. ✅ 重新部署
4. ✅ 测试记忆功能
5. ⏳ 监控第一周使用情况
6. ⏳ 根据需要调整配置

---

## 🆘 需要帮助？

遇到问题？

- 📖 详细文档：`docs/VERCEL_KV_SETUP.md`
- 💬 GitHub Issues: https://github.com/kejun/eywa-chat/issues
- 📧 Vercel 支持：https://vercel.com/support

---

**准备好了吗？** 现在开始部署吧！🚀

*最后更新：2026-02-21*
