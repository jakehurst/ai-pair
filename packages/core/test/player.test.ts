// The player on its own: each action, its refusals, its pauses, interrupts at each point, and the code a batch
// reports (specs/Actions.tla, specs/Player.tla, specs/BatchFile.tla, specs/PointFocus.tla, specs/RunBox.tla).
// Solitary: the protocol's checks, places.ts, text.ts, and typing.ts are mocks (text.ts a plain reading of a text's
// lines, typing.ts one character a chunk); the stage's editor, panel, and lines are typed mocks, and its pacing a
// fake the test interrupts. Every batch result is parsed by BATCH_RESULT_SCHEMA.

import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';
import { BATCH_RESULT_SCHEMA, CURSOR_MARKER, fieldsProblem, typeProblem, type Action, type BatchResult } from '@ai-pair/protocol';
import { defaultConfig, type Config } from '../src/config';
import type { LineIds, Sighting } from '../src/lines';
import { resolveSpan, resolveSpot, spanCandidates, spotCandidates } from '../src/places';
import { agentPath, displayPath, Player, spanText, transformScene, type Scene, type Stage } from '../src/player';
import type { CommandOutcome, PanelEvent, PanelPort, PlayerEditor } from '../src/ports';
import type { Pacing } from '../src/timeline';

/** The agent's project. */
const ROOT = '/project';

/** The batch's file, and another. */
const A = path.join(ROOT, 'a.ts');
const B = path.join(ROOT, 'b.ts');

/** The settings the player reads: distinct pauses, so a test can tell which one it took. */
const CONFIG: Config = {
  ...defaultConfig,
  timing: {
    ...defaultConfig.timing,
    fastFactor: 0.5,
    beforeMoveMs: 11,
    afterMoveNearMs: 12,
    afterMoveFarMs: 13,
    nearLines: 2,
    beforeSelectMs: 14,
    afterSelectMs: 15,
    afterDeleteMs: 16,
    afterPointMs: 17,
  },
  random: () => 0.5,
  confirmCommands: false,
  runWaitMs: 2000,
  maxRunWaitMs: 5000,
};

/** How long the mocked readingTime says any message takes to read. */
const READING_MS = 100;

/** How fast the stage reads: the reading pause is divided by it. */
const READING_SPEED = 2;

/** The delay the mocked planTyping gives each character. */
const CHAR_MS = 10;

/** What the text.ts fake reads a text with, made before the `vi.mock` factories run. */
const textFake = vi.hoisted(() => ({
  /** Returns each line of `text`, split on the newline, with the offsets it spans. */
  linesOf: (text: string): Array<{ text: string; start: number; end: number }> => {
    const lines: Array<{ text: string; start: number; end: number }> = [];
    let start = 0;
    for (const line of text.split('\n')) {
      lines.push({ text: line, start, end: start + line.length });
      start += line.length + 1;
    }
    return lines;
  },
}));

vi.mock(import('@ai-pair/protocol'), async (importOriginal) => {
  const original = await importOriginal();
  const kinds: readonly string[] = original.ACTION_KINDS;
  return {
    ...original,
    actionKinds: vi.fn((action: object) => Object.keys(action).filter((key) => kinds.includes(key))),
    fieldsProblem: vi.fn(() => undefined),
    typeProblem: vi.fn(() => undefined),
    withinFolder: vi.fn((folder: string, file: string) => (file.startsWith(`${folder}/`) ? file : undefined)),
  };
});
vi.mock('../src/places', () => ({
  resolveSpan: vi.fn(),
  resolveSpot: vi.fn(),
  spanCandidates: vi.fn(() => []),
  spotCandidates: vi.fn(() => []),
}));
vi.mock('../src/text', () => {
  const { linesOf } = textFake;
  return {
    fileLines: vi.fn((text: string) => {
      if (text === '') {
        return { lines: [], finalNewline: true };
      }
      const lines = text.split('\n');
      const finalNewline = text.endsWith('\n');
      if (finalNewline) {
        lines.pop();
      }
      return { lines, finalNewline };
    }),
    isLineStart: vi.fn((text: string, offset: number) => offset === 0 || text[offset - 1] === '\n'),
    lineEnd: vi.fn((text: string, line: number) => linesOf(text)[line - 1]?.end ?? text.length),
    lineText: vi.fn((text: string, line: number) => linesOf(text)[line - 1]?.text ?? ''),
    position: vi.fn((text: string, offset: number) => {
      const lines = linesOf(text);
      const index = lines.findIndex((line) => offset >= line.start && offset <= line.end);
      return { line: index + 1, column: offset - (lines[index]?.start ?? 0) + 1 };
    }),
  };
});
vi.mock('../src/typing', () => ({
  // planTyping(text, cadence, atLineStart, random, scale): only the text and the scale matter to the fake.
  planTyping: vi.fn((...[text, , , , scale = 1]: [string, unknown, boolean, unknown, number?]) =>
    Array.from(text).map((c) => ({ text: c, delay: CHAR_MS * scale })),
  ),
  readingTime: vi.fn(() => READING_MS),
}));

/** The pacing, faked: sleeps resolve at once, until the test interrupts it. */
class FakePacing implements Pacing {
  isInterrupted = false;
  readonly abort = new AbortController();
  /** Resolves true, or false once interrupted. */
  readonly sleep = vi.fn<Pacing['sleep']>(() => Promise.resolve(!this.isInterrupted));

  get signal(): AbortSignal {
    return this.abort.signal;
  }

  /** Interrupts, as the controller's Timeline does. */
  interrupt(): void {
    this.isInterrupted = true;
    this.abort.abort();
  }
}

/** A player on a stage of mocks, and the parts a test drives or reads. */
interface Harness {
  player: Player;
  scene: Scene;
  editor: ReturnType<typeof mock<PlayerEditor>>;
  panel: ReturnType<typeof mock<PanelPort>>;
  lines: ReturnType<typeof mock<LineIds>>;
  pacing: FakePacing;
  stage: Stage;
  confirm: ReturnType<typeof vi.fn<Stage['confirm']>>;
  /** The editor's files, by absolute path. */
  files: Map<string, string>;
}

/** Options for a harness: its files, a scene over an empty one, settings over CONFIG, and whether lines are known. */
interface HarnessOptions {
  files?: Record<string, string>;
  scene?: Partial<Scene>;
  config?: Partial<Config>;
  knows?: Stage['knows'];
}

/** Returns a player on a stage of mocks, with `options`. */
function harness({ files = {}, scene = {}, config = {}, knows }: HarnessOptions = {}): Harness {
  const texts = new Map(Object.entries(files).map(([name, text]) => [path.join(ROOT, name), text]));
  const editor = mock<PlayerEditor>();
  editor.resolvePath.mockImplementation((file) => path.resolve(ROOT, file));
  editor.displayPath.mockImplementation((file) => path.relative(ROOT, file));
  editor.getText.mockImplementation((file) => {
    const text = texts.get(file);
    return text === undefined ? Promise.reject(new Error(`No file ${file}`)) : Promise.resolve(text);
  });
  editor.eol.mockResolvedValue('\n');
  editor.show.mockResolvedValue();
  editor.edit.mockImplementation((file, offset, deleteLength, text) => {
    const old = texts.get(file) ?? '';
    texts.set(file, old.slice(0, offset) + text + old.slice(offset + deleteLength));
    return Promise.resolve();
  });
  editor.save.mockResolvedValue();
  editor.runCommand.mockResolvedValue({ exitCode: 0, output: 'ok' });
  const panel = mock<PanelPort>();
  const lines = mock<LineIds>();
  lines.of.mockImplementation((...[, text]) => [...text.split('\n').keys()].map((i) => i + 1));
  const pacing = new FakePacing();
  const confirm = vi.fn<Stage['confirm']>(() => Promise.resolve(true));
  const stage: Stage = {
    editor,
    panel,
    pacing,
    config: () => ({ ...CONFIG, ...config }),
    speed: () => 1,
    readingSpeed: () => READING_SPEED,
    render: vi.fn<Stage['render']>(),
    confirm,
    lines,
    ...(knows === undefined ? {} : { knows }),
  };
  const full: Scene = { turn: 'agent', focus: 'cursor', pointFar: false, allowedCommands: new Set(), ...scene };
  return { player: new Player(full, stage), scene: full, editor, panel, lines, pacing, stage, confirm, files: texts };
}

/** Plays `actions` as batch 1, and returns its result, parsed by its schema, and its sightings. */
async function played(h: Harness, actions: Action[]): Promise<{ result: BatchResult; sightings: Sighting[] }> {
  const { result, sightings } = await h.player.play(1, actions);
  return { result: BATCH_RESULT_SCHEMA.parse(result), sightings };
}

/** Returns what the player posted to the panel. */
function posted(h: Harness): PanelEvent[] {
  return h.panel.post.mock.calls.map(([event]) => event);
}

/** Returns each pause the player took, in ms. */
function pauses(h: Harness): number[] {
  return h.pacing.sleep.mock.calls.map(([ms]) => ms);
}

/** Returns the phases the panel was told for each run, in order. */
function phases(h: Harness): string[] {
  return posted(h).flatMap((event) => (event.type === 'run' ? [event.phase] : []));
}

/** Returns an outcome of a command left running in its terminal, with `outcome` over it. */
function runningOutcome(outcome: Partial<CommandOutcome>): CommandOutcome {
  return { output: 'so far', exitCode: 0, running: true, ...outcome };
}

/** Types `action`, cut after `typedChunks` chunks, and an action after it, and returns the batch's result. */
async function cutTyping(typedChunks: number, action: Action): Promise<BatchResult> {
  const h = harness({ files: { 'a.ts': '' }, scene: { cursor: { file: A, offset: 0 } } });
  for (let i = 0; i < typedChunks; i++) {
    h.pacing.sleep.mockResolvedValueOnce(true);
  }
  h.pacing.sleep.mockResolvedValueOnce(false);
  return (await played(h, [action, { say: 'After.' }])).result;
}

/** A move to the end of line `line` of a.ts. */
function moveTo(line: number): Action {
  return { move: { file: 'a.ts', line, to: 'line_end' } };
}

afterEach(() => {
  vi.resetAllMocks();
});

describe('agentPath and displayPath', () => {
  it("resolves the agent's path from its working directory, when it gave one", () => {
    const { editor } = harness();
    expect(agentPath(editor, 'a.ts')).toBe(A);
    expect(agentPath(editor, 'a.ts', '/work')).toBe('/work/a.ts');
  });

  it('names a file by its path in the root, one in a folder starting with two dots too (#5), and one outside as is', () => {
    const { editor } = harness();
    expect(displayPath(editor, A)).toBe('a.ts');
    expect(displayPath(editor, '/proj/..cache/a.ts', '/proj')).toBe('..cache/a.ts');
    expect(displayPath(editor, '/other/a.ts', '/proj')).toBe('/other/a.ts');
  });
});

describe('spanText', () => {
  it('is the text of a span, or else its from, and refuses a span with neither', () => {
    expect(spanText({ text: 'a' })).toBe('a');
    expect(spanText({ from: 'b', through: 'c' })).toBe('b');
    expect(() => spanText({})).toThrow('A span has `text` or `from`');
  });
});

describe('transformScene', () => {
  it('keeps the cursor, selection, and pointed code in place through a change to their file, and only theirs', () => {
    const scene: Scene = {
      turn: 'agent',
      focus: 'cursor',
      pointFar: false,
      allowedCommands: new Set(),
      cursor: { file: A, offset: 4 },
      selection: { start: 0, end: 9 },
      point: { file: A, start: 8, end: 9 },
    };
    transformScene(scene, A, { offset: 1, deleteLength: 6, text: 'xy' });
    expect(scene.cursor).toEqual({ file: A, offset: 3 });
    expect(scene.selection).toEqual({ start: 0, end: 5 });
    expect(scene.point).toEqual({ file: A, start: 4, end: 5 });
    transformScene(scene, B, { offset: 0, deleteLength: 0, text: 'zz' });
    expect(scene).toMatchObject({ cursor: { offset: 3 }, selection: { start: 0, end: 5 }, point: { start: 4 } });
  });

  it('leaves a selection alone when the cursor is in another file', () => {
    const scene: Scene = {
      turn: 'agent',
      focus: 'cursor',
      pointFar: false,
      allowedCommands: new Set(),
      cursor: { file: B, offset: 0 },
      selection: { start: 2, end: 3 },
    };
    transformScene(scene, A, { offset: 0, deleteLength: 0, text: 'x' });
    expect(scene.selection).toEqual({ start: 2, end: 3 });
  });
});

describe('play', () => {
  it('Complete: plays each action, saves the files it edited, and reports the code around its change, the cursor marked', async () => {
    const h = harness({ files: { 'a.ts': 'one\ntwo\n' } });
    const { result, sightings } = await played(h, [moveTo(1), { type: `!${CURSOR_MARKER}` }]);
    expect(result).toEqual({
      id: 1,
      status: 'completed',
      code: {
        file: 'a.ts',
        lines: [
          { number: 1, text: `one!${CURSOR_MARKER}` },
          { number: 2, text: 'two' },
        ],
        end: { final_newline: true },
      },
    });
    expect(sightings).toEqual([{ file: A, text: 'one!\ntwo\n', lines: [1, 2] }]);
    expect(h.editor.save.mock.calls).toEqual([[A]]);
    expect(h.editor.follow.mock.calls.length).toBeGreaterThan(0);
  });

  it('Stop: discards a batch interrupted before its first action, and reports no code for it', async () => {
    const h = harness({ files: { 'a.ts': 'x\n' } });
    h.pacing.interrupt();
    const { result } = await played(h, [moveTo(1)]);
    expect(result).toEqual({ id: 1, status: 'discarded', unplayed: [moveTo(1)] });
    expect(h.editor.getText.mock.calls).toEqual([]);
  });

  it("reports no code when the batch's file is gone by its end, and lists a file it couldn't save", async () => {
    const h = harness({ files: { 'a.ts': 'x\n' } });
    h.editor.save.mockRejectedValueOnce(new Error('disk full'));
    h.editor.edit.mockImplementationOnce(() => {
      h.files.delete(A);
      return Promise.resolve();
    });
    const { result } = await played(h, [moveTo(1), { type: `y${CURSOR_MARKER}` }]);
    expect(result).toEqual({ id: 1, status: 'completed', unsaved: [{ file: 'a.ts', error: 'disk full' }] });
  });

  it("names a file it couldn't save by the failure's text, when the failure is no Error", async () => {
    const h = harness({ files: { 'a.ts': 'x\n' } });
    h.editor.save.mockRejectedValueOnce('disk full');
    const { result } = await played(h, [moveTo(1), { type: `y${CURSOR_MARKER}` }]);
    expect(result.unsaved).toEqual([{ file: 'a.ts', error: 'disk full' }]);
  });
});

describe('code', () => {
  it('shows the lines around a span in a file the cursor is not in, with no cursor marked', async () => {
    const h = harness({ files: { 'b.ts': 'one\ntwo\nthree\n' }, scene: { cursor: { file: A, offset: 0 } } });
    const shown = await h.player.code({ span: { file: B, start: 4, end: 8 }, moved: false });
    expect(shown?.code).toEqual({
      file: 'b.ts',
      lines: [
        { number: 1, text: 'one' },
        { number: 2, text: 'two' },
        { number: 3, text: 'three' },
      ],
      end: { final_newline: true },
    });
  });

  it("shows the cursor's file after a move, and nothing for a batch that neither moved nor edited", async () => {
    const h = harness({ files: { 'a.ts': 'x' }, scene: { cursor: { file: A, offset: 1 } } });
    expect((await h.player.code({ moved: true }))?.code).toEqual({
      file: 'a.ts',
      lines: [{ number: 1, text: `x${CURSOR_MARKER}` }],
      end: { final_newline: false },
    });
    expect(await h.player.code({ moved: false })).toBeUndefined();
  });

  it('skips the middle of long code, keeps the cursor line, and says no end when the code stops before it', async () => {
    const text = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join('\n');
    function lineStart(n: number): number {
      return text.indexOf(`line ${n}\n`);
    }
    const h = harness({ files: { 'a.ts': text }, scene: { cursor: { file: A, offset: lineStart(30) } } });
    const shown = await h.player.code({ span: { file: A, start: lineStart(5), end: lineStart(70) }, moved: true });
    const numbers = shown?.code.lines.map((line) => line.number) ?? [];
    expect(numbers.slice(0, 2)).toEqual([2, 3]);
    expect(numbers).toContain(30);
    expect(numbers).not.toContain(40);
    expect(numbers.at(-1)).toBe(72);
    expect(shown?.code.end).toBeUndefined();
  });

  it('shows the empty line after a final newline when the cursor is on it', async () => {
    const h = harness({ files: { 'a.ts': 'x\n' }, scene: { cursor: { file: A, offset: 2 } } });
    expect((await h.player.code({ moved: true }))?.code.lines).toEqual([
      { number: 1, text: 'x' },
      { number: 2, text: CURSOR_MARKER },
    ]);
  });
});

describe('transform', () => {
  it("moves the scene only, outside a batch, and the batch's span too, while it plays, for a change in its file", async () => {
    const h = harness({ files: { 'a.ts': 'x\n', 'b.ts': '' }, scene: { cursor: { file: A, offset: 1 } } });
    h.player.transform(A, { offset: 0, deleteLength: 0, text: 'z' });
    expect(h.scene.cursor?.offset).toBe(2);
    h.editor.edit.mockImplementationOnce((file, offset, deleteLength, text) => {
      const old = h.files.get(file) ?? '';
      h.files.set(file, `// header\n${old.slice(0, offset)}${text}${old.slice(offset + deleteLength)}`);
      h.player.transform(A, { offset: 0, deleteLength: 0, text: '// header\n' });
      h.player.transform(B, { offset: 0, deleteLength: 0, text: 'b' });
      return Promise.resolve();
    });
    const { result } = await played(h, [moveTo(1), { type: `!${CURSOR_MARKER}` }]);
    expect(result.code?.lines.slice(0, 2)).toEqual([
      { number: 1, text: '// header' },
      { number: 2, text: `x!${CURSOR_MARKER}` },
    ]);
  });
});

describe('actions the player refuses', () => {
  it('refuses two actions in one object, a field problem, and an action that is no action', async () => {
    const h = harness({ files: { 'a.ts': 'x\n' } });
    // The schema refuses these; an action is typed, so the test builds them as the agent's JSON would.
    const two: unknown = JSON.parse('{"say":"a","run":"ls"}');
    const none: unknown = JSON.parse('{}');
    // Held back as the agent sent them, these fail the batch result's schema: the test reads the result as it is.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    expect((await h.player.play(1, [two as Action])).result.error).toEqual({
      kind: 'invalid_action',
      message: 'One action per object, got `say` and `run`: make them separate actions, in order.',
    });
    vi.mocked(fieldsProblem).mockReturnValueOnce('A problem.');
    expect((await played(h, [{ say: 'a' }])).result.error).toEqual({ kind: 'invalid_action', message: 'A problem.' });
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    expect((await h.player.play(1, [none as Action])).result.error).toEqual({ kind: 'invalid_action', message: 'Unknown action: {}' });
  });

  it("Start: allows only say and point during the programmer's turn", async () => {
    const h = harness({ files: { 'a.ts': 'x\n' }, scene: { turn: 'user' } });
    expect((await played(h, [moveTo(1)])).result.error).toEqual({
      kind: 'not_your_turn',
      message: "During the programmer's turn, only `say` and `point` are allowed.",
    });
  });

  it('Act: refuses a second file in a batch, and a file named after its first edit', async () => {
    const h = harness({ files: { 'a.ts': 'x\n', 'b.ts': 'y\n' } });
    expect((await played(h, [moveTo(1), { select: { file: 'b.ts', line: 1, text: 'y' } }])).result.error).toEqual({
      kind: 'invalid_action',
      message: 'A batch works in one file, but this one names a.ts and b.ts. Start a new batch where it switches files.',
    });
    expect((await played(h, [{ type: `z${CURSOR_MARKER}` }, { point: { file: 'a.ts', line: 1, text: 'z' } }])).result.error).toEqual({
      kind: 'invalid_action',
      message:
        "A batch works in one file: name it (in `move`, `select` or `point`) before the batch's first edit. Start a new batch where it switches files.",
    });
  });

  it("ActAtCursor: refuses a type or delete when the cursor is in another file than the batch's", async () => {
    const h = harness({ files: { 'a.ts': 'x\n', 'b.ts': 'y\n' }, scene: { cursor: { file: B, offset: 0 } } });
    vi.mocked(resolveSpan).mockReturnValue({ ok: true, range: { start: 0, end: 1 } });
    expect((await played(h, [{ point: { file: 'a.ts', line: 1, text: 'x' } }, { type: `z${CURSOR_MARKER}` }])).result.error).toEqual({
      kind: 'invalid_action',
      message: 'Your cursor is in b.ts, but this batch works in a.ts: `move` or `select` there first.',
    });
  });

  it('refuses a move, select, point, or type before the cursor is anywhere, and a delete with nothing selected', async () => {
    const h = harness({ files: { 'a.ts': 'x\n' } });
    const noCursor = { kind: 'no_cursor', message: "Your cursor isn't in a file yet; give `file`." };
    expect((await played(h, [{ move: { line: 1, to: 'line_end' } }])).result.error).toEqual(noCursor);
    expect((await played(h, [{ select: { line: 1, text: 'x' } }])).result.error).toEqual(noCursor);
    expect((await played(h, [{ point: { line: 1, text: 'x' } }])).result.error).toEqual(noCursor);
    expect((await played(h, [{ type: `y${CURSOR_MARKER}` }])).result.error).toEqual({
      kind: 'no_cursor',
      message: "Your cursor isn't in a file yet; `move` first.",
    });
    expect((await played(h, [moveTo(1), { delete: true }])).result.error).toEqual({
      kind: 'no_selection',
      message: 'Nothing is selected; `select` first.',
    });
  });

  it('refuses text to type that typeProblem refuses, and a run with no command', async () => {
    const h = harness({ files: { 'a.ts': 'x\n' }, scene: { cursor: { file: A, offset: 0 } } });
    vi.mocked(typeProblem).mockReturnValueOnce('Mark the cursor.');
    expect((await played(h, [{ type: 'y' }])).result.error).toEqual({ kind: 'invalid_action', message: 'Mark the cursor.' });
    expect((await played(h, [{ run: '  ' }])).result.error).toEqual({ kind: 'invalid_action', message: '`run` needs a command.' });
  });

  it('fails the batch with the text of what an editor call threw, an Error or not, and hands the rest back', async () => {
    const h = harness({ files: { 'a.ts': 'x\n' } });
    h.editor.show.mockRejectedValueOnce(new Error('no editor')).mockRejectedValueOnce('plain string');
    expect((await played(h, [moveTo(1), { say: 'a' }])).result).toEqual({
      id: 1,
      status: 'failed',
      error: { kind: 'invalid_action', message: 'no editor' },
      unplayed: [moveTo(1), { say: 'a' }],
    });
    expect((await played(h, [moveTo(1)])).result.error).toEqual({ kind: 'invalid_action', message: 'plain string' });
  });
});

describe('say', () => {
  it('posts the message, and pauses to read it at the reading speed, reading meanwhile', async () => {
    const h = harness();
    const readingDuring: boolean[] = [];
    h.pacing.sleep.mockImplementationOnce(() => {
      readingDuring.push(h.player.reading);
      return Promise.resolve(true);
    });
    expect((await played(h, [{ say: 'Hi.' }])).result).toEqual({ id: 1, status: 'completed' });
    expect(posted(h)).toEqual([
      { type: 'say', text: 'Hi.' },
      { type: 'reading', ms: READING_MS / READING_SPEED },
    ]);
    expect([readingDuring, h.player.reading]).toEqual([[true], false]);
  });
});

describe('move', () => {
  it('moves to the end of a line, and to a spot, pausing before and after, nearer or farther', async () => {
    const text = Array.from({ length: 10 }, (_, i) => `l${i + 1}`).join('\n');
    const h = harness({ files: { 'a.ts': text } });
    vi.mocked(resolveSpot).mockReturnValue({ ok: true, range: { start: 4, end: 4 } });
    await played(h, [moveTo(9), { move: { file: 'a.ts', line: 2, at: `l${CURSOR_MARKER}2` } }, moveTo(3)]);
    expect(h.scene.cursor).toEqual({ file: A, offset: 8 });
    const { timing } = CONFIG;
    expect(pauses(h)).toEqual([
      timing.beforeMoveMs,
      timing.afterMoveFarMs,
      timing.beforeMoveMs,
      timing.afterMoveFarMs,
      timing.beforeMoveMs,
      timing.afterMoveNearMs,
    ]);
    expect(vi.mocked(spotCandidates).mock.calls).toEqual([]);
  });

  it('says what the line reads when a spot is not on it, and lists where it is instead', async () => {
    const h = harness({ files: { 'a.ts': 'x\ny\n' } });
    vi.mocked(resolveSpot)
      .mockReturnValueOnce({ ok: false, kind: 'not_found', message: 'Not on line 1.', candidates: [{ line: 2, context: 'y' }] })
      .mockReturnValueOnce({ ok: false, kind: 'ambiguous', message: 'Twice.' });
    const notFound = await played(h, [{ move: { file: 'a.ts', line: 1, at: `x${CURSOR_MARKER}` } }]);
    expect(notFound.result.error).toEqual({ kind: 'not_found', message: 'Not on line 1.', candidates: [{ line: 2, context: 'y' }] });
    expect(notFound.sightings[0]).toEqual({ file: A, text: 'x\ny\n', lines: [1, 2] });
    const ambiguous = await played(h, [{ move: { file: 'a.ts', line: 1, at: `x${CURSOR_MARKER}` } }]);
    expect(ambiguous.result.error).toEqual({ kind: 'ambiguous', message: 'Twice.' });
    expect(ambiguous.sightings).toEqual([]);
  });

  it("goes to the cursor's line without a line, refuses that in another file, and refuses a line the file lacks", async () => {
    const h = harness({ files: { 'a.ts': 'x\ny\n', 'b.ts': 'z' }, scene: { cursor: { file: A, offset: 3 } } });
    await played(h, [{ move: { file: 'a.ts', to: 'line_end' } }]);
    expect(h.scene.cursor).toEqual({ file: A, offset: 3 });
    expect((await played(h, [{ move: { file: 'b.ts', to: 'line_end' } }])).result.error).toEqual({
      kind: 'invalid_action',
      message: "Give `line`: without it, a `move` is on your cursor's line, in its file.",
    });
    expect((await played(h, [moveTo(3)])).result.error).toEqual({ kind: 'no_line', message: "There's no line 3: a.ts has 2 lines." });
    expect((await played(h, [{ move: { file: 'b.ts', line: 2, to: 'line_end' } }])).result.error).toEqual({
      kind: 'no_line',
      message: "There's no line 2: b.ts has 1 line.",
    });
  });

  it('is interrupted while it waits to move', async () => {
    const h = harness({ files: { 'a.ts': 'x\n' } });
    h.pacing.sleep.mockResolvedValueOnce(false);
    expect((await played(h, [moveTo(1)])).result).toEqual({ id: 1, status: 'discarded', unplayed: [moveTo(1)] });
  });
});

describe('a line the agent was not shown', () => {
  it('Accept: refuses it, saying what it reads, and where the spot is, or that the text is nowhere, or neither for a line end', async () => {
    const knows = vi.fn(() => false);
    const h = harness({ files: { 'a.ts': 'x\ny\n' }, knows });
    vi.mocked(spotCandidates).mockReturnValueOnce([{ line: 1, context: 'x' }]);
    const spot = await played(h, [{ move: { file: 'a.ts', line: 2, at: `x${CURSOR_MARKER}` } }]);
    expect(spot.result.error).toEqual({
      kind: 'line_not_seen',
      message:
        'You haven\'t seen line 2 of a.ts in an up-to-date `read` or report, so its number may be off: take line numbers from them, never work them out. Now, line 2 reads "y", and the spot is on these lines:',
      candidates: [{ line: 1, context: 'x' }],
    });
    expect(spot.sightings).toEqual([{ file: A, text: 'x\ny\n', lines: [2, 1] }]);
    expect(knows).toHaveBeenCalledWith(A, 2, 2);
    vi.mocked(spanCandidates).mockReturnValueOnce([]);
    expect((await played(h, [{ select: { file: 'a.ts', line: 2, text: 'q' } }])).result.error?.message).toMatch(
      /, and the text isn't anywhere in the file\.$/,
    );
    expect((await played(h, [moveTo(2)])).result.error?.message).toMatch(/line 2 reads "y"\.$/);
  });

  it("takes a line it knows, a line of an empty file, and a line the lines' identities don't reach as unseen", async () => {
    const knows = vi.fn(() => true);
    const h = harness({ files: { 'a.ts': 'x\ny\n', 'b.ts': '' }, knows });
    expect((await played(h, [moveTo(2)])).result.status).toBe('completed');
    expect((await played(h, [{ move: { file: 'b.ts', line: 1, to: 'line_end' } }])).result.status).toBe('completed');
    h.lines.of.mockReturnValueOnce([]);
    expect((await played(h, [moveTo(1)])).result.error?.kind).toBe('line_not_seen');
  });
});

describe('select', () => {
  it('selects the span on its line, pausing before and after', async () => {
    const h = harness({ files: { 'a.ts': 'keep DELETE keep\n' } });
    vi.mocked(resolveSpan).mockReturnValue({ ok: true, range: { start: 5, end: 11 } });
    await played(h, [{ select: { file: 'a.ts', line: 1, text: 'DELETE' } }]);
    expect(h.scene.cursor).toEqual({ file: A, offset: 11 });
    expect(h.scene.selection).toEqual({ start: 5, end: 11 });
    expect(pauses(h)).toEqual([CONFIG.timing.beforeSelectMs, CONFIG.timing.afterSelectMs]);
  });

  it('shows the line a span is not on only when it was found elsewhere, and is interrupted while it waits to select', async () => {
    const h = harness({ files: { 'a.ts': 'x\n' } });
    vi.mocked(resolveSpan)
      .mockReturnValueOnce({ ok: false, kind: 'not_found', message: 'Elsewhere.', candidates: [] })
      .mockReturnValueOnce({ ok: false, kind: 'not_found', message: 'Nowhere.' });
    expect((await played(h, [{ select: { file: 'a.ts', line: 1, text: 'q' } }])).sightings).toEqual([{ file: A, text: 'x\n', lines: [1] }]);
    expect((await played(h, [{ select: { file: 'a.ts', line: 1, text: 'q' } }])).sightings).toEqual([]);
    h.pacing.sleep.mockResolvedValueOnce(false);
    expect((await played(h, [{ select: { file: 'a.ts', line: 1, text: 'x' } }])).result.status).toBe('discarded');
  });
});

describe('type', () => {
  it('types each chunk, then steps back between the two parts, with the line ending the file uses', async () => {
    const h = harness({ files: { 'a.ts': 'x' }, scene: { cursor: { file: A, offset: 1 } } });
    h.editor.eol.mockResolvedValue('\r\n');
    await played(h, [{ type: `(${CURSOR_MARKER}\n)` }]);
    expect(h.files.get(A)).toBe('x(\r\n)');
    expect(h.scene.cursor?.offset).toBe(2);
    expect(h.editor.edit.mock.calls.map(([, , , text, options]) => [text, options])).toEqual([
      ['(', { undoStopBefore: true, undoStopAfter: false }],
      ['\r\n', { undoStopBefore: false, undoStopAfter: false }],
      [')', { undoStopBefore: false, undoStopAfter: true }],
    ]);
    expect(h.lines.apply.mock.calls.length).toBe(3);
  });

  it('steps back by the plain length with a newline ending, and plays type_fast at its scale', async () => {
    const h = harness({ files: { 'a.ts': '' }, scene: { cursor: { file: A, offset: 0 } } });
    await played(h, [{ type_fast: `a${CURSOR_MARKER}\nb` }]);
    expect(h.scene.cursor?.offset).toBe(1);
    const scale = CONFIG.timing.fastFactor;
    expect(pauses(h)).toEqual([
      CHAR_MS * scale,
      CHAR_MS * scale,
      CHAR_MS * scale,
      CONFIG.timing.beforeMoveMs * scale,
      CONFIG.timing.afterMoveNearMs * scale,
    ]);
  });

  it('types over the selection, and deletes it when there is nothing to type; with neither, changes nothing', async () => {
    const h = harness({
      files: { 'a.ts': 'keep DELETE keep\n' },
      scene: { cursor: { file: A, offset: 11 }, selection: { start: 5, end: 12 } },
    });
    await played(h, [{ type: CURSOR_MARKER }]);
    expect(h.files.get(A)).toBe('keep keep\n');
    expect(h.scene.selection).toBeUndefined();
    const before = h.editor.edit.mock.calls.length;
    h.pacing.interrupt();
    // Nothing typed, nothing visible: interrupted after it, the batch is discarded.
    h.pacing.isInterrupted = false;
    h.pacing.sleep.mockResolvedValue(true);
    const nothing = harness({ files: { 'a.ts': 'x' }, scene: { cursor: { file: A, offset: 1 } } });
    nothing.editor.eol.mockImplementationOnce(() => {
      nothing.pacing.isInterrupted = true;
      return Promise.resolve('\n');
    });
    expect((await played(nothing, [{ type: CURSOR_MARKER }, { say: 'Typed.' }])).result).toEqual({
      id: 1,
      status: 'discarded',
      unplayed: [{ say: 'Typed.' }],
    });
    expect(h.editor.edit.mock.calls.length).toBe(before);
  });

  it("StopAtCheck: hands back what's left of a type cut short, before the marker or after it, and nothing if none was typed", async () => {
    expect(await cutTyping(1, { type: `ab${CURSOR_MARKER}cd` })).toMatchObject({
      status: 'interrupted',
      unplayed: [{ type: `b${CURSOR_MARKER}cd` }, { say: 'After.' }],
    });
    expect(await cutTyping(3, { type_fast: `ab${CURSOR_MARKER}cd` })).toMatchObject({
      status: 'interrupted',
      unplayed: [{ type_fast: `${CURSOR_MARKER}d` }, { say: 'After.' }],
    });
    expect(await cutTyping(0, { type: `ab${CURSOR_MARKER}` })).toEqual({
      id: 1,
      status: 'discarded',
      unplayed: [{ type: `ab${CURSOR_MARKER}` }, { say: 'After.' }],
    });
  });

  it('takes the pointed code away when it types', async () => {
    const h = harness({ files: { 'a.ts': 'x' }, scene: { cursor: { file: A, offset: 1 }, point: { file: A, start: 0, end: 1 } } });
    await played(h, [{ type: `y${CURSOR_MARKER}` }]);
    expect(h.scene.point).toBeUndefined();
    expect(h.editor.renderPoint.mock.calls).toEqual([[undefined]]);
  });
});

describe('delete', () => {
  it('Finish: deletes the selection, reading it only once the file is shown, and pauses after', async () => {
    const h = harness({
      files: { 'a.ts': 'keep DELETE keep\n' },
      scene: { cursor: { file: A, offset: 11 }, selection: { start: 5, end: 12 } },
    });
    await played(h, [{ delete: true }]);
    expect(h.files.get(A)).toBe('keep keep\n');
    expect(h.scene.cursor).toEqual({ file: A, offset: 5 });
    expect(pauses(h)).toEqual([CONFIG.timing.afterDeleteMs]);
  });

  it('TakeEffect: stops before any effect when an edit interrupts it while the file is read (#49)', async () => {
    const h = harness({
      files: { 'a.ts': 'keep DELETE keep\n' },
      scene: { cursor: { file: A, offset: 11 }, selection: { start: 5, end: 12 } },
    });
    h.editor.show.mockImplementationOnce(() => {
      h.pacing.interrupt();
      return Promise.resolve();
    });
    expect((await played(h, [{ delete: true }])).result).toEqual({ id: 1, status: 'discarded', unplayed: [{ delete: true }] });
    expect(h.editor.edit.mock.calls).toEqual([]);
  });
});

describe('point', () => {
  it("Point: shows the code in the agent's turn, and the view follows it, near the cursor or far from it", async () => {
    const text = Array.from({ length: 10 }, (_, i) => `l${i + 1}`).join('\n');
    const h = harness({ files: { 'a.ts': text, 'b.ts': 'z' }, scene: { cursor: { file: A, offset: 0 } } });
    vi.mocked(resolveSpan).mockReturnValue({ ok: true, range: { start: 3, end: 5 } });
    await played(h, [{ point: { file: 'a.ts', line: 2, text: 'l2' } }]);
    expect(h.scene).toMatchObject({ point: { file: A, start: 3, end: 5 }, focus: 'point', pointFar: false });
    expect(h.editor.renderPoint.mock.calls).toEqual([[{ file: A, start: 3, end: 5 }]]);
    expect(posted(h)).toEqual([{ type: 'point', file: 'a.ts', line: 2 }]);
    expect(pauses(h)).toEqual([CONFIG.timing.afterPointMs]);
    vi.mocked(resolveSpan).mockReturnValue({ ok: true, range: { start: 24, end: 26 } });
    await played(h, [{ point: { file: 'a.ts', line: 9, text: 'l9' } }]);
    expect(h.scene.pointFar).toBe(true);
    vi.mocked(resolveSpan).mockReturnValue({ ok: true, range: { start: 0, end: 1 } });
    await played(h, [{ point: { file: 'b.ts', line: 1, text: 'z' } }]);
    expect(h.scene.pointFar).toBe(true);
  });

  it("points without showing the file or moving the view in the programmer's turn", async () => {
    const h = harness({ files: { 'a.ts': 'x' }, scene: { turn: 'user' } });
    vi.mocked(resolveSpan).mockReturnValue({ ok: true, range: { start: 0, end: 1 } });
    await played(h, [{ point: { file: 'a.ts', line: 1, text: 'x' } }]);
    expect(h.scene.focus).toBe('cursor');
    expect([h.editor.show.mock.calls, h.editor.follow.mock.calls]).toEqual([[], []]);
    expect(h.scene.point).toEqual({ file: A, start: 0, end: 1 });
  });

  it('refuses a span that is not on its line', async () => {
    const h = harness({ files: { 'a.ts': 'x' } });
    vi.mocked(resolveSpan).mockReturnValueOnce({ ok: false, kind: 'ambiguous', message: 'Twice.' });
    expect((await played(h, [{ point: { file: 'a.ts', line: 1, text: 'x' } }])).result.error).toEqual({
      kind: 'ambiguous',
      message: 'Twice.',
    });
  });
});

describe('looking back at the cursor', () => {
  it('ActAtCursor: brings the view back from far-pointed code with a far pause, and from near code with none', async () => {
    const far = harness({ files: { 'a.ts': 'x' }, scene: { cursor: { file: A, offset: 1 }, focus: 'point', pointFar: true } });
    await played(far, [{ type: `y${CURSOR_MARKER}` }]);
    expect(far.scene.focus).toBe('cursor');
    expect(far.editor.show.mock.calls[0]).toEqual([A]);
    expect(pauses(far)[0]).toBe(CONFIG.timing.afterMoveFarMs);
    const near = harness({ files: { 'a.ts': 'x' }, scene: { cursor: { file: A, offset: 1 }, focus: 'point', pointFar: false } });
    await played(near, [{ type: `y${CURSOR_MARKER}` }]);
    expect(pauses(near)[0]).toBe(CHAR_MS);
  });

  it('takes no extra pause for a move back, which has its own, nor in another file than the batch names', async () => {
    const move = harness({ files: { 'a.ts': 'x\n' }, scene: { cursor: { file: A, offset: 1 }, focus: 'point', pointFar: true } });
    await played(move, [moveTo(1)]);
    expect(pauses(move)).toEqual([CONFIG.timing.beforeMoveMs, CONFIG.timing.afterMoveFarMs]);
    const elsewhere = harness({
      files: { 'a.ts': 'x\n', 'b.ts': 'y' },
      scene: { cursor: { file: B, offset: 0 }, focus: 'point', pointFar: true },
    });
    vi.mocked(resolveSpan).mockReturnValue({ ok: true, range: { start: 0, end: 1 } });
    await played(elsewhere, [{ select: { file: 'a.ts', line: 1, text: 'x' } }]);
    expect(pauses(elsewhere)).toEqual([CONFIG.timing.beforeSelectMs, CONFIG.timing.afterSelectMs]);
    const unmoved = harness({ files: { 'a.ts': 'x' }, scene: { focus: 'point', pointFar: true } });
    await played(unmoved, [{ type: `y${CURSOR_MARKER}` }]);
    expect(unmoved.editor.show.mock.calls).toEqual([]);
  });

  it('discards a batch interrupted while the view comes back from far away', async () => {
    const h = harness({ files: { 'a.ts': 'x' }, scene: { cursor: { file: A, offset: 1 }, focus: 'point', pointFar: true } });
    h.pacing.sleep.mockResolvedValueOnce(false);
    expect((await played(h, [{ type: `!${CURSOR_MARKER}` }])).result).toEqual({
      id: 1,
      status: 'discarded',
      unplayed: [{ type: `!${CURSOR_MARKER}` }],
    });
  });
});

describe('run', () => {
  it('SaveAndRun: saves the batch first, runs in the root, waits as long as asked within the most, and reports the run', async () => {
    const h = harness({ files: { 'a.ts': 'x' }, scene: { root: '/work', cursor: { file: A, offset: 1 } } });
    h.editor.runCommand.mockResolvedValueOnce({ exitCode: 0, output: 'done', truncated: true, shell: 'zsh' });
    const { result } = await played(h, [{ type: `y${CURSOR_MARKER}` }, { run: 'npm test', wait: 60 }]);
    expect(result.runs).toEqual([{ command: 'npm test', output: 'done', exit_code: 0, truncated: true, shell: 'zsh' }]);
    expect(h.editor.save.mock.invocationCallOrder[0]).toBeLessThan(h.editor.runCommand.mock.invocationCallOrder[0] ?? 0);
    expect(h.editor.runCommand.mock.calls[0]?.slice(0, 1)).toEqual(['npm test']);
    expect(h.editor.runCommand.mock.calls[0]?.[1]).toMatchObject({ cwd: '/work', waitMs: CONFIG.maxRunWaitMs });
    expect(phases(h)).toEqual(['running', 'done']);
    expect(h.player.commandRunning).toBe(false);
  });

  it("runs in the editor's folder with no root, for the default wait, and fails the batch on a non-zero exit", async () => {
    const h = harness();
    h.editor.runCommand.mockResolvedValue({ exitCode: 2, output: '' });
    const { result } = await played(h, [{ run: 'false' }, { say: 'After.' }]);
    expect(h.editor.runCommand.mock.calls[0]?.[1]).toMatchObject({ cwd: ROOT, waitMs: CONFIG.runWaitMs });
    expect(result).toMatchObject({
      status: 'failed',
      error: { kind: 'command_failed', message: 'The command exited with 2.' },
      unplayed: [{ say: 'After.' }],
    });
    expect(result.runs).toEqual([{ command: 'false', output: '', exit_code: 2 }]);
    const last = await played(h, [{ run: 'false' }]);
    expect(last.result.unplayed).toBeUndefined();
  });

  it('SaveAndConfirm, Decline: asks first, runs once allowed, refuses when declined, and stops when interrupted meanwhile', async () => {
    const h = harness({ config: { confirmCommands: true } });
    await played(h, [{ run: 'ls' }]);
    expect(phases(h)).toEqual(['confirm', 'running', 'done']);
    h.confirm.mockResolvedValueOnce(false);
    expect((await played(h, [{ run: 'ls' }])).result.error).toEqual({
      kind: 'command_declined',
      message: 'The programmer declined to run this command.',
    });
    h.confirm.mockImplementationOnce(() => {
      h.pacing.interrupt();
      return Promise.resolve(true);
    });
    expect((await played(h, [{ run: 'ls' }])).result).toEqual({ id: 1, status: 'discarded', unplayed: [{ run: 'ls' }] });
    expect(phases(h).slice(-4)).toEqual(['confirm', 'declined', 'confirm', 'declined']);
  });

  it('runs a command the programmer allowed for the session without asking', async () => {
    const h = harness({ config: { confirmCommands: true }, scene: { allowedCommands: new Set(['ls']) } });
    await played(h, [{ run: 'ls' }]);
    expect(phases(h)).toEqual(['running', 'done']);
  });

  it("FailSave: doesn't run when the batch's edits can't be saved, and names the files once", async () => {
    const h = harness({ files: { 'a.ts': 'x' }, scene: { cursor: { file: A, offset: 1 } } });
    h.editor.save.mockRejectedValue(new Error('read-only'));
    const { result } = await played(h, [{ type: `y${CURSOR_MARKER}` }, { run: 'ls' }]);
    expect(result.error?.kind).toBe('save_failed');
    expect(result.error?.message).toMatch(/^Couldn't save a\.ts \(read-only\), so the command didn't run/);
    expect(result.unsaved).toBeUndefined();
    expect(h.editor.runCommand.mock.calls).toEqual([]);
  });

  it('FinishCommand: declines a command that threw or never started, and keeps the panel on one left running', async () => {
    const h = harness();
    h.editor.runCommand.mockRejectedValueOnce(new Error('terminal gone'));
    expect((await played(h, [{ run: 'ls' }])).result.error).toEqual({ kind: 'invalid_action', message: 'terminal gone' });
    h.editor.runCommand.mockResolvedValueOnce({ output: '', notStarted: true });
    expect((await played(h, [{ run: 'ls' }])).result.status).toBe('discarded');
    expect(phases(h)).toEqual(['running', 'declined', 'running', 'declined']);
  });

  it('StopWhileRunning: reports a command running on, posts its exit when it ends, and counts it as played when interrupted', async () => {
    const exited = Promise.withResolvers<number | undefined>();
    const gone = Promise.withResolvers<number | undefined>();
    const h = harness();
    h.editor.runCommand
      .mockResolvedValueOnce(runningOutcome({ exited: exited.promise }))
      .mockResolvedValueOnce(runningOutcome({ exited: gone.promise }));
    const first = await played(h, [{ run: 'build' }]);
    expect(first.result.runs).toEqual([{ command: 'build', output: 'so far', running: true }]);
    exited.resolve(0);
    await played(h, [{ run: 'serve' }]);
    gone.reject(new Error('terminal gone'));
    expect(phases(h).filter((phase) => phase === 'exited')).toEqual(['exited']);
    for (const [actions, unplayed] of [
      [[{ run: 'watch' }], undefined],
      [[{ run: 'watch' }, { say: 'Never.' }], [{ say: 'Never.' }]],
    ] as const) {
      const cut = harness();
      cut.editor.runCommand.mockImplementation(() => {
        cut.pacing.interrupt();
        return Promise.resolve(runningOutcome({}));
      });
      const { result } = await played(cut, [...actions]);
      expect(result.status).toBe('interrupted');
      expect(result.unplayed).toEqual(unplayed);
    }
  });
});

describe('the batch after an interrupt', () => {
  it('hands back the rest of a cut type before the batch, and only the batch after a command that ran on', async () => {
    const h = harness({ files: { 'a.ts': '' }, scene: { cursor: { file: A, offset: 0 } } });
    h.pacing.sleep.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect((await played(h, [{ type: `ab${CURSOR_MARKER}` }, { say: 'x' }])).result.unplayed).toEqual([
      { type: `b${CURSOR_MARKER}` },
      { say: 'x' },
    ]);
  });
});
