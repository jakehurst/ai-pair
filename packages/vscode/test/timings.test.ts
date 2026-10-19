// The extension's delays in one place, a set for real use and one for a test (#176). Solitary: the module has no
// collaborators.

import { afterEach, expect, it } from 'vitest';
import { DEFAULT_TIMINGS, setTimings, TEST_TIMINGS, timings, type Timings } from '../src/timings';

/** Every delay's name. */
const NAMES: ReadonlyArray<keyof Timings> = [
  'saveMs',
  'groupMs',
  'selfNavMs',
  'pulseMs',
  'scrollQuietMs',
  'scrollMaxMs',
  'frameMs',
  'shellIntegrationMs',
  'drainMs',
  'tipDelayMs',
  'tipWarmMs',
];

afterEach(() => {
  setTimings(DEFAULT_TIMINGS);
});

it("starts with the real delays, every one a positive number of milliseconds, and the test's are no longer", () => {
  expect(timings).toEqual(DEFAULT_TIMINGS);
  expect(Object.keys(DEFAULT_TIMINGS).toSorted()).toEqual([...NAMES].toSorted());
  for (const name of NAMES) {
    expect(DEFAULT_TIMINGS[name], name).toBeGreaterThan(0);
    expect(TEST_TIMINGS[name], name).toBeLessThanOrEqual(DEFAULT_TIMINGS[name]);
  }
});

it('sets the delays given, leaving the others as they were', () => {
  setTimings(TEST_TIMINGS);
  expect(timings).toEqual(TEST_TIMINGS);
  setTimings({ selfNavMs: 0 });
  expect(timings).toEqual({ ...TEST_TIMINGS, selfNavMs: 0 });
});
