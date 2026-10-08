// The panel's log, replayed into a view created after a long session: it still has the session
// (#54, specs/PanelReplay.tla).

import { expect, it, vi } from "vitest"
import type { PanelEvent } from "@ai-pair/core"
import { NarrationPanel } from "../src/panel"

vi.mock("vscode", () => ({ commands: { executeCommand: () => Promise.resolve() } }))

/** A view created now: what it's sent when its page says it's ready. */
function replay(panel: NarrationPanel): PanelEvent[] {
  const sent: { type: string; events?: PanelEvent[] }[] = []
  let receive: ((m: { type: string }) => void) | undefined
  const view = {
    webview: {
      options: {},
      html: "",
      cspSource: "",
      postMessage: (m: { type: string; events?: PanelEvent[] }) => {
        sent.push(m)
        return Promise.resolve(true)
      },
      onDidReceiveMessage: (f: (m: { type: string }) => void) => {
        receive = f
      },
    },
    onDidDispose: () => {},
    show: () => {},
  }
  // A stand-in for VS Code's WebviewView: only what NarrationPanel uses.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  panel.resolveWebviewView(view as never)
  receive?.({ type: "ready" })
  return sent.find((m) => m.type === "replay")!.events!
}

it("keeps the session's start in the log however many events follow it", () => {
  const panel = new NarrationPanel(
    (f) => f,
    { get: () => 1, set: () => {} },
    { get: () => 1, set: () => {} },
    { current: () => undefined, ref: () => undefined },
  )
  panel.post({ type: "session", active: true, task: "long" })
  for (let i = 0; i < 1000; i++) panel.post({ type: "say", text: `message ${i}` })
  const events = replay(panel)
  expect(events.filter((e) => e.type === "session")).toEqual([{ type: "session", active: true, task: "long" }])
  expect(events.at(-1)).toEqual({ type: "say", text: "message 999" })
  expect(events.length).toBeLessThanOrEqual(401)
})

it("replays the session's end when that is the last session event", () => {
  const panel = new NarrationPanel(
    (f) => f,
    { get: () => 1, set: () => {} },
    { get: () => 1, set: () => {} },
    { current: () => undefined, ref: () => undefined },
  )
  panel.post({ type: "session", active: true })
  panel.post({ type: "session", active: false, reason: "user" })
  for (let i = 0; i < 1000; i++) panel.post({ type: "say", text: `message ${i}` })
  expect(replay(panel).filter((e) => e.type === "session")).toEqual([{ type: "session", active: false, reason: "user" }])
})
