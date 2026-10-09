// @vitest-environment happy-dom
// The reading speed calibration in the panel's page (#109): what the band shows at each phase.

import { beforeEach, expect, it } from "vitest"
import type { Window } from "happy-dom"
import { loadPage } from "./page"

// The test environment's globals, typed with happy-dom's types: the project's type check has no DOM library.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const { window, document } = globalThis as unknown as { window: Window; document: Window["document"] }

beforeEach(async () => {
  await loadPage()
})

const text = (id: string): string => document.getElementById(id)?.textContent ?? ""
const has = (id: string, attribute: string): boolean => document.getElementById(id)?.hasAttribute(attribute) ?? false

function send(event: object): void {
  window.dispatchEvent(new window.MessageEvent("message", { data: event }))
}

it("announces the passage and opens the reply box, with no session", () => {
  send({ type: "calibration", view: { phase: "armed", title: "Sample" } })
  expect(text("now-text")).toContain("Sample")
  expect(text("now-text")).toContain("type go")
  expect(has("reply", "disabled")).toBe(false)
  expect(document.body.classList.contains("calibrating")).toBe(true)
})

it("shows the passage and its notice while reading, then the result", () => {
  send({ type: "calibration", view: { phase: "reading", title: "Sample", text: "one two", notice: "free" } })
  expect(has("passage", "hidden")).toBe(false)
  expect(text("passage-text")).toBe("one two")
  expect(text("passage-notice")).toBe("free")
  send({ type: "calibration", view: { phase: "done", msPerChar: 25.4, wordsPerMinute: 533 } })
  expect(has("passage", "hidden")).toBe(true)
  expect(text("now-text")).toContain("25 ms per character")
  expect(text("now-text")).toContain("533 words")
  expect(has("reply", "disabled")).toBe(true)
})
