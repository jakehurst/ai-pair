// Timing overrides come from the programmer's settings.json, unchecked by VS Code: one that isn't a
// number of zero or more keeps the default, so pacing doesn't silently turn off (#17).

import { expect, it } from 'vitest';
import { defaultTiming, glideDuration, withOverrides, type TimingOverrides } from '../src/timing';

/** Returns `value` as the settings: they are JSON, so anything can be there, whatever their type says. */
function settings(value: unknown): TimingOverrides {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return value as TimingOverrides;
}

it('takes overrides that are numbers of zero or more, at either level', () => {
  const timing = withOverrides(defaultTiming, { afterSelectMs: 0, type: { charMs: 80 }, reading: { minMs: 4000 } });
  expect([timing.afterSelectMs, timing.type.charMs, timing.reading.minMs]).toEqual([0, 80, 4000]);
  expect(timing.type.newlineMs).toBe(defaultTiming.type.newlineMs);
});

it('keeps the default for a string, a negative number, NaN, or Infinity', () => {
  const timing = withOverrides(
    defaultTiming,
    settings({ afterSelectMs: 'long', afterDeleteMs: -1, afterPointMs: Number.NaN, type: { charMs: Infinity }, reading: 'fast' }),
  );
  expect(timing).toEqual(defaultTiming);
});

it("keeps the defaults for a setting that isn't an object", () => {
  expect(withOverrides(defaultTiming, settings('fast'))).toEqual(defaultTiming);
  expect(withOverrides(defaultTiming, settings(null))).toEqual(defaultTiming);
});

it("ignores keys that aren't timings", () => {
  expect(withOverrides(defaultTiming, settings({ color: 3 }))).toEqual(defaultTiming);
});

it('glides longer the farther it goes, up to the cap', () => {
  const near = defaultTiming.nearLines;
  const far = defaultTiming.glideMaxMs / defaultTiming.glidePerLineMs;
  expect(glideDuration(defaultTiming, /* lines= */ 0, /* speed= */ 1)).toBe(defaultTiming.glideMs);
  expect(glideDuration(defaultTiming, near, /* speed= */ 1)).toBe(defaultTiming.glideMs + near * defaultTiming.glidePerLineMs);
  expect(glideDuration(defaultTiming, 2 * far, /* speed= */ 1)).toBe(defaultTiming.glideMaxMs);
});

it('divides the glide by the speed', () => {
  const speed = 2;
  for (const lines of [0, defaultTiming.nearLines, defaultTiming.glideMaxMs]) {
    expect(glideDuration(defaultTiming, lines, speed)).toBe(glideDuration(defaultTiming, lines, /* speed= */ 1) / speed);
  }
});
