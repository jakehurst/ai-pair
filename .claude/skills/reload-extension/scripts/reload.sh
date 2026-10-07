#!/bin/sh
# Rebuild the AI Pair extension from this working copy and reinstall it in VS Code.
set -eu

root="$(cd "$(dirname "$0")/../../../.." && pwd)"
version="$(node -p "require('$root/packages/vscode/package.json').version")"
vsix="$root/ai-pair-$version.vsix"

cd "$root"
echo "==> npm test"
npm test

echo "==> npm run package"
npm run package

echo "==> code --install-extension $vsix --force"
code --install-extension "$vsix" --force

cat <<EOF

Installed $vsix.
Two steps are left, and they cannot be scripted:
  1. In VS Code, run "Developer: Reload Window" from the command palette.
  2. Restart the agent (Claude Code), so it picks up the new pair-mcp relay.
EOF

