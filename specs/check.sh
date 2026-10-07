#!/usr/bin/env bash
# Runs TLC on every config in specs/. Spec.cfg checks the code as it is and
# must pass. Spec_<commit>.cfg models the code at that commit, before a fix,
# and must find a violation.
set -u
cd "$(dirname "$0")"
tlc="${TLC:-tlc}"
# TLC keeps its state files here, not in specs/.
meta="$(mktemp -d)"
status=0

for cfg in *.cfg; do
  name="${cfg%.cfg}"
  spec="${name%%_*}"
  out="$($tlc -workers auto -cleanup -metadir "$meta/$name" -config "$cfg" "$spec.tla" 2>&1)"
  if printf '%s\n' "$out" | grep -q 'No error has been found'; then
    result=pass
  elif printf '%s\n' "$out" | grep -q 'violated'; then
    result=violation
  else
    result=error
  fi
  case "$name" in
    *_*) expected=violation ;;
    *) expected=pass ;;
  esac
  if [ "$result" = "$expected" ]; then
    mark=ok
  else
    mark=UNEXPECTED
    status=1
  fi
  printf '%-28s expected %-9s got %-9s %s\n' "$cfg" "$expected" "$result" "$mark"
  if [ "$mark" != ok ]; then
    printf '%s\n' "$out" | grep -v '^@!@!@' | tail -60
  fi
done

rm -rf "$meta"
exit "$status"
