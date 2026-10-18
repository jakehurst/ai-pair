// What the controller, the player, and the rehearsal are tuned by, in their own file so the
// three share it without importing each other for it (#12).

import { defaultTiming, type Timing } from './timing';

/** The controller's settings: timeouts, timing, and what commands may run. */
export interface Config {
  maxBlockMs: number;
  /** During the programmer's turn, how long after their last edit `listen` returns. */
  navigatorIdleMs: number;
  /** After a `listen` that timed out with nothing to report, how long the status stays "Your move" (#126). */
  listenGraceMs: number;
  /** With no call open this long, the panel says the agent isn't listening (#149). */
  absentMs: number;
  timing: Timing;
  random: () => number;
  /** Ask the programmer before each `run`. */
  confirmCommands: boolean;
  /** How long a `run` waits for its command by default, and at most. */
  runWaitMs: number;
  maxRunWaitMs: number;
}

/** The controller's timeouts alone: what `Controller.setTimeouts` sets. */
export type Timeouts = Pick<Config, 'maxBlockMs' | 'navigatorIdleMs' | 'listenGraceMs' | 'absentMs' | 'runWaitMs' | 'maxRunWaitMs'>;

/** The timeouts for a test, which cannot wait the real ones out: seconds where the real ones are minutes. */
export const TEST_TIMEOUTS: Timeouts = {
  maxBlockMs: 5000,
  navigatorIdleMs: 1000,
  listenGraceMs: 2000,
  absentMs: 5000,
  runWaitMs: 10_000,
  maxRunWaitMs: 60_000,
};

/** The settings in force when the editor gives none. */
export const defaultConfig: Config = {
  maxBlockMs: 45_000,
  navigatorIdleMs: 3000,
  listenGraceMs: 10_000,
  absentMs: 45_000,
  timing: defaultTiming,
  random: Math.random,
  confirmCommands: true,
  runWaitMs: 120_000,
  maxRunWaitMs: 600_000,
};
