#!/bin/sh
# Runs test/integration.ts inside a fresh, isolated VS Code instance.
# With EXTENSION_PATH set (e.g. to an unpacked .vsix), tests that instead of the dev build.
set -e
cd "$(dirname "$0")/.."
CODE="${VSCODE_BIN:-/Applications/Visual Studio Code.app/Contents/MacOS/Code}"
TMP="$(mktemp -d)"
mkdir -p "$TMP/workspace"
# Keep discovery files and the launcher out of the real ~/.ai-pair.
export AI_PAIR_HOME="$TMP/home"
if [ -z "$EXTENSION_PATH" ]; then
  npm run build --silent
  EXTENSION_PATH="$PWD"
fi
npx esbuild test/integration.ts --bundle --platform=node --format=cjs --target=node20 --external:vscode --outfile=dist-test/integration.js --log-level=warning
# VSCODE_ARGS: more flags, like the ones a CI machine needs (--no-sandbox).
# shellcheck disable=SC2086
"$CODE" $VSCODE_ARGS --user-data-dir="$TMP/user" --extensions-dir="$TMP/extensions" \
  --disable-workspace-trust --skip-welcome --skip-release-notes \
  --extensionDevelopmentPath="$EXTENSION_PATH" --extensionTestsPath="$PWD/dist-test/integration.js" \
  "$TMP/workspace"
