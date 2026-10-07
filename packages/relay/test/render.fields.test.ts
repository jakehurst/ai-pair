// Every field of a Report appears in its rendered text (Render in #19): each field below holds a
// value of its own, and the text must contain each one.

import { expect, it } from "vitest"
import type { Report } from "@ai-pair/protocol"
import { renderReport } from "../src/render"

const code = (file: string, n: number) => ({ file, lines: [{ number: n, text: `code-${n}` }], end: { final_newline: false } })

it("renders every field of a report", () => {
  const report: Report = {
    batches: [
      {
        id: 101,
        status: "failed",
        code: code("batch.ts", 11),
        error: { kind: "not_found", message: "error-message-1", candidates: [{ line: 12, context: "candidate-1" }] },
        unplayed: [{ say: "unplayed-1" }],
        runs: [{ command: "command-1", exit_code: 13, output: "output-1", truncated: true, shell: "shell-1" }],
        unsaved: [{ file: "unsaved.ts", error: "unsaved-error-1" }],
      },
      { id: 102, status: "interrupted", runs: [{ command: "command-2", output: "", running: true }] },
    ],
    submitted: { id: 103, status: "queued" },
    rejected: {
      index: 4,
      action: { say: "rejected-action" },
      error: { kind: "no_line", message: "rejected-message" },
      code: code("rejected.ts", 14),
    },
    events: [
      {
        kind: "message",
        text: "message-1",
        selection: { file: "sel.ts", from: { line: 15, column: 1 }, to: { line: 15, column: 3 }, text: "excerpt-1", truncated: true },
      },
      { kind: "edit", file: "edited.ts", diff: "diff-1", by: "programmer" },
      { kind: "edit", file: "other.ts", diff: "diff-2", by: "other" },
      { kind: "interrupt" },
      { kind: "turn", to: "agent", message: "handback-1" },
    ],
    turn: "user",
    cursor: code("cursor.ts", 16),
    waiting: true,
  }
  const text = renderReport(report, "listen")
  for (const value of [
    "Batch 101 failed",
    "batch.ts",
    "code-11",
    "not_found",
    "error-message-1",
    "line 12: candidate-1",
    "unplayed-1",
    "command-1",
    "exited with 13",
    "output-1",
    "its end",
    "shell-1",
    "unsaved.ts",
    "unsaved-error-1",
    "Batch 102 interrupted",
    "command-2",
    "still running",
    "Batch 103 is queued",
    "action 4",
    "rejected-action",
    "no_line",
    "rejected-message",
    "rejected.ts",
    "code-14",
    "message-1",
    "sel.ts",
    "line 15",
    "excerpt-1",
    "cut off here",
    "edited.ts",
    "diff-1",
    "The programmer edited",
    "other.ts",
    "diff-2",
    "not by the programmer",
    "pressed Interrupt",
    "handback-1",
    "programmer's turn",
    "cursor.ts",
    "code-16",
    "Call `listen` again",
  ]) {
    expect(text, value).toContain(value)
  }
})
