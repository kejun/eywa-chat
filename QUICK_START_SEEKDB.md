# 🚀 SeekDB 快速部署指南

## 5 分钟快速部署

### 方案 A：一键脚本（最简单）

**1. 准备服务器**
- 任意 Ubuntu 20.04+ 或 Debian 11+ 服务器
- 有公网 IP
- 开放端口：6333

**2. 运行部署脚本**

```bash
# 下载脚本
curl -fsSL https://raw.githubusercontent.com/kejun/eywa-chat/main/scripts/deploy-seekdb.sh -o deploy-seekdb.sh

# 执行部署
sudo bash deploy-seekdb.sh
```

**3. 复制连接信息**

脚本执行完毕后会显示：
```
📋 连接信息：
  Host:     YOUR_SERVER_IP
  Port:     6333
  User:     admin
  Password: [自动生成的密码]
  Database: chatbot_memory
```

**4. 配置 Vercel**

前往 Vercel Dashboard → eywa-chat → Settings → Environment Variables

添加以下 5 个环境变量：
```
SEEKDB_HOST=YOUR_SERVER_IP
SEEKDB_PORT=6333
SEEKDB_USER=admin
SEEKDB_PASSWORD=[上面显示的密码]
SEEKDB_DATABASE=chatbot_memory
```

**5. 重新部署**

在 Vercel 点击 **Redeploy**，等待部署完成。

**6. 测试**

访问你的应用，发送一条消息让 AI 记住某事，刷新页面后检查是否还记得。

---

### 方案 B：Docker Compose（推荐生产环境）

**1. 克隆项目**

```bash
git clone https://github.com/kejun/eywa-chat.git
cd eywa-chat/scripts
```

**2. 配置环境变量**

```bash
cp .env.example .env
nano .env  # 修改 SEEKDB_ADMIN_PASSWORD
```

**3. 启动服务**

```bash
docker-compose up -d
```

**4. 查看状态**

```bash
docker-compose ps
docker-compose logs -f seekdb
```

**5. 获取连接信息**

```bash
# 服务器 IP
curl ifconfig.me

# 查看密码
cat .env
```

---

## 🌐 云服务器推荐

### 经济型（$5-6/月）
| 服务商 | 配置 | 价格 | 链接 |
|--------|------|------|------|
| DigitalOcean | 1GB/1CPU | $6/月 | [digitalocean.com](https://www.digitalocean.com/) |
| Vultr | 1GB/1CPU | $6/月 | [vultr.com](https://www.vultr.com/) |
| Linode | 1GB/1CPU | $5/月 | [linode.com](https://www.linode.com/) |

### 性能型（$12-24/月）
| 服务商 | 配置 | 价格 | 说明 |
|--------|------|------|------|
| DigitalOcean | 2GB/1CPU | $12/月 | 推荐，性价比高 |
| Hetzner | 4GB/2CPU | €5/月 | 欧洲最便宜 |
| AWS Lightsail | 2GB/1CPU | $12/月 | AWS 生态 |

### 国内（低延迟）
| 服务商 | 配置 | 价格 | 备注 |
|--------|------|------|------|
| 阿里云 | 2GB/1CPU | ¥60/月 | 新用户优惠 |
| 腾讯云 | 2GB/1CPU | ¥70/月 | 新用户优惠 |
| 华为云 | 2GB/1CPU | ¥80/月 | - |

---

## 🔧 常用命令

### 管理 SeekDB

```bash
# 查看状态
docker ps | grep seekdb

# 查看日志
docker logs seekdb -f

# 重启服务
docker restart seekdb

# 停止服务
docker stop seekdb

# 启动服务
docker start seekdb

# 查看资源使用
docker stats seekdb
```

### 备份数据

```bash
# 创建备份
tar -czf seekdb-backup-$(date +%Y%m%d).tar.gz /opt/seekdb/data

# 恢复备份
docker stop seekdb
rm -rf /opt/seekdb/data/*
tar -xzf seekdb-backup-YYYYMMDD.tar.gz -C /opt/seekdb/
docker start seekdb
```

### 更新 SeekDB

```bash
# 拉取最新镜像
docker pull ghcr.io/seek-db/seekdb:latest

# 重新部署
docker-compose down
docker-compose up -d
```

---

## ❓ 故障排除

### 问题：脚本执行失败

**解决**：
```bash
# 手动安装 Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# 然后重新运行脚本
sudo bash deploy-seekdb.sh
```

### 问题：无法从 Vercel 连接

**检查清单**：
1. ✅ 服务器有公网 IP
2. ✅ 防火墙开放 6333 端口
3. ✅ 云服务商安全组添加入站规则
4. ✅ 密码正确（区分大小写）

**测试连接**：
```bash
# 本地测试
curl http://localhost:6333/api/health

# 远程测试（从其他服务器）
curl http://YOUR_SERVER_IP:6333/api/health
```

### 问题：内存不足

SeekDB 默认占用约 500MB-1GB 内存。如果服务器内存小于 2GB，建议：

1. 增加 swap 空间：
```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

2. 或升级到更大配置的服务器

---

## 💰 成本估算

### 最低配置（个人使用）
- 服务器：DigitalOcean $6/月
- 域名（可选）：$1/月
- **总计：~$7/月（约 ¥50/月）**

### 推荐配置（小团队）
- 服务器：DigitalOcean $12/月（2GB 内存）
- 域名：$1/月
- 备份存储：$1/月
- **总计：~$14/月（约 ¥100/月）**

---

## 🎯 下一步

部署完成后：

1. ✅ 在 Vercel 配置环境变量
2. ✅ 重新部署 eywa-chat
3. ✅ 测试记忆功能
4. ⏳ 设置每周自动备份
5. ⏳ 配置监控告警（可选）

---

**需要帮助？** 

- 📖 详细文档：`docs/SEEKDB_DEPLOYMENT.md`
- 💬 GitHub Issues: https://github.com/kejun/eywa-chat/issues
- 📧 邮件：[你的联系方式]

---

*最后更新：2026-02-21*
