// @vitest-environment happy-dom
// The panel's history, with the page script running in a DOM. The cases come from specs/Panel.tla (#18).

import { beforeEach, expect, it } from "vitest"
import type { Window } from "happy-dom"
import { LABEL_SEPARATOR } from "@ai-pair/core/constants"
import { loadPage } from "./page"

// The test environment's globals, typed with happy-dom's types: the project's type check has no DOM library.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const { window, document } = globalThis as unknown as { window: Window; document: Window["document"] }

beforeEach(async () => {
  await loadPage()
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

it("names the project guides the agent was given in the session's divider (#23)", () => {
  send({ type: "session", active: true, task: "fix it", rules: ["~/.ai-pair/GUIDE.md", "/p/.ai-pair/GUIDE.md"] })
  expect(history()).toEqual([`Session started: fix it${LABEL_SEPARATOR}rules from ~/.ai-pair/GUIDE.md, /p/.ai-pair/GUIDE.md`])
})

it("keeps a suspended session's history, and says when it waits for the agent and when it's back (#25)", () => {
  send({ type: "session", active: true })
  send({ type: "say", text: "A" })
  send({ type: "session", active: true, suspended: true })
  expect(document.querySelector("#status-text")?.textContent).toBe("Suspended: waiting for the agent")
  send({ type: "session", active: true, resumed: true })
  expect(history()).toEqual([
    "The agent is back: session resumed",
    "The agent disconnected: the session waits for it",
    "A",
    "Session started",
  ])
})
