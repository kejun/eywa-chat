# Eywa Chat 🧠

<div align="center">

![Logo](./public/logo.jpg)

**具有持久化记忆的智能对话助手**

[在线演示](https://eywa-chat-chi.vercel.app) · [技术文档](./docs/) · [SeekDB 部署指南](./docs/SEEKDB_DOCKER_DEPLOYMENT.md)

</div>

---

## ✨ 核心特性

- 🧠 **持久化记忆** - 跨会话记住用户偏好、事实和任务进度
- 🔍 **智能检索** - 基于 SeekDB 的混合向量搜索（关键词 + 语义）
- 🤖 **AI 驱动** - 阿里云百炼 Qwen 模型，支持中文优化
- 🛠️ **MCP 工具调用** - 可扩展的外部系统集成能力
- 📦 **Skills 编排** - 复杂任务的多步骤自动化执行
- 🔒 **多租户隔离** - 企业级数据安全与隐私保护

---

## 🏗️ 系统架构

```text
┌─────────────────┐
│   Next.js UI    │
│  (流式对话界面)  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   /api/chat     │
│  (Node.js 运行时) │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────┐
│        LangGraph 工作流引擎          │
│  ┌──────────┐  ┌──────────┐        │
│  │ 意图识别  │→ │ 记忆检索  │        │
│  └──────────┘  └──────────┘        │
│         ↓              ↓            │
│  ┌──────────┐  ┌──────────┐        │
│  │ 响应生成  │← │ MCP/Skills│       │
│  └──────────┘  └──────────┘        │
└─────────────────────────────────────┘
         │
         ├─────────────┐
         ▼             ▼
┌────────────────┐ ┌──────────────┐
│   SeekDB       │ │ 阿里云百炼    │
│ (记忆存储)      │ │ (Qwen 模型)   │
└────────────────┘ └──────────────┘
```

### 技术栈

| 层级 | 技术选型 | 说明 |
|------|---------|------|
| **前端** | Next.js 16 + React | SSR/ISR 支持，流式输出 |
| **编排** | LangGraph | 状态机驱动的多节点工作流 |
| **记忆** | SeekDB (OceanBase) | 向量数据库，支持混合检索 |
| **模型** | 阿里云百炼 Qwen | `qwen-plus` 对话 + `text-embedding-v4` |
| **部署** | Vercel | Serverless + Cron 定时任务 |
| **扩展** | MCP Protocol | 外部工具/资源统一接入 |

---

## 🚀 快速开始

### 环境准备

```bash
# 克隆项目
git clone https://github.com/kejun/eywa-chat.git
cd eywa-chat

# 安装依赖
npm install

# 复制环境变量
cp .env.example .env.local
```

### 配置环境变量

编辑 `.env.local`：

```bash
# 阿里云百炼 (DashScope)
DASHSCOPE_API_KEY=sk-your-api-key
DASHSCOPE_MODEL=qwen-plus
DASHSCOPE_BASE_URL=https://dashscope-intl.aliyuncs.com/compatible-mode/v1

# SeekDB 配置
SEEKDB_HOST=localhost
SEEKDB_PORT=2881
SEEKDB_USER=root
SEEKDB_PASSWORD=
SEEKDB_DATABASE=chatbot_memory

# 认证配置
AUTH_JWT_SECRET=your-jwt-secret
AUTH_TENANT_CLAIM=tenantId
AUTH_USER_CLAIM=userId
```

### 启动 SeekDB（本地开发）

```bash
docker run -d --name seekdb \
  --restart unless-stopped \
  -p 2881:2881 \
  -v ~/seekdb/data:/var/lib/seekdb \
  -e SEEKDB_ADMIN_PASSWORD= \
  oceanbase/seekdb:latest
```

### 启动开发服务器

```bash
npm run dev
```

访问 http://localhost:3000

---

## 📊 记忆系统设计

### 记忆类型

| 类型 | 说明 | 示例 |
|------|------|------|
| `profile` | 用户基本信息 | "我叫张三"、"我是工程师" |
| `preference` | 个人偏好 | "喜欢打篮球"、"偏好高铁" |
| `fact` | 客观事实 | "下周去上海出差" |
| `task` | 待办任务 | "帮我记得买咖啡" |
| `summary` | 对话摘要 | 每 N 轮自动压缩生成 |

### 记忆元数据

```typescript
interface MemoryMetadata {
  tenantId: string;        // 租户 ID（多租户隔离）
  userId: string;          // 用户 ID
  threadId?: string;       // 线程 ID（可选，用于线程级记忆）
  memoryType: MemoryType;  // 记忆类型
  importance: number;      // 重要度 1-5
  createdAt: number;       // 创建时间戳
  lastAccessAt: number;    // 最后访问时间
  expiresAt?: number;      // 过期时间（TTL）
  sourceMessageId: string; // 来源消息 ID
  version: number;         // 版本号
  tags: string[];          // 标签
}
```

### 检索策略

采用 **混合检索（Hybrid Search）** 提升准确率：

1. **关键词匹配** - 处理显式实体（产品名、日期、术语）
2. **向量语义** - 处理同义表达、隐含意图
3. **RRF 融合** - Reciprocal Rank Fusion 提升稳定性
4. **元数据过滤** - 强制 `tenantId + userId` 隔离

```typescript
// 检索示例
const memories = await repository.retrieveMemories({
  tenantId: "t1",
  userId: "u1",
  queryText: "我喜欢的运动",
  nResults: 8,
});
```

---

## 🛠️ MCP & Skills 扩展

### MCP 工具调用

集成外部系统（日历、CRM、工单等）：

```typescript
// MCP 工具调用示例
const result = await mcpClient.callTool({
  server: "google-calendar",
  tool: "create-event",
  args: {
    title: "团队会议",
    time: "2026-02-22T14:00:00Z",
  },
});
```

### Skills 技能编排

封装复杂任务流程：

```typescript
// Skill 定义示例
const createTravelPlanSkill: SkillDefinition = {
  name: "create-travel-plan",
  description: "创建出差旅行计划",
  inputSchema: { /* JSON Schema */ },
  run: async (ctx) => {
    // 多步骤执行逻辑
    // 1. 查询航班
    // 2. 预订酒店
    // 3. 创建日历事件
    // 4. 保存偏好到记忆
  },
};
```

---

## 📈 API 接口

### POST /api/chat

流式对话接口。

**请求：**
```json
{
  "threadId": "thread-001",
  "message": "我下周去上海出差，帮我记住我偏好高铁"
}
```

**响应（SSE 流式）：**
```text
event: meta
data: {"traceId":"abc123"}

event: token
data: {"text":"好的，我已经记住了"}

event: done
data: {"retrievedCount":2,"persistedCount":1}
```

### GET /api/memories

查看当前用户的记忆列表。

**查询参数：**
- `limit` - 返回数量（默认 20）
- `memoryType` - 按类型过滤

### DELETE /api/memories/:id

删除指定记忆（合规要求）。

---

## 🌐 生产部署

### Vercel 部署

1. 连接 GitHub 仓库到 Vercel
2. 配置环境变量（见 `.env.example`）
3. 部署生产版本：

```bash
npx vercel deploy --prod
```

### SeekDB 云部署

详细步骤见：[SeekDB Docker 部署指南](./docs/SEEKDB_DOCKER_DEPLOYMENT.md)

**关键配置：**
- 云服务器开放端口 `2881`（安全组入站规则）
- 使用空密码或强密码认证
- 定期备份数据卷 `~/seekdb/data`

### 环境变量（Vercel）

在 Vercel Project Settings → Environment Variables 中配置：

| 变量名 | 生产值 | 说明 |
|--------|--------|------|
| `DASHSCOPE_API_KEY` | `sk-xxx` | 阿里云百炼 API Key |
| `DASHSCOPE_BASE_URL` | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` | 国际版 endpoint |
| `SEEKDB_HOST` | `43.160.241.135` | 云服务器公网 IP |
| `SEEKDB_PORT` | `2881` | SeekDB 端口 |
| `SEEKDB_USER` | `root` | 数据库用户 |
| `SEEKDB_PASSWORD` | `` | 空密码（或设置强密码） |
| `SEEKDB_DATABASE` | `chatbot_memory` | 数据库名 |

---

## 🔒 安全与合规

- ✅ **多租户强隔离** - 所有查询强制 `tenantId + userId` 过滤
- ✅ **记忆可删除** - 用户可查看、删除个人记忆（GDPR 合规）
- ✅ **数据最小化** - 仅存储有价值的记忆，不存完整对话
- ✅ **敏感信息检测** - 入库前脱敏或拒绝存储（身份证、银行卡等）
- ✅ **TTL 策略** - 支持记忆自动过期清理

---

## 📊 观测与监控

### 关键指标

- **响应延迟** - P50/P95 时延
- **记忆命中率** - 检索到的记忆被正确引用的比例
- **写回成功率** - 记忆持久化成功率
- **Token 成本** - 输入/输出 token 统计

### 日志查询

```bash
# Vercel 日志
npx vercel logs <deployment-url> --follow

# SeekDB 诊断
curl <vercel-url>/api/debug/seekdb
```

---

## 🗺️ 路线图

### Phase 1 ✅ (已完成)
- [x] 单租户 MVP
- [x] 混合检索 + 记忆写回
- [x] Vercel + SeekDB 生产部署
- [x] 阿里云百炼集成

### Phase 2 🚧 (进行中)
- [ ] 记忆去重与冲突解决
- [ ] 重要度打分 + recency 衰减
- [ ] 可视化调试页面

### Phase 3 📅 (计划中)
- [ ] 多租户完善
- [ ] MCP 市场（预置工具库）
- [ ] A/B 测试框架
- [ ] 成本优化（分层模型 + 缓存）

---

## 📚 文档索引

| 文档 | 说明 |
|------|------|
| [技术规格](./docs/SPEC.md) | 完整技术设计文档 |
| [SeekDB 部署](./docs/SEEKDB_DOCKER_DEPLOYMENT.md) | Docker 部署指南 ⭐ |
| [实施计划](./docs/IMPLEMENTATION_PLAN.md) | 里程碑与验收标准 |
| [运行手册](./docs/DEPLOYMENT_RUNBOOK.md) | 上线运维指南 |
| [性能报告](./docs/PERF_REPORT_TEMPLATE.md) | 压测结果模板 |

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

主要贡献方向：
- 🐛 Bug 修复
- ✨ 新功能（MCP 工具、Skills）
- 📝 文档改进
- 🧪 测试用例

---

## 📄 许可证

MIT License

---

<div align="center">

**Eywa Chat** - 让 AI 真正记住你

[在线演示](https://eywa-chat-chi.vercel.app) · [GitHub](https://github.com/kejun/eywa-chat)

</div>
