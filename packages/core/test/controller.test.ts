// The controller on its own: sessions, the batch queue, calls and their reports, the programmer's input, pauses,
// and the panel's status (specs/Controller.tla, specs/Serialize.tla, specs/ListenGrace.tla, specs/Navigator.tla,
// specs/Resume.tla, specs/Anchor.tla, specs/EditEvents.tla, specs/Rehearsal.tla, specs/Timeline.tla). Solitary: the
// Player, LineIds, Timeline, the rehearsal, diff.ts, text.ts, timing.ts's functions, and the protocol's ToolError are
// fakes that record what the controller asks and answer as each case sets; the editor and panel are typed mocks;
// timers are fake. Every report is parsed by REPORT_SCHEMA.

import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';
import { CURSOR_MARKER, REPORT_SCHEMA, type Action, type BatchResult, type Report } from '@ai-pair/protocol';
import { defaultConfig, type Config } from '../src/config';
import { Controller, isSavedSession, type SavedSession } from '../src/controller';
import { boundedDiff, lineChanges } from '../src/diff';
import { followChange, rehearse } from '../src/rehearsal';
import type { LineIds, Sighting } from '../src/lines';
import type { Failure, Scene, Stage } from '../src/player';
import type { EditorPort, PanelEvent, PanelPort, SharedSelection } from '../src/ports';
import { glideDuration, withOverrides } from '../src/timing';

/** What the mocked modules share with the tests, made before the `vi.mock` factories run. */
const fakes = vi.hoisted(() => {
  /** A LineIds, faked: the methods the controller calls. */
  interface FakeLines {
    of: ReturnType<typeof vi.fn<(file: string, text: string) => number[]>>;
    apply: ReturnType<typeof vi.fn>;
    adopt: ReturnType<typeof vi.fn>;
    fork: ReturnType<typeof vi.fn>;
    forget: ReturnType<typeof vi.fn>;
  }

  /** The Timeline, faked: it records pauses, resumes, interrupts, and resets, and holds an abort signal. */
  class FakeTimeline {
    isInterrupted = false;
    private abort = new AbortController();
    readonly pause = vi.fn();
    readonly resume = vi.fn();
    readonly sleep = vi.fn(() => Promise.resolve(true));
    readonly interrupt = vi.fn(() => {
      this.isInterrupted = true;
      this.abort.abort();
    });
    readonly reset = vi.fn(() => {
      this.isInterrupted = false;
      this.abort = new AbortController();
    });

    constructor(readonly paused: boolean) {
      fakes.timelines.push(this);
    }

    get signal(): AbortSignal {
      return this.abort.signal;
    }
  }

  /** The Player, faked: it records its scene and stage, plays each batch as a test says, and shows no cursor. */
  class FakePlayer {
    reading = false;
    commandRunning = false;
    readonly play = vi.fn((id: number): Promise<{ result: BatchResult; sightings: Sighting[] }> =>
      Promise.resolve({ result: { id, status: 'completed' }, sightings: [] }),
    );
    readonly transform = vi.fn();
    /** By default, the cursor's file can't be read, so a report adds no cursor. */
    readonly codeAt = vi.fn((): Promise<unknown> => Promise.reject(new Error('unread')));
    readonly scene: unknown;
    readonly stage: unknown;

    constructor(given: unknown, on: unknown) {
      this.scene = given;
      this.stage = on;
      fakes.players.push(this);
    }
  }

  /** ports.ts's error for a file that doesn't exist, faked. */
  class FakeMissingFile extends Error {
    constructor(readonly file: string) {
      super(`${file} doesn't exist`);
    }
  }

  /** The protocol's ToolError, faked: a refused call, with its code. */
  class FakeToolError extends Error {
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  }

  return {
    /** Returns a LineIds, faked: each line's identity is its number, unless a test says otherwise. */
    fakeLines: (): FakeLines => ({
      of: vi.fn((...[, text]: [string, string]) => [...text.split('\n').keys()].map((i) => i + 1)),
      apply: vi.fn(),
      adopt: vi.fn(),
      fork: vi.fn(),
      forget: vi.fn(),
    }),
    FakeTimeline,
    FakePlayer,
    FakeMissingFile,
    FakeToolError,
    /** Each Timeline, Player, and LineIds.editor() the controller made, in order. */
    timelines: [] as FakeTimeline[],
    players: [] as FakePlayer[],
    lines: [] as FakeLines[],
  };
});

/** The agent's project. */
const ROOT = '/project';

/** A file of the project, and another. */
const A = path.join(ROOT, 'a.ts');
const B = path.join(ROOT, 'b.ts');

/** The settings: short waits, so the tests can run them out. */
const CONFIG: Config = {
  ...defaultConfig,
  maxBlockMs: 1000,
  navigatorIdleMs: 300,
  listenGraceMs: 500,
  absentMs: 2000,
  confirmCommands: true,
};

/** A batch the agent submits: one that says something. */
const SAY: Action[] = [{ say: 'Hi.' }];

/** A move that anchors the cursor, with its file and line. */
const ANCHORED: Action = { move: { file: 'a.ts', line: 1, to: 'line_end' } };

vi.mock('@ai-pair/protocol', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ai-pair/protocol')>()),
  ToolError: fakes.FakeToolError,
}));
vi.mock('../src/player', () => ({
  Player: vi.fn(fakes.FakePlayer),
  agentPath: vi.fn((...[, file, root]: [unknown, string, string?]) => path.resolve(root ?? ROOT, file)),
  displayPath: vi.fn((...[, file, root]: [unknown, string, string?]) => path.relative(root ?? ROOT, file)),
}));
vi.mock('../src/lines', () => ({
  LineIds: {
    editor: vi.fn(() => {
      const lines = fakes.fakeLines();
      fakes.lines.push(lines);
      return lines;
    }),
  },
}));
vi.mock('../src/timeline', () => ({ Timeline: vi.fn(fakes.FakeTimeline) }));
vi.mock('../src/ports', () => ({ MissingFile: fakes.FakeMissingFile }));
vi.mock('../src/rehearsal', () => ({
  rehearse: vi.fn(() =>
    Promise.resolve({
      result: { id: 0, status: 'completed' },
      sightings: [],
      after: { scene: {}, texts: new Map(), lines: fakes.fakeLines(), edits: new Set() },
    }),
  ),
  followChange: vi.fn(),
}));
vi.mock('../src/diff', () => ({
  boundedDiff: vi.fn((...[file, before, after]: [string, string, string]) => ({ diff: `${file}: ${before} -> ${after}` })),
  lineChanges: vi.fn((...[, changes]: [string, unknown]) => changes),
}));
vi.mock('../src/text', () => ({
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
}));
vi.mock('../src/timing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/timing')>()),
  glideDuration: vi.fn(() => 42),
  withOverrides: vi.fn((...[base]: [unknown, unknown]) => base),
}));

/** A controller on mocks, and the parts a test drives or reads. */
interface Harness {
  controller: Controller;
  editor: ReturnType<typeof mock<EditorPort>>;
  panel: ReturnType<typeof mock<PanelPort>>;
  /** The editor's files, by absolute path. */
  files: Map<string, string>;
  traced: string[];
}

/** A fake Player the controller made. */
type FakePlayer = InstanceType<typeof fakes.FakePlayer>;

/** A fake Timeline the controller made. */
type FakeTimeline = InstanceType<typeof fakes.FakeTimeline>;

/** Returns a controller on mocks, with `config` over CONFIG and `files` in its editor. */
function harness(config: Partial<Config> = {}, files: Record<string, string> = {}): Harness {
  const texts = new Map(Object.entries(files).map(([name, text]) => [path.join(ROOT, name), text]));
  const editor = mock<EditorPort>();
  editor.resolvePath.mockImplementation((file) => path.resolve(ROOT, file));
  editor.displayPath.mockImplementation((file) => path.relative(ROOT, file));
  editor.getText.mockImplementation((file) => {
    const text = texts.get(file);
    return text === undefined ? Promise.reject(new fakes.FakeMissingFile(file)) : Promise.resolve(text);
  });
  editor.isDirty.mockResolvedValue(false);
  const panel = mock<PanelPort>();
  const controller = new Controller(editor, panel, { ...CONFIG, ...config });
  const traced: string[] = [];
  controller.trace = (line) => {
    traced.push(line);
  };
  return { controller, editor, panel, files: texts, traced };
}

/** Returns a harness with a session started. */
async function started(config: Partial<Config> = {}, files: Record<string, string> = {}): Promise<Harness> {
  const h = harness(config, files);
  await h.controller.start('A task.');
  return h;
}

/** Returns the Player the controller made last. */
function player(): FakePlayer {
  const made = fakes.players.at(-1);
  if (made === undefined) {
    throw new Error('No Player was made.');
  }
  return made;
}

/** Returns the stage the controller gave its last Player. */
function stage(): Stage {
  // The fake Player is handed the controller's stage, of this type.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return player().stage as Stage;
}

/** Returns the scene the controller gave its last Player. */
function scene(): Scene {
  // The fake Player is handed the controller's scene, of this type.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return player().scene as Scene;
}

/** Returns the Timeline the controller made last. */
function timeline(): FakeTimeline {
  const made = fakes.timelines.at(-1);
  if (made === undefined) {
    throw new Error('No Timeline was made.');
  }
  return made;
}

/** Returns the session's LineIds. */
function sessionLines(): ReturnType<typeof fakes.fakeLines> {
  const made = fakes.lines.at(-1);
  if (made === undefined) {
    throw new Error('No LineIds was made.');
  }
  return made;
}

/** Returns fake lines as the LineIds they stand in for: the controller calls only the methods they have. */
function asLines(lines: ReturnType<typeof fakes.fakeLines>): LineIds {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return lines as unknown as LineIds;
}

/** Returns a rejection the agent was given, at action `index`, as a restored report holds it. */
function heldRejection(index: number): NonNullable<Report['rejected']> {
  return { index, action: { say: 'x' }, error: { kind: 'no_line', message: 'No.' } };
}

/** Lets every timer and promise due run. */
async function settle(ms = 0): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

/** Returns a promise's report once it settles, parsed by its schema, letting timers run until then. */
async function report(promise: Promise<Report>): Promise<Report> {
  const state = { done: false };
  void promise.finally(() => {
    state.done = true;
  });
  for (let i = 0; i < 100 && !state.done; i++) {
    await settle(10);
  }
  return REPORT_SCHEMA.parse(await promise);
}

/** Returns whether `promise` is still pending once the due timers and promises ran. */
async function pending(promise: Promise<unknown>): Promise<boolean> {
  let done = false;
  void promise.then(
    () => {
      done = true;
    },
    () => {
      done = true;
    },
  );
  await settle();
  return !done;
}

/** Returns what the controller posted to the panel. */
function posted(h: Harness): PanelEvent[] {
  return h.panel.post.mock.calls.map(([event]) => event);
}

/** Returns the statuses the panel was told, in order. */
function statuses(h: Harness): string[] {
  return posted(h).flatMap((event) => (event.type === 'state' ? [event.state] : []));
}

/** Makes the next batch the Player plays wait, and returns how to finish it with `result`. */
function holdPlay(): (result?: Partial<BatchResult>, sightings?: Sighting[]) => void {
  const { promise, resolve } = Promise.withResolvers<{ result: BatchResult; sightings: Sighting[] }>();
  let id = 0;
  player().play.mockImplementationOnce((batch: number) => {
    id = batch;
    return promise;
  });
  return (result = {}, sightings = []) => {
    resolve({ result: { id, status: 'completed', ...result }, sightings });
  };
}

/**
 * Makes the next rehearsal answer with `result`, leaving `texts` in its files and `edits` as the files it edits;
 * `failed` is the action it failed at.
 */
function rehearsed(
  result: Partial<BatchResult> = {},
  texts: Record<string, string> = {},
  edits: string[] = [],
  failed?: Failure,
): ReturnType<typeof fakes.fakeLines> {
  const lines = fakes.fakeLines();
  vi.mocked(rehearse).mockResolvedValueOnce({
    result: { id: 0, status: 'completed', ...result },
    sightings: [],
    failed,
    after: {
      scene: scene(),
      texts: new Map(Object.entries(texts).map(([name, text]) => [path.join(ROOT, name), text])),
      lines: asLines(lines),
      edits: new Set(edits.map((name) => path.join(ROOT, name))),
    },
  });
  return lines;
}

/** A selection the programmer shares, in a.ts. */
function selection(): SharedSelection {
  return { file: A, from: { line: 1, column: 1 }, to: { line: 2, column: 3 }, text: 'x' };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  fakes.timelines.length = 0;
  fakes.players.length = 0;
  fakes.lines.length = 0;
  vi.useRealTimers();
  // Reset, not cleared: a value a case queued with mockResolvedValueOnce and left unused must not reach the next.
  vi.resetAllMocks();
});

describe('isSavedSession', () => {
  it('takes a value with a scene, finished batches, and events as a saved session, and nothing else', () => {
    expect(isSavedSession({ scene: {}, finished: [], events: [] })).toBe(true);
    expect(isSavedSession({ scene: {}, finished: [] })).toBe(false);
    expect(isSavedSession(JSON.parse('null'))).toBe(false);
    expect(isSavedSession('a session')).toBe(false);
  });
});

describe('start', () => {
  it('starts a session with its task, rules, and root, and gives the Player its stage', async () => {
    const h = harness();
    expect(REPORT_SCHEMA.parse(await h.controller.start('Fix it.', 'sub', ['GUIDE.md']))).toEqual({
      batches: [],
      events: [],
      turn: 'agent',
    });
    expect(scene()).toMatchObject({ root: path.join(ROOT, 'sub'), turn: 'agent', focus: 'cursor', pointFar: false });
    expect(posted(h)[0]).toEqual({ type: 'session', active: true, task: 'Fix it.', rules: ['GUIDE.md'] });
    expect(h.traced).toContain('session started: Fix it.');
    expect(timeline().paused).toBe(false);
    const given = stage();
    expect([given.speed(), given.readingSpeed(), given.config().maxBlockMs]).toEqual([1, 1, CONFIG.maxBlockMs]);
    given.render();
    expect(statuses(h)).toEqual(['thinking']);
    expect(given.lines).toBe(sessionLines());
    expect(given.pacing).toBe(timeline());
  });

  it('starts without a task, root, or rules, and gives no rules when the list is empty', async () => {
    const h = harness();
    await h.controller.start(undefined, undefined, []);
    expect(posted(h)[0]).toEqual({ type: 'session', active: true, task: undefined });
    expect(scene().root).toBeUndefined();
    expect(h.traced).toContain('session started');
  });

  it('refuses a start while a session is active, and starts anew once that one ended', async () => {
    const h = await started();
    await expect(h.controller.start()).rejects.toMatchObject({ code: 'session_active' });
    h.controller.endSession();
    await h.controller.start('Another.');
    expect(fakes.players).toHaveLength(2);
  });

  it('starts paused when the programmer paused before it', async () => {
    const h = harness();
    h.controller.pause();
    await h.controller.start();
    expect(timeline().paused).toBe(true);
  });
});

describe('a session the agent leaves, and comes back to', () => {
  it('ResumesSameProp, Arrives: suspends a session the agent disconnects from, and resumes it on a start from its directory', async () => {
    const h = harness();
    await h.controller.start('Kept.', ROOT);
    h.controller.disconnect();
    expect(h.controller.isSuspended).toBe(true);
    expect(posted(h).at(-1)).toEqual({ type: 'session', active: true, task: 'Kept.', suspended: true });
    const resumed = REPORT_SCHEMA.parse(await h.controller.start(undefined, ROOT, ['GUIDE.md']));
    expect(resumed).toEqual({ batches: [], events: [], turn: 'agent', resumed: true });
    expect(posted(h).at(-1)).toEqual({ type: 'session', active: true, task: 'Kept.', resumed: true, rules: ['GUIDE.md'] });
    expect(fakes.players).toHaveLength(1);
    h.controller.disconnect();
    await h.controller.start(undefined, ROOT, []);
    expect(posted(h).at(-1)).toEqual({ type: 'session', active: true, task: 'Kept.', resumed: true });
  });

  it('WaitsProp: starts a new session from another directory, ending the suspended one', async () => {
    const h = harness();
    await h.controller.start('Kept.', ROOT);
    h.controller.disconnect();
    await h.controller.start('New.', '/other');
    expect(fakes.players).toHaveLength(2);
    expect(scene().root).toBe('/other');
    expect(h.controller.isSuspended).toBe(false);
  });

  it('WaitsProp: closes a suspended session at once when the programmer ends it', async () => {
    const h = await started();
    h.controller.disconnect();
    h.controller.endSession();
    expect(h.controller.isActive).toBe(false);
    expect(posted(h).at(-1)).toEqual({ type: 'session', active: false, reason: 'programmer' });
  });

  it('EndedHasAgent: rejects the open call when the agent disconnects, and closes at once a session the programmer ended', async () => {
    const h = await started();
    const listen = h.controller.listen();
    const refused = expect(listen).rejects.toMatchObject({ code: 'no_session', message: 'Disconnected.' });
    await settle();
    h.controller.disconnect();
    await refused;
    await h.controller.start(undefined, undefined);
    h.controller.endSession();
    h.controller.disconnect();
    expect([h.controller.isSuspended, h.controller.isActive]).toEqual([false, false]);
    await expect(h.controller.listen()).rejects.toMatchObject({ code: 'no_session' });
    harness().controller.disconnect();
  });

  it('SavedIsCurrent, NotLostProp: saves a session for the window, and none once it ended', async () => {
    const h = harness();
    expect(h.controller.saved).toBeUndefined();
    await h.controller.start('Kept.', ROOT);
    scene().cursor = { file: A, offset: 2 };
    scene().allowedCommands.add('ls');
    h.controller.userInterrupt();
    h.controller.userEdit(A, 'a', 'b', []);
    expect(h.controller.saved).toEqual({
      task: 'Kept.',
      scene: { root: ROOT, turn: 'agent', cursor: { file: A, offset: 2 }, selection: undefined, allowedCommands: ['ls'] },
      finished: [],
      events: [{ kind: 'interrupt' }],
    });
    h.controller.endSession();
    expect(h.controller.saved).toBeUndefined();
  });

  it('SavedIsCurrent, NotLostProp, ShownIsState: brings back a session the window saved, suspended, after a reload', async () => {
    const h = harness();
    const saved: SavedSession = {
      task: 'Kept.',
      // A session saved by 0.6.10 or earlier holds null where nothing was set.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      scene: {
        root: ROOT,
        turn: 'programmer',
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        cursor: JSON.parse('null') as undefined,
        selection: { start: 0, end: 1 },
        allowedCommands: ['ls'],
      },
      finished: [{ id: 3, status: 'completed' }],
      events: [{ kind: 'interrupt' }],
    };
    h.controller.revive(saved);
    expect(h.controller.isSuspended).toBe(true);
    expect(scene()).toMatchObject({ cursor: undefined, selection: { start: 0, end: 1 }, turn: 'programmer', focus: 'cursor' });
    expect(scene().allowedCommands).toEqual(new Set(['ls']));
    expect(posted(h)[0]).toEqual({ type: 'session', active: true, task: 'Kept.', suspended: true });
    expect(h.traced).toContain('session revived after a reload, suspended');
    h.controller.revive(saved);
    expect(fakes.players).toHaveLength(1);
    const resumed = REPORT_SCHEMA.parse(await h.controller.start(undefined, ROOT));
    expect(resumed).toMatchObject({ batches: [{ id: 3, status: 'completed' }], events: [{ kind: 'interrupt' }], resumed: true });
  });
});

describe('steps and their batches', () => {
  it('BatchEnds, ReadyAtHead: returns the first step immediately and blocks the second until the first finishes', async () => {
    const h = await started();
    const finish = holdPlay();
    const first = await report(h.controller.step(SAY));
    expect(first).toMatchObject({ batches: [], submitted: { id: 1, status: 'playing' } });
    const second = h.controller.step(SAY);
    expect(await pending(second)).toBe(true);
    finish();
    expect(await report(second)).toMatchObject({ batches: [{ id: 1, status: 'completed' }] });
    expect(h.traced).toContain('batch 1 queued: 1 actions');
  });

  it('an empty step waits for the queued batches, and returns at once with none', async () => {
    const h = await started();
    expect(await report(h.controller.step([]))).toEqual({ batches: [], events: [], turn: 'agent' });
    const finish = holdPlay();
    await report(h.controller.step(SAY));
    const waiting = h.controller.step([]);
    expect(await pending(waiting)).toBe(true);
    finish();
    expect((await report(waiting)).batches).toEqual([{ id: 1, status: 'completed' }]);
  });

  it('rejects a batch whose rehearsal fails, at the action that failed, with the code it shows, queuing nothing', async () => {
    const h = await started();
    const code = { file: 'a.ts', lines: [{ number: 1, text: 'x' }] };
    const lines = fakes.fakeLines();
    const actions: Action[] = [ANCHORED, { say: 'Hi.' }];
    vi.mocked(rehearse).mockResolvedValueOnce({
      result: { id: 0, status: 'failed', error: { kind: 'not_found', message: 'Not there.' }, unplayed: [{ say: 'Hi.' }], code },
      sightings: [{ file: A, text: 'x\ny', lines: [2] }],
      failed: { index: 2, action: { say: 'Hi.' }, error: { kind: 'not_found', message: 'Not there.' } },
      after: { scene: scene(), texts: new Map(), lines: asLines(lines), edits: new Set() },
    });
    const rejected = await report(h.controller.step(actions));
    expect(rejected.rejected).toEqual({ index: 2, action: { say: 'Hi.' }, error: { kind: 'not_found', message: 'Not there.' }, code });
    expect(lines.of).toHaveBeenCalledWith(A, 'x\ny');
    expect(player().play).not.toHaveBeenCalled();
    expect(h.traced.at(-1)).toMatch(/^report to step: batches \[\], events \[\], rejected at action 2: not_found, \d+ chars$/);
  });

  it('rejects a failed rehearsal without code', async () => {
    const h = await started();
    const error = { kind: 'no_line' as const, message: 'No line 9.' };
    rehearsed({ status: 'failed', error, unplayed: SAY }, {}, [], { index: 1, action: { say: 'Hi.' }, error });
    expect((await report(h.controller.step(SAY))).rejected).toEqual({ index: 1, action: { say: 'Hi.' }, error });
  });

  it('PlaysKnowingEvents: discards a batch planned before an interruption the agent has not seen', async () => {
    const h = await started();
    h.controller.userInterrupt();
    const discarded = await report(h.controller.step(SAY));
    expect(discarded).toMatchObject({ batches: [{ id: 1, status: 'discarded', unplayed: SAY }], events: [{ kind: 'interrupt' }] });
    expect(rehearse).not.toHaveBeenCalled();
    expect(h.traced).toContain('batch 1 discarded');
  });

  it('discards a batch when an interruption arrives during its rehearsal', async () => {
    const h = await started();
    const { promise, resolve } = Promise.withResolvers<Awaited<ReturnType<typeof rehearse>>>();
    vi.mocked(rehearse).mockReturnValueOnce(promise);
    const step = h.controller.step(SAY);
    await settle();
    h.controller.userInterrupt();
    resolve({
      result: { id: 0, status: 'completed' },
      sightings: [],
      after: { scene: scene(), texts: new Map(), lines: asLines(fakes.fakeLines()), edits: new Set() },
    });
    expect((await report(step)).batches).toEqual([{ id: 1, status: 'discarded', unplayed: SAY }]);
  });

  it('rehearses each batch from where the queued ones leave off, knowing the lines the agent was shown', async () => {
    const h = await started({}, { 'a.ts': 'x\ny\n' });
    holdPlay();
    await h.controller.read('a.ts');
    const firstLines = rehearsed();
    await report(h.controller.step(SAY));
    const [, , from, , knows] = vi.mocked(rehearse).mock.calls[0] ?? [];
    expect(from?.scene).toBe(scene());
    expect(knows?.(A, 1, 1)).toBe(true);
    expect(knows?.(A, 1, 2)).toBe(false);
    expect(knows?.(B, 1, 1)).toBe(false);
    void h.controller.step(SAY);
    await settle();
    expect(vi.mocked(rehearse).mock.calls[1]?.[2].lines).toBe(firstLines);
  });

  it('NoMisplacedEdit, AcceptsUnanchored: refuses a batch after a discarded one unless it anchors the cursor with a file and line', async () => {
    const h = await started();
    h.controller.userInterrupt();
    await report(h.controller.step(SAY));
    const type: Action = { type: `x${CURSOR_MARKER}` };
    const refused = await report(h.controller.step([{ say: 'Again.' }, { point: { line: 1, text: 'x' } }, { run: 'ls' }, type]));
    expect(refused.rejected).toMatchObject({ index: 4, action: type, error: { kind: 'unanchored' } });
    expect((await report(h.controller.step([{ select: { line: 1, text: 'x' } }]))).rejected?.error.kind).toBe('unanchored');
    expect((await report(h.controller.step([{ say: 'Only words.' }]))).rejected).toBeUndefined();
    await report(h.controller.step([ANCHORED]));
    await report(h.controller.step([]));
    expect((await report(h.controller.step([type]))).rejected).toBeUndefined();
  });

  it('NoRejectionLost: delivers a held rejection with the step discarded as stale before refusing an unanchored one (#193)', async () => {
    const h = await started();
    h.controller.userInterrupt();
    await report(h.controller.step(SAY));
    const rejected = { index: 1, action: { say: 'x' }, error: { kind: 'no_line' as const, message: 'No.' } };
    h.controller.restore({ batches: [], events: [], turn: 'agent', rejected });
    const type: Action = { type: `x${CURSOR_MARKER}` };
    expect(await report(h.controller.step([type]))).toMatchObject({ rejected, batches: [{ status: 'discarded' }] });
    expect((await report(h.controller.step([type]))).rejected?.error.kind).toBe('unanchored');
  });

  it('CancelKeepsBatch, CancelReleases: a step canceled while it waits its turn never queues its batch', async () => {
    const h = await started();
    const listen = h.controller.listen();
    const abort = new AbortController();
    const step = h.controller.step(SAY, abort.signal);
    const refused = expect(step).rejects.toMatchObject({ code: 'cancelled' });
    abort.abort();
    h.controller.userInterrupt();
    await report(listen);
    await refused;
    expect(rehearse).not.toHaveBeenCalled();
  });

  it('CancelKeepsBatch, CancelReleases: cancels a step whose abort arrives during its rehearsal', async () => {
    const h = await started();
    const abort = new AbortController();
    const { promise, resolve } = Promise.withResolvers<Awaited<ReturnType<typeof rehearse>>>();
    vi.mocked(rehearse).mockReturnValueOnce(promise);
    const step = h.controller.step(SAY, abort.signal);
    await settle();
    abort.abort();
    resolve({
      result: { id: 0, status: 'completed' },
      sightings: [],
      after: { scene: scene(), texts: new Map(), lines: asLines(fakes.fakeLines()), edits: new Set() },
    });
    await expect(step).rejects.toMatchObject({ code: 'cancelled' });
    expect(player().play).toHaveBeenCalled();
  });

  it("CancelKeepsBatch, BatchesDelivered: keeps a canceled step's batch queued and reports it later", async () => {
    const h = await started();
    const finish = holdPlay();
    await report(h.controller.step(SAY));
    const abort = new AbortController();
    const second = h.controller.step(SAY, abort.signal);
    await settle();
    abort.abort();
    await expect(second).rejects.toMatchObject({ code: 'cancelled' });
    finish();
    await settle();
    expect((await report(h.controller.listen())).batches.map((b) => b.id)).toEqual([1, 2]);
  });

  it('BlockedIsCurrent: a call waits its turn while another is blocked, and blocks only once that one has returned', async () => {
    const h = await started();
    const listen = h.controller.listen();
    const end = h.controller.end('Done.');
    await settle();
    expect(await pending(end)).toBe(true);
    h.controller.userInterrupt();
    await report(listen);
    expect(await report(end)).toMatchObject({ events: [] });
    expect(posted(h).at(-1)).toMatchObject({ type: 'session', active: false, reason: 'agent', summary: 'Done.' });
  });

  it('refuses every call without a session, and a read too', async () => {
    const { controller } = harness();
    await expect(controller.step(SAY)).rejects.toMatchObject({ code: 'no_session' });
    await expect(controller.listen()).rejects.toMatchObject({ code: 'no_session' });
    await expect(controller.end()).rejects.toMatchObject({ code: 'no_session' });
    await expect(controller.read('a.ts')).rejects.toMatchObject({ code: 'no_session' });
    expect(() => controller.resolveFile('a.ts')).toThrow('No pairing session is active.');
  });
});

describe('playing the queue', () => {
  it('plays each batch in order, takes the lines a completed one leaves, and records what it showed', async () => {
    const h = await started();
    const after = rehearsed();
    player().play.mockResolvedValueOnce({ result: { id: 1, status: 'completed' }, sightings: [{ file: A, text: 'x', lines: [1] }] });
    await report(h.controller.step(SAY));
    await settle();
    expect(sessionLines().adopt).toHaveBeenCalledWith(after);
    expect(sessionLines().of).toHaveBeenCalledWith(A, 'x');
    expect(timeline().reset).toHaveBeenCalled();
    expect(h.traced).toEqual(expect.arrayContaining(['batch 1 playing', 'batch 1 completed']));
  });

  it("PlaysAfterCompleted: discards the queued batches behind one that didn't complete, and takes none of its lines", async () => {
    const h = await started();
    const finish = holdPlay();
    await report(h.controller.step(SAY));
    const second = h.controller.step(SAY);
    await settle();
    finish({ status: 'interrupted' });
    expect((await report(second)).batches.map((b) => b.status)).toEqual(['interrupted', 'discarded']);
    expect(sessionLines().adopt).not.toHaveBeenCalled();
    expect(h.traced).toContain('interrupt: discarding [2]');
  });

  it('stops playing a session that closed while a batch played', async () => {
    const h = await started();
    const finish = holdPlay();
    await report(h.controller.step(SAY));
    void h.controller.step(SAY);
    await settle();
    h.controller.endSession();
    await report(h.controller.listen().catch(() => REPORT_SCHEMA.parse({ batches: [], events: [], turn: 'agent' })));
    finish();
    await settle();
    expect(player().play).toHaveBeenCalledOnce();
  });

  it('waits for an interrupted batch to finish before it reports, so the report says what was typed', async () => {
    const h = await started();
    const finish = holdPlay();
    await report(h.controller.step(SAY));
    const listen = h.controller.listen();
    h.controller.userInterrupt();
    expect(await pending(listen)).toBe(true);
    expect(h.traced).toContain('interrupt: discarding [], batch 1 plays on');
    finish({ status: 'interrupted' });
    expect((await report(listen)).batches).toEqual([{ id: 1, status: 'interrupted' }]);
  });
});

describe('listen', () => {
  it('EventsDelivered: returns once something interrupts, and not for a quiet edit by others', async () => {
    const h = await started();
    const listen = h.controller.listen();
    h.controller.otherEdit(B, 'b', 'c', []);
    expect(await pending(listen)).toBe(true);
    h.controller.userMessage('Look.');
    expect((await report(listen)).events).toEqual([
      { kind: 'edit', file: 'b.ts', diff: 'b.ts: b -> c', by: 'other' },
      { kind: 'message', text: 'Look.' },
    ]);
  });

  it('returns at once for a batch that did not complete, and waits while the queue plays', async () => {
    const h = await started();
    const finish = holdPlay();
    await report(h.controller.step(SAY));
    const listen = h.controller.listen();
    expect(await pending(listen)).toBe(true);
    finish({ status: 'failed', error: { kind: 'no_line', message: 'No.' } });
    expect((await report(listen)).batches[0]?.status).toBe('failed');
  });

  it('BlockedReturns: returns with `waiting` after MAX_BLOCK', async () => {
    const h = await started();
    const listen = h.controller.listen();
    await settle(CONFIG.maxBlockMs);
    expect(await report(listen)).toEqual({ batches: [], events: [], turn: 'agent', waiting: true });
    expect(h.traced.at(-1)).toMatch(/^report to listen: batches \[\], events \[\], waiting, \d+ chars$/);
  });

  it("NotWhileTyping, EditsReported, QuietDelivered: waits in the programmer's turn until they pause typing, or hand the turn back", async () => {
    const h = await started();
    h.controller.takeTurn();
    await report(h.controller.listen());
    const listen = h.controller.listen();
    h.controller.userEdit(A, 'a', 'ab', [{ offset: 1, deleteLength: 0, text: 'b' }]);
    await settle(CONFIG.navigatorIdleMs - 1);
    h.controller.userEdit(A, 'ab', 'abc', [{ offset: 2, deleteLength: 0, text: 'c' }]);
    await settle(CONFIG.navigatorIdleMs - 1);
    expect(await pending(listen)).toBe(true);
    await settle(1);
    expect((await report(listen)).events).toEqual([{ kind: 'edit', file: 'a.ts', diff: 'a.ts: a -> abc', by: 'programmer' }]);
    const next = h.controller.listen();
    h.controller.userEdit(A, 'abc', 'abcd', []);
    h.controller.handBack('Your turn.', selection());
    expect((await report(next)).events).toEqual([
      { kind: 'edit', file: 'a.ts', diff: 'a.ts: abc -> abcd', by: 'programmer' },
      { kind: 'turn', to: 'agent', message: 'Your turn.', selection: { ...selection(), file: 'a.ts' } },
    ]);
  });

  it("returns in the programmer's turn for something other than an edit", async () => {
    const h = await started();
    h.controller.takeTurn();
    await report(h.controller.listen());
    const listen = h.controller.listen();
    h.controller.userInterrupt();
    expect((await report(listen)).events).toEqual([{ kind: 'interrupt' }]);
  });
});

describe('cancelled calls', () => {
  it('CancelReleases, ChainProgresses, EventsDelivered: releases a blocked call without consuming the report', async () => {
    const h = await started();
    const abort = new AbortController();
    const listen = h.controller.listen(abort.signal);
    await settle();
    abort.abort();
    await expect(listen).rejects.toMatchObject({ code: 'cancelled' });
    h.controller.userMessage('Kept.');
    expect((await report(h.controller.listen())).events).toEqual([{ kind: 'message', text: 'Kept.' }]);
    abort.abort();
  });

  it('cancels a call aborted before it blocks, and a call already aborted when it is made', async () => {
    const h = await started();
    const abort = new AbortController();
    abort.abort();
    await expect(h.controller.listen(abort.signal)).rejects.toMatchObject({ code: 'cancelled', message: 'The call was cancelled.' });
    await expect(h.controller.step([], abort.signal)).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('lets an aborted listener go once its call is no longer the open one', async () => {
    const h = await started();
    const abort = new AbortController();
    const listen = h.controller.listen(abort.signal);
    h.controller.userInterrupt();
    await report(listen);
    const next = h.controller.listen();
    abort.abort();
    expect(await pending(next)).toBe(true);
    h.controller.userInterrupt();
    await report(next);
  });

  it('carries on past a call that failed', async () => {
    const h = await started();
    await expect(h.controller.start()).rejects.toMatchObject({ code: 'session_active' });
    h.controller.userInterrupt();
    expect((await report(h.controller.listen())).events).toEqual([{ kind: 'interrupt' }]);
  });
});

describe('read', () => {
  it("reads a file's lines between two, saying whether it ends, and knows them from then", async () => {
    const h = await started({}, { 'a.ts': 'one\ntwo\nthree\n' });
    h.editor.isDirty.mockResolvedValueOnce(true);
    expect(await h.controller.read('a.ts', 2)).toEqual({
      file: 'a.ts',
      dirty: true,
      lines: [
        { number: 2, text: 'two' },
        { number: 3, text: 'three' },
      ],
      end: { final_newline: true },
    });
    expect(await h.controller.read('a.ts', 0, 1)).toEqual({ file: 'a.ts', dirty: false, lines: [{ number: 1, text: 'one' }] });
    expect(await h.controller.read('a.ts', 5, 9)).toEqual({ file: 'a.ts', dirty: false, lines: [], end: { final_newline: true } });
  });

  it("Read: reads a file as the queued batches leave it, with their lines, and the editor's once they are stale", async () => {
    const h = await started({}, { 'a.ts': 'now\n' });
    holdPlay();
    const queuedLines = rehearsed({}, { 'a.ts': 'planned\n' });
    await report(h.controller.step(SAY));
    expect((await h.controller.read('a.ts')).lines).toEqual([{ number: 1, text: 'planned' }]);
    expect(queuedLines.of).toHaveBeenCalledWith(A, 'planned\n');
    expect(await h.controller.read('b.ts').catch((error: unknown) => error)).toMatchObject({ code: 'invalid_arguments' });
    h.controller.userInterrupt();
    expect((await h.controller.read('a.ts')).lines).toEqual([{ number: 1, text: 'now' }]);
  });

  it("refuses a file that doesn't exist, which a move creates, and passes on any other failure", async () => {
    const h = await started();
    await expect(h.controller.read('missing.ts')).rejects.toMatchObject({
      code: 'invalid_arguments',
      message: "missing.ts doesn't exist. A `move` to it creates it, empty.",
    });
    h.editor.getText.mockRejectedValueOnce(new Error('disk unreadable'));
    await expect(h.controller.read('a.ts')).rejects.toThrow('disk unreadable');
    expect(h.controller.resolveFile('a.ts')).toBe(A);
  });
});

describe('restore', () => {
  it('HeldMeansStale, BatchesDelivered: reports a returned rejection again, discarding steps until it has', async () => {
    const h = await started();
    const rejected = { index: 1, action: { say: 'x' }, error: { kind: 'no_line' as const, message: 'No.' } };
    h.controller.restore({ batches: [], events: [], turn: 'agent', rejected });
    const discarded = await report(h.controller.step(SAY));
    expect(discarded).toMatchObject({ rejected, batches: [{ status: 'discarded' }] });
    expect(rehearse).not.toHaveBeenCalled();
  });

  it('NoUnmarkedRepeat: says a returned report may repeat one already seen, and marks each returned rejection the agent may have seen', async () => {
    const h = await started();
    const rejected = { index: 1, action: { say: 'x' }, error: { kind: 'no_line' as const, message: 'No.' } };
    h.controller.restore({ batches: [{ id: 1, status: 'completed' }], events: [], turn: 'agent' }, /* mayRepeat= */ true);
    h.controller.restore({ batches: [], events: [], turn: 'agent', rejected }, /* mayRepeat= */ true);
    h.controller.restore({ batches: [], events: [], turn: 'agent', rejected });
    const first = await report(h.controller.listen());
    expect(first).toMatchObject({ batches: [{ id: 1 }], repeated: true, rejected });
    const second = await report(h.controller.listen());
    expect(second.repeated).toBeUndefined();
    expect(second.rejected).toEqual(rejected);
  });

  it("marks the session stale for a returned report's interrupting events or unfinished batches, not for others' quiet edits", async () => {
    const h = await started();
    h.controller.restore({ batches: [], events: [{ kind: 'edit', file: 'b.ts', diff: 'x', by: 'other' }], turn: 'agent' });
    expect((await report(h.controller.listen())).events).toEqual([{ kind: 'edit', file: 'b.ts', diff: 'x', by: 'other' }]);
    holdPlay();
    expect((await report(h.controller.step(SAY))).submitted).toEqual({ id: 1, status: 'playing' });
    h.controller.restore({ batches: [{ id: 9, status: 'interrupted' }], events: [], turn: 'agent' });
    expect((await report(h.controller.step(SAY))).batches.map((b) => [b.id, b.status])).toEqual([
      [2, 'discarded'],
      [9, 'interrupted'],
    ]);
  });

  it('EndDelivered, EventsDelivered: reports a returned report again after the programmer ended the session with it (#60)', async () => {
    const h = await started();
    h.controller.userMessage('Last words.');
    h.controller.endSession();
    const last = await report(h.controller.listen());
    expect(last.events).toEqual([{ kind: 'message', text: 'Last words.' }, { kind: 'end' }]);
    h.controller.restore(last);
    expect(h.controller.isActive).toBe(false);
    expect((await report(h.controller.listen())).events).toEqual(last.events);
    await expect(h.controller.listen()).rejects.toMatchObject({ code: 'no_session' });
  });

  it('BatchesDelivered: keeps an ended session until its returned rejections are reported, one per call', async () => {
    const h = await started();
    h.controller.restore({ batches: [], events: [], turn: 'agent', rejected: heldRejection(1) });
    h.controller.restore({ batches: [], events: [], turn: 'agent', rejected: heldRejection(2) });
    h.controller.endSession();
    expect((await report(h.controller.listen())).rejected?.index).toBe(1);
    expect((await report(h.controller.listen())).rejected?.index).toBe(2);
    await expect(h.controller.listen()).rejects.toMatchObject({ code: 'no_session' });
  });

  it('takes no report back with no session, open or just closed', () => {
    const { controller } = harness();
    controller.restore({ batches: [], events: [], turn: 'agent' });
    expect(controller.isActive).toBe(false);
  });

  it('revives a session saved by 0.6.10 or earlier, which holds null for a selection never set', () => {
    const h = harness();
    // A JSON null, as such a session holds.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const none = JSON.parse('null') as undefined;
    h.controller.revive({
      scene: { turn: 'agent', cursor: { file: A, offset: 0 }, selection: none, allowedCommands: [] },
      finished: [],
      events: [],
    });
    expect(scene()).toMatchObject({ cursor: { file: A, offset: 0 }, selection: undefined });
  });
});

describe("the programmer's input", () => {
  it('records a message, with the code they had selected, and shows it in the panel', async () => {
    const h = await started();
    h.controller.userMessage('This.', selection());
    expect(posted(h).at(-1)).toEqual({ type: 'programmer', text: 'This.', ref: { file: 'a.ts', line: 1, endLine: 2 } });
    expect((await report(h.controller.listen())).events).toEqual([
      { kind: 'message', text: 'This.', selection: { ...selection(), file: 'a.ts' } },
    ]);
  });

  it('records an interrupt, stopping playback', async () => {
    const h = await started();
    h.controller.userInterrupt();
    expect(posted(h).at(-1)).toEqual({ type: 'interrupt' });
    expect(timeline().interrupt).toHaveBeenCalled();
  });

  it('ignores input with no session, or with an ended one', () => {
    const h = harness();
    h.controller.userMessage('Hello?');
    h.controller.userInterrupt();
    h.controller.userEdit(A, 'a', 'b', []);
    h.controller.otherEdit(A, 'a', 'b', []);
    h.controller.takeTurn();
    h.controller.handBack();
    h.controller.endSession();
    expect(posted(h)).toEqual([]);
    expect(h.controller.turn).toBeUndefined();
  });

  it('NetReported, EditInterrupts: reports programmer edits as one diff a file, the agent cursor moving with them', async () => {
    const h = await started();
    const changes = [
      { offset: 0, deleteLength: 0, text: 'x' },
      { offset: 1, deleteLength: 0, text: 'y' },
    ];
    h.controller.otherEdit(A, 'a', 'xa', [changes[0] ?? { offset: 0, deleteLength: 0, text: '' }]);
    h.controller.userEdit(A, 'xa', 'xya', [changes[1] ?? { offset: 0, deleteLength: 0, text: '' }]);
    h.controller.otherEdit(A, 'xya', 'xyab', []);
    expect(player().transform.mock.calls).toEqual([
      [A, changes[0]],
      [A, changes[1]],
    ]);
    expect(sessionLines().apply).toHaveBeenCalledTimes(2);
    expect((await report(h.controller.listen())).events).toEqual([
      { kind: 'edit', file: 'a.ts', diff: 'a.ts: a -> xyab', by: 'programmer' },
    ]);
    expect(h.traced).toContain(`edit ${A} by other`);
  });

  it('Explained: reports an interrupting edit the programmer undid, and drops a quiet edit by others that was undone', async () => {
    const h = await started();
    h.controller.otherEdit(B, 'b', 'c', []);
    h.controller.otherEdit(B, 'c', 'b', []);
    h.controller.userEdit(A, 'a', 'b', []);
    h.controller.userEdit(A, 'b', 'a', []);
    expect((await report(h.controller.listen())).events).toEqual([{ kind: 'edit', file: 'a.ts', diff: '', by: 'programmer' }]);
  });

  it('reports an edit whose diff a restored report already carries, as it was', async () => {
    const h = await started();
    h.controller.restore({
      batches: [],
      events: [{ kind: 'edit', file: 'a.ts', diff: '@@', omitted: 900, by: 'programmer' }],
      turn: 'agent',
    });
    h.controller.restore({ batches: [], events: [{ kind: 'edit', file: 'b.ts', diff: '@@', by: 'other' }], turn: 'agent' });
    expect((await report(h.controller.listen())).events).toEqual([
      { kind: 'edit', file: 'b.ts', diff: '@@', by: 'other' },
      { kind: 'edit', file: 'a.ts', diff: '@@', omitted: 900, by: 'programmer' },
    ]);
  });

  it("ReadIsStart: an edit by others to a file a queued batch edits interrupts it, and to another file the queue's rehearsals follow it", async () => {
    const h = await started();
    holdPlay();
    rehearsed({}, {}, ['a.ts']);
    await report(h.controller.step(SAY));
    const changes = [{ offset: 0, deleteLength: 0, text: 'x' }];
    h.controller.otherEdit(B, 'b', 'xb', changes);
    expect(lineChanges).toHaveBeenCalledWith('b', changes);
    expect(followChange).toHaveBeenCalledWith(expect.objectContaining({ edits: new Set([A]) }), B, 'xb', changes);
    expect(timeline().interrupt).not.toHaveBeenCalled();
    h.controller.otherEdit(A, 'a', 'xa', changes);
    expect(timeline().interrupt).toHaveBeenCalled();
    h.controller.otherEdit(A, 'xa', 'xya', []);
    expect(vi.mocked(followChange).mock.calls).toHaveLength(1);
  });

  it('OnlyTalkInTheirTurn: takes the turn, interrupting playback, and hands it back with no message or selection', async () => {
    const h = await started();
    scene().focus = 'point';
    h.controller.takeTurn();
    expect(h.controller.turn).toBe('programmer');
    expect(scene().focus).toBe('cursor');
    expect(timeline().interrupt).toHaveBeenCalled();
    h.controller.takeTurn();
    h.controller.handBack();
    h.controller.handBack();
    expect(posted(h).filter((event) => event.type === 'turn')).toEqual([
      { type: 'turn', to: 'programmer' },
      { type: 'turn', to: 'agent', message: undefined, ref: undefined },
    ]);
    expect((await report(h.controller.listen())).events).toEqual([
      { kind: 'turn', to: 'programmer' },
      { kind: 'turn', to: 'agent' },
    ]);
  });

  it('EndDelivered: ends when the programmer ends it, delivering a final report', async () => {
    const h = await started();
    h.controller.endSession();
    expect(h.controller.isActive).toBe(false);
    expect(posted(h).at(-1)).toEqual({ type: 'session', active: false, reason: 'programmer' });
    expect((await report(h.controller.listen())).events).toEqual([{ kind: 'end' }]);
    expect(h.traced).toContain('session closed');
    expect(h.editor.renderPoint.mock.calls).toContainEqual([undefined]);
  });

  it("ends with the agent's end once its batches have played, and closes the session", async () => {
    const h = await started();
    const finish = holdPlay();
    await report(h.controller.step(SAY));
    const end = h.controller.end();
    expect(await pending(end)).toBe(true);
    finish();
    expect((await report(end)).batches).toEqual([{ id: 1, status: 'completed' }]);
    expect(h.controller.isActive).toBe(false);
    await expect(h.controller.listen()).rejects.toMatchObject({ code: 'no_session' });
  });
});

describe('the cursor in a report', () => {
  it("adds the cursor's line to a report when it moved since the agent last saw it, and knows its line from then", async () => {
    const h = await started();
    const cursorLine = { number: 2, text: `x${CURSOR_MARKER}` };
    const shown = { code: { file: 'a.ts', lines: [cursorLine] }, sighting: { file: A, text: 'a\nx', lines: [2] }, cursorLine };
    scene().cursor = { file: A, offset: 3 };
    player().codeAt.mockResolvedValue(shown);
    h.controller.userInterrupt();
    expect((await report(h.controller.listen())).cursor).toEqual(shown.code);
    expect(player().codeAt).toHaveBeenCalledWith({ file: A, offset: 3 });
    expect(sessionLines().of).toHaveBeenCalledWith(A, 'a\nx');
    h.controller.userInterrupt();
    expect((await report(h.controller.listen())).cursor).toBeUndefined();
  });

  it("leaves it out when a batch's code showed it, and when the code can't be read", async () => {
    const h = await started();
    scene().cursor = { file: A, offset: 1 };
    const cursorLine = { number: 1, text: `x${CURSOR_MARKER}` };
    const code = { file: 'a.ts', lines: [cursorLine] };
    player().codeAt.mockResolvedValue({ code, sighting: { file: A, text: 'x', lines: [1] }, cursorLine });
    player().play.mockResolvedValueOnce({ result: { id: 1, status: 'completed', code }, sightings: [] });
    await report(h.controller.step(SAY));
    await settle();
    expect((await report(h.controller.listen())).cursor).toBeUndefined();
    player().codeAt.mockRejectedValueOnce(new Error('gone'));
    h.controller.userInterrupt();
    expect((await report(h.controller.listen())).events).toEqual([{ kind: 'interrupt' }]);
  });
});

describe('pause and resume', () => {
  it('PausedMatchesReasons, NoTimerWhilePaused, ResumeContinues: holds playback until the last pause reason is gone', async () => {
    const h = await started();
    h.controller.pause('programmer');
    h.controller.pause('reply');
    h.controller.pause('reply');
    expect(timeline().pause).toHaveBeenCalledTimes(3);
    expect(h.traced.filter((line) => line.startsWith('pause'))).toEqual(['pause programmer', 'pause reply']);
    h.controller.resume('reply');
    expect(timeline().resume).not.toHaveBeenCalled();
    expect(h.controller.isPaused).toBe(true);
    h.controller.resume('calibrate');
    h.controller.resume('programmer');
    expect(timeline().resume).toHaveBeenCalledOnce();
    expect(h.traced).toEqual(expect.arrayContaining(['resume reply', 'resume programmer']));
    expect(h.traced).not.toContain('resume calibrate');
    h.controller.resume();
    expect(timeline().resume).toHaveBeenCalledOnce();
  });

  it('says the batches are paused, and why, in a report', async () => {
    const h = await started();
    h.controller.pause('reply');
    h.controller.userInterrupt();
    expect((await report(h.controller.listen())).paused).toEqual(['reply']);
    expect(h.traced.at(-1)).toMatch(/^report to listen: batches \[\], events \[interrupt\], paused \(reply\), \d+ chars$/);
  });

  it('NoStaleReveal, ReplyKeepsView: a resume after a look-away reveals the cursor, not the point, and a reply reveals nothing', async () => {
    const h = await started();
    scene().point = { file: A, start: 0, end: 1 };
    scene().focus = 'point';
    h.controller.pause('away');
    h.controller.resume();
    expect(scene().focus).toBe('cursor');
    expect(h.editor.reveal.mock.calls).toHaveLength(1);
    h.controller.pause('reply');
    h.controller.resume('reply', { reveal: false });
    expect(h.editor.reveal.mock.calls).toHaveLength(1);
    scene().point = undefined;
    h.controller.pause();
    h.controller.resume();
    expect(h.editor.reveal.mock.calls).toHaveLength(1);
    scene().cursor = { file: A, offset: 0 };
    scene().turn = 'programmer';
    h.controller.pause();
    h.controller.resume();
    expect(h.editor.reveal.mock.calls).toHaveLength(1);
    scene().turn = 'agent';
    scene().focus = 'cursor';
    h.controller.pause('away');
    h.controller.resume();
    expect(h.editor.reveal.mock.calls).toHaveLength(2);
  });

  it('pauses and resumes with no session', () => {
    const h = harness();
    h.controller.pause();
    h.controller.resume();
    expect(h.controller.isPaused).toBe(false);
  });
});

describe('commands to confirm', () => {
  it('decides a run: yes once, yes for the session, no, an answer to another run, and nothing with no session', async () => {
    const h = await started();
    const once = stage().confirm(1, 'ls');
    h.controller.decideRun(2, true);
    expect(await pending(once)).toBe(true);
    h.controller.decideRun(1, true);
    expect(await once).toBe(true);
    expect(scene().allowedCommands.size).toBe(0);
    const remembered = stage().confirm(2, 'npm test');
    h.controller.decideRun(2, true, /* remember= */ true);
    expect(await remembered).toBe(true);
    expect(scene().allowedCommands).toEqual(new Set(['npm test']));
    const declined = stage().confirm(3, 'rm -rf .');
    h.controller.decideRun(3, false, /* remember= */ true);
    expect(await declined).toBe(false);
    expect(scene().allowedCommands.has('rm -rf .')).toBe(false);
    harness().controller.decideRun(1, true);
  });

  it('answers no for an interrupt while it waits, and at once when one came before it asked', async () => {
    const h = await started();
    const waiting = stage().confirm(1, 'ls');
    h.controller.userInterrupt();
    expect(await waiting).toBe(false);
    expect(await stage().confirm(2, 'ls')).toBe(false);
  });
});

describe('settings', () => {
  it('takes the speeds, the timing, and whether commands are confirmed, for the stage', async () => {
    const h = await started();
    h.controller.setSpeed(2);
    h.controller.setReadingSpeed(3);
    h.controller.setConfirmCommands(false);
    h.controller.setTiming({ glideMs: 1 });
    h.controller.setTimeouts({ maxBlockMs: 4, absentMs: 5 });
    expect([stage().speed(), stage().readingSpeed(), stage().config().confirmCommands]).toEqual([2, 3, false]);
    expect([stage().config().maxBlockMs, stage().config().absentMs, stage().config().listenGraceMs]).toEqual([4, 5, CONFIG.listenGraceMs]);
    expect(withOverrides).toHaveBeenCalledWith(defaultConfig.timing, { glideMs: 1 });
    expect(h.controller.glideMs(10)).toBe(42);
    expect(glideDuration).toHaveBeenCalledWith(defaultConfig.timing, 10, 2);
  });

  it('hands a passage to the calibration, refusing it while one is under way', async () => {
    const h = await started();
    const passage = { title: 'Words', text: 'Some words.' };
    const busy = vi.fn(() => false);
    expect(() => h.controller.calibrate(passage, busy)).toThrow('A calibration is already under way in the Pair panel.');
    expect(busy).toHaveBeenCalledWith(passage);
    expect(REPORT_SCHEMA.parse(h.controller.calibrate(passage, () => true))).toEqual({ batches: [], events: [], turn: 'agent' });
    expect(() => harness().controller.calibrate(passage, () => true)).toThrow('No pairing session is active.');
  });
});

describe('the status in the panel', () => {
  it("shows typing, reading, running, and paused while batches play, and navigator in the programmer's turn", async () => {
    const h = await started();
    const finish = holdPlay();
    await report(h.controller.step(SAY));
    stage().render();
    player().reading = true;
    stage().render();
    player().reading = false;
    player().commandRunning = true;
    stage().render();
    h.controller.pause();
    h.controller.resume();
    player().commandRunning = false;
    finish();
    await settle();
    h.controller.takeTurn();
    expect(statuses(h)).toEqual(['thinking', 'typing', 'read', 'running', 'paused', 'running', 'thinking', 'navigator']);
    expect(h.traced).toContain("status navigator, programmer's turn");
  });

  it('shows the cursor and its selection in the editor, and no cursor once the session closed', async () => {
    const h = await started();
    scene().cursor = { file: A, offset: 2 };
    stage().render();
    scene().selection = { start: 1, end: 2 };
    stage().render();
    expect(h.editor.renderCursor.mock.calls.slice(-2).map(([cursor]) => cursor)).toEqual([
      { file: A, offset: 2 },
      { file: A, offset: 2, selection: { start: 1, end: 2 } },
    ]);
    h.controller.endSession();
    await report(h.controller.listen());
    expect(h.editor.renderCursor.mock.calls.at(-1)?.[0]).toBeUndefined();
  });

  it('NoFlicker, GraceEnds: keeps listening after a listen times out with nothing to report, until the grace runs out', async () => {
    const h = await started();
    void h.controller.listen();
    await settle(CONFIG.maxBlockMs);
    expect(statuses(h).at(-1)).toBe('listening');
    await settle(CONFIG.listenGraceMs);
    expect(statuses(h).at(-1)).toBe('thinking');
  });

  it('NoFalseYourMove, NewsSkipsGraceProp: shows thinking when a listen times out with a batch to report', async () => {
    const h = await started();
    await report(h.controller.step(SAY));
    await settle();
    const listen = h.controller.listen();
    await settle(CONFIG.maxBlockMs);
    await report(listen);
    expect(statuses(h).at(-1)).toBe('thinking');
  });

  it('NoFalseYourMove: ends the grace when the agent reads, and when its step is refused at once (#194)', async () => {
    const h = await started();
    void h.controller.listen();
    await settle(CONFIG.maxBlockMs);
    expect(statuses(h).at(-1)).toBe('listening');
    await h.controller.read('a.ts').catch(() => undefined);
    expect(statuses(h).at(-1)).toBe('thinking');
    h.controller.userInterrupt();
    await report(h.controller.step(SAY));
    void h.controller.listen();
    await settle(CONFIG.maxBlockMs);
    expect(statuses(h).at(-1)).toBe('listening');
    expect((await report(h.controller.step([{ type: `x${CURSOR_MARKER}` }]))).rejected?.error.kind).toBe('unanchored');
    expect(statuses(h).at(-1)).toBe('thinking');
  });

  it('NoYourMoveAfterInterrupt, NoYourMoveInOtherCall: shows thinking when the programmer acts, or the agent calls, during the grace', async () => {
    const h = await started();
    void h.controller.listen();
    await settle(CONFIG.maxBlockMs);
    h.controller.userMessage('Wait.');
    expect(statuses(h).at(-1)).toBe('thinking');
    await report(h.controller.listen());
    void h.controller.listen();
    await settle(CONFIG.maxBlockMs);
    await report(h.controller.step([]));
    expect(statuses(h).at(-1)).toBe('thinking');
  });

  it('AbsentShows, AbsentWithoutCall: says the agent is not listening once no call has been open for absentMs, until it calls', async () => {
    const h = await started();
    await settle(CONFIG.absentMs);
    expect(statuses(h).at(-1)).toBe('absent');
    void h.controller.listen();
    await settle();
    expect(statuses(h).at(-1)).toBe('listening');
    h.controller.userInterrupt();
    await settle();
    await h.controller.read('a.ts').catch(() => undefined);
    void h.controller.listen();
    await settle();
    await h.controller.read('a.ts').catch(() => undefined);
    h.controller.endSession();
    await settle(CONFIG.absentMs);
    expect(statuses(h).at(-1)).toBe('listening');
  });

  it('tells the panel and the window about each change, posting a status only when it changes', async () => {
    const h = await started();
    const changed = vi.fn<() => void>();
    h.controller.onChange = changed;
    stage().render();
    stage().render();
    expect(changed).toHaveBeenCalledTimes(2);
    expect(statuses(h)).toEqual(['thinking']);
  });
});

describe('reports', () => {
  it('sorts the batches by id, says which batch the step submitted, and anchors after one that stopped short', async () => {
    const h = await started();
    h.controller.restore({ batches: [{ id: 5, status: 'completed' }], events: [], turn: 'agent' });
    h.controller.restore({ batches: [{ id: 2, status: 'discarded' }], events: [], turn: 'agent' });
    const listened = await report(h.controller.listen());
    expect(listened.batches.map((b) => b.id)).toEqual([2, 5]);
    expect((await report(h.controller.step([{ type: `x${CURSOR_MARKER}` }]))).rejected?.error.kind).toBe('unanchored');
  });

  it('passes each edit to boundedDiff by the name the agent knows', async () => {
    const h = harness();
    await h.controller.start(undefined, '/work');
    h.controller.userEdit('/work/src/a.ts', 'a', 'b', []);
    await report(h.controller.listen());
    expect(boundedDiff).toHaveBeenCalledWith('src/a.ts', 'a', 'b');
  });
});
