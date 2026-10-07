// planTyping over every small text: the properties specs/Typing.tla checks on its model, here on
// the code itself.

import { expect, it } from "vitest"
import { testConfig } from "./fake"
import { planTyping } from "../src/typing"

/** Every case, on CI's slower runners alongside the other test files. */
const EXHAUSTIVE_MS = 30_000

const CHARS = ["x", " ", "\t", "\n", "("]

it("splits text into chunks that concatenate to it, each one character or a line break with its indentation", () => {
  let texts = [""]
  for (let n = 1; n <= 5; n++) texts = [...texts, ...texts.filter((t) => t.length === n - 1).flatMap((t) => CHARS.map((c) => t + c))]
  for (const text of texts) {
    for (const atLineStart of [false, true]) {
      const chunks = planTyping(text, testConfig.timing.type, atLineStart, () => 0.5)
      const at = `${JSON.stringify(text)} at line start: ${atLineStart}`
      expect(chunks.map((c) => c.text).join(""), at).toBe(text)
      chunks.forEach((c, i) => {
        const unit = c.text.length === 1 && c.text !== "\n"
        const lineBreak = /^\n[ \t]*$/.test(c.text)
        const leading = i === 0 && atLineStart && /^[ \t]+$/.test(c.text)
        expect(unit || lineBreak || leading, `${at}: chunk ${i} ${JSON.stringify(c.text)}`).toBe(true)
        expect(c.delay, at).toBeGreaterThanOrEqual(0)
      })
    }
  }
}, EXHAUSTIVE_MS)
