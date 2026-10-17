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
printf '%s\n' "$@" >"${RECORD}"
env | grep -E '^(NODE_V8_COVERAGE|ELECTRON_RUN_AS_NODE|AI_PAIR_HOME)=' >"${ENV_RECORD}" || true
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
  grep -q '^--extensions-dir=' "${RECORD}"
  grep -q '^--disable-workspace-trust$' "${RECORD}"
  grep -q "^--extensionDevelopmentPath=${EXTENSION_PATH}\$" "${RECORD}"
  grep -q '^--extensionTestsPath=.*/dist-test/integration.js$' "${RECORD}"
  grep -q '/workspace$' "${RECORD}"
  grep -q '^AI_PAIR_HOME=' "${ENV_RECORD}"
  ! grep -q '^ELECTRON_RUN_AS_NODE=' "${ENV_RECORD}"
}

@test "removes its temporary folder when it ends" {
  run --separate-stderr bash "${ROOT}/packages/vscode/scripts/integration.sh"
  [[ "${status}" -eq 0 ]]
  local user
  user="$(sed -n 's/^--user-data-dir=//p' "${RECORD}")"
  [[ -n "${user}" ]]
  [[ ! -e "$(dirname "${user}")" ]]
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
