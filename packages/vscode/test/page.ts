// Loads the narration panel's page into the happy-dom document and runs its script, as the
// webview does: the markup, then the module webview/panel.ts. The markup is test/fixtures/panel.html, which
// panel_html.test.ts holds to what panel_html.ts writes, so a page test relies on webview/panel.ts alone (#176).

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Element, Window } from 'happy-dom';
import { vi } from 'vitest';

// The test environment's globals, typed with happy-dom's types: the project's type check has no DOM library.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const { window, document } = globalThis as unknown as { window: Window; document: Window['document'] };

// A variable, so the project's type check, which has no DOM library, doesn't follow it: the
// script has its own (src/webview/tsconfig.json).
const SCRIPT = '../src/webview/panel';

/** The page's markup, as panel_html.ts writes it. */
const FIXTURE = path.join(import.meta.dirname, 'fixtures', 'panel.html');

/** Loads the page. `post`: what the page posts to the extension. */
export async function loadPage(post: (message: { type: string }) => void = () => {}): Promise<void> {
  const html = fs.readFileSync(FIXTURE, 'utf8');
  // happy-dom loads no stylesheet unless asked; the tests need none, so the skipped fetch counts as a success.
  window.happyDOM.settings.handleDisabledFileLoadingAsSuccess = true;
  // Parsed, without its script element: the script runs as the module below.
  const page = new window.DOMParser().parseFromString(html, 'text/html');
  for (const script of page.querySelectorAll('script')) {
    script.remove();
  }
  document.body.replaceChildren(...page.body.childNodes);
  Object.assign(globalThis, { acquireVsCodeApi: () => ({ postMessage: post }) });
  vi.resetModules();
  await import(/* @vite-ignore */ SCRIPT);
}

/** Returns the page's element marked `data-ui="name"`, as webview/panel.ts finds it. */
export function ui(name: string): Element | null {
  return document.querySelector(`[data-ui="${name}"]`);
}
