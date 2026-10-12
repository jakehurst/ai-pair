// Vitest: the unit tests, and their coverage of the packages' source and the scripts (#133).
// The integration test runs inside VS Code, not here; scripts/integration.sh collects its coverage.

import { defineConfig } from 'vitest/config';

// Vitest reads its configuration from the default export; there is no named form.
// oxlint-disable-next-line import/no-default-export
export default defineConfig({
  test: {
    // Only vitest's tests: Playwright's are *.spec.ts, under test/visual.
    include: ['**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts', 'scripts/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.d.ts', 'scripts/stylelint.config.ts'],
      reporter: ['text', 'lcov', 'json-summary'],
      reportsDirectory: 'coverage/unit',
    },
  },
});
