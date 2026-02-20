# Git Push Instructions

本地提交已完成，但推送到 GitHub 需要认证。

## 已提交的更改

```bash
commit d01d56f (HEAD -> main)
Fix UI text colors and improve env validation

- Add text-foreground class to all input fields and assistant messages
- Fix duplicate key warning in terminal history rendering
- Update validate-env script to auto-load .env.local with dotenv
- Add dotenv dev dependency for environment variable handling
```

## 推送方法

### 方法 1: 使用 Personal Access Token

```bash
# 设置 Git credential helper
git config --global credential.helper store

# 然后推送（会提示输入 username 和 token）
git push origin main
```

Username: 你的 GitHub 用户名
Password: GitHub Personal Access Token (https://github.com/settings/tokens)

### 方法 2: 临时使用 Token URL

```bash
# 替换 YOUR_TOKEN 为你的 GitHub token
git push https://YOUR_USERNAME:YOUR_TOKEN@github.com/kejun/eywa-chat.git main
```

### 方法 3: 配置 SSH Key

```bash
# 生成 SSH key
ssh-keygen -t ed25519 -C "your_email@example.com"

# 添加公钥到 GitHub: https://github.com/settings/keys

# 切换远程为 SSH
git remote set-url origin git@github.com:kejun/eywa-chat.git

# 推送
git push origin main
```

## 当前状态

- ✅ 本地提交成功
- ⏳ 等待推送到 GitHub
