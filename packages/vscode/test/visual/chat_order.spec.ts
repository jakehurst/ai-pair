// Browser behavior for chat order, scrolling and the in-panel settings dialog.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { panelHtml } from '../../src/panel_html';

const DIST = path.resolve('packages/vscode/dist');
const ORIGIN = 'https://panel.test';

/** Loads the panel with a recording VS Code API and returns a way to send host events. */
async function load(page: Page): Promise<(event: object) => Promise<void>> {
  const html = panelHtml(ORIGIN, `${ORIGIN}/panel.css`, `${ORIGIN}/panel.js`).replace(
    '<link rel="stylesheet"',
    `<link rel="stylesheet" href="${ORIGIN}/theme.css"><link rel="stylesheet"`,
  );
  await page.route(`${ORIGIN}/**`, (route) => {
    const file = new URL(route.request().url()).pathname;
    if (file === '/') return route.fulfill({ body: html, contentType: 'text/html' });
    if (file === '/theme.css') {
      return route.fulfill({
        body: `
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
`,
        contentType: 'text/css',
      });
    }
    return route.fulfill({
      body: fs.readFileSync(path.join(DIST, file)),
      contentType: file.endsWith('.css') ? 'text/css' : 'text/javascript',
    });
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
    await page.evaluate(
      (data) =>
        new Promise<void>((resolve) => {
          // This listener runs after the panel's message listener, so awaiting it
          // waits for delivery rather than merely scheduling postMessage.
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion
          const target = globalThis as unknown as {
            addEventListener(type: string, listener: () => void, options: { once: boolean }): void;
            postMessage(message: unknown, origin: string): void;
          };
          target.addEventListener(
            'message',
            () => {
              resolve();
            },
            { once: true },
          );
          target.postMessage(data, '*');
        }),
      event,
    );
  };
}

/** Populates enough history to make the panel scroll. */
async function populate(post: (event: object) => Promise<void>): Promise<void> {
  await post({ type: 'session', active: true, task: 'Order test' });
  for (let index = 0; index < 35; index++) {
    await post({ type: 'say', text: `Message ${index}: a long message that wraps across multiple lines in the panel.` });
  }
}

/** Reads the distance between the history viewport and its newest edge. */
async function distanceFromBottom(page: Page): Promise<number> {
  return page
    .locator('[data-ui=history]')
    .evaluate(
      (element: { scrollHeight: number; clientHeight: number; scrollTop: number }) =>
        element.scrollHeight - element.clientHeight - element.scrollTop,
    );
}

test('settings work with the keyboard and send the chosen order', async ({ page }) => {
  const post = await load(page);
  await post({ type: 'session', active: true });
  const settings = page.getByRole('button', { name: 'Settings' });
  await settings.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  const order = dialog.getByLabel('Chat order');
  await expect(dialog).toBeVisible();
  await expect(order).toBeFocused();
  await expect(order).toHaveValue('newestFirst');
  await order.selectOption('oldestFirst');
  await expect
    .poll(async () =>
      page.evaluate(() => {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        return (globalThis as unknown as { messages: unknown[] }).messages;
      }),
    )
    .toContainEqual({ type: 'chatOrder', value: 'oldestFirst' });
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(settings).toBeFocused();
  await settings.press('Enter');
  await expect(order).toHaveValue('oldestFirst');
  await order.focus();
  await page.keyboard.press('Space');
  await expect
    .poll(async () =>
      page.evaluate(() => {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        return (globalThis as unknown as { messages: Array<{ type: string }> }).messages.filter((message) => message.type === 'pause');
      }),
    )
    .toEqual([]);
});

test('DisplayOrdered, NoneLost and NoDuplicates: switching reverses populated history and keeps the draft', async ({ page }) => {
  const post = await load(page);
  await populate(post);
  const history = page.locator('[data-ui=history]');
  const band = page.locator('[data-ui=band]');
  const reply = page.getByLabel('Reply to the agent');
  await reply.fill('Unsent draft');
  const before = await history.locator('.entry').allTextContents();
  expect(before.length).toBeGreaterThan(30);
  expect((await band.boundingBox())?.y).toBeLessThan((await history.boundingBox())?.y ?? 0);
  await post({ type: 'chatOrder', value: 'oldestFirst' });
  await expect(history).toHaveAttribute('aria-label', 'Earlier, oldest first');
  await expect.poll(async () => history.locator('.entry').allTextContents()).toEqual(before.toReversed());
  expect((await history.boundingBox())?.y).toBeLessThan((await band.boundingBox())?.y ?? 0);
  await expect(reply).toHaveValue('Unsent draft');
  await post({ type: 'chatOrder', value: 'newestFirst' });
  await expect.poll(async () => history.locator('.entry').allTextContents()).toEqual(before);
  await expect(reply).toHaveValue('Unsent draft');
});

test('FollowsLatest, KeepsPlace and YoursInView: oldest-first tracks the reader', async ({ page }) => {
  const post = await load(page);
  await post({ type: 'chatOrder', value: 'oldestFirst' });
  await populate(post);
  const history = page.locator('[data-ui=history]');
  await expect.poll(async () => history.locator('.entry').count()).toBeGreaterThan(30);
  await history.evaluate((element: { scrollTop: number; scrollHeight: number }) => {
    element.scrollTop = element.scrollHeight;
  });
  await post({ type: 'say', text: 'A new message with enough text to wrap across the panel. '.repeat(8) });
  await expect(page.locator('[data-ui=now-text]')).toContainText('A new message');
  expect(await distanceFromBottom(page)).toBeLessThanOrEqual(2);
  await post({ type: 'run', id: 8, command: 'npm test', phase: 'confirm' });
  await expect(page.locator('[data-ui=run]')).toBeVisible();
  expect(await distanceFromBottom(page)).toBeLessThanOrEqual(2);
  await page.getByLabel('Reply to the agent').fill('draft '.repeat(100));
  expect(await distanceFromBottom(page)).toBeLessThanOrEqual(2);
  await page.setViewportSize({ width: 360, height: 500 });
  await expect.poll(async () => distanceFromBottom(page)).toBeLessThanOrEqual(2);
  await post({ type: 'interrupt' });
  await expect(history.getByText('You interrupted')).toBeAttached();
  expect(await distanceFromBottom(page)).toBeLessThanOrEqual(2);
  await history.evaluate((element: { scrollTop: number }) => {
    element.scrollTop = 40;
  });
  const before = await history.evaluate((element: { scrollTop: number }) => element.scrollTop);
  await post({ type: 'say', text: 'Another incoming message' });
  await expect(page.locator('[data-ui=now-text]')).toContainText('Another incoming message');
  expect(await history.evaluate((element: { scrollTop: number }) => element.scrollTop)).toBeCloseTo(before, 0);
  await post({ type: 'programmer', text: 'My reply' });
  await expect(history.getByText('My reply')).toBeVisible();
  expect(await distanceFromBottom(page)).toBeLessThanOrEqual(2);
});

test('SwitchKeepsPlace: switching order keeps the visible history entry in place', async ({ page }) => {
  const post = await load(page);
  await populate(post);
  const history = page.locator('[data-ui=history]');
  await history.evaluate((element: { scrollTop: number; scrollHeight: number; clientHeight: number }) => {
    element.scrollTop = (element.scrollHeight - element.clientHeight) / 2;
  });
  const historyBefore = await history.boundingBox();
  const entries = await history.locator('.entry').all();
  let anchorText = '';
  for (const entry of entries) {
    const bounds = await entry.boundingBox();
    if (bounds !== null && bounds.y + bounds.height > (historyBefore?.y ?? 0)) {
      anchorText = (await entry.textContent()) ?? '';
      break;
    }
  }
  const anchor = history.locator('.entry').filter({ hasText: anchorText });
  const before = await anchor.boundingBox();
  await post({ type: 'chatOrder', value: 'oldestFirst' });
  await expect(history).toHaveAttribute('aria-label', 'Earlier, oldest first');
  const after = await anchor.boundingBox();
  const historyAfter = await history.boundingBox();
  expect((after?.y ?? 0) - (historyAfter?.y ?? 0)).toBeCloseTo((before?.y ?? 0) - (historyBefore?.y ?? 0), 0);
  await post({ type: 'chatOrder', value: 'newestFirst' });
  await expect(history).toHaveAttribute('aria-label', 'Earlier, newest first');
  const restored = await anchor.boundingBox();
  const restoredHistory = await history.boundingBox();
  expect((restored?.y ?? 0) - (restoredHistory?.y ?? 0)).toBeCloseTo((before?.y ?? 0) - (historyBefore?.y ?? 0), 0);
});

test('SwitchKeepsPlace: a boundary anchor remains visible when its old offset cannot fit', async ({ page }) => {
  const post = await load(page);
  await populate(post);
  const history = page.locator('[data-ui=history]');
  await history.evaluate((element: { scrollTop: number; clientHeight: number }) => {
    element.scrollTop = element.clientHeight / 2;
  });
  const historyBefore = await history.boundingBox();
  const entries = await history.locator('.entry').all();
  let anchorText = '';
  for (const entry of entries) {
    const bounds = await entry.boundingBox();
    if (bounds !== null && bounds.y + bounds.height > (historyBefore?.y ?? 0)) {
      anchorText = (await entry.textContent()) ?? '';
      break;
    }
  }
  const anchor = history.locator('.entry').filter({ hasText: anchorText });
  const anchorBefore = await anchor.boundingBox();
  expect((anchorBefore?.y ?? 0) + (anchorBefore?.height ?? 0)).toBeGreaterThan(historyBefore?.y ?? 0);
  await post({ type: 'chatOrder', value: 'oldestFirst' });
  await expect(history).toHaveAttribute('aria-label', 'Earlier, oldest first');
  const historyAfter = await history.boundingBox();
  const anchorAfter = await anchor.boundingBox();
  expect((anchorAfter?.y ?? 0) + (anchorAfter?.height ?? 0)).toBeGreaterThan(historyAfter?.y ?? 0);
  expect(anchorAfter?.y).toBeLessThan((historyAfter?.y ?? 0) + (historyAfter?.height ?? 0));
  expect(await distanceFromBottom(page)).toBeLessThanOrEqual(2);
});

test('agent and programmer history text use the readable theme foreground', async ({ page }) => {
  const post = await load(page);
  await post({ type: 'session', active: true });
  await post({ type: 'say', text: 'Agent history text' });
  await post({ type: 'programmer', text: 'Programmer history text' });
  async function color(selector: string): Promise<string> {
    return page.locator(selector).evaluate((element: unknown) => {
      // The browser supplies getComputedStyle; this test is typed without the DOM library.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      return (globalThis as unknown as { getComputedStyle(element: unknown): { color: string } }).getComputedStyle(element).color;
    });
  }
  await expect(page.locator('.entry.agent')).toHaveText('Agent history text');
  const foreground = await color('body');
  expect(await color('.entry.agent')).toBe(foreground);
  expect(await color('.entry.you')).toBe(foreground);
  await post({ type: 'state', state: 'typing', turn: 'agent', paused: true });
  await expect(page.locator('body')).toHaveClass(/paused/);
  expect(await color('.entry.agent')).toBe(foreground);
  expect(await color('.entry.you')).toBe(foreground);
});

test('agent and programmer messages appear once in chronological order in both layouts', async ({ page }) => {
  const post = await load(page);
  await post({
    type: 'replay',
    events: [
      { type: 'session', active: true },
      { type: 'say', text: 'Start WP2, or stop here?' },
      { type: 'programmer', text: 'go' },
    ],
  });
  await expect(page.getByText('Start WP2, or stop here?', { exact: true })).toHaveCount(1);
  expect((await page.getByText('go', { exact: true }).boundingBox())?.y).toBeLessThan(
    (await page.getByText('Start WP2, or stop here?', { exact: true }).boundingBox())?.y ?? 0,
  );
  await post({ type: 'say', text: 'Starting WP2.' });
  const first = page.getByText('Start WP2, or stop here?', { exact: true });
  const second = page.getByText('go', { exact: true });
  const third = page.getByText('Starting WP2.', { exact: true });
  await expect(first).toHaveCount(1);
  await expect(second).toHaveCount(1);
  await expect(third).toHaveCount(1);
  expect((await third.boundingBox())?.y).toBeLessThan((await second.boundingBox())?.y ?? 0);
  expect((await second.boundingBox())?.y).toBeLessThan((await first.boundingBox())?.y ?? 0);
  await post({ type: 'chatOrder', value: 'oldestFirst' });
  await expect(page.locator('[data-ui=history]')).toHaveAttribute('aria-label', 'Earlier, oldest first');
  await expect(first).toHaveCount(1);
  await expect(second).toHaveCount(1);
  await expect(third).toHaveCount(1);
  expect((await first.boundingBox())?.y).toBeLessThan((await second.boundingBox())?.y ?? 0);
  expect((await second.boundingBox())?.y).toBeLessThan((await third.boundingBox())?.y ?? 0);
  const current = page.locator('[data-ui=now-text]');
  await expect(current).toHaveCSS('opacity', '1');
  await post({ type: 'state', state: 'typing', turn: 'agent', paused: true });
  await expect(page.locator('body')).toHaveClass(/paused/);
  await expect(current).toHaveCSS('opacity', '1');
});

test('reading ring finishes the current countdown by click or keyboard', async ({ page }) => {
  const post = await load(page);
  await post({ type: 'session', active: true });
  await post({ type: 'state', state: 'read', turn: 'agent', paused: false });
  await post({ type: 'reading', ms: 30_000, id: 101 });
  const control = page.getByRole('button', { name: 'Finish reading pause' });
  await expect(control).toBeEnabled();
  await control.click();
  await post({ type: 'reading', ms: 30_000, id: 102 });
  await expect(control).toBeEnabled();
  await control.focus();
  await page.keyboard.press('Space');
  await expect
    .poll(async () =>
      page.evaluate(() => {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        return (globalThis as unknown as { messages: Array<{ type: string; id?: number }> }).messages.filter(
          (message) => message.type === 'skipReading' || message.type === 'pause',
        );
      }),
    )
    .toEqual([
      { type: 'skipReading', id: 101 },
      { type: 'skipReading', id: 102 },
    ]);
});

/** Waits until the page has posted that the reading `id` is held: the hold starts on a timer, which a slow runner delays. */
async function untilHeld(page: Page, id: number): Promise<void> {
  await expect
    .poll(async () =>
      page.evaluate(
        (held) =>
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion
          (globalThis as unknown as { messages: Array<{ type: string; id?: number; held?: boolean }> }).messages.some(
            (message) => message.type === 'holdReading' && message.id === held && message.held === true,
          ),
        id,
      ),
    )
    .toBe(true);
}

test('holding the reading ring pauses and releases without finishing it', async ({ page }) => {
  const post = await load(page);
  await post({ type: 'session', active: true });
  await post({ type: 'state', state: 'read', turn: 'agent', paused: false });
  await post({ type: 'reading', ms: 30_000, id: 301 });
  const control = page.getByRole('button', { name: 'Finish reading pause' });
  await expect(control).toBeEnabled();
  await control.hover();
  await page.mouse.down();
  await untilHeld(page, 301);
  await page.mouse.up();
  await expect
    .poll(async () =>
      page.evaluate(() => {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        return (globalThis as unknown as { messages: Array<{ type: string }> }).messages.filter(
          (message) => message.type === 'holdReading' || message.type === 'skipReading',
        );
      }),
    )
    .toEqual([
      { type: 'holdReading', id: 301, held: true },
      { type: 'holdReading', id: 301, held: false },
    ]);
  await post({ type: 'reading', ms: 30_000, id: 302 });
  await expect(control).toBeEnabled();
  await control.focus();
  await page.keyboard.down('Space');
  await untilHeld(page, 302);
  await page.keyboard.up('Space');
  await expect
    .poll(async () =>
      page.evaluate(() => {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        return (globalThis as unknown as { messages: Array<{ type: string }> }).messages.filter(
          (message) => message.type === 'holdReading' || message.type === 'skipReading',
        );
      }),
    )
    .toEqual([
      { type: 'holdReading', id: 301, held: true },
      { type: 'holdReading', id: 301, held: false },
      { type: 'holdReading', id: 302, held: true },
      { type: 'holdReading', id: 302, held: false },
    ]);
});

test('a gesture started on one message cannot skip a later message', async ({ page }) => {
  const post = await load(page);
  await post({ type: 'session', active: true });
  await post({ type: 'state', state: 'read', turn: 'agent', paused: false });
  await post({ type: 'reading', ms: 30_000, id: 401 });
  const control = page.getByRole('button', { name: 'Finish reading pause' });
  await expect(control).toBeEnabled();
  await control.hover();
  await page.mouse.down();
  await post({ type: 'reading', ms: 30_000, id: 402 });
  await page.mouse.up();
  await expect
    .poll(async () =>
      page.evaluate(() => {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        return (globalThis as unknown as { messages: Array<{ type: string }> }).messages.filter(
          (message) => message.type === 'skipReading',
        );
      }),
    )
    .toEqual([]);
  await expect(control).toBeEnabled();
});

test('the Settings gear remains available while idle, calibrating, and active', async ({ page }) => {
  const post = await load(page);
  const settings = page.getByRole('button', { name: 'Settings' });
  await expect(settings).toHaveCount(1);
  await expect(settings).toBeVisible();
  await expect(settings.locator('svg')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'End the session' })).toBeHidden();
  await settings.click();
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();
  await post({ type: 'calibration', view: { phase: 'armed', title: 'Test' } });
  await expect(settings).toBeVisible();
  await post({ type: 'session', active: true });
  await expect(settings).toBeVisible();
  await expect(page.getByRole('button', { name: 'End the session' })).toBeVisible();
});

test('Your move exposes guidance on keyboard focus and clears it on status change', async ({ page }) => {
  const post = await load(page);
  await post({ type: 'session', active: true });
  await post({ type: 'state', state: 'listening', turn: 'agent', paused: false });
  const status = page.getByText('Your move', { exact: true });
  await expect(status).toHaveAttribute('tabindex', '0');
  await page.keyboard.press('Tab');
  await status.focus();
  await expect(page.getByRole('tooltip')).toContainText('agent is listening for your reply');
  await post({ type: 'state', state: 'thinking', turn: 'agent', paused: false });
  await expect(page.getByRole('tooltip')).toBeHidden();
});

test('terminal controls expose the saved preference and reveal the selected command', async ({ page }) => {
  const post = await load(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  const automatic = page.getByRole('checkbox', { name: 'Show terminals automatically' });
  await expect(automatic).not.toBeChecked();
  await automatic.check();
  await expect
    .poll(async () =>
      page.evaluate(() => {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        return (globalThis as unknown as { messages: unknown[] }).messages;
      }),
    )
    .toContainEqual({ type: 'showTerminals', value: true });
  await post({ type: 'showTerminals', value: false });
  await expect(automatic).not.toBeChecked();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await post({ type: 'session', active: true });
  await post({ type: 'run', id: 71, command: 'npm test', phase: 'confirm' });
  await expect(page.getByRole('button', { name: 'Show terminal' })).toBeHidden();
  await post({ type: 'run', id: 71, command: 'npm test', phase: 'running' });
  await page.getByRole('button', { name: 'Show terminal' }).click();
  await post({ type: 'run', id: 71, command: 'npm test', phase: 'done', exitCode: 0 });
  await page.getByRole('button', { name: 'Show terminal' }).click();
  await expect
    .poll(async () =>
      page.evaluate(() => {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        return (globalThis as unknown as { messages: Array<{ type: string }> }).messages.filter(
          (message) => message.type === 'showTerminal',
        );
      }),
    )
    .toEqual([
      { type: 'showTerminal', id: 71 },
      { type: 'showTerminal', id: 71 },
    ]);
});

test('Settings copies diagnostics only on request and suspended status explains recovery', async ({ page }) => {
  const post = await load(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  const copy = page.getByRole('button', { name: 'Copy diagnostics' });
  await expect(copy).toBeVisible();
  await copy.focus();
  await page.keyboard.press('Enter');
  await expect
    .poll(async () =>
      page.evaluate(() => {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        return (globalThis as unknown as { messages: Array<{ type: string }> }).messages.filter(
          (message) => message.type === 'copyDiagnostics',
        );
      }),
    )
    .toEqual([{ type: 'copyDiagnostics' }]);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Settings' })).toBeFocused();
  await post({ type: 'session', active: true, task: 'Previous' });
  await post({ type: 'session', active: true, task: 'Previous', suspended: true });
  const status = page.locator('[data-ui=status-text]');
  await page.keyboard.press('Tab');
  await status.focus();
  await expect(page.getByRole('tooltip')).toContainText('same project');
  await post({ type: 'session', active: true, task: 'Replacement' });
  await post({ type: 'state', state: 'typing', turn: 'agent', paused: false });
  await expect(status).toContainText('Playing');
  await expect(status).not.toContainText('Suspended');
});

test('the code display menu is separate from pace and mirrors Settings', async ({ page }) => {
  const post = await load(page);
  await post({ type: 'session', active: true });
  await post({ type: 'speed', value: 3 });
  await post({ type: 'codePlayback', value: 'typing' });
  const mode = page.getByRole('button', { name: 'Code display: Typing' });
  expect(
    await mode.evaluate((button) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      const browser = globalThis as unknown as { getComputedStyle: (target: unknown, pseudo: string) => { borderTopWidth: string } };
      return browser.getComputedStyle(button, '::after').borderTopWidth;
    }),
  ).toBe('4px');
  await mode.click();
  const lines = page.getByRole('menu', { name: 'Code display' }).getByRole('menuitemradio', { name: 'Lines' });
  await lines.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Code display: Lines' })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Playback speed: 3.0x' })).toBeVisible();
  await expect
    .poll(async () =>
      page.evaluate(() => {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        return (globalThis as unknown as { messages: unknown[] }).messages;
      }),
    )
    .toContainEqual({ type: 'codePlayback', value: 'lines' });
  await page.getByRole('button', { name: 'Settings' }).click();
  const selector = page.getByRole('dialog', { name: 'Settings' }).getByRole('combobox', { name: 'Code display' });
  await expect(selector).toHaveValue('lines');
  await selector.selectOption('blocks');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Code display: Blocks' })).toBeVisible();
});

/** A small deterministic mono PCM WAV for browser media checks. */
function toneWav(seconds: number): string {
  const rate = 24_000;
  const count = rate * seconds;
  const header = 44;
  const wav = Buffer.alloc(header + count * 2);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(count * 2, 40);
  for (let index = 0; index < count; index++) {
    wav.writeInt16LE(Math.round(Math.sin((index * 2 * Math.PI * 440) / rate) * 1000), header + index * 2);
  }
  return wav.toString('base64');
}

test('real WAV playback pauses, resumes and stops from the speech controls', async ({ page }) => {
  await page.addInitScript(() => {
    // The wrapper retains the browser's real Audio implementation and decode path.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const g = globalThis as unknown as {
      Audio: new (url: string) => { currentTime: number; paused: boolean };
      testAudio?: { currentTime: number; paused: boolean };
    };
    const Original = g.Audio;
    g.Audio = new Proxy(Original, {
      construct(target, args) {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        const audio = Reflect.construct(target, args) as { currentTime: number; paused: boolean };
        g.testAudio = audio;
        return audio;
      },
    });
  });
  const post = await load(page);
  await post({ type: 'speechPage', pageId: 1 });
  await post({ type: 'speechSupport', supported: true });
  await post({ type: 'speechSettings', value: { enabled: false, voice: 'af_heart', speed: 1 } });
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Preview voice' }).click();
  await post({ type: 'speechStatus', id: 1, pageId: 1, state: 'preparing' });
  await post({ type: 'speechAudio', id: 1, pageId: 1, wavBase64: toneWav(2), durationMs: 2000 });
  async function audioState() {
    return page.evaluate(() => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      const audio = (globalThis as unknown as { testAudio?: { currentTime: number; paused: boolean } }).testAudio;
      return { time: audio?.currentTime ?? 0, paused: audio?.paused ?? true };
    });
  }
  await expect.poll(async () => (await audioState()).time).toBeGreaterThan(0);
  await post({ type: 'speechControl', id: 1, pageId: 1, action: 'pause' });
  await expect.poll(async () => (await audioState()).paused).toBe(true);
  const pausedAt = (await audioState()).time;
  await post({ type: 'speechControl', id: 1, pageId: 1, action: 'resume' });
  await expect.poll(async () => (await audioState()).time).toBeGreaterThan(pausedAt);
  await page.getByRole('button', { name: 'Stop speech', exact: true }).click();
  await expect.poll(async () => (await audioState()).paused).toBe(true);
  await expect
    .poll(async () =>
      page.evaluate(() => {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        return (globalThis as unknown as { messages: Array<{ type: string }> }).messages.filter((message) => message.type === 'speechStop');
      }),
    )
    .toEqual([{ type: 'speechStop' }]);
  await post({ type: 'speechControl', id: 1, pageId: 1, action: 'stop' });
  await expect
    .poll(async () =>
      page.evaluate(() => {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        return (globalThis as unknown as { messages: Array<{ type: string; id?: number; pageId?: number }> }).messages.filter(
          (message) => message.type === 'speechRetired',
        );
      }),
    )
    .toEqual([{ type: 'speechRetired', id: 1, pageId: 1 }]);
  await expect.poll(async () => (await audioState()).paused).toBe(true);
});

test('real audio completion leaves the reading timer and command decision alone', async ({ page }) => {
  const post = await load(page);
  await post({ type: 'speechPage', pageId: 1 });
  await post({ type: 'speechSupport', supported: true });
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Preview voice' }).click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await post({ type: 'session', active: true });
  await post({ type: 'say', text: 'Keep this visible.' });
  await post({ type: 'reading', id: 51, ms: 30_000 });
  await post({ type: 'state', state: 'read', turn: 'agent', paused: false });
  await post({ type: 'run', id: 81, command: 'npm test', phase: 'confirm' });
  await post({ type: 'speechStatus', id: 2, pageId: 1, state: 'preparing' });
  await post({ type: 'speechAudio', id: 2, pageId: 1, wavBase64: toneWav(0.2), durationMs: 200 });
  await expect
    .poll(async () =>
      page.evaluate(() => {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        return (globalThis as unknown as { messages: Array<{ type: string; event?: string }> }).messages.some(
          (message) => message.type === 'speechEvent' && message.event === 'ended',
        );
      }),
    )
    .toBe(true);
  await expect(page.getByText('Keep this visible.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run once', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Allow this command', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Allow all for session', exact: true })).toBeVisible();
  await expect(page.locator('[data-ui=dot]')).toHaveClass(/reading/);
  const forbidden = await page.evaluate(() => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return (globalThis as unknown as { messages: Array<{ type: string }> }).messages.filter(
      (message) => message.type === 'skipReading' || message.type === 'runDecision',
    );
  });
  expect(forbidden).toEqual([]);
});

test('Settings stays readable and operable in a narrow panel', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 600 });
  const post = await load(page);
  await post({ type: 'session', active: true });
  await post({ type: 'codePlayback', value: 'lines' });
  await post({ type: 'replyBehavior', value: 'finishAction' });
  await expect(page.getByRole('button', { name: 'Code display: Lines' })).toBeVisible();
  await page.getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog).toBeVisible();
  for (const title of ['Conversation', 'Playback', 'Commands', 'Speech', 'Diagnostics']) {
    await expect(dialog.getByRole('heading', { name: title })).toBeAttached();
  }
  const replyBehavior = dialog.getByRole('combobox', { name: 'When I send a reply' });
  await expect(replyBehavior).toHaveValue('finishAction');
  await replyBehavior.focus();
  await expect(replyBehavior).toBeFocused();
  await replyBehavior.selectOption('interrupt');
  await expect(replyBehavior).toHaveValue('interrupt');
  await expect(dialog.getByRole('combobox', { name: 'Code display' })).toHaveValue('lines');
  await dialog.getByRole('combobox', { name: 'Code display' }).selectOption('blocks');
  const copy = dialog.getByRole('button', { name: 'Copy diagnostics' });
  await copy.scrollIntoViewIfNeeded();
  await expect(copy).toBeVisible();
  const close = dialog.getByRole('button', { name: 'Close', exact: true });
  await close.scrollIntoViewIfNeeded();
  await close.click();
  await expect(page.getByRole('button', { name: 'Code display: Blocks' })).toBeVisible();
  const widths = await page.evaluate(() => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const doc = (globalThis as unknown as { document: { documentElement: { scrollWidth: number; clientWidth: number } } }).document;
    return [doc.documentElement.scrollWidth, doc.documentElement.clientWidth];
  });
  expect(widths[0]).toBeLessThanOrEqual(widths[1] ?? 0);
});

test('speech provider controls are explicit and render account voices as text', async ({ page }) => {
  const post = await load(page);
  await post({ type: 'speechCloudSupport', supported: true });
  await post({ type: 'speechKeyStatus', hasKey: true });
  await page.getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByLabel('Speech provider').selectOption('elevenlabs');
  await expect(dialog.getByText('Selected narration and voice previews are sent to ElevenLabs', { exact: false })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Download Kokoro model' })).toBeHidden();
  const more = dialog.getByRole('button', { name: 'Load more', includeHidden: true });
  await expect(more).toBeHidden();
  await post({ type: 'speechCatalog', value: { voices: [], more: true, loading: false, error: false } });
  await expect(more).toBeVisible();
  await post({ type: 'speechCatalog', value: { voices: [], more: false, loading: false, error: false } });
  await expect(more).toBeHidden();
  await dialog.getByRole('button', { name: 'Load voices', exact: true }).click();
  const status = dialog.locator('[data-ui="speech-settings-status"]');
  await post({ type: 'speechCatalog', value: { voices: [], more: false, loading: false, error: true, errorKind: 'network' } });
  await expect(status).toHaveText('Could not connect to ElevenLabs. Check your network.');
  await post({ type: 'speechCatalog', value: { voices: [], more: false, loading: true, error: false } });
  await expect(status).toHaveText('Loading account voices...');
  await post({
    type: 'speechCatalog',
    value: { voices: [{ id: 'voice1', name: '<script>not markup</script>' }], more: false, loading: false, error: false },
  });
  await expect(status).toHaveText('Account voices loaded.');
  await expect(dialog.getByRole('option', { name: '<script>not markup</script>' })).toHaveCount(1);
  await expect(dialog.locator('script')).toHaveCount(0);
  await dialog.getByLabel('Account voice').selectOption('voice1');
  await expect(dialog.getByRole('button', { name: 'Preview voice' })).toBeEnabled();
});

test('speech output selection is explicit, independent of provider and never previews on its own', async ({ page }) => {
  const post = await load(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  const output = dialog.getByLabel('Speech output');
  await post({ type: 'speechOutputCatalog', value: { supported: false, devices: [], selected: { kind: 'default' } } });
  await expect(dialog.getByText('Select Refresh outputs to list available devices.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Refresh outputs' }).click();
  const choice = { kind: 'native', backend: 'pipewire', name: 'pair_headphones' };
  await post({
    type: 'speechOutputCatalog',
    value: { supported: true, devices: [{ choice, label: '<Headphones>', available: true }], selected: { kind: 'default' } },
  });
  await expect(output.getByRole('option', { name: '<Headphones>' })).toHaveCount(1);
  await output.selectOption('1');
  await dialog.getByLabel('Speech provider').selectOption('elevenlabs');
  await expect(output).toBeVisible();
  const messages = await page.evaluate(() => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return (globalThis as unknown as { messages: Array<{ type: string }> }).messages;
  });
  expect(messages.filter((message) => message.type === 'speechOutputRefresh')).toHaveLength(1);
  expect(messages).toContainEqual({ type: 'speechOutputSelect', choice });
  expect(messages.filter((message) => message.type === 'speechPreview')).toHaveLength(0);
  await post({ type: 'speechOutputCatalog', value: { supported: false, devices: [], selected: choice, reason: 'unavailable' } });
  await expect(output.getByRole('option', { name: 'Saved output unavailable' })).toBeAttached();
  await expect(dialog.getByRole('button', { name: 'Preview voice' })).toBeDisabled();
});

test('approval and queued work remain readable in a narrow panel', async ({ page }) => {
  await page.setViewportSize({ width: 240, height: 640 });
  const post = await load(page);
  await post({ type: 'session', active: true, task: 'Review queued work' });
  await post({ type: 'state', state: 'typing', turn: 'agent', paused: false, ready: 1 });
  await post({ type: 'run', id: 1, command: 'echo hello', phase: 'confirm' });
  const status = page.locator('[data-ui="status-text"]');
  await expect(status).toHaveText('Needs you - 1 ready');
  const bounds = await status.boundingBox();
  expect(bounds).not.toBeNull();
  expect((bounds?.x ?? 240) + (bounds?.width ?? 240)).toBeLessThanOrEqual(240);
});

test('experimental GPU setup remains readable and explicit in a narrow Settings dialog', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 360, height: 600 });
  const post = await load(page);
  // GPU and Auto are offered only on a host with a GPU path (#42).
  await post({ type: 'speechSupport', supported: true, gpu: true });
  await post({ type: 'speechComputeState', value: { requestedMode: 'cpu', actualBackend: 'none', gpuCheck: { phase: 'idle' } } });
  await page.getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  const compute = dialog.getByRole('combobox', { name: 'Kokoro compute' });
  await compute.scrollIntoViewIfNeeded();
  await expect(compute).toHaveValue('cpu');
  await expect(dialog.getByText('Experimental', { exact: true })).toBeVisible();
  const details = dialog.locator('[data-ui="speech-details"]');
  await expect(details.getByText(/326 MB/)).toBeHidden();
  await details.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(details.getByText(/326 MB/)).toBeVisible();
  await compute.selectOption('auto');
  await dialog.getByRole('button', { name: 'Set up GPU' }).click();
  await post({
    type: 'speechComputeState',
    value: { requestedMode: 'auto', actualBackend: 'cpu', gpuCheck: { phase: 'unavailable', reason: 'no_hardware' } },
  });
  await expect(dialog.getByRole('status').filter({ hasText: 'No compatible GPU' })).toContainText('Using CPU');
  await expect(details).toContainText('Requested: AUTO. Actual backend: CPU');
  const widths = await dialog.evaluate((element: { scrollWidth: number; clientWidth: number }) => [
    element.scrollWidth,
    element.clientWidth,
  ]);
  expect(widths[0]).toBeLessThanOrEqual(widths[1] ?? 0);
  const messages = await page.evaluate(() => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return (globalThis as unknown as { messages: Array<{ type: string; value?: string }> }).messages;
  });
  expect(messages).toContainEqual({ type: 'speechComputeMode', value: 'auto' });
  expect(messages).toContainEqual({ type: 'checkGpuSetup' });
  await dialog.screenshot({ path: testInfo.outputPath('gpu-settings.png') });
});

/**
 * Presses Escape in the open Settings dialog and waits for its `close` event: the page's own listener, added first,
 * moves focus back to the Settings button then, a task after the dialog has gone, which a loaded runner delays.
 */
async function escapeSettings(page: Page): Promise<void> {
  await page
    .locator('[data-ui="settings-dialog"]')
    .evaluate((dialog: { addEventListener: (type: string, listener: () => void, options: { once: boolean }) => void }) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      const flags = globalThis as unknown as { settingsClosed: boolean };
      flags.settingsClosed = false;
      dialog.addEventListener(
        'close',
        () => {
          flags.settingsClosed = true;
        },
        { once: true },
      );
    });
  await page.keyboard.press('Escape');
  await expect
    .poll(async () =>
      page.evaluate(() => {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        return (globalThis as unknown as { settingsClosed: boolean }).settingsClosed;
      }),
    )
    .toBe(true);
}

test('voice status uses cached evidence and Settings opens by keyboard at narrow and wide widths', async ({ page }) => {
  const post = await load(page);
  await post({ type: 'speechPage', pageId: 1 });
  await post({ type: 'speechTransport', available: true });
  await post({
    type: 'speechSettings',
    value: { enabled: true, provider: 'kokoro', voice: 'af_heart', speed: 1, elevenLabsVoice: '', elevenLabsSpeed: 1 },
  });
  await post({
    type: 'speechComputeState',
    value: { requestedMode: 'cpu', actualBackend: 'cpu', phase: 'ready', generation: 1, gpuCheck: { phase: 'idle' } },
  });
  const facts = {
    enabled: true,
    provider: 'kokoro',
    keyConfigured: 'unknown',
    voiceConfigured: true,
    output: 'default',
    routeAvailable: true,
    runtimeReady: true,
    modelReady: true,
    lastPlayback: 'unknown',
  };
  await post({ type: 'speechReadiness', value: facts });
  await post({
    type: 'speechComputeState',
    value: { requestedMode: 'cpu', actualBackend: 'none', phase: 'loading', generation: 1, gpuCheck: { phase: 'idle' } },
  });
  const voice = page.getByRole('button', { name: 'Automatic narration' });
  await expect(voice).toBeVisible();
  await expect(voice).toHaveAttribute('aria-description', 'Voice: model starting');
  await expect(voice).toHaveAttribute('aria-pressed', 'true');
  const indicator = voice.locator('.voice-indicator');
  await expect(indicator).toHaveCSS('background-color', 'rgb(230, 126, 34)');
  await expect(indicator).toHaveCSS('animation-name', 'voice-starting');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(indicator).toHaveCSS('animation-name', 'none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await post({
    type: 'speechComputeState',
    value: { requestedMode: 'cpu', actualBackend: 'cpu', phase: 'ready', generation: 1, gpuCheck: { phase: 'idle' } },
  });
  for (const width of [360, 720]) {
    await page.setViewportSize({ width, height: 640 });
    await expect(voice).toBeVisible();
    await expect(voice).toHaveAttribute('aria-description', 'Voice: ready (checks passed)');
    const button = page.getByRole('button', { name: 'Settings', exact: true });
    await expect(button).toBeVisible();
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('combobox', { name: 'Chat order' })).toBeFocused();
    await escapeSettings(page);
    await expect(button).toBeFocused();
    const scrollWidth = await page.locator('html').evaluate((element: { scrollWidth: number }) => element.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(width);
  }
  await voice.focus();
  await page.keyboard.press('Enter');
  await expect(voice).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('dialog', { name: 'Settings' })).not.toBeVisible();
  await expect
    .poll(async () =>
      page.evaluate(() => {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        return (globalThis as unknown as { messages: Array<{ type: string; value?: { enabled?: boolean } }> }).messages.some(
          (message) => message.type === 'speechSettings' && message.value?.enabled === false,
        );
      }),
    )
    .toBe(true);
  await voice.focus();
  await page.keyboard.press('Enter');
  await expect(voice).toHaveAttribute('aria-pressed', 'true');
  await post({ type: 'speechReadiness', value: { ...facts, routeAvailable: 'unknown' } });
  await expect(voice).toHaveAttribute('aria-description', 'Voice: readiness not checked');
  await post({ type: 'speechReadiness', value: { ...facts, enabled: false } });
  await expect(voice).toHaveAttribute('aria-description', 'Automatic narration: off');
  await post({ type: 'speechReadiness', value: { ...facts, lastPlayback: 'failed' } });
  await expect(voice).toHaveAttribute('aria-description', 'Voice: unavailable');
  await post({ type: 'speechTransport', available: false });
  await post({ type: 'speechReadiness', value: facts });
  await expect(voice).toHaveAttribute('aria-description', 'Voice: unavailable');
});
