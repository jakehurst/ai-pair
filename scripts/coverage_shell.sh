#!/bin/bash
#
# Runs the shell scripts' tests (bats, in scripts/test) under kcov, which
# traces bash line by line, puts the merged report in coverage/shell for
# COVERAGE.md, and fails below coverage_thresholds.json (#161). Needs kcov
# (apt install kcov), on Linux: on macOS, kcov's bash tracing rides on
# stderr, which bats captures, so every script reads 0 there. CI runs it on
# Ubuntu; its COVERAGE.md is in the check job's artifact.
set -eu

# COVERAGE_ROOT: where the reports go; the repository's coverage/ by default.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
readonly ROOT
readonly COVERAGE_DIR="${COVERAGE_ROOT:-${ROOT}/coverage}/shell"
# The folders with scripts to measure; the tests' own files are left out.
readonly SCRIPT_DIRS=(specs scripts packages/vscode/scripts .claude)

cd "${ROOT}"
rm -rf "${COVERAGE_DIR}"
include=''
parse=()
for dir in "${SCRIPT_DIRS[@]}"; do
  include="${include}${include:+,}${ROOT}/${dir}"
  parse+=("--bash-parse-files-in-dir=${ROOT}/${dir}")
done
# One bats file at a time, each into its own folder, then merged: kcov names
# a run's folder for the command, and every run's command is bats.
runs=()
for tests in scripts/test/*.bats; do
  run="${COVERAGE_DIR}/$(basename "${tests}" .bats)"
  runs+=("${run}")
  # Debian's kcov writes its bash helper there before it makes the folder.
  mkdir -p "${run}"
  kcov --include-path="${include}" --exclude-pattern=/test/,.cfg,.tla \
    "${parse[@]}" "${run}" node_modules/.bin/bats "${tests}"
done
kcov --merge "${COVERAGE_DIR}/kcov-merged" "${runs[@]}"
node scripts/coverage_report.ts --shell --check
