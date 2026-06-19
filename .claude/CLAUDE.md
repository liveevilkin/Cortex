# Claude Code Memory System

This project has a dual memory system: bash hooks (automatic session tracking) + MCP server (semantic search, knowledge graph, proactive context).

## Session Lifecycle (automatic)
- **Start**: SessionStart hook loads `memory-index.md` + recent daily logs
- **During**: PostToolUse tracks file edits, PreCompact saves state before compaction
- **End**: Stop hook generates daily note + updates memory-index

## MCP Memory Tools (use as needed)

Run `memory_ingest` at the start of each session to index any new vault files.
Then use these tools proactively:

### Finding information
- `memory_search` — keyword + semantic search over all vault memories. Use instead of grep for concept-level queries
- `memory_graph_query` — explore how entities/concepts connect across your vault
- `memory_entity_extract` — extract technologies, skills, companies from any text

### Proactive context
- `memory_monitor` — when the user shifts topics, call this to get "this reminds me of..." context from past memories. Pass the user's message text
- `memory_auto_link` — suggest `[[wikilinks]]` for a vault note to build your Obsidian graph

### Analysis & maintenance
- `memory_status` — full system health: token counts, entity stats, strength distribution
- `memory_gap_analysis` — compare learning goals vs actual knowledge coverage
- `memory_conflict_resolve` — check if a statement contradicts existing memories
- `memory_consolidate` — run maintenance: apply decay, find archive candidates

### Recommended session flow
1. Session start → call `memory_monitor` with the user's first topic to get proactive context
2. During conversation → call `memory_monitor` when topics shift
3. Before answering → call `memory_search` for relevant past decisions
4. Periodically → call `memory_status` to check system health

## Caveats
- Do NOT edit `memory-index.md` during a session (breaks prompt cache)
- Do NOT edit this CLAUDE.md during a session
- Let Stop hook handle all memory writes automatically
- `memory_ingest` writes to the vault only at ingest time (safe for cache anchor)
- Embedding model unavailable until `sharp` native module is fixed → keyword search works fine
