// Timing overrides come from the programmer's settings.json, unchecked by VS Code: one that isn't a
// number of zero or more keeps the default, so pacing doesn't silently turn off (#17).

import { expect, it } from "vitest"
import { defaultTiming, withOverrides, type TimingOverrides } from "../src/timing"

// The settings are JSON: anything can be there, whatever their type says.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const settings = (value: unknown) => value as TimingOverrides

it("takes overrides that are numbers of zero or more, at either level", () => {
  const timing = withOverrides(defaultTiming, { afterSelectMs: 0, type: { charMs: 80 }, reading: { minMs: 4000 } })
  expect([timing.afterSelectMs, timing.type.charMs, timing.reading.minMs]).toEqual([0, 80, 4000])
  expect(timing.type.newlineMs).toBe(defaultTiming.type.newlineMs)
})

it("keeps the default for a string, a negative number, NaN, or Infinity", () => {
  const timing = withOverrides(
    defaultTiming,
    settings({ afterSelectMs: "long", afterDeleteMs: -1, afterPointMs: Number.NaN, type: { charMs: Infinity }, reading: "fast" }),
  )
  expect(timing).toEqual(defaultTiming)
})

it("keeps the defaults for a setting that isn't an object", () => {
  expect(withOverrides(defaultTiming, settings("fast"))).toEqual(defaultTiming)
  expect(withOverrides(defaultTiming, settings(null))).toEqual(defaultTiming)
})

it("ignores keys that aren't timings", () => {
  expect(withOverrides(defaultTiming, settings({ color: 3 }))).toEqual(defaultTiming)
})
