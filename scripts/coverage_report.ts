// Rewrites COVERAGE.md: one row per source file, with the coverage each tool last measured.
// Each tool's run calls this with its flag and updates its own column, keeping the others:
// `--unit` reads coverage/unit (vitest), `--integration` reads coverage/integration (c8 over the
// extension host), `--tla` reads coverage/tla (TLC's statistics per spec). Node runs it as is.

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const REPORT = path.join(ROOT, 'COVERAGE.md');
const UNIT_SUMMARY = path.join(ROOT, 'coverage/unit/coverage-summary.json');
const INTEGRATION_SUMMARY = path.join(ROOT, 'coverage/integration/coverage-summary.json');
const TLA_DIR = path.join(ROOT, 'coverage/tla');
/** The columns a tool fills, in table order. */
const TOOLS = ['unit', 'integration', 'tla'] as const;
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

/** Returns the cells the report holds now, by file, so the columns this run does not measure stay. */
function readReport(): Map<string, Cells> {
  const kept = new Map<string, Cells>();
  if (!fs.existsSync(REPORT)) return kept;
  for (const line of fs.readFileSync(REPORT, 'utf8').split('\n')) {
    const match = ROW.exec(line);
    if (match === null || match[1] === undefined || match[2] === undefined) continue;
    const [unit, integration, tla] = match[2].split(' | ');
    kept.set(match[1], { unit, integration, tla });
  }
  return kept;
}

/** Returns every tracked file of a listed type, by path from the root. */
function sourceFiles(): string[] {
  return execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter((file) => TYPES.has(path.extname(file)));
}

function main(): void {
  const column = TOOLS.find((tool) => process.argv.includes(`--${tool}`));
  if (column === undefined) {
    console.error('Usage: node scripts/coverage_report.ts --unit | --integration | --tla');
    process.exit(1);
  }
  const fresh: Map<string, string> =
    column === 'unit' ? readSummary(UNIT_SUMMARY) : column === 'integration' ? readSummary(INTEGRATION_SUMMARY) : readTlc();
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
(vitest, v8), \`npm run test:integration:coverage\` the integration column (c8
over the extension host, mapped back to the sources), and
\`npm run coverage:tla\` the TLC column (how many of a spec's actions fired in
its checked config). L, B, and F are lines, branches, and functions covered.
\`-\` is a file no tool measures; \`test\` is a test. Which spec covers which
source file is in [specs/COVERAGE.md](specs/COVERAGE.md).

Last updated: ${column}, ${today}.

| File | Type | Unit | Integration | TLC |
|---|---|---|---|---|
${rows.join('\n')}
`;
  fs.writeFileSync(REPORT, text);
  console.log(`COVERAGE.md: ${column} column updated for ${fresh.size} files`);
}

main();
