// The protocol state machine: sessions, the batch queue, and reports. Playing a batch is player.ts.
// See PROTOCOL.md for the rules implemented here.

import type { Action, BatchResult, Event, Excerpt, FileContent, Report, Turn } from "@ai-pair/protocol"
import { CURSOR_MARKER, ToolError } from "@ai-pair/protocol"
import { fileDiff, lineChanges } from "./diff"
import { LineIds, type Sighting } from "./lines"
import { agentPath, displayPath, Player, type Scene } from "./player"
import {
  MissingFile,
  type AgentState,
  type Change,
  type CursorView,
  type EditorPort,
  type PanelPort,
  type Ref,
  type SharedSelection,
} from "./ports"
import { followChange, rehearse, type Rehearsal } from "./rehearsal"
import { fileLines } from "./text"
import { Timeline } from "./timeline"
import { defaultConfig, type Config } from "./config"
import { defaultTiming, withOverrides, type TimingOverrides } from "./timing"

type Batch = {
  id: number
  actions: Action[]
  state: "queued" | "playing" | "done"
  result?: BatchResult
  /** What it leaves behind, played in memory when it was queued: where the next batch is rehearsed from. */
  after?: Rehearsal
}

/** Like `Event`, but edits usually get their diff when the report is taken. */
type PendingEvent = Exclude<Event, { kind: "edit" }> | EditEvent

/** `interrupted`: a change the programmer didn't make, to a file the playing or queued batches edit. */
type EditEvent = { kind: "edit"; file: string; by: "programmer" | "other"; diff?: string; interrupted?: true }

/** Everything interrupts, except changes the programmer didn't make to files no batch is going to edit. */
function interrupting(e: PendingEvent): boolean {
  return e.kind !== "edit" || e.by === "programmer" || e.interrupted === true
}

const UNANCHORED =
  "Your previous batch was interrupted or discarded, so your cursor is where it stopped, not where that batch would have ended. `read` the file, then start this batch with a `move` or `select` that gives both `file` and `line`."

/** The first action at the cursor, and whether it anchors the cursor: a `move` or `select` giving both `file` and `line` (#112). */
function cursorAnchor(actions: Action[]): { index: number; anchored: boolean } | undefined {
  const i = actions.findIndex((a) => !("say" in a || "run" in a || "point" in a))
  if (i === -1) return undefined
  const action = actions[i]!
  const place = "move" in action ? action.move : "select" in action ? action.select : undefined
  return { index: i + 1, anchored: place?.file !== undefined && place?.line !== undefined }
}

/** A session as the window saves it across a reload, as JSON: what it needs to carry on (#25). */
export type SavedSession = {
  task?: string
  scene: Pick<Scene, "root" | "turn" | "cursor" | "selection"> & { allowedCommands: string[] }
  finished: BatchResult[]
  events: Exclude<Event, { kind: "edit" }>[]
}

type Session = {
  task?: string
  scene: Scene
  player: Player
  /** Batches not yet finished; the head may be playing. */
  queue: Batch[]
  /** Finished batches not yet reported. */
  finished: BatchResult[]
  events: PendingEvent[]
  /** An unreported interruption or failure: new batches are discarded. */
  stale: boolean
  /** A report told the agent a batch stopped short: the next batch must anchor the cursor with a file and line (#112). */
  anchorNeeded: boolean
  /** Rejections handed back by `restore`, to be reported again, one per report (#28), each marked if the agent may have seen it. */
  held: { rejected: NonNullable<Report["rejected"]>; mayRepeat: boolean }[]
  /** A report restored may have reached the agent already: the next report says so (#67). */
  mayRepeat: boolean
  /** Text of each file edited by the programmer, as of the last report. */
  baselines: Map<string, string>
  latest: Map<string, string>
  timeline: Timeline
  running: boolean
  /** A `run` waiting for the programmer's go-ahead. */
  confirming?: { id: number; command: string; decide: (run: boolean) => void }
  /** Ended by the programmer; the final report hasn't been delivered yet. */
  ended: boolean
  /** Its agent disconnected, or the window reloaded: it waits for a `start` from its directory (#25). */
  suspended: boolean
  navigatorReady: boolean
  navigatorTimer?: ReturnType<typeof setTimeout>
  /** The cursor's line as the agent last saw it in a report, so reports only show it when it changed. */
  seenCursor?: string
  /** The identities of the lines of the files in the editor. */
  lines: LineIds
  /** For each file, the line the agent was last shown at each number, by its identity. */
  seen: Map<string, Map<number, number>>
}

type Call = {
  kind: "step" | "listen" | "end"
  batch?: Batch
  summary?: string
  timer: ReturnType<typeof setTimeout>
  resolve: (report: Report) => void
  reject: (error: unknown) => void
}

const cancelled = () => new ToolError("cancelled", "The call was cancelled.")

export class Controller {
  private session: Session | null = null
  /** The session the last report closed, until another starts: a report handed back puts it back. */
  private closed: Session | null = null
  private call: Call | null = null
  private chain: Promise<unknown> = Promise.resolve()
  private nextBatchId = 1
  private pauseReasons = new Set<string>()
  private speed = 1
  private readingSpeed = 1
  private lastPosted = ""
  /** After any change the session's `saved` form may have: the window saves it (#25). */
  onChange?: () => void

  constructor(
    private readonly editor: EditorPort,
    private readonly panel: PanelPort,
    private config: Config = defaultConfig,
  ) {}

  // ---- Tools -------------------------------------------------------------

  /** `rules`: the project guides the relay read for the agent, named for the panel (#23). */
  start(task?: string, root?: string, rules?: string[]): Promise<Report> {
    return this.serialize(undefined, async () => {
      // In the editor's spelling, so paths inside it are reported relative to it.
      const at = root && this.editor.resolvePath(root)
      const waiting = this.session
      if (waiting?.suspended) {
        // Its agent is back, from its directory: it carries on where it left off (#25, specs/Resume.tla).
        if (waiting.scene.root === at) return this.resumeSession(waiting, rules)
        // Another directory: another session, which ends the one waiting.
        this.close(waiting)
      } else if (waiting && !waiting.ended) {
        throw new ToolError("session_active", "A pairing session is already active in this window.")
      }
      const scene: Scene = {
        root: at,
        turn: "agent",
        cursor: null,
        selection: null,
        point: null,
        focus: "cursor",
        pointFar: false,
        allowedCommands: new Set(),
      }
      this.open(task, scene)
      this.panel.post({ type: "session", active: true, task, ...(rules?.length ? { rules } : {}) })
      this.render()
      return { batches: [], events: [], turn: scene.turn }
    })
  }

  /**
   * Takes up a suspended session again: its turn, cursor, and history are as they were. The agent may
   * be a new conversation, so it has seen no lines: it reads them before it gives a line number.
   */
  private resumeSession(s: Session, rules?: string[]): Promise<Report> {
    s.suspended = false
    s.seen = new Map()
    s.seenCursor = undefined
    this.panel.post({ type: "session", active: true, task: s.task, resumed: true, ...(rules?.length ? { rules } : {}) })
    this.render()
    return this.withCursor(s, { ...this.snapshot(s, undefined, false), resumed: true })
  }

  /** A new session, the window's from now on. */
  private open(task: string | undefined, scene: Scene): Session {
    const timeline = new Timeline(this.pauseReasons.size > 0)
    const lines = LineIds.editor()
    const s: Session = {
      task,
      scene,
      player: new Player(scene, {
        editor: this.editor,
        panel: this.panel,
        pacing: timeline,
        config: () => this.config,
        speed: () => this.speed,
        readingSpeed: () => this.readingSpeed,
        render: () => this.render(),
        confirm: (id, command) => this.confirm(s, id, command),
        lines,
      }),
      queue: [],
      finished: [],
      events: [],
      stale: false,
      anchorNeeded: false,
      held: [],
      mayRepeat: false,
      baselines: new Map(),
      latest: new Map(),
      timeline,
      running: false,
      ended: false,
      suspended: false,
      navigatorReady: false,
      lines,
      seen: new Map(),
    }
    this.session = s
    this.closed = null
    this.lastPosted = ""
    return s
  }

  /**
   * The session as the window saves it in the workspace's storage, to bring it back suspended after a
   * reload (#25, specs/Resume.tla); none once it has ended. Edits aren't kept: their diffs need the
   * text from before them, and the agent reads its files again when it resumes.
   */
  get saved(): SavedSession | undefined {
    const s = this.session
    if (!s || s.ended) return undefined
    const { root, turn, cursor, selection } = s.scene
    return {
      task: s.task,
      scene: { root, turn, cursor, selection, allowedCommands: [...s.scene.allowedCommands] },
      finished: s.finished,
      events: s.events.filter((e): e is Exclude<Event, { kind: "edit" }> => e.kind !== "edit"),
    }
  }

  /** After a reload: the session the window saved, suspended until its agent's `start` (#25). */
  revive(saved: SavedSession): void {
    if (this.session) return
    const scene: Scene = {
      ...saved.scene,
      point: null,
      focus: "cursor",
      pointFar: false,
      allowedCommands: new Set(saved.scene.allowedCommands),
    }
    const s = this.open(saved.task, scene)
    s.suspended = true
    s.finished = [...saved.finished]
    s.events = [...saved.events]
    this.render()
  }

  step(actions: Action[], signal?: AbortSignal): Promise<Report> {
    return this.serialize(signal, async () => {
      const s = this.requireSession()
      // An empty batch only waits for the queued ones, so it isn't a batch of its own.
      if (actions.length === 0) return this.block("step", {}, signal)
      // After a report said a batch stopped short, the first action at the cursor must anchor it (#112, specs/Anchor.tla).
      const anchor = cursorAnchor(actions)
      if (s.anchorNeeded && anchor && !anchor.anchored) return this.rejectUnanchored(s, actions, anchor.index)
      // Played in memory first, so what would fail is reported now, not when the batch plays.
      const rehearsal = s.stale || s.ended ? undefined : await this.rehearse(s, actions)
      // An interruption arriving meanwhile discards it, like any batch planned without knowing about it.
      const current = rehearsal && !s.stale && !s.ended
      if (current && rehearsal.result.status === "failed") return this.rejectBatch(s, actions, rehearsal)
      const batch: Batch = { id: this.nextBatchId++, actions, state: "queued", after: rehearsal?.after }
      if (current) {
        s.queue.push(batch)
        if (anchor?.anchored) s.anchorNeeded = false
        this.kick(s)
      } else {
        this.discard(s, batch)
      }
      return this.block("step", { batch }, signal)
    })
  }

  listen(signal?: AbortSignal): Promise<Report> {
    return this.serialize(signal, () => {
      this.requireSession()
      return this.block("listen", {}, signal)
    })
  }

  end(summary?: string, signal?: AbortSignal): Promise<Report> {
    return this.serialize(signal, () => {
      this.requireSession()
      return this.block("end", { summary }, signal)
    })
  }

  /** Not serialized like the other tools: `read` "does not block and does not deliver events" (PROTOCOL.md). */
  async read(file: string, fromLine?: number, toLine?: number): Promise<FileContent> {
    const s = this.requireSession()
    const path = this.resolvePath(s, file)
    const planned = this.planned(s, path)
    const text = planned ?? (await this.textOrMissing(s, path))
    const { lines, finalNewline } = fileLines(text)
    const from = Math.max(1, fromLine ?? 1)
    const to = Math.min(lines.length, toLine ?? lines.length)
    const numbers = Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i)
    // As the queued batches leave the file, if they edit it.
    this.saw(s, planned !== undefined ? s.queue.at(-1)!.after!.lines : s.lines, { file: path, text, lines: numbers })
    const content: FileContent = {
      file: this.displayPath(s, path),
      dirty: await this.editor.isDirty(path),
      lines: lines.slice(from - 1, to).map((line, i) => ({ number: from + i, text: line })),
    }
    if (to === lines.length) content.end = { final_newline: finalNewline }
    return content
  }

  /** The file's text; a file that doesn't exist is the agent's to create, with a `move` (#89). */
  private async textOrMissing(s: Session, path: string): Promise<string> {
    try {
      return await this.editor.getText(path)
    } catch (e) {
      if (!(e instanceof MissingFile)) throw e
      throw new ToolError("invalid_arguments", `${this.displayPath(s, path)} doesn't exist. A \`move\` to it creates it, empty.`)
    }
  }

  /**
   * The text of a file as it will be once the queued batches have played, if they edit it: they
   * were played in memory when queued. Not after an interruption, which discards what they'd do.
   */
  private planned(s: Session, path: string): string | undefined {
    if (s.stale) return undefined
    return s.queue.at(-1)?.after?.texts.get(path)
  }

  /**
   * Puts a report back to be delivered again. For a report that raced with a cancellation: the
   * call returned just before the cancellation arrived, so the agent never saw the report.
   * `mayRepeat`: or the cancellation came after the answer, and the agent may have seen it (#67).
   */
  restore(report: Report, mayRepeat = false): void {
    // Also once the session ended, or the report closed it: the next call takes the report again,
    // and closes the session again (#60).
    const s = this.session ?? this.closed
    if (!s) return
    if (!this.session) {
      s.ended = true
      this.session = s
      this.closed = null
    }
    s.finished.unshift(...report.batches)
    s.events.unshift(...report.events)
    if (mayRepeat) s.mayRepeat = true
    if (report.events.some(interrupting) || report.batches.some((b) => b.status !== "completed")) s.stale = true
    // A step that never queued its batch: its rejection is the only report of it.
    if (report.rejected) {
      s.held.push({ rejected: report.rejected, mayRepeat })
      s.stale = true
    }
    this.update()
  }

  // ---- Programmer input --------------------------------------------------

  /** `selection`: code the programmer had selected, sent along with the message. */
  userMessage(text: string, selection?: SharedSelection): void {
    const s = this.activeSession()
    if (!s) return
    s.events.push(selection ? { kind: "message", text, selection: this.excerpt(s, selection) } : { kind: "message", text })
    this.panel.post({ type: "user", text, ref: selection && this.ref(selection) })
    this.interrupt(s)
    this.update()
  }

  userInterrupt(): void {
    const s = this.activeSession()
    if (!s) return
    s.events.push({ kind: "interrupt" })
    this.panel.post({ type: "interrupt" })
    this.interrupt(s)
    this.update()
  }

  /** A change the programmer made. `changes` are applied in order, each to the result of the previous. */
  userEdit(file: string, before: string, after: string, changes: Change[]): void {
    const s = this.activeSession()
    if (!s) return
    this.recordEdit(s, file, before, after, changes, "programmer")
    if (s.scene.turn === "agent") {
      this.interrupt(s)
    } else {
      // Typing again: the pause the timer marked is over, so wait for the next (specs/Navigator.tla).
      s.navigatorReady = false
      clearTimeout(s.navigatorTimer)
      s.navigatorTimer = setTimeout(() => {
        s.navigatorReady = true
        this.pump()
      }, this.config.navigatorIdleMs)
    }
    this.update()
  }

  /**
   * A change the programmer didn't make: by a tool, a formatter, or on disk. It interrupts if the
   * playing or queued batches edit the file, since they were planned against the text before it.
   * Otherwise it's just reported, and the queued rehearsals follow it.
   */
  otherEdit(file: string, before: string, after: string, reported: Change[]): void {
    const s = this.activeSession()
    if (!s) return
    // A file reloaded from disk comes as one change spanning lines that didn't change (#65).
    const changes = lineChanges(before, reported)
    const planned = s.queue.some((b) => b.after?.edits.has(file))
    // The queued rehearsals follow it, reading the file's line identities from the editor.
    if (!planned) for (const b of s.queue) if (b.after) followChange(b.after, file, after, changes)
    this.recordEdit(s, file, before, after, changes, "other")
    if (planned) {
      const e = s.events.find((p): p is EditEvent => p.kind === "edit" && p.file === file && p.diff === undefined)
      if (e) e.interrupted = true
      this.interrupt(s)
    }
    this.update()
  }

  /** Edits to a file are reported as one diff, as the programmer's if any of them was. */
  private recordEdit(s: Session, file: string, before: string, after: string, changes: Change[], by: EditEvent["by"]): void {
    s.lines.of(file, before)
    for (const change of changes) {
      s.player.transform(file, change)
      s.lines.apply(file, change)
    }
    if (!s.baselines.has(file)) {
      s.baselines.set(file, before)
      s.events.push({ kind: "edit", file, by })
    } else if (by === "programmer") {
      const pending = s.events.find((e): e is EditEvent => e.kind === "edit" && e.file === file && e.diff === undefined)
      if (pending) pending.by = "programmer"
    }
    s.latest.set(file, after)
  }

  takeTurn(): void {
    const s = this.activeSession()
    if (!s || s.scene.turn === "user") return
    s.scene.turn = "user"
    s.scene.focus = "cursor"
    s.events.push({ kind: "turn", to: "user" })
    this.panel.post({ type: "turn", to: "user" })
    this.interrupt(s)
    this.update()
  }

  handBack(message?: string, selection?: SharedSelection): void {
    const s = this.activeSession()
    if (!s || s.scene.turn === "agent") return
    s.scene.turn = "agent"
    clearTimeout(s.navigatorTimer)
    const event: Event = { kind: "turn", to: "agent" }
    if (message) event.message = message
    if (selection) event.selection = this.excerpt(s, selection)
    s.events.push(event)
    this.panel.post({ type: "turn", to: "agent", message, ref: selection && this.ref(selection) })
    this.interrupt(s)
    this.update()
  }

  endSession(): void {
    const s = this.activeSession()
    if (!s) return
    if (s.suspended) {
      // No agent is there to take a final report: it's over now.
      this.close(s)
      this.panel.post({ type: "session", active: false, reason: "user" })
      return
    }
    s.ended = true
    s.events.push({ kind: "end" })
    this.interrupt(s)
    this.panel.post({ type: "session", active: false, reason: "user" })
    this.update()
  }

  /**
   * The agent is gone (the relay disconnected). Its session waits, suspended, for a `start` from its
   * directory, or for the programmer to end it (#25, specs/Resume.tla).
   */
  disconnect(): void {
    const s = this.session
    this.closed = null
    if (this.call) {
      clearTimeout(this.call.timer)
      this.call.reject(new ToolError("no_session", "Disconnected."))
      this.call = null
    }
    if (!s) return
    if (s.ended) {
      this.close(s)
      return
    }
    // Nothing plays without its agent: what's queued is discarded, and reported once it's back.
    this.interrupt(s)
    s.suspended = true
    this.panel.post({ type: "session", active: true, task: s.task, suspended: true })
    this.update()
  }

  pause(reason = "user"): void {
    this.pauseReasons.add(reason)
    this.session?.timeline.pause()
    this.render()
  }

  /** Removes one pause reason, or all of them. Playback continues when none are left. */
  resume(reason?: string): void {
    if (this.pauseReasons.size === 0) return
    if (reason === undefined) this.pauseReasons.clear()
    else this.pauseReasons.delete(reason)
    if (this.pauseReasons.size > 0) return
    const s = this.session
    if (s) {
      if (s.scene.turn === "agent" && (s.scene.cursor || s.scene.point)) this.editor.reveal()
      s.timeline.resume()
    }
    this.render()
  }

  setSpeed(speed: number): void {
    this.speed = speed
  }

  setReadingSpeed(speed: number): void {
    this.readingSpeed = speed
  }

  setConfirmCommands(confirm: boolean): void {
    this.config = { ...this.config, confirmCommands: confirm }
  }

  /**
   * The programmer's answer to a `run` waiting for confirmation. `remember`: run exactly this
   * command without asking for the rest of the session.
   */
  decideRun(id: number, run: boolean, remember = false): void {
    const s = this.session
    const c = s?.confirming
    if (c?.id !== id) return
    if (run && remember) s!.scene.allowedCommands.add(c.command)
    c.decide(run)
  }

  /** Waits for the programmer's answer to a `run`, or an interruption. */
  private confirm(s: Session, id: number, command: string): Promise<boolean> {
    const signal = s.timeline.signal
    // An interrupt during the save before it: the abort event has fired already.
    if (signal.aborted) return Promise.resolve(false)
    return new Promise<boolean>((resolve) => {
      const abort = () => resolve(false)
      s.confirming = {
        id,
        command,
        decide: (run) => {
          signal.removeEventListener("abort", abort)
          resolve(run)
        },
      }
      signal.addEventListener("abort", abort, { once: true })
    }).finally(() => {
      s.confirming = undefined
    })
  }

  /** Calibration: overrides on top of the default timing. */
  setTiming(overrides: TimingOverrides): void {
    this.config = { ...this.config, timing: withOverrides(defaultTiming, overrides) }
  }

  /** The session's agent is gone, and a `start` from its directory takes it up again (#25). */
  get isSuspended(): boolean {
    return this.session?.suspended === true
  }

  get isActive(): boolean {
    return this.activeSession() !== null
  }

  get isPaused(): boolean {
    return this.pauseReasons.size > 0
  }

  get turn(): Turn | null {
    return this.activeSession()?.scene.turn ?? null
  }

  // ---- Calls and reports -------------------------------------------------

  /** Runs tool calls one at a time. A call cancelled while waiting its turn never runs. */
  private serialize<T>(signal: AbortSignal | undefined, fn: () => Promise<T>): Promise<T> {
    const guarded = () => (signal?.aborted ? Promise.reject(cancelled()) : fn())
    const run = this.chain.then(guarded, guarded)
    this.chain = run.catch(() => {})
    return run
  }

  /** Plays a batch in memory, from where the queued batches leave off, or the editor as it is. */
  private rehearse(s: Session, actions: Action[]): ReturnType<typeof rehearse> {
    const from = s.queue.at(-1)?.after ?? { scene: s.scene, texts: new Map(), lines: s.lines, edits: new Set<string>() }
    return rehearse(this.editor, this.config, from, actions, (file, line, id) => s.seen.get(file)?.get(line) === id)
  }

  /** Reports a batch that played in memory failed, without queuing it; nothing else changes. */
  private async rejectBatch(s: Session, actions: Action[], rehearsal: Awaited<ReturnType<typeof rehearse>>): Promise<Report> {
    const rehearsed = rehearsal.result
    const index = actions.length - (rehearsed.unplayed?.length ?? 0) + 1
    const rejected: NonNullable<Report["rejected"]> = { index, action: actions[index - 1]!, error: rehearsed.error! }
    if (rehearsed.code) rejected.code = rehearsed.code
    for (const sighting of rehearsal.sightings) this.saw(s, rehearsal.after.lines, sighting)
    const report = { ...this.snapshot(s, undefined, false), rejected }
    this.render()
    return this.withCursor(s, report)
  }

  /** Reports a batch refused for not anchoring the cursor after a discarded one, without queuing it (#112, specs/Anchor.tla). */
  private rejectUnanchored(s: Session, actions: Action[], index: number): Promise<Report> {
    const error = { kind: "unanchored" as const, message: UNANCHORED }
    const rejected = { index, action: actions[index - 1]!, error }
    const report = { ...this.snapshot(s, undefined, false), rejected }
    this.render()
    return this.withCursor(s, report)
  }

  private requireSession(): Session {
    if (!this.session) {
      throw new ToolError("no_session", "No pairing session is active. Call `start` to begin one.")
    }
    return this.session
  }

  private activeSession(): Session | null {
    return this.session && !this.session.ended ? this.session : null
  }

  /**
   * Blocks until the call is ready to report. Cancelling releases the call without taking a
   * report, so nothing is lost: a submitted batch stays queued and is reported on the next call.
   */
  private block(kind: Call["kind"], opts: { batch?: Batch; summary?: string }, signal?: AbortSignal): Promise<Report> {
    // An abort that fired while the batch was rehearsed won't fire again.
    if (signal?.aborted) return Promise.reject(cancelled())
    return new Promise((resolve, reject) => {
      const call: Call = {
        kind,
        ...opts,
        resolve,
        reject,
        timer: setTimeout(() => this.finishCall(true), this.config.maxBlockMs),
      }
      this.call = call
      signal?.addEventListener("abort", () => {
        if (this.call !== call) return
        this.call = null
        clearTimeout(call.timer)
        reject(cancelled())
        this.render()
      })
      this.update()
    })
  }

  private ready(call: Call, s: Session): boolean {
    if (s.ended) return true
    // An interrupted batch finishes promptly; wait for it, so the report says what was typed.
    if (s.queue[0]?.state === "playing" && s.timeline.isInterrupted) return false
    switch (call.kind) {
      case "step":
        if (!call.batch) return s.queue.length === 0
        return call.batch.state === "done" || s.queue[0] === call.batch
      case "end":
        return s.queue.length === 0
      case "listen":
        if (s.held.length > 0) return true
        if (s.finished.some((r) => r.status !== "completed")) return true
        if (s.queue.length > 0) return false
        if (s.scene.turn === "agent") return s.events.some(interrupting)
        // The programmer's edits during their turn wait until they pause typing.
        return s.events.some((e) => e.kind !== "edit") || (s.navigatorReady && s.events.some(interrupting))
      default:
        throw new Error(`Unknown call: ${JSON.stringify(call.kind satisfies never)}`)
    }
  }

  private pump(): void {
    const call = this.call
    const s = this.session
    if (call && s && this.ready(call, s)) this.finishCall(false)
  }

  private finishCall(timedOut: boolean): void {
    const call = this.call
    if (!call) return
    this.call = null
    clearTimeout(call.timer)
    const s = this.session
    if (!s) {
      call.reject(new ToolError("no_session", "The session has ended."))
      return
    }
    // Nothing more to wait for once the session is ending.
    const report = this.snapshot(s, call.batch, timedOut && !s.ended && call.kind !== "end")
    // An ended session stays until its held rejections are out, one per report (specs/Controller.tla, DrainHeld).
    const closing = (s.ended && s.held.length === 0) || call.kind === "end"
    if (closing) {
      this.close(s)
      this.closed = s
      if (call.kind === "end" && !s.ended) {
        this.panel.post({ type: "session", active: false, reason: "agent", summary: call.summary })
      }
    }
    this.render()
    void this.withCursor(s, report).then(call.resolve, () => call.resolve(report))
  }

  /** Adds the cursor's line to the report, unless it's where the agent last saw it, in a report's code or cursor. */
  private async withCursor(s: Session, report: Report): Promise<Report> {
    for (const b of report.batches) {
      const line = b.code?.lines.find((l) => l.text.includes(CURSOR_MARKER))
      if (b.code && line) s.seenCursor = `${b.code.file}:${line.number}:${line.text}`
    }
    if (!s.scene.cursor) return report
    const shown = await s.player.code({ moved: true })
    const line = shown?.code.lines.find((l) => l.text.includes(CURSOR_MARKER))
    if (!shown || !line) return report
    const key = `${shown.code.file}:${line.number}:${line.text}`
    if (key === s.seenCursor) return report
    s.seenCursor = key
    this.saw(s, s.lines, shown.sighting)
    return { ...report, cursor: shown.code }
  }

  /**
   * The agent is shown lines: it knows which line each number is, while it stays that line's.
   * `lines`: of the version shown, which may be a batch's, as it will play or would have.
   */
  private saw(s: Session, lines: LineIds, { file, text, lines: numbers }: Sighting): void {
    const ids = lines.of(file, text)
    let seen = s.seen.get(file)
    if (!seen) s.seen.set(file, (seen = new Map()))
    for (const n of numbers) {
      const id = ids[n - 1]
      if (id !== undefined) seen.set(n, id)
    }
  }

  /** Takes everything not yet reported. `submitted`: the batch the call submitted, if any. */
  private snapshot(s: Session, submitted: Batch | undefined, waiting: boolean): Report {
    const batches = s.finished.toSorted((a, b) => a.id - b.id)
    // The agent planned against where these would have ended; the cursor is where they stopped (#112, specs/Anchor.tla).
    if (batches.some((b) => b.status !== "completed")) s.anchorNeeded = true
    const events: Event[] = []
    for (const e of s.events) {
      if (e.kind !== "edit") {
        events.push(e)
        continue
      }
      if (e.diff !== undefined) {
        events.push({ kind: "edit", file: e.file, diff: e.diff, by: e.by })
        continue
      }
      const before = s.baselines.get(e.file) ?? ""
      const after = s.latest.get(e.file) ?? before
      // An edit that interrupted stays, with no diff, though it was undone: the agent has to know
      // why its batches were discarded, and a `listen` woke for it (specs/EditEvents.tla).
      if (before === after && !interrupting(e)) continue
      const file = this.displayPath(s, e.file)
      events.push({ kind: "edit", file, diff: before === after ? "" : fileDiff(file, before, after), by: e.by })
    }
    s.finished = []
    s.events = []
    s.baselines = new Map()
    s.latest = new Map()
    s.stale = false
    s.navigatorReady = false

    const report: Report = { batches, events, turn: s.scene.turn }
    const b = submitted
    if (b && b.state !== "done") report.submitted = { id: b.id, status: b.state }
    if (waiting) report.waiting = true
    if (s.mayRepeat) report.repeated = true
    s.mayRepeat = false
    // A rejection handed back by `restore`, one per report: while more are held, new batches are still discarded.
    const held = s.held.shift()
    if (held) report.rejected = held.rejected
    // Its own mark: a report before it may have taken s.mayRepeat (specs/Controller.tla, MarkHeld).
    if (held?.mayRepeat) report.repeated = true
    if (s.held.length > 0) s.stale = true
    return report
  }

  private close(s: Session): void {
    if (this.session === s) this.session = null
    s.timeline.interrupt()
    clearTimeout(s.navigatorTimer)
    this.editor.renderPoint(null)
    this.render()
  }

  // ---- Queue ---------------------------------------------------------------

  private discard(s: Session, batch: Batch): void {
    batch.state = "done"
    batch.result = { id: batch.id, status: "discarded", unplayed: batch.actions }
    s.finished.push(batch.result)
  }

  /** Stops playback and discards everything queued behind it. */
  private interrupt(s: Session): void {
    s.stale = true
    for (const b of s.queue) if (b.state === "queued") this.discard(s, b)
    s.queue = s.queue.filter((b) => b.state !== "done")
    s.timeline.interrupt()
  }

  private update(): void {
    this.render()
    this.pump()
  }

  // ---- Playback ------------------------------------------------------------

  private kick(s: Session): void {
    if (!s.running) void this.run(s)
  }

  private async run(s: Session): Promise<void> {
    s.running = true
    try {
      while (this.session === s) {
        const batch = s.queue[0]
        if (!batch) break
        this.startHead(s)
        this.render()
        const { result, sightings } = await s.player.play(batch.id, batch.actions)
        if (this.session !== s) break
        // It played as it did in memory, so the lines it typed are the ones later batches were rehearsed with.
        if (result.status === "completed" && batch.after) s.lines.adopt(batch.after.lines)
        for (const sighting of sightings) this.saw(s, s.lines, sighting)
        batch.state = "done"
        batch.result = result
        s.queue = s.queue.filter((b) => b !== batch)
        s.finished.push(result)
        if (result.status !== "completed") this.interrupt(s)
        // Mark the next batch as playing before reporting, so the report says so.
        this.startHead(s)
        this.update()
      }
    } finally {
      s.running = false
    }
  }

  private startHead(s: Session): void {
    const head = s.queue[0]
    if (head?.state !== "queued") return
    head.state = "playing"
    s.timeline.reset()
  }

  // ---- Shared selections ---------------------------------------------------

  private excerpt(s: Session, selection: SharedSelection): Excerpt {
    return { ...selection, file: this.displayPath(s, selection.file) }
  }

  private ref(selection: SharedSelection): Ref {
    return { file: this.editor.displayPath(selection.file), line: selection.from.line, endLine: selection.to.line }
  }

  // ---- Paths ---------------------------------------------------------------

  private resolvePath(s: Session, file: string): string {
    return agentPath(this.editor, s.scene.root, file)
  }

  private displayPath(s: Session, file: string): string {
    return displayPath(this.editor, s.scene.root, file)
  }

  // ---- Rendering -----------------------------------------------------------

  private cursorView(s: Session): CursorView | null {
    if (!s.scene.cursor) return null
    return s.scene.selection ? { ...s.scene.cursor, selection: s.scene.selection } : { ...s.scene.cursor }
  }

  private state(): AgentState {
    const s = this.session
    if (!s || s.scene.turn === "user") return "navigator"
    if (this.pauseReasons.size > 0) return "paused"
    if (s.queue.length > 0) return s.player.reading ? "read" : s.player.commandRunning ? "running" : "typing"
    return this.call?.kind === "listen" ? "listening" : "thinking"
  }

  private render(): void {
    this.onChange?.()
    const s = this.activeSession()
    const state = this.state()
    this.editor.renderCursor(s ? this.cursorView(s) : null, state, s?.scene.focus ?? "cursor")
    if (!s) return
    const paused = this.pauseReasons.size > 0
    const key = `${state}/${s.scene.turn}/${paused}`
    if (key === this.lastPosted) return
    this.lastPosted = key
    this.panel.post({ type: "state", state, turn: s.scene.turn, paused })
  }
}
