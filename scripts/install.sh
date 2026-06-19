#!/usr/bin/env bash
# install.sh — ClaudeCodeMemory one-click installer
# Usage: bash install.sh [--vault-path D:\ObsidianNote]

set -euo pipefail

VAULT_PATH="${1:-D:/ObsidianNote}"
MEMORY_VAULT_DIR="$VAULT_PATH/Claude-Code-Memory"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "=== ClaudeCodeMemory Installer ==="
echo "Vault path: $VAULT_PATH"
echo "Memory vault dir: $MEMORY_VAULT_DIR"

# 1. Create vault memory directories
mkdir -p "$MEMORY_VAULT_DIR"/{daily,decisions,moc,metrics,conflicts,templates}

# 2. Copy templates to vault if not exist
cp -n "$PROJECT_DIR/src/templates/daily-template.md" "$MEMORY_VAULT_DIR/templates/" 2>/dev/null || true
cp -n "$PROJECT_DIR/src/templates/decision-template.md" "$MEMORY_VAULT_DIR/templates/" 2>/dev/null || true

# 3. Initialize memory-index.md if not exist
if [ ! -f "$MEMORY_VAULT_DIR/memory-index.md" ]; then
    cp "$PROJECT_DIR/src/templates/memory-index-template.md" "$MEMORY_VAULT_DIR/memory-index.md"
    echo "Created memory-index.md"
fi

# 4. Make hooks executable
chmod +x "$PROJECT_DIR/src/hooks/"*.sh
chmod +x "$PROJECT_DIR/src/lib/"*.sh

echo ""
echo "=== Installation complete ==="
echo "Memory vault: $MEMORY_VAULT_DIR"
echo ""
echo "Next steps:"
echo "  1. Verify Obsidian vault is at $VAULT_PATH"
echo "  2. Restart Claude Code session to load hooks"
echo "  3. Run '/memory-status' to check health"
