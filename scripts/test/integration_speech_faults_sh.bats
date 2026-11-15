#!/usr/bin/env bats
# Checks the isolated speech boundary test launcher.
setup() {
  ROOT="$(cd "${BATS_TEST_DIRNAME}/../.." && pwd)"
  export RECORD="${BATS_TEST_TMPDIR}/record"
  mkdir -p "${BATS_TEST_TMPDIR}/bin" "${BATS_TEST_TMPDIR}/run"
  for tool in npm npx; do
    printf '#!/bin/bash\nexit 0\n' >"${BATS_TEST_TMPDIR}/bin/${tool}"
    chmod +x "${BATS_TEST_TMPDIR}/bin/${tool}"
  done
  cat >"${BATS_TEST_TMPDIR}/bin/uname" <<'FAKE'
#!/bin/bash
printf '%s\n' "${TEST_PLATFORM:-Linux}"
FAKE
  chmod +x "${BATS_TEST_TMPDIR}/bin/uname"
  cat >"${BATS_TEST_TMPDIR}/bin/code" <<'FAKE'
#!/bin/bash
printf '%s\n' "$*" >>"${RECORD}"
printf '%s %s %s %s\n' "${PULSE_SERVER}" "${PIPEWIRE_REMOTE}" "${NODE_V8_COVERAGE:-}" "${AI_PAIR_TEST_GPU_NODE:-}" >>"${RECORD}.env"
for arg in "$@"; do
  if [[ "${arg}" == --extensions-dir=* ]] \
    && [[ -f "${arg#--extensions-dir=}/michalstrba.ai-pair-0.30.0/package.json" ]]; then
    printf 'old %s\n' "${arg}" >>"${RECORD}.old"
  fi
done
if [[ "${FAIL_CODE:-}" == 1 ]]; then exit 7; fi
FAKE
  chmod +x "${BATS_TEST_TMPDIR}/bin/code"
  export PATH="${BATS_TEST_TMPDIR}/bin:${PATH}"
  export NODE_V8_COVERAGE="${BATS_TEST_TMPDIR}/coverage"
}

@test "runs speech fixtures in separate profiles with isolated storage and no audio" {
  run bash "${ROOT}/packages/vscode/scripts/integration_speech_faults.sh" \
    "${ROOT}" "${BATS_TEST_TMPDIR}/run" "${BATS_TEST_TMPDIR}" \
    "${BATS_TEST_TMPDIR}/bin/code" "${ROOT}/packages/vscode" --no-sandbox
  [ "${status}" -eq 0 ]
  [ "$(wc -l <"${RECORD}")" -eq 9 ]
  grep -q 'integration_catalog_paths.js' "${RECORD}"
  grep -q 'integration_companion_faults.js' "${RECORD}"
  grep -q 'integration_companion_version.js' "${RECORD}"
  grep -q 'integration_workspace_incompatible.js' "${RECORD}"
  [ "$(grep -c -- '--remote-debugging-port=0' "${RECORD}")" -eq 4 ]
  grep -q 'integration_old_extension.js' "${RECORD}"
  grep -q 'integration_old_extension_dismissed.js' "${RECORD}"
  # Only the old-extension fixtures get a copy of the old AI Pair (#78).
  [ "$(wc -l <"${RECORD}.old")" -eq 2 ]
  grep -q 'integration_old_extension/extensions' "${RECORD}.old"
  grep -q 'integration_old_extension_dismissed/extensions' "${RECORD}.old"
  [ -f "${ROOT}/packages/vscode/test/fixtures/old_extension/package.json" ]
  grep -q 'integration_no_workspace.js' "${RECORD}"
  grep -q 'integration_restricted_runtime.js' "${RECORD}"
  grep -q 'integration_release_extension_owner_paths.js' "${RECORD}"
  ! grep 'integration_no_workspace.js' "${RECORD}" | grep -Fq "${BATS_TEST_TMPDIR}/run/speech-faults/integration_no_workspace/workspace"
  [ "$(grep -c -- '--shared-data-dir=' "${RECORD}")" -eq 9 ]
  [ "$(grep -c -- '--password-store=basic' "${RECORD}")" -eq 9 ]
  [ "$(grep -c "${NODE_V8_COVERAGE}" "${RECORD}.env")" -eq 9 ]
  grep -q 'unix:/nonexistent ai-pair-integration-no-audio' "${RECORD}.env"
  [ ! -e "${BATS_TEST_TMPDIR}/run/speech-faults" ]
}

@test "propagates launch failure and cleans the profile" {
  FAIL_CODE=1 run bash "${ROOT}/packages/vscode/scripts/integration_speech_faults.sh" \
    "${ROOT}" "${BATS_TEST_TMPDIR}/run" "${BATS_TEST_TMPDIR}" \
    "${BATS_TEST_TMPDIR}/bin/code" "${ROOT}/packages/vscode"
  [ "${status}" -ne 0 ]
  [ ! -e "${BATS_TEST_TMPDIR}/run/speech-faults" ]
}

@test "skips the Linux-only catalog fixture on macOS" {
  TEST_PLATFORM=Darwin run bash "${ROOT}/packages/vscode/scripts/integration_speech_faults.sh" \
    "${ROOT}" "${BATS_TEST_TMPDIR}/run" "${BATS_TEST_TMPDIR}" \
    "${BATS_TEST_TMPDIR}/bin/code" "${ROOT}/packages/vscode"
  [ "${status}" -eq 0 ]
  [ "$(wc -l <"${RECORD}")" -eq 7 ]
  ! grep -q 'integration_catalog_paths.js' "${RECORD}"
  ! grep -q -- '--password-store=basic' "${RECORD}"
}


@test "skips Linux-only runtime restriction on macOS" {
  TEST_PLATFORM=Darwin run bash "${ROOT}/packages/vscode/scripts/integration_speech_faults.sh" \
    "${ROOT}" "${BATS_TEST_TMPDIR}/run" "${BATS_TEST_TMPDIR}" \
    "${BATS_TEST_TMPDIR}/bin/code" "${ROOT}/packages/vscode"
  [ "${status}" -eq 0 ]
  ! grep -q 'integration_restricted_runtime.js' "${RECORD}"
}

@test "SameExtension, NoLeftovers: loads each speech fixture from its development extension" {
  local packaged="${BATS_TEST_TMPDIR}/packaged"
  mkdir -p "${packaged}"
  run bash "${ROOT}/packages/vscode/scripts/integration_speech_faults.sh" \
    "${ROOT}" "${BATS_TEST_TMPDIR}/run" "${BATS_TEST_TMPDIR}" \
    "${BATS_TEST_TMPDIR}/bin/code" "${packaged}"
  [ "${status}" -eq 0 ]
  while IFS= read -r line; do
    local extension test_path
    extension="$(sed -n 's/.*--extensionDevelopmentPath=\([^ ]*\).*/\1/p' <<<"${line}")"
    test_path="$(sed -n 's/.*--extensionTestsPath=\([^ ]*\).*/\1/p' <<<"${line}")"
    [[ "${test_path}" == "${extension}"/*/integration_*.js ]]
    [ ! -e "${test_path}" ]
  done <"${RECORD}"
}

@test "EventuallyCleaned: removes a packaged speech fixture when the extension host fails" {
  local packaged="${BATS_TEST_TMPDIR}/failing-packaged"
  mkdir -p "${packaged}"
  FAIL_CODE=1 run bash "${ROOT}/packages/vscode/scripts/integration_speech_faults.sh" \
    "${ROOT}" "${BATS_TEST_TMPDIR}/run" "${BATS_TEST_TMPDIR}" \
    "${BATS_TEST_TMPDIR}/bin/code" "${packaged}"
  [ "${status}" -ne 0 ]
  [ -z "$(find "${packaged}" -mindepth 1 -maxdepth 1 -print -quit)" ]
}

@test "passes the workspace GPU runtime path to relocated fixtures" {
  run bash "${ROOT}/packages/vscode/scripts/integration_speech_faults.sh" \
    "${ROOT}" "${BATS_TEST_TMPDIR}/run" "${BATS_TEST_TMPDIR}" \
    "${BATS_TEST_TMPDIR}/bin/code" "${ROOT}/packages/vscode"
  [ "${status}" -eq 0 ]
  grep -Fq "${ROOT}/packages/audio-ui/dist/speech-gpu/node" "${RECORD}.env"
}
