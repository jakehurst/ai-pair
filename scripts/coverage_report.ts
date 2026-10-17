// Rewrites COVERAGE.md: one row per source file, with the coverage each tool last measured.
// Each tool's run calls this with its flag and updates its own column, keeping the others:
// `--unit` reads coverage/unit (vitest), `--integration` reads coverage/integration (c8 over the
// extension host), `--tla` reads coverage/tla (TLC's statistics per spec), `--swift` reads
// coverage/swift (llvm-cov's export), `--shell` reads coverage/shell (kcov), and `--css` reads
// coverage/css (the stylesheet's rule-usage test). Node runs it as is.
// With `--check`, it also exits 1 naming each file whose measure is below its minimum in
// coverage_thresholds.json (#161).

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
/** COVERAGE_ROOT and COVERAGE_MD: where the reports are and where the table goes; set by the shell tests. */
const COVERAGE_ROOT = process.env.COVERAGE_ROOT ?? path.join(ROOT, 'coverage');
const REPORT = process.env.COVERAGE_MD ?? path.join(ROOT, 'COVERAGE.md');
const UNIT_SUMMARY = path.join(COVERAGE_ROOT, 'unit/coverage-summary.json');
const INTEGRATION_SUMMARY = path.join(COVERAGE_ROOT, 'integration/coverage-summary.json');
const TLA_DIR = path.join(COVERAGE_ROOT, 'tla');
const SWIFT_EXPORT = path.join(COVERAGE_ROOT, 'swift/icon.json');
const SHELL_DIR = path.join(COVERAGE_ROOT, 'shell');
const CSS_SUMMARY = path.join(COVERAGE_ROOT, 'css/summary.json');
/** COVERAGE_THRESHOLDS: the minimums `--check` holds a run to; set by the tests. */
const THRESHOLDS = process.env.COVERAGE_THRESHOLDS ?? path.join(ROOT, 'coverage_thresholds.json');
/** SPECS_README: where a spec's section says which of its actions never fire; set by the tests. */
const SPECS_README = process.env.SPECS_README ?? path.join(ROOT, 'specs/README.md');
/** The columns a tool fills, in table order. */
const TOOLS = ['unit', 'integration', 'tla', 'swift', 'shell', 'css'] as const;
/** What is listed: code, specs and their configs, and the scripts and styles around them. */
const TYPES: ReadonlyMap<string, string> = new Map([
  ['.ts', 'TypeScript'],
  ['.mts', 'TypeScript'],
  ['.tla', 'TLA+'],
  ['.cfg', 'TLC config'],
  ['.sh', 'Shell'],
  ['.swift', 'Swift'],
  ['.css', 'CSS'],
]);
/** A TLC action's statistics line: `<Name line ... of module M>: distinct:total`, with the disjunct's location in parentheses before `>` when the action is written inline in `Next`. */
const ACTION = /^<([A-Za-z_]\w*) line [^(>]*(\([\d ]+\))?>: \d+:(\d+)$/;
/** ACTION's groups: the action's name, its inline location (optional), and how many times it fired. */
const ACTION_NAME = 1;
const ACTION_LOCATION = 2;
const ACTION_TOTAL = 3;
/** What separates the module's name from the model's in `Foo_<Model>.cfg`, and so in its statistics file (8.2). */
const MODEL_SEPARATOR = '_';
/** A row of the table: the file, its type, then one cell per tool. */
const ROW = /^\| `([^`]+)` \| [^|]+ \| (.*) \|$/;
const PERCENT_DIGITS = 1;
const PERCENT = 100;

type Tool = (typeof TOOLS)[number];
type Cells = Partial<Record<Tool, string>>;
/** The minimums, in percent: by file, then tool, then measure. */
type Thresholds = ReadonlyMap<string, ReadonlyMap<string, ReadonlyMap<string, number>>>;

interface Measure {
  pct: number;
}

interface FileSummary {
  lines: Measure;
  branches: Measure;
  functions: Measure;
}

/** What a tool measured for a file: the table's cell, and each measure in percent, by the thresholds' name. */
interface Measured {
  cell: string;
  measures: ReadonlyMap<string, number>;
  /** For a spec: the actions that never fired in any of its configs. */
  never?: readonly string[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isMeasure(v: unknown): v is Measure {
  return typeof v === 'object' && v !== null && 'pct' in v && typeof v.pct === 'number';
}

function isFileSummary(v: unknown): v is FileSummary {
  return (
    typeof v === 'object' &&
    v !== null &&
    'lines' in v &&
    isMeasure(v.lines) &&
    'branches' in v &&
    isMeasure(v.branches) &&
    'functions' in v &&
    isMeasure(v.functions)
  );
}

/** Returns a measure as a percentage with one decimal. */
function percent(value: number): string {
  return `${value.toFixed(PERCENT_DIGITS)}%`;
}

/** Returns a summary's cell and measures: lines, branches, and functions covered, in percent. */
function measured(summary: FileSummary): Measured {
  const { lines, branches, functions } = summary;
  return {
    cell: `L ${percent(lines.pct)} B ${percent(branches.pct)} F ${percent(functions.pct)}`,
    measures: new Map([
      ['lines', lines.pct],
      ['branches', branches.pct],
      ['functions', functions.pct],
    ]),
  };
}

/** Returns the cells of an Istanbul coverage summary, by path from the root, for the repository's own files. */
function readSummary(file: string): Map<string, Measured> {
  const cells = new Map<string, Measured>();
  if (!fs.existsSync(file)) return cells;
  const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null) return cells;
  for (const [key, value] of Object.entries(parsed)) {
    if (key === 'total' || !isFileSummary(value)) continue;
    const relative = path.relative(ROOT, key);
    if (relative.includes('node_modules') || relative.startsWith('..')) continue;
    cells.set(relative, measured(value));
  }
  return cells;
}

/** Returns a match's group `n`, or '' for an optional one that did not match. */
function group(match: RegExpExecArray, n: number): string {
  return match[n] ?? '';
}

/** Returns the cells of TLC's statistics: for each spec, how many of its actions fired in any of its configs. */
function readTlc(): Map<string, Measured> {
  const cells = new Map<string, Measured>();
  if (!fs.existsSync(TLA_DIR)) return cells;
  const fires = new Map<string, Map<string, number>>();
  for (const file of fs.readdirSync(TLA_DIR).toSorted()) {
    if (!file.endsWith('.txt')) continue;
    const actions = fs
      .readFileSync(path.join(TLA_DIR, file), 'utf8')
      .split('\n')
      .map((line) => ACTION.exec(line))
      .filter((match) => match !== null);
    const name = path.basename(file, '.txt');
    // Foo_Model.txt is a config of Foo.tla, as Foo.txt is (8.2).
    const separator = name.indexOf(MODEL_SEPARATOR);
    const spec = separator === -1 ? name : name.slice(0, separator);
    const counts = fires.get(spec) ?? new Map<string, number>();
    fires.set(spec, counts);
    for (const match of actions) {
      const key = group(match, ACTION_NAME) + group(match, ACTION_LOCATION);
      counts.set(key, (counts.get(key) ?? 0) + Number(group(match, ACTION_TOTAL)));
    }
  }
  for (const [spec, counts] of fires) {
    const never = [...counts].filter(([, total]) => total === 0).map(([action]) => action);
    const note = never.length === 0 ? '' : ` (never: ${never.join(', ')})`;
    cells.set(`specs/${spec}.tla`, {
      cell: `${counts.size - never.length} of ${counts.size} actions${note}`,
      measures: new Map<string, number>(),
      never,
    });
  }
  return cells;
}

/** Returns an llvm-cov summary's measure in percent, which it calls `percent`. */
function llvmPercent(v: unknown): number | undefined {
  return isRecord(v) && typeof v.percent === 'number' ? v.percent : undefined;
}

/** Returns the cells of llvm-cov's export for the Swift package: lines, regions, and functions covered. */
function readSwift(): Map<string, Measured> {
  const cells = new Map<string, Measured>();
  if (!fs.existsSync(SWIFT_EXPORT)) return cells;
  const parsed: unknown = JSON.parse(fs.readFileSync(SWIFT_EXPORT, 'utf8'));
  if (!isRecord(parsed) || !Array.isArray(parsed.data)) return cells;
  for (const datum of parsed.data) {
    if (!isRecord(datum) || !Array.isArray(datum.files)) continue;
    for (const file of datum.files) {
      if (!isRecord(file) || typeof file.filename !== 'string' || !isRecord(file.summary)) continue;
      const lines = llvmPercent(file.summary.lines);
      const regions = llvmPercent(file.summary.regions);
      const functions = llvmPercent(file.summary.functions);
      if (lines === undefined || regions === undefined || functions === undefined) continue;
      cells.set(path.relative(ROOT, file.filename), {
        cell: `L ${percent(lines)} R ${percent(regions)} F ${percent(functions)}`,
        measures: new Map([
          ['lines', lines],
          ['regions', regions],
          ['functions', functions],
        ]),
      });
    }
  }
  return cells;
}

/** Returns kcov's report: the merged one over every run (which kcov nests), or the one run's when there was one. */
function shellSummary(): string | undefined {
  if (!fs.existsSync(SHELL_DIR)) return undefined;
  const merged = ['kcov-merged/kcov-merged', 'kcov-merged']
    .map((dir) => path.join(SHELL_DIR, dir, 'coverage.json'))
    .find((file) => fs.existsSync(file));
  if (merged !== undefined) return merged;
  const run = fs.readdirSync(SHELL_DIR).find((entry) => fs.existsSync(path.join(SHELL_DIR, entry, 'coverage.json')));
  return run === undefined ? undefined : path.join(SHELL_DIR, run, 'coverage.json');
}

/** Returns the cells of kcov's report: lines covered, per script. */
function readShell(sources: readonly string[]): Map<string, Measured> {
  const cells = new Map<string, Measured>();
  const summary = shellSummary();
  if (summary === undefined) return cells;
  const parsed: unknown = JSON.parse(fs.readFileSync(summary, 'utf8'));
  if (!isRecord(parsed) || !Array.isArray(parsed.files)) return cells;
  for (const file of parsed.files) {
    if (!isRecord(file) || typeof file.file !== 'string' || typeof file.percent_covered !== 'string') continue;
    // The report may be CI's, where the root differs: the source is the path's tail.
    const reported = file.file;
    const source = sources.find((candidate) => reported.endsWith(`/${candidate}`));
    if (source === undefined) continue;
    const covered = Number(file.percent_covered);
    cells.set(source, {
      cell: `L ${percent(covered)} (${String(file.covered_lines)} of ${String(file.total_lines)})`,
      measures: new Map([['lines', covered]]),
    });
  }
  return cells;
}

/** Returns the cell of the stylesheet's rule-usage test: rules the page matched over rules written. */
function readCss(): Map<string, Measured> {
  const cells = new Map<string, Measured>();
  if (!fs.existsSync(CSS_SUMMARY)) return cells;
  const parsed: unknown = JSON.parse(fs.readFileSync(CSS_SUMMARY, 'utf8'));
  if (!isRecord(parsed) || typeof parsed.file !== 'string' || typeof parsed.rules !== 'number' || typeof parsed.matched !== 'number') {
    return cells;
  }
  cells.set(parsed.file, {
    cell: `${parsed.matched} of ${parsed.rules} rules matched`,
    measures: new Map([['rules', (parsed.matched / parsed.rules) * PERCENT]]),
  });
  return cells;
}

/** Returns the cells the report holds now, by file, so the columns this run does not measure stay. */
function readReport(): Map<string, Cells> {
  const kept = new Map<string, Cells>();
  if (!fs.existsSync(REPORT)) return kept;
  for (const line of fs.readFileSync(REPORT, 'utf8').split('\n')) {
    const match = ROW.exec(line);
    if (match === null || match[1] === undefined || match[2] === undefined) continue;
    const [unit, integration, tla, swift, shell, css] = match[2].split(' | ');
    kept.set(match[1], { unit, integration, tla, swift, shell, css });
  }
  return kept;
}

/** Returns the minimums in coverage_thresholds.json: by file, then tool, then measure. */
function readThresholds(): Thresholds {
  const thresholds = new Map<string, Map<string, Map<string, number>>>();
  if (!fs.existsSync(THRESHOLDS)) return thresholds;
  const parsed: unknown = JSON.parse(fs.readFileSync(THRESHOLDS, 'utf8'));
  if (!isRecord(parsed)) return thresholds;
  for (const [file, tools] of Object.entries(parsed)) {
    if (!isRecord(tools)) continue;
    const byTool = new Map<string, Map<string, number>>();
    for (const [tool, measures] of Object.entries(tools)) {
      if (!isRecord(measures)) continue;
      const byMeasure = new Map<string, number>();
      for (const [measure, minimum] of Object.entries(measures)) {
        if (typeof minimum === 'number') byMeasure.set(measure, minimum);
      }
      byTool.set(tool, byMeasure);
    }
    thresholds.set(file, byTool);
  }
  return thresholds;
}

/** Returns one line per measure of a tool's run that is below its minimum, or that the run did not measure. */
function shortfalls(tool: Tool, fresh: ReadonlyMap<string, Measured>, thresholds: Thresholds): string[] {
  const below: string[] = [];
  for (const [file, byTool] of thresholds) {
    const minimums = byTool.get(tool);
    if (minimums === undefined) continue;
    const measures = fresh.get(file)?.measures;
    for (const [measure, minimum] of minimums) {
      const value = measures?.get(measure);
      if (value === undefined || Number(value.toFixed(PERCENT_DIGITS)) < minimum) {
        const reading = value === undefined ? 'not measured' : percent(value);
        below.push(`${file}: ${tool} ${measure} ${reading}, minimum ${String(minimum)}%`);
      }
    }
  }
  return below;
}

/** Says whether a spec's section of specs/README.md names an action, in backticks, in a sentence saying it never fires. */
function saysNeverFires(readme: string, spec: string, action: string): boolean {
  const heading = `### \`${spec}\``;
  const start = readme.indexOf(heading);
  if (start === -1) return false;
  const rest = readme.slice(start + heading.length);
  const end = rest.indexOf('\n### ');
  const section = end === -1 ? rest : rest.slice(0, end);
  return section
    .replaceAll('\n', ' ')
    .split('.')
    .some((sentence) => sentence.includes(`\`${action}\``) && sentence.includes('never fire'));
}

/** Returns one line per action that never fired in any of a spec's configs and that the spec's README section does not excuse. */
function neverFired(fresh: ReadonlyMap<string, Measured>): string[] {
  const readme = fs.existsSync(SPECS_README) ? fs.readFileSync(SPECS_README, 'utf8') : '';
  const lines: string[] = [];
  for (const [file, { never }] of fresh) {
    const spec = path.basename(file, '.tla');
    for (const action of never ?? []) {
      if (!saysNeverFires(readme, spec, action)) {
        lines.push(`${file}: action ${action} never fired, and specs/README.md does not say it never fires`);
      }
    }
  }
  return lines;
}

/** Returns every file of a listed type git tracks or would add, by path from the root, in path order, with its type. */
function sourceFiles(): ReadonlyMap<string, string> {
  const listed = new Map<string, string>();
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' }).split(
    '\n',
  );
  for (const file of files.toSorted()) {
    const type = TYPES.get(path.extname(file));
    if (type !== undefined) listed.set(file, type);
  }
  return listed;
}

function main(): void {
  const column = TOOLS.find((tool) => process.argv.includes(`--${tool}`));
  const checking = process.argv.includes('--check');
  if (column === undefined) {
    console.error(`Usage: node scripts/coverage_report.ts ${TOOLS.map((tool) => `--${tool}`).join(' | ')} [--check]`);
    process.exit(1);
  }
  const sources = sourceFiles();
  const readers: Record<Tool, () => Map<string, Measured>> = {
    unit: () => readSummary(UNIT_SUMMARY),
    integration: () => readSummary(INTEGRATION_SUMMARY),
    tla: readTlc,
    swift: readSwift,
    shell: () => readShell([...sources.keys()]),
    css: readCss,
  };
  const fresh = readers[column]();
  const kept = readReport();
  const rows = [...sources].map(([file, type]) => {
    const cells: Cells = kept.get(file) ?? {};
    cells[column] = fresh.get(file)?.cell ?? (file.includes('/test/') || file.endsWith('.test.ts') ? 'test' : '-');
    return `| \`${file}\` | ${type} | ${TOOLS.map((t) => cells[t] ?? '-').join(' | ')} |`;
  });
  const today = new Date().toISOString().slice(0, 'YYYY-MM-DD'.length);
  const text = `# Coverage

What each coverage tool last measured, for every source file, in one place.
Each run rewrites its own column: \`npm run test:coverage\` the unit column
(vitest, v8) and the CSS column (the stylesheet's rules the page matched),
\`npm run test:integration:coverage\` the integration column (c8 over the
extension host, mapped back to the sources), \`npm run coverage:tla\` the TLC
column (how many of a spec's actions fired in any of its configs),
\`npm run test:swift:coverage\` the Swift column (llvm-cov), and
\`npm run test:shell:coverage\` the Shell column (kcov over the bats tests).
A run with \`--check\` fails below the minimums in
[coverage_thresholds.json](coverage_thresholds.json), each file's measured
coverage rounded down; a change that raises a file's coverage raises its
minimum in the same PR (#161).
L, B, R, and F are lines, branches, regions, and functions covered. \`-\` is a
file no tool measures; \`test\` is a test. Which spec covers which source file
is in [specs/COVERAGE.md](specs/COVERAGE.md).

Last updated: ${column}, ${today}.

| File | Type | Unit | Integration | TLC | Swift | Shell | CSS |
|---|---|---|---|---|---|---|---|
${rows.join('\n')}
`;
  fs.writeFileSync(REPORT, text);
  console.log(`${path.relative(ROOT, REPORT)}: ${column} column updated for ${fresh.size} files`);
  if (!checking) return;
  const below = [...shortfalls(column, fresh, readThresholds()), ...neverFired(fresh)];
  if (below.length === 0) return;
  console.error(below.join('\n'));
  console.error(`${String(below.length)} below coverage_thresholds.json`);
  process.exit(1);
}

main();
