---
name: memory-search
description: This skill should be used when the user asks to "search memory", "find in memory", "what did we do about X", or "recall context about Y". Uses grep + Obsidian REST API hybrid search.
allowed-tools: ["Bash", "Read"]
---

# 🔍 Memory Search — 混合检索

## Process
1. Parse user query for keywords and intent
2. First pass: grep exact keyword match in daily/ + decisions/
3. Second pass (if first yields low results): Obsidian REST API semantic search
4. Third pass (if context needed): follow [[wikilinks]] from matched files
5. Aggregate and present results with source links

## Search Strategy
- **Specific terms** (dates, APIs, names) → grep first (fast, zero tokens)
- **Conceptual queries** ("what was that decision about...") → REST API search
- **Related context** ("what else is connected to...") → wikilink graph traversal

## Gotchas
- grep search is case-sensitive by default; use `-i` for case-insensitive
- Obsidian REST API requires Obsidian to be running
- Daily files are in `Claude-Code-Memory/daily/`, decisions in `Claude-Code-Memory/decisions/`
- User knowledge base is at vault root (个人简历, 面试问答, etc.)
