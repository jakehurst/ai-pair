#!/usr/bin/env bats
# Exercise network failures and checksum failures without network access.

setup() {
  ROOT="$(cd "${BATS_TEST_DIRNAME}/../.." && pwd)"
  mkdir -p "${BATS_TEST_TMPDIR}/bin"
  export PATH="${BATS_TEST_TMPDIR}/bin:${PATH}"
  export CALLS="${BATS_TEST_TMPDIR}/calls"
  export OUTPUT="${BATS_TEST_TMPDIR}/shfmt"
  cat >"${BATS_TEST_TMPDIR}/bin/curl" <<'CURL'
#!/bin/bash
out=''
url=''
while (($#)); do
  if [[ "$1" == '-o' ]]; then
    out="$2"
    shift 2
  else
    url="$1"
    shift
  fi
done
printf '%s\n' "${url}" >>"${CALLS}"
case "${url}" in
  *github.com/mvdan/sh/releases/download/*)
    [[ "${PRIMARY:-fail}" == fail ]] && exit 22
    printf '%s' "${PRIMARY}" >"${out}"
    ;;
  *)
    [[ "${FALLBACK:-fail}" == fail ]] && exit 22
    printf '%s' "${FALLBACK}" >"${out}"
    ;;
esac
CURL
  chmod +x "${BATS_TEST_TMPDIR}/bin/curl"
}

@test "uses the primary when its content matches" {
  export PRIMARY=abc
  run bash "${ROOT}/scripts/download_shfmt.sh" "${OUTPUT}" \
    ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
  [ "${status}" -eq 0 ]
  [ "$(wc -l <"${CALLS}")" -eq 1 ]
  [ "$(cat "${OUTPUT}")" = abc ]
}

@test "falls back after failure or a checksum mismatch" {
  for primary in fail bad; do
    export PRIMARY="${primary}" FALLBACK=abc
    run bash "${ROOT}/scripts/download_shfmt.sh" "${OUTPUT}" \
      ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
    [ "${status}" -eq 0 ]
    [ "$(cat "${OUTPUT}")" = abc ]
  done
  [ "$(wc -l <"${CALLS}")" -eq 4 ]
}

@test "fails and removes the output when neither source matches" {
  export PRIMARY=bad FALLBACK=bad
  run bash "${ROOT}/scripts/download_shfmt.sh" "${OUTPUT}" \
    ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
  [ "${status}" -ne 0 ]
  [ ! -e "${OUTPUT}" ]
}

@test "fails and removes the output when both downloads fail" {
  export PRIMARY=fail FALLBACK=fail
  printf stale >"${OUTPUT}"
  run bash "${ROOT}/scripts/download_shfmt.sh" "${OUTPUT}" \
    ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
  [ "${status}" -ne 0 ]
  [ ! -e "${OUTPUT}" ]
}
