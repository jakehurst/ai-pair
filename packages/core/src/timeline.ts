// Delays for playback that can be paused, and interrupted for good.

/** What playback waits with. */
export type Pacing = Pick<Timeline, 'sleep' | 'isInterrupted' | 'signal'>;

/** No waiting at all, and never interrupted. */
export const instant: Pacing = {
  sleep: () => Promise.resolve(true),
  isInterrupted: false,
  signal: new AbortController().signal,
};

interface Sleep {
  remaining: number;
  startedAt: number;
  timer?: ReturnType<typeof setTimeout>;
  resolve: (completed: boolean) => void;
}

/** The clock playback runs on: sleeps that a pause holds and an interrupt cuts short. */
export class Timeline {
  private interrupted = false;
  private sleeping: Sleep | undefined = undefined;
  private abort = new AbortController();

  constructor(private paused: boolean) {}

  get isInterrupted(): boolean {
    return this.interrupted;
  }

  /** Returns a signal aborted when playback is interrupted, for waits that aren't delays. */
  get signal(): AbortSignal {
    return this.abort.signal;
  }

  /** Clears the interruption, for the next batch (specs/Timeline.tla, `Reset`). */
  reset(): void {
    this.interrupted = false;
    if (this.abort.signal.aborted) this.abort = new AbortController();
  }

  /**
   * Waits `ms` of unpaused time. Resolves `false` if interrupted (specs/Timeline.tla, `Sleep`). A sleep while one is
   * pending replaces it, which no caller does (`SleepAgain`).
   */
  sleep(ms: number): Promise<boolean> {
    if (this.interrupted) return Promise.resolve(false);
    return new Promise((resolve) => {
      this.sleeping = { remaining: Math.max(0, ms), startedAt: 0, resolve };
      if (!this.paused) this.arm(this.sleeping);
    });
  }

  /** Stops the sleep's timer, keeping what is left (specs/Timeline.tla, `Pause`). */
  pause(): void {
    if (this.paused) return;
    this.paused = true;
    const p = this.sleeping;
    if (p?.timer !== undefined) {
      clearTimeout(p.timer);
      p.timer = undefined;
      p.remaining = Math.max(0, p.remaining - (Date.now() - p.startedAt));
    }
  }

  /** Starts the sleep's timer again (specs/Timeline.tla, `Resume`, once no pause reason is left). */
  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    // A paused sleep has no timer (`NoTimerWhilePaused`), so a sleep is waiting, and is armed again.
    if (this.sleeping) this.arm(this.sleeping);
  }

  /** Resolves the sleep `false`, and later ones too until `reset` (specs/Timeline.tla, `Interrupt`). */
  interrupt(): void {
    this.interrupted = true;
    this.abort.abort();
    const p = this.sleeping;
    if (!p) return;
    clearTimeout(p.timer);
    this.sleeping = undefined;
    p.resolve(false);
  }

  private arm(p: Sleep): void {
    p.startedAt = Date.now();
    // specs/Timeline.tla, `Fire`: the sleep resolves `true`.
    p.timer = setTimeout(() => {
      // A replaced sleep's timer leaves the later sleep pending (specs/Timeline.tla, `FireReplaced`).
      if (this.sleeping === p) this.sleeping = undefined;
      p.resolve(true);
    }, p.remaining);
  }
}
