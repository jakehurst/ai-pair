#!/usr/bin/env bats
# packages/vscode/scripts/integration.sh against a fake Code binary that records how it was run.

bats_require_minimum_version 1.5.0

setup() {
  ROOT="$(cd "${BATS_TEST_DIRNAME}/../.." && pwd)"
  export ROOT
  FAKE="${BATS_TEST_TMPDIR}/bin"
  mkdir -p "${FAKE}"
  export RECORD="${BATS_TEST_TMPDIR}/code.args"
  export ENV_RECORD="${BATS_TEST_TMPDIR}/code.env"
  cat >"${FAKE}/code" <<'CODE'
#!/bin/bash
if [[ -n "${AI_PAIR_COMPANION_RESTART:-}" ]]; then
  RECORD="${RECORD}.companion"
  ENV_RECORD="${ENV_RECORD}.companion"
  for arg in "$@"; do
    case "${arg}" in
      --extensions-dir=*)
        test -f "${arg#*=}/mattyv.ai-pair-local-audio/dist/extension.js" || exit 9
        ;;
      --user-data-dir=*)
        mkdir -p "${arg#*=}/User/workspaceStorage/id"
        touch "${arg#*=}/User/workspaceStorage/id/state.vscdb"
        ;;
    esac
  done
  printf '{"stage":"%s","ok":true}' "${AI_PAIR_COMPANION_RESTART}" >"${AI_PAIR_RESTART_RESULT}"
fi
for arg in "$@"; do
  case "${arg}" in
    --extensionTestsPath=*integration_catalog_paths.js)
      RECORD="${RECORD}.speech.catalog"; ENV_RECORD="${ENV_RECORD}.speech.catalog" ;;
    --extensionTestsPath=*integration_companion_faults.js)
      RECORD="${RECORD}.speech.companion"; ENV_RECORD="${ENV_RECORD}.speech.companion" ;;
    --extensionTestsPath=*integration_companion_version.js)
      RECORD="${RECORD}.speech.version"; ENV_RECORD="${ENV_RECORD}.speech.version" ;;
    --extensionTestsPath=*integration_workspace_incompatible.js)
      RECORD="${RECORD}.speech.incompatible"; ENV_RECORD="${ENV_RECORD}.speech.incompatible" ;;
    --extensionTestsPath=*integration_no_workspace.js)
      RECORD="${RECORD}.speech.empty"; ENV_RECORD="${ENV_RECORD}.speech.empty" ;;
    --extensionTestsPath=*integration_restricted_runtime.js)
      RECORD="${RECORD}.speech.restricted"; ENV_RECORD="${ENV_RECORD}.speech.restricted" ;;
    --extensionTestsPath=*integration_release_extension_owner_paths.js)
      RECORD="${RECORD}.speech.owner"; ENV_RECORD="${ENV_RECORD}.speech.owner" ;;
  esac
done
printf '%s\n' "$@" >"${RECORD}"
env | grep -E '^(NODE_V8_COVERAGE|ELECTRON_RUN_AS_NODE|AI_PAIR_HOME|HOME|PATH|CODEX_HOME|TMPDIR|AI_PAIR_COMPANION_RESTART|PULSE_SERVER|PIPEWIRE_REMOTE)=' >"${ENV_RECORD}" || true
if [[ "${FAIL_MAIN:-}" == 1 && -z "${AI_PAIR_COMPANION_RESTART:-}" ]]; then
  exit 7
fi
if [[ -n "${AI_PAIR_COMPANION_RESTART:-}" ]]; then
  cp "${RECORD}" "${RECORD}.${AI_PAIR_COMPANION_RESTART}"
  cp "${ENV_RECORD}" "${ENV_RECORD}.${AI_PAIR_COMPANION_RESTART}"
fi
CODE
  chmod +x "${FAKE}/code"
  export VSCODE_BIN="${FAKE}/code"
  # The dev build stands in for an unpacked .vsix, so the script builds nothing.
  export EXTENSION_PATH="${ROOT}/packages/vscode"
  export COVERAGE_ROOT="${BATS_TEST_TMPDIR}/coverage"
  export COVERAGE_MD="${BATS_TEST_TMPDIR}/COVERAGE.md"
  # No minimums: the fake Code writes no coverage for them to hold.
  export COVERAGE_THRESHOLDS="${BATS_TEST_TMPDIR}/coverage_thresholds.json"
  printf '{}\n' >"${COVERAGE_THRESHOLDS}"
}

@test "runs Code isolated: its own user data, extensions, and workspace, with the test bundle" {
  ELECTRON_RUN_AS_NODE=1 run --separate-stderr bash "${ROOT}/packages/vscode/scripts/integration.sh"
  [[ "${status}" -eq 0 ]]
  grep -q '^--user-data-dir=' "${RECORD}"
  grep -q '^--shared-data-dir=.*/shared$' "${RECORD}"
  if [[ "$(uname -s)" == Linux ]]; then
    grep -q '^--password-store=basic$' "${RECORD}"
  fi
  grep -q '^--extensions-dir=' "${RECORD}"
  grep -q '^--disable-workspace-trust$' "${RECORD}"
  grep -q "^--extensionDevelopmentPath=${EXTENSION_PATH}\$" "${RECORD}"
  grep -q '^--extensionTestsPath=.*/dist-test/integration.js$' "${RECORD}"
  grep -q '/workspace$' "${RECORD}"
  grep -q '^AI_PAIR_HOME=' "${ENV_RECORD}"
  ! grep -q '^ELECTRON_RUN_AS_NODE=' "${ENV_RECORD}"
}

@test "gives Code the run's own agent config folders, and the system's PATH" {
  CODEX_HOME=/real/codex run --separate-stderr \
    bash "${ROOT}/packages/vscode/scripts/integration.sh"
  [[ "${status}" -eq 0 ]]
  grep -q '^CODEX_HOME=.*/agents/codex$' "${ENV_RECORD}"
  grep -q '^PATH=/usr/bin:/bin:/usr/sbin:/sbin$' "${ENV_RECORD}"
  grep -q "^HOME=${HOME}\$" "${ENV_RECORD}"
}

@test "removes its temporary folder when it ends" {
  run --separate-stderr bash "${ROOT}/packages/vscode/scripts/integration.sh"
  [[ "${status}" -eq 0 ]]
  local user
  user="$(sed -n 's/^--user-data-dir=//p' "${RECORD}")"
  [[ -n "${user}" ]]
  [[ ! -e "$(dirname "${user}")" ]]
}

@test "gives Code a short temporary folder of its own, and removes it when it ends" {
  run --separate-stderr bash "${ROOT}/packages/vscode/scripts/integration.sh"
  [[ "${status}" -eq 0 ]]
  local tmpdir
  tmpdir="$(sed -n 's/^TMPDIR=//p' "${ENV_RECORD}")"
  [[ "${tmpdir}" == /tmp/ai-pair.* ]]
  [[ ! -e "${tmpdir}" ]]
}

@test "passes VSCODE_ARGS through, split on spaces" {
  VSCODE_ARGS='--no-sandbox --disable-gpu' run --separate-stderr bash "${ROOT}/packages/vscode/scripts/integration.sh"
  [[ "${status}" -eq 0 ]]
  [[ "$(head -2 "${RECORD}" | tr '\n' ' ')" == '--no-sandbox --disable-gpu ' ]]
}

@test "--coverage asks the extension host for V8 coverage and reports it" {
  run --separate-stderr bash "${ROOT}/packages/vscode/scripts/integration.sh" --coverage
  [[ "${status}" -eq 0 ]]
  grep -q "^NODE_V8_COVERAGE=${COVERAGE_ROOT}/integration/v8\$" "${ENV_RECORD}"
  [[ -f "${COVERAGE_MD}" ]]
}

@test "--coverage fails below coverage_thresholds.json" {
  printf '{"packages/core/src/bridge.ts": {"integration": {"lines": 1}}}\n' >"${COVERAGE_THRESHOLDS}"
  run --separate-stderr bash "${ROOT}/packages/vscode/scripts/integration.sh" --coverage
  [[ "${status}" -eq 1 ]]
  [[ "${stderr}" == *'packages/core/src/bridge.ts: integration lines not measured, minimum 1%'* ]]
}


@test "coverage also runs the real companion package in a separate profile using the same V8 directory" {
  run --separate-stderr bash "${ROOT}/packages/vscode/scripts/integration.sh" --coverage
  [[ "${status}" -eq 0 ]] || { printf "%s\n%s\n" "${output}" "${stderr}"; return 1; }
  [[ -f "${RECORD}.companion" ]]
  ! grep -q '^--extensionTestsPath=' "${RECORD}.companion"
  local legacy_user companion_user
  legacy_user="$(sed -n 's/^--user-data-dir=//p' "${RECORD}")"
  companion_user="$(sed -n 's/^--user-data-dir=//p' "${RECORD}.companion")"
  [[ -n "${legacy_user}" && -n "${companion_user}" && "${legacy_user}" != "${companion_user}" ]]
  grep -q "^NODE_V8_COVERAGE=${COVERAGE_ROOT}/integration/v8\$" "${ENV_RECORD}.companion"
}


@test "companion restart stages share their isolated profile and coverage directory" {
  run --separate-stderr bash "${ROOT}/packages/vscode/scripts/integration.sh" --coverage
  [[ "${status}" -eq 0 ]]
  [[ -f "${RECORD}.companion.prepare" && -f "${RECORD}.companion.verify" ]]
  local first second
  first="$(sed -n 's/^--user-data-dir=//p' "${RECORD}.companion.prepare")"
  second="$(sed -n 's/^--user-data-dir=//p' "${RECORD}.companion.verify")"
  [[ -n "${first}" && "${first}" == "${second}" ]]
  [[ "$(tail -1 "${RECORD}.companion.prepare")" == "$(tail -1 "${RECORD}.companion.verify")" ]]
  grep -q "^NODE_V8_COVERAGE=${COVERAGE_ROOT}/integration/v8\$" "${ENV_RECORD}.companion.prepare"
  grep -q "^NODE_V8_COVERAGE=${COVERAGE_ROOT}/integration/v8\$" "${ENV_RECORD}.companion.verify"
  grep -q '^PULSE_SERVER=unix:/nonexistent$' "${ENV_RECORD}"
  grep -q '^PIPEWIRE_REMOTE=ai-pair-integration-no-audio$' "${ENV_RECORD}"
}


@test "speech fault hosts run before the combined coverage report" {
  run --separate-stderr bash "${ROOT}/packages/vscode/scripts/integration.sh" --coverage
  [[ "${status}" -eq 0 ]]
  [[ -f "${RECORD}.speech.companion" && -f "${RECORD}.speech.empty" ]]
  if [[ "$(uname -s)" == Linux ]]; then
    [[ -f "${RECORD}.speech.catalog" && -f "${RECORD}.speech.restricted" ]]
  fi
  grep -q "^NODE_V8_COVERAGE=${COVERAGE_ROOT}/integration/v8\$" "${ENV_RECORD}.speech.companion"
}

@test "SameExtension, NoLeftovers: loads the packaged fixture under its extension and removes it" {
  EXTENSION_PATH="${BATS_TEST_TMPDIR}/packaged-extension"
  export EXTENSION_PATH
  mkdir -p "${EXTENSION_PATH}"
  run --separate-stderr bash "${ROOT}/packages/vscode/scripts/integration.sh"
  [[ "${status}" -eq 0 ]]
  local test_path
  test_path="$(sed -n 's/^--extensionTestsPath=//p' "${RECORD}")"
  [[ "${test_path}" == "${EXTENSION_PATH}"/*/integration.js ]]
  [[ ! -e "${test_path}" ]]
}

@test "EventuallyCleaned: removes a packaged test bundle when the extension host fails" {
  EXTENSION_PATH="${BATS_TEST_TMPDIR}/failing-extension"
  export EXTENSION_PATH
  mkdir -p "${EXTENSION_PATH}"
  FAIL_MAIN=1 run --separate-stderr bash "${ROOT}/packages/vscode/scripts/integration.sh"
  [[ "${status}" -ne 0 ]]
  local test_path
  test_path="$(sed -n 's/^--extensionTestsPath=//p' "${RECORD}")"
  [[ "${test_path}" == "${EXTENSION_PATH}"/*/integration.js ]]
  [[ ! -e "${test_path}" ]]
}
