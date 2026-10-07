// What the controller, the player, and the rehearsal are tuned by, in their own file so the
// three share it without importing each other for it (#12).

import { defaultTiming, type Timing } from "./timing"

export type Config = {
  maxBlockMs: number
  /** During the programmer's turn, how long after their last edit `listen` returns. */
  navigatorIdleMs: number
  timing: Timing
  random: () => number
  /** Ask the programmer before each `run`. */
  confirmCommands: boolean
  /** How long a `run` waits for its command by default, and at most. */
  runWaitMs: number
  maxRunWaitMs: number
}

export const defaultConfig: Config = {
  maxBlockMs: 45_000,
  navigatorIdleMs: 3000,
  timing: defaultTiming,
  random: Math.random,
  confirmCommands: true,
  runWaitMs: 120_000,
  maxRunWaitMs: 600_000,
}
