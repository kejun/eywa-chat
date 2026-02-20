# SeekDB 记忆存储配置指南

## 问题说明

默认情况下，eywa-chat 使用 **SeekDB** 作为记忆持久化存储。如果未正确配置 SeekDB，记忆功能将自动降级为**内存存储模式**（仅用于开发/演示）。

### ⚠️ 内存存储模式的限制

- ✅ 开发环境可用
- ✅ 无需额外配置
- ❌ **重启服务器后记忆会丢失**
- ❌ 不适合生产环境

## 解决方案

### 方案 1：配置远程 SeekDB（推荐用于生产）

如果你有自建的 SeekDB 服务，请在 Vercel 中设置以下环境变量：

```bash
SEEKDB_HOST=your-seekdb-host.com
SEEKDB_PORT=6333
SEEKDB_USER=your-username
SEEKDB_PASSWORD=your-password
SEEKDB_DATABASE=chatbot_memory
```

### 方案 2：使用 Vercel KV（即将支持）

TODO: 实现 Vercel KV 适配器

### 方案 3：继续使用内存模式（仅开发）

无需任何操作，系统会自动检测并使用内存存储。

## 验证配置

### 检查当前存储模式

访问 `/api/health` 端点，查看响应中的 `memoryBackend` 字段：

```json
{
  "status": "ok",
  "memoryBackend": "seekdb"  // 或 "in-memory"
}
```

### 测试记忆持久化

1. 发送消息："记住我的名字是张三"
2. 等待 AI 回复确认已保存
3. 刷新页面
4. 询问："我叫什么名字？"
   - ✅ 如果 AI 回答"张三"，说明记忆持久化正常工作
   - ❌ 如果 AI 说不知道，说明使用的是内存模式且服务器已重启

## 日志说明

### 正常情况（SeekDB 已配置）

```
[INFO] seekdb-client-created { host: "...", port: ..., database: "..." }
[INFO] chat-memories-persisted { traceId: "...", count: 1 }
```

### 降级情况（SeekDB 未配置）

```
[WARN] seekdb-not-configured { message: "SeekDB is not configured..." }
[WARN] using-in-memory-repository { message: "Using in-memory repository..." }
[INFO] memory-upserted-in-memory { id: "...", version: 1 }
```

## 部署到 Vercel

### 步骤

1. 在 Vercel Dashboard 中选择项目
2. 进入 **Settings** → **Environment Variables**
3. 添加 SeekDB 相关环境变量
4. 重新部署项目

### 环境变量列表

| 变量名 | 必填 | 说明 |
|--------|------|------|
| `SEEKDB_HOST` | 生产环境必填 | SeekDB 服务器地址 |
| `SEEKDB_PORT` | 生产环境必填 | SeekDB 端口（通常 6333） |
| `SEEKDB_USER` | 生产环境必填 | 数据库用户名 |
| `SEEKDB_PASSWORD` | 生产环境必填 | 数据库密码 |
| `SEEKDB_DATABASE` | 生产环境必填 | 数据库名称 |

## 故障排除

### 问题：记忆无法保存

**症状**：AI 说已保存，但刷新后忘记

**可能原因**：
1. SeekDB 未配置 → 检查环境变量
2. SeekDB 服务不可达 → 检查网络连接
3. SeekDB 认证失败 → 检查用户名/密码

**解决步骤**：
1. 查看 Vercel Functions 日志
2. 搜索 `seekdb` 或 `memory` 关键词
3. 根据错误信息修复配置

### 问题：本地开发正常，Vercel 不正常

**原因**：本地有 SeekDB 服务，但 Vercel 无法访问

**解决**：在 Vercel 配置远程 SeekDB 或使用其他存储方案

---

*最后更新：2026-02-20*
