# 🧠 ClaudeCodeMemory

> **Obsidian-based 3-tier memory system for Claude Code — persistent, searchable, graph-linked.**
>
> A "hippocampus" for your AI coding agent: remembers what happened across sessions, surfaces past decisions, and prevents context amnesia.

---

## What's Inside

```
ClaudeCodeMemory/
├── src/hooks/          ← Hook scripts (SessionStart, Stop, PreCompact, PostToolUse)
├── src/lib/            ← Shared libraries (strength, conflict, cache, token utilities)
├── src/templates/      ← File templates (memory-index, daily, decision)
├── skills/             ← Reusable skills (memory-review, memory-search)
├── commands/           ← Slash commands (/memory-status, /memory-force-review)
├── tests/              ← Unit + integration tests
├── docs/               ← Architecture & strategy docs
├── scripts/            ← Installer & migration scripts
├── .github/workflows/  ← CI/CD (lint, test, token-budget)
└── .claude-plugin/     ← Claude Code plugin manifest
```

## Architecture

```
T0 · memory-index.md        ~500 tokens, always loaded
     ├── Current status (1 sentence)
     ├── Recent 3-day summaries
     ├── Top 5 active decisions (by strength)
     └── Pending TODOs

T1 · daily/                 ~2K tokens/day, last 3 days loaded
     ├── Daily conversation summaries
     └── File change logs

T1 · decisions/             On-demand (grep / REST API)
     └── Important decisions, architecture choices

T2 · Obsidian vault         grep-only, never bulk-loaded
     └── Full knowledge base with [[wikilinks]]
```

## Memory Lifecycle

```
SessionStart → load index + recent 3 daily
PostToolUse  → track file changes → session buffer
PreCompact   → save critical state → compact buffer
Stop         → generate daily → update index → refresh MEMORY.md

Bi-weekly:
  Maintenance scan → decay scan → conflict detection → cache check
```

## Quick Start

```bash
# 1. Clone
git clone <repo-url> ClaudeCodeMemory
cd ClaudeCodeMemory

# 2. Install
bash scripts/install.sh

# 3. Verify
bash src/lib/cache-check.sh D:/ObsidianNote/Claude-Code-Memory
```

## Cache Strategy

| Rule | Why |
|------|-----|
| memory-index.md — append only | Protects prompt cache prefix |
| Never edit CLAUDE.md mid-session | 1-character change = full cache miss |
| Static content first, dynamic last | `cache_control` breakpoint strategy |
| Daily writes at Stop only | All writes happen after conversation |

## Key Design Decisions

See [[decisions/memory-architecture-choice]] and [[decisions/obsidian-api-setup]] in the memory vault.

## License

MIT
