// A command whose batch was interrupted before it started isn't started, and says so at once.

import { expect, it, vi } from "vitest"

const none = { dispose: () => {} }
vi.mock("vscode", () => ({
  ThemeIcon: class {
    constructor(readonly id: string) {}
  },
  window: {
    onDidCloseTerminal: () => none,
    onDidChangeTerminalShellIntegration: () => none,
    createTerminal: () => ({ show: () => {}, sendText: () => {} }),
  },
}))

const { PairTerminals } = await import("../src/terminal")

it("doesn't wait for shell integration once playback is interrupted", async () => {
  vi.useFakeTimers()
  const interrupted = AbortSignal.abort()
  let outcome
  void new PairTerminals().run("npm test", { cwd: "/", waitMs: 1000, signal: interrupted }).then((o) => (outcome = o))
  await vi.advanceTimersByTimeAsync(0)
  expect(outcome).toEqual({ output: "", notStarted: true })
  vi.useRealTimers()
})
