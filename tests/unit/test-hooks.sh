#!/usr/bin/env bash
# test-hooks.sh — unit tests for hook scripts
# Usage: bash tests/unit/test-hooks.sh

set -euo pipefail

PASS=0
FAIL=0
TEST_VAULT="./tests/fixtures/test-vault"

# Setup: create test vault structure
setup() {
    mkdir -p "$TEST_VAULT"/{daily,decisions,moc,metrics,conflicts}

    # Create minimal memory-index.md
    cat > "$TEST_VAULT/memory-index.md" << 'EOF'
---
version: "1.0"
updated: 2026-06-19
cache_anchor: "memory-index-v1"
---

# 记忆索引
## 当前状态
> Test

## 最近动态
| 2026-06-19 | test | [[daily/2026-06-19]] |

## 活跃决策

## MOC 导航

<!-- CACHE_ANCHOR: memory-index-v1 -->
EOF

    # Create a daily file
    cat > "$TEST_VAULT/daily/2026-06-19.md" << 'EOF'
---
date: 2026-06-19
tags: [daily-memory]
summary: "test"
strength: 1.0
last_reinforced: 2026-06-19
---

# 2026-06-19
## 做了什么
test
EOF
}

# Teardown
teardown() {
    rm -rf "$TEST_VAULT"
    rm -rf "./tests/fixtures/output"
}

# Assert helpers
assert_file_exists() {
    if [ -f "$1" ]; then
        echo "  PASS: $2"
        PASS=$((PASS + 1))
    else
        echo "  FAIL: $2 — file not found: $1"
        FAIL=$((FAIL + 1))
    fi
}

assert_contains() {
    if grep -q "$2" "$1" 2>/dev/null; then
        echo "  PASS: $3"
        PASS=$((PASS + 1))
    else
        echo "  FAIL: $3 — pattern not found: '$2' in $1"
        FAIL=$((FAIL + 1))
    fi
}

# === Tests ===
test_session_start_reads_index() {
    echo "Test: SessionStart reads memory-index.md"
    export CLAUDE_CODE_MEMORY_VAULT="$TEST_VAULT"
    local output
    output=$(bash src/hooks/session-start.sh 2>/dev/null)
    if echo "$output" | grep -q "记忆索引"; then
        echo "  PASS: SessionStart output contains index content"
        PASS=$((PASS + 1))
    else
        echo "  FAIL: SessionStart did not load index"
        FAIL=$((FAIL + 1))
    fi
}

test_session_start_reads_daily() {
    echo "Test: SessionStart reads recent daily files"
    export CLAUDE_CODE_MEMORY_VAULT="$TEST_VAULT"
    local output
    output=$(bash src/hooks/session-start.sh 2>/dev/null)
    if echo "$output" | grep -q "做了什么"; then
        echo "  PASS: SessionStart loaded daily content"
        PASS=$((PASS + 1))
    else
        echo "  FAIL: SessionStart did not load daily"
        FAIL=$((FAIL + 1))
    fi
}

test_post_tool_tracks_file() {
    echo "Test: PostToolUse tracks file changes"
    export CLAUDE_PLUGIN_ROOT="."
    bash src/hooks/post-tool.sh "test-file.md" 2>/dev/null
    assert_file_exists ".claude/.session-buffer.md" "Session buffer created"
}

test_pre_compact_saves_state() {
    echo "Test: PreCompact saves state"
    export CLAUDE_PLUGIN_ROOT="."
    bash src/hooks/pre-compact.sh 2>/dev/null
    assert_file_exists ".claude/.compact-buffer.md" "Compact buffer created"
    assert_contains ".claude/.compact-buffer.md" "压缩前状态快照" "Compact buffer has snapshot"
}

test_stop_creates_daily() {
    echo "Test: Stop creates daily file"
    export CLAUDE_PLUGIN_ROOT="."
    export CLAUDE_CODE_MEMORY_VAULT="$TEST_VAULT"

    # Pre-create session buffer for stop to consume
    mkdir -p ".claude"
    echo "- [12:00] 编辑: test.txt" > ".claude/.session-buffer.md"

    bash src/hooks/stop.sh 2>/dev/null
    local today
    today=$(date '+%Y-%m-%d')
    assert_file_exists "$TEST_VAULT/daily/$today.md" "Daily file created for $today"
}

test_cache_anchor_preserved() {
    echo "Test: Cache anchor preserved after stop"
    export CLAUDE_PLUGIN_ROOT="."
    export CLAUDE_CODE_MEMORY_VAULT="$TEST_VAULT"
    bash src/hooks/stop.sh 2>/dev/null
    assert_contains "$TEST_VAULT/memory-index.md" "CACHE_ANCHOR: memory-index-v1" "Cache anchor intact"
}

test_strength_calculation() {
    echo "Test: Strength decay calculation"
    source src/lib/common.sh
    local strength
    strength=$(calc_strength "2026-06-05" "1.0")  # 14 days ago
    # After ~14 days (half life), should be around 0.37
    local is_low
    is_low=$(awk "BEGIN { print ($strength < 0.5) ? 1 : 0 }")
    if [ "$is_low" = "1" ]; then
        echo "  PASS: Strength decayed correctly ($strength)"
        PASS=$((PASS + 1))
    else
        echo "  FAIL: Strength didn't decay enough ($strength)"
        FAIL=$((FAIL + 1))
    fi
}

test_token_estimation() {
    echo "Test: Token estimation"
    source src/lib/common.sh
    local tokens
    tokens=$(estimate_tokens "这是一个测试字符串")
    if [ "$tokens" -gt 0 ]; then
        echo "  PASS: Token estimate = $tokens"
        PASS=$((PASS + 1))
    else
        echo "  FAIL: Token estimate is zero"
        FAIL=$((FAIL + 1))
    fi
}

# === Main ===
echo "=== ClaudeCodeMemory Unit Tests ==="
echo ""

setup

test_session_start_reads_index
test_session_start_reads_daily
test_post_tool_tracks_file
test_pre_compact_saves_state
test_stop_creates_daily
test_cache_anchor_preserved
test_strength_calculation
test_token_estimation

teardown

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="

if [ "$FAIL" -gt 0 ]; then
    exit 1
fi
exit 0
