# 🧠 Cortex — Proactive Memory Agent for AI Coding Assistants

> Obsidian-backed knowledge graph with semantic search, entity extraction, and cross-session memory. 11 MCP tools. Works with Claude Code, Cursor, Windsurf, and any MCP-compatible editor.

---

## What It Does

```
You: "How does the memory system handle forgetting?"
Cortex: 💡 This reminds me of your previous work on:
       1. decisions/memory-architecture-choice — Ebbinghaus decay with 14-day half-life
       2. daily/2026-06-19 — You designed the three-tier memory architecture
       3. moc/system-architecture — Full system diagram
```

- **Semantic search** — Find concepts across languages (EN query → CN content)
- **Knowledge graph** — 928 entities, 106K relationships, auto-extracted from your notes
- **Proactive context** — `memory_monitor` watches conversation topics, surfaces relevant memories
- **Gap analysis** — Compare your learning goals against actual knowledge coverage
- **Cross-session** — Every session loads your memory index + recent daily logs automatically

## Architecture

```
MCP Client (Claude Code / Cursor / Windsurf)
       │  stdio JSON-RPC
       ▼
┌─────────────────────────────────┐
│  Cortex MCP Server (TypeScript) │
│  11 tools + 1 resource          │
│  ┌───────────────────────────┐  │
│  │ SQLite (sql.js)           │  │  ← Knowledge graph (8 tables)
│  │ LanceDB                   │  │  ← Vector embeddings (384-dim)
│  │ ONNX (all-MiniLM-L6-v2)   │  │  ← Local, zero API cost
│  └───────────────────────────┘  │
└──────────────┬──────────────────┘
               │ reads & indexes
               ▼
┌─────────────────────────────────┐
│  Obsidian Vault (source of truth)│
│  daily/  decisions/  moc/       │
│  学习计划/  ...                  │
└─────────────────────────────────┘
```

## Quick Start

```bash
# 1. Install
cd Cortex/mcp-server
npm install --ignore-scripts
npx tsc

# 2. Configure (Claude Code)
# Copy the MCP config to your global Claude Code settings:
# ~/.claude/.mcp.json

# 3. Use
# Start a Claude Code session. The MCP server starts automatically.
# Say: "memory_ingest" to index your vault
# Say: "search for architecture decisions" to find memories
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `memory_search` | Hybrid keyword + vector semantic search |
| `memory_ingest` | Scan vault, extract entities, build index |
| `memory_status` | System health report |
| `memory_entity_extract` | Extract typed entities from text |
| `memory_graph_query` | Query the knowledge graph (multi-hop) |
| `memory_auto_link` | Suggest `[[wikilinks]]` between notes |
| `memory_monitor` | Process conversation, return proactive context |
| `memory_conflict_resolve` | Detect contradictions with existing memories |
| `memory_gap_analysis` | Analyze knowledge gaps vs learning goals |
| `memory_consolidate` | Apply decay, find archive candidates |
| `memory_session_end` | Generate daily note (portable Stop hook) |

## Editor Support

| Editor | Setup |
|--------|-------|
| **Claude Code** | `~/.claude/.mcp.json` (global) or `.mcp.json` (project) |
| **Cursor** | Copy `editors/cursor.mcp.json` → `.cursor/mcp.json` |
| **Windsurf** | Copy `editors/windsurf.mcp.json` |
| **Cline / VS Code** | Copy `editors/cline.mcp.json` |

## Project Structure

```
Cortex/
├── mcp-server/               ← TypeScript MCP server (32 source files)
│   ├── src/
│   │   ├── tools/            ← 11 MCP tools
│   │   ├── graph/            ← Knowledge graph + decay + gap detection
│   │   ├── ingest/           ← Vault scanner, chunker, entity extractor
│   │   ├── embeddings/       ← ONNX pipeline (all-MiniLM-L6-v2)
│   │   ├── db/               ← SQLite + LanceDB
│   │   └── resources/        ← MCP resource endpoints
│   ├── editors/              ← Config templates for other editors
│   └── tests/
├── src/
│   ├── hooks/                ← Bash hooks (SessionStart, Stop, etc.)
│   ├── lib/                  ← Bash utilities
│   └── templates/            ← Vault file templates
├── skills/                   ← Claude Code skills
├── commands/                 ← Slash commands
├── docs/                     ← Architecture docs
└── tests/                    ← Hook tests
```

## License

MIT — see [LICENSE](LICENSE)
