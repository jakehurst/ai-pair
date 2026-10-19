// The extension's own delays, apart from playback's (`aiPair.timing`, in core's timing.ts): each in one place, read
// where it is used. Two sets: the real one, and one a test can wait out, which it selects through `Api.setTimings`
// (#176).

/** Every delay of the extension's own, in milliseconds. */
export interface Timings {
  /** After a change, how long until the session is saved to the workspace's storage; changes come a keystroke at a time (#25). */
  saveMs: number;
  /**
   * How long writes reported outside the editor are grouped before they are decided (#15). Changes this close
   * together are one history entry: a bulk rename, a branch switch. They are decided when the group settles, by which
   * time VS Code has told of its own saves.
   */
  groupMs: number;
  /** How long after the extension's own navigation a view change is its own (specs/FollowMode.tla, `Expire`). */
  selfNavMs: number;
  /** How often the read cursor pulses. */
  pulseMs: number;
  /** With smooth scrolling, how long the visible ranges stay unchanged once a scroll is over. */
  scrollQuietMs: number;
  /** The most a reveal waits for VS Code to report the scroll it asked for. */
  scrollMaxMs: number;
  /** One frame of a glide. */
  frameMs: number;
  /** How long a new terminal gets to report shell integration before the command is just typed in. */
  shellIntegrationMs: number;
  /** After a command ends, how long its output stream gets to drain. */
  drainMs: number;
  /** How long the pointer rests on a control before its tooltip shows, and how long after one hides the next shows at once. */
  tipDelayMs: number;
  tipWarmMs: number;
}

/** The delays for real use. */
export const DEFAULT_TIMINGS: Readonly<Timings> = {
  saveMs: 200,
  groupMs: 500,
  selfNavMs: 400,
  pulseMs: 450,
  scrollQuietMs: 50,
  scrollMaxMs: 500,
  frameMs: 16,
  shellIntegrationMs: 5000,
  drainMs: 500,
  tipDelayMs: 500,
  tipWarmMs: 300,
};

/** The delays for a test: the waits it has to sit out are short; what paces the view stays as it is. */
export const TEST_TIMINGS: Readonly<Timings> = {
  ...DEFAULT_TIMINGS,
  saveMs: 50,
  groupMs: 100,
  shellIntegrationMs: 2000,
  drainMs: 100,
};

/** The delays in force: the real ones until `setTimings` changes them. */
export const timings: Timings = { ...DEFAULT_TIMINGS };

/** Sets the given delays: a test sets `TEST_TIMINGS`, or one of its own on top of them. */
export function setTimings(overrides: Partial<Timings>): void {
  Object.assign(timings, overrides);
}
