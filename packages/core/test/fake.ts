import * as nodePath from 'node:path';
import { expect, vi } from 'vitest';
import { withinFolder } from '@ai-pair/protocol';
import { defaultConfig, type Config } from '../src/config';
import { Controller, isSavedSession, type SavedSession } from '../src/controller';
import {
  MissingFile,
  type Change,
  type AgentState,
  type CommandOutcome,
  type CursorView,
  type EditOptions,
  type EditorPort,
  type Focus,
  type PanelEvent,
  type PanelPort,
  type RunOptions,
} from '../src/ports';

/** `/project` in this platform's form (`C:\project` on Windows), as the controller resolves it. */
const ROOT = nodePath.resolve('/project');

/** An editor in memory: files as strings, a cursor, and a record of what the controller asked. */
export class FakeEditor implements EditorPort {
  files = new Map<string, string>();
  dirty = new Set<string>();
  saved: string[] = [];
  edits: Array<{ file: string; offset: number; deleteLength: number; text: string; options: EditOptions }> = [];
  shown: string[] = [];
  cursor: CursorView | undefined = undefined;
  state: AgentState | undefined = undefined;
  point: { file: string; start: number; end: number } | undefined = undefined;
  controller: Controller | undefined;
  /** Files the editor stores with CRLF, whatever they contain so far. */
  crlf = new Set<string>();
  focus: Focus = 'cursor';
  reveals = 0;
  /** What the view was following at the last reveal. */
  revealedFocus: Focus | undefined = undefined;
  follows = 0;
  /** `unsaved`: the files with unsaved changes when the command started. */
  commands: Array<{ command: string; options: RunOptions; unsaved: string[] }> = [];
  /**
   * How each command behaves: its terminal takes `startMs` to get ready, then the command takes `ms`
   * and exits with `exitCode`, having printed `output`.
   */
  commandScript = new Map<string, { ms: number; startMs?: number; exitCode?: number; output?: string }>();

  resolvePath(file: string): string {
    return nodePath.resolve(ROOT, file);
  }
  displayPath(file: string): string {
    const inside = withinFolder(ROOT, file);
    return inside === undefined ? file : nodePath.relative(ROOT, inside);
  }
  getText(file: string): Promise<string> {
    const text = this.files.get(file);
    return text === undefined ? Promise.reject(new MissingFile(file)) : Promise.resolve(text);
  }
  eol(file: string): Promise<string> {
    return Promise.resolve(this.crlf.has(file) ? '\r\n' : '\n');
  }
  isDirty(file: string): Promise<boolean> {
    return Promise.resolve(this.dirty.has(file));
  }
  show(file: string): Promise<void> {
    if (!this.files.has(file)) this.files.set(file, '');
    if (this.shown.at(-1) !== file) this.shown.push(file);
    return Promise.resolve();
  }
  async edit(file: string, offset: number, deleteLength: number, text: string, options: EditOptions): Promise<void> {
    const old = await this.getText(file);
    this.files.set(file, old.slice(0, offset) + text + old.slice(offset + deleteLength));
    this.dirty.add(file);
    this.edits.push({ file, offset, deleteLength, text, options });
  }
  save(file: string): Promise<void> {
    this.dirty.delete(file);
    this.saved.push(file);
    return Promise.resolve();
  }
  renderCursor(cursor: CursorView | undefined, state: AgentState, focus: Focus): void {
    this.cursor = cursor;
    this.state = state;
    this.focus = focus;
  }
  renderPoint(point: { file: string; start: number; end: number } | undefined): void {
    this.point = point;
  }
  reveal(): void {
    this.reveals++;
    this.revealedFocus = this.focus;
  }
  follow(): void {
    this.follows++;
  }

  async runCommand(command: string, options: RunOptions): Promise<CommandOutcome> {
    const script = this.commandScript.get(command) ?? { ms: 0, exitCode: 0 };
    if (script.startMs !== undefined && script.startMs > 0) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, script.startMs);
        options.signal.addEventListener('abort', () => {
          resolve();
        });
      });
      if (options.signal.aborted) return { output: '', notStarted: true };
    }
    this.commands.push({ command, options, unsaved: [...this.dirty] });
    const output = script.output ?? '';
    const started = Date.now();
    const finished = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(
        () => {
          resolve(script.ms <= options.waitMs);
        },
        Math.min(script.ms, options.waitMs),
      );
      options.signal.addEventListener('abort', () => {
        clearTimeout(timer);
        resolve(false);
      });
    });
    if (finished) return { exitCode: script.exitCode, output, shell: 'bash' };
    const exited = new Promise<number | undefined>((resolve) => {
      setTimeout(
        () => {
          resolve(script.exitCode);
        },
        Math.max(0, script.ms - (Date.now() - started)),
      );
    });
    return { output, running: true, exited };
  }

  /** Types into a file, as the programmer. */
  userEdit(name: string, change: Change): void {
    this.change('programmer', name, change);
  }

  /** Changes a file as something other than the programmer: a tool, a formatter. */
  otherEdit(name: string, change: Change): void {
    this.change('other', name, change);
  }

  private change(by: 'programmer' | 'other', name: string, { offset, deleteLength, text }: Change): void {
    const file = this.resolvePath(name);
    const before = this.files.get(file) ?? '';
    const after = before.slice(0, offset) + text + before.slice(offset + deleteLength);
    this.files.set(file, after);
    const changes = [{ offset, deleteLength, text }];
    if (by === 'programmer') {
      this.controller?.userEdit(file, before, after, changes);
    } else {
      this.controller?.otherEdit(file, before, after, changes);
    }
  }

  text(name: string): string {
    return this.files.get(this.resolvePath(name)) ?? '';
  }
}

/** A panel that keeps every event posted to it. */
export class FakePanel implements PanelPort {
  events: PanelEvent[] = [];
  post(event: PanelEvent): void {
    this.events.push(event);
  }
  says(): string[] {
    return this.events.flatMap((e) => (e.type === 'say' ? [e.text] : []));
  }
}

/** Deterministic timing: no jitter, round numbers, no pauses except before moves and selections. */
export const testConfig: Config = {
  ...defaultConfig,
  timing: {
    type: { charMs: 100, jitter: 0.25, wordStartMs: 0, punctuationMs: 0, openBracketMs: 0, newlineMs: 0 },
    fastFactor: 0.1,
    reading: { msPerChar: 20, minMs: 500 },
    beforeMoveMs: 100,
    afterMoveNearMs: 0,
    afterMoveFarMs: 0,
    nearLines: 15,
    beforeSelectMs: 100,
    afterSelectMs: 0,
    afterDeleteMs: 0,
    afterPointMs: 0,
    glideMs: defaultConfig.timing.glideMs,
    glidePerLineMs: defaultConfig.timing.glidePerLineMs,
    glideMaxMs: defaultConfig.timing.glideMaxMs,
  },
  navigatorIdleMs: 1000,
  random: () => 0.5,
};

/** Returns a controller over a fake editor holding `files`, with the test config and `config` on top. */
export function setup(files: Record<string, string> = {}, config: Partial<Config> = {}) {
  const editor = new FakeEditor();
  const panel = new FakePanel();
  for (const [name, text] of Object.entries(files)) {
    editor.files.set(editor.resolvePath(name), text);
  }
  const controller = new Controller(editor, panel, { ...testConfig, ...config });
  editor.controller = controller;
  return { editor, panel, controller };
}

/** Returns `saved` as the workspace's storage hands it back: through JSON. */
export function throughStorage(saved?: SavedSession): SavedSession {
  // Through JSON on purpose: that is what the storage does to it.
  // oxlint-disable-next-line unicorn/prefer-structured-clone
  const parsed: unknown = JSON.parse(JSON.stringify(saved));
  if (!isSavedSession(parsed)) throw new Error(`not a saved session: ${JSON.stringify(parsed)}`);
  return parsed;
}

/** Tracks a promise so tests can check whether it has settled yet. */
export function track<T>(promise: Promise<T>) {
  const tracked: { done: boolean; value: T | undefined; error: unknown } = { done: false, value: undefined, error: undefined };
  void promise.then(
    (v) => {
      tracked.done = true;
      tracked.value = v;
    },
    (error: unknown) => {
      tracked.done = true;
      tracked.error = error;
    },
  );
  return tracked;
}

/** Advances fake time until the promise settles. */
export async function until<T>(promise: Promise<T>, maxMs = 120_000): Promise<T> {
  const tracked = track(promise);
  for (let elapsed = 0; !tracked.done && elapsed < maxMs; elapsed += 10) {
    await vi.advanceTimersByTimeAsync(10);
  }
  if (!tracked.done) throw new Error(`Still pending after ${maxMs} ms`);
  if (tracked.error !== undefined) {
    throw tracked.error instanceof Error
      ? tracked.error
      : new Error('The promise rejected with a value that is not an Error.', { cause: tracked.error });
  }
  // `track` keeps the value of the promise it was given, a `T`.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return tracked.value as T;
}

/** Moves the fake timers on by `ms`, running what they fire. */
export async function advance(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

/** Returns `expect.stringContaining(text)`, typed as the string it stands in for. */
export function containing(text: string): string {
  const matcher: unknown = expect.stringContaining(text);
  // An asymmetric matcher stands in for the value it matches; vitest types it `any`.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return matcher as string;
}

/** Returns `expect.stringMatching(pattern)`, typed as the string it stands in for. */
export function matching(pattern: RegExp): string {
  const matcher: unknown = expect.stringMatching(pattern);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return matcher as string;
}

/** Returns `expect.any(String)`, typed as the string it stands in for. */
export function anyString(): string {
  const matcher: unknown = expect.any(String);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return matcher as string;
}
