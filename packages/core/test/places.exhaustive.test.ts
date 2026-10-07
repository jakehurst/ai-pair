// resolveSpot and resolveSpan over every small text: the properties specs/Places.tla checks on its
// model, here on the code itself.

import { expect, it } from "vitest"
import { resolveSpan, resolveSpot } from "../src/places"
import { position } from "../src/text"

const CHARS = ["x", "y", "\n"]
const M = "\u{258c}"

function strings(max: number): string[] {
  const all = [""]
  for (let n = 1; n <= max; n++) for (const t of all.filter((s) => s.length === n - 1)) for (const c of CHARS) all.push(t + c)
  return all
}

function starts(text: string, needle: string): number[] {
  const out: number[] = []
  if (needle === "") return out
  for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + 1)) out.push(i)
  return out
}

const lineOf = (text: string, offset: number) => position(text, offset).line
const lineCount = (text: string) => text.split("\n").length

it("resolves a spot only when one match has its marker on the line, and puts it there", () => {
  for (const text of strings(5)) {
    for (const before of strings(3)) {
      for (const after of strings(3 - before.length)) {
        const marks = starts(text, before + after).map((s) => s + before.length)
        for (let line = 1; line <= lineCount(text); line++) {
          const r = resolveSpot(text, { at: before + M + after, line })
          const here = marks.filter((o) => lineOf(text, o) === line)
          const at = `${JSON.stringify(text)} ${JSON.stringify(before + M + after)} line ${line}`
          expect(r.ok, at).toBe(here.length === 1)
          if (r.ok) {
            expect(r.range.start, at).toBe(here[0])
            expect(text.slice(r.range.start - before.length, r.range.start + after.length), at).toBe(before + after)
          }
        }
      }
    }
  }
})

it("resolves a span only when its text starts once on the line, and a range to the first `through` after it", () => {
  for (const text of strings(5)) {
    for (const find of strings(3)) {
      const found = starts(text, find)
      for (let line = 1; line <= lineCount(text) + 1; line++) {
        const here = found.filter((o) => lineOf(text, o) === line)
        const r = resolveSpan(text, { line, text: find })
        const at = `${JSON.stringify(text)} ${JSON.stringify(find)} line ${line}`
        expect(r.ok, at).toBe(here.length === 1)
        if (r.ok) expect(r.range, at).toEqual({ start: here[0], end: here[0]! + find.length })
        for (const through of strings(2)) {
          const range = resolveSpan(text, { line, from: find, through })
          if (!range.ok) continue
          const s = here[0]!
          const e = range.range.end - through.length
          expect(range.range.start, at).toBe(s)
          expect(through === "" ? -1 : text.indexOf(through, s + find.length), `${at} through ${JSON.stringify(through)}`).toBe(e)
        }
      }
    }
  }
})
