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
const noteHidden = (): boolean => document.getElementById("starting")?.hasAttribute("hidden") ?? false
const click = (): void => void document.getElementById("start")?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }))

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

it("shows the starting note at once when the button is clicked (Acknowledged)", () => {
  send({ type: "canStart", value: true })
  expect(noteHidden()).toBe(true)
  click()
  expect(noteHidden()).toBe(false)
})

it("hides the starting note once the agent has exited, with no session (Settles)", () => {
  send({ type: "canStart", value: true })
  click()
  send({ type: "startEnded" })
  expect(noteHidden()).toBe(true)
})

it("hides the starting note when a session starts, new or resumed (NoteUntilSession)", () => {
  for (const session of [{ active: true }, { active: true, resumed: true }]) {
    send({ type: "session", active: false, reason: "user" })
    send({ type: "canStart", value: true })
    click()
    expect(noteHidden()).toBe(false)
    send({ type: "session", ...session })
    expect(noteHidden()).toBe(true)
  }
})
