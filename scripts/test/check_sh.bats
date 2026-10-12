#!/usr/bin/env bats
# specs/check.sh against a fake tlc: a pass, a violation, an error, and --coverage.

setup() {
  ROOT="$(cd "${BATS_TEST_DIRNAME}/../.." && pwd)"
  export ROOT
  FAKE="${BATS_TEST_TMPDIR}/bin"
  mkdir -p "${FAKE}"
  export COVERAGE_ROOT="${BATS_TEST_TMPDIR}/coverage"
  export COVERAGE_MD="${BATS_TEST_TMPDIR}/COVERAGE.md"
  # The fake prints what TLC prints, by the config's name: Wire fails, Reload errors, the rest pass,
  # each with coverage statistics in which `Never` never fired.
  cat >"${FAKE}/tlc" <<'TLC'
#!/usr/bin/env python3
import sys

args = sys.argv[1:]
config = args[args.index('-config') + 1] if '-config' in args else ''
name = config.removesuffix('.cfg')
print('@!@!@STARTMSG 2185:0 @!@!@')
if config == 'Wire.cfg':
    print('Error: Invariant TypeOK is violated.')
elif config == 'Reload.cfg':
    print('Error: Parsing or semantic analysis failed.')
else:
    print('The coverage statistics at 2026-10-11 (see https://explain.tlapl.us)')
    print(f'<Init line 1, col 1 to line 1, col 4 of module {name}>: 1:1')
    print(f'<Step line 2, col 1 to line 2, col 4 of module {name}>: 3:9')
    print(f'<Never line 3, col 1 to line 3, col 5 of module {name}>: 0:0')
    print('Model checking completed. No error has been found.')
TLC
  chmod +x "${FAKE}/tlc"
  export TLC="${FAKE}/tlc"
}

@test "names every config, and fails on a violation or an error" {
  run --separate-stderr bash "${ROOT}/specs/check.sh"
  [[ "${status}" -eq 1 ]]
  [[ "${output}" == *'Wire.cfg             violation FAILED'* ]]
  [[ "${output}" == *'Reload.cfg           error     FAILED'* ]]
  [[ "${output}" == *'Serialize.cfg        pass      ok'* ]]
  configs="$(find "${ROOT}/specs" -name '*.cfg' | wc -l | tr -d ' ')"
  [[ "$(grep -c ' ok$' <<<"${output}")" -eq $((configs - 2)) ]]
}

@test "passes when every config passes" {
  printf '#!/usr/bin/env python3\nprint("No error has been found.")\n' >"${TLC}"
  run --separate-stderr bash "${ROOT}/specs/check.sh"
  [[ "${status}" -eq 0 ]]
  [[ "${output}" != *'FAILED'* ]]
}

@test "--coverage keeps the statistics, names an action that never fired, and updates the table" {
  run --separate-stderr bash "${ROOT}/specs/check.sh" --coverage
  [[ -f "${COVERAGE_ROOT}/tla/Serialize.txt" ]]
  [[ "$(head -1 "${COVERAGE_ROOT}/tla/Serialize.txt")" == 'The coverage statistics'* ]]
  [[ "${output}" == *'  Serialize: action Never never fired'* ]]
  [[ -f "${COVERAGE_MD}" ]]
  grep -q '| `specs/Serialize.tla` | TLA+ | - | - | 2 of 3 actions (never: Never) |' "${COVERAGE_MD}"
}
