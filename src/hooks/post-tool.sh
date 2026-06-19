#!/usr/bin/env bash
# post-tool.sh — PostToolUse hook
# Tracks file changes (Write/Edit) into session buffer
# Trigger: PostToolUse (matcher: Write|Edit)
# Input: $1 = file_path from tool
# Returns: 0 = continue

set -euo pipefail

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
source "$PLUGIN_ROOT/src/lib/common.sh"

main() {
    local file_path="${1:-unknown}"

    # Skip tracking if no file path
    if [ "$file_path" = "unknown" ]; then
        exit 0
    fi

    log "PostToolUse: tracked $file_path"

    # Append to session buffer
    local timestamp
    timestamp=$(date '+%H:%M:%S')

    cat >> "$SESSION_BUFFER" << EOF
- [$timestamp] 编辑: \`$file_path\`
EOF

    # Keep buffer under 200 lines (prune oldest entries if needed)
    local line_count
    line_count=$(wc -l < "$SESSION_BUFFER" 2>/dev/null || echo 0)
    if [ "$line_count" -gt 200 ]; then
        tail -n 100 "$SESSION_BUFFER" > "$SESSION_BUFFER.tmp"
        mv "$SESSION_BUFFER.tmp" "$SESSION_BUFFER"
        log "Pruned session buffer (kept last 100 lines)"
    fi
}

main "$@"
exit 0
