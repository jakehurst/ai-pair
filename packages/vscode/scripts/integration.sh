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
# Keep the temporary path short enough for Code's sockets.
TMP_FILES="$(mktemp -d /tmp/ai-pair.XXXXXX)"
readonly TMP_FILES
# The packaged run temporarily puts its test bundle under the extension root,
# so VS Code attributes the fixture to the same extension API facade.
TEST_DIR="${TMP}/unused"
# Temporary data is removed after success or failure (#176).
trap 'rm -rf "${TMP}" "${TMP_FILES}" "${TEST_DIR}"' EXIT
mkdir -p "${TMP}/workspace" "${TMP}/agents/codex"
# Keep discovery files and the launcher out of the real ~/.ai-pair.
export AI_PAIR_HOME="${TMP}/home"
if [[ -z "${EXTENSION_PATH}" ]]; then
  npm run build --silent
  EXTENSION_PATH="${PWD}"
fi
TEST_BUNDLE="${PWD}/dist-test/integration.js"
if [[ "${EXTENSION_PATH}" != "${PWD}" ]]; then
  # specs/IntegrationFixture.tla, Build: use this extension's API facade.
  TEST_DIR="$(mktemp -d "${EXTENSION_PATH}/.ai-pair-test.XXXXXX")"
  TEST_BUNDLE="${TEST_DIR}/integration.js"
fi
npx esbuild test/integration.ts --bundle --platform=node --format=cjs \
  --target=node22 --external:vscode --outfile="${TEST_BUNDLE}" \
  --log-level=warning
# VSCODE_ARGS: more flags, like the ones a CI machine needs (--no-sandbox),
# split on spaces.
read -r -a CODE_ARGS <<<"${VSCODE_ARGS:-}"
PLATFORM="$(uname -s)"
readonly PLATFORM
if [[ "${PLATFORM}" == Linux ]]; then
  CODE_ARGS+=(--password-store=basic)
fi
readonly CODE_ARGS
# Code must run as Electron, even when launched from a Node terminal (#152).
unset ELECTRON_RUN_AS_NODE
# Set Up Agent writes agents' configurations: Claude Code's, Codex's, and
# OpenCode's go to the run's folder, by the variables they honor, and only the
# system's programs are on the PATH, so no agent's CLI is found. HOME stays:
# on macOS, Code finds its keychain by it (#176).
TMPDIR="${TMP_FILES}" CLAUDE_CONFIG_DIR="${TMP}/agents/claude" \
  CODEX_HOME="${TMP}/agents/codex" XDG_CONFIG_HOME="${TMP}/agents/xdg" \
  PULSE_SERVER='unix:/nonexistent' \
  PIPEWIRE_REMOTE='ai-pair-integration-no-audio' \
  PATH='/usr/bin:/bin:/usr/sbin:/sbin' \
  "${CODE}" "${CODE_ARGS[@]}" \
  --user-data-dir="${TMP}/user" \
  --shared-data-dir="${TMP}/shared" \
  --extensions-dir="${TMP}/extensions" \
  --disable-workspace-trust --skip-welcome --skip-release-notes \
  --extensionDevelopmentPath="${EXTENSION_PATH}" \
  --extensionTestsPath="${TEST_BUNDLE}" \
  "${TMP}/workspace"
# The companion's normal-window restart uses the same coverage output.
bash scripts/integration_companion.sh "${ROOT}" "${TMP}" "${TMP_FILES}" \
  "${CODE}" "${EXTENSION_PATH}" "${CODE_ARGS[@]}"
bash scripts/integration_speech_faults.sh "${ROOT}" "${TMP}" "${TMP_FILES}" \
  "${CODE}" "${EXTENSION_PATH}" "${CODE_ARGS[@]}"
if ((coverage)); then
  # c8 resolves bundled coverage through the source maps from the root.
  (
    cd "${ROOT}" && npx c8 report --temp-directory "${COVERAGE_DIR}/v8" \
      --reports-dir "${COVERAGE_DIR}" \
      --reporter text-summary --reporter lcov --reporter json-summary \
      --include 'packages/vscode/dist/**' \
      --include 'packages/audio-ui/dist/**' --all=false \
      && node scripts/coverage_report.ts --integration --check
  )
fi
