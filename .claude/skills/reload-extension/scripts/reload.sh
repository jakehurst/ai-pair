#!/bin/bash
#
# Rebuild the AI Pair extension from this working copy and reinstall it in
# VS Code.
set -eu

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
readonly ROOT
VERSION="$(node -p "require('${ROOT}/packages/vscode/package.json').version")"
readonly VERSION
readonly VSIX="${ROOT}/ai-pair-${VERSION}.vsix"

cd "${ROOT}"
echo "==> npm test"
npm test

echo "==> rm old .vsix files"
rm -f "${ROOT}"/ai-pair-*.vsix

echo "==> npm run package"
npm run package

echo "==> code --install-extension ${VSIX} --force"
code --install-extension "${VSIX}" --force

cat <<EOF

Installed ${VSIX}.
Two steps are left, and they cannot be scripted:
  1. In VS Code, run "Developer: Reload Window" from the command palette.
  2. Restart the agent (Claude Code), so it picks up the new pair-mcp relay.
EOF
