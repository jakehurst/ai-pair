// Finding text on a line costs time in proportion to the file, not to the file times its matches
// (#2): a short needle on every line of a long file.

import { expect, it } from "vitest"
import { resolveSpan, resolveSpot } from "../src/places"

const LINES = 20_000
const text = "  foo(bar(baz(1), 2), 3);\n".repeat(LINES)

it("resolves a span and a spot on the last line of a long file at once, though every line matches", () => {
  const started = performance.now()
  expect(resolveSpan(text, { line: LINES, text: "foo(" })).toMatchObject({ ok: true })
  expect(resolveSpot(text, { line: LINES, at: "3);\u{258c}" })).toMatchObject({ ok: true })
  expect(resolveSpan(text, { line: LINES, text: ")" })).toMatchObject({ ok: false, kind: "ambiguous" })
  // Before #2's fix, one of these took 5.5 s at this size; after it, a few milliseconds.
  expect(performance.now() - started).toBeLessThan(1000)
})
