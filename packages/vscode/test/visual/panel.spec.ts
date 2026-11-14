// The narration panel's page, state by state, against its screenshots: what the rule-usage test
// cannot see, a rule that matches but looks wrong. Run: npm run test:visual (after npm run build).

import * as fs from 'node:fs';
import * as path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { panelHtml } from '../../src/panel_html';

/** The bundles, from the repository's root, where Playwright runs. */
const DIST = path.resolve(process.env.AI_PAIR_VISUAL_DIST ?? 'packages/vscode/dist');
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
    const messages: unknown[] = [];
    Object.assign(globalThis, {
      messages,
      acquireVsCodeApi: () => ({
        postMessage: (message: unknown) => {
          messages.push(message);
        },
      }),
    });
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
    name: 'attention-requested',
    events: [
      { type: 'session', active: true, task: 'Add tests' },
      { type: 'state', state: 'typing', turn: 'agent', paused: false, speechPaused: false },
      { type: 'attention', state: 'requested' },
    ],
  },
  {
    name: 'attention-granted',
    events: [
      { type: 'session', active: true, task: 'Add tests' },
      { type: 'state', state: 'paused', turn: 'agent', paused: true, speechPaused: false },
      { type: 'say', text: "What's up?" },
      { type: 'attention', state: 'granted' },
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

test('menus stay reachable in a narrow, short panel and after resizing', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 240, height: 180 });
  const post = await load(page);
  await post({ type: 'session', active: true, task: 'Layout' });
  for (const name of ['speed', 'reading-speed', 'code-mode']) {
    await page.locator(`[data-ui="${name}"]`).click();
    const menu = page.locator('.speed-menu:visible');
    await expect(menu).toHaveCount(1);
    const box = await menu.boundingBox();
    expect(box).not.toBeNull();
    if (box === null) throw new Error('Menu has no bounds');
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(240);
    expect(box.y + box.height).toBeLessThanOrEqual(180);
    await page.keyboard.press('Escape');
  }
  await page.locator('[data-ui="speed"]').click();
  await page.setViewportSize({ width: 200, height: 130 });
  await expect.poll(async () => (await page.locator('[data-ui="speed-menu"]').boundingBox())?.height).toBeLessThanOrEqual(130);
  const box = await page.locator('[data-ui="speed-menu"]').boundingBox();
  expect(box).not.toBeNull();
  if (box === null) throw new Error('Menu has no bounds');
  expect(box.x + box.width).toBeLessThanOrEqual(200);
  expect(box.y + box.height).toBeLessThanOrEqual(130);
  await page.screenshot({ path: testInfo.outputPath('narrow-short.png') });
});

test('a resized menu keeps the selected option visible and follows the bottom toolbar', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 360, height: 640 });
  const post = await load(page);
  await post({ type: 'session', active: true, task: 'Layout' });
  await post({ type: 'chatOrder', value: 'oldestFirst' });
  await post({ type: 'readingSpeed', value: 2 });
  await page.locator('[data-ui="reading-speed"]').click();
  await page.setViewportSize({ width: 240, height: 130 });
  const menu = page.locator('[data-ui="reading-menu"]');
  const selected = menu.locator('[aria-checked="true"]');
  await expect(selected).toBeFocused();
  await expect
    .poll(async () => {
      const outer = await menu.boundingBox();
      const inner = await selected.boundingBox();
      return outer !== null && inner !== null && inner.y >= outer.y && inner.y + inner.height <= outer.y + outer.height;
    })
    .toBe(true);
  await page.screenshot({ path: testInfo.outputPath('bottom-short.png') });
});

test('toolbar controls remain reachable and menus accept keyboard selection', async ({ page }, testInfo) => {
  const post = await load(page);
  await post({ type: 'session', active: true, task: 'Layout' });
  for (const width of [240, 320]) {
    await page.setViewportSize({ width, height: 640 });
    for (const button of await page.locator('.head button:visible').all()) {
      const box = await button.boundingBox();
      expect(box).not.toBeNull();
      if (box === null) throw new Error('Control has no bounds');
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    }
    await page.screenshot({ path: testInfo.outputPath(`toolbar-${width}.png`) });
  }
  await page.locator('[data-ui="code-mode"]').click();
  const lines = page.locator('[data-ui="code-mode-menu"] [data-code-playback="lines"]');
  await lines.focus();
  await page.keyboard.press('Space');
  await expect(page.locator('[data-ui="code-mode"]')).toHaveText('Lines');
});

test('open menu follows its trigger when bottom band grows', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  const post = await load(page);
  await post({ type: 'session', active: true, task: 'Layout' });
  await post({ type: 'chatOrder', value: 'oldestFirst' });
  const trigger = page.locator('[data-ui="code-mode"]');
  const menu = page.locator('[data-ui="code-mode-menu"]');
  await trigger.click();
  const before = await trigger.boundingBox();
  if (before === null) throw new Error('Trigger has no bounds');
  await post({ type: 'say', text: 'A long message that makes the band taller. '.repeat(20) });
  await expect.poll(async () => (await trigger.boundingBox())?.y).not.toBe(before.y);
  await expect
    .poll(async () => {
      const anchor = await trigger.boundingBox();
      const popup = await menu.boundingBox();
      if (anchor === null || popup === null) return false;
      return Math.abs(popup.y + popup.height - anchor.y) < 2 || Math.abs(popup.y - anchor.y - anchor.height) < 2;
    })
    .toBe(true);
});
for (const width of [320, 240]) {
  test(`OpenRouter settings fit at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const post = await load(page);
    await page.locator('[data-ui="settings"]').click();
    await page.locator('[data-ui="speech-provider"]').selectOption('openrouter');
    await post({ type: 'speechCloudSupport', supported: true });
    await post({ type: 'openRouterKeyStatus', hasKey: true });
    await post({
      type: 'openRouterCatalog',
      value: { state: 'ready', verified: true, models: [{ id: 'model', name: 'Model', voices: [{ id: 'voice', name: 'Voice' }] }] },
    });
    await expect(page.locator('[data-ui="openrouter-model"] option')).toHaveCount(2);
    await page.locator('[data-ui="openrouter-model"]').selectOption('model');
    await expect(page.locator('[data-ui="openrouter-voice"] option')).toHaveCount(2);
    const toggle = page.locator('[data-ui="openrouter-zdr"]');
    await expect(toggle).toHaveText('ZDR filter: Off');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(toggle).toHaveText('ZDR filter: On');
    expect(
      await page.evaluate(() => {
        // The browser provides document; this test's TypeScript configuration omits DOM types.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        const root = (globalThis as unknown as { document: { documentElement: { scrollWidth: number; clientWidth: number } } }).document
          .documentElement;
        return root.scrollWidth <= root.clientWidth;
      }),
    ).toBe(true);
    await testInfo.attach('settings', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  });
}

test('navigator commentary shows the workspace value and sends a selection', async ({ page }) => {
  const send = await load(page);
  await page.locator('[data-ui="settings"]').click();
  const select = page.locator('[data-ui="navigator-commentary"]');
  await expect(select).toHaveValue('helpful');
  await send({ type: 'navigatorCommentary', value: 'quiet' });
  await expect(select).toHaveValue('quiet');
  await select.selectOption('coach');
  await expect
    .poll(async () =>
      page.evaluate(() => {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        return (globalThis as unknown as { messages: unknown[] }).messages;
      }),
    )
    .toContainEqual({ type: 'navigatorCommentary', value: 'coach' });
});

test('reply focus closes the modal settings dialog without sending a draft', async ({ page }) => {
  const send = await load(page);
  await send({ type: 'session', active: true, task: 'Shortcut focus' });
  await page.locator('[data-ui="settings"]').click();
  await expect(page.locator('[data-ui="settings-dialog"]')).toBeVisible();
  await send({ type: 'focusReply' });
  await expect(page.locator('[data-ui="settings-dialog"]')).not.toBeVisible();
  await expect(page.locator('[data-ui="reply"]')).toBeFocused();
  const messages = await page.evaluate(() => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return (globalThis as unknown as { messages: Array<{ type: string }> }).messages;
  });
  expect(messages.some((message) => message.type === 'reply')).toBe(false);
});
