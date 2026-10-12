#!/bin/bash
#
# Runs test/integration.ts inside a fresh, isolated VS Code instance. With
# EXTENSION_PATH set (e.g. to an unpacked .vsix), tests that instead of the
# dev build. With --coverage, the extension host writes V8 coverage of the
# bundle, c8 reports it against the sources, in coverage/integration/, and the
# run fails below the file's minimums in coverage_thresholds.json (#161).
set -e

readonly MAC_CODE='/Applications/Visual Studio Code.app/Contents/MacOS/Code'
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
readonly ROOT
# COVERAGE_ROOT: where the reports go; the repository's coverage/ by default.
readonly COVERAGE_DIR="${COVERAGE_ROOT:-${ROOT}/coverage}/integration"

cd "$(dirname "$0")/.."
coverage=0
if [[ "${1:-}" == '--coverage' ]]; then
  coverage=1
  rm -rf "${COVERAGE_DIR}"
  mkdir -p "${COVERAGE_DIR}/v8"
  # Node, and the extension host, write their V8 coverage here on exit.
  export NODE_V8_COVERAGE="${COVERAGE_DIR}/v8"
fi
readonly coverage
readonly CODE="${VSCODE_BIN:-${MAC_CODE}}"
TMP="$(mktemp -d)"
readonly TMP
mkdir -p "${TMP}/workspace"
# Keep discovery files and the launcher out of the real ~/.ai-pair.
export AI_PAIR_HOME="${TMP}/home"
if [[ -z "${EXTENSION_PATH}" ]]; then
  npm run build --silent
  EXTENSION_PATH="${PWD}"
fi
npx esbuild test/integration.ts --bundle --platform=node --format=cjs \
  --target=node22 --external:vscode --outfile=dist-test/integration.js \
  --log-level=warning
# VSCODE_ARGS: more flags, like the ones a CI machine needs (--no-sandbox),
# split on spaces.
read -r -a CODE_ARGS <<<"${VSCODE_ARGS:-}"
readonly CODE_ARGS
# A terminal inside VS Code, Claude Code's for one, can set
# ELECTRON_RUN_AS_NODE, which runs the Code binary as plain Node: it would
# reject every flag below (#152).
unset ELECTRON_RUN_AS_NODE
"${CODE}" "${CODE_ARGS[@]}" \
  --user-data-dir="${TMP}/user" \
  --extensions-dir="${TMP}/extensions" \
  --disable-workspace-trust --skip-welcome --skip-release-notes \
  --extensionDevelopmentPath="${EXTENSION_PATH}" \
  --extensionTestsPath="${PWD}/dist-test/integration.js" \
  "${TMP}/workspace"
if ((coverage)); then
  # The bundle is selected before c8 follows its source map back to the
  # sources; the report script keeps ours and drops node_modules. From the
  # root, since c8 matches paths against the cwd.
  (
    cd "${ROOT}" && npx c8 report --temp-directory "${COVERAGE_DIR}/v8" \
      --reports-dir "${COVERAGE_DIR}" \
      --reporter text-summary --reporter lcov --reporter json-summary \
      --include 'packages/vscode/dist/**' --all=false \
      && node scripts/coverage_report.ts --integration --check
  )
fi
