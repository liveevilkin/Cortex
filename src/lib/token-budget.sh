#!/usr/bin/env bash
# token-budget.sh — estimate token costs for CI verification
# Usage: bash token-budget.sh [memory-vault-path]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/common.sh"

# Budget thresholds
MAX_INDEX_TOKENS=1000
MAX_DAILY_3_TOKENS=8000
MAX_TOTAL_STARTUP=10000

main() {
    local target_dir="${1:-$MEMORY_VAULT}"
    local exit_code=0

    echo "=== Token 预算检查 ==="
    echo "阈值: Index < $MAX_INDEX_TOKENS | 近3天 < $MAX_DAILY_3_TOKENS | 总启动 < $MAX_TOTAL_STARTUP"
    echo ""

    # 1. Index tokens
    local index_tokens=0
    if [ -f "$target_dir/memory-index.md" ]; then
        index_tokens=$(estimate_tokens "$(cat "$target_dir/memory-index.md")")
    fi
    echo "memory-index.md: ~$index_tokens tokens (budget: $MAX_INDEX_TOKENS)"
    if [ "$index_tokens" -gt "$MAX_INDEX_TOKENS" ]; then
        echo "  🔴 超标!"
        exit_code=1
    else
        echo "  🟢 OK"
    fi

    # 2. Recent 3 daily files
    local daily_tokens=0
    local daily_count=0
    for f in $(ls -t "$target_dir/daily/"*.md 2>/dev/null | head -3); do
        local ft
        ft=$(estimate_tokens "$(cat "$f")")
        daily_tokens=$((daily_tokens + ft))
        daily_count=$((daily_count + 1))
        echo "  $(basename "$f"): ~$ft tokens"
    done
    echo "近 ${daily_count} 天总计: ~$daily_tokens tokens (budget: $MAX_DAILY_3_TOKENS)"
    if [ "$daily_tokens" -gt "$MAX_DAILY_3_TOKENS" ]; then
        echo "  🔴 超标!"
        exit_code=1
    else
        echo "  🟢 OK"
    fi

    # 3. Total startup budget
    local total=$((index_tokens + daily_tokens))
    echo ""
    echo "启动总开销: ~$total tokens (budget: $MAX_TOTAL_STARTUP)"
    if [ "$total" -gt "$MAX_TOTAL_STARTUP" ]; then
        echo "  🔴 超标! 建议精简 daily 文件或降低近3天加载量"
        exit_code=1
    else
        echo "  🟢 OK"
    fi

    return $exit_code
}

main "$@"
