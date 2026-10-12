// Vitest: the unit tests, and their coverage of the packages' source and the scripts (#133).
// The integration test runs inside VS Code, not here; scripts/integration.sh collects its coverage.
// The per-file thresholds come from coverage_thresholds.json, so a run fails below today's numbers (#161).

import * as fs from 'node:fs';
import * as path from 'node:path';
import { defineConfig } from 'vitest/config';

const THRESHOLDS = path.join(import.meta.dirname, 'coverage_thresholds.json');

// Files that only re-export, so there is nothing in them to execute (#162).
const REEXPORT_ONLY = ['packages/core/src/index.ts', 'packages/core/src/paths.ts'];

/** A file's unit minimums in coverage_thresholds.json, in percent. */
interface UnitMinimums {
  lines: number;
  branches: number;
  functions: number;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isUnitMinimums(v: unknown): v is UnitMinimums {
  return (
    typeof v === 'object' &&
    v !== null &&
    'lines' in v &&
    typeof v.lines === 'number' &&
    'branches' in v &&
    typeof v.branches === 'number' &&
    'functions' in v &&
    typeof v.functions === 'number'
  );
}

/** A file's thresholds as vitest takes them: its unit minimums, held per file rather than over the glob's files together. */
type FileThresholds = UnitMinimums & { perFile: true };

/** Returns one entry per file with unit minimums in coverage_thresholds.json; vitest matches each key as a glob against the root-relative path. */
function unitThresholds(): Record<string, FileThresholds> {
  const thresholds: Record<string, FileThresholds> = {};
  const parsed: unknown = JSON.parse(fs.readFileSync(THRESHOLDS, 'utf8'));
  if (!isRecord(parsed)) return thresholds;
  for (const [file, tools] of Object.entries(parsed)) {
    if (typeof tools !== 'object' || tools === null || !('unit' in tools) || !isUnitMinimums(tools.unit)) continue;
    thresholds[file] = { ...tools.unit, perFile: true };
  }
  return thresholds;
}

// Vitest reads its configuration from the default export; there is no named form.
// oxlint-disable-next-line import/no-default-export
export default defineConfig({
  test: {
    // Only vitest's tests: Playwright's are *.spec.ts, under test/visual.
    include: ['**/*.test.ts'],
    // One worker per test file costs about 200 ms each to start; the files share workers instead (Justine, 2026-10-11).
    isolate: false,
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts', 'scripts/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.d.ts', 'scripts/stylelint.config.ts', ...REEXPORT_ONLY],
      reporter: ['text', 'lcov', 'json-summary'],
      reportsDirectory: 'coverage/unit',
      thresholds: unitThresholds(),
    },
  },
});
