#!/usr/bin/env bash
# pre-compact.sh — PreCompact hook
# Saves critical context state before compaction to prevent loss
# Trigger: PreCompact
# Returns: 0 = continue

set -euo pipefail

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
source "$PLUGIN_ROOT/src/lib/common.sh"

main() {
    log "PreCompact: saving critical state..."

    local timestamp
    timestamp=$(date '+%Y-%m-%d %H:%M:%S')

    # Overwrite compact buffer with fresh state snapshot
    cat > "$COMPACT_BUFFER" << EOF
# 压缩前状态快照
- **时间**: $timestamp
- **当前任务**: (从上下文提取)

## 关键上下文
<!-- 以下信息在压缩中不应丢失 -->

## 已修改文件
$(cat "$SESSION_BUFFER" 2>/dev/null || echo "(无变更记录)")

## 待解决事项
<!-- 从当前会话的未完成任务中提取 -->

## 压缩说明
以下内容为压缩前状态快照，压缩完成后会自动合并到 Stop 摘要中。
EOF

    log "PreCompact: state saved to $COMPACT_BUFFER"
}

main "$@"
exit 0
