#!/usr/bin/env bats
# Exercise the standalone worker owner with two small fake configs.

bats_require_minimum_version 1.5.0

setup() {
  ROOT="$(cd "${BATS_TEST_DIRNAME}/../.." && pwd)"
  cd "${BATS_TEST_TMPDIR}"
  mkdir out
  touch Alpha.cfg Beta_Model.cfg
  cat >fake_tlc <<'TLC'
#!/bin/bash
[[ "$2" == 1 ]] || exit 99
case "$*" in
  *Beta_Model.cfg*) echo 'bad config'; exit 3 ;;
  *) echo 'No error has been found.' ;;
esac
TLC
  chmod +x fake_tlc
  export TLC="${BATS_TEST_TMPDIR}/fake_tlc" TLC_JOBS=2
}

@test "runs each config with one worker and records each process outcome" {
  run bash "${ROOT}/specs/run_configs.sh" "${BATS_TEST_TMPDIR}/out"
  [[ "${status}" -eq 0 ]]
  [[ "$(cat out/Alpha.status)" == 0 ]]
  [[ "$(cat out/Beta_Model.status)" == 3 ]]
  [[ "$(cat out/Alpha.out)" == *'No error has been found.'* ]]
  [[ "$(cat out/Beta_Model.out)" == 'bad config' ]]
}

@test "rejects unsafe parallelism before starting a child" {
  for jobs in 9 18446744073709551616; do
    export TLC_JOBS="${jobs}"
    run --separate-stderr bash "${ROOT}/specs/run_configs.sh" "${BATS_TEST_TMPDIR}/out"
    [[ "${status}" -eq 1 ]]
    [[ "${stderr}" == *'TLC_JOBS must be between 1 and 8'* ]]
    [[ -z "$(ls -A out)" ]]
  done
}

@test "cancellation retires each started process before the owner exits" {
  cat >"${TLC}" <<'TLC'
#!/usr/bin/env python3
import os, time
with open(os.environ['LOG'], 'a') as log:
    log.write(f'{os.getpid()}\n')
    log.flush()
time.sleep(30)
TLC
  export LOG="${BATS_TEST_TMPDIR}/pids"
  bash "${ROOT}/specs/run_configs.sh" "${BATS_TEST_TMPDIR}/out" &
  owner=$!
  for unused in {1..100}; do
    [[ -f "${LOG}" ]] && [[ "$(wc -l <"${LOG}")" -eq 2 ]] && break
    sleep 0.02
  done
  [[ -f "${LOG}" ]]
  kill -TERM "${owner}"
  for unused in {1..30}; do
    kill -TERM "${owner}" 2>/dev/null || break
  done
  wait "${owner}" || true
  result=0
  while read -r child; do
    if kill -0 "${child}" 2>/dev/null; then
      kill -TERM "${child}" 2>/dev/null || true
      result=1
    fi
  done <"${LOG}"
  [[ "${result}" -eq 0 ]]
}

@test "a cancellation racing child registration still retires the child" {
  cat >"${TLC}" <<'TLC'
#!/usr/bin/env python3
import os, signal, time
with open(os.environ['LOG'], 'a') as log:
    log.write(f'{os.getpid()}\n')
    log.flush()
os.kill(os.getppid(), signal.SIGTERM)
time.sleep(30)
TLC
  export LOG="${BATS_TEST_TMPDIR}/racing-pids"
  run bash "${ROOT}/specs/run_configs.sh" "${BATS_TEST_TMPDIR}/out"
  [[ "${status}" -eq 130 ]]
  [[ -f "${LOG}" ]]
  result=0
  while read -r child; do
    if kill -0 "${child}" 2>/dev/null; then
      kill -TERM "${child}" 2>/dev/null || true
      result=1
    fi
  done <"${LOG}"
  [[ "${result}" -eq 0 ]]
}

@test "cancellation retires a TLC process that ignores termination" {
  cat >"${TLC}" <<'TLC'
#!/usr/bin/env python3
import os, signal, time
signal.signal(signal.SIGTERM, signal.SIG_IGN)
with open(os.environ['LOG'], 'a') as log:
    log.write(f'{os.getpid()}\n')
    log.flush()
time.sleep(30)
TLC
  export LOG="${BATS_TEST_TMPDIR}/stubborn-pids"
  bash "${ROOT}/specs/run_configs.sh" "${BATS_TEST_TMPDIR}/out" &
  owner=$!
  for unused in {1..100}; do
    [[ -f "${LOG}" ]] && [[ "$(wc -l <"${LOG}")" -eq 2 ]] && break
    sleep 0.02
  done
  [[ -f "${LOG}" ]]
  kill -TERM "${owner}"
  for unused in {1..100}; do
    kill -0 "${owner}" 2>/dev/null || break
    sleep 0.02
  done
  result=0
  if kill -0 "${owner}" 2>/dev/null; then
    result=1
    kill -KILL "${owner}" 2>/dev/null || true
  fi
  while read -r child; do
    kill -KILL "${child}" 2>/dev/null || true
  done <"${LOG}"
  wait "${owner}" || true
  [[ "${result}" -eq 0 ]]
}
