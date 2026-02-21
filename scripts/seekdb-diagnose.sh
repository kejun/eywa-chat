#!/bin/bash
# SeekDB 服务器端诊断脚本
# 用法：在云服务器上执行此脚本，或复制命令手动执行

set -e

echo "=== SeekDB 服务器端诊断 ==="
echo ""

# 1. 检查 Docker 容器状态
echo "1. Docker 容器状态:"
docker ps | grep seekdb || echo "   ❌ SeekDB 容器未运行"
echo ""

# 2. 检查端口监听
echo "2. 端口监听状态 (2881):"
ss -tlnp | grep 2881 || netstat -tlnp | grep 2881 || echo "   ❌ 端口 2881 未监听"
echo ""

# 3. 测试本地连接
echo "3. 本地连接测试:"
docker exec seekdb mysql -u admin -e "SELECT 1 as test;" && echo "   ✅ MySQL 连接成功" || echo "   ❌ MySQL 连接失败"
echo ""

# 4. 检查数据库
echo "4. 数据库列表:"
docker exec seekdb mysql -u admin -e "SHOW DATABASES;" | grep chatbot || echo "   ❌ chatbot_memory 数据库不存在"
echo ""

# 5. 检查表和记录数
echo "5. 记忆表统计:"
docker exec seekdb mysql -u admin chatbot_memory -e "SELECT COUNT(*) as count FROM memories;" 2>/dev/null || echo "   ⚠️ 无法查询 memories 表"
echo ""

# 6. 查看最新 5 条记忆
echo "6. 最新 5 条记忆:"
docker exec seekdb mysql -u admin chatbot_memory -e "SELECT id, LEFT(content, 50) as content_preview, memory_type FROM memories ORDER BY created_at DESC LIMIT 5;" 2>/dev/null || echo "   ⚠️ 无法查询记忆数据"
echo ""

# 7. 检查向量索引
echo "7. 向量索引状态:"
docker exec seekdb mysql -u admin chatbot_memory -e "SHOW INDEX FROM memories WHERE Key_name LIKE '%vector%';" 2>/dev/null || echo "   ⚠️ 无法检查索引"
echo ""

# 8. 测试 SeekDB HTTP API（如果可用）
echo "8. SeekDB HTTP API 测试:"
curl -s http://localhost:2881/api/health 2>/dev/null && echo "" || echo "   ⚠️ HTTP API 不可用"
echo ""

# 9. 检查防火墙规则
echo "9. 防火墙规则:"
if command -v ufw &> /dev/null; then
    ufw status | grep 2881 || echo "   UFW: 2881 端口未明确允许"
elif command -v iptables &> /dev/null; then
    iptables -L -n | grep 2881 || echo "   iptables: 无 2881 相关规则"
else
    echo "   ℹ️  无法检测防火墙（需要 ufw 或 iptables）"
fi
echo ""

# 10. 测试公网可达性（从服务器自身）
echo "10. 公网 IP 连接测试:"
SERVER_IP=$(curl -s ifconfig.me || echo "unknown")
echo "    服务器公网 IP: $SERVER_IP"
timeout 2 curl -s http://$SERVER_IP:2881/api/health 2>/dev/null && echo "   ✅ 公网 IP 可访问" || echo "   ❌ 公网 IP 无法访问（可能是安全组/防火墙问题）"
echo ""

echo "=== 诊断完成 ==="
echo ""
echo "💡 如果第 10 步失败，请在云服务商控制台添加安全组规则："
echo "   - 协议：TCP"
echo "   - 端口：2881"
echo "   - 授权对象：0.0.0.0/0"
echo "   - 策略：允许"
