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
