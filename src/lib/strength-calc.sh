#!/usr/bin/env bash
# strength-calc.sh — memory strength with Ebbinghaus decay
# Usage: source this file, then call functions
# Standalone: bash strength-calc.sh --decay-all

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/common.sh"

# === Decay Configuration ===
# Ebbinghaus decay curve: strength = initial * e^(-days/half_life)
HALF_LIFE_DAYS=14
ARCHIVE_THRESHOLD=0.20   # Strength below this → archive
DELETE_THRESHOLD=0.10    # Strength below this → suggest deletion
REINFORCE_CITED=0.15     # Bonus when cited in index
REINFORCE_LINKED=0.10    # Bonus per inbound link
REINFORCE_MANUAL=0.40    # Bonus when manually marked important

# === Decay a single file's frontmatter strength ===
decay_file() {
    local file="$1"

    if [ ! -f "$file" ]; then
        return 1
    fi

    # Extract frontmatter fields
    local last_reinforced
    last_reinforced=$(grep -m1 'last_reinforced:' "$file" | sed 's/.*last_reinforced: *//' | tr -d '\r' || echo "")

    local current_strength
    current_strength=$(grep -m1 'strength:' "$file" | sed 's/.*strength: *//' | tr -d '\r' || echo "1.0")

    if [ -z "$last_reinforced" ]; then
        return 0  # No date, skip
    fi

    # Calculate new strength
    local new_strength
    new_strength=$(calc_strength "$last_reinforced" "$current_strength")

    # Update frontmatter
    local tmp="$file.tmp"
    awk -v ns="$new_strength" '
        /^strength:/ { print "strength: " ns; next }
        { print }
    ' "$file" > "$tmp" && mv "$tmp" "$file"

    echo "$file: $current_strength → $new_strength"
}

# === Reinforce a file (increase strength) ===
reinforce_file() {
    local file="$1"
    local bonus="${2:-$REINFORCE_CITED}"

    if [ ! -f "$file" ]; then
        return 1
    fi

    local current_strength
    current_strength=$(grep -m1 'strength:' "$file" | sed 's/.*strength: *//' | tr -d '\r' || echo "1.0")

    local new_strength
    new_strength=$(reinforce_strength "$current_strength" "$bonus")

    local today
    today=$(today_iso)

    # Update frontmatter
    local tmp="$file.tmp"
    awk -v ns="$new_strength" -v d="$today" -v rc="$(( $(grep -m1 'reinforced_count:' "$file" | sed 's/.*reinforced_count: *//' | tr -d '\r' || echo 0) + 1 ))" '
        /^strength:/ { print "strength: " ns; next }
        /^last_reinforced:/ { print "last_reinforced: " d; next }
        /^reinforced_count:/ { print "reinforced_count: " rc; next }
        { print }
    ' "$file" > "$tmp" && mv "$tmp" "$file"

    echo "$file: $current_strength → $new_strength (reinforced +$bonus)"
}

# === Scan all files and apply decay ===
decay_all() {
    local target_dir="${1:-$MEMORY_VAULT}"

    echo "=== 记忆强度衰减扫描 ==="
    echo "半衰期: ${HALF_LIFE_DAYS}天 | 归档阈值: $ARCHIVE_THRESHOLD | 删除阈值: $DELETE_THRESHOLD"
    echo ""

    local decayed=0
    local archived=0
    local deleted=0

    for dir in "daily" "decisions"; do
        local full_dir="$target_dir/$dir"
        if [ ! -d "$full_dir" ]; then
            continue
        fi

        for file in "$full_dir"/*.md; do
            [ -f "$file" ] || continue

            local result
            result=$(decay_file "$file")
            decayed=$((decayed + 1))

            local new_strength
            new_strength=$(grep -m1 'strength:' "$file" | sed 's/.*strength: *//' | tr -d '\r' || echo "1.0")

            # Check thresholds
            local is_low
            is_low=$(awk "BEGIN { print ($new_strength < $DELETE_THRESHOLD) ? 1 : 0 }")
            local is_archive
            is_archive=$(awk "BEGIN { print ($new_strength < $ARCHIVE_THRESHOLD && $new_strength >= $DELETE_THRESHOLD) ? 1 : 0 }")

            if [ "$is_low" = "1" ]; then
                echo "  🗑️  $file: $new_strength → 建议删除"
                deleted=$((deleted + 1))
            elif [ "$is_archive" = "1" ]; then
                echo "  📦 $file: $new_strength → 建议归档"
                archived=$((archived + 1))
            else
                echo "  ✅ $file: $new_strength"
            fi
        done
    done

    echo ""
    echo "总计: $decayed 衰减 | $archived 建议归档 | $deleted 建议删除"
}

# === If called directly, run decay_all ===
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
    if [ "${1:-}" = "--decay-all" ]; then
        decay_all "${2:-$MEMORY_VAULT}"
    else
        echo "Usage: strength-calc.sh --decay-all [memory-vault-path]"
    fi
fi
