// The narration panel's page, state by state, against its screenshots: what the rule-usage test
// cannot see, a rule that matches but looks wrong. Run: npm run test:visual (after npm run build).

import * as fs from 'node:fs';
import * as path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { panelHtml } from '../../src/panel_html';

/** The bundles, from the repository's root, where Playwright runs. */
const DIST = path.resolve('packages/vscode/dist');
/** The page's origin, routed to dist/: the CSP allows styles from it. */
const ORIGIN = 'https://panel.test';
/** The VS Code theme variables the stylesheet reads, as Dark Modern sets them. */
const THEME = `
  :root {
    --vscode-font-family: -apple-system, system-ui, sans-serif; --vscode-font-size: 13px;
    --vscode-editor-font-family: Menlo, monospace; --vscode-editor-font-size: 12px;
    --vscode-foreground: #cccccc; --vscode-editor-background: #1f1f1f; --vscode-sideBar-background: #181818;
    --vscode-button-background: #0078d4; --vscode-button-foreground: #ffffff; --vscode-button-border: transparent;
    --vscode-button-hoverBackground: #026ec1; --vscode-button-secondaryBackground: #313131;
    --vscode-button-secondaryForeground: #cccccc; --vscode-button-secondaryBorder: transparent;
    --vscode-button-secondaryHoverBackground: #3c3c3c; --vscode-charts-green: #89d185;
    --vscode-contrastActiveBorder: transparent; --vscode-contrastBorder: transparent;
    --vscode-editorHoverWidget-background: #202020; --vscode-editorHoverWidget-border: #454545;
    --vscode-editorHoverWidget-foreground: #cccccc; --vscode-errorForeground: #f85149; --vscode-focusBorder: #0078d4;
    --vscode-input-background: #313131; --vscode-input-border: #3c3c3c; --vscode-input-foreground: #cccccc;
    --vscode-input-placeholderForeground: #989898; --vscode-menu-background: #1f1f1f; --vscode-menu-border: #454545;
    --vscode-menu-foreground: #cccccc; --vscode-menu-selectionBackground: #0078d4; --vscode-menu-selectionForeground: #ffffff;
    --vscode-panel-border: #2b2b2b; --vscode-testing-iconFailed: #f14c4c; --vscode-testing-iconPassed: #73c991;
    --vscode-textLink-activeForeground: #4daafc; --vscode-textLink-foreground: #4daafc;
    --vscode-toolbar-hoverBackground: #5a5d5e50; --vscode-widget-border: #313131; --vscode-widget-shadow: #0000005c;
    --vscode-aiPair-cursor: #e8875b; --vscode-aiPair-cursorRead: #7fb2f0;
  }
  body { background: var(--vscode-sideBar-background); }
`;

/** Loads the page from dist/ at a routed origin, with VS Code's API stubbed, and returns a way to post to it. */
async function load(page: Page): Promise<(event: object) => Promise<void>> {
  // The theme as a second stylesheet from the same origin: the page's CSP allows no inline style.
  const html = panelHtml(ORIGIN, `${ORIGIN}/panel.css`, `${ORIGIN}/panel.js`).replace(
    '<link rel="stylesheet"',
    `<link rel="stylesheet" href="${ORIGIN}/theme.css"><link rel="stylesheet"`,
  );
  await page.route(`${ORIGIN}/**`, (route) => {
    const file = new URL(route.request().url()).pathname;
    if (file === '/') return route.fulfill({ body: html, contentType: 'text/html' });
    if (file === '/theme.css') return route.fulfill({ body: THEME, contentType: 'text/css' });
    const type = file.endsWith('.css') ? 'text/css' : 'text/javascript';
    return route.fulfill({ body: fs.readFileSync(path.join(DIST, file)), contentType: type });
  });
  await page.addInitScript(() => {
    Object.assign(globalThis, { acquireVsCodeApi: () => ({ postMessage: () => {} }) });
  });
  await page.goto(`${ORIGIN}/`);
  return async (event) => {
    await page.evaluate((data) => {
      // In the browser, where `globalThis` is the window; this file is typed without the DOM library.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      (globalThis as unknown as { postMessage(message: unknown, origin: string): void }).postMessage(data, '*');
    }, event);
  };
}

const STATES: Array<{ name: string; events: object[] }> = [
  { name: 'idle', events: [{ type: 'canStart', value: true }] },
  { name: 'idle-ended', events: [{ type: 'session', active: false, reason: 'agent', summary: 'Done: the API has its tests.' }] },
  {
    name: 'typing',
    events: [
      { type: 'session', active: true, task: 'Add tests', rules: ['.ai-pair/GUIDE.md'] },
      { type: 'state', state: 'typing', turn: 'agent', paused: false },
      { type: 'say', text: 'Typing the test for `createTodo` in src/todos.ts.' },
    ],
  },
  {
    name: 'reading',
    events: [
      { type: 'session', active: true, task: 'Add tests' },
      { type: 'say', text: 'A longer note for you to read, with a link: https://example.com.' },
      { type: 'reading', ms: 60_000 },
      { type: 'state', state: 'read', turn: 'agent', paused: false },
    ],
  },
  {
    name: 'paused',
    events: [
      { type: 'session', active: true, task: 'Add tests' },
      { type: 'state', state: 'typing', turn: 'agent', paused: true },
    ],
  },
  {
    name: 'your-turn',
    events: [
      { type: 'session', active: true, task: 'Add tests' },
      { type: 'turn', to: 'programmer', message: 'Your turn: fix the import.', ref: { file: 'src/todos.ts', line: 3, endLine: 5 } },
      { type: 'state', state: 'navigator', turn: 'programmer', paused: false },
    ],
  },
  {
    name: 'run-confirm',
    events: [
      { type: 'session', active: true, task: 'Add tests' },
      { type: 'run', id: 1, command: 'npm test', phase: 'confirm' },
    ],
  },
  {
    name: 'history',
    events: [
      { type: 'session', active: true, task: 'Add tests' },
      { type: 'say', text: 'First.' },
      { type: 'programmer', text: 'Looks good.', ref: { file: 'src/todos.ts', line: 1, endLine: 2 } },
      { type: 'run', id: 1, command: 'npm test', phase: 'running' },
      { type: 'run', id: 1, command: 'npm test', phase: 'done', exitCode: 0 },
      { type: 'run', id: 2, command: 'npm run lint', phase: 'running' },
      { type: 'run', id: 2, command: 'npm run lint', phase: 'done', exitCode: 1 },
      { type: 'outside', files: ['package.json'] },
      { type: 'say', text: 'Second.' },
    ],
  },
  {
    name: 'calibrating',
    events: [
      { type: 'session', active: true, task: 'Add tests' },
      {
        type: 'calibration',
        view: { phase: 'reading', title: 'Comma Gets a Cure', text: 'Well, here is a story for you.', notice: 'Public domain.' },
      },
    ],
  },
];

for (const { name, events } of STATES) {
  test(name, async ({ page }) => {
    const post = await load(page);
    for (const event of events) {
      await post(event);
    }
    await expect(page).toHaveScreenshot(`${name}.png`, { animations: 'disabled' });
  });
}
