#!/usr/bin/env bats
# .claude/skills/reload-extension/scripts/reload.sh against fake npm and code commands.

bats_require_minimum_version 1.5.0

setup() {
  ROOT="$(cd "${BATS_TEST_DIRNAME}/../.." && pwd)"
  export ROOT
  FAKE="${BATS_TEST_TMPDIR}/bin"
  mkdir -p "${FAKE}"
  export CALLS="${BATS_TEST_TMPDIR}/calls"
  for command in npm code; do
    printf '#!/bin/bash\necho "%s $*" >>"${CALLS}"\n' "${command}" >"${FAKE}/${command}"
    chmod +x "${FAKE}/${command}"
  done
  export PATH="${FAKE}:${PATH}"
}

@test "tests, packages, and installs the extension at its version, in that order" {
  version="$(node -p "require('${ROOT}/packages/vscode/package.json').version")"
  run --separate-stderr bash "${ROOT}/.claude/skills/reload-extension/scripts/reload.sh"
  [[ "${status}" -eq 0 ]]
  [[ "$(sed -n 1p "${CALLS}")" == 'npm test' ]]
  [[ "$(sed -n 2p "${CALLS}")" == 'npm run package' ]]
  [[ "$(sed -n 3p "${CALLS}")" == "code --install-extension ${ROOT}/ai-pair-${version}.vsix --force" ]]
  [[ "${output}" == *'Developer: Reload Window'* ]]
}

@test "stops when the tests fail" {
  printf '#!/bin/bash\nexit 1\n' >"${FAKE}/npm"
  run --separate-stderr bash "${ROOT}/.claude/skills/reload-extension/scripts/reload.sh"
  [[ "${status}" -eq 1 ]]
  [[ "${output}" != *'npm run package'* ]]
}
