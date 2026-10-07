// A `run` command's output and outcome, from terminal.ts, without VS Code (#7).

import { describe, expect, it } from "vitest"
import { MAX_OUTPUT, outcomeOf, Tail } from "../src/output"

describe("Tail", () => {
  it("keeps the last characters of a stream, and says when it dropped some", () => {
    const kept = new Tail(5)
    kept.push("abc")
    expect([kept.text, kept.dropped]).toEqual(["abc", false])
    kept.push("defg")
    expect([kept.text, kept.dropped]).toEqual(["cdefg", true])
  })
})

/** A command's output as the terminal keeps it. */
function tail(text: string): Tail {
  const t = new Tail(MAX_OUTPUT * 4)
  t.push(text)
  return t
}

describe("outcomeOf", () => {
  const ended = Promise.resolve()

  it("gives a finished command's output as text, its shell, and its exit code", () => {
    const outcome = outcomeOf(tail("\x1b[32mok\x1b[0m\r\n"), { shell: "zsh", finished: true, exitCode: () => 0, ended })
    expect(outcome).toEqual({ output: "ok", shell: "zsh", exitCode: 0 })
  })

  it("keeps the last MAX_OUTPUT characters, marked as cut", () => {
    const outcome = outcomeOf(tail("x".repeat(MAX_OUTPUT + 10)), { shell: undefined, finished: true, exitCode: () => 1, ended })
    expect([outcome.output.length, outcome.truncated, outcome.exitCode]).toEqual([MAX_OUTPUT, true, 1])
  })

  it("says a command is still running, and reads its exit code once it ends", async () => {
    let exitCode: number | undefined
    let end!: () => void
    const running = outcomeOf(tail("serving"), {
      shell: undefined,
      finished: false,
      exitCode: () => exitCode,
      ended: new Promise((r) => (end = r)),
    })
    expect(running).toMatchObject({ output: "serving", running: true })
    expect(running.exitCode).toBeUndefined()
    exitCode = 143
    end()
    expect(await running.exited).toBe(143)
  })
})
