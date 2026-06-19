#!/usr/bin/env bash
# conflict-detect.sh — scan for [!contradiction] markers and logical conflicts
# Usage: bash conflict-detect.sh [memory-vault-path]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/common.sh"

# === Scan for explicit [!contradiction] markers ===
scan_explicit_conflicts() {
    local target_dir="${1:-$MEMORY_VAULT}"
    local conflicts_file="$target_dir/conflicts/active-conflicts.md"
    local found=0

    echo "=== 矛盾检测扫描 ==="
    echo ""

    # Find files with [!contradiction] callouts
    for dir in "daily" "decisions" "moc"; do
        local full_dir="$target_dir/$dir"
        if [ ! -d "$full_dir" ]; then continue; fi

        for file in "$full_dir"/*.md; do
            [ -f "$file" ] || continue

            if grep -q '\[!contradiction\]' "$file" 2>/dev/null; then
                found=$((found + 1))
                echo "⚠️  $file 包含 [!contradiction] 标记"
                # Extract the contradiction context
                grep -A2 '\[!contradiction\]' "$file" | while read -r line; do
                    echo "    $line"
                done
                echo ""
            fi
        done
    done

    echo "发现 $found 个显式冲突标记"
    echo ""

    # === Update active-conflicts.md ===
    if [ "$found" -gt 0 ]; then
        local today
        today=$(today_iso)

        cat > "$conflicts_file" << EOF
---
updated: $today
---

# ⚠️ 活跃冲突

> 自动扫描时间: $today

## 冲突列表
EOF
        for dir in "daily" "decisions" "moc"; do
            local full_dir="$target_dir/$dir"
            if [ ! -d "$full_dir" ]; then continue; fi

            for file in "$full_dir"/*.md; do
                [ -f "$file" ] || continue
                if grep -q '\[!contradiction\]' "$file" 2>/dev/null; then
                    local fname
                    fname=$(basename "$file")
                    echo "" >> "$conflicts_file"
                    echo "### 冲突: $fname" >> "$conflicts_file"
                    echo "- **来源**: [[$dir/$fname]]" >> "$conflicts_file"
                    echo "- **状态**: unresolved" >> "$conflicts_file"
                    grep -A2 '\[!contradiction\]' "$file" | tail -n +2 >> "$conflicts_file" || true
                fi
            done
        done
    else
        # Reset to empty if no conflicts
        cat > "$conflicts_file" << EOF
---
updated: $(today_iso)
---

# ⚠️ 活跃冲突

*暂无活跃冲突*
EOF
    fi
}

# === Detect potential implicit conflicts ===
# e.g., two decisions that contradict each other on the same topic
detect_implicit_conflicts() {
    local target_dir="${1:-$MEMORY_VAULT}"
    local decisions_dir="$target_dir/decisions"

    if [ ! -d "$decisions_dir" ]; then return; fi

    echo "=== 隐式冲突检测 ==="

    # Simple heuristic: same tag but different status → potential conflict
    local tags_list
    tags_list=$(grep -h '^  - ' "$decisions_dir"/*.md 2>/dev/null | sort | uniq -c | sort -rn | head -10 || true)

    if [ -n "$tags_list" ]; then
        echo "频率最高的标签关联:"
        echo "$tags_list"
    fi

    # Check superseded decisions still referenced
    for file in "$decisions_dir"/*.md; do
        [ -f "$file" ] || continue

        local status
        status=$(grep -m1 'status:' "$file" | sed 's/.*status: *//' | tr -d '\r' || echo "active")

        if [ "$status" = "superseded" ]; then
            local fname
            fname=$(basename "$file" .md)

            # Check if any active file still links to this superseded one
            if grep -rq "\[\[$fname\]\]" "$MEMORY_VAULT/daily/" 2>/dev/null; then
                echo "⚠️  已废弃决策仍被引用: $fname"
            fi
        fi
    done
}

# === Main ===
main() {
    local target_dir="${1:-$MEMORY_VAULT}"
    scan_explicit_conflicts "$target_dir"
    echo ""
    detect_implicit_conflicts "$target_dir"
}

main "$@"
