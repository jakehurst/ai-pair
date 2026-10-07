// The speed setting, unchecked by VS Code in settings.json: a number outside its declared range is
// clamped to it, and anything else plays at 1 (#17).

import { expect, it } from "vitest"
import { settingSpeed } from "../src/panelHtml"

it("clamps a number to the range the setting declares, zero and below included", () => {
  expect([-1, 0, 0.1, 0.25, 1.5, 4, 9].map(settingSpeed)).toEqual([0.25, 0.25, 0.25, 0.25, 1.5, 4, 4])
})

it("plays at 1 for NaN, Infinity, or what isn't a number", () => {
  expect([Number.NaN, Infinity, "fast", undefined].map(settingSpeed)).toEqual([1, 1, 1, 1])
})
