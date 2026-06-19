# 贡献指南

## 分支策略

- `main` — 稳定发布版
- `develop` — 开发集成分支
- `feat/<name>` — 新功能
- `fix/<name>` — 修复
- `docs/<name>` — 文档

## Commit 规范

使用 Conventional Commits：
```
feat(hooks): add session-start.sh
fix(stop): prevent index overwrite on cache anchor loss
docs(readme): add architecture diagram
test(strength): add decay edge case tests
```

## PR 流程

1. 从 `develop` 创建功能分支
2. 编写代码 + 测试
3. 本地运行 `npm test` 确保通过
4. 提交 PR 到 `develop`
5. PR 模板：
   - **What**: 做了什么
   - **Why**: 为什么做
   - **How**: 怎么做的
   - **Test**: 如何测试

## 代码规范

- Shell 脚本：遵循 Google Shell Style Guide
- 使用 `shellcheck` 静态分析
- 函数注释：每个函数上方一行说明
- 错误处理：`set -euo pipefail` 在所有脚本开头

## 测试要求

- 新增 Hook 脚本 → 必须包含单元测试
- 修改 lib/ 函数 → 必须更新相关测试
- PR 必须通过 CI 中的所有检查
