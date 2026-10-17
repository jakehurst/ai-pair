// The player's paths that a healthy editor and a well-formed batch never take: actions it refuses, an editor that
// fails, and an interrupt at an awkward moment (specs/Actions.tla, specs/Player.tla).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CURSOR_MARKER, type Action } from '@ai-pair/protocol';
import { LineIds } from '../src/lines';
import { Player, spanText, transformScene, type Scene } from '../src/player';
import { instant } from '../src/timeline';
import { advance, containing, FakeEditor, FakePanel, MOVE_TO_A, setup, testConfig, until } from './fake';

/** Returns a scene whose cursor is at `offset` in `file`. */
function sceneWithCursor(file: string, offset: number): Scene {
  return { turn: 'agent', focus: 'cursor', pointFar: false, allowedCommands: new Set(), cursor: { file, offset } };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('transformScene', () => {
  it('moves a position inside deleted text to where its replacement starts', () => {
    const scene = { ...sceneWithCursor('a.ts', 4), selection: { start: 2, end: 5 } };
    transformScene(scene, 'a.ts', { offset: 1, deleteLength: 6, text: 'xy' });
    expect(scene.cursor).toEqual({ file: 'a.ts', offset: 3 });
    expect(scene.selection).toEqual({ start: 3, end: 3 });
  });
});

describe('spanText', () => {
  it('is the text of a span, or else its from', () => {
    expect(spanText({ text: 'a' })).toBe('a');
    expect(spanText({ from: 'b', through: 'c' })).toBe('b');
  });

  it('refuses a span with neither', () => {
    expect(() => spanText({})).toThrow('A span has `text` or `from`');
  });
});

describe('code', () => {
  it('shows the lines around a span in a file the cursor is not in, with no cursor marked', async () => {
    const editor = new FakeEditor();
    const other = editor.resolvePath('b.ts');
    editor.files.set(other, 'one\ntwo\nthree\n');
    const player = new Player(sceneWithCursor(editor.resolvePath('a.ts'), 0), {
      editor,
      panel: new FakePanel(),
      pacing: instant,
      config: () => testConfig,
      speed: () => 1,
      readingSpeed: () => 1,
      render: () => {},
      confirm: () => Promise.resolve(true),
      lines: LineIds.editor(),
    });
    const shown = await player.code({ span: { file: other, start: 4, end: 7 }, moved: false });
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
});

describe('actions the player refuses', () => {
  const refusals: Array<{ name: string; actions: Action[]; kind: string; message: string }> = [
    {
      name: 'a move to a line that is not a line number',
      actions: [{ move: { file: 'a.ts', line: 0, to: 'line_end' } }],
      kind: 'invalid_action',
      message: 'is a line number',
    },
    {
      name: 'a move to another file before the cursor is anywhere',
      actions: [{ move: { line: 1, to: 'line_end' } }],
      kind: 'no_cursor',
      message: "isn't in a file yet",
    },
    {
      name: 'a select of a line that is not a line number',
      actions: [MOVE_TO_A, { select: { line: 0, text: 'x' } }],
      kind: 'invalid_action',
      message: 'is a line number',
    },
    {
      name: 'a select before the cursor is anywhere',
      actions: [{ select: { line: 1, text: 'x' } }],
      kind: 'no_cursor',
      message: "isn't in a file yet",
    },
    {
      name: 'a delete with nothing selected',
      actions: [MOVE_TO_A, { delete: true }],
      kind: 'no_selection',
      message: 'Nothing is selected',
    },
    {
      name: 'a point at a line that is not a line number',
      actions: [MOVE_TO_A, { point: { line: 0, text: 'x' } }],
      kind: 'invalid_action',
      message: 'is a line number',
    },
    {
      name: 'a point before the cursor is anywhere',
      actions: [{ point: { line: 1, text: 'x' } }],
      kind: 'no_cursor',
      message: "isn't in a file yet",
    },
    {
      name: 'a type before the cursor is anywhere',
      actions: [{ type: `y${CURSOR_MARKER}` }],
      kind: 'no_cursor',
      message: "isn't in a file yet",
    },
  ];

  it.each(refusals)('refuses $name', async ({ actions, kind, message }) => {
    const { controller } = setup({ 'a.ts': 'x\n' });
    await controller.start();
    await controller.read('a.ts');
    const report = await until(controller.step(actions));
    expect(report.rejected).toMatchObject({ error: { kind, message: containing(message) } });
  });
});

describe('a line the agent was not shown', () => {
  it.each([
    { name: 'where the text is', text: 'zzz', hint: 'the text is on these lines' },
    { name: 'that the text is nowhere', text: 'nothing', hint: "the text isn't anywhere in the file" },
  ])('says $name', async ({ text, hint }) => {
    const { controller } = setup({ 'a.ts': 'x\ny\nzzz\n' });
    await controller.start();
    await controller.read('a.ts', 1, 1);
    const report = await until(controller.step([MOVE_TO_A, { select: { line: 2, text } }]));
    expect(report.rejected).toMatchObject({ error: { kind: 'line_not_seen', message: containing(hint) } });
  });
});

describe('an editor that fails', () => {
  it('reports the text of a failure that is not an Error', async () => {
    const { editor, controller } = setup({ 'a.ts': 'x\n' });
    await controller.start();
    await controller.read('a.ts');
    vi.spyOn(editor, 'show').mockRejectedValue('plain string');
    await controller.step([MOVE_TO_A]);
    const report = await until(controller.listen());
    expect(report.batches).toMatchObject([{ status: 'failed', error: { kind: 'invalid_action', message: 'plain string' } }]);
  });

  it('lists a file it could not save, with the text of a failure that is not an Error', async () => {
    const { editor, controller } = setup({ 'a.ts': 'x\n' });
    await controller.start();
    await controller.read('a.ts');
    vi.spyOn(editor, 'save').mockRejectedValue('disk full');
    await controller.step([MOVE_TO_A, { type: `y${CURSOR_MARKER}` }]);
    const report = await until(controller.listen());
    expect(report.batches).toMatchObject([{ status: 'completed', unsaved: [{ file: 'a.ts', error: 'disk full' }] }]);
  });

  it('declines the command, and fails the batch, when running it throws', async () => {
    const { editor, panel, controller } = setup({ 'a.ts': 'x\n' }, { confirmCommands: false });
    await controller.start();
    vi.spyOn(editor, 'runCommand').mockRejectedValue(new Error('terminal gone'));
    await controller.step([{ run: 'ls' }]);
    const report = await until(controller.listen());
    expect(report.batches).toMatchObject([{ status: 'failed', error: { kind: 'invalid_action', message: 'terminal gone' } }]);
    expect(panel.events.some((e) => e.type === 'run' && e.phase === 'declined')).toBe(true);
  });
});

describe('commands that end a batch', () => {
  it('fails with nothing left unplayed when the last command exits with an error', async () => {
    const { editor, controller } = setup({ 'a.ts': 'x\n' }, { confirmCommands: false });
    await controller.start();
    editor.commandScript.set('false', { ms: 0, exitCode: 1 });
    await controller.step([{ run: 'false' }]);
    const report = await until(controller.listen());
    expect(report.batches).toMatchObject([{ status: 'failed', error: { kind: 'command_failed' } }]);
    expect(report.batches[0]?.unplayed).toBeUndefined();
  });

  it('says so when the editor truncated the output of a command', async () => {
    const { editor, controller } = setup({ 'a.ts': 'x\n' }, { confirmCommands: false });
    await controller.start();
    vi.spyOn(editor, 'runCommand').mockResolvedValue({ output: 'long output', exitCode: 0, truncated: true });
    await controller.step([{ run: 'ls' }]);
    const report = await until(controller.listen());
    expect(report.batches).toMatchObject([{ status: 'completed', runs: [{ command: 'ls', truncated: true }] }]);
  });

  it('ends interrupted with nothing left unplayed when the programmer cuts the last command short', async () => {
    const { editor, controller } = setup({ 'a.ts': 'x\n' }, { confirmCommands: false });
    await controller.start();
    editor.commandScript.set('build', { ms: 5000 });
    await controller.step([{ run: 'build' }]);
    await advance(500);
    controller.userInterrupt();
    const report = await until(controller.listen());
    expect(report.batches).toMatchObject([{ status: 'interrupted', runs: [{ command: 'build', running: true }] }]);
    expect(report.batches[0]?.unplayed).toBeUndefined();
  });

  it('keeps the last phase a background command showed when its terminal goes away', async () => {
    const { editor, panel, controller } = setup({ 'a.ts': 'x\n' }, { confirmCommands: false });
    await controller.start();
    const exited = Promise.withResolvers<number | undefined>();
    vi.spyOn(editor, 'runCommand').mockResolvedValue({ output: '', running: true, exited: exited.promise });
    await controller.step([{ run: 'build' }]);
    await until(controller.listen());
    exited.reject(new Error('terminal gone'));
    await advance(0);
    expect(panel.events.flatMap((e) => (e.type === 'run' ? [e.phase] : []))).toEqual(['running', 'background']);
  });
});

describe('interruptions at awkward moments', () => {
  it('discards a batch interrupted while the view comes back from far away', async () => {
    const lines = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join('\n');
    const { controller } = setup(
      { 'a.ts': lines },
      { timing: { ...testConfig.timing, beforeMoveMs: 0, afterMoveFarMs: 1000, afterMoveNearMs: 0 } },
    );
    await controller.start();
    await controller.read('a.ts');
    await until(controller.step([{ move: { file: 'a.ts', line: 2, at: `line 2${CURSOR_MARKER}\n` } }]));
    await until(controller.step([{ point: { line: 35, text: 'line 35' } }, { say: 'This one.' }]));
    await until(controller.step([]));
    await controller.step([{ type: `!${CURSOR_MARKER}` }]);
    await advance(500);
    controller.userInterrupt();
    const report = await until(controller.listen());
    expect(report.batches).toMatchObject([{ status: 'discarded', unplayed: [{ type: `!${CURSOR_MARKER}` }] }]);
  });

  it('interrupts a select that is waiting out its pause, and hands it back', async () => {
    const { editor, controller } = setup({ 'a.ts': 'keep DELETE keep\n' });
    await controller.start();
    await controller.read('a.ts');
    await controller.step([MOVE_TO_A, { select: { line: 1, text: 'DELETE' } }]);
    await advance(150);
    editor.userEdit('a.ts', { offset: 0, deleteLength: 0, text: '!' });
    const report = await until(controller.listen());
    expect(report.batches).toMatchObject([{ status: 'interrupted', unplayed: [{ select: { line: 1, text: 'DELETE' } }] }]);
  });

  it('hands back what is left of a type_fast that is cut short', async () => {
    const { controller } = setup({ 'a.ts': 'x\n' });
    await controller.start();
    await controller.read('a.ts');
    await controller.step([MOVE_TO_A, { type_fast: `abcdefghij${CURSOR_MARKER}` }]);
    await advance(125);
    controller.userInterrupt();
    const report = await until(controller.listen());
    expect(report.batches).toMatchObject([{ status: 'interrupted', unplayed: [{ type_fast: `cdefghij${CURSOR_MARKER}` }] }]);
  });

  it('keeps the code a batch reports in place through an edit by others while it types', async () => {
    const { editor, controller } = setup({ 'a.ts': 'x\n' });
    await controller.start();
    await controller.read('a.ts');
    await controller.step([MOVE_TO_A, { type: `abcdef${CURSOR_MARKER}` }]);
    await advance(350);
    editor.otherEdit('a.ts', { offset: 0, deleteLength: 0, text: '// header\n' });
    const report = await until(controller.listen());
    expect(report.batches).toMatchObject([
      {
        status: 'interrupted',
        code: {
          lines: [
            { number: 1, text: '// header' },
            { number: 2, text: `xab${CURSOR_MARKER}` },
          ],
        },
      },
    ]);
  });
});

describe('typing', () => {
  it('deletes the selection when the text to type is only the cursor marker', async () => {
    const { editor, controller } = setup({ 'a.ts': 'keep DELETE keep\n' });
    await controller.start();
    await controller.read('a.ts');
    await controller.step([MOVE_TO_A, { select: { line: 1, text: 'DELETE ' } }, { type: CURSOR_MARKER }]);
    await until(controller.listen());
    expect(editor.text('a.ts')).toBe('keep keep\n');
  });
});
