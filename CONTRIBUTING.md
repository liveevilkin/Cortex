# Contributing to Cortex

Thanks for your interest in contributing!

## Development Setup

```bash
git clone https://github.com/liveevilkin/Cortex.git
cd Cortex

# MCP Server (TypeScript)
cd mcp-server
npm install --ignore-scripts
npx tsc          # Build

# Run tests
npm test                              # MCP server smoke tests
cd .. && bash tests/unit/test-hooks.sh   # Bash hook tests
```

## Project Structure

```
Cortex/
├── mcp-server/          ← TypeScript MCP server (main codebase)
│   ├── src/tools/       ← MCP tool implementations
│   ├── src/graph/       ← Knowledge graph, decay, gap detection
│   ├── src/ingest/      ← Vault scanning, chunking, entity extraction
│   ├── src/embeddings/  ← ONNX embedding pipeline
│   └── src/db/          ← SQLite + LanceDB
├── src/hooks/           ← Bash lifecycle hooks
├── src/lib/             ← Bash utilities
└── tests/               ← Hook tests
```

## Code Style

### TypeScript (mcp-server/)
- Strict mode enabled in `tsconfig.json`
- Use `import`/`export` (ESM)
- All MCP tool parameters must use Zod schemas
- Prefer async/await over raw promises
- Run `npx tsc --noEmit` before committing

### Bash (src/hooks/, src/lib/)
- `set -euo pipefail` in all scripts
- Source `common.sh` for shared utilities
- Use `[[ ]]` for tests, not `[ ]`
- Quote all variable expansions
- Run `shellcheck` on changed scripts

## 分支策略 / Branch Strategy

- `master` — 稳定发布版 / Stable releases
- `feat/<name>` — 新功能 / New feature
- `fix/<name>` — 修复 / Bug fix
- `docs/<name>` — 文档 / Documentation

## Commit Convention

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add memory_monitor proactive context
fix: handle empty query in memory_search
docs: update README with editor configs
refactor: extract entity extraction to shared module
test: add smoke test for session_end tool
```

## 添加 MCP 工具 / Adding a New MCP Tool

1. Create `mcp-server/src/tools/memory-your-tool.ts`
2. Export a Zod schema object and a handler function
3. Register in `mcp-server/src/server.ts`
4. Add a test in `mcp-server/tests/`

```typescript
// Template
import { z } from "zod";

export const myToolSchema = {
  name: "my_tool",
  description: "What it does.",
  inputSchema: {
    param: z.string().describe("Parameter description."),
  },
};

export async function myToolHandler(args: { param: string }) {
  // Implementation
  return { content: [{ type: "text", text: "Result" }] };
}
```

## PR 流程 / Pull Request Process

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/my-feature`)
3. Make your changes
4. Run `npx tsc --noEmit` and `bash tests/unit/test-hooks.sh`
5. Commit using conventional commit messages
6. Push and open a PR against `master`

## 测试要求 / Testing

- 新增 MCP 工具 → 冒烟测试 / New tool → smoke test
- 修改 Hook 脚本 → 单元测试 / Modified hook → unit test
- 修改 lib/ 函数 → 更新相关测试 / Modified lib → update tests

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
