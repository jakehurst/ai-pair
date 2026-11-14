#!/usr/bin/env bats
# Check event coverage and isolation of cancellation groups.

setup() {
  ROOT="$(cd "${BATS_TEST_DIRNAME}/../.." && pwd)"
}

@test "packaging runs for main, pull requests and manual dispatch only" {
  python3 - "${ROOT}/.github/workflows/build-vsix.yml" <<'PY'
import sys
text = open(sys.argv[1]).read()
triggers = text.split("\non:\n", 1)[1].split("\n\n", 1)[0]
assert triggers == "  push:\n    branches: [main]\n  pull_request:\n  workflow_dispatch:"
PY
}

@test "CI and packaging isolate pull requests, main and manual runs" {
  python3 - "${ROOT}/.github/workflows/ci.yml" \
    "${ROOT}/.github/workflows/build-vsix.yml" <<'PY'
import sys
for path in sys.argv[1:]:
    text = open(path).read()
    concurrency = text.split("\nconcurrency:\n", 1)[1].split("\n\n", 1)[0]
    group = concurrency.splitlines()[0]
    assert 'github.workflow' in group and 'github.event_name' in group
    assert 'github.event.pull_request.number' in group and 'github.ref' in group
    assert 'github.run_id' in group and 'workflow_dispatch' in group
    assert 'cancel-in-progress: true' in concurrency
PY
}

@test "CI bounds each TLC JVM heap while allowing two processes" {
  python3 - "${ROOT}/.github/workflows/ci.yml" <<'PY'
import sys
text = open(sys.argv[1]).read()
assert 'TLC: java -Xmx2g -XX:+UseParallelGC' in text
PY
}
