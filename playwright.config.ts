// Playwright: the panel's page rendered in Chromium, each state against its committed screenshot
// (packages/vscode/test/visual). Fonts differ by platform, so a baseline is per platform.

import { defineConfig } from '@playwright/test';

// Playwright reads its configuration from the default export; there is no named form.
// oxlint-disable-next-line import/no-default-export
export default defineConfig({
  testDir: 'packages/vscode/test/visual',
  snapshotPathTemplate: '{testDir}/baselines/{arg}-{platform}{ext}',
  fullyParallel: true,
  reporter: 'list',
  use: { browserName: 'chromium', viewport: { width: 360, height: 640 }, deviceScaleFactor: 1 },
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01 } },
});
