// The player's paths in a real VS Code, for test/integration.ts: each way a batch is refused, each way a run
// ends, and an interrupt in each of the player's pauses (#176). Every path here is one a real agent or
// programmer can take; the integration run reaches it so the code that handles it stays.

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { CURSOR_MARKER, type Action, type BatchStatus, type ErrorKind, type Report } from '@ai-pair/protocol';
import { isSavedSession } from '@ai-pair/core';
import type { Api } from '../src/extension';

/** The text of the file most cases act in. */
const PATHS = 'alpha beta alpha\ngamma\ndelta beta\n';

/** Long enough for an interrupt sent part way through a pause to land inside it. */
const LONG_PAUSE_MS = 3000;

/** When the interrupt is sent, into a pause of LONG_PAUSE_MS. */
const INTO_PAUSE_MS = 800;

/** How long each key of a slow type takes. */
const MS_PER_KEY = 1000;

/** What a slow type types after its marker: ten keys. */
const AFTER_MARKER = 'bcdefghijk';

/** When the interrupt is sent into a slow type: past the move before it and a few keys after the marker. */
const INTO_TYPING_MS = 4800;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Waits for VS Code's document for `file` to read `text`, as it does once it reloads a file written on disk. */
async function reads(file: string, text: string): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(file);
  for (let i = 0; i < 100 && doc.getText() !== text; i++) {
    await sleep(50);
  }
  assert.equal(doc.getText(), text);
}

function statuses(report: Report): BatchStatus[] {
  return report.batches.map((b) => b.status);
}

/** Plays each path; `root` is the workspace folder. */
export async function playerPaths(api: Api, root: string): Promise<void> {
  const { controller } = api;
  function file(name: string): string {
    return path.join(root, name);
  }
  /** Sends a batch that must be refused with `kind`, and returns the report. */
  async function refused(actions: object[], kind: ErrorKind, message?: RegExp): Promise<Report> {
    // Some of these are actions the relay's schema would refuse; the editor refuses them all the same.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const report = await controller.step(actions as Action[]);
    assert.equal(report.rejected?.error.kind, kind, `${JSON.stringify(actions)}: ${JSON.stringify(report)}`);
    if (message !== undefined) assert.match(report.rejected.error.message, message);
    return report;
  }
  /** Plays a batch, and returns each of its statuses once it is done. */
  async function played(actions: Action[]): Promise<Report> {
    await controller.step(actions);
    return controller.step([]);
  }
  /** Waits for the panel to show a run of `command` in `phase`, and returns its id. */
  async function runShown(command: string, phase: string): Promise<number> {
    for (let i = 0; i < 100; i++) {
      const run = api.history().findLast((e) => e.type === 'run' && e.command === command && e.phase === phase);
      if (run?.type === 'run') return run.id;
      await sleep(50);
    }
    return assert.fail(`the panel never showed ${command} ${phase}`);
  }

  fs.writeFileSync(file('paths.txt'), PATHS);
  fs.writeFileSync(file('one.txt'), 'a\n');
  fs.writeFileSync(file('unread.txt'), 'x\ny b\nz\n');
  fs.writeFileSync(file('empty.txt'), '');
  fs.mkdirSync(file('folder'), { recursive: true });
  controller.setSpeed(20);
  controller.setConfirmCommands(false);
  await controller.start('paths');

  // Before the cursor is in a file, an action that acts at it names one (specs/BatchFile.tla).
  await refused([{ type: `x${CURSOR_MARKER}` }], 'no_cursor');
  await refused([{ move: { line: 1, to: 'line_end' } }], 'no_cursor');
  await refused([{ select: { line: 1, text: 'a' } }], 'no_cursor');
  await refused([{ point: { line: 1, text: 'a' } }], 'no_cursor');
  await refused([{ delete: true }], 'no_selection');
  await refused([{ say: 'a', type: 'b' }], 'invalid_action', /^One action per object/);
  await refused([{ run: '   ' }], 'invalid_action', /needs a command/);
  // A folder can't be shown as a file: the error that comes back refuses the action, by its message.
  await refused([{ move: { file: 'folder', line: 1, to: 'line_end' } }], 'invalid_action');

  // A place not on its line says where it is instead, and what the line reads (specs/Places.tla).
  await controller.read('paths.txt');
  await refused([{ select: { file: 'paths.txt', line: 1, text: 'alpha' } }], 'ambiguous', /occurs 2 times on line 1/);
  const elsewhere = await refused([{ select: { file: 'paths.txt', line: 2, text: 'beta' } }], 'not_found');
  assert.deepEqual(
    elsewhere.rejected?.error.candidates?.map((c) => c.line),
    [1, 3],
  );
  await refused([{ select: { file: 'paths.txt', line: 2, text: 'zeta' } }], 'not_found', /^Text not found: "zeta"/);
  await refused([{ select: { file: 'paths.txt', line: 1, from: 'beta', through: 'zeta' } }], 'not_found', /after `from`: "zeta"/);
  await refused([{ select: { file: 'paths.txt', line: 1, from: 'beta', through: CURSOR_MARKER } }], 'not_found', /after `from`: ""/);
  await refused([{ move: { file: 'paths.txt', line: 2, at: `x${CURSOR_MARKER}` } }], 'not_found');
  await refused([{ select: { file: 'one.txt', line: 2, text: 'a' } }], 'no_line', /has 1 line\./);
  await refused([{ select: { file: 'paths.txt', line: 9, text: 'a' } }], 'no_line', /has 3 lines\./);
  // A line the agent hasn't been shown is refused, with where what it looks for is (specs/Rehearsal.tla, `Accept`);
  // the refusal shows it, so each case asks about another line.
  await refused([{ move: { file: 'unread.txt', line: 2, to: 'line_end' } }], 'line_not_seen', /reads "y b"\.$/);
  const unseen = await refused([{ select: { file: 'unread.txt', line: 1, text: 'b' } }], 'line_not_seen', /is on these lines:$/);
  assert.deepEqual(
    unseen.rejected?.error.candidates?.map((c) => c.line),
    [2],
  );
  await refused([{ select: { file: 'unread.txt', line: 3, text: 'q' } }], 'line_not_seen', /isn't anywhere in the file\.$/);
  // An empty file's one line needs no showing.
  assert.deepEqual(statuses(await played([{ move: { file: 'empty.txt', line: 1, to: 'line_end' } }])), ['completed']);
  await refused([{ select: { file: 'paths.txt', text: 'gamma' } }], 'invalid_action', /^Give `line`/);
  // A batch works in one file, named before its first edit (specs/BatchFile.tla, `Act`).
  await refused(
    [{ move: { file: 'paths.txt', line: 1, to: 'line_end' } }, { point: { file: 'one.txt', line: 1, text: 'a' } }],
    'invalid_action',
    /^A batch works in one file, but this one names paths\.txt and one\.txt/,
  );
  await refused(
    [{ type: `x${CURSOR_MARKER}` }, { move: { file: 'paths.txt', line: 1, to: 'line_end' } }],
    'invalid_action',
    /before the batch's first edit/,
  );
  // A range, pointed at in another file; the next action at the cursor brings the view back from it, far
  // (specs/PointFocus.tla, `ActAtCursor`).
  assert.deepEqual(statuses(await played([{ point: { file: 'paths.txt', line: 1, from: 'beta', through: 'alpha' } }])), ['completed']);
  assert.deepEqual(statuses(await played([{ type: `y${CURSOR_MARKER}` }])), ['completed']);
  assert.equal((await vscode.workspace.openTextDocument(file('empty.txt'))).getText(), 'y');

  // A selection is replaced by what is typed, and by nothing (specs/Player.tla).
  await controller.read('paths.txt');
  assert.deepEqual(statuses(await played([{ select: { file: 'paths.txt', line: 2, text: 'gamma' } }, { type: `GAMMA${CURSOR_MARKER}` }])), [
    'completed',
  ]);
  assert.deepEqual(statuses(await played([{ select: { file: 'paths.txt', line: 2, text: 'GAMMA' } }, { type: CURSOR_MARKER }])), [
    'completed',
  ]);
  assert.equal((await vscode.workspace.openTextDocument(file('paths.txt'))).getText(), 'alpha beta alpha\n\ndelta beta\n');

  // In the programmer's turn only `say` and `point` play; handing it back shares what they selected (specs/Turns.tla).
  controller.takeTurn();
  // The turn change interrupts; once a report has said so, batches are rehearsed again.
  await controller.listen();
  await refused([{ type: `x${CURSOR_MARKER}` }], 'not_your_turn');
  controller.handBack('over to you', { file: file('paths.txt'), from: { line: 1, column: 1 }, to: { line: 1, column: 6 }, text: 'alpha' });
  const handed = await controller.listen();
  assert.deepEqual(handed.events.at(-1), {
    kind: 'turn',
    to: 'agent',
    message: 'over to you',
    selection: { file: 'paths.txt', from: { line: 1, column: 1 }, to: { line: 1, column: 6 }, text: 'alpha' },
  });

  // In a file with CRLF line ends, typed newlines are CRLF, and the step back into the pair counts them.
  fs.writeFileSync(file('crlf.txt'), 'one\r\ntwo\r\n');
  await controller.read('crlf.txt');
  await played([
    { move: { file: 'crlf.txt', line: 1, to: 'line_end' } },
    { type: ` {\n  ${CURSOR_MARKER}\n}` },
    { type: `x${CURSOR_MARKER}` },
  ]);
  assert.equal((await vscode.workspace.openTextDocument(file('crlf.txt'))).getText(), 'one {\r\n  x\r\n}\r\ntwo\r\n');

  // A change someone else made over the agent's cursor, and over its pointed code, keeps them on their text
  // (specs/Player.tla, `TypeBefore`).
  fs.writeFileSync(file('moved.txt'), 'one\ntwo\nthree\n');
  await controller.read('moved.txt');
  await played([{ move: { file: 'moved.txt', line: 2, at: `t${CURSOR_MARKER}wo` } }, { point: { line: 3, text: 'three' } }]);
  fs.writeFileSync(file('moved.txt'), 'one\nTWO\nTHREE\n');
  await reads(file('moved.txt'), 'one\nTWO\nTHREE\n');
  const rewritten = await controller.step([]);
  assert.ok(
    rewritten.events.some((e) => e.kind === 'edit' && e.by === 'other'),
    JSON.stringify(rewritten),
  );

  // Commands: one that fails fails its batch, after it ran (specs/Actions.tla); the actions after it come back.
  const failing = await played([{ run: 'false' }, { say: 'after' }]);
  assert.deepEqual(failing.batches[0]?.error?.kind, 'command_failed');
  assert.deepEqual(failing.batches[0]?.unplayed, [{ say: 'after' }]);
  // One that outlives its wait runs on in the background, and the panel shows when it ends (specs/RunBox.tla).
  const background = await played([{ run: 'sleep 2', wait: 0.5 }]);
  assert.equal(background.batches[0]?.runs?.[0]?.running, true, JSON.stringify(background));
  await runShown('sleep 2', 'exited');
  // A long output is cut to its tail.
  const long = await played([{ run: 'yes abcdefghij | head -n 3000' }]);
  assert.equal(long.batches[0]?.runs?.[0]?.truncated, true, JSON.stringify(long.batches[0]?.runs));
  // An interrupt while it waits on one leaves it running, and counts it as played (specs/Actions.tla, `StopWhileRunning`).
  await controller.step([{ run: 'sleep 3', wait: 2 }, { say: 'after' }]);
  await sleep(INTO_PAUSE_MS);
  controller.userInterrupt();
  const stopped = await controller.listen();
  assert.deepEqual(statuses(stopped), ['interrupted']);
  assert.deepEqual(stopped.batches[0]?.unplayed, [{ say: 'after' }]);
  // A file deleted by the command can't be shown in the report, which comes back without it.
  fs.writeFileSync(file('gone.txt'), 'a\n');
  await controller.read('gone.txt');
  const gone = await played([
    { move: { file: 'gone.txt', line: 1, to: 'line_end' } },
    { type: `b${CURSOR_MARKER}` },
    { run: 'rm gone.txt' },
  ]);
  assert.deepEqual(statuses(gone), ['completed']);
  assert.equal(gone.batches[0]?.code, undefined);

  // With confirmation on, the programmer decides: declined, run and remembered, and an interrupt while it asks.
  controller.setConfirmCommands(true);
  await controller.step([{ run: 'echo declined' }]);
  controller.decideRun(await runShown('echo declined', 'confirm'), /* run= */ false);
  assert.equal((await controller.step([])).batches[0]?.error?.kind, 'command_declined');
  await controller.step([{ run: 'echo remembered' }]);
  controller.decideRun(await runShown('echo remembered', 'confirm'), /* run= */ true, /* remember= */ true);
  assert.deepEqual(statuses(await controller.step([])), ['completed']);
  assert.deepEqual(statuses(await played([{ run: 'echo remembered' }])), ['completed']);
  await controller.step([{ run: 'echo asked' }]);
  await runShown('echo asked', 'confirm');
  controller.userInterrupt();
  // Nothing had happened yet, so the batch counts as discarded (specs/Actions.tla, `Stop`).
  assert.deepEqual(statuses(await controller.listen()), ['discarded']);
  await runShown('echo asked', 'declined');
  controller.setConfirmCommands(false);

  // An interrupt during the save before a command stops it before it starts (specs/Terminals.tla, `AbortBeforeStart`).
  fs.writeFileSync(file('unstarted.txt'), 'a\n');
  await controller.read('unstarted.txt');
  const saving = vscode.workspace.onWillSaveTextDocument(() => {
    controller.userInterrupt();
  });
  await controller.step([
    { move: { file: 'unstarted.txt', line: 1, to: 'line_end' } },
    { type: `b${CURSOR_MARKER}` },
    { run: 'echo never' },
  ]);
  const unstarted = await controller.listen();
  saving.dispose();
  assert.deepEqual(statuses(unstarted), ['interrupted']);
  await runShown('echo never', 'declined');
  fs.mkdirSync(file('fresh'), { recursive: true });
  await controller.end();
  await controller.start('another folder', file('fresh'));
  // A file outside the session's folder is named by its absolute path.
  await controller.read(file('one.txt'));
  const outside = await played([{ move: { file: file('one.txt'), line: 1, to: 'line_end' } }]);
  assert.equal(outside.cursor?.file ?? outside.batches[0]?.code?.file, file('one.txt'), JSON.stringify(outside));
  await controller.end();
  await controller.start('paths again');

  // A save that fails: the file on disk changed under the agent's edits. Before a command it doesn't run; at the
  // end of a batch the report names it (specs/RunBox.tla, `FailSave`).
  for (const run of [true, false]) {
    fs.writeFileSync(file('unsaved.txt'), 'a\n');
    await reads(file('unsaved.txt'), 'a\n');
    await controller.read('unsaved.txt');
    const changed = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.fsPath === file('unsaved.txt') && e.contentChanges.length > 0) {
        changed.dispose();
        fs.writeFileSync(file('unsaved.txt'), 'changed on disk\n');
      }
    });
    const actions: Action[] = [{ move: { file: 'unsaved.txt', line: 1, to: 'line_end' } }, { type: `b${CURSOR_MARKER}` }];
    const report = await played(run ? [...actions, { run: 'true' }] : actions);
    if (run) {
      assert.equal(report.batches[0]?.error?.kind, 'save_failed', JSON.stringify(report));
    } else {
      assert.equal(report.batches[0]?.unsaved?.[0]?.file, 'unsaved.txt', JSON.stringify(report));
    }
    await vscode.commands.executeCommand('workbench.action.files.revert', vscode.Uri.file(file('unsaved.txt')));
  }

  // An interrupt in each pause: before a move, before a select, before the first keystroke, and part way
  // through a type, slow and fast (specs/Actions.tla, `StopAtCheck`).
  controller.setSpeed(1);
  fs.writeFileSync(file('pauses.txt'), 'one\ntwo\n');
  await controller.read('pauses.txt');
  await played([{ move: { file: 'pauses.txt', line: 1, to: 'line_end' } }]);
  // A key a second, so the interrupt lands with some of the text after the marker typed and some not.
  const slowKeys = { type: { charMs: MS_PER_KEY, wordStartMs: 0 } };
  const cases: Array<{ timing: object; actions: Action[]; rest?: 'type' | 'type_fast' }> = [
    { timing: { beforeMoveMs: LONG_PAUSE_MS }, actions: [{ move: { line: 2, to: 'line_end' } }] },
    { timing: { beforeSelectMs: LONG_PAUSE_MS }, actions: [{ select: { line: 1, text: 'one' } }] },
    { timing: { type: { charMs: LONG_PAUSE_MS, wordStartMs: LONG_PAUSE_MS } }, actions: [{ type: `x${CURSOR_MARKER}` }] },
    { timing: slowKeys, actions: [{ type: `a${CURSOR_MARKER}${AFTER_MARKER}` }], rest: 'type' },
    { timing: { ...slowKeys, fastFactor: 1 }, actions: [{ type_fast: `a${CURSOR_MARKER}${AFTER_MARKER}` }], rest: 'type_fast' },
  ];
  for (const { timing, actions, rest } of cases) {
    controller.setTiming(timing);
    await controller.read('pauses.txt');
    await controller.step([{ move: { file: 'pauses.txt', line: 1, to: 'line_end' } }, ...actions]);
    await sleep(rest === undefined ? INTO_PAUSE_MS : INTO_TYPING_MS);
    controller.userInterrupt();
    const report = await controller.listen();
    controller.setTiming({});
    if (rest !== undefined) {
      // What is left of it: the marker, then the end of the text after it.
      const [left] = report.batches[0]?.unplayed ?? [];
      const text =
        left === undefined ? undefined : rest === 'type' && 'type' in left ? left.type : 'type_fast' in left ? left.type_fast : undefined;
      assert.ok(typeof text === 'string' && text.startsWith(CURSOR_MARKER), JSON.stringify(report));
      const after = text.slice(CURSOR_MARKER.length);
      assert.ok(after !== '' && after.length < AFTER_MARKER.length && AFTER_MARKER.endsWith(after), JSON.stringify(report));
    } else {
      assert.notEqual(report.batches[0]?.status, 'completed', JSON.stringify(report));
    }
  }

  // A delete interrupted while its file comes into view stops before it deletes (specs/Player.tla, `Begin`).
  controller.setSpeed(20);
  await controller.read('pauses.txt');
  await played([{ select: { file: 'pauses.txt', line: 1, text: 'one' } }]);
  const beforeDelete = (await vscode.workspace.openTextDocument(file('pauses.txt'))).getText();
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file('one.txt')));
  const shown = vscode.window.onDidChangeActiveTextEditor((e) => {
    if (e?.document.uri.fsPath === file('pauses.txt')) controller.userInterrupt();
  });
  await controller.step([{ delete: true }]);
  const kept = await controller.listen();
  shown.dispose();
  assert.notEqual(kept.batches[0]?.status, 'completed', JSON.stringify(kept));
  assert.equal((await vscode.workspace.openTextDocument(file('pauses.txt'))).getText(), beforeDelete);
  await controller.end();
  controller.setSpeed(10);
  controller.setTiming(vscode.workspace.getConfiguration('aiPair').get('timing'));
  console.log('the player: every refusal, every way a run ends, a failed save, and an interrupt in each pause');
}

/** Plays the controller's paths: the programmer's input with and without a session, and calls cut short. */
export async function controllerPaths(api: Api, root: string): Promise<void> {
  const { controller } = api;
  function file(name: string): string {
    return path.join(root, name);
  }
  fs.writeFileSync(file('paths.txt'), PATHS);
  fs.mkdirSync(file('folder'), { recursive: true });
  const selection = { file: file('paths.txt'), from: { line: 1, column: 1 }, to: { line: 1, column: 6 }, text: 'alpha' };

  // With no session, the programmer's input goes nowhere, and nothing breaks (specs/Resume.tla).
  assert.equal(controller.isActive, false);
  controller.userMessage('anyone?');
  controller.userInterrupt();
  controller.takeTurn();
  controller.handBack();
  controller.endSession();
  controller.decideRun(0, /* run= */ true);
  await vscode.commands.executeCommand('aiPair.toggleTurn');
  assert.equal(controller.turn, undefined);
  // A session saved by 0.6.10 or earlier holds `null` where nothing was set; it revives all the same.
  const old: unknown = JSON.parse(
    '{"scene":{"turn":"agent","cursor":null,"selection":null,"allowedCommands":[]},"finished":[],"events":[]}',
  );
  assert.ok(isSavedSession(old));
  controller.revive(old);
  assert.equal(controller.isSuspended, true);
  // Reviving again, with one already there, keeps it.
  controller.revive(old);
  controller.endSession();
  assert.equal(controller.isActive, false);

  await controller.start('controller paths');
  await assert.rejects(controller.start('again'), /already active in this window/);
  await assert.rejects(controller.read('folder'));
  // The turn's toggle, as the command and the panel's button give it (specs/Turns.tla, `ChangeTurn`).
  await vscode.commands.executeCommand('aiPair.toggleTurn');
  assert.equal(controller.turn, 'user');
  controller.takeTurn();
  await controller.listen();
  await vscode.commands.executeCommand('aiPair.toggleTurn');
  controller.handBack();
  assert.equal(controller.turn, 'agent');
  controller.userMessage('see this', selection);
  const messaged = await controller.listen();
  assert.equal(messaged.events.at(-1)?.kind, 'message');

  // Pauses: a report while paused says why; one reason of two resumed leaves it paused; a point the programmer
  // looked away from stops being what the view follows (specs/PointFocus.tla).
  controller.pause('user');
  controller.pause('away');
  controller.userInterrupt();
  const paused = await controller.listen();
  assert.deepEqual(paused.paused?.toSorted(), ['away', 'user']);
  controller.resume('user');
  assert.equal(controller.isPaused, true);
  controller.resume();
  await controller.read('paths.txt');
  await controller.step([{ point: { file: 'paths.txt', line: 1, text: 'beta' } }]);
  await controller.step([]);
  controller.pause('away');
  controller.resume('away');
  assert.equal(controller.isPaused, false);

  // A batch after one that stopped short must say where the cursor is (#112, specs/Anchor.tla).
  controller.setSpeed(1);
  await controller.step([{ move: { file: 'paths.txt', line: 1, to: 'line_end' } }, { type: `${'z'.repeat(40)}${CURSOR_MARKER}` }]);
  await sleep(INTO_PAUSE_MS * 2);
  controller.userInterrupt();
  await controller.listen();
  controller.setSpeed(20);
  const unanchored = await controller.step([{ type: `x${CURSOR_MARKER}` }]);
  assert.equal(unanchored.rejected?.error.kind, 'unanchored', JSON.stringify(unanchored));
  await vscode.commands.executeCommand('workbench.action.files.revert', vscode.Uri.file(file('paths.txt')));

  // A call canceled while it waits its turn never runs; one canceled while its batch is rehearsed ends without
  // blocking; a cancel after the call ended changes nothing (specs/Serialize.tla: `Guard`, `Rehearse`, `Abort`).
  const first = controller.listen();
  const waiting = new AbortController();
  const second = controller.listen(waiting.signal);
  waiting.abort();
  await assert.rejects(second, /cancel/i);
  controller.userInterrupt();
  await first;
  const rehearsing = new AbortController();
  const getText = api.editor.getText.bind(api.editor);
  api.editor.getText = async (f) => {
    rehearsing.abort();
    return getText(f);
  };
  await controller.read('paths.txt');
  const cut = controller.step([{ point: { file: 'paths.txt', line: 1, text: 'beta' } }], rehearsing.signal);
  await assert.rejects(cut, /cancel/i);
  api.editor.getText = getText;
  const late = new AbortController();
  controller.userInterrupt();
  await controller.listen(late.signal);
  late.abort();

  // A report the agent never took, put back after its session closed: the next call takes it, and closes the
  // session again (#60, specs/Controller.tla, `Restore`).
  await controller.end();
  controller.restore({ batches: [], events: [{ kind: 'interrupt' }], turn: 'agent' });
  assert.deepEqual((await controller.listen()).events, [{ kind: 'interrupt' }]);
  assert.equal(controller.isActive, false);
  // With nothing closed to take it, it goes nowhere.
  controller.disconnect();
  controller.restore({ batches: [], events: [{ kind: 'interrupt' }], turn: 'agent' });
  assert.equal(controller.isActive, false);

  // An edit restored with its report comes again with its diff; a rejection restored is held for the next report.
  await controller.start('restored');
  controller.restore({
    batches: [],
    events: [{ kind: 'edit', file: 'paths.txt', diff: '@@ -1 +1 @@', by: 'other', omitted: 2 }],
    turn: 'agent',
    rejected: { index: 1, action: { say: 'x' }, error: { kind: 'invalid_action', message: 'No.' } },
  });
  const again = await controller.listen();
  assert.deepEqual(again.events, [{ kind: 'edit', file: 'paths.txt', diff: '@@ -1 +1 @@', by: 'other', omitted: 2 }]);
  assert.equal(again.rejected?.error.message, 'No.');
  // A change someone else made and undid, to a file no batch edits, isn't reported.
  fs.writeFileSync(file('undone-other.txt'), 'a\n');
  await reads(file('undone-other.txt'), 'a\n');
  fs.writeFileSync(file('undone-other.txt'), 'ba\n');
  await reads(file('undone-other.txt'), 'ba\n');
  fs.writeFileSync(file('undone-other.txt'), 'a\n');
  await reads(file('undone-other.txt'), 'a\n');
  controller.userInterrupt();
  const quiet = await controller.listen();
  assert.ok(!quiet.events.some((e) => e.kind === 'edit' && e.file === 'undone-other.txt'), JSON.stringify(quiet));

  // The programmer ending a session while it is suspended mid-batch: the batch stops there (specs/Resume.tla).
  controller.setSpeed(1);
  await controller.read('paths.txt');
  await controller.step([{ move: { file: 'paths.txt', line: 1, to: 'line_end' } }, { type: `${'w'.repeat(40)}${CURSOR_MARKER}` }]);
  await sleep(INTO_PAUSE_MS * 2);
  controller.disconnect();
  controller.endSession();
  assert.equal(controller.isActive, false);
  controller.setSpeed(10);
  await vscode.commands.executeCommand('workbench.action.files.revert', vscode.Uri.file(file('paths.txt')));
  // An ended session the agent's relay then leaves is closed (specs/Bridge.tla, `CloseEnded`).
  await controller.start('ended, then left');
  controller.endSession();
  controller.disconnect();
  assert.equal(controller.isActive, false);
  console.log('the controller: input without a session, the turn, pauses, canceled calls, restored reports');
}
