#!/usr/bin/env bash
# cache-check.sh — verify cache anchor integrity and report health
# Usage: bash cache-check.sh [memory-vault-path]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/common.sh"

main() {
    local target_dir="${1:-$MEMORY_VAULT}"
    local index_file="$target_dir/memory-index.md"
    local issues=0

    echo "=== 缓存健康检查 ==="
    echo ""

    # 1. Cache anchor presence
    if ! grep -q "CACHE_ANCHOR: memory-index-v1" "$index_file" 2>/dev/null; then
        echo "🔴 严重: 缓存锚点缺失 — memory-index.md 缺少 CACHE_ANCHOR"
        issues=$((issues + 1))
    else
        echo "🟢 缓存锚点: 正常"
    fi

    # 2. Index size check
    local tokens
    tokens=$(estimate_tokens "$(cat "$index_file")")
    if [ "$tokens" -gt 1000 ]; then
        echo "🟡 警告: memory-index.md ~$tokens tokens（预算 1000）"
        issues=$((issues + 1))
    else
        echo "🟢 Index 大小: ~$tokens tokens"
    fi

    # 3. Daily file count
    local daily_count
    daily_count=$(ls "$target_dir/daily/"*.md 2>/dev/null | wc -l)
    echo "🟢 Daily 文件数: $daily_count"

    # 4. Active memory count
    local active_count
    active_count=$(ls "$target_dir/decisions/"*.md 2>/dev/null | wc -l)
    if [ "$active_count" -gt 20 ]; then
        echo "🟡 活跃决策数: $active_count（建议 < 20）"
        issues=$((issues + 1))
    else
        echo "🟢 活跃决策数: $active_count"
    fi

    # 5. Plugin config validation
    local plugin_json="$PLUGIN_ROOT/.claude-plugin/plugin.json"
    if [ -f "$plugin_json" ]; then
        if grep -q '"SessionStart"' "$plugin_json"; then
            echo "🟢 Hook 配置: SessionStart 已注册"
        else
            echo "🔴 Hook 配置: SessionStart 未注册"
            issues=$((issues + 1))
        fi
    fi

    # 6. Recent daily coverage
    local today
    today=$(today_iso)
    if [ -f "$target_dir/daily/$today.md" ]; then
        echo "🟢 今日 Daily: 已存在"
    else
        echo "⚪ 今日 Daily: 尚未生成"
    fi

    echo ""
    echo "=== 检查完成: $issues 个问题 ==="

    # Update metrics report
    local metrics_file="$target_dir/metrics/cache-report.md"
    if [ -f "$metrics_file" ]; then
        local tmp_metrics="$BUFFER_DIR/.cache-report-tmp.md"
        sed "s/^| 平均缓存命中率.*$/| 平均缓存命中率 | N\/A | ⚪ |/" "$metrics_file" > "$tmp_metrics"
        sed -i "s/^| memory-index.md 大小.*$/| memory-index.md 大小 | ~$tokens tokens | $([ "$tokens" -gt 1000 ] && echo '🟡' || echo '🟢') |/" "$tmp_metrics"
        mv "$tmp_metrics" "$metrics_file"
    fi

    return $issues
}

main "$@"
