#!/usr/bin/env python3
"""
SeekDB 连接测试脚本
测试不同的用户名组合
"""

import mysql.connector
import sys

config = {
    'host': '43.160.241.135',
    'port': 2881,
    'password': '',
    'connect_timeout': 10,
    'database': 'chatbot_memory'
}

users_to_test = ['root', 'admin']

print("=== SeekDB 连接测试 ===\n")
print(f"目标：{config['host']}:{config['port']}/{config['database']}\n")

for user in users_to_test:
    print(f"测试用户：{user}")
    try:
        conn = mysql.connector.connect(user=user, **config)
        cursor = conn.cursor()
        cursor.execute("SELECT 1 as test, VERSION() as version")
        result = cursor.fetchone()
        print(f"  ✅ 连接成功！版本：{result[1]}")
        
        # 测试查询数据库
        cursor.execute("SHOW TABLES")
        tables = cursor.fetchall()
        print(f"  📊 数据库中的表数量：{len(tables)}")
        
        if tables:
            print(f"     表列表：{', '.join([t[0] for t in tables[:5]])}")
        
        cursor.close()
        conn.close()
        print()
        break  # 成功后退出
        
    except mysql.connector.errors.Error as e:
        print(f"  ❌ 失败：{e}")
        print()
    except Exception as e:
        print(f"  ❌ 未知错误：{e}")
        print()

print("=== 测试完成 ===")
