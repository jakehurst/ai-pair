// Every number that shapes how playback feels, in one place, for calibration.
// Durations are in milliseconds at normal speed; the speed setting divides them all.
// The programmer can override any of them with the `aiPair.timing` setting.

export type Cadence = {
  /** Between characters within a word. */
  charMs: number
  /** Random variation of `charMs`, e.g. 0.25 for ±25%. */
  jitter: number
  /** Extra, when a word starts: switching from punctuation or whitespace to a letter or digit. */
  wordStartMs: number
  /** Extra, after `,` `;` `:`. */
  punctuationMs: number
  /** Extra, after an opening `(` `[` `{`. */
  openBracketMs: number
  /** Extra, after a newline: the next line is being thought of. */
  newlineMs: number
}

export type Reading = { msPerWord: number; minMs: number; maxMs: number }

export type Timing = {
  type: Cadence
  /** `type_fast` plays the same cadence, with every delay multiplied by this. */
  fastFactor: number
  /** After a `say`: enough to read the message at an ordinary pace. */
  reading: Reading
  /** Before a move, so the jump doesn't look instantaneous. */
  beforeMoveMs: number
  /** After a move nearby, and after `type` steps back between its parts: the eyes find the cursor again. */
  afterMoveNearMs: number
  /** After a move to another file or far away: the view changed, re-orient. */
  afterMoveFarMs: number
  /** A move within this many lines in the same file counts as nearby. */
  nearLines: number
  beforeSelectMs: number
  /** After a selection appears: read what's about to change. */
  afterSelectMs: number
  /** After a deletion: register what's gone. */
  afterDeleteMs: number
  /** After a `point` highlight appears: find the highlighted code. */
  afterPointMs: number
}

export const defaultTiming: Timing = {
  type: {
    charMs: 55,
    jitter: 0.25,
    wordStartMs: 110,
    punctuationMs: 90,
    openBracketMs: 70,
    newlineMs: 350,
  },
  fastFactor: 0.25,
  reading: { msPerWord: 270, minMs: 1500, maxMs: 9000 },
  beforeMoveMs: 150,
  afterMoveNearMs: 450,
  afterMoveFarMs: 900,
  nearLines: 15,
  beforeSelectMs: 150,
  afterSelectMs: 700,
  afterDeleteMs: 300,
  afterPointMs: 400,
}

export type TimingOverrides = Partial<Omit<Timing, "type" | "reading">> & {
  type?: Partial<Cadence>
  reading?: Partial<Reading>
}

/**
 * `base` with the overrides from the programmer's settings. They are JSON VS Code doesn't check, so
 * one that isn't a finite number of zero or more keeps the base value: a `NaN` or negative delay
 * would turn pacing off without a word (#17).
 */
export function withOverrides(base: Timing, overrides: TimingOverrides): Timing {
  return {
    ...numbers(base, overrides),
    type: numbers(base.type, field(overrides, "type")),
    reading: numbers(base.reading, field(overrides, "reading")),
  }
}

/** `base`, with each of its numbers replaced by the one `over` has under its key, if that's valid. */
function numbers<T extends object>(base: T, over: unknown): T {
  const out = { ...base }
  for (const key of Object.keys(base)) {
    const value = field(over, key)
    if (typeof Reflect.get(base, key) === "number" && typeof value === "number" && Number.isFinite(value) && value >= 0) {
      Reflect.set(out, key, value)
    }
  }
  return out
}

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? (Reflect.get(value, key) as unknown) : undefined
}
