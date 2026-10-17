// The coverage report on its own (#176): how each tool's reader turns its report into cells, how the table keeps
// the other columns, and what `--check` fails on. Solitary: git (through node:child_process) and the files are
// fakes; the script runs afresh on each import. coverage_report.e2e.test.ts runs it on real fixture files.

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** The folders the fakes give, by absolute path, with their entries; made before the `vi.mock` factories run. */
const dirs = vi.hoisted(() => new Map<string, string[]>());

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  // A plain function, since readdirSync's overloads do not take a fake that returns names.
  readdirSync: (dir: string) => {
    const entries = dirs.get(dir);
    if (entries === undefined) throw new Error(`ENOENT: ${dir}`);
    return entries;
  },
  writeFileSync: vi.fn(),
}));

/** The repository's root, as the script finds it. */
const ROOT = path.resolve(import.meta.dirname, '..');
/** Where the fakes put the reports, the table, and the minimums when the tests name them. */
const ELSEWHERE = '/elsewhere';
/** The files the fakes give, by absolute path. */
const files = new Map<string, string>();
/** The day the fake clock says it is. */
const TODAY = '2026-10-17';

/** Returns a path from the root as an absolute one. */
function rooted(file: string): string {
  return path.join(ROOT, file);
}

/** Returns an Istanbul summary's entry for a file covered `pct` percent by every measure. */
function summary(pct: number): object {
  return { lines: { pct }, branches: { pct }, functions: { pct } };
}

/** Returns llvm-cov's summary of a file, with its three measures. */
function llvm(lines: unknown, regions: unknown, functions: unknown): object {
  return { lines: { percent: lines }, regions: { percent: regions }, functions: { percent: functions } };
}

/** What the script printed and wrote, and its exit code. */
interface Ran {
  errors: string[];
  logs: string[];
  exit?: number;
  /** The table's rows in the COVERAGE.md it wrote, or the whole text when there is no table. */
  rows: string[];
  text: string;
}

/** Runs the script with `args`, as `npm run test:coverage` does, against the files git lists, and returns what it did. */
async function ran(args: readonly string[], tracked: readonly string[] = []): Promise<Ran> {
  vi.mocked(execFileSync).mockReturnValue(`${tracked.join('\n')}\n`);
  const errors: string[] = [];
  const logs: string[] = [];
  let exit: number | undefined;
  vi.spyOn(console, 'error').mockImplementation((line: string) => {
    errors.push(line);
  });
  vi.spyOn(console, 'log').mockImplementation((line: string) => {
    logs.push(line);
  });
  // An exit ends the script, as it does a process.
  vi.spyOn(process, 'exit').mockImplementation((code) => {
    exit = Number(code);
    throw new Error('exit');
  });
  process.argv = ['node', 'scripts/coverage_report.ts', ...args];
  vi.resetModules();
  await import('./coverage_report.ts').catch(() => {});
  const written = vi.mocked(fs.writeFileSync).mock.lastCall?.[1];
  const text = typeof written === 'string' ? written : '';
  return { errors, logs, exit, rows: text.split('\n').filter((line) => line.startsWith('| `')), text };
}

beforeEach(() => {
  files.clear();
  dirs.clear();
  for (const name of ['COVERAGE_ROOT', 'COVERAGE_MD', 'COVERAGE_THRESHOLDS', 'SPECS_README']) {
    vi.stubEnv(name, undefined);
  }
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`));
  vi.mocked(fs.existsSync).mockImplementation((file) => files.has(String(file)) || dirs.has(String(file)));
  vi.mocked(fs.readFileSync).mockImplementation((file) => {
    const text = files.get(String(file));
    if (text === undefined) throw new Error(`ENOENT: ${String(file)}`);
    return text;
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

it('prints its usage and fails without a tool to report', async () => {
  const result = await ran(['--check']);
  expect(result.errors).toEqual([
    'Usage: node scripts/coverage_report.ts --unit | --integration | --tla | --swift | --shell | --css [--check]',
  ]);
  expect(result.exit).toBe(1);
  expect(fs.writeFileSync).not.toHaveBeenCalled();
});

describe('the table', () => {
  it('lists every file of a listed type in path order, marking tests and files no tool measured', async () => {
    const result = await ran(['--unit'], ['z.sh', 'README.md', 'a/test/helper.ts', 'b.test.ts', 'a/src/a.ts', 'specs/Foo.tla']);
    expect(execFileSync).toHaveBeenCalledWith('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(result.rows).toEqual([
      '| `a/src/a.ts` | TypeScript | - | - | - | - | - | - |',
      '| `a/test/helper.ts` | TypeScript | test | - | - | - | - | - |',
      '| `b.test.ts` | TypeScript | test | - | - | - | - | - |',
      '| `specs/Foo.tla` | TLA+ | - | - | - | - | - | - |',
      '| `z.sh` | Shell | - | - | - | - | - | - |',
    ]);
    expect(result.text).toContain(`Last updated: unit, ${TODAY}.`);
    expect(vi.mocked(fs.writeFileSync).mock.lastCall?.[0]).toBe(rooted('COVERAGE.md'));
    expect(result.logs).toEqual(['COVERAGE.md: unit column updated for 0 files']);
    expect(result.exit).toBeUndefined();
  });

  it('keeps the cells of the columns this run does not measure, and fills a short row with dashes', async () => {
    files.set(
      rooted('COVERAGE.md'),
      [
        '# Coverage',
        '| `a.ts` | TypeScript | old | L 1.0% B 1.0% F 1.0% | t | s | h | c |',
        '| `b.css` | CSS | old |',
        '| `gone.ts` | TypeScript | old | i | t | s | h | c |',
      ].join('\n'),
    );
    const result = await ran(['--unit'], ['a.ts', 'b.css']);
    expect(result.rows).toEqual([
      '| `a.ts` | TypeScript | - | L 1.0% B 1.0% F 1.0% | t | s | h | c |',
      '| `b.css` | CSS | - | - | - | - | - | - |',
    ]);
  });

  it('reads and writes where the environment says', async () => {
    vi.stubEnv('COVERAGE_ROOT', ELSEWHERE);
    vi.stubEnv('COVERAGE_MD', `${ELSEWHERE}/TABLE.md`);
    files.set(`${ELSEWHERE}/unit/coverage-summary.json`, JSON.stringify({ [rooted('a.ts')]: summary(50) }));
    const result = await ran(['--unit'], ['a.ts']);
    expect(result.rows).toEqual(['| `a.ts` | TypeScript | L 50.0% B 50.0% F 50.0% | - | - | - | - | - |']);
    expect(vi.mocked(fs.writeFileSync).mock.lastCall?.[0]).toBe(`${ELSEWHERE}/TABLE.md`);
    expect(result.logs).toEqual([`${path.relative(ROOT, `${ELSEWHERE}/TABLE.md`)}: unit column updated for 1 files`]);
  });
});

describe('the unit and integration columns', () => {
  it("reads the repository's own files from vitest's summary, skipping the total, dependencies, and files outside", async () => {
    files.set(
      rooted('coverage/unit/coverage-summary.json'),
      JSON.stringify({
        'total': summary(1),
        [rooted('a.ts')]: summary(87.65),
        [rooted('node_modules/x/x.ts')]: summary(2),
        '/outside/y.ts': summary(3),
        [rooted('broken.ts')]: { lines: { pct: 1 }, branches: { pct: 'one' } },
      }),
    );
    const result = await ran(['--unit'], ['a.ts', 'broken.ts']);
    expect(result.rows).toEqual([
      '| `a.ts` | TypeScript | L 87.7% B 87.7% F 87.7% | - | - | - | - | - |',
      '| `broken.ts` | TypeScript | - | - | - | - | - | - |',
    ]);
    expect(result.logs).toEqual(['COVERAGE.md: unit column updated for 1 files']);
  });

  it('reads nothing from a summary that is not an object', async () => {
    files.set(rooted('coverage/unit/coverage-summary.json'), 'null');
    expect((await ran(['--unit'], ['a.ts'])).rows).toEqual(['| `a.ts` | TypeScript | - | - | - | - | - | - |']);
  });

  it("reads the integration column from c8's summary", async () => {
    files.set(rooted('coverage/integration/coverage-summary.json'), JSON.stringify({ [rooted('a.ts')]: summary(100) }));
    const result = await ran(['--integration'], ['a.ts']);
    expect(result.rows).toEqual(['| `a.ts` | TypeScript | - | L 100.0% B 100.0% F 100.0% | - | - | - | - |']);
  });
});

describe('the TLC column', () => {
  /** TLC's statistics folder, as the script finds it. */
  const tla = rooted('coverage/tla');

  it('reads nothing without the statistics folder', async () => {
    expect((await ran(['--tla'], ['specs/Foo.tla'])).rows).toEqual(['| `specs/Foo.tla` | TLA+ | - | - | - | - | - | - |']);
  });

  it("adds up each action's firings over every config of a spec, naming the ones that never fired", async () => {
    dirs.set(tla, ['Foo_Model.txt', 'Foo.txt', 'notes.md', 'Bar.txt']);
    files.set(
      `${tla}/Foo.txt`,
      [
        'Some other line',
        '<Init line 3, col 1 to line 4, col 9 of module Foo>: 1:1',
        '<Step line 6, col 1 to line 8, col 2 of module Foo>: 0:0',
        '<Next line 10, col 3 to line 10, col 9 of module Foo (10 3)>: 0:0',
      ].join('\n'),
    );
    files.set(`${tla}/Foo_Model.txt`, '<Step line 6, col 1 to line 8, col 2 of module Foo>: 2:5');
    files.set(`${tla}/Bar.txt`, '<Init line 3 of module Bar>: 1:1');
    const result = await ran(['--tla'], ['specs/Bar.tla', 'specs/Foo.tla']);
    expect(result.rows).toEqual([
      '| `specs/Bar.tla` | TLA+ | - | - | 1 of 1 actions | - | - | - |',
      '| `specs/Foo.tla` | TLA+ | - | - | 2 of 3 actions (never: Next(10 3)) | - | - | - |',
    ]);
    expect(fs.readFileSync).not.toHaveBeenCalledWith(`${tla}/notes.md`, 'utf8');
  });
});

describe('the Swift column', () => {
  /** llvm-cov's export, as the script finds it. */
  const exported = rooted('coverage/swift/icon.json');

  it('reads nothing without the export, or from one that is not an object or has no data', async () => {
    expect((await ran(['--swift'], ['a.swift'])).logs).toEqual(['COVERAGE.md: swift column updated for 0 files']);
    files.set(exported, 'null');
    expect((await ran(['--swift'], ['a.swift'])).logs).toEqual(['COVERAGE.md: swift column updated for 0 files']);
    files.set(exported, JSON.stringify({ data: 'none' }));
    expect((await ran(['--swift'], ['a.swift'])).logs).toEqual(['COVERAGE.md: swift column updated for 0 files']);
  });

  it("reads each file's lines, regions, and functions, skipping entries that are not whole", async () => {
    files.set(
      exported,
      JSON.stringify({
        data: [
          'not a datum',
          { files: 'none' },
          {
            files: [
              'not a file',
              { filename: 7, summary: {} },
              { filename: rooted('b.swift'), summary: 'none' },
              { filename: rooted('b.swift'), summary: llvm(undefined, 1, 1) },
              { filename: rooted('b.swift'), summary: llvm(1, undefined, 1) },
              { filename: rooted('b.swift'), summary: llvm(1, 1, undefined) },
              { filename: rooted('a.swift'), summary: llvm(90, 80.04, 70) },
            ],
          },
        ],
      }),
    );
    const result = await ran(['--swift'], ['a.swift', 'b.swift']);
    expect(result.rows).toEqual([
      '| `a.swift` | Swift | - | - | - | L 90.0% R 80.0% F 70.0% | - | - |',
      '| `b.swift` | Swift | - | - | - | - | - | - |',
    ]);
  });
});

describe('the Shell column', () => {
  /** kcov's output folder, as the script finds it. */
  const shell = rooted('coverage/shell');
  /** kcov's report of one script, `a.sh`, 3 of 4 lines covered. */
  const REPORT = JSON.stringify({ files: [{ file: '/ci/repo/a.sh', percent_covered: '75', covered_lines: 3, total_lines: 4 }] });
  /** The row of a.sh when the report is read. */
  const READ = '| `a.sh` | Shell | - | - | - | - | L 75.0% (3 of 4) | - |';
  /** The row of a.sh when no report is read. */
  const UNREAD = '| `a.sh` | Shell | - | - | - | - | - | - |';

  it('reads nothing without the folder, or without a report in it', async () => {
    expect((await ran(['--shell'], ['a.sh'])).rows).toEqual([UNREAD]);
    dirs.set(shell, ['run']);
    expect((await ran(['--shell'], ['a.sh'])).rows).toEqual([UNREAD]);
  });

  it("reads kcov's merged report, nested or not, before any one run's", async () => {
    dirs.set(shell, ['run']);
    files.set(`${shell}/run/coverage.json`, JSON.stringify({ files: [] }));
    files.set(`${shell}/kcov-merged/coverage.json`, REPORT);
    expect((await ran(['--shell'], ['a.sh'])).rows).toEqual([READ]);
    files.set(`${shell}/kcov-merged/kcov-merged/coverage.json`, JSON.stringify({ files: [] }));
    expect((await ran(['--shell'], ['a.sh'])).rows).toEqual([UNREAD]);
  });

  it("reads the one run's report when there is no merged one", async () => {
    dirs.set(shell, ['empty', 'run']);
    files.set(`${shell}/run/coverage.json`, REPORT);
    expect((await ran(['--shell'], ['a.sh'])).rows).toEqual([READ]);
  });

  it('reads nothing from a report that is not an object or has no files, and skips entries that are not whole', async () => {
    dirs.set(shell, ['run']);
    files.set(`${shell}/run/coverage.json`, 'null');
    expect((await ran(['--shell'], ['a.sh'])).rows).toEqual([UNREAD]);
    files.set(`${shell}/run/coverage.json`, JSON.stringify({ files: 'none' }));
    expect((await ran(['--shell'], ['a.sh'])).rows).toEqual([UNREAD]);
    files.set(
      `${shell}/run/coverage.json`,
      JSON.stringify({
        files: [
          'not a file',
          { file: 7, percent_covered: '1' },
          { file: '/ci/repo/a.sh', percent_covered: 1 },
          { file: '/ci/repo/other.sh', percent_covered: '1', covered_lines: 1, total_lines: 1 },
        ],
      }),
    );
    expect((await ran(['--shell'], ['a.sh'])).rows).toEqual([UNREAD]);
  });
});

describe('the CSS column', () => {
  /** The rule-usage test's summary, as the script finds it. */
  const css = rooted('coverage/css/summary.json');
  /** The row of the stylesheet when no summary is read. */
  const UNREAD = '| `a.css` | CSS | - | - | - | - | - | - |';

  it('reads nothing without the summary, or from one that is not whole', async () => {
    expect((await ran(['--css'], ['a.css'])).rows).toEqual([UNREAD]);
    for (const text of ['null', '{"rules": 1, "matched": 1}', '{"file": "a.css", "matched": 1}', '{"file": "a.css", "rules": 1}']) {
      files.set(css, text);
      expect((await ran(['--css'], ['a.css'])).rows).toEqual([UNREAD]);
    }
  });

  it('reads the rules the page matched over the rules written', async () => {
    files.set(css, JSON.stringify({ file: 'a.css', rules: 4, matched: 3 }));
    expect((await ran(['--css'], ['a.css'])).rows).toEqual(['| `a.css` | CSS | - | - | - | - | - | 3 of 4 rules matched |']);
  });
});

describe('--check', () => {
  /** The minimums file, as the script finds it by default. */
  const thresholds = rooted('coverage_thresholds.json');

  beforeEach(() => {
    files.set(rooted('coverage/css/summary.json'), JSON.stringify({ file: 'a.css', rules: 4, matched: 3 }));
  });

  it('passes without minimums, or with minimums that are not an object', async () => {
    expect((await ran(['--css', '--check'], ['a.css'])).exit).toBeUndefined();
    files.set(thresholds, 'null');
    expect((await ran(['--css', '--check'], ['a.css'])).exit).toBeUndefined();
  });

  it('passes a run at its minimums, skipping entries that are not minimums', async () => {
    files.set(
      thresholds,
      JSON.stringify({
        'a.css': { css: { rules: 75, note: 'not a number' }, unit: 'not measures' },
        'b.ts': 'not tools',
        'c.ts': { unit: { lines: 100 } },
      }),
    );
    const result = await ran(['--css', '--check'], ['a.css']);
    expect(result).toMatchObject({ errors: [], exit: undefined });
  });

  it('fails a run below its minimum, or that did not measure a file with one, naming each', async () => {
    vi.stubEnv('COVERAGE_THRESHOLDS', `${ELSEWHERE}/minimums.json`);
    files.set(`${ELSEWHERE}/minimums.json`, JSON.stringify({ 'a.css': { css: { rules: 76 } }, 'gone.css': { css: { rules: 1 } } }));
    const result = await ran(['--css', '--check'], ['a.css']);
    expect(result.errors).toEqual([
      'a.css: css rules 75.0%, minimum 76%\ngone.css: css rules not measured, minimum 1%',
      '2 below coverage_thresholds.json',
    ]);
    expect(result.exit).toBe(1);
  });

  it('does not check without the flag', async () => {
    files.set(thresholds, JSON.stringify({ 'a.css': { css: { rules: 100 } } }));
    expect((await ran(['--css'], ['a.css'])).exit).toBeUndefined();
  });

  describe('of actions that never fired', () => {
    /** TLC's statistics folder, as the script finds it. */
    const tla = rooted('coverage/tla');

    beforeEach(() => {
      dirs.set(tla, ['Foo.txt', 'Bar.txt', 'Baz.txt']);
      files.set(`${tla}/Foo.txt`, '<Idle line 3 of module Foo>: 0:0\n<Step line 4 of module Foo>: 1:1');
      files.set(`${tla}/Bar.txt`, '<Wait line 3 of module Bar>: 0:0');
      files.set(`${tla}/Baz.txt`, '<Halt line 3 of module Baz>: 0:0');
    });

    it('fails on each one when there is no README to excuse it', async () => {
      const result = await ran(['--tla', '--check'], ['specs/Foo.tla']);
      expect(result.errors).toEqual([
        [
          'specs/Bar.tla: action Wait never fired, and specs/README.md does not say it never fires',
          'specs/Baz.tla: action Halt never fired, and specs/README.md does not say it never fires',
          'specs/Foo.tla: action Idle never fired, and specs/README.md does not say it never fires',
        ].join('\n'),
        '3 below coverage_thresholds.json',
      ]);
      expect(result.exit).toBe(1);
    });

    it("passes the ones a spec's section says never fire, in a sentence naming them", async () => {
      vi.stubEnv('SPECS_README', `${ELSEWHERE}/README.md`);
      files.set(
        `${ELSEWHERE}/README.md`,
        [
          '# Specs',
          '### `Foo`',
          'The action `Idle` is there for',
          'completeness and never fires. `Wait` never fires.',
          '### `Bar`',
          'The action `Wait` is the one. It never fires.',
        ].join('\n'),
      );
      const result = await ran(['--tla', '--check'], ['specs/Foo.tla']);
      expect(result.errors).toEqual([
        [
          'specs/Bar.tla: action Wait never fired, and specs/README.md does not say it never fires',
          'specs/Baz.tla: action Halt never fired, and specs/README.md does not say it never fires',
        ].join('\n'),
        '2 below coverage_thresholds.json',
      ]);
    });
  });
});
