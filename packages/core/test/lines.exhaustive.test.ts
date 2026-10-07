// applyChange over every small text and change: the same properties specs/LineIdentity.tla checks
// on its model, here on the code itself.

import { expect, it } from "vitest"
import { applyChange } from "../src/lines"

/** Every case, on CI's slower runners alongside the other test files. */
const EXHAUSTIVE_MS = 30_000

const CHARS = ["x", "\n", "\r"]

function texts(max: number): string[] {
  const all = [""]
  for (let n = 1; n <= max; n++) for (const t of all.filter((s) => s.length === n - 1)) for (const c of CHARS) all.push(t + c)
  return all
}

const lineCount = (t: string) => t.split("\n").length

it(
  "gives each line of the result one identity, never one twice, and keeps the untouched lines'",
  () => {
    let cases = 0
    for (const text of texts(5)) {
      const ids = Array.from({ length: lineCount(text) }, (_, i) => -(i + 1))
      for (let offset = 0; offset <= text.length; offset++) {
        for (let deleteLength = 0; offset + deleteLength <= text.length; deleteLength++) {
          for (const insert of texts(2)) {
            cases++
            const after = applyChange({ text, ids }, { offset, deleteLength, text: insert })
            const at = `${JSON.stringify(text)} @${offset} -${deleteLength} +${JSON.stringify(insert)}`
            expect(after.text, at).toBe(text.slice(0, offset) + insert + text.slice(offset + deleteLength))
            expect(after.ids.length, at).toBe(lineCount(after.text))
            expect(new Set(after.ids).size, at).toBe(after.ids.length)
            const a = text.slice(0, offset).split("\n").length - 1
            const b = a + (text.slice(offset, offset + deleteLength).split("\n").length - 1)
            const shift = insert.split("\n").length - 1 - (b - a)
            for (let i = 0; i < a; i++) expect(after.ids[i], at).toBe(ids[i])
            for (let i = b + 1; i < ids.length; i++) expect(after.ids[i + shift], at).toBe(ids[i])
            if (a === b && !insert.includes("\n")) expect(after.ids, at).toEqual(ids)
            // A line break at the end of a line with text leaves it in place; at its start, it moves it down.
            if (deleteLength === 0 && insert === "\n") {
              const atEnd = offset > 0 && text[offset - 1] === "x" && (offset === text.length || text[offset] === "\n")
              const atStart = (offset === 0 || text[offset - 1] === "\n") && text[offset] === "x"
              if (atEnd) expect(after.ids[a], at).toBe(ids[a])
              if (atStart) expect(after.ids[a + 1], at).toBe(ids[a])
            }
          }
        }
      }
    }
    expect(cases).toBeGreaterThan(10_000)
  },
  EXHAUSTIVE_MS,
)
