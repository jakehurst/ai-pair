// The reply box's draft pauses playback, and the pause goes with the draft when the view's page
// does: disposed or reloaded (#69, specs/Draft.tla).

import { expect, it, vi } from "vitest"
import { Controller } from "@ai-pair/core"
import { FakeEditor, FakePanel, testConfig } from "../../core/test/fake"
import { NarrationPanel } from "../src/panel"

vi.mock("vscode", () => ({ commands: { executeCommand: () => Promise.resolve() } }))

/** A view, standing in for VS Code's WebviewView: what its page sends, and its disposal. */
function open(panel: NarrationPanel) {
  let receive: ((m: object) => void) | undefined
  let dispose: (() => void) | undefined
  const view = {
    webview: {
      options: {},
      html: "",
      cspSource: "",
      postMessage: () => Promise.resolve(true),
      onDidReceiveMessage: (f: (m: object) => void) => (receive = f),
    },
    onDidDispose: (f: () => void) => (dispose = f),
    show: () => {},
  }
  // Only what NarrationPanel uses.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  panel.resolveWebviewView(view as never)
  receive?.({ type: "ready" })
  return { send: (m: object) => receive?.(m), dispose: () => dispose?.() }
}

function setup() {
  const controller = new Controller(new FakeEditor(), new FakePanel(), testConfig)
  const panel = new NarrationPanel(
    (f) => f,
    { get: () => 1, set: () => {} },
    { get: () => 1, set: () => {} },
    { current: () => undefined, ref: () => undefined },
  )
  panel.controller = controller
  return { controller, panel }
}

it("ends the draft's pause when the view is disposed with it", () => {
  const { controller, panel } = setup()
  const view = open(panel)
  view.send({ type: "draft", empty: false })
  expect(controller.isPaused).toBe(true)
  view.dispose()
  expect(controller.isPaused).toBe(false)
})

it("ends the draft's pause when the view's page reloads, keeping a pause the programmer asked for", () => {
  const { controller, panel } = setup()
  const view = open(panel)
  view.send({ type: "draft", empty: false })
  view.send({ type: "ready" })
  expect(controller.isPaused).toBe(false)
  view.send({ type: "pause" })
  view.send({ type: "draft", empty: false })
  view.send({ type: "ready" })
  expect(controller.isPaused).toBe(true)
})
