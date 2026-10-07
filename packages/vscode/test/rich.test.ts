// @vitest-environment happy-dom
// How the panel shows a message's text (`rich` in webview/panel.ts, #6): escaped, with code spans,
// file names that open the file, and URLs.

import { beforeEach, expect, it } from "vitest"
import type { Window } from "happy-dom"
import { loadPage } from "./page"

// The test environment's globals, typed with happy-dom's types: the project's type check has no DOM library.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const { window, document } = globalThis as unknown as { window: Window; document: Window["document"] }

beforeEach(async () => {
  await loadPage()
  window.dispatchEvent(new window.MessageEvent("message", { data: { type: "session", active: true } }))
})

function shown(text: string): string {
  window.dispatchEvent(new window.MessageEvent("message", { data: { type: "say", text } }))
  return document.getElementById("now-text")!.innerHTML
}

it("escapes markup", () => {
  shown(`<b>"x" & 'y'</b>`)
  const now = document.getElementById("now-text")!
  expect(now.textContent).toBe(`<b>"x" & 'y'</b>`)
  expect(now.querySelector("b")).toBeNull()
})

it("links a code span that names a file, and leaves other code as code", () => {
  expect(shown("Open `src/game.ts`.")).toBe('Open <a href="#" class="file" data-file="src/game.ts">src/game.ts</a>.')
  expect(shown("Call `update(dt)`.")).toBe("Call <code>update(dt)</code>.")
  expect(shown("See `.env`.")).toBe("See <code>.env</code>.")
})

it("links a URL, without the punctuation after it", () => {
  expect(shown("Docs: https://example.com/a?b=1.")).toBe(
    'Docs: <a href="#" class="url" data-url="https://example.com/a?b=1">https://example.com/a?b=1</a>.',
  )
})
