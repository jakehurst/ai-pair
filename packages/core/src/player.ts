// Playing batches: what each action does, at a human pace. The same code plays a batch in the
// programmer's editor and, to check it before it's queued, in memory (see rehearsal.ts).

import * as nodePath from 'node:path';
import {
  actionKinds,
  CURSOR_MARKER,
  fieldsProblem,
  typeProblem,
  withinFolder,
  type Action,
  type BatchError,
  type BatchResult,
  type Candidate,
  type Code,
  type ErrorKind,
  type RunResult,
  type SpanTarget,
  type Turn,
} from '@ai-pair/protocol';
import { MS_PER_SECOND } from './constants';
import { resolveSpan, resolveSpot, spanCandidates, spotCandidates, type Resolution } from './places';
import type { Config } from './config';
import type { LineIds, Sighting } from './lines';
import type { Change, Focus, PanelPort, PlayerEditor } from './ports';
import { fileLines, isLineStart, lineEnd, lineText, position } from './text';
import type { Pacing } from './timeline';
import { planTyping, readingTime } from './typing';

/** A report's code longer than this skips lines in the middle. */
const MAX_CODE_LINES = 40;

/** Lines of context around a report's code, above and below. */
const CONTEXT_LINES = 3;

const ok: Outcome = { kind: 'ok' };
const nothing: Outcome = { kind: 'ok', nothing: true };

/** Shared by all players, so the panel never sees two commands with one id. */
let nextRunId = 1;

/** What playback reads and changes. */
export interface Scene {
  /** The agent's working directory, if it gave one: paths to and from the agent are relative to it. */
  root?: string;
  turn: Turn;
  cursor?: { file: string; offset: number };
  selection?: { start: number; end: number };
  point?: { file: string; start: number; end: number };
  /** What the view follows: the cursor, or, right after a `point`, the pointed code. */
  focus: Focus;
  /** The pointed code is in another file than the cursor, or far from it: looking back changes the view. */
  pointFar: boolean;
  /** Commands the programmer allowed to run without asking, until the session ends. */
  allowedCommands: Set<string>;
}

/** Where actions take effect: the programmer's editor, or a copy of it in memory. */
export interface Stage {
  editor: PlayerEditor;
  panel: PanelPort;
  pacing: Pacing;
  config(): Config;
  speed(): number;
  /** Divides only a say's reading pause; `speed` paces everything else. */
  readingSpeed(): number;
  /** Shows the agent cursor and state after a change. */
  render(): void;
  /** Waits for the programmer to allow or decline a command. */
  confirm(id: number, command: string): Promise<boolean>;
  /** The identities of the lines of the files played in. */
  lines: LineIds;
  /**
   * Whether the line numbered `line` in `file` is the one the agent was last shown there, by its
   * identity. Given, a `move` only goes to a line the agent knows the number of.
   */
  knows?(file: string, line: number, id: number): boolean;
}

interface Range {
  file: string;
  start: number;
  end: number;
}

/**
 * `consumed`: the action took effect, so it counts as played and isn't returned as unplayed.
 * `rest`: the action took effect in part; this is what's left of it.
 * `nothing`: the action played, but changed nothing the programmer sees (specs/Actions.tla, `type0`).
 */
type Outcome =
  | { kind: 'ok'; nothing?: true }
  | { kind: 'interrupted'; rest?: Action; consumed?: boolean }
  | { kind: 'error'; error: ErrorKind; message: string; candidates?: Candidate[]; consumed?: boolean; sighting?: Sighting };

/** The action that failed a batch, by its number from 1, and why. */
export interface Failure {
  index: number;
  action: Action;
  error: BatchError;
}

/** The batch being played: what it touched, for saving and for its report's code. */
interface Playing {
  touched: Set<string>;
  runs: RunResult[];
  /** The lines its report shows. */
  sightings: Sighting[];
  /** The file it names, in `move`, `select` or `point`, and whether it has edited yet. */
  named?: string;
  edited: boolean;
  /** The text its edits changed, tracked through later edits. */
  span?: Range;
  moved: boolean;
  /** The action that failed it, once one has. */
  failed?: Failure;
}

function fail(error: ErrorKind, message: string): Outcome {
  return { kind: 'error', error, message };
}

/** Returns the outcome of a failed resolution. `file` and `text`: where it failed, so the lines it lists are shown. */
function failed(r: Resolution & { ok: false }, file: string, text: string, shown: number[] = []): Outcome {
  const lines = [...shown, ...(r.candidates ?? []).map((c) => c.line)];
  const outcome: Outcome = { kind: 'error', error: r.kind, message: r.message, candidates: r.candidates };
  if (lines.length > 0) outcome.sighting = { file, text, lines };
  return outcome;
}

/** Returns the absolute path for a path from the agent: relative to its working directory, if it gave one. */
export function agentPath(editor: PlayerEditor, file: string, root?: string): string {
  return editor.resolvePath(root === undefined ? file : nodePath.resolve(root, file));
}

/** Returns how to name a file to the agent. */
export function displayPath(editor: PlayerEditor, file: string, root?: string): string {
  if (root === undefined) return editor.displayPath(file);
  // Not by `relative` starting with "..": a folder in the root may be named `..cache` (#5).
  const inside = withinFolder(root, file);
  return inside === undefined ? file : nodePath.relative(root, inside);
}

/** Returns the text a span looks for: its `text`, or its `from`. */
export function spanText(target: SpanTarget): string {
  return 'text' in target ? target.text : target.from;
}

/** Returns a function mapping a position in the text before `change` to the same place after it. */
function mapThrough(change: Change): (pos: number) => number {
  return (pos) => {
    if (pos <= change.offset) return pos;
    if (pos >= change.offset + change.deleteLength) return pos + change.text.length - change.deleteLength;
    return change.offset + change.text.length;
  };
}

/** Keeps a scene's cursor, selection and pointed code in place through a change to `file`. */
export function transformScene(s: Scene, file: string, change: Change): void {
  const map = mapThrough(change);
  // In place: typing holds this cursor object.
  if (s.cursor?.file === file) s.cursor.offset = map(s.cursor.offset);
  if (s.cursor?.file === file && s.selection) {
    s.selection = { start: map(s.selection.start), end: map(s.selection.end) };
  }
  if (s.point?.file === file) s.point = { file, start: map(s.point.start), end: map(s.point.end) };
}

/** Plays one batch's actions in the editor at a human pace: moves, typing, saying, running commands. */
export class Player {
  /** In a reading pause, or waiting for the programmer to allow a command. */
  reading = false;
  /** A `run` whose command is executing. */
  commandRunning = false;
  private playing?: Playing;

  constructor(
    readonly scene: Scene,
    private readonly stage: Stage,
  ) {}

  /** Plays a batch, saves the files it edited, and says how it went, and which lines that shows. */
  async play(id: number, actions: Action[]): Promise<{ result: BatchResult; sightings: Sighting[]; failed?: Failure }> {
    // specs/BatchFile.tla, `EndBatch`: each batch starts with no file named and nothing edited; the cursor stays.
    const playing: Playing = { touched: new Set(), runs: [], sightings: [], edited: false, moved: false };
    this.playing = playing;
    let result: BatchResult;
    try {
      result = await this.actions(id, actions, playing);
    } finally {
      this.playing = undefined;
    }
    if (playing.runs.length > 0) result.runs = playing.runs;
    if (result.status !== 'discarded') {
      try {
        const shown = await this.code(playing);
        if (shown) {
          result.code = shown.code;
          playing.sightings.push(shown.sighting);
        }
      } catch {
        // The file is gone; the report just can't show it.
      }
    }
    const unsaved = await this.save(playing);
    // A `save_failed` error already names them.
    if (unsaved.length > 0 && result.error?.kind !== 'save_failed') result.unsaved = unsaved;
    return { result, sightings: playing.sightings, failed: playing.failed };
  }

  /** Returns the code a batch's report shows: what it changed in `span`, or where it moved; nothing for neither. */
  async code({ span, moved }: { span?: Range; moved: boolean }): Promise<{ code: Code; sighting: Sighting } | undefined> {
    const cursor = this.scene.cursor;
    // A batch edits at the cursor, in the one file it works in, so what it changed is in the cursor's file.
    if (cursor === undefined || (span === undefined && !moved)) return undefined;
    return this.codeAt(cursor, span);
  }

  /**
   * Returns the lines around `cursor`, extended over `span` in its file, with context around, and the cursor
   * marked; `cursorLine` is the cursor's line as the code shows it.
   */
  async codeAt(
    cursor: NonNullable<Scene['cursor']>,
    span?: Range,
  ): Promise<{ code: Code; sighting: Sighting; cursorLine: Code['lines'][number] }> {
    const { file } = cursor;
    const text = await this.stage.editor.getText(file);
    const { lines, finalNewline } = fileLines(text);
    const at = position(text, cursor.offset);
    let from = at.line;
    let to = at.line;
    if (span) {
      // Text ending with a newline changed the lines up to it, not the one after.
      const end = span.end > span.start && isLineStart(text, span.end) ? span.end - 1 : span.end;
      from = Math.min(from, position(text, span.start).line);
      to = Math.max(to, position(text, end).line);
    }
    // The empty line after a final newline isn't one of the file's lines, but the cursor may be on it.
    const last = lines.length;
    from = Math.max(1, from - CONTEXT_LINES);
    to = Math.min(Math.max(last, at.line), to + CONTEXT_LINES);
    const numbers: number[] = [];
    for (let n = from; n <= to; n++) {
      const long = to - from + 1 > MAX_CODE_LINES;
      if (!long || n < from + MAX_CODE_LINES / 2 || n > to - MAX_CODE_LINES / 2 || n === at.line) numbers.push(n);
    }
    // The cursor's line is always among `numbers`: the map below sets it.
    let cursorLine = { number: at.line, text: CURSOR_MARKER };
    const code: Code = {
      file: this.displayPath(file),
      lines: numbers.map((n) => {
        const line = lines[n - 1] ?? '';
        if (n !== at.line) return { number: n, text: line };
        cursorLine = { number: n, text: line.slice(0, at.column - 1) + CURSOR_MARKER + line.slice(at.column - 1) };
        return cursorLine;
      }),
    };
    if (to >= last) code.end = { final_newline: finalNewline };
    return { code, sighting: { file, text, lines: numbers }, cursorLine };
  }

  /**
   * Keeps the positions playback holds in place through a change someone else made: specs/Player.tla,
   * `TypeBefore` moves the selection, `TypeAfter` does not.
   */
  transform(file: string, change: Change): void {
    transformScene(this.scene, file, change);
    const map = mapThrough(change);
    const playing = this.playing;
    if (!playing) return;
    const { span } = playing;
    if (span?.file === file) playing.span = { file, start: map(span.start), end: map(span.end) };
  }

  private async actions(id: number, actions: Action[], playing: Playing): Promise<BatchResult> {
    // An action so far changed something the programmer sees.
    let effect = false;
    // specs/Actions.tla: `perform` takes an action's steps (`Proceed`, `TakeEffect`), and each pass after it is `FinishAction`.
    for (const [i, action] of actions.entries()) {
      // specs/Turns.tla, `Start`, and specs/Actions.tla, `StopBeforeAction`: an interrupt stops the batch between actions.
      if (this.stage.pacing.isInterrupted) return this.stopped(id, actions.slice(i), effect);
      let outcome: Outcome;
      try {
        outcome = await this.perform(action, playing);
      } catch (error) {
        outcome = fail('invalid_action', error instanceof Error ? error.message : String(error));
      }
      const rest = actions.slice(i + 1);
      if (outcome.kind === 'interrupted') {
        if (outcome.consumed === true) return this.stopped(id, rest, /* effect= */ true);
        if (outcome.rest) return this.stopped(id, [outcome.rest, ...rest], /* effect= */ true);
        return this.stopped(id, actions.slice(i), effect);
      }
      if (outcome.kind === 'error') {
        if (outcome.sighting) playing.sightings.push(outcome.sighting);
        const error: BatchError = { kind: outcome.error, message: outcome.message };
        if (outcome.candidates) error.candidates = outcome.candidates;
        playing.failed = { index: i + 1, action, error };
        const result: BatchResult = { id, status: 'failed', error };
        const unplayed = outcome.consumed === true ? rest : actions.slice(i);
        if (unplayed.length > 0) result.unplayed = unplayed;
        return result;
      }
      if (!outcome.nothing) effect = true;
    }
    // specs/Actions.tla, `Complete`.
    return { id, status: 'completed' };
  }

  /** Returns the result of an interrupted batch (specs/Actions.tla, `Stop`). With no visible effect yet, it counts as discarded. */
  private stopped(id: number, unplayed: Action[], effect: boolean): BatchResult {
    const result: BatchResult = { id, status: effect ? 'interrupted' : 'discarded' };
    if (unplayed.length > 0) result.unplayed = unplayed;
    return result;
  }

  /** Shows a change to the cursor, or to what the view follows, and keeps it in the programmer's view. */
  private follow(): void {
    this.stage.render();
    if (this.scene.turn === 'agent') this.stage.editor.follow();
  }

  private delay(ms: number): Promise<boolean> {
    return this.stage.pacing.sleep(ms / this.stage.speed());
  }

  private async perform(action: Action, playing: Playing): Promise<Outcome> {
    const scene = this.scene;
    const { editor, panel } = this.stage;
    const timing = this.stage.config().timing;
    const kinds = actionKinds(action);
    if (kinds.length > 1) {
      return fail(
        'invalid_action',
        `One action per object, got ${kinds.map((k) => `\`${k}\``).join(' and ')}: make them separate actions, in order.`,
      );
    }
    // specs/BatchFile.tla, `Act`: naming a second file, or a file after the first edit, is a `Reject`.
    const named = this.names(action, playing);
    if (typeof named === 'object') return named;
    const fields = fieldsProblem(action);
    if (fields !== undefined) return fail('invalid_action', fields);
    // specs/Turns.tla, `Start`: in the programmer's turn, only `say` and `point`.
    if (scene.turn === 'user' && !('say' in action) && !('point' in action)) {
      return fail('not_your_turn', "During the programmer's turn, only `say` and `point` are allowed.");
    }
    // `type` and `delete` act at the cursor, which a `point` doesn't move: it has to be in the batch's file
    // (specs/BatchFile.tla, `ActAtCursor`).
    const atCursor = 'type' in action || 'type_fast' in action || 'delete' in action;
    if (atCursor && playing.named !== undefined && scene.cursor && scene.cursor.file !== playing.named) {
      return fail(
        'invalid_action',
        `Your cursor is in ${this.displayPath(scene.cursor.file)}, but this batch works in ${this.displayPath(playing.named)}: \`move\` or \`select\` there first.`,
      );
    }

    // An action at the cursor brings the view back to it from the code last pointed at. A far jump
    // back gets a far move's pause, before anything happens there; one to another file has its own.
    const cursorAction = !('say' in action) && !('point' in action) && !('run' in action);
    const lookingBack = cursorAction && scene.focus === 'point';
    const farBack = lookingBack && scene.pointFar;
    if (lookingBack) {
      // specs/PointFocus.tla, `ActAtCursor`: the view comes back to the cursor.
      scene.focus = 'cursor';
      if (farBack && !('move' in action) && named === undefined && scene.cursor && this.fileOf({}, playing) === scene.cursor.file) {
        await editor.show(scene.cursor.file);
        this.follow();
        if (!(await this.delay(timing.afterMoveFarMs))) return { kind: 'interrupted' };
      }
      this.follow();
    }

    if ('say' in action) {
      // specs/BatchFile.tla, `Say`: it acts in no file.
      panel.post({ type: 'say', text: action.say });
      // specs/Calibration.tla, `StartSay`: timed with the rate in force now; the sleep's end is `EndSay`.
      const ms = readingTime(action.say, timing.reading) / this.stage.readingSpeed();
      this.reading = true;
      panel.post({ type: 'reading', ms });
      this.stage.render();
      await this.stage.pacing.sleep(ms);
      this.reading = false;
      this.stage.render();
      return ok;
    }

    if ('move' in action) {
      const move = action.move;
      const file = this.fileOf(move, playing);
      if (file === undefined) return fail('no_cursor', "Your cursor isn't in a file yet; give `file`.");
      if (!(await this.delay(timing.beforeMoveMs))) return { kind: 'interrupted' };
      // specs/FollowMode.tla, `Resolve`: the cursor moves to the file only once `show` resolves.
      await editor.show(file);
      const at = move.at;
      const where = await this.locate(file, 'move', move.line, at === undefined ? undefined : (text) => spotCandidates(text, at));
      if ('kind' in where) return where;
      const { text, line } = where;
      let offset: number;
      if (at === undefined) {
        // moveProblem passed: without `at`, `to` is `line_end`.
        offset = lineEnd(text, line);
      } else {
        const r = resolveSpot(text, { at, line });
        // A spot not on its line says what the line reads.
        if (!r.ok) return failed(r, file, text, r.kind === 'not_found' ? [line] : []);
        offset = r.range.start;
      }
      const near =
        !farBack &&
        scene.cursor?.file === file &&
        Math.abs(position(text, scene.cursor.offset).line - position(text, offset).line) <= timing.nearLines;
      scene.cursor = { file, offset };
      scene.selection = undefined;
      playing.moved = true;
      this.follow();
      // The pause is after the move, so the programmer sees where the cursor went before anything happens there.
      await this.delay(near ? timing.afterMoveNearMs : timing.afterMoveFarMs);
      return ok;
    }

    if ('select' in action) {
      const target = action.select;
      const file = this.fileOf(target, playing);
      if (file === undefined) return fail('no_cursor', "Your cursor isn't in a file yet; give `file`.");
      if (!(await this.delay(timing.beforeSelectMs))) return { kind: 'interrupted' };
      await editor.show(file);
      const span = await this.span(file, target, 'select');
      if ('kind' in span) return span;
      scene.cursor = { file, offset: span.end };
      scene.selection = { start: span.start, end: span.end };
      playing.moved = true;
      this.follow();
      await this.delay(timing.afterSelectMs);
      return ok;
    }

    if ('type' in action || 'type_fast' in action) {
      const fast = 'type_fast' in action;
      const text: unknown = fast ? action.type_fast : action.type;
      const problem = typeProblem(text);
      if (problem !== undefined) return fail('invalid_action', problem);
      // typeProblem passed: a string with exactly one marker.
      const marked = String(text);
      const marker = marked.indexOf(CURSOR_MARKER);
      return this.type(marked.slice(0, marker), marked.slice(marker + CURSOR_MARKER.length), fast, playing);
    }

    if ('delete' in action) {
      if (!scene.cursor || !scene.selection) return fail('no_selection', 'Nothing is selected; `select` first.');
      const { file } = scene.cursor;
      // specs/Player.tla, `Begin`: the delete awaits show() and getText().
      await editor.show(file);
      this.stage.lines.of(file, await editor.getText(file));
      // A programmer's edit meanwhile interrupts, and moved the selection: stop before any effect, and
      // read the selection only now (#49): specs/Turns.tla, `TakeEffect`, and specs/Player.tla, `Finish`.
      if (this.stage.pacing.isInterrupted) return { kind: 'interrupted' };
      const { start, end } = scene.selection;
      playing.edited = true;
      this.clearPoint();
      scene.cursor.offset = start;
      scene.selection = undefined;
      const change = { offset: start, deleteLength: end - start, text: '' };
      this.touch(playing, file, change);
      await this.edit(file, change, { undoStopBefore: true, undoStopAfter: true });
      this.follow();
      await this.delay(timing.afterDeleteMs);
      return ok;
    }

    if ('point' in action) {
      const target = action.point;
      const file = this.fileOf(target, playing);
      if (file === undefined) return fail('no_cursor', "Your cursor isn't in a file yet; give `file`.");
      if (scene.turn === 'agent') await editor.show(file);
      const span = await this.span(file, target, 'point');
      if ('kind' in span) return span;
      scene.point = { file, start: span.start, end: span.end };
      const pointLine = position(span.text, span.start).line;
      if (scene.turn === 'agent') {
        // The view goes to the pointed code, so the `say` about it plays while the programmer looks at it
        // (specs/PointFocus.tla, `Point`).
        const cursorLine = scene.cursor?.file === file ? position(span.text, scene.cursor.offset).line : undefined;
        scene.pointFar = cursorLine === undefined || Math.abs(cursorLine - pointLine) > timing.nearLines;
        scene.focus = 'point';
      }
      editor.renderPoint(scene.point);
      this.follow();
      panel.post({ type: 'point', file: editor.displayPath(file), line: pointLine });
      await this.delay(timing.afterPointMs);
      return ok;
    }

    if ('run' in action) return this.runCommand(action, playing);

    return fail('invalid_action', `Unknown action: ${JSON.stringify(action)}`);
  }

  private async runCommand(action: { run: string; wait?: number }, playing: Playing): Promise<Outcome> {
    const scene = this.scene;
    const { editor, panel } = this.stage;
    const config = this.stage.config();
    const command = action.run;
    if (typeof command !== 'string' || command.trim() === '') return fail('invalid_action', '`run` needs a command.');
    // Commands read files from disk, so the batch's edits so far go there first.
    const unsaved = await this.save(playing);
    // specs/RunBox.tla, `FailSave`: a failed save posts nothing.
    if (unsaved.length > 0) {
      const which = unsaved.map((u) => `${u.file} (${u.error})`).join(', ');
      return fail(
        'save_failed',
        `Couldn't save ${which}, so the command didn't run: it would read the old file from disk. Ask the programmer to resolve it in the editor, which offers to compare or overwrite, then run it again.`,
      );
    }
    const id = nextRunId++;
    const signal = this.stage.pacing.signal;

    if (config.confirmCommands && !scene.allowedCommands.has(command)) {
      // specs/RunBox.tla, `SaveAndConfirm`.
      panel.post({ type: 'run', id, command, phase: 'confirm' });
      this.reading = true;
      this.stage.render();
      const go = await this.stage.confirm(id, command);
      this.reading = false;
      this.stage.render();
      if (!go || signal.aborted) {
        // specs/RunBox.tla, `Decline`.
        panel.post({ type: 'run', id, command, phase: 'declined' });
        if (signal.aborted) return { kind: 'interrupted' };
        return fail('command_declined', 'The programmer declined to run this command.');
      }
    }

    const requested = action.wait !== undefined ? action.wait * MS_PER_SECOND : config.runWaitMs;
    const waitMs = Math.max(0, Math.min(config.maxRunWaitMs, requested));
    // specs/RunBox.tla, `SaveAndRun`, or `Go` after a confirm.
    panel.post({ type: 'run', id, command, phase: 'running' });
    this.commandRunning = true;
    this.stage.render();
    // specs/RunBox.tla, `FinishCommand`: done or background when it ran, declined when it never started or threw.
    let outcome;
    try {
      outcome = await editor.runCommand(command, { cwd: scene.root ?? editor.resolvePath('.'), waitMs, signal });
    } catch (error) {
      panel.post({ type: 'run', id, command, phase: 'declined' });
      throw error;
    } finally {
      this.commandRunning = false;
      this.stage.render();
    }
    if (outcome.notStarted === true) {
      panel.post({ type: 'run', id, command, phase: 'declined' });
      return { kind: 'interrupted' };
    }

    const result: RunResult = { command, output: outcome.output };
    if (outcome.exitCode !== undefined && outcome.running !== true) result.exit_code = outcome.exitCode;
    if (outcome.truncated === true) result.truncated = true;
    if (outcome.running === true) result.running = true;
    if (outcome.shell !== undefined) result.shell = outcome.shell;
    playing.runs.push(result);
    const phase = outcome.running === true ? 'background' : 'done';
    panel.post({ type: 'run', id, command, phase, exitCode: result.exit_code });
    // The panel keeps showing it as running until it ends, whenever that is.
    if (outcome.running === true) {
      // It ends, or its terminal closes: either way, it never rejects.
      void outcome.exited?.then((exitCode) => {
        panel.post({ type: 'run', id, command, phase: 'exited', exitCode });
      });
    }

    // specs/Actions.tla, `StopWhileRunning`: the command runs on, so it counts as played.
    if (outcome.running === true && signal.aborted) return { kind: 'interrupted', consumed: true };
    if (result.exit_code !== undefined && result.exit_code !== 0) {
      return { kind: 'error', error: 'command_failed', message: `The command exited with ${result.exit_code}.`, consumed: true };
    }
    return ok;
  }

  /** Types `before`, then `after`, then steps back to between them: to where the text had its `CURSOR_MARKER`. */
  private async type(before: string, after: string, fast: boolean, playing: Playing): Promise<Outcome> {
    const scene = this.scene;
    const { editor } = this.stage;
    if (!scene.cursor) return fail('no_cursor', "Your cursor isn't in a file yet; `move` first.");
    const cursor = scene.cursor;
    playing.edited = true;
    await editor.show(cursor.file);
    this.clearPoint();

    const doc = await editor.getText(cursor.file);
    this.stage.lines.of(cursor.file, doc);
    const eol = await editor.eol(cursor.file);
    const insertAt = scene.selection ? scene.selection.start : cursor.offset;
    const { timing, random } = this.stage.config();
    const scale = fast ? timing.fastFactor : 1;
    const chunks = planTyping(before + after, timing.type, isLineStart(doc, insertAt), random, scale);

    if (chunks.length === 0 && scene.selection) chunks.push({ text: '', delay: 0 });
    let typed = '';
    for (const [i, chunk] of chunks.entries()) {
      // specs/Actions.tla, `StopAtCheck`: cut after a chunk, it returns only what's left of it.
      if (!(await this.delay(chunk.delay))) {
        if (typed === '') return { kind: 'interrupted' };
        const rest =
          typed.length <= before.length
            ? before.slice(typed.length) + CURSOR_MARKER + after
            : CURSOR_MARKER + after.slice(typed.length - before.length);
        return { kind: 'interrupted', rest: fast ? { type_fast: rest } : { type: rest } };
      }
      const insert = eol === '\n' ? chunk.text : chunk.text.replaceAll('\n', eol);
      const start = scene.selection ? scene.selection.start : cursor.offset;
      const deleteLength = scene.selection ? scene.selection.end - scene.selection.start : 0;
      // Move the cursor before awaiting, so programmer edits arriving meanwhile transform the right position.
      cursor.offset = start + insert.length;
      scene.selection = undefined;
      const change = { offset: start, deleteLength, text: insert };
      this.touch(playing, cursor.file, change);
      await this.edit(cursor.file, change, {
        undoStopBefore: i === 0,
        undoStopAfter: i === chunks.length - 1,
      });
      typed += chunk.text;
      this.follow();
    }
    if (after !== '') {
      // Into the pair just closed: a move within sight, so the same beat before it, and pause after,
      // as one. Interrupted, it still steps back: all of the text was typed.
      await this.delay(timing.beforeMoveMs * scale);
      cursor.offset -= eol === '\n' ? after.length : after.replaceAll('\n', eol).length;
      this.follow();
      await this.delay(timing.afterMoveNearMs * scale);
    }
    return chunks.length === 0 ? nothing : ok;
  }

  /** Edits a file, which its lines' identities follow. */
  private edit(file: string, change: Change, options: { undoStopBefore: boolean; undoStopAfter: boolean }): Promise<void> {
    this.stage.lines.apply(file, change);
    return this.stage.editor.edit(file, change.offset, change.deleteLength, change.text, options);
  }

  /**
   * Returns the file an action names, or else the one its batch named, or else the cursor's: `looks` in
   * specs/BatchFile.tla, `Act`, the file `ActInFile` acts in.
   */
  private fileOf(target: { file?: string }, playing: Playing): string | undefined {
    if (target.file !== undefined) return this.resolvePath(target.file);
    return playing.named ?? this.scene.cursor?.file;
  }

  /**
   * Returns the file an action names, if any, checked against the rest of its batch: a batch works in one
   * file, which it names before its first edit.
   */
  private names(action: Action, playing: Playing): string | undefined | Outcome {
    const target: unknown =
      'move' in action ? action.move : 'select' in action ? action.select : 'point' in action ? action.point : undefined;
    const file = typeof target === 'object' && target !== null && 'file' in target ? target.file : undefined;
    if (typeof file !== 'string') return undefined;
    const path = this.resolvePath(file);
    if (playing.named !== undefined && path !== playing.named) {
      return fail(
        'invalid_action',
        `A batch works in one file, but this one names ${this.displayPath(playing.named)} and ${this.displayPath(path)}. Start a new batch where it switches files.`,
      );
    }
    if (playing.named === undefined && playing.edited) {
      return fail(
        'invalid_action',
        "A batch works in one file: name it (in `move`, `select` or `point`) before the batch's first edit. Start a new batch where it switches files.",
      );
    }
    playing.named = path;
    return path;
  }

  /**
   * Returns the line an action goes to, in `file`: `line`, exactly, if it's a line the agent was shown
   * there, or the cursor's line. `find`: where the text the action looks for is, to list it if the
   * line isn't one the agent knows; none for the end of a line.
   */
  private async locate(
    file: string,
    action: string,
    line?: number,
    find?: (text: string) => Candidate[],
  ): Promise<{ text: string; line: number } | Outcome> {
    const scene = this.scene;
    const text = await this.stage.editor.getText(file);
    if (line === undefined) {
      // The cursor's line, which may be the empty one after a final newline, if it's there.
      if (scene.cursor?.file !== file) {
        return fail('invalid_action', `Give \`line\`: without it, a \`${action}\` is on your cursor's line, in its file.`);
      }
      return { text, line: position(text, scene.cursor.offset).line };
    }
    // An empty file has one line, the empty one; a newline at the end doesn't start another.
    const lines = Math.max(1, fileLines(text).lines.length);
    if (line > lines) {
      const has = lines === 1 ? '1 line' : `${lines} lines`;
      return fail('no_line', `There's no line ${line}: ${this.displayPath(file)} has ${has}.`);
    }
    return this.unseen(file, text, line, action === 'move' ? 'the spot' : 'the text', find) ?? { text, line };
  }

  /** Returns the code a `select` or `point` takes, in `file`. */
  private async span(file: string, target: SpanTarget, action: string): Promise<{ text: string; start: number; end: number } | Outcome> {
    const find = spanText(target);
    const where = await this.locate(file, action, target.line, (text) => spanCandidates(text, find));
    if ('kind' in where) return where;
    const { text, line } = where;
    const r = resolveSpan(text, { ...target, line });
    // Code not on its line says what the line reads.
    if (!r.ok) return failed(r, file, text, r.kind === 'not_found' && r.candidates ? [line] : []);
    return { text, ...r.range };
  }

  /**
   * Returns the error for an action on a line whose number the agent may have worked out instead of
   * being shown, if it isn't one it knows; nothing if it is. Says what the line reads now, and where what it looks for is, which it's
   * shown then. An empty file's one line needs no showing. In a rehearsal, `knows` taking the
   * number is specs/Rehearsal.tla, `Accept`.
   */
  private unseen(file: string, text: string, line: number, what: string, find?: (text: string) => Candidate[]): Outcome | undefined {
    const id = this.stage.lines.of(file, text)[line - 1];
    if (!this.stage.knows || text === '' || (id !== undefined && this.stage.knows(file, line, id))) return undefined;
    const candidates = find?.(text) ?? [];
    const reads = `line ${line} reads ${JSON.stringify(lineText(text, line))}`;
    const where = !find ? '.' : candidates.length > 0 ? `, and ${what} is on these lines:` : `, and ${what} isn't anywhere in the file.`;
    const outcome: Outcome = {
      kind: 'error',
      error: 'line_not_seen',
      message: `You haven't seen line ${line} of ${this.displayPath(file)} in an up-to-date \`read\` or report, so its number may be off: take line numbers from them, never work them out. Now, ${reads}${where}`,
      sighting: { file, text, lines: [line, ...candidates.map((c) => c.line)] },
    };
    if (candidates.length > 0) outcome.candidates = candidates;
    return outcome;
  }

  /** Saves the files the batch has edited, so tools reading from disk see them; returns the ones it couldn't. */
  private async save(playing: Playing): Promise<Array<{ file: string; error: string }>> {
    const unsaved: Array<{ file: string; error: string }> = [];
    for (const file of playing.touched) {
      try {
        await this.stage.editor.save(file);
      } catch (error) {
        unsaved.push({ file: this.displayPath(file), error: error instanceof Error ? error.message : String(error) });
      }
    }
    return unsaved;
  }

  private clearPoint(): void {
    if (!this.scene.point) return;
    this.scene.point = undefined;
    this.stage.editor.renderPoint(undefined);
  }

  /** Records a change the batch makes: the file it touched, and the span of its edits so far, moved through it. */
  private touch(p: Playing, file: string, change: Change): void {
    p.touched.add(file);
    const map = mapThrough(change);
    const start = change.offset;
    const end = start + change.text.length;
    const span = p.span?.file === file ? p.span : undefined;
    p.span = span ? { file, start: Math.min(map(span.start), start), end: Math.max(map(span.end), end) } : { file, start, end };
  }

  private resolvePath(file: string): string {
    return agentPath(this.stage.editor, file, this.scene.root);
  }

  private displayPath(file: string): string {
    return displayPath(this.stage.editor, file, this.scene.root);
  }
}
