# Real Loadtest Execution Checklist (Issue #26 Closure)

> 目标：在预发/生产前完成可复现压测，产出可审计报告，用于关闭 #26 与 Epic #7。

---

## 1. 前置条件

- [ ] 已部署目标环境（建议先 Preview，再 Production）
- [ ] 以下环境变量已配置并生效：
  - `AUTH_JWT_SECRET`
  - `AUTH_TENANT_CLAIM`
  - `AUTH_USER_CLAIM`
  - `ALLOW_INSECURE_CONTEXT=0`
- [ ] `GET /api/health` 返回 200
- [ ] `POST /api/chat` 可通过 JWT 鉴权

---

## 2. 执行命令（推荐：多场景一键）

```bash
npm run loadtest:scenarios -- \
  --url "https://<preview-domain>/api/chat" \
  --tenant-id "t-loadtest" \
  --user-id "u-loadtest" \
  --report-dir "./artifacts/loadtest-scenarios"
```

> 若本地无 `AUTH_JWT_SECRET`，可附带 `--secret "<AUTH_JWT_SECRET>"`。

---

## 3. 预设场景与阈值

| Scenario | Requests | Concurrency | Success Rate | P95 Total | P95 First Token |
|---|---:|---:|---:|---:|---:|
| smoke | 20 | 2 | >= 100% | <= 8000ms | <= 2500ms |
| baseline | 100 | 10 | >= 99% | <= 6000ms | <= 2000ms |
| stress | 300 | 30 | >= 95% | <= 10000ms | <= 3500ms |

---

## 4. 产物检查

执行成功后，检查 `report-dir` 目录：

- [ ] `smoke-summary.json` + `smoke-report.md`
- [ ] `baseline-summary.json` + `baseline-report.md`
- [ ] `stress-summary.json` + `stress-report.md`
- [ ] `OVERVIEW.md`（汇总与 PASS/FAIL 结论）
- [ ] `ISSUE-26-CLOSURE.md`（关单草稿）
- [ ] `ISSUE-26-COMMENT.md`（可直接粘贴 issue 评论）
- [ ] `ISSUE-26-CLOSE-COMMANDS.sh`（关单命令脚本）

生成关单草稿：

```bash
npm run issue26:prepare -- \
  --report-dir "./artifacts/loadtest-scenarios"
```

生成最终 3 步关单清单：

```bash
npm run issue26:finalize -- \
  --report-dir "./artifacts/loadtest-scenarios"
```

---

## 5. 人工复核项

- [ ] `OVERVIEW.md` 中所有场景均 PASS
- [ ] 失败样本（若有）已按 traceId 定位根因
- [ ] 异常是否来自外部依赖（模型/数据库）已标注
- [ ] 是否需要调整限流、并发、超时阈值已记录

---

## 6. 收口动作（Issue）

1. 先在 issue #26 贴上：
   - `ISSUE-26-CLOSURE.md` 内容（优先）
   - `ISSUE-26-COMMENT.md`（可直接粘贴）
   - `OVERVIEW.md` 结论（补充）
   - 各场景 markdown 报告路径
2. 参考 `ISSUE-26-FINAL-STEPS.md` 执行命令。
3. 若全部 PASS，关闭：
   - `#26`
   - Epic `#7`

管理员命令示例：

```bash
gh issue close 26
gh issue close 7
```

---

## 7. 失败回退策略

若任一场景 FAIL：

1. 保留当前 artifacts（不可覆盖）
2. 在 issue #26 追加失败原因与 traceId 样本
3. 修复后重新执行：

```bash
npm run loadtest:scenarios -- \
  --url "https://<preview-domain>/api/chat" \
  --tenant-id "t-loadtest" \
  --user-id "u-loadtest" \
  --report-dir "./artifacts/loadtest-scenarios-rerun-<timestamp>"
```
