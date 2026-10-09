// @vitest-environment happy-dom
// The Start a session button in the panel's idle view (#107): shown when the extension says so, and what a click posts.

import { beforeEach, expect, it } from "vitest"
import type { Window } from "happy-dom"
import { loadPage } from "./page"

// The test environment's globals, typed with happy-dom's types: the project's type check has no DOM library.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const { window, document } = globalThis as unknown as { window: Window; document: Window["document"] }

let posted: { type: string }[] = []

beforeEach(async () => {
  posted = []
  await loadPage((m) => posted.push(m))
})

function send(event: object): void {
  window.dispatchEvent(new window.MessageEvent("message", { data: event }))
}

const hidden = (): boolean => document.getElementById("start")?.hasAttribute("hidden") ?? false

it("hides Start a session until the extension says it can start one (ClicksNeedButton)", () => {
  expect(hidden()).toBe(true)
  send({ type: "canStart", value: true })
  expect(hidden()).toBe(false)
  send({ type: "canStart", value: false })
  expect(hidden()).toBe(true)
})

it("posts start when the button is clicked (RunsAreClicks)", () => {
  send({ type: "canStart", value: true })
  document.getElementById("start")?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }))
  expect(posted).toContainEqual({ type: "start" })
})
