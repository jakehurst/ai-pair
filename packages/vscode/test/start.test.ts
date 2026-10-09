// The panel's starter (#107): a new page hears whether it can start a session, and a click runs the starter.

import { expect, it, vi } from "vitest"
import { NarrationPanel, type Starter } from "../src/panel"

vi.mock("vscode", () => ({ commands: { executeCommand: () => Promise.resolve() } }))

/** A view standing in for VS Code's: what the panel posts to the page, and a way to send the page's messages. */
function open(panel: NarrationPanel) {
  const posted: object[] = []
  let receive: ((m: object) => void) | undefined
  const view = {
    webview: {
      options: {},
      html: "",
      cspSource: "",
      postMessage: (m: object) => {
        posted.push(m)
        return Promise.resolve(true)
      },
      onDidReceiveMessage: (f: (m: object) => void) => (receive = f),
    },
    onDidDispose: () => {},
    show: () => {},
  }
  // Only what NarrationPanel uses.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  panel.resolveWebviewView(view as never)
  return { posted, send: (m: object) => receive?.(m) }
}

function setup(starter?: { available: boolean | "manual" }) {
  const panel = new NarrationPanel(
    (f) => f,
    { get: () => 1, set: () => {} },
    { get: () => 1, set: () => {} },
    { current: () => undefined, ref: () => undefined },
  )
  let started = 0
  const answers: ((value: boolean) => void)[] = []
  if (starter) {
    const fake: Starter = {
      available: () =>
        starter.available === "manual" ? new Promise((resolve) => answers.push(resolve)) : Promise.resolve(starter.available),
      start: () => {
        started++
        return Promise.resolve()
      },
    }
    panel.starter = fake
  }
  return { panel, started: () => started, answer: (i: number, value: boolean) => answers[i]?.(value) }
}

it("tells a new page whether it can start a session (Offered)", async () => {
  const { panel } = setup({ available: true })
  const view = open(panel)
  view.send({ type: "ready" })
  await Promise.resolve()
  expect(view.posted).toContainEqual({ type: "canStart", value: true })
})

it("tells the page nothing without a starter, so the button stays hidden (ClicksNeedButton)", async () => {
  const { panel } = setup()
  const view = open(panel)
  view.send({ type: "ready" })
  await Promise.resolve()
  expect(view.posted.some((m) => "type" in m && m.type === "canStart")).toBe(false)
})

it("runs the starter once per start from the page (RunsAreClicks)", () => {
  const { panel, started } = setup({ available: true })
  const view = open(panel)
  view.send({ type: "start" })
  view.send({ type: "start" })
  expect(started()).toBe(2)
})

it("asks again after Set Up Agent, so the button appears without a reload (Reasked)", async () => {
  const { panel } = setup({ available: true })
  const view = open(panel)
  view.send({ type: "ready" })
  await Promise.resolve()
  panel.askStart()
  await Promise.resolve()
  expect(view.posted.filter((m) => "type" in m && m.type === "canStart")).toHaveLength(2)
})

it("drops the answer of a page replaced before it landed, so it cannot set its successor's button (OwnAnswer)", async () => {
  const { panel, answer } = setup({ available: "manual" })
  const view = open(panel)
  view.send({ type: "ready" })
  view.send({ type: "ready" })
  answer(0, true)
  await Promise.resolve()
  expect(view.posted.some((m) => "type" in m && m.type === "canStart")).toBe(false)
  answer(1, false)
  await Promise.resolve()
  expect(view.posted).toContainEqual({ type: "canStart", value: false })
})
