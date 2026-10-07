// A `run` command's output and what the agent is told about it, from terminal.ts, without VS Code,
// so it can be tested on its own (#7).

import { terminalText, type CommandOutcome } from "@ai-pair/core"

/** Output kept for the agent: the tail, where the result and the errors are. */
export const MAX_OUTPUT = 12_000

/** Keeps the last `max` characters of a stream. */
export class Tail {
  text = ""
  dropped = false
  constructor(private readonly max: number) {}
  push(data: string): void {
    this.text += data
    if (this.text.length > this.max) {
      this.text = this.text.slice(-this.max)
      this.dropped = true
    }
  }
}

/**
 * What the agent is told about a command: the tail of its output, as text, and either how it ended
 * (`finished`), or that it is still running, with its exit code once `ended` (which `exitCode` reads
 * then).
 */
export function outcomeOf(
  output: Tail,
  run: { shell: string | undefined; finished: boolean; exitCode: () => number | undefined; ended: Promise<void> },
): CommandOutcome {
  const text = terminalText(output.text)
  const outcome: CommandOutcome = { output: text.length > MAX_OUTPUT ? text.slice(-MAX_OUTPUT) : text }
  if (run.shell) outcome.shell = run.shell
  if (output.dropped || text.length > MAX_OUTPUT) outcome.truncated = true
  if (run.finished) {
    const exitCode = run.exitCode()
    if (exitCode !== undefined) outcome.exitCode = exitCode
  } else {
    outcome.running = true
    outcome.exited = run.ended.then(() => run.exitCode())
  }
  return outcome
}
