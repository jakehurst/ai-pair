#!/bin/bash
#
# Runs the integration tests in a fresh, isolated VS Code: test/integration.ts
# in a workspace, test/integration_reload.ts in the same window's data, then
# test/integration_nofolder.ts with no folder (#176). EXTENSION_PATH (e.g. an
# unpacked .vsix) is tested instead of the dev build. With --coverage, c8
# reports the extension host's V8 coverage against the sources, in
# coverage/integration/, failing below coverage_thresholds.json (#161).
set -e

readonly MAC_CODE='/Applications/Visual Studio Code.app/Contents/MacOS/Code'
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
readonly ROOT
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
# The run's own ~/.ai-pair, under the home folder (the relay shows a guide
# there as `~/...`), apart from the real one, gone at the end (#176).
readonly PAIR_HOME="${HOME}/.ai-pair-integration-$$"
export AI_PAIR_HOME="${PAIR_HOME}"
trap 'rm -rf "${TMP}" "${PAIR_HOME}"' EXIT
mkdir -p "${TMP}/workspace"
if [[ -z "${EXTENSION_PATH}" ]]; then
  npm run build --silent
  EXTENSION_PATH="${PWD}"
fi
# jsonc-parser's `main` is a UMD build esbuild can't follow (scripts/build.mts).
npx esbuild "${TESTS[@]/#/./test/}" --bundle --platform=node --format=cjs \
  --target=node22 --external:vscode --main-fields=module,main \
  --outdir=dist-test --log-level=warning
# VSCODE_ARGS: more flags, like the ones a CI machine needs (--no-sandbox),
# split on spaces.
read -r -a CODE_ARGS <<<"${VSCODE_ARGS:-}"
readonly CODE_ARGS
# The test drives the panel's page over CDP, on a port the host learns here.
AI_PAIR_CDP_PORT="$(node -e 'const s = require("node:net").createServer();
  s.listen(0, () => { console.log(s.address().port); s.close(); })')"
export AI_PAIR_CDP_PORT
# Set in a terminal inside VS Code: it would run Code as plain Node (#152).
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

# AI_PAIR_SECTIONS: sections of test/integration.ts to run alone, comma
# separated; `reload` and `nofolder` name the other two launches.
main() {
  local sections=",${AI_PAIR_SECTIONS:-},"
  run_code integration "${TMP}/workspace"
  [[ "${sections}" == ',,' || "${sections}" == *,reload,* ]] \
    && run_code integration_reload "${TMP}/workspace"
  if [[ "${sections}" == ',,' || "${sections}" == *,nofolder,* ]]; then
    touch "${TMP}/not-a-folder" # the launcher can't be written under a file
    AI_PAIR_HOME="${TMP}/not-a-folder" run_code integration_nofolder
  fi
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
