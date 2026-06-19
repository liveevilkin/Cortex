#!/usr/bin/env bash
# session-start.sh — SessionStart hook
# Loads memory-index.md + latest 3 daily/*.md into context
# Trigger: SessionStart
# Returns: 0 = continue

set -euo pipefail

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
source "$PLUGIN_ROOT/src/lib/common.sh"

main() {
    log "SessionStart: loading memory context..."

    local output=""

    # === T0: Load memory-index.md (always) ===
    if [ -f "$MEMORY_VAULT/memory-index.md" ]; then
        output+=$(cat "$MEMORY_VAULT/memory-index.md")
        output+=$'\n\n'
        log "Loaded memory-index.md ($(estimate_tokens "$(cat "$MEMORY_VAULT/memory-index.md")") tokens)"
    else
        log "WARNING: memory-index.md not found at $MEMORY_VAULT/memory-index.md"
    fi

    # === T1: Load recent 3 daily files ===
    local daily_dir="$MEMORY_VAULT/daily"
    if [ -d "$daily_dir" ]; then
        local recent_files
        recent_files=$(ls -t "$daily_dir"/*.md 2>/dev/null | head -3)
        if [ -n "$recent_files" ]; then
            output+="---"$'\n'
            output+="## 最近对话摘要"$'\n'
            for f in $recent_files; do
                local fname
                fname=$(basename "$f")
                output+="### $fname"$'\n'
                output+=$(cat "$f")$'\n'
                output+=$'\n'
            done
            log "Loaded $(echo "$recent_files" | wc -l) daily files"
        fi
    fi

    # === T1: Load active conflicts if any ===
    local conflicts_file="$MEMORY_VAULT/conflicts/active-conflicts.md"
    if [ -f "$conflicts_file" ]; then
        local conflict_count
        conflict_count=$(grep -c "^### 冲突" "$conflicts_file" 2>/dev/null || echo 0)
        if [ "$conflict_count" -gt 0 ]; then
            output+="---"$'\n'
            output+="## ⚠️ 活跃冲突 ($conflict_count 个未解决)"$'\n'
            output+=$(cat "$conflicts_file")$'\n'
        fi
    fi

    # === Cache anchor validation ===
    if [ -f "$MEMORY_VAULT/memory-index.md" ]; then
        if ! check_cache_anchor "$MEMORY_VAULT/memory-index.md" "memory-index-v1"; then
            output+="[!] 缓存锚点异常，请检查 memory-index.md"$'\n'
        fi
    fi

    # === Output to Claude context ===
    echo "$output"

    log "SessionStart: complete"
}

main "$@"
exit 0
