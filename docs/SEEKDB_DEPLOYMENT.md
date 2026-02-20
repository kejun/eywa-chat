# SeekDB 远程部署指南

## 快速部署（推荐 - Docker）

### 1. 准备服务器

**最低配置要求**：
- CPU: 2 核
- 内存：4GB
- 存储：20GB SSD
- 系统：Ubuntu 20.04+ / Debian 11+

**可选**：如果有域名，配置 DNS A 记录指向服务器 IP

### 2. 安装 Docker

```bash
# 更新系统
sudo apt update && sudo apt upgrade -y

# 安装 Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# 启动 Docker
sudo systemctl enable docker
sudo systemctl start docker

# 验证安装
docker --version
```

### 3. 部署 SeekDB

```bash
# 创建数据目录
mkdir -p ~/seekdb/data
cd ~/seekdb

# 拉取镜像
docker pull ghcr.io/seek-db/seekdb:latest

# 启动容器
docker run -d \
  --name seekdb \
  --restart unless-stopped \
  -p 6333:6333 \
  -v $(pwd)/data:/var/lib/seekdb \
  -e SEEKDB_ADMIN_PASSWORD=$(openssl rand -base64 32) \
  ghcr.io/seek-db/seekdb:latest
```

### 4. 获取连接信息

```bash
# 查看容器日志（获取初始密码）
docker logs seekdb 2>&1 | grep "Admin password"

# 查看容器状态
docker ps | grep seekdb
```

**连接信息**：
- **Host**: 你的服务器 IP 或域名
- **Port**: `6333`
- **User**: `admin`
- **Password**: 从日志中获取
- **Database**: `chatbot_memory`

### 5. 配置防火墙

```bash
# Ubuntu (UFW)
sudo ufw allow 6333/tcp
sudo ufw reload

# 或者使用 iptables
sudo iptables -A INPUT -p tcp --dport 6333 -j ACCEPT
```

### 6. 在 Vercel 配置环境变量

访问 Vercel Dashboard → eywa-chat → Settings → Environment Variables

添加以下变量：

```bash
SEEKDB_HOST=your-server-ip-or-domain
SEEKDB_PORT=6333
SEEKDB_USER=admin
SEEKDB_PASSWORD=your-password-from-step-4
SEEKDB_DATABASE=chatbot_memory
```

然后点击 **Redeploy** 重新部署应用。

---

## 高级配置（生产环境）

### 使用 Docker Compose

创建 `docker-compose.yml`：

```yaml
version: '3.8'

services:
  seekdb:
    image: ghcr.io/seek-db/seekdb:latest
    container_name: seekdb
    restart: unless-stopped
    ports:
      - "6333:6333"
    volumes:
      - ./data:/var/lib/seekdb
      - ./config:/etc/seekdb
    environment:
      - SEEKDB_ADMIN_PASSWORD=${SEEKDB_ADMIN_PASSWORD}
      - SEEKDB_HTTP_PORT=6333
    networks:
      - seekdb-network

networks:
  seekdb-network:
    driver: bridge
```

启动：

```bash
# 设置密码
export SEEKDB_ADMIN_PASSWORD=$(openssl rand -base64 32)

# 启动服务
docker-compose up -d

# 查看状态
docker-compose ps
```

### 配置 HTTPS（使用 Caddy）

如果需要 HTTPS，可以添加 Caddy 反向代理：

```yaml
version: '3.8'

services:
  caddy:
    image: caddy:2-alpine
    container_name: caddy
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    networks:
      - seekdb-network

  seekdb:
    # ... (同上)
    networks:
      - seekdb-network

networks:
  seekdb-network:
    driver: bridge

volumes:
  caddy_data:
  caddy_config:
```

创建 `Caddyfile`：

```
seekdb.your-domain.com {
    reverse_proxy seekdb:6333
}
```

然后 Vercel 环境变量中的 `SEEKDB_HOST` 就填 `seekdb.your-domain.com`。

---

## 备份与恢复

### 备份数据

```bash
# 停止容器
docker stop seekdb

# 备份数据目录
tar -czf seekdb-backup-$(date +%Y%m%d).tar.gz ~/seekdb/data

# 重新启动
docker start seekdb
```

### 恢复数据

```bash
# 停止容器
docker stop seekdb

# 清空现有数据
rm -rf ~/seekdb/data/*

# 解压备份
tar -xzf seekdb-backup-YYYYMMDD.tar.gz -C ~/seekdb/

# 重新启动
docker start seekdb
```

---

## 监控与维护

### 查看日志

```bash
docker logs seekdb --tail 100 -f
```

### 检查资源使用

```bash
docker stats seekdb
```

### 更新 SeekDB

```bash
# 拉取最新镜像
docker pull ghcr.io/seek-db/seekdb:latest

# 停止并删除旧容器
docker stop seekdb
docker rm seekdb

# 用相同配置启动新容器
docker run -d \
  --name seekdb \
  --restart unless-stopped \
  -p 6333:6333 \
  -v $(pwd)/data:/var/lib/seekdb \
  -e SEEKDB_ADMIN_PASSWORD=your-existing-password \
  ghcr.io/seek-db/seekdb:latest
```

---

## 故障排除

### 问题：容器无法启动

**检查日志**：
```bash
docker logs seekdb
```

**常见原因**：
- 端口被占用：修改 `-p` 参数使用其他端口
- 权限问题：确保数据目录有写入权限
- 内存不足：检查服务器资源 `free -h`

### 问题：无法从 Vercel 连接

**检查清单**：
1. ✅ 防火墙已开放 6333 端口
2. ✅ 服务器有公网 IP
3. ✅ SeekDB 服务正在运行
4. ✅ 密码正确
5. ✅ 云服务器安全组已添加入站规则

**测试连接**：
```bash
# 从本地测试
curl http://your-server-ip:6333/api/health
```

### 问题：性能慢

**优化建议**：
1. 增加服务器内存到 8GB+
2. 使用 SSD 存储
3. 调整 SeekDB 缓存配置
4. 考虑使用专用数据库服务器

---

## 云服务商推荐

### 经济型（$5-10/月）
- **DigitalOcean**: Basic Droplet 2GB/1CPU
- **Linode**: Nanode 1GB
- **Vultr**: Cloud Compute 2GB

### 性能型（$20-40/月）
- **DigitalOcean**: Premium AMD 4GB/2CPU
- **AWS**: t3.medium
- **Google Cloud**: e2-medium

### 国内（如果需要低延迟）
- **阿里云**: ECS 突发性能型
- **腾讯云**: CVM 标准型
- **华为云**: ECS 通用型

---

## 下一步

部署完成后：
1. 在 Vercel 配置环境变量
2. 重新部署 eywa-chat
3. 测试记忆持久化功能
4. 设置定期备份（建议每周）

**需要帮助？** 把服务器 IP 和遇到的问题发给我，我可以帮你诊断！

---

*最后更新：2026-02-21*
