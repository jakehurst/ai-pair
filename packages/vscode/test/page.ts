// Loads the narration panel's page into the happy-dom document and runs its script, as the
// webview does: the markup from panelHtml.ts, then the module webview/panel.ts.

import type { Window } from "happy-dom"
import { vi } from "vitest"
import { panelHtml } from "../src/panelHtml"

// The test environment's globals, typed with happy-dom's types: the project's type check has no DOM library.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const { window, document } = globalThis as unknown as { window: Window; document: Window["document"] }

// A variable, so the project's type check, which has no DOM library, doesn't follow it: the
// script has its own (src/webview/tsconfig.json).
const SCRIPT = "../src/webview/panel"

/** `post`: what the page posts to the extension. */
export async function loadPage(post: (message: { type: string }) => void = () => {}): Promise<void> {
  const html = panelHtml("vscode-resource:", "panel.js")
  // Parsed, without its script element: the script runs as the module below.
  const page = new window.DOMParser().parseFromString(html, "text/html")
  for (const script of page.querySelectorAll("script")) script.remove()
  document.body.replaceChildren(...page.body.childNodes)
  Object.assign(globalThis, { acquireVsCodeApi: () => ({ postMessage: post }) })
  vi.resetModules()
  await import(/* @vite-ignore */ SCRIPT)
}
