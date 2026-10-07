// @vitest-environment happy-dom
// The panel's history, with the page script running in a DOM. The cases come from specs/Panel.tla (#18).

import { beforeEach, expect, it } from "vitest"
import type { Window } from "happy-dom"
import { panelHtml } from "../src/panelHtml"

// The test environment's globals, typed with happy-dom's types: the project's type check has no DOM library.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const { window, document } = globalThis as unknown as { window: Window; document: Window["document"] }

// Loads the page into the document and runs its script, as the webview does.
beforeEach(() => {
  const html = panelHtml("vscode-resource:")
  document.body.innerHTML = /<body[^>]*>([\s\S]*)<\/body>/.exec(html)![1]!
  const script = /<script nonce="[^"]+">([\s\S]*?)<\/script>/.exec(html)![1]!
  // Running the page's own script is what this test is for.
  // oxlint-disable-next-line typescript/no-implied-eval
  new Function("acquireVsCodeApi", script)(() => ({ postMessage() {}, getState() {}, setState() {} }))
})

function send(event: object): void {
  window.dispatchEvent(new window.MessageEvent("message", { data: event }))
}

function history(): string[] {
  return [...document.querySelectorAll("#history .entry")].map((e) => e.textContent ?? "")
}

it("puts a reply above the agent message it answers", () => {
  send({ type: "session", active: true })
  send({ type: "say", text: "A" })
  send({ type: "user", text: "R" })
  send({ type: "say", text: "B" })
  expect(history()).toEqual(["R", "A", "Session started"])
})

it("files the current message once, before anything added while it was current", () => {
  send({ type: "session", active: true })
  send({ type: "say", text: "A" })
  send({ type: "user", text: "R" })
  send({ type: "interrupt" })
  send({ type: "session", active: false, reason: "agent" })
  expect(history()).toEqual(["The agent ended the session", "You interrupted", "R", "A", "Session started"])
})
