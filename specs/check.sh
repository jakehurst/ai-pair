#!/bin/bash
#
# Runs TLC on every config in specs/. Spec.cfg checks the code as it is and
# must pass. With --coverage, TLC also counts how often each action fired, the
# full statistics go to coverage/tla/<Spec>.txt, and an action that never fired
# is named: a model with such an action does not cover its case.
set -u

cd "$(dirname "$0")" || exit 1
# TLC: the command that runs TLC, with its arguments, split on spaces.
read -r -a TLC_COMMAND <<<"${TLC:-tlc}"
readonly TLC_COMMAND
readonly COVERAGE_DIR='../coverage/tla'
coverage=()
if [[ "${1:-}" == '--coverage' ]]; then
  coverage=(-coverage 1)
  mkdir -p "${COVERAGE_DIR}"
fi
readonly coverage
# TLC keeps its state files here, not in specs/.
META="$(mktemp -d)" || exit 1
readonly META
status=0

#######################################
# Saves TLC's coverage statistics for a spec and names the actions that never
# fired. An action's line reads `<Name line ... of module M>: distinct:total`:
# the new states it produced, and the times it fired.
# Globals:
#   COVERAGE_DIR
# Arguments:
#   The spec's name, and TLC's output.
# Outputs:
#   One line per action that never fired, to stdout.
#######################################
report_coverage() {
  local name="$1" out="$2" line action count
  { grep -v '^@!@!@' <<<"${out}" || true; } \
    | sed -n '/^The coverage statistics/,$p' >"${COVERAGE_DIR}/${name}.txt"
  while IFS= read -r line; do
    action="${line#<}"
    action="${action%% *}"
    count="${line##*: }"
    if [[ "${count}" == *:0 ]]; then
      printf '  %s: action %s never fired\n' "${name}" "${action}"
    fi
  done < <(grep -E '^<[A-Za-z_]+ line .*>: [0-9]+:[0-9]+$' <<<"${out}" || true)
}

for cfg in ./*.cfg; do
  file="${cfg#./}"
  name="${file%.cfg}"
  out="$(
    "${TLC_COMMAND[@]}" -workers auto -cleanup -metadir "${META}/${name}" \
      "${coverage[@]}" -config "${file}" "${name}.tla" 2>&1
  )"
  if [[ "${out}" == *'No error has been found'* ]]; then
    result='pass'
  elif [[ "${out}" == *'violated'* ]]; then
    result='violation'
  else
    result='error'
  fi
  if [[ "${result}" == 'pass' ]]; then
    mark='ok'
  else
    mark='FAILED'
    status=1
  fi
  printf '%-20s %-9s %s\n' "${file}" "${result}" "${mark}"
  if [[ "${mark}" != 'ok' ]]; then
    excerpt="$(grep -v '^@!@!@' <<<"${out}")"
    tail -n 60 <<<"${excerpt}" >&2
  fi
  if ((${#coverage[@]} > 0)); then
    report_coverage "${name}" "${out}"
  fi
done

rm -rf "${META}"
if ((${#coverage[@]} > 0)); then
  node ../scripts/coverage_report.ts --tla
fi
exit "${status}"
