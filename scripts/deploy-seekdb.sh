#!/bin/bash

# SeekDB 一键部署脚本
# 适用于 Ubuntu 20.04+ / Debian 11+

set -e

echo "🚀 SeekDB 一键部署脚本"
echo "======================"
echo ""

# 检查是否以 root 运行
if [ "$EUID" -ne 0 ]; then 
  echo "⚠️  请使用 sudo 运行此脚本"
  echo "   示例：sudo $0"
  exit 1
fi

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 步骤 1: 更新系统
echo -e "${YELLOW}[1/6] 更新系统...${NC}"
apt update && apt upgrade -y
echo -e "${GREEN}✓ 系统更新完成${NC}"
echo ""

# 步骤 2: 安装 Docker
echo -e "${YELLOW}[2/6] 安装 Docker...${NC}"
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    rm get-docker.sh
    echo -e "${GREEN}✓ Docker 安装完成${NC}"
else
    echo -e "${GREEN}✓ Docker 已安装${NC}"
fi
echo ""

# 启动 Docker 服务
systemctl enable docker
systemctl start docker
echo -e "${GREEN}✓ Docker 服务已启动${NC}"
echo ""

# 步骤 3: 创建数据目录
echo -e "${YELLOW}[3/6] 创建数据目录...${NC}"
SEEKDB_DIR="/opt/seekdb"
mkdir -p ${SEEKDB_DIR}/data
mkdir -p ${SEEKDB_DIR}/config
cd ${SEEKDB_DIR}
echo -e "${GREEN}✓ 目录创建完成：${SEEKDB_DIR}${NC}"
echo ""

# 步骤 4: 生成随机密码
echo -e "${YELLOW}[4/6] 生成管理员密码...${NC}"
ADMIN_PASSWORD=$(openssl rand -base64 32)
echo ${ADMIN_PASSWORD} > ${SEEKDB_DIR}/admin-password.txt
chmod 600 ${SEEKDB_DIR}/admin-password.txt
echo -e "${GREEN}✓ 密码已生成并保存到：${SEEKDB_DIR}/admin-password.txt${NC}"
echo -e "${YELLOW}⚠️  请妥善保管此密码！${NC}"
echo ""

# 步骤 5: 拉取并启动 SeekDB
echo -e "${YELLOW}[5/6] 拉取 SeekDB 镜像并启动...${NC}"
docker pull ghcr.io/seek-db/seekdb:latest

docker run -d \
  --name seekdb \
  --restart unless-stopped \
  -p 6333:6333 \
  -v ${SEEKDB_DIR}/data:/var/lib/seekdb \
  -v ${SEEKDB_DIR}/config:/etc/seekdb \
  -e SEEKDB_ADMIN_PASSWORD="${ADMIN_PASSWORD}" \
  -e SEEKDB_HTTP_PORT=6333 \
  ghcr.io/seek-db/seekdb:latest

sleep 3
echo -e "${GREEN}✓ SeekDB 容器已启动${NC}"
echo ""

# 步骤 6: 配置防火墙
echo -e "${YELLOW}[6/6] 配置防火墙...${NC}"
if command -v ufw &> /dev/null; then
    if ufw status | grep -q "inactive"; then
        echo "  启用 UFW 防火墙..."
        ufw --force enable
    fi
    echo "  开放 6333 端口..."
    ufw allow 6333/tcp
    echo -e "${GREEN}✓ UFW 配置完成${NC}"
else
    echo -e "${YELLOW}⚠️  UFW 未安装，跳过防火墙配置${NC}"
    echo "  如需手动配置，请运行："
    echo "  iptables -A INPUT -p tcp --dport 6333 -j ACCEPT"
fi
echo ""

# 验证部署
echo "======================"
echo -e "${GREEN}✅ 部署完成！${NC}"
echo "======================"
echo ""

# 显示连接信息
echo "📋 连接信息："
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 获取服务器 IP
SERVER_IP=$(curl -s ifconfig.me)
if [ -z "$SERVER_IP" ]; then
    SERVER_IP=$(hostname -I | awk '{print $1}')
fi

echo "  Host:     ${SERVER_IP}"
echo "  Port:     6333"
echo "  User:     admin"
echo "  Password: $(cat ${SEEKDB_DIR}/admin-password.txt)"
echo "  Database: chatbot_memory"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Vercel 环境变量
echo "🔧 Vercel 环境变量配置："
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "前往 Vercel Dashboard → eywa-chat → Settings → Environment Variables"
echo ""
echo "添加以下变量："
echo "  SEEKDB_HOST=${SERVER_IP}"
echo "  SEEKDB_PORT=6333"
echo "  SEEKDB_USER=admin"
echo "  SEEKDB_PASSWORD=$(cat ${SEEKDB_DIR}/admin-password.txt)"
echo "  SEEKDB_DATABASE=chatbot_memory"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 测试连接
echo "🧪 测试连接..."
sleep 2
if curl -s http://localhost:6333/api/health > /dev/null 2>&1; then
    echo -e "${GREEN}✓ SeekDB 服务运行正常${NC}"
else
    echo -e "${RED}✗ SeekDB 服务响应异常${NC}"
    echo "  查看日志：docker logs seekdb"
fi
echo ""

# 显示后续步骤
echo "📝 后续步骤："
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "1. 在 Vercel Dashboard 配置上述环境变量"
echo "2. 点击 Redeploy 重新部署 eywa-chat"
echo "3. 测试记忆持久化功能"
echo ""
echo "💡 有用命令："
echo "  查看状态：  docker ps | grep seekdb"
echo "  查看日志：  docker logs seekdb -f"
echo "  停止服务：  docker stop seekdb"
echo "  重启服务：  docker restart seekdb"
echo "  备份数据：  tar -czf seekdb-backup.tar.gz ${SEEKDB_DIR}/data"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo -e "${GREEN}🎉 一切就绪！${NC}"
