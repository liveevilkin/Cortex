# Changelog

All notable changes to Cortex will be documented in this file.

## [0.1.0] — 2026-06-19

### MCP Server (TypeScript, 32 files)

**11 Tools + 1 Resource**
- `memory_search` — Hybrid keyword + vector search with dedup and entity-based query expansion
- `memory_ingest` — Vault scanner with delta detection, chunking, entity extraction, graph building
- `memory_status` — System health: token budget, strength distribution, cache anchor
- `memory_entity_extract` — Pattern + dictionary entity extraction (tech, concepts, skills, companies)
- `memory_graph_query` — Multi-hop knowledge graph traversal
- `memory_auto_link` — `[[wikilink]]` suggestions via shared entities
- `memory_monitor` — Proactive conversation context injection
- `memory_conflict_resolve` — Contradiction detection
- `memory_gap_analysis` — Knowledge gaps vs learning goals
- `memory_consolidate` — Decay + archive + relationship pruning
- `memory_session_end` — Portable daily note generator

**Storage**
- SQLite (sql.js): 8 tables — entities, relationships, memory_nodes, wikilinks, node_entities, knowledge_gaps, conversation_turns, metadata
- LanceDB: 384-dim vectors via ONNX (all-MiniLM-L6-v2, hf-mirror.com)
- 30+ entity dictionary terms

### Bash Hooks (5 scripts)
- SessionStart, Stop, PostToolUse, PreCompact, maintenance-scan
- 5 shared libraries: common, strength-calc, conflict-detect, cache-check, token-budget
- 9/9 unit tests passing

### Infrastructure
- Global MCP config (`~/.claude/.mcp.json`)
- Editor configs for Cursor, Windsurf, Cline
- CODE_OF_CONDUCT, SECURITY, CONTRIBUTING, Issue/PR templates
- MIT License
- Conventional commits

### Post-Audit Fixes
- FK enforcement enabled, transaction wrapping, empty query guard
- Duplicate hook removal, temp file PID isolation
- CJK stopwords filter, O(n²) entity cap
- Token estimation consistency (bytes→chars)
