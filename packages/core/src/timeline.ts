// Delays for playback that can be paused, and interrupted for good.

/** What playback waits with. */
export type Pacing = Pick<Timeline, "sleep" | "isInterrupted" | "signal">

/** No waiting at all, and never interrupted. */
export const instant: Pacing = {
  sleep: () => Promise.resolve(true),
  isInterrupted: false,
  signal: new AbortController().signal,
}

type Pending = {
  remaining: number
  startedAt: number
  timer?: ReturnType<typeof setTimeout>
  resolve: (completed: boolean) => void
}

export class Timeline {
  private paused = false
  private interrupted = false
  private pending: Pending | null = null
  private abort = new AbortController()

  constructor(paused: boolean) {
    this.paused = paused
  }

  get isInterrupted(): boolean {
    return this.interrupted
  }

  /** Aborted when playback is interrupted, for waits that aren't delays. */
  get signal(): AbortSignal {
    return this.abort.signal
  }

  /** Clears the interruption, for the next batch (specs/Timeline.tla, `Reset`). */
  reset(): void {
    this.interrupted = false
    if (this.abort.signal.aborted) this.abort = new AbortController()
  }

  /** Waits `ms` of unpaused time. Resolves `false` if interrupted (specs/Timeline.tla, `Sleep`). */
  sleep(ms: number): Promise<boolean> {
    if (this.interrupted) return Promise.resolve(false)
    return new Promise((resolve) => {
      this.pending = { remaining: Math.max(0, ms), startedAt: 0, resolve }
      if (!this.paused) this.arm(this.pending)
    })
  }

  /** Stops the pending sleep's timer, keeping what is left (specs/Timeline.tla, `Pause`). */
  pause(): void {
    if (this.paused) return
    this.paused = true
    const p = this.pending
    if (p?.timer !== undefined) {
      clearTimeout(p.timer)
      p.timer = undefined
      p.remaining = Math.max(0, p.remaining - (Date.now() - p.startedAt))
    }
  }

  /** Starts the pending sleep's timer again (specs/Timeline.tla, `Resume`, once no pause reason is left). */
  resume(): void {
    if (!this.paused) return
    this.paused = false
    if (this.pending && this.pending.timer === undefined) this.arm(this.pending)
  }

  /** Resolves the pending sleep `false`, and later ones too until `reset` (specs/Timeline.tla, `Interrupt`). */
  interrupt(): void {
    this.interrupted = true
    this.abort.abort()
    const p = this.pending
    if (!p) return
    clearTimeout(p.timer)
    this.pending = null
    p.resolve(false)
  }

  private arm(p: Pending): void {
    p.startedAt = Date.now()
    // specs/Timeline.tla, `Fire`: the sleep resolves `true`.
    p.timer = setTimeout(() => {
      if (this.pending === p) this.pending = null
      p.resolve(true)
    }, p.remaining)
  }
}
