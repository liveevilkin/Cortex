# 记忆系统架构设计文档

## 设计目标

为 Claude Code 提供跨会话的持久化记忆能力：
- **启动时自动加载** 最近上下文（3天内对话摘要 + 关键决策）
- **会话中自动追踪** 文件变更和关键操作
- **结束时自动总结** 生成每日摘要并更新索引
- **长期维护** 记忆强度衰减、矛盾检测、定期清理

## 三层记忆架构

| 层级 | 认知类比 | 存储位置 | 加载策略 | Token 开销 |
|------|----------|----------|----------|-----------|
| T0 | 工作记忆 | memory-index.md | 始终加载 | ~500 |
| T1a | 情节记忆 | daily/*.md | 近3天加载 | ~6K |
| T1b | 语义记忆 | decisions/*.md | 按需检索 | 0（固定） |
| T1c | 空间记忆 | moc/*.md | 按需加载 | 0（固定） |
| T2 | 长期知识 | 整个 Obsidian vault | grep 检索 | 0（固定） |

## 工程分离

```
工程源码（Git 管理）          记忆数据（Obsidian vault）
D:\Internship\                D:\ObsidianNote\
  ClaudeCodeMemory/             Claude-Code-Memory/
    hooks/                        daily/
    lib/                          decisions/
    tests/                        moc/
    ...                           metrics/
                                  conflicts/
```

## Hook 数据流

详见 [hook-api-spec.md](hook-api-spec.md)

## 缓存策略

详见 [cache-strategy.md](cache-strategy.md)
