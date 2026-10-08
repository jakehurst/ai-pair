#!/usr/bin/env bash
# Runs TLC on every config in specs/. Spec.cfg checks the code as it is and
# must pass.
set -u
cd "$(dirname "$0")"
tlc="${TLC:-tlc}"
# TLC keeps its state files here, not in specs/.
meta="$(mktemp -d)"
status=0

for cfg in *.cfg; do
  name="${cfg%.cfg}"
  out="$($tlc -workers auto -cleanup -metadir "$meta/$name" -config "$cfg" "$name.tla" 2>&1)"
  if printf '%s\n' "$out" | grep -q 'No error has been found'; then
    result=pass
  elif printf '%s\n' "$out" | grep -q 'violated'; then
    result=violation
  else
    result=error
  fi
  if [ "$result" = pass ]; then
    mark=ok
  else
    mark=FAILED
    status=1
  fi
  printf '%-20s %-9s %s\n' "$cfg" "$result" "$mark"
  if [ "$mark" != ok ]; then
    printf '%s\n' "$out" | grep -v '^@!@!@' | tail -60
  fi
done

rm -rf "$meta"
exit "$status"
