# 记忆系统维护检查清单

## 每次维护必查
- [ ] memory-index.md 缓存锚点完整
- [ ] 近3天 daily 文件存在且可读
- [ ] decisions/ 文件无超期未更新
- [ ] conflicts/active-conflicts.md 与实际情况一致

## 衰减处理决策树
```
strength > 0.50  → 保留，强化
strength 0.20-0.50 → 保留，观察
strength 0.10-0.20 → 建议归档，等待确认
strength < 0.10  → 建议删除，等待确认
```

## 合并规则
- 同一主题有 3+ daily 条目 → 提取到 decisions/
- 2+ decisions 讨论同一问题 → 合并并标记 superseded
- daily 中重复的"下一步"超过 2 周未完成 → 标记为 stale

## 清理规则
- daily 超过 60 天且 strength < 0.10 → 可安全删除
- decisions 标记 superseded 超过 30 天 → 可归档
- 未被任何 [[链接]] 引用的孤立 decisions → 提示复核
