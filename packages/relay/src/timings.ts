// The relay's delays, in one place: the real ones, or the test's when the environment's `AI_PAIR_TIMINGS` is `test`,
// which a test cannot wait the real ones out of (#176). The relay is its own process, so the environment is how the
// test reaches it.

/** Every delay of the relay's own, in milliseconds. */
export interface RelayTimings {
  /** How long to wait for the harness to list its roots: one that claims to but never answers mustn't block `start`. */
  rootsMs: number;
  /** How long a window gets to complete the WebSocket handshake. */
  handshakeMs: number;
}

/** The delays for real use. */
export const DEFAULT_RELAY_TIMINGS: Readonly<RelayTimings> = { rootsMs: 2000, handshakeMs: 5000 };

/** The delays for a test. */
export const TEST_RELAY_TIMINGS: Readonly<RelayTimings> = { rootsMs: 1000, handshakeMs: 2000 };

/** The environment variable that selects the delays, and the value that selects the test's. */
export const TIMINGS_VARIABLE = 'AI_PAIR_TIMINGS';
export const TEST_TIMINGS_VALUE = 'test';

/** Returns the delays the variable's value selects: the test's for `test`, else the real ones. */
export function relayTimings(selected: string | undefined): Readonly<RelayTimings> {
  return selected === TEST_TIMINGS_VALUE ? TEST_RELAY_TIMINGS : DEFAULT_RELAY_TIMINGS;
}

/** The delays in force in this process. */
export const RELAY_TIMINGS: Readonly<RelayTimings> = relayTimings(process.env[TIMINGS_VARIABLE]);
