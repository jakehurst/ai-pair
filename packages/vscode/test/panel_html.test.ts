// @vitest-environment happy-dom
// The panel's page markup, and the speed setting it offers (#17). Its script is a module of its own
// (webview/panel.ts, #6), run in a DOM by the page tests. Solitary: node:crypto is a mock, so the page's nonce is
// known; core's constants are real.

import { ok } from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import type { Window } from 'happy-dom';
import { SPEED_SUFFIX } from '@ai-pair/core/constants';
import { panelHtml, settingSpeed, SPEEDS } from '../src/panel_html';

/** The bytes the mocked randomBytes gives, which the nonce is made of. */
const NONCE_BYTE = 7;

// happy-dom uses node:crypto too, so only randomBytes is replaced; the vscode package is CommonJS, so panel_html.ts
// reaches it through the default export, which carries the mock as well.
vi.mock('node:crypto', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:crypto')>();
  const fake = vi.fn((size: number) => Buffer.alloc(size, NONCE_BYTE));
  return { ...original, default: { ...original, randomBytes: fake }, randomBytes: fake };
});

// The test environment's globals, typed with happy-dom's types: the project's type check has no DOM library.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const { window } = globalThis as unknown as { window: Window };
// happy-dom loads no stylesheet unless asked; the tests need none, so the skipped fetch counts as a success.
window.happyDOM.settings.handleDisabledFileLoadingAsSuccess = true;

afterEach(() => {
  vi.clearAllMocks();
});
it("loads its script from the file it is given, with the page's nonce, and has no inline script", () => {
  const html = panelHtml('vscode-resource:', 'https://file.vscode-resource/dist/panel.css', 'https://file.vscode-resource/dist/panel.js');
  const page = new window.DOMParser().parseFromString(html, 'text/html');
  const policy = page.querySelector('meta[http-equiv="Content-Security-Policy"]');
  ok(policy);
  const csp = policy.getAttribute('content');
  ok(csp !== undefined && csp !== '');
  const scripts = [...page.querySelectorAll('script')];
  expect(scripts).toHaveLength(1);
  const script = scripts[0];
  ok(script);
  const nonce = Buffer.alloc(vi.mocked(randomBytes).mock.calls[0]?.[0] ?? 0, NONCE_BYTE).toString('base64');
  expect(script.getAttribute('nonce')).toBe(nonce);
  expect(csp).toContain(`script-src 'nonce-${nonce}'`);
  expect(script.getAttribute('src')).toBe('https://file.vscode-resource/dist/panel.js');
  expect(script.textContent).toBe('');
});

it('loads its styles from the file it is given, and allows no inline style', () => {
  const html = panelHtml('vscode-resource:', 'https://file.vscode-resource/dist/panel.css', 'panel.js');
  const page = new window.DOMParser().parseFromString(html, 'text/html');
  const policy = page.querySelector('meta[http-equiv="Content-Security-Policy"]');
  ok(policy);
  const csp = policy.getAttribute('content');
  ok(csp !== undefined && csp !== '');
  expect(csp).toContain('style-src vscode-resource:;');
  expect(csp).not.toContain('unsafe-inline');
  const links = [...page.querySelectorAll('link[rel="stylesheet"]')];
  expect(links.map((l) => l.getAttribute('href'))).toEqual(['https://file.vscode-resource/dist/panel.css']);
  expect(page.querySelectorAll('style')).toHaveLength(0);
});

it('offers the speeds with one decimal, so they line up', () => {
  const html = panelHtml('vscode-resource:', 'panel.css', 'panel.js');
  for (const s of SPEEDS) {
    expect(html).toContain(`data-speed="${s}">${s.toFixed(1)}${SPEED_SUFFIX}</button>`);
  }
});

it('offers the same speeds for reading, in a menu of its own', () => {
  const html = panelHtml('vscode-resource:', 'panel.css', 'panel.js');
  const page = new window.DOMParser().parseFromString(html, 'text/html');
  expect(page.querySelectorAll('[data-ui="reading-menu"] [data-speed]')).toHaveLength(SPEEDS.length);
});

it("gives controls the panel's own tooltips, since native ones show unreliably in a webview", () => {
  const html = panelHtml('vscode-resource:', 'panel.css', 'panel.js');
  expect(html).not.toMatch(/\stitle=|\.title = /);
  expect(html).toContain('data-tip="Interrupt"');
});

it("has no id attributes: the script finds its elements by data-ui, as Google's HTML/CSS guide asks (#132)", () => {
  const html = panelHtml('vscode-resource:', 'panel.css', 'panel.js');
  const page = new window.DOMParser().parseFromString(html, 'text/html');
  expect(page.querySelectorAll('[id]')).toHaveLength(0);
  expect(page.querySelectorAll('[data-ui]')).not.toHaveLength(0);
});

it('clamps a number to the range the setting declares, zero and below included', () => {
  expect([-1, 0, 0.1, 0.25, 1.5, 4, 9].map((value) => settingSpeed(value))).toEqual([0.25, 0.25, 0.25, 0.25, 1.5, 4, 4]);
});

it("plays at 1 for NaN, Infinity, or what isn't a number", () => {
  expect([Number.NaN, Infinity, 'fast', undefined].map((value) => settingSpeed(value))).toEqual([1, 1, 1, 1]);
});
