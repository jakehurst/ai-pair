// End to end through core: the controller with the real Player, LineIds, Timeline, rehearsal, places, text, and
// typing, on the fake editor and panel from fake.ts. Its own kind, like relay.test.ts: each case proves a property
// that holds only where those files meet, which their solitary unit tests prove a half of each (specs/Actions.tla,
// specs/BatchFile.tla, specs/Player.tla, specs/Turns.tla, specs/Reload.tla, specs/Rehearsal.tla).

import { ok } from 'node:assert/strict';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CURSOR_MARKER, type Action } from '@ai-pair/protocol';
import { advance, containing, matching, setup, until } from './fake';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** Changes a.ts on disk as a git checkout does: one change spanning lines 2 through 5, of which 3 and 4 are unchanged (#65). */
function reload(editor: ReturnType<typeof setup>['editor']): void {
  editor.otherEdit('a.ts', { offset: 2, deleteLength: 8, text: 'X\n3\n4\nY\n' });
}

// With the test config, a beat is 100 ms and `type` takes 100 ms per character.

describe('where the controller and the player meet', () => {
  it('DeletesTheSelection: replaces a selection by typing, and deletes a selection', async () => {
    const { editor, controller } = setup({ 'a.ts': 'const a = 1\n' });
    await controller.start();
    await controller.read('a.ts');
    await controller.step([{ move: { file: 'a.ts', line: 1, to: 'line_end' } }, { select: { text: '1' } }, { type: `2${CURSOR_MARKER}` }]);
    await until(controller.step([{ select: { text: 'const ' } }, { delete: true }]));
    await until(controller.step([]));
    expect(editor.text('a.ts')).toBe('a = 2\n');
  });

  it('AcceptedOnlyForThatLine: rejects a number from before the lines a queued batch adds above it, and takes one from a `read` after them', async () => {
    const { editor, controller } = setup({ 'a.ts': 'a\nb\n' });
    await controller.start();
    await controller.read('a.ts');
    await controller.step([{ move: { file: 'a.ts', line: 1, to: 'line_end' } }, { type: `\nx${CURSOR_MARKER}` }]);
    // The playing batch moves `b` from line 2 to line 3.
    const stale = await controller.step([{ move: { line: 2, to: 'line_end' } }, { type: `!${CURSOR_MARKER}` }]);
    expect(stale.rejected?.error).toMatchObject({ kind: 'line_not_seen', message: matching(/line 2 reads "x"\.$/) });
    expect((await controller.read('a.ts')).lines.map((l) => l.text)).toEqual(['a', 'x', 'b']);
    const next = await until(controller.step([{ move: { line: 3, to: 'line_end' } }, { type: `!${CURSOR_MARKER}` }]));
    expect(next.rejected).toBeUndefined();
    await until(controller.step([]));
    expect(editor.text('a.ts')).toBe('a\nx\nb!\n');
  });

  it("AcceptedOnlyForThatLine: rejects a report's number that a queued batch has since moved", async () => {
    const { controller } = setup({ 'a.ts': 'a\nb\n' });
    await controller.start();
    await controller.read('a.ts');
    await controller.step([{ move: { file: 'a.ts', line: 2, to: 'line_end' } }, { type: `\nc${CURSOR_MARKER}` }]);
    const first = await until(controller.step([{ move: { line: 1, to: 'line_end' } }, { type: `\nx${CURSOR_MARKER}` }]));
    const [batch] = first.batches;
    ok(batch?.code);
    expect(batch.code.lines.at(-1)).toEqual({ number: 3, text: `c${CURSOR_MARKER}` });
    // The queued batch moves `c` to line 4.
    const stale = await controller.step([{ move: { line: 3, to: 'line_end' } }]);
    expect(stale.rejected?.error).toMatchObject({ kind: 'line_not_seen', message: matching(/line 3 reads "b"\.$/) });
  });

  it("PlaysNothingTwice: returns what's left of a type cut inside its second part", async () => {
    const { editor, controller } = setup({ 'a.ts': '' });
    await controller.start();
    await controller.step([{ move: { file: 'a.ts', line: 1, to: 'line_end' } }, { type: `f(${CURSOR_MARKER}) {}` }]);
    // 100 ms before the move, then 100 ms per character: into the second part, after ") ".
    await advance(100 + 4 * 100 + 50);
    expect(editor.text('a.ts')).toBe('f() ');
    controller.userInterrupt();
    const report = await until(controller.listen());
    expect(report.batches[0]).toMatchObject({ status: 'interrupted', unplayed: [{ type: `${CURSOR_MARKER}{}` }] });
  });

  it("EditAtCursorProp: types and deletes at the cursor in a batch that named the cursor's file, or named none", async () => {
    const { editor, controller } = setup({ 'a.ts': 'ab\n' });
    await controller.start();
    await controller.read('a.ts');
    const named = await until(controller.step([{ move: { file: 'a.ts', line: 1, to: 'line_end' } }, { type: `c${CURSOR_MARKER}` }]));
    expect(named.rejected).toBeUndefined();
    const unnamed = await until(controller.step([{ type: `d${CURSOR_MARKER}` }]));
    expect(unnamed.rejected).toBeUndefined();
    const deleted = await until(controller.step([{ select: { line: 1, text: 'b' } }, { delete: true }]));
    expect(deleted.rejected).toBeUndefined();
    await until(controller.step([]));
    expect(editor.text('a.ts')).toBe('acd\n');
  });

  it("ActsInNamedFile: looks in the file its batch named for an action without `file`, not the cursor's", async () => {
    const { editor, controller } = setup({ 'a.ts': 'a\n', 'b.ts': 'b\nsecond\n' });
    await controller.start();
    await controller.read('a.ts');
    await controller.read('b.ts');
    await until(controller.step([{ move: { file: 'a.ts', line: 1, to: 'line_end' } }]));
    const pointed = await until(controller.step([{ point: { file: 'b.ts', line: 1, text: 'b' } }, { point: { line: 2, text: 'second' } }]));
    expect(pointed.rejected).toBeUndefined();
    await until(controller.step([]));
    expect(editor.point).toMatchObject({ file: editor.resolvePath('b.ts') });
    const selected = await until(
      controller.step([{ point: { file: 'b.ts', line: 1, text: 'b' } }, { select: { line: 2, text: 'second' } }]),
    );
    expect(selected.rejected).toBeUndefined();
  });

  it("ActsInNamedFile: looks in the file its batch named before the agent's cursor is in any file", async () => {
    const { controller } = setup({ 'b.ts': 'b\nsecond\n' });
    await controller.start();
    await controller.read('b.ts');
    const report = await until(controller.step([{ point: { file: 'b.ts', line: 1, text: 'b' } }, { point: { line: 2, text: 'second' } }]));
    expect(report.rejected).toBeUndefined();
  });

  it('ActsInNamedFile: rejects a type or delete with the cursor outside the file its batch named, editing nothing', async () => {
    const { editor, controller } = setup({ 'a.ts': 'a\n', 'b.ts': 'b\n' });
    await controller.start();
    await controller.read('a.ts');
    await controller.read('b.ts');
    await until(controller.step([{ select: { file: 'a.ts', line: 1, text: 'a' } }]));
    const edits: Action[] = [{ type: `y${CURSOR_MARKER}` }, { delete: true }];
    for (const edit of edits) {
      const report = await until(controller.step([{ point: { file: 'b.ts', line: 1, text: 'b' } }, edit]));
      expect(report.rejected).toMatchObject({ index: 2, error: { kind: 'invalid_action', message: containing('b.ts') } });
    }
    await until(controller.step([]));
    expect(editor.text('a.ts')).toBe('a\n');
    expect(editor.text('b.ts')).toBe('b\n');
  });

  it('DiscardedMeansNothing: discards a batch interrupted after a type with nothing to type, which changed nothing (specs/Actions.tla)', async () => {
    const { editor, controller } = setup({ 'a.ts': 'x\n' });
    await controller.start();
    await controller.read('a.ts');
    await controller.step([{ move: { file: 'a.ts', line: 1, to: 'line_end' } }]);
    await until(controller.step([]));
    // The programmer interrupts while the type reads the file's line ending: the second time, as
    // the rehearsal reads it first.
    const eol = editor.eol.bind(editor);
    let calls = 0;
    editor.eol = async (file) => {
      if (++calls === 2) controller.userInterrupt();
      return eol(file);
    };
    await controller.step([{ type: CURSOR_MARKER }, { say: 'Typed.' }]);
    const report = await until(controller.listen());
    expect(report.batches).toMatchObject([{ status: 'discarded', unplayed: [{ say: 'Typed.' }] }]);
  });

  it('OnlyTalkInTheirTurn: stops a delete when the programmer takes the turn while it starts, and deletes nothing', async () => {
    const { editor, controller } = setup({ 'a.ts': 'keep DELETE keep\n' });
    await controller.start();
    await controller.read('a.ts');
    // Holds the delete at its show(), as in the test below.
    const show = editor.show.bind(editor);
    const gate = Promise.withResolvers<void>();
    const atGate = Promise.withResolvers<void>();
    let calls = 0;
    editor.show = async (file) => {
      if (++calls === 2) {
        atGate.resolve();
        await gate.promise;
      }
      return show(file);
    };
    void controller.step([{ select: { file: 'a.ts', line: 1, text: 'DELETE' } }, { delete: true }]);
    await until(atGate.promise);
    controller.takeTurn();
    editor.show = show;
    gate.resolve();
    const report = await until(controller.listen());
    expect(editor.text('a.ts')).toBe('keep DELETE keep\n');
    expect(report.batches).toMatchObject([{ id: 1, status: 'interrupted', unplayed: [{ delete: true }] }]);
  });

  it('DeleteEnds: a delete held at its awaits ends once they return, removing the selected text', async () => {
    const { editor, controller } = setup({ 'a.ts': 'keep DELETE keep\n' });
    await controller.start();
    await controller.read('a.ts');
    // Holds the delete at its show(), as in the test below.
    const show = editor.show.bind(editor);
    const gate = Promise.withResolvers<void>();
    const atGate = Promise.withResolvers<void>();
    let calls = 0;
    editor.show = async (file) => {
      if (++calls === 2) {
        atGate.resolve();
        await gate.promise;
      }
      return show(file);
    };
    void controller.step([{ select: { file: 'a.ts', line: 1, text: 'DELETE' } }, { delete: true }]);
    await until(atGate.promise);
    editor.show = show;
    gate.resolve();
    const report = await until(controller.step([]));
    expect(editor.text('a.ts')).toBe('keep  keep\n');
    expect(report.batches).toMatchObject([{ id: 1, status: 'completed' }]);
  });

  it('EditInterrupts: stops a delete when the programmer edits while it starts, and deletes nothing', async () => {
    const { editor, controller } = setup({ 'a.ts': 'keep DELETE keep\n' });
    await controller.start();
    await controller.read('a.ts');
    // Holds the delete at its show(): during play, the select's show is the first call and the delete's the second.
    const show = editor.show.bind(editor);
    const gate = Promise.withResolvers<void>();
    const atGate = Promise.withResolvers<void>();
    let calls = 0;
    editor.show = async (file) => {
      if (++calls === 2) {
        atGate.resolve();
        await gate.promise;
      }
      return show(file);
    };
    void controller.step([{ select: { file: 'a.ts', line: 1, text: 'DELETE' } }, { delete: true }]);
    await until(atGate.promise);
    // The programmer types in front of the selection while the delete waits.
    editor.userEdit('a.ts', { offset: 0, deleteLength: 0, text: '>>>' });
    editor.show = show;
    gate.resolve();
    const report = await until(controller.step([]));
    expect(editor.text('a.ts')).toBe('>>>keep DELETE keep\n');
    expect(report.batches).toMatchObject([{ id: 1, status: 'interrupted', unplayed: [{ delete: true }] }]);
  });

  it('EventuallyReported: runs a command, reporting its output and exit code with the batch', async () => {
    const { editor, panel, controller } = setup({}, { confirmCommands: false });
    editor.commandScript.set('npm test', { ms: 3000, exitCode: 0, output: '4 passed' });
    await controller.start(undefined, '/project/sub');
    await controller.step([{ say: "Let's run the tests." }, { run: 'npm test' }]);
    await advance(1000);
    expect(editor.state).toBe('running');

    const report = await until(controller.step([]));
    expect(report.batches).toEqual([
      {
        id: 1,
        status: 'completed',
        runs: [{ command: 'npm test', exit_code: 0, output: '4 passed', shell: 'bash' }],
      },
    ]);
    const [command] = editor.commands;
    ok(command);
    expect(command.options).toMatchObject({ cwd: editor.resolvePath('sub'), waitMs: 120_000 });
    expect(panel.events.filter((e) => e.type === 'run').map((e) => e.type === 'run' && e.phase)).toEqual(['running', 'done']);
  });

  it('PlaysNothingTwice, DiscardedMeansNothing: stops waiting when the programmer interrupts, reporting the command as still running', async () => {
    const { editor, controller } = setup({}, { confirmCommands: false });
    editor.commandScript.set('npm test', { ms: 60_000, exitCode: 0 });
    await controller.start();
    await controller.step([{ run: 'npm test' }, { say: 'Done.' }]);
    await advance(500);
    controller.userInterrupt();
    const report = await until(controller.listen());
    expect(report.batches).toMatchObject([{ id: 1, status: 'interrupted', unplayed: [{ say: 'Done.' }], runs: [{ running: true }] }]);
  });

  it("SelectionStays: keeps the agent's selection on a line between the changed ones", async () => {
    const { editor, controller } = setup({ 'a.ts': '1\n2\n3\n4\n5\n6\n' });
    await controller.start();
    await controller.read('a.ts');
    await until(controller.step([{ select: { file: 'a.ts', line: 3, text: '3' } }]));
    await until(controller.step([]));
    reload(editor);
    await until(controller.step([{ delete: true }]));
    await until(controller.step([]));
    expect(editor.text('a.ts')).toBe('1\nX\n\n4\nY\n6\n');
  });

  it('UnchangedKeepIds: keeps the numbers of the lines between the changed ones known', async () => {
    const { editor, controller } = setup({ 'a.ts': '1\n2\n3\n4\n5\n6\n' });
    await controller.start();
    await controller.read('a.ts');
    reload(editor);
    const report = await until(controller.step([{ point: { file: 'a.ts', line: 4, text: '4' } }]));
    expect(report.rejected).toBeUndefined();
  });

  it('ChangedGetNewIds: forgets the number of a changed line, so a batch has to read it again', async () => {
    const { editor, controller } = setup({ 'a.ts': '1\n2\n3\n4\n5\n6\n' });
    await controller.start();
    await controller.read('a.ts');
    reload(editor);
    const report = await controller.step([{ point: { file: 'a.ts', line: 2, text: 'X' } }]);
    expect(report.rejected?.error.kind).toBe('line_not_seen');
  });

  it('ReadIsStart: accepts a line a tool inserted, read while a queued batch edits other files (specs/Rehearsal.tla)', async () => {
    const { editor, controller } = setup({ 'a.ts': 'hello\n' });
    await controller.start();
    await controller.read('a.ts');
    await controller.step([{ say: 'one two three four five six seven eight nine ten' }]);
    await advance(300);
    editor.otherEdit('a.ts', { offset: 0, deleteLength: 0, text: 'XX\n' });
    expect((await controller.read('a.ts')).lines.map((l) => l.text)).toEqual(['XX', 'hello']);
    const moved = await until(controller.step([{ move: { file: 'a.ts', line: 1, to: 'line_end' } }]));
    expect(moved.rejected).toBeUndefined();
  });

  it('ReadIsStart: still interrupts for a change to a file a queued batch edits', async () => {
    const { editor, controller } = setup({ 'a.ts': 'a\n', 'b.ts': 'b\n' });
    await controller.start();
    await controller.read('a.ts');
    await controller.read('b.ts');
    await controller.step([{ move: { file: 'b.ts', line: 1, to: 'line_end' } }, { type: ` long text here${CURSOR_MARKER}` }]);
    const queued = controller.step([{ move: { file: 'a.ts', line: 1, to: 'line_end' } }, { type: `1${CURSOR_MARKER}` }]);
    await advance(300);
    editor.otherEdit('a.ts', { offset: 0, deleteLength: 0, text: '// tool\n' });
    const first = await until(queued);
    const rest = await until(controller.step([]));
    expect([...first.batches, ...rest.batches].map((b) => b.status)).toEqual(['interrupted', 'discarded']);
  });
});
