#!/bin/bash
# Runs each independent TLC configuration with bounded, owned processes.
set -u
readonly META="$1"
shift
readonly JOBS="${TLC_JOBS:-2}"
if [[ ! "${JOBS}" =~ ^[1-8]$ ]]; then
  echo 'TLC_JOBS must be between 1 and 8' >&2
  exit 1
fi
read -r -a TLC_COMMAND <<<"${TLC:-tlc}"
readonly TLC_COMMAND
pids=()
names=()
count=0
canceled=0
# specs/CiScheduler.tla, Cancel: reap live processes before returning.
retire() {
  trap '' INT TERM
  for pid in ${pids[@]+"${pids[@]}"}; do
    [[ -z "${pid}" ]] || kill -KILL "${pid}" 2>/dev/null || true
  done
  for pid in ${pids[@]+"${pids[@]}"}; do
    [[ -z "${pid}" ]] || wait "${pid}" || true
  done
  exit 130
}
# specs/CiScheduler.tla, Finish: wait for each owned child before reporting.
wait_batch() {
  local index code
  ((count == 0)) && return
  for index in "${!pids[@]}"; do
    wait "${pids[index]}"
    code=$?
    if ((code < 128 || ! canceled)); then pids[index]=''; fi
    ((canceled)) && retire
    printf '%s\n' "${code}" >"${META}/${names[index]}.status"
  done
  pids=()
  names=()
  count=0
}
trap 'canceled=1' INT TERM
for cfg in ./*.cfg; do
  file="${cfg#./}"
  name="${file%.cfg}"
  spec="${name%%_*}"
  # specs/CiScheduler.tla, Start: one TLC worker per bounded process.
  "${TLC_COMMAND[@]}" -workers 1 -cleanup -metadir "${META}/${name}" \
    "$@" -config "${file}" "${spec}.tla" >"${META}/${name}.out" 2>&1 &
  pids+=("$!")
  names+=("${name}")
  ((count += 1))
  ((canceled)) && retire
  if ((count == JOBS)); then wait_batch; fi
done
wait_batch
((canceled)) && retire
exit 0
