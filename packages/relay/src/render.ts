// What the agent reads: reports and files as text, with code as numbered lines instead of JSON
// strings full of escapes. See "Reports" in PROTOCOL.md.

import type { BatchError, BatchResult, Code, Event, Excerpt, FileContent, Report, RunResult } from "@ai-pair/protocol"
import { ELLIPSIS, RANGE_DASH } from "@ai-pair/core/constants"

export type ReportingTool = "start" | "step" | "listen" | "end" | "calibrate"

export function renderReport(report: Report, tool: ReportingTool): string {
  const sections: string[] = []
  if (tool === "start") {
    sections.push(
      report.resumed
        ? "The session has resumed: the programmer's window kept it while you were away, with its turn, your cursor, and its history. Read the files you were working in again before you give a line number: the programmer may have edited them meanwhile."
        : "The session has started.",
    )
  }
  if (tool === "calibrate") {
    sections.push(
      "The calibration is under way in the Pair panel: playback is held while the programmer reads the passage. Call `listen`; their next message comes once it ends.",
    )
  }
  if (report.repeated) {
    sections.push("Part of this report may repeat an earlier one: a call you canceled had already returned. Skip what you've already seen.")
  }
  for (const e of report.events) sections.push(renderEvent(e))
  for (const b of report.batches) sections.push(renderBatch(b))
  if (report.submitted) sections.push(`Batch ${report.submitted.id} is ${report.submitted.status}.`)
  if (report.rejected) sections.push(renderRejected(report.rejected))
  if (report.cursor) sections.push(`Your cursor, in ${report.cursor.file}:\n${renderCode(report.cursor)}`)
  if (report.waiting) {
    sections.push(tool === "listen" ? "Nothing has happened yet. Call `listen` again." : "Nothing has finished yet. Carry on as usual.")
  }
  const ended = report.events.some((e) => e.kind === "end")
  if (tool === "end" && !ended) sections.push("The session has ended.")
  else if (report.turn === "user" && !ended) {
    sections.push("It's the programmer's turn: you're the navigator. Only `say` and `point` work, and `listen` follows along.")
  }
  return sections.length > 0 ? sections.join("\n\n") : "Nothing to report."
}

export function renderFile(content: FileContent): string {
  const header = content.dirty ? `${content.file} (with unsaved changes in the editor):` : `${content.file}:`
  if (content.lines.length === 0 && !content.end) return `${header} no lines in this range.`
  return `${header}\n${renderLines(content.lines, endNote(content.end))}`
}

function renderEvent(e: Event): string {
  switch (e.kind) {
    case "message":
      return `The programmer said:\n${quote(e.text)}${e.selection ? `\n${renderExcerpt(e.selection)}` : ""}`
    case "edit":
      if (e.diff === "") {
        const who = e.by === "other" ? "A tool, a formatter, or something on disk" : "The programmer"
        return `${who} edited ${e.file}, then changed it back: no net change.`
      }
      if (e.by === "other") return `${e.file} was changed, not by the programmer but by a tool, a formatter, or on disk:\n${e.diff}`
      return `The programmer edited ${e.file}:\n${e.diff}`
    case "interrupt":
      return "The programmer pressed Interrupt."
    case "turn":
      if (e.to === "user") return "The programmer took the turn."
      return `The programmer handed the turn back to you${e.message ? `:\n${quote(e.message)}` : "."}${e.selection ? `\n${renderExcerpt(e.selection)}` : ""}`
    case "end":
      return "The programmer ended the session. This is the final report: stop using the pair tools."
    default:
      throw new Error(`Unknown event: ${JSON.stringify(e satisfies never)}`)
  }
}

function renderBatch(b: BatchResult): string {
  const parts = [b.code ? `Batch ${b.id} ${b.status}, in ${b.code.file}:` : `Batch ${b.id} ${b.status}.`]
  if (b.code) parts.push(renderCode(b.code))
  for (const run of b.runs ?? []) parts.push(renderRun(run))
  for (const u of b.unsaved ?? []) {
    parts.push(
      `Couldn't save ${u.file} (${u.error}): the editor has your edits, the file on disk doesn't, so commands and your file tools see the old file. Ask the programmer to resolve it in the editor, which offers to compare or overwrite.`,
    )
  }
  if (b.error) parts.push(renderError(b.error))
  if (b.unplayed) {
    const label = b.error && b.error.kind !== "command_failed" ? "Not played, starting with the one that failed:" : "Not played:"
    parts.push([label, ...b.unplayed.map((a) => `  ${JSON.stringify(a)}`)].join("\n"))
  }
  return parts.join("\n")
}

function renderRejected(r: NonNullable<Report["rejected"]>): string {
  const parts = [`Your batch was rejected: its action ${r.index} would fail:`, `  ${JSON.stringify(r.action)}`, renderError(r.error)]
  if (r.code) parts.push(`The code would read then, in ${r.code.file}:\n${renderCode(r.code)}`)
  parts.push("Nothing of it was queued. Fix it and submit the whole batch again.")
  return parts.join("\n")
}

function renderError(error: BatchError): string {
  const candidates = (error.candidates ?? []).map((c) => `\n  line ${c.line}: ${c.context}`).join("")
  return `${error.kind}: ${error.message}${candidates}`
}

function renderRun(run: RunResult): string {
  const outcome =
    run.exit_code !== undefined ? `exited with ${run.exit_code}` : run.running ? "still running in its terminal" : "exit code unknown"
  const shell = run.shell ? ` in ${run.shell}` : ""
  if (run.output === "") return `Ran \`${run.command}\`${shell}: ${outcome}, no output.`
  const fence = "`".repeat(Math.max(3, longestRun(run.output, "`") + 1))
  return `Ran \`${run.command}\`${shell}: ${outcome}. Output${run.truncated ? ", its end" : ""}:\n${fence}\n${run.output}\n${fence}`
}

function renderExcerpt(x: Excerpt): string {
  const lines = x.text.split(/\r?\n/).map((text, i) => ({ number: x.from.line + i, text }))
  const where = x.from.line === x.to.line ? `line ${x.from.line}` : `lines ${x.from.line}${RANGE_DASH}${x.to.line}`
  const cut = x.truncated ? "\n(cut off here; `read` the rest)" : ""
  return `About the code they had selected, ${x.file} ${where}:\n${renderLines(lines)}${cut}`
}

/** A report's code, and where it reaches the end of the file, whether the file ends with a newline. */
function renderCode(code: Code): string {
  return renderLines(code.lines, endNote(code.end))
}

function endNote(end: Code["end"]): string | undefined {
  if (!end) return undefined
  return end.final_newline ? "(end of file)" : "(end of file, with no newline after the last line)"
}

/** Numbered lines; a gap in the numbers is shown as `ELLIPSIS`. A `note` goes below them, aligned with the text. */
function renderLines(lines: Code["lines"], note?: string): string {
  const width = String(lines.at(-1)?.number ?? 0).length
  const out: string[] = []
  let previous: number | undefined
  for (const { number, text } of lines) {
    if (previous !== undefined && number > previous + 1) out.push(`${" ".repeat(width)}  ${ELLIPSIS}`)
    out.push(`${String(number).padStart(width)}  ${text}`.trimEnd())
    previous = number
  }
  if (note) out.push(`${" ".repeat(width)}  ${note}`)
  return out.join("\n")
}

function quote(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => `> ${line}`.trimEnd())
    .join("\n")
}

function longestRun(text: string, ch: string): number {
  let longest = 0
  let current = 0
  for (const c of text) {
    current = c === ch ? current + 1 : 0
    longest = Math.max(longest, current)
  }
  return longest
}
