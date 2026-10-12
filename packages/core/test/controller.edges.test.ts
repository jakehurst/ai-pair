// The controller's paths that a well-behaved agent and a single window never reach: calls with no session, a session that closes
// under a call or a batch, a player or editor that fails, and a report restored by hand (specs/Controller.tla, specs/Resume.tla).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CURSOR_MARKER, type Report } from '@ai-pair/protocol';
import { LineIds } from '../src/lines';
import { Player } from '../src/player';
import { advance, containing, MOVE_TO_A, setup, testConfig, track, until } from './fake';

/** A report with nothing in it. */
const EMPTY_REPORT: Report = { batches: [], events: [], turn: 'agent' };

/** A report from the relay is not checked, so an edit event in it may lack its diff. */
const REPORT_WITHOUT_DIFFS =
  '{"batches":[],"events":[{"kind":"edit","file":"a.ts","by":"other"},{"kind":"edit","file":"b.ts","by":"programmer"}],"turn":"agent"}';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('a window with no session', () => {
  it('has nothing to save and no turn', () => {
    const { controller } = setup();
    expect(controller.saved).toBeUndefined();
    expect(controller.turn).toBeUndefined();
  });

  it('ignores what the programmer and the relay send it', () => {
    const { controller, panel } = setup();
    const change = { offset: 0, deleteLength: 0, text: 'x' };
    controller.userMessage('hello');
    controller.userInterrupt();
    controller.userEdit('/a.ts', '', 'x', [change]);
    controller.otherEdit('/a.ts', '', 'x', [change]);
    controller.takeTurn();
    controller.handBack();
    controller.decideRun(1, true);
    controller.restore(EMPTY_REPORT);
    controller.endSession();
    expect(panel.events).toEqual([]);
  });
});

describe('a session', () => {
  it('has nothing to save once it has ended', async () => {
    const { controller } = setup();
    await controller.start();
    controller.endSession();
    expect(controller.saved).toBeUndefined();
  });

  it('starts on the agent turn, and the turn changes hands once however often it is asked', async () => {
    const { controller, panel } = setup();
    await controller.start();
    expect(controller.turn).toBe('agent');
    controller.takeTurn();
    controller.takeTurn();
    expect(controller.turn).toBe('user');
    controller.handBack();
    controller.handBack();
    expect(panel.events.filter((e) => e.type === 'turn')).toHaveLength(2);
  });

  it('is not replaced by a saved one', async () => {
    const { controller } = setup();
    await controller.start();
    controller.revive({ scene: { turn: 'user', allowedCommands: [] }, finished: [], events: [] });
    expect(controller.turn).toBe('agent');
  });

  it('names the project guides again when its agent comes back', async () => {
    const { controller, panel } = setup();
    await controller.start();
    controller.disconnect();
    await controller.start(undefined, undefined, ['CLAUDE.md']);
    expect(panel.events).toContainEqual({ type: 'session', active: true, task: undefined, resumed: true, rules: ['CLAUDE.md'] });
  });

  it('is closed when its agent disconnects after the programmer ended it', async () => {
    const { controller } = setup();
    await controller.start();
    controller.endSession();
    controller.disconnect();
    await expect(controller.listen()).rejects.toThrow('No pairing session is active');
  });

  it('turns down a calibration when the editor has none', async () => {
    const { controller } = setup();
    await controller.start();
    expect(() => controller.calibrate({ title: 'Words', text: 'Some words.' })).toThrow('no reading speed calibration');
  });
});

describe('reading a file that fails', () => {
  it('passes on a failure that is not the file missing', async () => {
    const { editor, controller } = setup({ 'a.ts': 'x\n' });
    await controller.start();
    vi.spyOn(editor, 'getText').mockRejectedValue(new Error('unreadable'));
    await expect(controller.read('a.ts')).rejects.toThrow('unreadable');
  });
});

describe('commands', () => {
  it('run without asking once the programmer turns confirmation off', async () => {
    const { editor, controller } = setup({ 'a.ts': 'x\n' }, { confirmCommands: true });
    await controller.start();
    controller.setConfirmCommands(false);
    await until(controller.step([{ run: 'ls' }]));
    await until(controller.step([]));
    expect(editor.commands.map((c) => c.command)).toEqual(['ls']);
  });

  it('keep waiting when the answer is to another command', async () => {
    const { editor, controller } = setup({ 'a.ts': 'x\n' });
    await controller.start();
    await controller.step([{ run: 'ls' }]);
    await advance(100);
    controller.decideRun(-1, true);
    await advance(100);
    expect(editor.commands).toEqual([]);
  });

  it('stop waiting for an answer when the programmer interrupts', async () => {
    const { editor, controller } = setup({ 'a.ts': 'x\n' });
    await controller.start();
    await controller.step([{ run: 'ls' }]);
    await advance(100);
    controller.userInterrupt();
    const report = await until(controller.listen());
    expect(report.batches).toMatchObject([{ status: 'discarded', unplayed: [{ run: 'ls' }] }]);
    expect(editor.commands).toEqual([]);
  });
});

describe('a call that waits', () => {
  it('is rejected when the agent disconnects', async () => {
    const { controller } = setup();
    await controller.start();
    const rejected = expect(controller.listen()).rejects.toThrow('Disconnected.');
    await advance(0);
    controller.disconnect();
    await rejected;
  });

  it('is left alone when the signal of an earlier call aborts', async () => {
    const { controller } = setup();
    await controller.start();
    const early = new AbortController();
    const first = controller.listen(early.signal);
    await advance(0);
    controller.userMessage('hello');
    await until(first);
    const second = track(controller.listen());
    await advance(0);
    early.abort();
    await advance(0);
    expect(second.done).toBe(false);
  });

  it('is told the session has ended when it closed while the step was being rehearsed', async () => {
    const { editor, controller } = setup({ 'a.ts': 'x\n' });
    await controller.start();
    await controller.read('a.ts');
    const getText = editor.getText.bind(editor);
    const gate = Promise.withResolvers<void>();
    const atGate = Promise.withResolvers<void>();
    editor.getText = async (file) => {
      atGate.resolve();
      await gate.promise;
      return getText(file);
    };
    const rejected = expect(controller.step([MOVE_TO_A])).rejects.toMatchObject({ code: 'no_session', message: 'The session has ended.' });
    await atGate.promise;
    controller.endSession();
    controller.disconnect();
    editor.getText = getText;
    gate.resolve();
    await advance(testConfig.maxBlockMs);
    await rejected;
  });
});

describe('a report that cannot show the cursor', () => {
  it.each([
    { name: 'cannot be read', stub: () => vi.spyOn(Player.prototype, 'code').mockRejectedValue(new Error('gone')) },
    { name: 'is nowhere', stub: () => vi.spyOn(Player.prototype, 'code').mockResolvedValue(undefined) },
    {
      name: 'is on no line shown',
      stub: () =>
        vi.spyOn(Player.prototype, 'code').mockResolvedValue({
          code: { file: 'a.ts', lines: [{ number: 1, text: 'x' }] },
          sighting: { file: 'a.ts', text: 'x', lines: [1] },
        }),
    },
  ])('goes without it when the cursor $name', async ({ stub }) => {
    const { controller } = setup({ 'a.ts': 'x\n' });
    await controller.start();
    await controller.read('a.ts');
    await until(controller.step([MOVE_TO_A]));
    stub();
    const report = await until(controller.step([{ say: 'Done.' }]));
    expect(report.batches).toMatchObject([{ status: 'completed' }]);
    expect(report.cursor).toBeUndefined();
  });
});

describe('lines the agent is shown', () => {
  it('are not counted as seen when the tracker has no identity for them', async () => {
    const { controller } = setup({ 'a.ts': 'x\n' });
    await controller.start();
    vi.spyOn(LineIds.prototype, 'of').mockReturnValue([]);
    await controller.read('a.ts');
    vi.restoreAllMocks();
    const report = await until(controller.step([MOVE_TO_A]));
    expect(report.rejected).toMatchObject({ error: { kind: 'line_not_seen' } });
  });
});

describe('a rehearsal that fails without saying why', () => {
  it('stops the step with an error of its own', async () => {
    const { controller } = setup({ 'a.ts': 'x\n' });
    await controller.start();
    await controller.read('a.ts');
    vi.spyOn(Player.prototype, 'play').mockResolvedValueOnce({ result: { id: 0, status: 'failed' }, sightings: [] });
    await expect(controller.step([MOVE_TO_A])).rejects.toThrow('recorded no error');
  });
});

describe('a restored report', () => {
  it('keeps the edits it carries, with their diffs', async () => {
    const { controller } = setup();
    await controller.start();
    const diff = '@@ -1 +1 @@\n-a\n+b';
    const events: Report['events'] = [
      { kind: 'edit', file: 'a.ts', diff, by: 'programmer', omitted: 3 },
      { kind: 'edit', file: 'b.ts', diff: '', by: 'other' },
    ];
    controller.restore({ batches: [], events, turn: 'agent' });
    const report = await until(controller.listen());
    expect(report.events).toEqual(events);
  });

  it('reports an edit without a diff as one that changed nothing if the programmer made it, and leaves it out if not', async () => {
    const { controller } = setup();
    await controller.start();
    // The report is not a Report on purpose: the relay does not check what it hands back.
    // oxlint-disable-next-line typescript/no-unsafe-argument
    controller.restore(JSON.parse(REPORT_WITHOUT_DIFFS));
    const report = await until(controller.listen());
    expect(report.events).toEqual([{ kind: 'edit', file: 'b.ts', diff: '', by: 'programmer' }]);
  });

  it('discards the next batch only if the restored one did not complete', async () => {
    const { controller } = setup({ 'a.ts': 'x\n' });
    await controller.start();
    await controller.read('a.ts');
    controller.restore({ batches: [{ id: 1, status: 'completed' }], events: [], turn: 'agent' });
    const queued = await until(controller.step([MOVE_TO_A]));
    expect(queued.submitted).toMatchObject({ status: 'playing' });
    await until(controller.step([]));
    controller.restore({ batches: [{ id: 5, status: 'interrupted' }], events: [], turn: 'agent' });
    const discarded = await until(controller.step([MOVE_TO_A]));
    expect(discarded.batches).toMatchObject([
      { id: 2, status: 'discarded' },
      { id: 5, status: 'interrupted' },
    ]);
  });
});

describe('a session that closes while a batch plays', () => {
  it('lets the batch end without reporting it', async () => {
    const { controller } = setup({ 'a.ts': 'x\n' });
    const lines: string[] = [];
    controller.trace = (line) => {
      lines.push(line);
    };
    await controller.start();
    await controller.read('a.ts');
    await controller.step([MOVE_TO_A, { type: `abcdef${CURSOR_MARKER}` }]);
    await advance(300);
    controller.endSession();
    controller.disconnect();
    await advance(5000);
    expect(lines).not.toContainEqual(containing('batch 1 interrupted'));
  });
});

describe('the trace', () => {
  it('names a session, its pauses, its interrupts, and the reports it sends', async () => {
    const { controller } = setup({ 'a.ts': 'x\n' });
    const lines: string[] = [];
    controller.trace = (line) => {
      lines.push(line);
    };
    await controller.start('a task');
    await controller.read('a.ts');
    controller.pause('away');
    controller.resume('user');
    controller.pause();
    await until(controller.step([{ type: `y${CURSOR_MARKER}` }]));
    controller.resume();
    await controller.step([MOVE_TO_A, { type: `abc${CURSOR_MARKER}` }]);
    await advance(150);
    controller.userInterrupt();
    await until(controller.listen());
    controller.userInterrupt();
    controller.userMessage('hello');
    controller.otherEdit('/project/a.ts', 'x\n', 'y\n', [{ offset: 0, deleteLength: 1, text: 'y' }]);
    await until(controller.listen());
    await until(controller.listen());
    expect(lines).toContainEqual('session started: a task');
    expect(lines).toContainEqual('pause away');
    expect(lines).not.toContainEqual('resume user');
    expect(lines).toContainEqual('resume all');
    expect(lines).toContainEqual(containing('paused (away, user), rejected at action 1: no_cursor'));
    expect(lines).toContainEqual('interrupt: discarding [], batch 1 plays on');
    expect(lines).toContainEqual('interrupt: discarding []');
    expect(lines).toContainEqual(containing('batches [1 interrupted]'));
    expect(lines).toContainEqual(containing('events [interrupt, message, edit a.ts]'));
    expect(lines).toContainEqual(containing('events [], waiting'));
  });
});
