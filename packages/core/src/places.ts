// Finding the code actions name: a spot for `move`, a span for `select` and `point`, each by its
// text on a given line. See "Places" in PROTOCOL.md.

import { CURSOR_MARKER, type Candidate, type ErrorKind } from "@ai-pair/protocol"
import { lineSpan, lineText, position } from "./text"

export type Range = { start: number; end: number }

export type Resolution = { ok: true; range: Range } | { ok: false; kind: ErrorKind; message: string; candidates?: Candidate[] }

/** A span on `line`: `text`, or from `from` through the first `through` after it. */
export type Span = { line: number; text?: string; from?: string; through?: string }

const MAX_CANDIDATES = 20

function findAll(text: string, needle: string): number[] {
  const starts: number[] = []
  if (needle === "") return starts
  for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + 1)) {
    starts.push(i)
  }
  return starts
}

function candidates(text: string, starts: number[]): Candidate[] {
  return starts.slice(0, MAX_CANDIDATES).map((start) => {
    const { line } = position(text, start)
    return { line, context: lineText(text, line).trim() }
  })
}

/** Text copied from a report's code may carry the cursor marker. */
function unmarked(text: string): string {
  return text.replaceAll(CURSOR_MARKER, "")
}

/** Where a spot's text occurs: its whole text, and the offsets of its marker in each match. */
function findSpot(text: string, at: string): { whole: string; found: number[] } {
  const marker = at.indexOf(CURSOR_MARKER)
  const before = at.slice(0, marker)
  const whole = before + at.slice(marker + CURSOR_MARKER.length)
  return { whole, found: findAll(text, whole).map((start) => start + before.length) }
}

/** The lines a spot's text is on, anywhere in `text`. */
export function spotCandidates(text: string, at: string): Candidate[] {
  return candidates(text, findSpot(text, at).found)
}

/** The lines a span's text starts on, anywhere in `text`. */
export function spanCandidates(text: string, find: string): Candidate[] {
  return candidates(text, findAll(text, unmarked(find)))
}

/**
 * Finds `needle` on `line`, exactly: a match elsewhere doesn't count, and is only listed, to show
 * where the text is. `found`: where each match is, anywhere; `what`: what's looked for, to say so.
 */
function onLine(text: string, line: number, needle: string, found: number[], what: string): (Resolution & { ok: false }) | number {
  // The line's offsets once, not a scan from the start of the text for each match (#2).
  const span = lineSpan(text, line)
  const here = span ? found.filter((at) => at >= span.start && at <= span.end) : []
  if (here.length === 1) return here[0]!
  if (here.length > 1) {
    return {
      ok: false,
      kind: "ambiguous",
      message: `${JSON.stringify(needle)} occurs ${here.length} times on line ${line}; give more of the text around ${what}, to be unique on its line`,
    }
  }
  const reads = `line ${line} reads ${JSON.stringify(lineText(text, line))}`
  if (found.length === 0) return { ok: false, kind: "not_found", message: `Text not found: ${JSON.stringify(needle)}; ${reads}` }
  return {
    ok: false,
    kind: "not_found",
    message: `${what[0]!.toUpperCase()}${what.slice(1)} isn't on line ${line}: ${reads}. It's on these lines:`,
    candidates: candidates(text, found),
  }
}

/** Resolves a spot: where the cursor marker is in `at`, found by the text around it, on `line`. */
export function resolveSpot(text: string, spot: { at: string; line: number }): Resolution {
  const { whole, found } = findSpot(text, spot.at)
  const at = onLine(text, spot.line, whole, found, "the spot")
  return typeof at === "number" ? { ok: true, range: { start: at, end: at } } : at
}

/**
 * Resolves a span: its `text`, or `from`, starting on `line`; a range ends with the first
 * `through` after `from`.
 */
export function resolveSpan(text: string, span: Span): Resolution {
  const first = unmarked(span.text ?? span.from ?? "")
  const start = onLine(text, span.line, first, findAll(text, first), "the text")
  if (typeof start !== "number") return start
  if (span.from === undefined) return { ok: true, range: { start, end: start + first.length } }
  const through = unmarked(span.through ?? "")
  const end = through === "" ? -1 : text.indexOf(through, start + first.length)
  if (end === -1) return { ok: false, kind: "not_found", message: `Text not found after \`from\`: ${JSON.stringify(through)}` }
  return { ok: true, range: { start, end: end + through.length } }
}
