#!/usr/bin/env bash
# common.sh — shared utilities for ClaudeCodeMemory hooks
# Source this file: source "$(dirname "$0")/../lib/common.sh"

set -euo pipefail

# === Path resolution ===
# CLAUDE_PLUGIN_ROOT is set by Claude Code when running hooks
# Fallback: derive from script location
if [ -z "${CLAUDE_PLUGIN_ROOT:-}" ]; then
    SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
    PLUGIN_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
else
    PLUGIN_ROOT="$CLAUDE_PLUGIN_ROOT"
fi

# Memory vault path — where data is stored in Obsidian
MEMORY_VAULT="${CLAUDE_CODE_MEMORY_VAULT:-D:/ObsidianNote/Claude-Code-Memory}"

# Temp buffer files (session-scoped, gitignored)
BUFFER_DIR="$PLUGIN_ROOT/.claude"
SESSION_BUFFER="$BUFFER_DIR/.session-buffer.md"
COMPACT_BUFFER="$BUFFER_DIR/.compact-buffer.md"

# Ensure buffer directory exists
mkdir -p "$BUFFER_DIR"

# === Logging ===
log() {
    echo "[ClaudeCodeMemory] $(date '+%H:%M:%S') $*" >&2
}

# === File helpers ===
# Append a line to a file (idempotent-safe)
append_line() {
    local file="$1"
    local line="$2"
    echo "$line" >> "$file"
}

# Read file if exists, else empty
read_file() {
    local file="$1"
    if [ -f "$file" ]; then
        cat "$file"
    fi
}

# Get date in ISO format
today_iso() {
    date '+%Y-%m-%d'
}

# Get files modified today
files_changed_today() {
    local dir="$1"
    find "$dir" -type f -name "*.md" -newermt "$(today_iso)" 2>/dev/null || true
}

# === Strength calculation ===
# Default initial strength
INITIAL_STRENGTH=1.0

# Calculate decayed strength based on days since last reinforcement
# Ebbinghaus-like curve: strength = initial * e^(-days/14)
calc_strength() {
    local last_reinforced="$1"
    local current_strength="$2"

    # Days since last reinforcement
    local last_epoch
    local now_epoch
    last_epoch=$(date -d "$last_reinforced" '+%s' 2>/dev/null || date -j -f '%Y-%m-%d' "$last_reinforced" '+%s' 2>/dev/null || echo 0)
    now_epoch=$(date '+%s')

    if [ "$last_epoch" = "0" ]; then
        echo "$current_strength"
        return
    fi

    local days=$(( (now_epoch - last_epoch) / 86400 ))
    if [ "$days" -lt 0 ]; then days=0; fi

    # Decay factor: e^(-days/14), approximated
    local decay
    decay=$(awk "BEGIN { printf \"%.2f\", exp(-$days/14) }")
    local new_strength
    new_strength=$(awk "BEGIN { printf \"%.2f\", $current_strength * $decay }")

    echo "$new_strength"
}

# Calculate reinforcement: base_strength + reinforcement_bonus
reinforce_strength() {
    local current="$1"
    local bonus="${2:-0.15}"
    awk "BEGIN { printf \"%.2f\", ($current + $bonus) > 1.0 ? 1.0 : ($current + $bonus) }"
}

# === Token estimation ===
# Rough estimate: 1 token ≈ 4 chars for Chinese, 4 chars for English
# Uses character count (not byte count) for consistency with MCP server
estimate_tokens() {
    local text="$1"
    local chars
    chars=$(echo -n "$text" | wc -m)
    echo $(( chars / 4 ))
}

# Check if a file exceeds token budget
check_token_budget() {
    local file="$1"
    local max_tokens="${2:-1000}"
    local content
    content=$(read_file "$file")
    local tokens
    tokens=$(estimate_tokens "$content")

    if [ "$tokens" -gt "$max_tokens" ]; then
        log "WARNING: $file is ~$tokens tokens (budget: $max_tokens)"
        return 1
    fi
    return 0
}

# === Conflict detection helpers ===
# Scan file for [!contradiction] markers
scan_contradictions() {
    local file="$1"
    if grep -q '\[!contradiction\]' "$file" 2>/dev/null; then
        echo "$file"
    fi
}

# === Cache anchor check ===
# Verify the cache anchor line hasn't been tampered with
check_cache_anchor() {
    local file="$1"
    local anchor_version="$2"

    if ! grep -q "CACHE_ANCHOR: $anchor_version" "$file" 2>/dev/null; then
        log "CRITICAL: Cache anchor '$anchor_version' missing or modified in $file"
        log "This will invalidate prompt cache for the entire session"
        return 1
    fi
    return 0
}

log "common.sh loaded (vault: $MEMORY_VAULT)"
