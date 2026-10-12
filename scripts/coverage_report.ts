// Rewrites COVERAGE.md: one row per source file, with the coverage each tool last measured.
// Each tool's run calls this with its flag and updates its own column, keeping the others:
// `--unit` reads coverage/unit (vitest), `--integration` reads coverage/integration (c8 over the
// extension host), `--tla` reads coverage/tla (TLC's statistics per spec), `--swift` reads
// coverage/swift (llvm-cov's export), `--shell` reads coverage/shell (kcov), and `--css` reads
// coverage/css (the stylesheet's rule-usage test). Node runs it as is.

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
/** A TLC action's statistics line: `<Name line ... of module M>: distinct:total`. */
const ACTION = /^<([A-Za-z_]\w*) line .*>: \d+:(\d+)$/;
/** A row of the table: the file, its type, then one cell per tool. */
const ROW = /^\| `([^`]+)` \| [^|]+ \| (.*) \|$/;
const PERCENT_DIGITS = 1;

type Tool = (typeof TOOLS)[number];
type Cells = Partial<Record<Tool, string>>;

interface Measure {
  pct: number;
}

interface FileSummary {
  lines: Measure;
  branches: Measure;
  functions: Measure;
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
function percent(measure: Measure): string {
  return `${measure.pct.toFixed(PERCENT_DIGITS)}%`;
}

/** Returns a summary's cell: lines, branches, and functions covered, in percent. */
function cell(summary: FileSummary): string {
  return `L ${percent(summary.lines)} B ${percent(summary.branches)} F ${percent(summary.functions)}`;
}

/** Returns the cells of an Istanbul coverage summary, by path from the root, for the repository's own files. */
function readSummary(file: string): Map<string, string> {
  const cells = new Map<string, string>();
  if (!fs.existsSync(file)) return cells;
  const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null) return cells;
  for (const [key, value] of Object.entries(parsed)) {
    if (key === 'total' || !isFileSummary(value)) continue;
    const relative = path.relative(ROOT, key);
    if (relative.includes('node_modules') || relative.startsWith('..')) continue;
    cells.set(relative, cell(value));
  }
  return cells;
}

/** Returns the cells of TLC's statistics: for each spec, how many of its actions fired. */
function readTlc(): Map<string, string> {
  const cells = new Map<string, string>();
  if (!fs.existsSync(TLA_DIR)) return cells;
  for (const file of fs.readdirSync(TLA_DIR)) {
    if (!file.endsWith('.txt')) continue;
    const actions = fs
      .readFileSync(path.join(TLA_DIR, file), 'utf8')
      .split('\n')
      .map((line) => ACTION.exec(line))
      .filter((match) => match !== null);
    const fired = actions.filter((match) => match[2] !== '0');
    const never = actions.filter((match) => match[2] === '0').map((match) => match[1]);
    const note = never.length === 0 ? '' : ` (never: ${never.join(', ')})`;
    cells.set(`specs/${file.replace(/\.txt$/, '.tla')}`, `${fired.length} of ${actions.length} actions${note}`);
  }
  return cells;
}

/** Returns the percentage of an llvm-cov summary's measure, which calls it `percent`. */
function llvmPercent(v: unknown): string | undefined {
  return isRecord(v) && typeof v.percent === 'number' ? `${v.percent.toFixed(PERCENT_DIGITS)}%` : undefined;
}

/** Returns the cells of llvm-cov's export for the Swift package: lines, regions, and functions covered. */
function readSwift(): Map<string, string> {
  const cells = new Map<string, string>();
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
      cells.set(path.relative(ROOT, file.filename), `L ${lines} R ${regions} F ${functions}`);
    }
  }
  return cells;
}

/** Returns kcov's report: the merged one over every run, or the one run's when there was one. */
function shellSummary(): string | undefined {
  if (!fs.existsSync(SHELL_DIR)) return undefined;
  const runs = fs.readdirSync(SHELL_DIR).filter((entry) => fs.existsSync(path.join(SHELL_DIR, entry, 'coverage.json')));
  const chosen = runs.includes('kcov-merged') ? 'kcov-merged' : runs[0];
  return chosen === undefined ? undefined : path.join(SHELL_DIR, chosen, 'coverage.json');
}

/** Returns the cells of kcov's report: lines covered, per script. */
function readShell(): Map<string, string> {
  const cells = new Map<string, string>();
  const summary = shellSummary();
  if (summary === undefined) return cells;
  const parsed: unknown = JSON.parse(fs.readFileSync(summary, 'utf8'));
  if (!isRecord(parsed) || !Array.isArray(parsed.files)) return cells;
  for (const file of parsed.files) {
    if (!isRecord(file) || typeof file.file !== 'string' || typeof file.percent_covered !== 'string') continue;
    const covered = Number(file.percent_covered);
    cells.set(
      path.relative(ROOT, file.file),
      `L ${covered.toFixed(PERCENT_DIGITS)}% (${String(file.covered_lines)} of ${String(file.total_lines)})`,
    );
  }
  return cells;
}

/** Returns the cell of the stylesheet's rule-usage test: rules the page matched over rules written. */
function readCss(): Map<string, string> {
  const cells = new Map<string, string>();
  if (!fs.existsSync(CSS_SUMMARY)) return cells;
  const parsed: unknown = JSON.parse(fs.readFileSync(CSS_SUMMARY, 'utf8'));
  if (!isRecord(parsed) || typeof parsed.file !== 'string' || typeof parsed.rules !== 'number' || typeof parsed.matched !== 'number') {
    return cells;
  }
  cells.set(parsed.file, `${parsed.matched} of ${parsed.rules} rules matched`);
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

/** Returns every file of a listed type git tracks or would add, by path from the root. */
function sourceFiles(): string[] {
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter((file) => TYPES.has(path.extname(file)));
}

function main(): void {
  const column = TOOLS.find((tool) => process.argv.includes(`--${tool}`));
  if (column === undefined) {
    console.error(`Usage: node scripts/coverage_report.ts ${TOOLS.map((tool) => `--${tool}`).join(' | ')}`);
    process.exit(1);
  }
  const readers: Record<Tool, () => Map<string, string>> = {
    unit: () => readSummary(UNIT_SUMMARY),
    integration: () => readSummary(INTEGRATION_SUMMARY),
    tla: readTlc,
    swift: readSwift,
    shell: readShell,
    css: readCss,
  };
  const fresh = readers[column]();
  const kept = readReport();
  const rows = sourceFiles().map((file) => {
    const cells: Cells = kept.get(file) ?? {};
    cells[column] = fresh.get(file) ?? (file.includes('/test/') || file.endsWith('.test.ts') ? 'test' : '-');
    const type = TYPES.get(path.extname(file)) ?? '';
    return `| \`${file}\` | ${type} | ${TOOLS.map((t) => cells[t] ?? '-').join(' | ')} |`;
  });
  const today = new Date().toISOString().slice(0, 'YYYY-MM-DD'.length);
  const text = `# Coverage

What each coverage tool last measured, for every source file, in one place.
Each run rewrites its own column: \`npm run test:coverage\` the unit column
(vitest, v8) and the CSS column (the stylesheet's rules the page matched),
\`npm run test:integration:coverage\` the integration column (c8 over the
extension host, mapped back to the sources), \`npm run coverage:tla\` the TLC
column (how many of a spec's actions fired in its checked config),
\`npm run test:swift:coverage\` the Swift column (llvm-cov), and
\`npm run test:shell:coverage\` the Shell column (kcov over the bats tests).
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
}

main();
