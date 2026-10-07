// @vitest-environment happy-dom
// The panel by keyboard and screen reader (#16): every link is focusable and works with Enter, and
// what changes without the programmer acting is announced.

import { beforeEach, expect, it } from "vitest"
import type { Window } from "happy-dom"
import { panelHtml } from "../src/panelHtml"

// The test environment's globals, typed with happy-dom's types: the project's type check has no DOM library.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const { window, document } = globalThis as unknown as { window: Window; document: Window["document"] }

let posted: { type: string }[]

beforeEach(() => {
  posted = []
  const html = panelHtml("vscode-resource:")
  document.body.innerHTML = /<body[^>]*>([\s\S]*)<\/body>/.exec(html)![1]!
  const script = /<script nonce="[^"]+">([\s\S]*?)<\/script>/.exec(html)![1]!
  // Running the page's own script is what this test is for.
  // oxlint-disable-next-line typescript/no-implied-eval
  new Function("acquireVsCodeApi", script)(() => ({ postMessage: (m: { type: string }) => posted.push(m), getState() {}, setState() {} }))
})

function send(event: object): void {
  window.dispatchEvent(new window.MessageEvent("message", { data: event }))
}

/** A session with every kind of link: the intro's commands, a file and a URL in messages, code references. */
function withEveryLink(): void {
  send({ type: "session", active: true })
  send({ type: "selection", ref: { file: "src/a.ts", line: 3, endLine: 4 } })
  send({ type: "point", file: "src/a.ts", line: 2 })
  send({ type: "say", text: "See `src/a.ts` and https://example.com/docs" })
  send({ type: "user", text: "ok", ref: { file: "src/a.ts", line: 5, endLine: 5 } })
  send({ type: "say", text: "Next." })
}

it("makes every link focusable, and none holds another", () => {
  withEveryLink()
  const links = [...document.querySelectorAll("a")]
  expect(links.map((a) => a.className).toSorted()).toEqual(
    expect.arrayContaining(["command", "file", "ref", "url"]),
  )
  for (const a of links) {
    expect(a.getAttribute("href"), a.outerHTML).toBe("#")
    expect(a.querySelector("a"), a.outerHTML).toBeNull()
  }
})

it("activates a link without following its href", () => {
  withEveryLink()
  for (const a of document.querySelectorAll("a")) {
    const click = new window.MouseEvent("click", { bubbles: true, cancelable: true })
    a.dispatchEvent(click)
    expect(click.defaultPrevented, a.outerHTML).toBe(true)
  }
  expect(posted.map((m) => m.type)).toEqual(expect.arrayContaining(["open", "openFile", "openUrl", "command"]))
})

it("announces the agent's narration and the state, and a command waiting for a decision at once", () => {
  expect(document.getElementById("now-text")!.getAttribute("aria-live")).toBe("polite")
  expect(document.getElementById("status-text")!.getAttribute("role")).toBe("status")
  const run = document.getElementById("run")!
  send({ type: "session", active: true })
  send({ type: "run", id: 1, command: "npm test", phase: "confirm" })
  expect(run.getAttribute("role")).toBe("alert")
  send({ type: "run", id: 1, command: "npm test", phase: "running" })
  expect(run.getAttribute("role")).toBeNull()
  send({ type: "run", id: 2, command: "npm run build", phase: "confirm" })
  send({ type: "run", id: 2, command: "npm run build", phase: "declined" })
  expect(run.getAttribute("role")).toBeNull()
})
