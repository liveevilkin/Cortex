# 维护手册

## 日常（每次 Stop 自动执行）

- [x] 生成 daily 摘要
- [x] 更新 memory-index.md
- [x] 刷新 MEMORY.md 指针
- [x] 清理临时 buffer

## 每周（建议人工 + AI 辅助）

- [ ] 运行 `/memory-force-review` 或 `bash src/hooks/maintenance-scan.sh`
- [ ] 检查 metrics/cache-report.md 缓存命中趋势
- [ ] 处理 conflicts/active-conflicts.md 中的未解决冲突
- [ ] 确认 decisions/ 无过期内容

## 每月

- [ ] 运行完整测试套件：`npm test`
- [ ] 检查 Hook 脚本运行日志（如有异常）
- [ ] 审查并更新 CLAUDE.md 内容
- [ ] 更新依赖（如有）

## 版本升级

1. 阅读 CHANGELOG.md 了解变更
2. 运行 `bash scripts/migrate-v1-to-v2.sh`（如提供）
3. 运行测试确认无回归
4. 更新版本号

## 备份策略

- Obsidian vault 建议开启 Git 同步
- 定期推送 `D:\ObsidianNote\` 到远程仓库
- `Claude-Code-Memory/` 是 vault 子目录，自动纳入备份

## 故障恢复

| 问题 | 恢复方法 |
|------|----------|
| memory-index.md 损坏 | 从 `src/templates/memory-index-template.md` 重建 |
| daily 文件丢失 | 从 git 历史恢复 |
| 缓存锚点丢失 | 手动添加 `<!-- CACHE_ANCHOR: memory-index-v1 -->` |
| Hook 不执行 | 检查 `.claude-plugin/plugin.json` 语法 |
