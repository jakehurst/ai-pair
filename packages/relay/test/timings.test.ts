// The relay's delays, selected by the environment (#176). Solitary: the module reads only `process.env`.

import { afterEach, expect, it, vi } from 'vitest';
import {
  DEFAULT_RELAY_TIMINGS,
  RELAY_TIMINGS,
  relayTimings,
  TEST_RELAY_TIMINGS,
  TEST_TIMINGS_VALUE,
  TIMINGS_VARIABLE,
  type RelayTimings,
} from '../src/timings';

/** Every delay's name. */
const NAMES: ReadonlyArray<keyof RelayTimings> = ['rootsMs', 'handshakeMs'];

afterEach(() => {
  vi.unstubAllEnvs();
});

it('ships with positive delays, in force without the variable, and shorter ones for a test', () => {
  expect(RELAY_TIMINGS).toEqual(DEFAULT_RELAY_TIMINGS);
  expect(Object.keys(DEFAULT_RELAY_TIMINGS).toSorted()).toEqual([...NAMES].toSorted());
  for (const name of NAMES) {
    expect(DEFAULT_RELAY_TIMINGS[name], name).toBeGreaterThan(0);
    expect(TEST_RELAY_TIMINGS[name], name).toBeLessThanOrEqual(DEFAULT_RELAY_TIMINGS[name]);
  }
});

it("selects the test's delays for the test value, and the real ones for anything else", () => {
  expect(relayTimings(TEST_TIMINGS_VALUE)).toBe(TEST_RELAY_TIMINGS);
  expect(relayTimings(undefined)).toBe(DEFAULT_RELAY_TIMINGS);
  expect(relayTimings('fast')).toBe(DEFAULT_RELAY_TIMINGS);
});

it('reads the variable when loaded', async () => {
  vi.stubEnv(TIMINGS_VARIABLE, TEST_TIMINGS_VALUE);
  vi.resetModules();
  const loaded = await import('../src/timings');
  expect(loaded.RELAY_TIMINGS).toEqual(TEST_RELAY_TIMINGS);
});
