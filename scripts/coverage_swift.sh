#!/bin/bash
#
# Tests the icon's Swift package with coverage, and puts llvm-cov's export in
# coverage/swift/icon.json for COVERAGE.md; the run fails below the file's
# minimums in coverage_thresholds.json (#161). macOS: it needs Xcode.
set -eu

readonly PACKAGE='packages/vscode/scripts/icon'
# COVERAGE_ROOT: where the reports go; the repository's coverage/ by default.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
readonly ROOT
readonly COVERAGE_DIR="${COVERAGE_ROOT:-${ROOT}/coverage}/swift"

cd "${ROOT}"
swift test --package-path "${PACKAGE}" --enable-code-coverage
mkdir -p "${COVERAGE_DIR}"
# SwiftPM writes the export next to its profile data, named for the package.
cp "${PACKAGE}/.build/debug/codecov/icon.json" "${COVERAGE_DIR}/icon.json"
node scripts/coverage_report.ts --swift --check
