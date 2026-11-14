#!/bin/bash
# Runs every config with bounded parallelism. Coverage aggregates each spec's
# configurations and fails when an undocumented action never fires (#161).
set -u
cd "$(dirname "$0")" || exit 1
readonly COVERAGE_DIR="${COVERAGE_ROOT:-../coverage}/tla"
coverage=()
if [[ "${1:-}" == '--coverage' ]]; then
  coverage=(-coverage 1)
  mkdir -p "${COVERAGE_DIR}"
fi
readonly coverage
META="$(mktemp -d)" || exit 1
readonly META
status=0
# Reports actions that fired in none of a spec's coverage files.
# Globals: COVERAGE_DIR. Output: sorted spec and action names.
# shellcheck disable=SC2016 # $1 and $2 are awk's fields, not the shell's.
never_fired() {
  local program
  program='/^<[A-Za-z_]+ line .*>: [0-9]+:[0-9]+$/ {'
  program+=' spec = FILENAME; sub(/.*\//, "", spec); sub(/[_.].*/, "", spec);'
  program+=' action = $1; sub(/^</, "", action);'
  program+=' sub(/ line [^(>]*/, "", action);'
  program+=' sub(/>$/, "", action); sub(/.*:/, "", $2);'
  program+=' fires[spec ": action " action] += $2 }'
  program+=' END { for (key in fires) if (fires[key] == 0)'
  program+=' print "  " key " never fired" }'
  { awk -F': ' "${program}" "${COVERAGE_DIR}"/*.txt || true; } | sort
}
# Retires the worker owner and its children before deleting its files.
retire_child() {
  trap '' INT TERM
  kill "${child}" 2>/dev/null || true
  wait "${child}" || true
  rm -rf "${META}"
  exit 1
}
# specs/CiScheduler.tla, Start and Finish: the helper owns each process.
canceled=0
trap 'canceled=1' INT TERM
bash ./run_configs.sh "${META}" ${coverage[@]+"${coverage[@]}"} &
child=$!
((canceled)) && retire_child
wait "${child}"
code=$?
((canceled)) && retire_child
if ((code != 0)); then
  rm -rf "${META}"
  exit 1
fi
trap - INT TERM
# specs/CiScheduler.tla, Report: aggregate only after every process settles.
for cfg in ./*.cfg; do
  file="${cfg#./}"
  name="${file%.cfg}"
  out="$(cat "${META}/${name}.out")"
  code="$(cat "${META}/${name}.status")"
  result=error
  [[ "${out}" == *'violated'* ]] && result=violation
  [[ "${code}" == 0 && "${out}" == *'No error has been found'* ]] && result=pass
  mark=ok
  if [[ "${result}" != pass ]]; then
    mark=FAILED status=1
  fi
  printf '%-22s %-9s %s\n' "${file}" "${result}" "${mark}"
  if [[ "${mark}" != 'ok' ]]; then
    excerpt="$(grep -v '^@!@!@' <<<"${out}")"
    tail -n 60 <<<"${excerpt}" >&2
  fi
  if ((${#coverage[@]} > 0)); then
    { grep -v '^@!@!@' <<<"${out}" || true; } \
      | sed -n '/^The coverage statistics/,$p' >"${COVERAGE_DIR}/${name}.txt"
  fi
done
rm -rf "${META}"
if ((${#coverage[@]} > 0)); then
  never_fired
  node ../scripts/coverage_report.ts --tla --check || status=1
fi
exit "${status}"
