---
name: memory-review
description: This skill should be used when the user asks to "review memory", "maintain memory", "check memory health", or "clean up old memories". Runs the bi-weekly memory maintenance pipeline.
allowed-tools: ["Bash"]
---

# 🧹 Memory Review — 记忆系统双周维护

## Process
1. Run `bash src/hooks/maintenance-scan.sh`
2. Report findings to user:
   - Files suggested for archival (strength < 0.20)
   - Files suggested for deletion (strength < 0.10)
   - Active contradictions found
   - Cache health status
   - Token budget status
3. Ask user for confirmation on archive/delete suggestions
4. Execute confirmed actions
5. Update `metrics/cache-report.md`

## Gotchas
- Never auto-delete without user confirmation
- Decayed decisions still referenced by daily files → demote, don't delete
- If cache anchor is broken, prioritize fixing it before other maintenance
- Run during idle time, not during active development sessions

## References
- `references/review-checklist.md` — detailed review checklist
