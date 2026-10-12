#!/bin/bash
#
# Runs TLC on every config in specs/. Spec.cfg checks the code as it is and
# must pass. With --coverage, TLC also counts how often each action fired, the
# full statistics go to coverage/tla/<Config>.txt, and an action that never
# fired is named and fails the run, unless the spec's section of README.md
# says, in a sentence naming it, that it never fires (#161).
# A spec's other configs, Foo_<Model>.cfg (8.2 of the style guide), run
# against Foo.tla, each with its own statistics file (#169).
set -u

cd "$(dirname "$0")" || exit 1
# TLC: the command that runs TLC, with its arguments, split on spaces.
read -r -a TLC_COMMAND <<<"${TLC:-tlc}"
readonly TLC_COMMAND
# COVERAGE_ROOT: where the reports go; the repository's coverage/ by default.
readonly COVERAGE_DIR="${COVERAGE_ROOT:-../coverage}/tla"
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

# Saves TLC's coverage statistics for a config to COVERAGE_DIR.
save_coverage() {
  local name="$1" out="$2"
  { grep -v '^@!@!@' <<<"${out}" || true; } \
    | sed -n '/^The coverage statistics/,$p' >"${COVERAGE_DIR}/${name}.txt"
}

#######################################
# Names the actions that fired in none of a spec's configs, summing each
# action's fires over the spec's statistics files. An action's line reads
# `<Name line ... of module M>: distinct:total`, with the disjunct's location
# in parentheses before `>` when the action is written inline in Next.
# Globals:
#   COVERAGE_DIR
# Outputs:
#   One line per action that never fired, to stdout, sorted.
#######################################
never_fired() {
  { awk -F': ' '/^<[A-Za-z_]+ line .*>: [0-9]+:[0-9]+$/ {
    spec = FILENAME; sub(/.*\//, "", spec); sub(/[_.].*/, "", spec)
    action = $1; sub(/^</, "", action); sub(/ line [^(>]*/, "", action)
    sub(/>$/, "", action); sub(/.*:/, "", $2)
    fires[spec ": action " action] += $2
  } END {
    for (key in fires) if (fires[key] == 0) print "  " key " never fired"
  }' "${COVERAGE_DIR}"/*.txt || true; } | sort
}

for cfg in ./*.cfg; do
  file="${cfg#./}"
  name="${file%.cfg}"
  spec="${name%%_*}"
  out="$(
    "${TLC_COMMAND[@]}" -workers auto -cleanup -metadir "${META}/${name}" \
      ${coverage[@]+"${coverage[@]}"} -config "${file}" "${spec}.tla" 2>&1
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
  printf '%-22s %-9s %s\n' "${file}" "${result}" "${mark}"
  if [[ "${mark}" != 'ok' ]]; then
    excerpt="$(grep -v '^@!@!@' <<<"${out}")"
    tail -n 60 <<<"${excerpt}" >&2
  fi
  if ((${#coverage[@]} > 0)); then
    save_coverage "${name}" "${out}"
  fi
done

rm -rf "${META}"
if ((${#coverage[@]} > 0)); then
  never_fired
  node ../scripts/coverage_report.ts --tla --check || status=1
fi
exit "${status}"
