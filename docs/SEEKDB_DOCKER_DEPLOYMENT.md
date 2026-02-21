# SeekDB Docker 部署指南

## 架构说明

eywa-chat 使用 **独立部署的 SeekDB 服务** 作为记忆存储后端，通过 Docker 容器运行。

```
┌─────────────────┐      ┌─────────────────┐
│   Vercel        │ HTTP │  Cloud VM       │
│   eywa-chat     │─────▶│  Docker         │
│   (Frontend)    │      │  seekdb:latest  │
└─────────────────┘      └────────┬────────┘
                                  │
                                  ▼
                         ┌─────────────────┐
                         │   SeekDB        │
                         │   (MySQL 协议)  │
                         │   Port: 2881    │
                         └─────────────────┘
```

## 快速部署

### 1. 在云服务器上安装 Docker

```bash
# Ubuntu/Debian
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER

# 验证安装
docker --version
```

### 2. 启动 SeekDB 容器

```bash
docker run -d \
  --name seekdb \
  --restart unless-stopped \
  -p 2881:2881 \
  -v ~/seekdb/data:/var/lib/seekdb \
  -e SEEKDB_ADMIN_PASSWORD= \
  oceanbase/seekdb:latest
```

**参数说明**：
- `-d`: 后台运行
- `--restart unless-stopped`: 自动重启
- `-p 2881:2881`: 映射端口（可自定义）
- `-v ~/seekdb/data:/var/lib/seekdb`: 持久化数据
- `-e SEEKDB_ADMIN_PASSWORD=`: 空密码（开发环境）

### 3. 配置防火墙

**⚠️ 重要**：必须在云服务商控制台开放 2881 端口！

**阿里云**：
1. ECS 控制台 → 安全组 → 入方向
2. 添加规则：TCP 2881，授权对象 0.0.0.0/0

**腾讯云**：
1. CVM 控制台 → 安全组 → 入站规则
2. 添加规则：TCP 2881，来源 0.0.0.0/0

**Ubuntu UFW**（如果启用）：
```bash
sudo ufw allow 2881/tcp
sudo ufw reload
```

### 4. 验证部署

```bash
# 检查容器状态
docker ps | grep seekdb

# 测试本地连接
docker exec seekdb mysql -u admin -e "SELECT 1;"

# 测试公网访问（从服务器自身）
curl http://43.160.241.135:2881/api/health
```

## eywa-chat 配置

### 环境变量

在 Vercel 中设置以下环境变量：

```bash
SEEKDB_HOST=43.160.241.135
SEEKDB_PORT=2881
SEEKDB_USER=admin
SEEKDB_PASSWORD=
SEEKDB_DATABASE=chatbot_memory
```

### 本地开发

复制 `.env.local.example` 并修改：

```bash
cp .env.local.example .env.local
```

编辑 `.env.local`：
```bash
SEEKDB_HOST=localhost
SEEKDB_PORT=2881
SEEKDB_USER=admin
SEEKDB_PASSWORD=
SEEKDB_DATABASE=chatbot_memory
```

## 运维管理

### 查看日志

```bash
# 实时日志
docker logs -f seekdb

# 最近 100 行
docker logs --tail 100 seekdb
```

### 备份数据

```bash
# 停止容器
docker stop seekdb

# 备份数据目录
tar -czf seekdb-backup-$(date +%Y%m%d).tar.gz ~/seekdb/data

# 重启容器
docker start seekdb
```

### 升级 SeekDB

```bash
# 拉取最新镜像
docker pull oceanbase/seekdb:latest

# 停止并删除旧容器
docker stop seekdb
docker rm seekdb

# 重新创建容器（数据保留）
docker run -d \
  --name seekdb \
  --restart unless-stopped \
  -p 2881:2881 \
  -v ~/seekdb/data:/var/lib/seekdb \
  -e SEEKDB_ADMIN_PASSWORD= \
  oceanbase/seekdb:latest
```

### 监控资源使用

```bash
# CPU 和内存使用
docker stats seekdb

# 磁盘使用
du -sh ~/seekdb/data
```

## 故障排查

### 问题 1: 容器无法启动

```bash
# 查看错误日志
docker logs seekdb

# 检查端口占用
sudo lsof -i :2881

# 检查磁盘空间
df -h
```

### 问题 2: 无法远程连接

1. **检查容器是否运行**
   ```bash
   docker ps | grep seekdb
   ```

2. **检查端口监听**
   ```bash
   ss -tlnp | grep 2881
   ```

3. **检查防火墙**
   - 云控制台安全组是否开放 2881
   - UFW/iptables 是否允许

4. **测试本地访问**
   ```bash
   curl http://localhost:2881/api/health
   ```

### 问题 3: 混合搜索返回空结果

1. **检查数据库是否存在**
   ```bash
   docker exec seekdb mysql -u admin -e "SHOW DATABASES;" | grep chatbot
   ```

2. **检查集合和索引**
   ```bash
   docker exec seekdb mysql -u admin chatbot_memory -e "SHOW TABLES;"
   docker exec seekdb mysql -u admin chatbot_memory -e "SHOW INDEX FROM memories;"
   ```

3. **查看应用日志**
   ```bash
   vercel logs --follow
   ```

## 性能优化

### 调整 Docker 资源限制

```bash
docker update seekdb \
  --memory 4g \
  --memory-swap 4g \
  --cpus 2
```

### 优化 SeekDB 配置

编辑 `~/seekdb/data/my.cnf`（需要重启容器）：
```ini
[mysqld]
max_connections = 500
innodb_buffer_pool_size = 2G
innodb_log_file_size = 512M
```

### 定期清理过期数据

创建 cron 任务：
```bash
# 每月 1 号凌晨 2 点清理 90 天前的记忆
0 2 1 * * docker exec seekdb mysql -u admin chatbot_memory -e "DELETE FROM memories WHERE created_at < DATE_SUB(NOW(), INTERVAL 90 DAY);"
```

## 安全建议

### 生产环境设置密码

```bash
# 1. 停止旧容器
docker stop seekdb
docker rm seekdb

# 2. 使用密码启动新容器
docker run -d \
  --name seekdb \
  --restart unless-stopped \
  -p 2881:2881 \
  -v ~/seekdb/data:/var/lib/seekdb \
  -e SEEKDB_ADMIN_PASSWORD=YourStrongPassword123! \
  oceanbase/seekdb:latest

# 3. 更新 Vercel 环境变量
# SEEKDB_PASSWORD=YourStrongPassword123!
```

### 限制访问 IP

在云控制台安全组中，将授权对象从 `0.0.0.0/0` 改为 Vercel 的 IP 范围。

### 启用 SSL/TLS

参考 SeekDB 官方文档配置 SSL 连接。

## 参考资源

- [SeekDB 官方文档](https://github.com/oceanbase/seekdb)
- [Docker 官方文档](https://docs.docker.com/)
- [eywa-chat 技术规格](../README.md#技术规格)

---

*最后更新：2026-02-21*
