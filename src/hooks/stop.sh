#!/usr/bin/env bash
# stop.sh — Stop hook
# Generates daily summary, updates memory-index.md, refreshes MEMORY.md pointers
# Trigger: Stop (after each Claude response)
# Returns: 0 = continue

set -euo pipefail

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
source "$PLUGIN_ROOT/src/lib/common.sh"

main() {
    log "Stop: processing session data..."

    local today
    today=$(today_iso)
    local daily_file="$MEMORY_VAULT/daily/$today.md"

    # === 1. Collect session data ===
    local session_data=""
    if [ -f "$SESSION_BUFFER" ]; then
        session_data=$(cat "$SESSION_BUFFER")
    fi

    local compact_data=""
    if [ -f "$COMPACT_BUFFER" ]; then
        compact_data=$(cat "$COMPACT_BUFFER")
    fi

    # Count file changes
    local file_change_count
    file_change_count=$(echo "$session_data" | grep -c "编辑:" 2>/dev/null || echo 0)

    # === 2. Generate file changes summary ===
    local changed_files=""
    if [ "$file_change_count" -gt 0 ]; then
        changed_files=$(echo "$session_data" | grep "编辑:" | sed 's/.*`\(.*\)`/\1/' | sort -u | head -20)
    fi

    # === 3. Update daily file (if it already exists, append; if not, create) ===
    if [ ! -f "$daily_file" ]; then
        log "Creating new daily file: $today"

        cat > "$daily_file" << EOF
---
date: $today
tags: [daily-memory]
summary: "新会话"
strength: $INITIAL_STRENGTH
last_reinforced: $today
decay_curve: ebbinghaus
links: []
contradictions: []
files_changed: []
---

# $today

## 做了什么
(由 Stop hook 自动填充)

## 关键发现


## 下一步


## 重要文件变更
$([ -n "$changed_files" ] && echo "$changed_files" | while read -r f; do echo "- $f"; done || echo "(无)")
EOF
    else
        log "Daily file exists, appending file changes"
        # Append file changes section if there are new ones
        if [ -n "$changed_files" ]; then
            echo "" >> "$daily_file"
            echo "## 本次文件变更 ($(date '+%H:%M'))" >> "$daily_file"
            echo "$changed_files" | while read -r f; do echo "- $f"; done >> "$daily_file"
        fi
    fi

    # === 4. Update memory-index.md (append only — CRITICAL for cache) ===
    local index_file="$MEMORY_VAULT/memory-index.md"
    if [ -f "$index_file" ]; then
        # Update the "updated" date in frontmatter
        # Use a temp file approach to avoid corrupting the index
        local tmp_index="$BUFFER_DIR/.memory-index-tmp-$$.md"

        # Update the updated field and recent entries
        sed "s/^updated: .*/updated: $today/" "$index_file" > "$tmp_index"

        # Check if today is already in the recent dynamics table
        if ! grep -q "daily/$today" "$tmp_index"; then
            # Add today's entry to the recent dynamics table (after the last row)
            # This is an append-only operation at the content level
            local new_row="| $today | 新会话 | [[daily/$today]] |"
            # Insert before the closing "## 活跃决策" section
            if grep -q "^## 活跃决策" "$tmp_index"; then
                sed -i "/^## 活跃决策/i $new_row" "$tmp_index"
            fi
        fi

        # Validate cache anchor still intact
        if grep -q "CACHE_ANCHOR: memory-index-v1" "$tmp_index"; then
            mv "$tmp_index" "$index_file"
            log "Updated memory-index.md (append-only, cache anchor intact)"
        else
            log "CRITICAL: Cache anchor lost during index update — aborting index write"
            rm -f "$tmp_index"
        fi
    fi

    # === 5. Refresh built-in MEMORY.md pointers ===
    # Derive path from CWD (project dir) rather than hardcoding
    local project_slug
    project_slug=$(echo "${PWD:-$(pwd)}" | sed 's/[^a-zA-Z0-9]/-/g' | sed 's/-\+/-/g' | tr '[:upper:]' '[:lower:]')
    local builtin_memory="$HOME/.claude/projects/${project_slug}/memory/MEMORY.md"
    if [ -d "$(dirname "$builtin_memory")" ]; then
        cat > "$builtin_memory" << EOF
## Active Context
- 上次会话: $today
- 记忆系统: ClaudeCodeMemory v1.0

## Quick Pointers
- 📋 记忆索引: [[Claude-Code-Memory/memory-index]]
- 📅 今日摘要: [[Claude-Code-Memory/daily/$today]]
- 🧠 关键决策: [[Claude-Code-Memory/decisions/]]
- 🗺️ 项目状态: [[Claude-Code-Memory/moc/project-status]]
- 📊 缓存监控: [[Claude-Code-Memory/metrics/cache-report]]
- ⚠️ 活跃冲突: [[Claude-Code-Memory/conflicts/active-conflicts]]

## Search Tips
- 查找历史: \`grep "关键词" $MEMORY_VAULT/daily/*.md\`
- Obsidian 搜索: 在 vault 中使用全文搜索
- 记忆状态: 运行 \`/memory-status\`
EOF
        log "Refreshed built-in MEMORY.md pointers"
    fi

    # === 6. Cleanup session buffers ===
    rm -f "$SESSION_BUFFER" "$COMPACT_BUFFER"
    log "Cleaned up session buffers"

    # === 7. Quick validation ===
    local index_tokens
    index_tokens=$(estimate_tokens "$(read_file "$index_file")")
    if [ "$index_tokens" -gt 1000 ]; then
        log "WARNING: memory-index.md is ~$index_tokens tokens (budget: 1000)"
    fi

    log "Stop: complete (daily: $daily_file, index: ${index_tokens}t, changes: $file_change_count)"
}

main "$@"
exit 0
