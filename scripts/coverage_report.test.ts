// Tests for scripts/coverage_report.ts (#161): `--check` fails a run below coverage_thresholds.json, naming the file,
// the measure, and both numbers; passes at the minimum; and fails a file in the thresholds that the run did not measure.

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { expect, it } from 'vitest';

const SCRIPT = path.join(import.meta.dirname, 'coverage_report.ts');
/** The one file the CSS reader reports, as the stylesheet's test names it. */
const STYLESHEET = 'packages/vscode/src/webview/panel.css';

interface Fixture {
  /** The stylesheet's rules, and how many the page matched. */
  rules: number;
  matched: number;
  /** The minimum percent of rules matched, and the file it is for. */
  minimum: number;
  thresholdFile?: string;
  check?: boolean;
}

interface Run {
  status: number;
  stderr: string;
  /** The COVERAGE.md the run wrote. */
  report: string;
}

/** Runs the script as Node does, with the given env paths, and returns its exit status, stderr, and the table it wrote. */
function invoke(args: readonly string[], env: NodeJS.ProcessEnv): Run {
  const result = spawnSync('node', [SCRIPT, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
  const report = env.COVERAGE_MD;
  return { status: result.status ?? 1, stderr: result.stderr, report: report === undefined ? '' : fs.readFileSync(report, 'utf8') };
}

/** Runs the script with `--css` on the fixture, in a temp folder, through the env paths it takes. */
function run(fixture: Fixture): Run {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coverage_report-'));
  const coverage = path.join(dir, 'coverage');
  fs.mkdirSync(path.join(coverage, 'css'), { recursive: true });
  const summary = { file: STYLESHEET, rules: fixture.rules, matched: fixture.matched };
  fs.writeFileSync(path.join(coverage, 'css/summary.json'), JSON.stringify(summary));
  const thresholds = path.join(dir, 'coverage_thresholds.json');
  const minimums = { [fixture.thresholdFile ?? STYLESHEET]: { css: { rules: fixture.minimum } } };
  fs.writeFileSync(thresholds, JSON.stringify(minimums));
  const args = ['--css', ...(fixture.check === false ? [] : ['--check'])];
  return invoke(args, { COVERAGE_ROOT: coverage, COVERAGE_MD: path.join(dir, 'COVERAGE.md'), COVERAGE_THRESHOLDS: thresholds });
}

/**
 * Runs the script with `--tla --check` on a spec whose `Never` action never fired, against the README text given.
 * `spec` names the spec, `Fake` by default; with `otherFires`, a second config, `<spec>_Other`, fires `Never`.
 * With `inlineNext`, two disjuncts of an inline `Next`, told apart by their location, one of which never fired.
 */
function runTla(readme: string, options: { spec?: string; otherFires?: boolean; inlineNext?: boolean } = {}): Run {
  const { spec = 'Fake', otherFires = false, inlineNext = false } = options;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coverage_report-'));
  const coverage = path.join(dir, 'coverage');
  fs.mkdirSync(path.join(coverage, 'tla'), { recursive: true });
  const statistics = [
    '<Init line 1, col 1 to line 1, col 4 of module Fake>: 1:1',
    '<Never line 2, col 1 to line 2, col 5 of module Fake>: 0:0',
    ...(inlineNext
      ? [
          '<Next line 3, col 1 to line 3, col 4 of module Fake (5 8 5 20)>: 1:4',
          '<Next line 3, col 1 to line 3, col 4 of module Fake (6 8 6 20)>: 0:0',
        ]
      : []),
    '',
  ];
  fs.writeFileSync(path.join(coverage, `tla/${spec}.txt`), statistics.join('\n'));
  if (otherFires) {
    const other = statistics.map((line) => line.replace(': 0:0', ': 3:9'));
    fs.writeFileSync(path.join(coverage, `tla/${spec}_Other.txt`), other.join('\n'));
  }
  const readmeFile = path.join(dir, 'README.md');
  fs.writeFileSync(readmeFile, readme);
  return invoke(['--tla', '--check'], { COVERAGE_ROOT: coverage, COVERAGE_MD: path.join(dir, 'COVERAGE.md'), SPECS_README: readmeFile });
}

it('--check fails below the minimum, naming the file, the measure, and both numbers', () => {
  const result = run({ rules: 115, matched: 114, minimum: 100 });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(`${STYLESHEET}: css rules 99.1%, minimum 100%`);
  expect(result.stderr).toContain('1 below coverage_thresholds.json');
});

it('--check passes at the minimum', () => {
  const result = run({ rules: 115, matched: 115, minimum: 100 });
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
});

it('--check fails a file in the thresholds that the run did not measure', () => {
  const gone = 'packages/vscode/src/webview/gone.css';
  const result = run({ rules: 115, matched: 115, minimum: 100, thresholdFile: gone });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(`${gone}: css rules not measured, minimum 100%`);
});

it('without --check, a run below the minimum passes', () => {
  const result = run({ rules: 115, matched: 114, minimum: 100, check: false });
  expect(result.status).toBe(0);
});

it('--tla --check fails on an action that never fired, naming the spec and the action', () => {
  const result = runTla('### `Fake`\n\n`Never` is the step the code takes on a miss.\n');
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('specs/Fake.tla: action Never never fired, and specs/README.md does not say it never fires');
});

it("--tla --check passes when the spec's own README section says the action never fires", () => {
  const result = runTla('### `Fake`\n\nWith `Fix = TRUE`, `Never` can never fire.\n\n### `Other`\n\n`Never` fires here.\n');
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
});

it("--tla --check ignores another spec's section saying the action never fires", () => {
  const result = runTla('### `Other`\n\n`Never` can never fire.\n');
  expect(result.status).toBe(1);
});

it("--check compares at the table's precision, one decimal", () => {
  const result = run({ rules: 2500, matched: 2499, minimum: 100 });
  expect(result.status).toBe(0);
});

it("--tla --check counts an action as fired when any of the spec's configs fires it", () => {
  const result = runTla('### `Serialize`\n\n`Never` is the step the code takes on a miss.\n', { spec: 'Serialize', otherFires: true });
  expect(result.status).toBe(0);
  expect(result.report).toContain('| `specs/Serialize.tla` | TLA+ | - | - | 2 of 2 actions |');
});

it('--tla --check keeps the disjuncts of an inline Next apart by their location, and names one that never fired', () => {
  const result = runTla('### `Fake`\n\n`Never` can never fire.\n', { inlineNext: true });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('specs/Fake.tla: action Next(6 8 6 20) never fired');
});
