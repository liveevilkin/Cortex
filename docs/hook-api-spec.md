# Hook API 规范

## 生命周期事件

```
SessionStart ──→ [对话进行中] ──→ PreCompact ──→ Stop ──→ SessionEnd
                   │
                   └── PostToolUse（每次工具调用后）
```

## Hook 详细规范

### SessionStart
| 项目 | 说明 |
|------|------|
| **触发** | 会话开始时 |
| **脚本** | `src/hooks/session-start.sh` |
| **输入** | 无 |
| **动作** | 读取 memory-index.md + 近3天 daily + 活跃冲突 |
| **输出** | 上下文文本（stdout → 注入 Claude 上下文） |
| **退出码** | 0 = continue |
| **副作用** | 无（只读） |
| **超时** | 30 秒 |

### PostToolUse
| 项目 | 说明 |
|------|------|
| **触发** | Write/Edit 工具调用后 |
| **脚本** | `src/hooks/post-tool.sh` |
| **输入** | `$1` = 被编辑的文件路径 |
| **动作** | 追加变更记录到 `.session-buffer.md` |
| **退出码** | 0 = continue |
| **副作用** | 写入临时 buffer（gitignored） |
| **缓冲上限** | 200 行（超出时保留最近 100 行） |

### PreCompact
| 项目 | 说明 |
|------|------|
| **触发** | 上下文压缩前 |
| **脚本** | `src/hooks/pre-compact.sh` |
| **输入** | 无 |
| **动作** | 将 session-buffer 中的关键状态写入 compact-buffer |
| **退出码** | 0 = continue |
| **副作用** | 覆盖写入 `.compact-buffer.md` |

### Stop
| 项目 | 说明 |
|------|------|
| **触发** | 每次 Claude 响应完成后 |
| **脚本** | `src/hooks/stop.sh` |
| **输入** | 无（读取 session-buffer + compact-buffer） |
| **动作** | 1. 汇总 buffer → 生成 daily 摘要 2. 更新 memory-index.md（追加）3. 刷新内置 MEMORY.md 指针 4. 清理临时 buffer |
| **退出码** | 0 = continue |
| **副作用** | 写入 daily/ + memory-index.md + MEMORY.md |
| **关键约束** | memory-index.md 只追加不覆盖 |

## 错误处理

| 场景 | 行为 |
|------|------|
| 脚本执行失败 | 返回 0（不阻断 Claude），错误写入 stderr |
| vault 目录不存在 | 创建目录，记录警告 |
| memory-index.md 不存在 | 从模板创建 |
| 缓存锚点丢失 | 记录 CRITICAL 日志，不写入 index |
