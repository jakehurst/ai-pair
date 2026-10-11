#!/bin/bash
#
# Runs TLC on every config in specs/. Spec.cfg checks the code as it is and
# must pass.
set -u

cd "$(dirname "$0")" || exit 1
# TLC: the command that runs TLC, with its arguments, split on spaces.
read -r -a TLC_COMMAND <<<"${TLC:-tlc}"
readonly TLC_COMMAND
# TLC keeps its state files here, not in specs/.
META="$(mktemp -d)" || exit 1
readonly META
status=0

for cfg in ./*.cfg; do
  file="${cfg#./}"
  name="${file%.cfg}"
  out="$(
    "${TLC_COMMAND[@]}" -workers auto -cleanup -metadir "${META}/${name}" \
      -config "${file}" "${name}.tla" 2>&1
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
done

rm -rf "${META}"
exit "${status}"
