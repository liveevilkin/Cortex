# Changelog

## [1.0.0] — 2026-06-19

### Added
- 三层记忆架构：T0 (memory-index) + T1 (daily/decisions/moc) + T2 (vault knowledge)
- 4 个核心 Hook 脚本：SessionStart, PostToolUse, PreCompact, Stop
- 记忆强度衰减系统（艾宾浩斯遗忘曲线）
- 矛盾检测 `[!contradiction]` 机制
- 缓存锚点保护与验证
- Token 预算检查工具
- 双周维护扫描脚本
- 2 个 Skill：memory-review, memory-search
- 2 个 Command：/memory-status, /memory-force-review
- 完整文档套件：README, CONTRIBUTING, MAINTENANCE, architecture
- CI/CD workflows：lint, test, token-budget
- 一键安装脚本
- Claude Code 插件配置

### Design Decisions
- 工程源码与记忆数据分离（D:\Internship\ClaudeCodeMemory vs D:\ObsidianNote\Claude-Code-Memory）
- MEMORY.md 作为指针索引，不存储具体知识
- memory-index.md 只追加不覆盖（保护缓存前缀）
- Shell 脚本实现（零依赖，跨平台兼容）
