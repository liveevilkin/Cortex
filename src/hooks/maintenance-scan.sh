#!/usr/bin/env bash
# maintenance-scan.sh — bi-weekly memory maintenance
# Runs: decay scan + conflict detection + cache check + metrics update
# Trigger: manual (/memory-force-review) or cron
# Usage: bash maintenance-scan.sh [memory-vault-path]

set -euo pipefail

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
source "$PLUGIN_ROOT/src/lib/common.sh"

main() {
    local target_dir="${1:-$MEMORY_VAULT}"
    local today
    today=$(today_iso)

    echo "╔══════════════════════════════════════╗"
    echo "║   🧹 记忆系统双周维护扫描           ║"
    echo "║   $today                         ║"
    echo "╚══════════════════════════════════════╝"
    echo ""

    # === 1. Strength decay ===
    echo "【1/4】记忆强度衰减..."
    bash "$PLUGIN_ROOT/src/lib/strength-calc.sh" --decay-all "$target_dir"
    echo ""

    # === 2. Conflict detection ===
    echo "【2/4】矛盾检测..."
    bash "$PLUGIN_ROOT/src/lib/conflict-detect.sh" "$target_dir"
    echo ""

    # === 3. Cache health ===
    echo "【3/4】缓存健康检查..."
    bash "$PLUGIN_ROOT/src/lib/cache-check.sh" "$target_dir"
    echo ""

    # === 4. Token budget ===
    echo "【4/4】Token 预算检查..."
    bash "$PLUGIN_ROOT/src/lib/token-budget.sh" "$target_dir"
    echo ""

    # === Summary ===
    echo "╔══════════════════════════════════════╗"
    echo "║   ✅ 维护扫描完成                   ║"
    echo "╚══════════════════════════════════════╝"

    # Log to metrics
    local metrics_file="$target_dir/metrics/cache-report.md"
    if [ -f "$metrics_file" ]; then
        local index_tokens
        index_tokens=$(estimate_tokens "$(cat "$target_dir/memory-index.md")")
        local active_mem
        active_mem=$(ls "$target_dir/decisions/"*.md 2>/dev/null | wc -l)
        echo "| $today | - | ~$index_tokens | $active_mem | 维护扫描 |" >> "$metrics_file"
    fi
}

main "$@"
