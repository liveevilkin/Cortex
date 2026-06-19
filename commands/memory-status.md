---
name: memory-status
description: Show current memory system health — index size, active memories, cache status, token budget
---

# /memory-status

Show memory system health at a glance:

```bash
echo "=== 🧠 记忆系统状态 ==="
echo ""
echo "📋 Index: $(cat D:/ObsidianNote/Claude-Code-Memory/memory-index.md | wc -c) bytes"
echo "📅 Daily files: $(ls D:/ObsidianNote/Claude-Code-Memory/daily/*.md 2>/dev/null | wc -l)"
echo "💡 Decisions: $(ls D:/ObsidianNote/Claude-Code-Memory/decisions/*.md 2>/dev/null | wc -l)"
echo "⚠️  Conflicts: $(grep -c 'unresolved' D:/ObsidianNote/Claude-Code-Memory/conflicts/active-conflicts.md 2>/dev/null || echo 0)"
echo ""
echo "See metrics/ for detailed cache report."
```
