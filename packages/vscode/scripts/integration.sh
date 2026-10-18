#!/bin/bash
#
# Runs the integration tests in a fresh, isolated VS Code: test/integration.ts
# in a workspace, test/integration_reload.ts in the same window's data, then
# test/integration_nofolder.ts with no folder (#176). EXTENSION_PATH (e.g. an
# unpacked .vsix) is tested instead of the dev build. With --coverage, the
# extension host writes V8 coverage of the bundle, c8 reports it against the
# sources in coverage/integration/, and the run fails below the file's
# minimums in coverage_thresholds.json (#161).
set -e

readonly MAC_CODE='/Applications/Visual Studio Code.app/Contents/MacOS/Code'
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
readonly ROOT
# COVERAGE_ROOT: where the reports go; the repository's coverage/ by default.
readonly COVERAGE_DIR="${COVERAGE_ROOT:-${ROOT}/coverage}/integration"
readonly TESTS=(integration integration_reload integration_nofolder)

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
# The run's own ~/.ai-pair: under the home folder, so the relay shows a guide
# there as `~/...`; apart from the real one, and gone at the end (#176).
readonly PAIR_HOME="${HOME}/.ai-pair-integration-$$"
export AI_PAIR_HOME="${PAIR_HOME}"
trap 'rm -rf "${TMP}" "${PAIR_HOME}"' EXIT
mkdir -p "${TMP}/workspace"
if [[ -z "${EXTENSION_PATH}" ]]; then
  npm run build --silent
  EXTENSION_PATH="${PWD}"
fi
# jsonc-parser's `main` is a UMD build whose requires esbuild can't follow;
# its ES module build bundles (scripts/build.mts).
npx esbuild "${TESTS[@]/#/./test/}" --bundle --platform=node --format=cjs \
  --target=node22 --external:vscode --main-fields=module,main \
  --outdir=dist-test --log-level=warning
# VSCODE_ARGS: more flags, like the ones a CI machine needs (--no-sandbox),
# split on spaces.
read -r -a CODE_ARGS <<<"${VSCODE_ARGS:-}"
readonly CODE_ARGS
# The test drives the panel's page over the Chrome DevTools Protocol, on a
# port of its own, which the extension host learns from the environment.
AI_PAIR_CDP_PORT="$(node -e 'const s = require("node:net").createServer();
  s.listen(0, () => { console.log(s.address().port); s.close(); })')"
export AI_PAIR_CDP_PORT
# A terminal inside VS Code, Claude Code's for one, can set
# ELECTRON_RUN_AS_NODE, which runs Code as plain Node: no flag below (#152).
unset ELECTRON_RUN_AS_NODE

#######################################
# Runs one test bundle in VS Code, with the run's user data and extensions.
# Set Up Agent writes agents' configurations: Claude Code's, Codex's, and
# OpenCode's go to the run's folder, by the variables they honor, and only the
# system's programs are on the PATH, so no agent's CLI is found. HOME stays:
# on macOS, Code finds its keychain by it (#176).
# Arguments: the test's name in TESTS, then the folders to open, if any.
#######################################
run_code() {
  local test="$1"
  shift
  CLAUDE_CONFIG_DIR="${TMP}/agents/claude" CODEX_HOME="${TMP}/agents/codex" \
    XDG_CONFIG_HOME="${TMP}/agents/xdg" PATH='/usr/bin:/bin:/usr/sbin:/sbin' \
    "${CODE}" "${CODE_ARGS[@]}" \
    --remote-debugging-port="${AI_PAIR_CDP_PORT}" \
    --user-data-dir="${TMP}/user" --extensions-dir="${TMP}/extensions" \
    --disable-workspace-trust --skip-welcome --skip-release-notes \
    --extensionDevelopmentPath="${EXTENSION_PATH}" \
    --extensionTestsPath="${PWD}/dist-test/${test}.js" "$@"
}

main() {
  run_code integration "${TMP}/workspace"
  run_code integration_reload "${TMP}/workspace"
  touch "${TMP}/not-a-folder" # the launcher can't be written under a file
  AI_PAIR_HOME="${TMP}/not-a-folder" run_code integration_nofolder
  if ((coverage)); then
    # The bundles are selected before c8 follows their source maps back to the
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
}

main "$@"
