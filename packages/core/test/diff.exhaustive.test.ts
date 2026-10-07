// lineChanges over every small text and change: the changes it splits a change into leave the
// same text, in the order they apply (#65).
import { describe, expect, it } from "vitest"
import { lineChanges } from "../src/diff"
import type { Change } from "../src/ports"

/** Every case, on CI's slower runners alongside the other test files. */
const EXHAUSTIVE_MS = 30_000

const chars = ["a", "b", "\n"]
function texts(max: number): string[] {
  const all = [""]
  for (let n = 1, layer = [""]; n <= max; n++) {
    layer = layer.flatMap((t) => chars.map((c) => t + c))
    all.push(...layer)
  }
  return all
}

const apply = (text: string, c: Change) => text.slice(0, c.offset) + c.text + text.slice(c.offset + c.deleteLength)

describe("lineChanges", () => {
  it(
    "leaves the same text as the change it splits",
    () => {
      const inserts = texts(3)
      let cases = 0
      for (const before of texts(4)) {
        for (let offset = 0; offset <= before.length; offset++) {
          for (let deleteLength = 0; offset + deleteLength <= before.length; deleteLength++) {
            for (const text of inserts) {
              const change = { offset, deleteLength, text }
              const split = lineChanges(before, [change])
              expect(split.reduce(apply, before)).toBe(apply(before, change))
              // Each one changes something.
              for (const c of split) expect(c.deleteLength > 0 || c.text !== "").toBe(true)
              cases++
            }
          }
        }
      }
      expect(cases).toBeGreaterThan(50_000)
    },
    EXHAUSTIVE_MS,
  )

  it("splits a reload into one change per run of changed lines", () => {
    expect(lineChanges("1\n2\n3\n4\n5\n6\n", [{ offset: 2, deleteLength: 8, text: "X\n3\n4\nY\n" }])).toEqual([
      { offset: 2, deleteLength: 2, text: "X\n" },
      { offset: 8, deleteLength: 2, text: "Y\n" },
    ])
  })

  it("applies several changes in order, each to the result of the one before", () => {
    const before = "a\nb\nc\n"
    const changes = [
      { offset: 4, deleteLength: 2, text: "C\n" },
      { offset: 0, deleteLength: 2, text: "A\n" },
    ]
    expect(lineChanges(before, changes).reduce(apply, before)).toBe(changes.reduce(apply, before))
  })
})
