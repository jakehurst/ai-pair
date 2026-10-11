// The protocol state machine: sessions, the batch queue, and reports. Playing a batch is player.ts.
// See PROTOCOL.md for the rules implemented here.

import type { Action, BatchResult, Event, Excerpt, FileContent, Passage, PauseReason, Report, Turn } from '@ai-pair/protocol';
import { CURSOR_MARKER, ToolError } from '@ai-pair/protocol';
import { boundedDiff, lineChanges } from './diff';
import { LineIds, type Sighting } from './lines';
import { agentPath, displayPath, Player, type Scene } from './player';
import {
  MissingFile,
  type AgentState,
  type Change,
  type CursorView,
  type EditorPort,
  type PanelPort,
  type Ref,
  type SharedSelection,
} from './ports';
import { followChange, rehearse, type Rehearsal } from './rehearsal';
import { fileLines } from './text';
import { Timeline } from './timeline';
import { defaultConfig, type Config } from './config';
import { defaultTiming, glideDuration, withOverrides, type TimingOverrides } from './timing';

const UNANCHORED =
  'Your previous batch was interrupted or discarded, so your cursor is where it stopped, not where that batch would have ended. `read` the file, then start this batch with a `move` or `select` that gives both `file` and `line`.';

interface Batch {
  id: number;
  actions: Action[];
  state: 'queued' | 'playing' | 'done';
  result?: BatchResult;
  /** What it leaves behind, played in memory when it was queued: where the next batch is rehearsed from. */
  after?: Rehearsal;
}

/** Like `Event`, but edits usually get their diff when the report is taken. */
type PendingEvent = Exclude<Event, { kind: 'edit' }> | EditEvent;

/** `interrupted`: a change the programmer didn't make, to a file the playing or queued batches edit. */
interface EditEvent {
  kind: 'edit';
  file: string;
  by: 'programmer' | 'other';
  diff?: string;
  omitted?: number;
  interrupted?: true;
}

/** The first action at the cursor, and whether it anchors the cursor: a `move` or `select` giving both `file` and `line` (#112). */
interface CursorAnchor {
  /** The action's number in the batch, from 1. */
  index: number;
  action: Action;
  anchored: boolean;
}

/** A session as the window saves it across a reload, as JSON: what it needs to carry on (#25). */
export interface SavedSession {
  task?: string;
  scene: Pick<Scene, 'root' | 'turn' | 'cursor' | 'selection'> & { allowedCommands: string[] };
  finished: BatchResult[];
  events: Array<Exclude<Event, { kind: 'edit' }>>;
}

interface Session {
  task?: string;
  scene: Scene;
  player: Player;
  /** Batches not yet finished; the head may be playing. */
  queue: Batch[];
  /** Finished batches not yet reported. */
  finished: BatchResult[];
  events: PendingEvent[];
  /** An unreported interruption or failure: new batches are discarded. */
  stale: boolean;
  /** A report told the agent a batch stopped short: the next batch must anchor the cursor with a file and line (#112). */
  anchorNeeded: boolean;
  /** Rejections handed back by `restore`, to be reported again, one per report (#28), each marked if the agent may have seen it. */
  held: Array<{ rejected: NonNullable<Report['rejected']>; mayRepeat: boolean }>;
  /** A report restored may have reached the agent already: the next report says so (#67). */
  mayRepeat: boolean;
  /** Text of each file edited by the programmer, as of the last report. */
  baselines: Map<string, string>;
  latest: Map<string, string>;
  timeline: Timeline;
  running: boolean;
  /** A `run` waiting for the programmer's go-ahead. */
  confirming?: { id: number; command: string; decide: (run: boolean) => void };
  /** Ended by the programmer; the final report hasn't been delivered yet. */
  ended: boolean;
  /** Its agent disconnected, or the window reloaded: it waits for a `start` from its directory (#25). */
  suspended: boolean;
  navigatorReady: boolean;
  navigatorTimer?: ReturnType<typeof setTimeout>;
  /** The cursor's line as the agent last saw it in a report, so reports only show it when it changed. */
  seenCursor?: string;
  /** The identities of the lines of the files in the editor. */
  lines: LineIds;
  /** For each file, the line the agent was last shown at each number, by its identity. */
  seen: Map<string, Map<number, number>>;
}

interface Call {
  kind: 'step' | 'listen' | 'end';
  batch?: Batch;
  summary?: string;
  timer: ReturnType<typeof setTimeout>;
  resolve: (report: Report) => void;
  reject: (error: unknown) => void;
}

/**
 * Returns whether an event interrupts. Everything does, except changes the programmer didn't make to files no batch
 * is going to edit. An event it holds for is `Act` in specs/ListenGrace.tla.
 */
function interrupting(e: PendingEvent): boolean {
  return e.kind !== 'edit' || e.by === 'programmer' || e.interrupted === true;
}

/** Returns a report in one log line: its batches, events, flags, and size (#149). */
function describeReport(report: Report): string {
  const parts = [
    `batches [${report.batches.map((b) => `${b.id} ${b.status}`).join(', ')}]`,
    `events [${report.events.map((e) => (e.kind === 'edit' ? `edit ${e.file}` : e.kind)).join(', ')}]`,
  ];
  if (report.waiting) parts.push('waiting');
  if (report.paused) parts.push(`paused (${report.paused.join(', ')})`);
  if (report.rejected) parts.push(`rejected at action ${report.rejected.index}: ${report.rejected.error.kind}`);
  parts.push(`${JSON.stringify(report).length} chars`);
  return parts.join(', ');
}

/** Returns the first action at the cursor, and whether it anchors the cursor: a `move` or `select` giving both `file` and `line` (#112). */
function cursorAnchor(actions: Action[]): CursorAnchor | undefined {
  for (const [i, action] of actions.entries()) {
    if ('say' in action || 'run' in action || 'point' in action) continue;
    const place = 'move' in action ? action.move : 'select' in action ? action.select : undefined;
    return { index: i + 1, action, anchored: place?.file !== undefined && place?.line !== undefined };
  }
  return undefined;
}

/** Returns the error a cancelled call rejects with. */
function cancelled(): ToolError {
  return new ToolError('cancelled', 'The call was cancelled.');
}

export class Controller {
  private session: Session | null = null;
  /** The session the last report closed, until another starts: a report handed back puts it back. */
  private closed: Session | null = null;
  private call: Call | null = null;
  /** After a `listen` that timed out empty, the status stays "listening" until this fires (specs/ListenGrace.tla). */
  private grace: ReturnType<typeof setTimeout> | null = null;
  /** Armed while no call is open; when it fires, the status is "absent" (specs/ListenGrace.tla, `GoQuiet`, #149). */
  private quiet: ReturnType<typeof setTimeout> | null = null;
  private absent = false;
  /** Tool calls that have arrived and not settled: the quiet starts when the last one does. */
  private openCalls = 0;
  private chain: Promise<unknown> = Promise.resolve();
  private nextBatchId = 1;
  private readonly pauseReasons = new Set<PauseReason>();
  private speed = 1;
  private readingSpeed = 1;
  private lastPosted = '';
  /** After any change the session's `saved` form may have: the window saves it (#25). */
  onChange?: () => void;
  /** Where the session's interactions are logged: statuses, batches, pauses, interrupts, edits, reports (#149). */
  trace?: (line: string) => void;

  constructor(
    private readonly editor: EditorPort,
    private readonly panel: PanelPort,
    private config: Config = defaultConfig,
  ) {}

  // ---- Tools -------------------------------------------------------------

  /** Starts a session, or resumes a suspended one from the same directory. `rules`: the project guides the relay read for the agent, named for the panel (#23). */
  start(task?: string, root?: string, rules?: string[]): Promise<Report> {
    return this.serialize(undefined, async () => {
      // In the editor's spelling, so paths inside it are reported relative to it.
      const at = root && this.editor.resolvePath(root);
      const waiting = this.session;
      if (waiting?.suspended) {
        // Its agent is back, from its directory: it carries on where it left off (#25, specs/Resume.tla, `Start`).
        if (waiting.scene.root === at) return this.resumeSession(waiting, rules);
        // Another directory: another session, which ends the one waiting.
        this.close(waiting);
      } else if (waiting && !waiting.ended) {
        throw new ToolError('session_active', 'A pairing session is already active in this window.');
      }
      const scene: Scene = {
        root: at,
        turn: 'agent',
        cursor: null,
        selection: null,
        point: null,
        focus: 'cursor',
        pointFar: false,
        allowedCommands: new Set(),
      };
      this.open(task, scene);
      this.trace?.(`session started${task ? `: ${task}` : ''}`);
      this.panel.post({ type: 'session', active: true, task, ...(rules?.length ? { rules } : {}) });
      this.render();
      return { batches: [], events: [], turn: scene.turn };
    });
  }

  /**
   * Takes up a suspended session again: its turn, cursor, and history are as they were. The agent may
   * be a new conversation, so it has seen no lines: it reads them before it gives a line number.
   */
  private resumeSession(s: Session, rules?: string[]): Promise<Report> {
    s.suspended = false;
    this.trace?.('session resumed');
    s.seen = new Map();
    s.seenCursor = undefined;
    this.panel.post({ type: 'session', active: true, task: s.task, resumed: true, ...(rules?.length ? { rules } : {}) });
    this.render();
    return this.withCursor(s, { ...this.snapshot(s, undefined, /* waiting= */ false), resumed: true });
  }

  /** Opens a new session, the window's from now on. */
  private open(task: string | undefined, scene: Scene): Session {
    const timeline = new Timeline(this.pauseReasons.size > 0);
    const lines = LineIds.editor();
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
        render: () => {
          this.render();
        },
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
    };
    this.session = s;
    this.closed = null;
    this.lastPosted = '';
    return s;
  }

  /**
   * Returns the session as the window saves it in the workspace's storage, to bring it back suspended after a
   * reload (#25, specs/Resume.tla, `Save`); none once it has ended. Edits aren't kept: their diffs need the
   * text from before them, and the agent reads its files again when it resumes.
   */
  get saved(): SavedSession | undefined {
    const s = this.session;
    if (!s || s.ended) return undefined;
    const { root, turn, cursor, selection } = s.scene;
    return {
      task: s.task,
      scene: { root, turn, cursor, selection, allowedCommands: [...s.scene.allowedCommands] },
      finished: s.finished,
      events: s.events.filter((e): e is Exclude<Event, { kind: 'edit' }> => e.kind !== 'edit'),
    };
  }

  /** Revives, after a reload, the session the window saved, suspended until its agent's `start` (#25). */
  revive(saved: SavedSession): void {
    if (this.session) return;
    const scene: Scene = {
      ...saved.scene,
      point: null,
      focus: 'cursor',
      pointFar: false,
      allowedCommands: new Set(saved.scene.allowedCommands),
    };
    const s = this.open(saved.task, scene);
    s.suspended = true;
    this.trace?.('session revived after a reload, suspended');
    s.finished = [...saved.finished];
    s.events = [...saved.events];
    // specs/Resume.tla, `Reload`: the replayed history may end with the session live (#138).
    this.panel.post({ type: 'session', active: true, task: s.task, suspended: true });
    this.render();
  }

  step(actions: Action[], signal?: AbortSignal): Promise<Report> {
    return this.serialize(signal, async () => {
      const s = this.requireSession();
      // An empty batch only waits for the queued ones, so it isn't a batch of its own.
      if (actions.length === 0) return this.block('step', {}, signal);
      // After a report said a batch stopped short, the first action at the cursor must anchor it (#112,
      // specs/Anchor.tla, `SubmitAnchored` and `SubmitUnanchored`).
      const anchor = cursorAnchor(actions);
      if (s.anchorNeeded && anchor && !anchor.anchored) return this.rejectUnanchored(s, anchor);
      // Played in memory first, so what would fail is reported now, not when the batch plays (specs/Controller.tla, `Submit`).
      const rehearsal = s.stale || s.ended ? undefined : await this.rehearse(s, actions);
      // An interruption arriving meanwhile discards it, like any batch planned without knowing about it
      // (specs/Controller.tla: `FailRehearsal`, else `PassRehearsal`).
      const current = rehearsal && !s.stale && !s.ended;
      // specs/Serialize.tla: `Reject` answers with the rejection; `Rehearse` queues the batch, or discards it.
      if (current && rehearsal.result.status === 'failed') return this.rejectBatch(s, actions, rehearsal);
      const batch: Batch = { id: this.nextBatchId++, actions, state: 'queued', after: rehearsal?.after };
      if (current) {
        s.queue.push(batch);
        this.trace?.(`batch ${batch.id} queued: ${actions.length} actions`);
        if (anchor?.anchored) s.anchorNeeded = false;
        this.kick(s);
      } else {
        this.discard(s, batch);
      }
      return this.block('step', { batch }, signal);
    });
  }

  /** Blocks until there is something to report: `Listen` in specs/Controller.tla. */
  listen(signal?: AbortSignal): Promise<Report> {
    return this.serialize(signal, () => {
      this.requireSession();
      return this.block('listen', {}, signal);
    });
  }

  /** Ends the session, the agent's way: specs/Resume.tla, `EndByAgent`. */
  end(summary?: string, signal?: AbortSignal): Promise<Report> {
    return this.serialize(signal, () => {
      this.requireSession();
      return this.block('end', { summary }, signal);
    });
  }

  /** Reads a file. Not serialized like the other tools: `read` "does not block and does not deliver events" (PROTOCOL.md). */
  async read(file: string, fromLine?: number, toLine?: number): Promise<FileContent> {
    const s = this.requireSession();
    // `Call` and `GoQuiet` in specs/ListenGrace.tla: a read is a call too, settled at once.
    if (this.openCalls === 0) this.startQuiet();
    const path = this.resolvePath(s, file);
    const planned = this.planned(s, path);
    const text = planned?.text ?? (await this.textOrMissing(s, path));
    const { lines, finalNewline } = fileLines(text);
    const from = Math.max(1, fromLine ?? 1);
    const to = Math.min(lines.length, toLine ?? lines.length);
    const numbers = Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);
    // As the queued batches leave the file, if they edit it (specs/Rehearsal.tla, `Read`).
    this.saw(s, planned?.lines ?? s.lines, { file: path, text, lines: numbers });
    const content: FileContent = {
      file: this.displayPath(s, path),
      dirty: await this.editor.isDirty(path),
      lines: lines.slice(from - 1, to).map((line, i) => ({ number: from + i, text: line })),
    };
    if (to === lines.length) content.end = { final_newline: finalNewline };
    return content;
  }

  /** Returns the file's text; a file that doesn't exist is the agent's to create, with a `move` (#89). */
  private async textOrMissing(s: Session, path: string): Promise<string> {
    try {
      return await this.editor.getText(path);
    } catch (e) {
      if (!(e instanceof MissingFile)) throw e;
      throw new ToolError('invalid_arguments', `${this.displayPath(s, path)} doesn't exist. A \`move\` to it creates it, empty.`);
    }
  }

  /**
   * Returns the text of a file as it will be once the queued batches have played, if they edit it, with
   * the identities of its lines then: they were played in memory when queued. Not after an interruption,
   * which discards what they'd do.
   */
  private planned(s: Session, path: string): { text: string; lines: LineIds } | undefined {
    // specs/Rehearsal.tla, `Read`: while `stale`, the editor's text.
    if (s.stale) return undefined;
    const after = s.queue.at(-1)?.after;
    const text = after?.texts.get(path);
    return after && text !== undefined ? { text, lines: after.lines } : undefined;
  }

  /**
   * Puts a report back to be delivered again. For a report that raced with a cancellation: the
   * call returned just before the cancellation arrived, so the agent never saw the report.
   * `mayRepeat`: or the cancellation came after the answer, and the agent may have seen it (#67).
   */
  restore(report: Report, mayRepeat = false): void {
    // `Restore` in specs/Controller.tla. Also once the session ended, or the report closed it: the next call takes the report again,
    // and closes the session again (#60).
    const s = this.session ?? this.closed;
    if (!s) return;
    if (!this.session) {
      s.ended = true;
      this.session = s;
      this.closed = null;
    }
    s.finished.unshift(...report.batches);
    s.events.unshift(...report.events);
    if (mayRepeat) s.mayRepeat = true;
    if (report.events.some(interrupting) || report.batches.some((b) => b.status !== 'completed')) s.stale = true;
    // A step that never queued its batch: its rejection is the only report of it.
    if (report.rejected) {
      s.held.push({ rejected: report.rejected, mayRepeat });
      s.stale = true;
    }
    this.update();
  }

  // ---- Programmer input --------------------------------------------------

  /**
   * Records a message from the programmer. `selection`: code they had selected, sent along with it. To an active or a suspended session
   * (specs/Resume.tla, `SendMessage`); the next report takes it to the agent (`Report`).
   */
  userMessage(text: string, selection?: SharedSelection): void {
    const s = this.activeSession();
    if (!s) return;
    s.events.push(selection ? { kind: 'message', text, selection: this.excerpt(s, selection) } : { kind: 'message', text });
    this.panel.post({ type: 'user', text, ref: selection && this.ref(selection) });
    this.interrupt(s);
    this.update();
  }

  userInterrupt(): void {
    const s = this.activeSession();
    if (!s) return;
    s.events.push({ kind: 'interrupt' });
    this.panel.post({ type: 'interrupt' });
    this.interrupt(s);
    this.update();
  }

  /** Records a change the programmer made. `changes` are applied in order, each to the result of the previous. */
  userEdit(file: string, before: string, after: string, changes: Change[]): void {
    const s = this.activeSession();
    if (!s) return;
    this.recordEdit(s, file, before, after, changes, 'programmer');
    if (s.scene.turn === 'agent') {
      // specs/Player.tla, `TypeBefore` and `TypeAfter`: the edit interrupts playback.
      this.interrupt(s);
    } else {
      // Interrupting nothing (specs/Controller.tla, `EditQuietly`). Typing again: the pause the timer marked is
      // over, so wait for the next (specs/Navigator.tla, `Edit`).
      s.navigatorReady = false;
      clearTimeout(s.navigatorTimer);
      s.navigatorTimer = setTimeout(() => {
        // specs/Navigator.tla, `Fire`.
        s.navigatorReady = true;
        this.pump();
      }, this.config.navigatorIdleMs);
    }
    this.update();
  }

  /**
   * Records a change the programmer didn't make: by a tool, a formatter, or on disk. It interrupts if the
   * playing or queued batches edit the file, since they were planned against the text before it.
   * Otherwise it's just reported, and the queued rehearsals follow it. A file changed
   * on disk: specs/Reload.tla, `Reload`.
   */
  otherEdit(file: string, before: string, after: string, reported: Change[]): void {
    const s = this.activeSession();
    if (!s) return;
    // A file reloaded from disk comes as one change spanning lines that didn't change (#65).
    const changes = lineChanges(before, reported);
    const planned = s.queue.some((b) => b.after?.edits.has(file));
    // The queued rehearsals follow it, reading the file's line identities from the editor (specs/Rehearsal.tla,
    // `EditAsOther`).
    if (!planned) {
      for (const b of s.queue) {
        if (b.after) followChange(b.after, file, after, changes);
      }
    }
    this.recordEdit(s, file, before, after, changes, 'other');
    if (planned) {
      const e = s.events.find((p): p is EditEvent => p.kind === 'edit' && p.file === file && p.diff === undefined);
      if (e) e.interrupted = true;
      this.interrupt(s);
    }
    this.update();
  }

  /** Records an edit. Edits to a file are reported as one diff, as the programmer's if any of them was
   * (specs/EditEvents.tla: `Record`, for `EditAsProgrammer` and `EditAsOther`). */
  private recordEdit(s: Session, file: string, before: string, after: string, changes: Change[], by: EditEvent['by']): void {
    s.lines.of(file, before);
    for (const change of changes) {
      s.player.transform(file, change);
      s.lines.apply(file, change);
    }
    if (!s.baselines.has(file)) {
      s.baselines.set(file, before);
      s.events.push({ kind: 'edit', file, by });
      this.trace?.(`edit ${file} by ${by}`);
    } else if (by === 'programmer') {
      const pending = s.events.find((e): e is EditEvent => e.kind === 'edit' && e.file === file && e.diff === undefined);
      if (pending) pending.by = 'programmer';
    }
    s.latest.set(file, after);
  }

  takeTurn(): void {
    const s = this.activeSession();
    if (!s || s.scene.turn === 'user') return;
    s.scene.turn = 'user';
    s.scene.focus = 'cursor';
    s.events.push({ kind: 'turn', to: 'user' });
    this.panel.post({ type: 'turn', to: 'user' });
    // specs/Turns.tla, `ChangeTurn`: the turn changes, and playback is interrupted.
    this.interrupt(s);
    this.update();
  }

  handBack(message?: string, selection?: SharedSelection): void {
    const s = this.activeSession();
    if (!s || s.scene.turn === 'agent') return;
    s.scene.turn = 'agent';
    clearTimeout(s.navigatorTimer);
    const event: Event = { kind: 'turn', to: 'agent' };
    if (message) event.message = message;
    if (selection) event.selection = this.excerpt(s, selection);
    s.events.push(event);
    this.panel.post({ type: 'turn', to: 'agent', message, ref: selection && this.ref(selection) });
    // specs/Turns.tla, `ChangeTurn`: the turn changes, and playback is interrupted.
    this.interrupt(s);
    this.update();
  }

  /** Ends the session, the programmer's way, active or suspended: specs/Resume.tla, `EndByProgrammer`. */
  endSession(): void {
    const s = this.activeSession();
    if (!s) return;
    if (s.suspended) {
      // No agent is there to take a final report: it's over now (specs/Bridge.tla, `EndSuspended`).
      this.close(s);
      this.panel.post({ type: 'session', active: false, reason: 'user' });
      return;
    }
    // `EndSession` in specs/Bridge.tla and specs/Controller.tla: its last report, to the owner's next call, closes it.
    s.ended = true;
    s.events.push({ kind: 'end' });
    this.interrupt(s);
    this.panel.post({ type: 'session', active: false, reason: 'user' });
    this.update();
  }

  /**
   * Suspends the session: the agent is gone (the relay disconnected), so it waits for a `start` from its
   * directory, or for the programmer to end it (#25, specs/Resume.tla, `Disconnect`).
   */
  disconnect(): void {
    const s = this.session;
    this.closed = null;
    if (this.call) {
      clearTimeout(this.call.timer);
      this.call.reject(new ToolError('no_session', 'Disconnected.'));
      this.call = null;
    }
    if (!s) return;
    if (s.ended) {
      this.close(s);
      return;
    }
    // Nothing plays without its agent: what's queued is discarded, and reported once it's back.
    this.interrupt(s);
    s.suspended = true;
    this.trace?.('session suspended: the agent disconnected');
    this.panel.post({ type: 'session', active: true, task: s.task, suspended: true });
    this.update();
  }

  /** Adds a pause reason, and pauses playback (specs/Timeline.tla, `Pause`). */
  pause(reason: PauseReason = 'user'): void {
    if (!this.pauseReasons.has(reason)) this.trace?.(`pause ${reason}`);
    this.pauseReasons.add(reason);
    this.session?.timeline.pause();
    this.render();
  }

  /**
   * Removes one pause reason, or all of them. Playback continues when none are left (specs/Timeline.tla, `Resume`).
   * `reveal`: bring the view back to what it follows, as the Resume button does; a reply doesn't (specs/PointFocus.tla,
   * `Reply`, issue 125).
   */
  resume(reason?: PauseReason, { reveal = true }: { reveal?: boolean } = {}): void {
    if (this.pauseReasons.size === 0) return;
    const lookedAway = this.pauseReasons.has('away');
    if (reason === undefined || this.pauseReasons.has(reason)) this.trace?.(`resume ${reason ?? 'all'}`);
    if (reason === undefined) {
      this.pauseReasons.clear();
    } else {
      this.pauseReasons.delete(reason);
    }
    if (this.pauseReasons.size > 0) return;
    const s = this.session;
    if (s) {
      // A point the programmer looked away from is stale: from now on the view follows the cursor,
      // not it (specs/PointFocus.tla). The editor is told before a reveal targets it.
      if (lookedAway && s.scene.focus === 'point') {
        s.scene.focus = 'cursor';
        this.render();
      }
      if (reveal && s.scene.turn === 'agent' && (s.scene.cursor || s.scene.point)) this.editor.reveal();
      s.timeline.resume();
    }
    this.render();
  }

  setSpeed(speed: number): void {
    this.speed = speed;
  }

  /** Returns how long follow mode's scroll glides over `lines` lines, at the playback speed (#123). */
  glideMs(lines: number): number {
    return glideDuration(this.config.timing, lines, this.speed);
  }

  setReadingSpeed(speed: number): void {
    this.readingSpeed = speed;
  }

  setConfirmCommands(confirm: boolean): void {
    this.config = { ...this.config, confirmCommands: confirm };
  }

  /** Resolves a path the agent gave against the session's root: for a file the bridge reads itself. */
  resolveFile(file: string): string {
    return this.resolvePath(this.requireSession(), file);
  }

  /** The extension's reading speed calibration: false while one is under way (#109, specs/Calibration.tla). */
  onCalibrate?: (passage: Passage) => boolean;

  /** Hands a passage of the agent's own to the calibration: its `calibrate` tool. */
  calibrate(passage: Passage): Report {
    const s = this.requireSession();
    if (!this.onCalibrate) throw new ToolError('no_editor', 'This editor has no reading speed calibration.');
    if (!this.onCalibrate(passage)) throw new ToolError('calibration_busy', 'A calibration is already under way in the Pair panel.');
    return { batches: [], events: [], turn: s.scene.turn };
  }

  /**
   * Takes the programmer's answer to a `run` waiting for confirmation. `remember`: run exactly this
   * command without asking for the rest of the session.
   */
  decideRun(id: number, run: boolean, remember = false): void {
    const s = this.session;
    if (!s) return;
    const c = s.confirming;
    if (c?.id !== id) return;
    if (run && remember) s.scene.allowedCommands.add(c.command);
    c.decide(run);
  }

  /** Waits for the programmer's answer to a `run`, or an interruption. */
  private confirm(s: Session, id: number, command: string): Promise<boolean> {
    const signal = s.timeline.signal;
    // An interrupt during the save before it: the abort event has fired already.
    if (signal.aborted) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      function abort(): void {
        resolve(false);
      }
      s.confirming = {
        id,
        command,
        decide: (run) => {
          signal.removeEventListener('abort', abort);
          resolve(run);
        },
      };
      signal.addEventListener('abort', abort, { once: true });
    }).finally(() => {
      s.confirming = undefined;
    });
  }

  /** Sets the timing: the calibration's overrides on top of the default. */
  setTiming(overrides: TimingOverrides): void {
    this.config = { ...this.config, timing: withOverrides(defaultTiming, overrides) };
  }

  /** Returns whether the session's agent is gone, so a `start` from its directory takes it up again (#25). */
  get isSuspended(): boolean {
    return this.session?.suspended === true;
  }

  get isActive(): boolean {
    return this.activeSession() !== null;
  }

  get isPaused(): boolean {
    return this.pauseReasons.size > 0;
  }

  get turn(): Turn | null {
    return this.activeSession()?.scene.turn ?? null;
  }

  // ---- Calls and reports -------------------------------------------------

  /** Runs tool calls one at a time. A call cancelled while waiting its turn never runs. */
  private serialize<T>(signal: AbortSignal | undefined, fn: () => Promise<T>): Promise<T> {
    // `Call` in specs/ListenGrace.tla: the agent is calling, so it's listening.
    this.openCalls++;
    this.endQuiet();
    // specs/Serialize.tla, `Guard`: a call runs once the one before it has settled, unless it was aborted.
    function guarded(): Promise<T> {
      return signal?.aborted ? Promise.reject(cancelled()) : fn();
    }
    const run = this.chain.then(guarded, guarded);
    this.chain = run.catch(() => {});
    // `GoQuiet` in specs/ListenGrace.tla: once the last open call settles, no call is open until the agent makes the next.
    const settled = () => {
      this.openCalls--;
      if (this.openCalls === 0 && this.session) this.startQuiet();
    };
    void run.then(settled, settled);
    return run;
  }

  /** Plays a batch in memory, from where the queued batches leave off, or the editor as it is (specs/Rehearsal.tla, `Submit`). */
  private rehearse(s: Session, actions: Action[]): ReturnType<typeof rehearse> {
    const from = s.queue.at(-1)?.after ?? { scene: s.scene, texts: new Map(), lines: s.lines, edits: new Set<string>() };
    return rehearse(this.editor, this.config, from, actions, (file, line, id) => s.seen.get(file)?.get(line) === id);
  }

  /** Reports a batch that played in memory failed, without queuing it; nothing else changes. */
  private async rejectBatch(s: Session, actions: Action[], rehearsal: Awaited<ReturnType<typeof rehearse>>): Promise<Report> {
    const rehearsed = rehearsal.result;
    const index = actions.length - (rehearsed.unplayed?.length ?? 0) + 1;
    const action = actions[index - 1];
    const { error } = rehearsed;
    if (action === undefined || error === undefined) {
      throw new Error(`The rehearsal failed at action ${index} of ${actions.length}, but recorded no error.`);
    }
    const rejected: NonNullable<Report['rejected']> = { index, action, error };
    if (rehearsed.code) rejected.code = rehearsed.code;
    for (const sighting of rehearsal.sightings) {
      this.saw(s, rehearsal.after.lines, sighting);
    }
    const report = { ...this.snapshot(s, undefined, /* waiting= */ false), rejected };
    this.trace?.(`report to step: ${describeReport(report)}`);
    this.render();
    return this.withCursor(s, report);
  }

  /** Reports a batch refused for not anchoring the cursor after a discarded one, without queuing it (#112, specs/Anchor.tla). */
  private rejectUnanchored(s: Session, anchor: CursorAnchor): Promise<Report> {
    const error = { kind: 'unanchored' as const, message: UNANCHORED };
    const rejected = { index: anchor.index, action: anchor.action, error };
    const report = { ...this.snapshot(s, undefined, /* waiting= */ false), rejected };
    this.trace?.(`report to step: ${describeReport(report)}`);
    this.render();
    return this.withCursor(s, report);
  }

  private requireSession(): Session {
    if (!this.session) {
      throw new ToolError('no_session', 'No pairing session is active. Call `start` to begin one.');
    }
    return this.session;
  }

  private activeSession(): Session | null {
    return this.session && !this.session.ended ? this.session : null;
  }

  /**
   * Blocks until the call is ready to report. Cancelling releases the call without taking a
   * report, so nothing is lost: a submitted batch stays queued and is reported on the next call.
   */
  private block(kind: Call['kind'], opts: { batch?: Batch; summary?: string }, signal?: AbortSignal): Promise<Report> {
    // An abort that fired while the batch was rehearsed won't fire again (specs/Serialize.tla, `Rehearse`).
    if (signal?.aborted) return Promise.reject(cancelled());
    return new Promise((resolve, reject) => {
      const call: Call = {
        kind,
        ...opts,
        resolve,
        reject,
        // specs/Navigator.tla, `Timeout`, for a listen; specs/Serialize.tla, `TimeOut`.
        timer: setTimeout(() => {
          this.finishCall(/* timedOut= */ true);
        }, this.config.maxBlockMs),
      };
      this.endGrace();
      this.call = call;
      // specs/Serialize.tla, `Abort`: the listener releases the call only while it is this.call.
      // `Cancel` in specs/Controller.tla: a blocked call is released at once.
      signal?.addEventListener('abort', () => {
        if (this.call !== call) return;
        this.call = null;
        clearTimeout(call.timer);
        reject(cancelled());
        this.render();
      });
      this.update();
    });
  }

  private ready(call: Call, s: Session): boolean {
    if (s.ended) return true;
    // An interrupted batch finishes promptly; wait for it, so the report says what was typed.
    if (s.queue[0]?.state === 'playing' && s.timeline.isInterrupted) return false;
    switch (call.kind) {
      case 'step':
        // specs/Serialize.tla, `Finish`: a step's batch is done, or plays next (`AtHead`): the step returns once the one before it
        // has (#150).
        if (!call.batch) return s.queue.length === 0;
        return call.batch.state === 'done' || s.queue[0] === call.batch;
      case 'end':
        return s.queue.length === 0;
      case 'listen':
        if (s.held.length > 0) return true;
        if (s.finished.some((r) => r.status !== 'completed')) return true;
        if (s.queue.length > 0) return false;
        if (s.scene.turn === 'agent') return s.events.some(interrupting);
        // The programmer's edits during their turn wait until they pause typing (specs/Navigator.tla, `Return`).
        return s.events.some((e) => e.kind !== 'edit') || (s.navigatorReady && s.events.some(interrupting));
      default:
        throw new Error(`Unknown call: ${JSON.stringify(call.kind satisfies never)}`);
    }
  }

  private pump(): void {
    const call = this.call;
    const s = this.session;
    // specs/Serialize.tla, `Finish`.
    if (call && s && this.ready(call, s)) this.finishCall(/* timedOut= */ false);
  }

  /** Finishes the open call with a report: `Return` in specs/ListenGrace.tla, or `TimeOut` for a listen that comes back with nothing to act on. */
  private finishCall(timedOut: boolean): void {
    const call = this.call;
    if (!call) return;
    // specs/Serialize.tla, `Commit`.
    this.call = null;
    clearTimeout(call.timer);
    const s = this.session;
    if (!s) {
      call.reject(new ToolError('no_session', 'The session has ended.'));
      return;
    }
    // `Commit` in specs/Controller.tla. Nothing more to wait for once the session is ending.
    const report = this.snapshot(s, call.batch, timedOut && !s.ended && call.kind !== 'end');
    // An ended session stays until its held rejections are out, one per report (specs/Controller.tla, `Commit` with DrainHeld).
    const closing = (s.ended && s.held.length === 0) || call.kind === 'end';
    if (closing) {
      // specs/Bridge.tla, `CloseEnded`, or `CallEnd` for the agent's `end`; `this.closed` is `recent`.
      this.close(s);
      this.closed = s;
      if (call.kind === 'end' && !s.ended) {
        this.panel.post({ type: 'session', active: false, reason: 'agent', summary: call.summary });
      }
    }
    // `TimeOut` in specs/ListenGrace.tla: nothing came back for the agent to act on.
    const empty = report.batches.length === 0 && report.events.length === 0 && !report.rejected;
    if (call.kind === 'listen' && report.waiting && empty) this.startGrace();
    this.render();
    this.trace?.(`report to ${call.kind}: ${describeReport(report)}`);
    // specs/Serialize.tla, `Resolve`: the report is handed back after the commit.
    // `Answer` in specs/Controller.tla, unless the agent canceled meanwhile: the relay hands the report back (`Bounce`).
    void this.withCursor(s, report).then(call.resolve, () => {
      call.resolve(report);
    });
  }

  /** Starts the grace: the agent is only waiting, so "listening" stays a while (`TimeOut` and `Expire` in specs/ListenGrace.tla). */
  private startGrace(): void {
    this.endGrace();
    this.grace = setTimeout(() => {
      this.grace = null;
      this.render();
    }, this.config.listenGraceMs);
  }

  /** Ends the grace: a new call does (`Call` in specs/ListenGrace.tla). */
  private endGrace(): void {
    if (this.grace) clearTimeout(this.grace);
    this.grace = null;
  }

  /** Starts the quiet: with no call open for absentMs, the agent isn't listening (`GoQuiet` in specs/ListenGrace.tla, #149). */
  private startQuiet(): void {
    this.endQuiet();
    this.quiet = setTimeout(() => {
      this.quiet = null;
      this.absent = true;
      this.render();
    }, this.config.absentMs);
  }

  /** Ends the quiet: a new call does (`Call` in specs/ListenGrace.tla). */
  private endQuiet(): void {
    if (this.quiet) clearTimeout(this.quiet);
    this.quiet = null;
    if (!this.absent) return;
    this.absent = false;
    this.render();
  }

  /** Adds the cursor's line to the report, unless it's where the agent last saw it, in a report's code or cursor. */
  private async withCursor(s: Session, report: Report): Promise<Report> {
    for (const b of report.batches) {
      const line = b.code?.lines.find((l) => l.text.includes(CURSOR_MARKER));
      if (b.code && line) s.seenCursor = `${b.code.file}:${line.number}:${line.text}`;
    }
    if (!s.scene.cursor) return report;
    const shown = await s.player.code({ moved: true });
    const line = shown?.code.lines.find((l) => l.text.includes(CURSOR_MARKER));
    if (!shown || !line) return report;
    const key = `${shown.code.file}:${line.number}:${line.text}`;
    if (key === s.seenCursor) return report;
    s.seenCursor = key;
    this.saw(s, s.lines, shown.sighting);
    return { ...report, cursor: shown.code };
  }

  /**
   * Records that the agent was shown lines: it knows which line each number is, while it stays that line's.
   * `lines`: of the version shown, which may be a batch's, as it will play or would have.
   */
  private saw(s: Session, lines: LineIds, { file, text, lines: numbers }: Sighting): void {
    const ids = lines.of(file, text);
    let seen = s.seen.get(file);
    if (!seen) {
      seen = new Map<number, number>();
      s.seen.set(file, seen);
    }
    for (const n of numbers) {
      const id = ids[n - 1];
      if (id !== undefined) seen.set(n, id);
    }
  }

  /** Takes everything not yet reported. `submitted`: the batch the call submitted, if any. */
  private snapshot(s: Session, submitted: Batch | undefined, waiting: boolean): Report {
    const batches = s.finished.toSorted((a, b) => a.id - b.id);
    // The agent planned against where these would have ended; the cursor is where they stopped (#112,
    // specs/Anchor.tla, `Discard`; a batch that completed is `Complete`).
    if (batches.some((b) => b.status !== 'completed')) s.anchorNeeded = true;
    const events: Event[] = [];
    for (const e of s.events) {
      if (e.kind !== 'edit') {
        events.push(e);
        continue;
      }
      if (e.diff !== undefined) {
        events.push({ kind: 'edit', file: e.file, diff: e.diff, by: e.by, ...(e.omitted === undefined ? {} : { omitted: e.omitted }) });
        continue;
      }
      const before = s.baselines.get(e.file) ?? '';
      const after = s.latest.get(e.file) ?? before;
      // An edit that interrupted stays, with no diff, though it was undone: the agent has to know
      // why its batches were discarded, and a `listen` woke for it (specs/EditEvents.tla, `Report`).
      if (before === after && !interrupting(e)) continue;
      const file = this.displayPath(s, e.file);
      if (before === after) {
        events.push({ kind: 'edit', file, diff: '', by: e.by });
      } else {
        events.push({ kind: 'edit', file, ...boundedDiff(file, before, after), by: e.by });
      }
    }
    s.finished = [];
    s.events = [];
    s.baselines = new Map();
    s.latest = new Map();
    // specs/Rehearsal.tla, `Report`: the agent now knows of the interrupt.
    s.stale = false;
    s.navigatorReady = false;

    const report: Report = { batches, events, turn: s.scene.turn };
    const b = submitted;
    if (b && b.state !== 'done') report.submitted = { id: b.id, status: b.state };
    if (waiting) report.waiting = true;
    // The agent's batches are held: it's told why, so it can say so or wait (#149).
    if (this.pauseReasons.size > 0) report.paused = [...this.pauseReasons];
    if (s.mayRepeat) report.repeated = true;
    s.mayRepeat = false;
    // A rejection handed back by `restore`, one per report: while more are held, new batches are still discarded.
    const held = s.held.shift();
    if (held) report.rejected = held.rejected;
    // Its own mark: a report before it may have taken s.mayRepeat (specs/Controller.tla, `Commit` with MarkHeld).
    if (held?.mayRepeat) report.repeated = true;
    if (s.held.length > 0) s.stale = true;
    return report;
  }

  private close(s: Session): void {
    this.trace?.('session closed');
    if (this.session === s) this.session = null;
    s.timeline.interrupt();
    clearTimeout(s.navigatorTimer);
    this.endGrace();
    this.endQuiet();
    this.editor.renderPoint(null);
    this.render();
  }

  // ---- Queue ---------------------------------------------------------------

  private discard(s: Session, batch: Batch): void {
    batch.state = 'done';
    batch.result = { id: batch.id, status: 'discarded', unplayed: batch.actions };
    s.finished.push(batch.result);
    this.trace?.(`batch ${batch.id} discarded`);
  }

  /** Stops playback and discards everything queued behind it (specs/Controller.tla: `Interrupted`, in `Interrupt` and `EndSession`).
   * A batch already playing plays on and may complete (specs/Rehearsal.tla, `Interrupted`, #151). */
  private interrupt(s: Session): void {
    s.stale = true;
    const discarded = s.queue.filter((b) => b.state === 'queued').map((b) => b.id);
    const playing = s.queue.find((b) => b.state === 'playing');
    this.trace?.(`interrupt: discarding [${discarded.join(', ')}]${playing ? `, batch ${playing.id} plays on` : ''}`);
    for (const b of s.queue) {
      if (b.state === 'queued') this.discard(s, b);
    }
    s.queue = s.queue.filter((b) => b.state !== 'done');
    s.timeline.interrupt();
  }

  private update(): void {
    this.render();
    this.pump();
  }

  // ---- Playback ------------------------------------------------------------

  private kick(s: Session): void {
    if (!s.running) void this.run(s);
  }

  private async run(s: Session): Promise<void> {
    s.running = true;
    try {
      while (this.session === s) {
        const batch = s.queue[0];
        if (!batch) break;
        // specs/Controller.tla: `Play`, then `Finish` once it has played.
        this.startHead(s);
        this.render();
        const { result, sightings } = await s.player.play(batch.id, batch.actions);
        if (this.session !== s) break;
        // It played as it did in memory, so the lines it typed are the ones later batches were rehearsed with
        // (specs/Rehearsal.tla, `Play`).
        if (result.status === 'completed' && batch.after) s.lines.adopt(batch.after.lines);
        for (const sighting of sightings) {
          this.saw(s, s.lines, sighting);
        }
        // specs/Serialize.tla, `Play`: batches finish in queue order.
        batch.state = 'done';
        batch.result = result;
        this.trace?.(`batch ${batch.id} ${result.status}`);
        s.queue = s.queue.filter((b) => b !== batch);
        s.finished.push(result);
        // specs/Rehearsal.tla, `FailPlay`: a batch that didn't complete interrupts the queue behind it.
        if (result.status !== 'completed') this.interrupt(s);
        // Mark the next batch as playing before reporting, so the report says so.
        this.startHead(s);
        this.update();
      }
    } finally {
      s.running = false;
    }
  }

  private startHead(s: Session): void {
    const head = s.queue[0];
    if (head?.state !== 'queued') return;
    head.state = 'playing';
    this.trace?.(`batch ${head.id} playing`);
    s.timeline.reset();
  }

  // ---- Shared selections ---------------------------------------------------

  private excerpt(s: Session, selection: SharedSelection): Excerpt {
    return { ...selection, file: this.displayPath(s, selection.file) };
  }

  private ref(selection: SharedSelection): Ref {
    return { file: this.editor.displayPath(selection.file), line: selection.from.line, endLine: selection.to.line };
  }

  // ---- Paths ---------------------------------------------------------------

  private resolvePath(s: Session, file: string): string {
    return agentPath(this.editor, s.scene.root, file);
  }

  private displayPath(s: Session, file: string): string {
    return displayPath(this.editor, s.scene.root, file);
  }

  // ---- Rendering -----------------------------------------------------------

  private cursorView(s: Session): CursorView | null {
    if (!s.scene.cursor) return null;
    return s.scene.selection ? { ...s.scene.cursor, selection: s.scene.selection } : { ...s.scene.cursor };
  }

  private state(): AgentState {
    const s = this.session;
    if (!s || s.scene.turn === 'user') return 'navigator';
    if (this.pauseReasons.size > 0) return 'paused';
    if (s.queue.length > 0) return s.player.reading ? 'read' : s.player.commandRunning ? 'running' : 'typing';
    // `Status` in specs/ListenGrace.tla: with the queue empty, "listening" during a listen or its grace, then "absent" once quiet.
    const waiting = this.grace !== null && !s.events.some(interrupting);
    return this.call?.kind === 'listen' || waiting ? 'listening' : this.absent ? 'absent' : 'thinking';
  }

  private render(): void {
    this.onChange?.();
    const s = this.activeSession();
    const state = this.state();
    this.editor.renderCursor(s ? this.cursorView(s) : null, state, s?.scene.focus ?? 'cursor');
    if (!s) return;
    const paused = this.pauseReasons.size > 0;
    const key = `${state}/${s.scene.turn}/${paused}`;
    if (key === this.lastPosted) return;
    this.lastPosted = key;
    this.trace?.(`status ${state}, ${s.scene.turn}'s turn${paused ? ', paused' : ''}`);
    this.panel.post({ type: 'state', state, turn: s.scene.turn, paused });
  }
}
