// The rehearsal plays a batch in memory, in a copy of the editor (specs/Rehearsal.tla, `Submit`), and follows a
// change by others to a file no queued batch edits (`ShareIds`). Solitary: the Player is a mock that records the
// scene and stage it is given, so the test reaches the in-memory editor through that stage; transformScene, the
// paceless timeline, and MissingFile are mocks too; the editor and the lines are typed mocks passed in.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';
import { BATCH_RESULT_SCHEMA, type Action } from '@ai-pair/protocol';
import { defaultConfig } from '../src/config';
import type { LineIds, Sighting } from '../src/lines';
import { Player, transformScene, type Scene, type Stage } from '../src/player';
import type { EditorPort } from '../src/ports';
import { followChange, rehearse, type Rehearsal } from '../src/rehearsal';

/** What the mocked modules share with the tests, made before the `vi.mock` factories run. */
const fakes = vi.hoisted(() => {
  /** ports.ts's error for a file that doesn't exist, faked. */
  class FakeMissingFile extends Error {
    constructor(readonly file: string) {
      super(`${file} doesn't exist`);
    }
  }
  return {
    FakeMissingFile,
    /** timeline.ts's `instant`, faked: the rehearsal only passes it on. */
    instant: { sleep: vi.fn(), isInterrupted: false, signal: new AbortController().signal },
    /** Each Player the rehearsal made: its scene and its stage. */
    made: [] as Array<{ scene: unknown; stage: unknown }>,
    /** What each Player's play() answers with. */
    play: vi.fn(),
  };
});

/** A file the real editor has. */
const A = '/project/a.ts';

/** A file only the rehearsal has. */
const B = '/project/b.ts';

/** The batch the rehearsal plays. */
const ACTIONS: Action[] = [{ say: 'Hi.' }];

/** The batch's result, built by its schema, as the Player answers. */
const RESULT = BATCH_RESULT_SCHEMA.parse({ id: 0, status: 'completed' });

/** What the Player saw. */
const SIGHTINGS: Sighting[] = [{ file: A, text: 'a\n', lines: [1, 2] }];

vi.mock('../src/player', () => ({
  // A class, so the rehearsal can construct it with `new`.
  Player: vi.fn(
    class {
      readonly play = fakes.play;
      constructor(scene: unknown, stage: unknown) {
        fakes.made.push({ scene, stage });
      }
    },
  ),
  transformScene: vi.fn(),
}));
vi.mock('../src/ports', () => ({ MissingFile: fakes.FakeMissingFile }));
vi.mock('../src/timeline', () => ({ instant: fakes.instant }));

/** Returns a rehearsal's start, with `scene` over an empty one, A's text in memory, and its lines' fork. */
function start(scene: Partial<Scene> = {}): { from: Rehearsal; lines: ReturnType<typeof mock<LineIds>>; forked: LineIds } {
  const forked = mock<LineIds>();
  const lines = mock<LineIds>();
  lines.fork.mockReturnValue(forked);
  return {
    from: {
      scene: { turn: 'agent', focus: 'cursor', pointFar: false, allowedCommands: new Set(), ...scene },
      texts: new Map([[A, 'a\n']]),
      lines,
      edits: new Set(),
    },
    lines,
    forked,
  };
}

/** Rehearses ACTIONS from `from` on `editor`, and returns the result with the Player's scene and stage. */
async function rehearsed(
  editor: EditorPort,
  from: Rehearsal,
): Promise<{ played: Awaited<ReturnType<typeof rehearse>>; scene: Scene; stage: Stage }> {
  fakes.play.mockResolvedValue({ result: RESULT, sightings: SIGHTINGS });
  const knows = vi.fn(() => true);
  const played = await rehearse(editor, defaultConfig, from, ACTIONS, knows);
  const built = fakes.made.at(-1);
  // The mocked Player is handed the rehearsal's scene and stage, of these types.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return { played, scene: built?.scene as Scene, stage: built?.stage as Stage };
}

afterEach(() => {
  fakes.made.length = 0;
  vi.clearAllMocks();
});

describe('rehearse', () => {
  it('Submit: plays the batch on a copy of the scene, in memory, instantly and silently, and returns what it leaves', async () => {
    const editor = mock<EditorPort>();
    const { from, forked } = start({
      cursor: { file: A, offset: 1 },
      selection: { start: 0, end: 1 },
      point: { file: A, start: 0, end: 1 },
    });
    const { played, scene, stage } = await rehearsed(editor, from);
    expect(Player).toHaveBeenCalledOnce();
    expect(scene).toEqual(from.scene);
    expect(scene).not.toBe(from.scene);
    expect(scene.cursor).not.toBe(from.scene.cursor);
    expect(scene.selection).not.toBe(from.scene.selection);
    expect(scene.point).not.toBe(from.scene.point);
    expect(stage.pacing).toBe(fakes.instant);
    expect(stage.config()).toBe(defaultConfig);
    expect([stage.speed(), stage.readingSpeed()]).toEqual([1, 1]);
    // A silent panel and nothing to render: each runs, and does nothing.
    stage.panel.post({ type: 'say', text: 'Hi.' });
    stage.render();
    expect(await stage.confirm(1, 'true')).toBe(true);
    expect(stage.lines).toBe(forked);
    expect(stage.knows?.(A, 1, 1)).toBe(true);
    expect(fakes.play).toHaveBeenCalledWith(/* id= */ 0, ACTIONS);
    expect(played.result).toBe(RESULT);
    expect(played.sightings).toBe(SIGHTINGS);
    expect(played.after).toEqual({ scene, texts: new Map([[A, 'a\n']]), lines: forked, edits: new Set() });
    expect(played.after.texts).not.toBe(from.texts);
  });

  it('copies a scene with no cursor, selection, or point as one', async () => {
    const { scene } = await rehearsed(mock<EditorPort>(), start().from);
    expect([scene.cursor, scene.selection, scene.point]).toEqual([undefined, undefined, undefined]);
  });
});

describe('the editor in memory', () => {
  it("names files as the real editor does, and reads a file from memory, or else the real editor's", async () => {
    const editor = mock<EditorPort>();
    editor.resolvePath.mockReturnValue(A);
    editor.displayPath.mockReturnValue('a.ts');
    editor.getText.mockResolvedValue('real\n');
    const { stage } = await rehearsed(editor, start().from);
    expect(stage.editor.resolvePath('a.ts')).toBe(A);
    expect(stage.editor.displayPath(A)).toBe('a.ts');
    expect(await stage.editor.getText(A)).toBe('a\n');
    expect(await stage.editor.getText(B)).toBe('real\n');
  });

  it("takes the real editor's line ending, and a newline for a file only made in memory", async () => {
    const editor = mock<EditorPort>();
    editor.eol.mockResolvedValueOnce('\r\n').mockRejectedValueOnce(new fakes.FakeMissingFile(B));
    const { stage } = await rehearsed(editor, start().from);
    expect(await stage.editor.eol(A)).toBe('\r\n');
    expect(await stage.editor.eol(B)).toBe('\n');
  });

  it('shows a file in memory, or one the real editor has, as is; creates a missing one empty; and fails on a read error', async () => {
    const editor = mock<EditorPort>();
    editor.getText
      .mockResolvedValueOnce('real\n')
      .mockRejectedValueOnce(new fakes.FakeMissingFile(B))
      .mockRejectedValueOnce(new Error('disk unreadable'));
    const { stage, played } = await rehearsed(editor, start().from);
    await stage.editor.show(A);
    expect(editor.getText.mock.calls).toEqual([]);
    await stage.editor.show('/project/c.ts');
    expect(played.after.texts.has('/project/c.ts')).toBe(false);
    await stage.editor.show(B);
    expect(played.after.texts.get(B)).toBe('');
    await expect(stage.editor.show('/project/d.ts')).rejects.toThrow('disk unreadable');
  });

  it('edits only its copy, and records the files it edited', async () => {
    const editor = mock<EditorPort>();
    editor.getText.mockResolvedValue('real\n');
    const { stage, played } = await rehearsed(editor, start().from);
    await stage.editor.edit(A, /* offset= */ 1, /* deleteLength= */ 0, 'b', { undoStopBefore: false, undoStopAfter: false });
    await stage.editor.edit(B, /* offset= */ 0, /* deleteLength= */ 4, 'fake', { undoStopBefore: false, undoStopAfter: false });
    expect(played.after.texts).toEqual(
      new Map([
        [A, 'ab\n'],
        [B, 'fake\n'],
      ]),
    );
    expect(played.after.edits).toEqual(new Set([A, B]));
    expect(editor.edit.mock.calls).toEqual([]);
  });

  it('saves, points, and follows nowhere, and runs no command, which succeeds', async () => {
    const editor = mock<EditorPort>();
    const { stage } = await rehearsed(editor, start().from);
    await stage.editor.save(A);
    stage.editor.renderPoint();
    stage.editor.follow();
    expect(await stage.editor.runCommand('npm test', { cwd: '/project', waitMs: 0, signal: new AbortController().signal })).toEqual({
      exitCode: 0,
      output: '',
    });
    expect([editor.save.mock.calls, editor.renderPoint.mock.calls, editor.follow.mock.calls, editor.runCommand.mock.calls]).toEqual([
      [],
      [],
      [],
      [],
    ]);
  });
});

describe('followChange', () => {
  it("ShareIds: moves the scene through each change, takes the editor's lines for the file, and its text when rehearsed", () => {
    const { from, lines } = start();
    const changes = [
      { offset: 0, deleteLength: 0, text: 'x' },
      { offset: 1, deleteLength: 1, text: '' },
    ];
    followChange(from, A, 'x\n', changes);
    followChange(from, B, 'b\n', []);
    expect(vi.mocked(transformScene).mock.calls).toEqual(changes.map((change) => [from.scene, A, change]));
    expect(lines.forget.mock.calls).toEqual([[A], [B]]);
    expect(from.texts).toEqual(new Map([[A, 'x\n']]));
  });
});
