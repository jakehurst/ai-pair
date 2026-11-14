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
  it('Attention: holds later edits until the requested floor is released after speech drains', async () => {
    const { promise, resolve } = Promise.withResolvers<void>();
    const narration = {
      speak: vi.fn(() => promise),
      attentionCue: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn(),
      resume: vi.fn(),
      cancel: vi.fn(),
    };
    const { editor, controller, panel } = setup({ 'a.ts': '' }, {}, narration);
    await controller.start();
    await controller.step([
      { say: 'Speaking.', speech_mode: 'continue' },
      { move: { file: 'a.ts', line: 1, to: 'line_end' } },
      { type: `x${CURSOR_MARKER}` },
    ]);
    controller.requestAttention();
    await advance(3000);
    expect(editor.text('a.ts')).toBe('');
    expect(narration.pause).not.toHaveBeenCalled();
    expect(panel.events).not.toContainEqual({ type: 'attention', state: 'granted' });
    resolve();
    await advance(20);
    expect(panel.events).toContainEqual({ type: 'attention', state: 'granted' });
    expect(narration.attentionCue).toHaveBeenCalledOnce();
    expect(editor.text('a.ts')).toBe('');
    controller.resume();
    await until(controller.step([]));
    expect(editor.text('a.ts')).toBe('x');
  });

  it('Attention: idle continued speech drains before granting the floor', async () => {
    const { promise, resolve } = Promise.withResolvers<void>();
    const narration = {
      speak: vi.fn(() => promise),
      attentionCue: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn(),
      resume: vi.fn(),
      cancel: vi.fn(),
    };
    const { controller, panel } = setup({}, {}, narration);
    await controller.start();
    await until(controller.step([{ say: 'Still speaking.', speech_mode: 'continue' }]));
    await advance(1000);
    controller.requestAttention();
    await advance(10);
    expect(panel.events).not.toContainEqual({ type: 'attention', state: 'granted' });
    resolve();
    await advance(10);
    expect(panel.events).toContainEqual({ type: 'attention', state: 'granted' });
    expect(panel.events).toContainEqual(expect.objectContaining({ type: 'state', paused: true, speechPaused: false }));
  });

  it('Attention: lowering a pending hand releases the boundary and rejects the late grant', async () => {
    const { promise, resolve } = Promise.withResolvers<void>();
    const narration = {
      speak: vi.fn(() => promise),
      attentionCue: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn(),
      resume: vi.fn(),
      cancel: vi.fn(),
    };
    const { editor, controller, panel } = setup({ 'a.ts': '' }, {}, narration);
    await controller.start();
    await controller.step([
      { say: 'Speaking.', speech_mode: 'continue' },
      { move: { file: 'a.ts', line: 1, to: 'line_end' } },
      { type: `x${CURSOR_MARKER}` },
    ]);
    controller.requestAttention();
    await advance(2000);
    controller.requestAttention();
    await until(controller.step([]));
    expect(editor.text('a.ts')).toBe('x');
    resolve();
    await advance(10);
    expect(panel.events).not.toContainEqual({ type: 'attention', state: 'granted' });
    expect(narration.attentionCue).not.toHaveBeenCalled();
  });

  it('Attention: releasing the floor keeps a separate programmer pause', async () => {
    const narration = {
      speak: vi.fn().mockResolvedValue(undefined),
      attentionCue: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn(),
      resume: vi.fn(),
      cancel: vi.fn(),
    };
    const { controller, panel } = setup({}, {}, narration);
    await controller.start();
    controller.pause();
    controller.requestAttention();
    await advance(10);
    expect(panel.events).toContainEqual({ type: 'attention', state: 'granted' });
    expect(narration.attentionCue).not.toHaveBeenCalled();
    controller.resume();
    expect(narration.resume).not.toHaveBeenCalled();
    expect(panel.events).toContainEqual(expect.objectContaining({ type: 'state', paused: true }));
  });

  it('Attention: a renewed request at a waiting boundary blocks the next edit', async () => {
    const { promise, resolve } = Promise.withResolvers<void>();
    const narration = {
      speak: vi.fn(() => promise),
      attentionCue: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn(),
      resume: vi.fn(),
      cancel: vi.fn(),
    };
    const { editor, controller, panel } = setup({ 'a.ts': '' }, {}, narration);
    await controller.start();
    await controller.step([
      { say: 'Speaking.', speech_mode: 'continue' },
      { move: { file: 'a.ts', line: 1, to: 'line_end' } },
      { type: `x${CURSOR_MARKER}` },
    ]);
    controller.requestAttention();
    await advance(1000);
    controller.requestAttention();
    controller.requestAttention();
    await advance(1000);
    expect(editor.text('a.ts')).toBe('');
    resolve();
    await advance(10);
    expect(panel.events).toContainEqual({ type: 'attention', state: 'granted' });
    expect(editor.text('a.ts')).toBe('');
  });

  it('Attention: a deferred reply at the granted floor interrupts before another edit', async () => {
    const { editor, controller, panel } = setup({ 'a.ts': '' });
    await controller.start();
    await controller.step([{ say: 'Reading.' }, { move: { file: 'a.ts', line: 1, to: 'line_end' } }, { type: `x${CURSOR_MARKER}` }]);
    controller.requestAttention();
    await advance(2000);
    expect(panel.events).toContainEqual({ type: 'attention', state: 'granted' });
    controller.userMessage('Wait.', undefined, true);
    await until(controller.step([]));
    expect(editor.text('a.ts')).toBe('');
  });

  it('Attention: a renewed request at the first action boundary blocks that action', async () => {
    const { editor, controller, panel } = setup({ 'a.ts': '' });
    await controller.start();
    controller.requestAttention();
    await advance(10);
    expect(panel.events).toContainEqual({ type: 'attention', state: 'granted' });
    await controller.step([{ move: { file: 'a.ts', line: 1, to: 'line_end' } }, { type: `x${CURSOR_MARKER}` }]);
    controller.resume();
    controller.requestAttention();
    await advance(1000);
    expect(panel.events.filter((event) => event.type === 'attention' && event.state === 'granted')).toHaveLength(2);
    expect(editor.text('a.ts')).toBe('');
    expect(editor.shown).toEqual([]);
  });

  it('reminds after three accepted unspoken batches only while speech is ready', async () => {
    const ready = vi.fn().mockResolvedValue(false);
    const narration = {
      ready,
      speak: vi.fn().mockResolvedValue(undefined),
      attentionCue: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn(),
      resume: vi.fn(),
      cancel: vi.fn(),
    };
    const { controller } = setup({}, {}, narration);
    await controller.start();
    expect((await until(controller.step([{ say: 'One.', speak: false }]))).speechReminder).toBeUndefined();
    expect((await until(controller.step([{ say: 'Two.', speak: false }]))).speechReminder).toBeUndefined();
    expect((await until(controller.step([{ say: 'Three.', speak: false }]))).speechReminder).toBeUndefined();
    ready.mockResolvedValue(true);
    expect((await until(controller.step([{ say: 'Four.', speak: false }]))).speechReminder).toBe(true);
    expect((await until(controller.step([{ say: 'Five.', speak: false }]))).speechReminder).toBeUndefined();
    await until(controller.step([{ say: 'Spoken.' }]));
    expect((await until(controller.step([{ say: 'Six.', speak: false }]))).speechReminder).toBeUndefined();
  });

  it('waits for selected speech after reading before playing the next edit', async () => {
    const { promise, resolve } = Promise.withResolvers<void>();
    const narration = {
      speak: vi.fn(() => promise),
      attentionCue: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn(),
      resume: vi.fn(),
      cancel: vi.fn(() => {
        resolve();
      }),
    };
    const { editor, controller, panel } = setup({ 'a.ts': '' }, {}, narration);
    await controller.start();
    await controller.step([
      { say: 'One idea.', speak: true },
      { move: { file: 'a.ts', line: 1, to: 'line_end' } },
      { type: `x${CURSOR_MARKER}` },
    ]);
    await advance(3000);
    expect(narration.speak).toHaveBeenCalledWith('One idea.');
    expect(panel.says()).toContain('One idea.');
    expect(editor.text('a.ts')).toBe('');
    resolve();
    await until(controller.step([]));
    expect(editor.text('a.ts')).toBe('x');
  });

  it('keeps a held reading clock after speech fails and resumes code only on release', async () => {
    const narration = {
      speak: vi.fn(() => Promise.reject(new Error('unavailable'))),
      attentionCue: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn(),
      resume: vi.fn(),
      cancel: vi.fn(),
    };
    const { editor, controller, panel } = setup({ 'a.ts': '' }, {}, narration);
    await controller.start();
    await controller.step([
      { say: 'Read first.', speak: true },
      { move: { file: 'a.ts', line: 1, to: 'line_end' } },
      { type: `x${CURSOR_MARKER}` },
    ]);
    const reading = panel.events.find((event) => event.type === 'reading');
    if (reading?.type !== 'reading' || reading.id === undefined) throw new Error('No reading countdown');
    controller.holdReading(reading.id, true);
    await advance(3000);
    expect(editor.text('a.ts')).toBe('');
    controller.holdReading(reading.id, false);
    await until(controller.step([]));
    expect(editor.text('a.ts')).toBe('x');
  });

  it('keeps code paused when speech finishes after the reading timer', async () => {
    const { promise, resolve } = Promise.withResolvers<void>();
    const narration = {
      speak: vi.fn(() => promise),
      attentionCue: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn(),
      resume: vi.fn(),
      cancel: vi.fn(),
    };
    const { editor, controller } = setup({ 'a.ts': '' }, {}, narration);
    await controller.start();
    await controller.step([
      { say: 'Read first.', speak: true },
      { move: { file: 'a.ts', line: 1, to: 'line_end' } },
      { type: `x${CURSOR_MARKER}` },
    ]);
    await advance(1000);
    controller.pause();
    resolve();
    await advance(3000);
    expect(editor.text('a.ts')).toBe('');
    controller.resume();
    await until(controller.step([]));
    expect(editor.text('a.ts')).toBe('x');
  });

  it('reply cancels speech and does not return its displayed text as unplayed', async () => {
    const { promise, resolve } = Promise.withResolvers<void>();
    const narration = {
      speak: vi.fn(() => promise),
      attentionCue: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn(),
      resume: vi.fn(),
      cancel: vi.fn(() => {
        resolve();
      }),
    };
    const { controller, panel } = setup({ 'a.ts': '' }, {}, narration);
    await controller.start();
    await controller.step([{ say: 'Already seen.', speak: true }, { move: { file: 'a.ts', line: 1, to: 'line_end' } }]);
    await advance(50);
    controller.userMessage('Wait.');
    const report = await until(controller.listen());
    expect(narration.cancel).toHaveBeenCalled();
    expect(panel.says()).toEqual(['Already seen.']);
    expect(report.batches[0]?.unplayed).toEqual([{ move: { file: 'a.ts', line: 1, to: 'line_end' } }]);
  });

  it.each([
    [250, 'x', `"""${CURSOR_MARKER}y`],
    [550, 'x"""', `${CURSOR_MARKER}y`],
  ])('reports the correct remaining text when interrupted around an atomic quote run at %i ms', async (ms, typed, rest) => {
    const { editor, controller } = setup({ 'a.py': '' });
    await controller.start();
    await controller.step([{ move: { file: 'a.py', line: 1, to: 'line_end' } }, { type: `x"""${CURSOR_MARKER}y` }]);
    await advance(ms);
    expect(editor.text('a.py')).toBe(typed);
    controller.userInterrupt();
    const report = await until(controller.listen());
    expect(report.batches[0]).toMatchObject({ status: 'interrupted', unplayed: [{ type: rest }] });
  });

  it('types a requested empty triple-quoted string as six literal quotes', async () => {
    const { editor, controller } = setup({ 'a.py': '' });
    await controller.start();
    await controller.step([{ move: { file: 'a.py', line: 1, to: 'line_end' } }, { type: `"""${CURSOR_MARKER}"""` }]);
    await until(controller.step([]));
    expect(editor.text('a.py')).toBe('""""""');
    expect(editor.cursor?.offset).toBe(3);
  });

  it.each(['typing', 'lines', 'blocks'] as const)('preserves selection replacement, cursor marker and CRLF in %s mode', async (mode) => {
    const { editor, controller } = setup({ 'a.ts': 'left OLD right\r\n' });
    editor.crlf.add(editor.resolvePath('a.ts'));
    controller.setCodePlayback(mode);
    await controller.start();
    await controller.read('a.ts');
    const result = await controller.step([
      { select: { file: 'a.ts', line: 1, text: 'OLD' } },
      { type: `one\r\n  \u{1F600}${CURSOR_MARKER}two` },
    ]);
    expect(result.rejected).toBeUndefined();
    await until(controller.step([]));
    expect(editor.text('a.ts')).toBe('left one\r\n  \u{1F600}two right\r\n');
    expect(editor.cursor?.offset).toBe('left one\r\n  \u{1F600}'.length);
  });

  it('StableDuringChoice, NextActionUsesChoice: snapshots the mode for each typing action, while rehearsal stays instant', async () => {
    const { editor, controller } = setup({ 'a.ts': '' });
    controller.setCodePlayback('lines');
    await controller.start();
    await controller.step([
      { move: { file: 'a.ts', line: 1, to: 'line_end' } },
      { type: `a\nb${CURSOR_MARKER}` },
      { type: `\nc\nd${CURSOR_MARKER}` },
    ]);
    await advance(120);
    expect(editor.text('a.ts')).toBe('a\n');
    controller.setCodePlayback('blocks');
    await until(controller.step([]));
    expect(editor.edits.map((edit) => edit.text)).toEqual(['a\n', 'b', '\nc\nd']);
    expect(editor.text('a.ts')).toBe('a\nb\nc\nd');
  });

  it('PausedBlocksInsert: a paused code countdown blocks the next group', async () => {
    const { editor, controller } = setup({ 'a.ts': '' });
    controller.setCodePlayback('lines');
    await controller.start();
    await controller.step([{ move: { file: 'a.ts', line: 1, to: 'line_end' } }, { type: `a\nb${CURSOR_MARKER}` }]);
    await advance(120);
    expect(editor.text('a.ts')).toBe('a\n');
    controller.pause();
    await advance(2000);
    expect(editor.text('a.ts')).toBe('a\n');
    controller.resume();
    await until(controller.step([]));
    expect(editor.text('a.ts')).toBe('a\nb');
  });

  it('ReadingBlocksInsert: interrupts a code reading pause with the exact suffix', async () => {
    const { editor, controller } = setup({ 'a.ts': '' });
    controller.setCodePlayback('lines');
    await controller.start();
    await controller.step([{ move: { file: 'a.ts', line: 1, to: 'line_end' } }, { type: `a\nb${CURSOR_MARKER}c` }]);
    await advance(120);
    expect(editor.text('a.ts')).toBe('a\n');
    controller.userInterrupt();
    const report = await until(controller.listen());
    expect(report.batches[0]).toMatchObject({ status: 'interrupted', unplayed: [{ type: `b${CURSOR_MARKER}c` }] });
  });

  it.each([
    [{ offset: 0, deleteLength: 3, text: '' }, '', 0],
    [{ offset: 0, deleteLength: 0, text: 'zz' }, 'zzx()', 4],
    [{ offset: 2, deleteLength: 1, text: 'tail' }, 'x(tail', 2],
  ])('MarkerPreserved: user edits during final code reading keep the marker at the transformed position', async (change, text, offset) => {
    const { editor, controller } = setup({ 'a.ts': 'x' });
    controller.setCodePlayback('blocks');
    await controller.start();
    await controller.read('a.ts');
    await controller.step([{ move: { file: 'a.ts', line: 1, to: 'line_end' } }, { type: `(${CURSOR_MARKER})` }]);
    await advance(120);
    expect(editor.text('a.ts')).toBe('x()');
    editor.userEdit('a.ts', change);
    const report = await until(controller.listen());
    expect(report.batches[0]?.unplayed).toBeUndefined();
    expect(editor.text('a.ts')).toBe(text);
    expect(editor.cursor?.offset).toBe(offset);
  });

  it('MarkerPreserved: transforms a marker in an earlier group across a CRLF and Unicode edit', async () => {
    const { editor, controller } = setup({ 'a.ts': '' });
    editor.crlf.add(editor.resolvePath('a.ts'));
    controller.setCodePlayback('lines');
    await controller.start();
    await controller.step([{ move: { file: 'a.ts', line: 1, to: 'line_end' } }, { type: `\u{1F600}${CURSOR_MARKER}\nrest` }]);
    await advance(630);
    expect(editor.text('a.ts')).toBe('\u{1F600}\r\nrest');
    editor.userEdit('a.ts', { offset: 0, deleteLength: 0, text: 'x' });
    const report = await until(controller.listen());
    expect(report.batches[0]?.unplayed).toBeUndefined();
    expect(editor.cursor?.offset).toBe(3);
  });

  it('allows an explicitly acknowledged multi-close move and subsequent edit', async () => {
    const { editor, controller } = setup({ 'a.py': 'x = call((1))\n' });
    await controller.start();
    await controller.read('a.py');
    const first = await controller.step([
      { move: { file: 'a.py', line: 1, at: `x = call((1${CURSOR_MARKER}))` } },
      { move: { to: 'line_end', allow_multiple_closes: true } },
      { type: `,${CURSOR_MARKER}` },
    ]);
    expect(first.rejected).toBeUndefined();
    expect(first.batches).toEqual([]);
    const report = await until(controller.step([]));
    expect(editor.text('a.py')).toBe('x = call((1)),\n');
    expect(report.batches[0]?.status).toBe('completed');
  });

  it('rejects an entire batch when a later line_end would cross multiple closes', async () => {
    const { editor, controller } = setup({ 'a.py': 'x = call((1))\n' });
    await controller.start();
    await controller.read('a.py');
    const report = await controller.step([
      { move: { file: 'a.py', line: 1, at: `x${CURSOR_MARKER} =` } },
      { type: `z${CURSOR_MARKER}` },
      { move: { at: `1${CURSOR_MARKER}))` } },
      { move: { to: 'line_end' } },
      { type: `,${CURSOR_MARKER}` },
    ]);
    expect(report.rejected).toMatchObject({ index: 4, error: { kind: 'invalid_action' } });
    expect(editor.text('a.py')).toBe('x = call((1))\n');
  });

  it('RecoveryBatchIds Unique: keeps IDs distinct when a saved session is resumed', async () => {
    const first = setup({ 'a.ts': '' });
    await first.controller.start();
    await first.controller.step([{ say: 'First.' }]);
    const before = await until(first.controller.step([]));
    const saved = first.controller.saved;
    expect(saved).toBeDefined();
    if (saved === undefined) throw new Error('missing session');
    const second = setup({ 'a.ts': '' });
    second.controller.revive(saved);
    await second.controller.start();
    await second.controller.step([{ say: 'Second.' }]);
    const after = await until(second.controller.step([]));
    expect(before.batches[0]?.id).toBe(1);
    expect(after.batches[0]?.id).toBe(2);
  });

  it('NoEarlyDelivery: defers a reply until the current action finishes, then discards later actions', async () => {
    const { editor, controller } = setup({ 'a.py': '' });
    await controller.start();
    await controller.step([{ move: { file: 'a.py', line: 1, to: 'line_end' } }, { type: `unknown${CURSOR_MARKER}` }, { say: 'Later.' }]);
    await advance(100 + 3 * 100 + 50);
    expect(editor.text('a.py')).toBe('unk');
    controller.userMessage('Wait', undefined, /* defer= */ true);
    const report = await until(controller.listen());
    expect(editor.text('a.py')).toBe('unknown');
    expect(report.events).toContainEqual({ kind: 'message', text: 'Wait' });
    expect(report.batches).toMatchObject([{ status: 'interrupted', unplayed: [{ say: 'Later.' }] }]);
  });

  it('Urgent: a stop interrupts immediately and delivers a previously queued reply first', async () => {
    const { editor, controller } = setup({ 'a.py': '' });
    await controller.start();
    await controller.step([{ move: { file: 'a.py', line: 1, to: 'line_end' } }, { type: `unknown${CURSOR_MARKER}` }]);
    await advance(100 + 3 * 100 + 50);
    controller.userMessage('Wait', undefined, /* defer= */ true);
    controller.userInterrupt();
    const report = await until(controller.listen());
    expect(editor.text('a.py')).toBe('unk');
    expect(report.events).toEqual([{ kind: 'message', text: 'Wait' }, { kind: 'interrupt' }]);
  });

  it('Urgent: a programmer edit stops immediately without losing the queued reply', async () => {
    const { editor, controller } = setup({ 'a.py': '' });
    await controller.start();
    await controller.step([{ move: { file: 'a.py', line: 1, to: 'line_end' } }, { type: `unknown${CURSOR_MARKER}` }]);
    await advance(100 + 3 * 100 + 50);
    controller.userMessage('Wait', undefined, /* defer= */ true);
    editor.userEdit('a.py', { offset: 0, deleteLength: 0, text: '!' });
    const report = await until(controller.listen());
    expect(editor.text('a.py')).toBe('!unk');
    expect(report.events[0]).toEqual({ kind: 'message', text: 'Wait' });
    expect(report.events[1]).toMatchObject({ kind: 'edit', by: 'programmer' });
  });

  it('interrupts within a token, reports its remainder, and discards the queued batch', async () => {
    const { editor, controller } = setup({ 'a.py': '' });
    await controller.start();
    await controller.step([{ move: { file: 'a.py', line: 1, to: 'line_end' } }, { type: `unknown${CURSOR_MARKER}` }]);
    const queued = controller.step([{ say: 'Later.' }]);
    await advance(100 + 3 * 100 + 50);
    expect(editor.text('a.py')).toBe('unk');
    controller.userInterrupt();
    const first = await until(queued);
    const second = await until(controller.listen());
    expect(first.rejected).toBeUndefined();
    expect([...first.batches, ...second.batches]).toMatchObject([
      { status: 'interrupted', unplayed: [{ type: `nown${CURSOR_MARKER}` }] },
      { status: 'discarded' },
    ]);
    expect(editor.text('a.py')).toBe('unk');
  });

  it.each(['type', 'type_fast'] as const)('refuses %s with the cursor inside CRLF before editing', async (kind) => {
    const { editor, controller } = setup({ 'a.ts': 'x\n' });
    await controller.start();
    await controller.read('a.ts');
    const text = `a\r${CURSOR_MARKER}\nb`;
    const action = kind === 'type' ? { type: text } : { type_fast: text };
    const report = await controller.step([{ move: { file: 'a.ts', line: 1, to: 'line_end' } }, action]);
    expect(report.rejected?.error.message).toContain('CRLF');
    expect(editor.text('a.ts')).toBe('x\n');
  });

  it.each([
    ['\n', 'type'],
    ['\r\n', 'type'],
    ['\n', 'type_fast'],
    ['\r\n', 'type_fast'],
  ] as const)('normalizes CRLF and replays the interrupted %s document using %s', async (eol, kind) => {
    const { editor, controller } = setup({ 'a.ts': '' });
    if (eol === '\r\n') editor.crlf.add(editor.resolvePath('a.ts'));
    await controller.start();
    const input = `a\r\nb${CURSOR_MARKER}c\r\nd`;
    await controller.step([{ move: { file: 'a.ts', line: 1, to: 'line_end' } }, kind === 'type' ? { type: input } : { type_fast: input }]);
    const beat = kind === 'type' ? 100 : 10;
    await advance(100 + 3 * beat + beat / 2);
    expect(editor.text('a.ts')).toBe(`a${eol}b`);
    controller.userInterrupt();
    const report = await until(controller.listen());
    const tail = `${CURSOR_MARKER}c\nd`;
    const remaining = kind === 'type' ? { type: tail } : { type_fast: tail };
    expect(report.batches[0]).toMatchObject({ status: 'interrupted', unplayed: [remaining] });
    controller.handBack();
    await controller.read('a.ts');
    const resumed = await until(controller.step([{ move: { file: 'a.ts', line: 2, to: 'line_end' } }, remaining]));
    expect(resumed.rejected).toBeUndefined();
    await until(controller.step([]));
    expect(editor.text('a.ts')).toBe(`a${eol}bc${eol}d`);
    expect(editor.cursor?.offset).toBe(2 + eol.length);
  });

  it('rejects malformed file-naming input at the player boundary without editing', async () => {
    const { editor, controller } = setup({ 'a.ts': 'keep\n' });
    await controller.start();
    // The wire can carry malformed JSON before rehearsal validates it.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const actions = JSON.parse('[{"point":null},{"delete":true}]') as Action[];
    const result = await until(controller.step(actions));
    expect(result.rejected?.error.kind).toBe('invalid_action');
    expect(editor.text('a.ts')).toBe('keep\n');
  });

  it('DeletesTheSelection: replaces a selection by typing, and deletes a selection', async () => {
    const { editor, controller } = setup({ 'a.ts': 'const a = 1\n' });
    await controller.start();
    await controller.read('a.ts');
    await controller.step([{ move: { file: 'a.ts', line: 1, to: 'line_end' } }, { select: { text: '1' } }, { type: `2${CURSOR_MARKER}` }]);
    await until(controller.step([{ select: { file: 'a.ts', text: 'const ' } }, { delete: true }]));
    await until(controller.step([]));
    expect(editor.text('a.ts')).toBe('a = 2\n');
  });

  it('AcceptedOnlyForThatLine: rejects a number from before the lines a queued batch adds above it, and takes one from a `read` after them', async () => {
    const { editor, controller } = setup({ 'a.ts': 'a\nb\n' });
    await controller.start();
    await controller.read('a.ts');
    await controller.step([{ move: { file: 'a.ts', line: 1, to: 'line_end' } }, { type: `\nx${CURSOR_MARKER}` }]);
    // The playing batch moves `b` from line 2 to line 3.
    const stale = await controller.step([{ move: { file: 'a.ts', line: 2, to: 'line_end' } }, { type: `!${CURSOR_MARKER}` }]);
    expect(stale.rejected?.error).toMatchObject({ kind: 'line_not_seen', message: matching(/line 2 reads "x"\.$/) });
    expect((await controller.read('a.ts')).lines.map((l) => l.text)).toEqual(['a', 'x', 'b']);
    const next = await until(controller.step([{ move: { file: 'a.ts', line: 3, to: 'line_end' } }, { type: `!${CURSOR_MARKER}` }]));
    expect(next.rejected).toBeUndefined();
    await until(controller.step([]));
    expect(editor.text('a.ts')).toBe('a\nx\nb!\n');
  });

  it("AcceptedOnlyForThatLine: rejects a report's number that a queued batch has since moved", async () => {
    const { controller } = setup({ 'a.ts': 'a\nb\n' });
    await controller.start();
    await controller.read('a.ts');
    await controller.step([{ move: { file: 'a.ts', line: 2, to: 'line_end' } }, { type: `\nc${CURSOR_MARKER}` }]);
    const first = await until(controller.step([{ move: { file: 'a.ts', line: 1, to: 'line_end' } }, { type: `\nx${CURSOR_MARKER}` }]));
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

  it("EditAtCursorProp, EditRequiresNamed: types and deletes only after naming the cursor's file", async () => {
    const { editor, controller } = setup({ 'a.ts': 'ab\n' });
    await controller.start();
    await controller.read('a.ts');
    const named = await until(controller.step([{ move: { file: 'a.ts', line: 1, to: 'line_end' } }, { type: `c${CURSOR_MARKER}` }]));
    expect(named.rejected).toBeUndefined();
    const unnamed = await until(controller.step([{ type: `d${CURSOR_MARKER}` }]));
    expect(unnamed.rejected?.error.kind).toBe('file_required');
    await until(controller.step([{ move: { file: 'a.ts', line: 1, to: 'line_end' } }, { type: `d${CURSOR_MARKER}` }]));
    const deleted = await until(controller.step([{ select: { file: 'a.ts', line: 1, text: 'b' } }, { delete: true }]));
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

  it('DiscardedMeansNothing: an empty type does not edit when interrupted (specs/Actions.tla)', async () => {
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
    await controller.step([{ move: { file: 'a.ts', line: 1, to: 'line_end' } }, { type: CURSOR_MARKER }, { say: 'Typed.' }]);
    const report = await until(controller.listen());
    expect(report.batches).toMatchObject([{ status: 'interrupted', unplayed: [{ say: 'Typed.' }] }]);
    expect(editor.text('a.ts')).toBe('x\n');
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
    expect(report.batches.map(({ runs, ...batch }) => ({ ...batch, runs: runs?.map(({ id: _id, ...run }) => run) }))).toEqual([
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
    await until(controller.step([{ point: { file: 'a.ts', line: 3, text: '3' } }, { delete: true }]));
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

  it('ReadIsStart: accepts a line a tool inserted, read while a batch that edits no file plays (specs/Rehearsal.tla)', async () => {
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

describe('structural editing across rehearsal and playback', () => {
  it('splits a Python pair identically in rehearsal and the editor', async () => {
    const { editor, controller } = setup({ 'a.py': 'x = {}\n' });
    await controller.start();
    await controller.read('a.py');
    const report = await until(
      controller.step([
        { move: { file: 'a.py', line: 1, at: `x = {${CURSOR_MARKER}}` } },
        { newline: { indent: '    ' } },
        { type: `"answer": 42${CURSOR_MARKER}` },
      ]),
    );
    expect(report.rejected).toBeUndefined();
    await until(controller.step([]));
    expect(editor.text('a.py')).toBe('x = {\n    "answer": 42\n}\n');
  });

  it.each([`message = f"Missing {'value'}"`, `message = f"{aapl['custom_fields']}"`])(
    'ClosedFieldRecovers: splits the assertion after a closed quoted field',
    async (prefix) => {
      const assertion = '    assert {k: aapl[k] for k in aapl if k != "custom_fields"} == {}';
      const { editor, controller } = setup({ 'a.py': `${prefix}\n${assertion}\n` });
      await controller.start();
      await controller.read('a.py');
      const at = assertion.replace('{}', `{${CURSOR_MARKER}}`);
      const report = await until(controller.step([{ move: { file: 'a.py', line: 2, at } }, { newline: { indent: '    ' } }]));
      expect(report.rejected).toBeUndefined();
      await until(controller.step([]));
      expect(editor.text('a.py')).toBe(`${prefix}\n${assertion.replace('{}', '{\n        \n    }')}\n`);
    },
  );

  it('adds structural indentation relative to an already indented line', async () => {
    const { editor, controller } = setup({ 'a.py': '    x = {}\n' });
    await controller.start();
    await controller.read('a.py');
    const report = await until(
      controller.step([
        { move: { file: 'a.py', line: 1, at: `    x = {${CURSOR_MARKER}}` } },
        { newline: { indent: '    ' } },
        { type: `"answer": 42${CURSOR_MARKER}` },
      ]),
    );
    expect(report.rejected).toBeUndefined();
    await until(controller.step([]));
    expect(editor.text('a.py')).toBe('    x = {\n        "answer": 42\n    }\n');
  });

  it('steps past one nested close before typing the following comma', async () => {
    const { editor, controller } = setup({ 'a.py': 'x = ({})\n' });
    await controller.start();
    await controller.read('a.py');
    const report = await until(
      controller.step([
        { move: { file: 'a.py', line: 1, at: `x = ({${CURSOR_MARKER}})` } },
        { move: { to: 'next_close' } },
        { type: `,${CURSOR_MARKER}` },
      ]),
    );
    expect(report.rejected).toBeUndefined();
    await until(controller.step([]));
    expect(editor.text('a.py')).toBe('x = ({},)\n');
  });
});

it('EligibleFinishes, IneligibleKeepsReading: finishes the requested delay without lifting a user pause', async () => {
  const { panel, controller } = setup();
  await controller.start();
  await controller.step([{ say: 'A message to read.' }, { say: 'Next message.' }]);
  await advance(0);
  const event = panel.events.find((entry) => entry.type === 'reading');
  if (event?.type !== 'reading' || event.id === undefined) throw new Error('No reading countdown');
  controller.pause();
  controller.finishReading(event.id);
  await advance(1000);
  expect(panel.says()).toEqual(['A message to read.']);
  controller.resume();
  controller.finishReading(event.id + 1);
  await advance(100);
  expect(panel.says()).toEqual(['A message to read.']);
  controller.finishReading(event.id);
  await advance(0);
  expect(panel.says()).toEqual(['A message to read.', 'Next message.']);
  await until(controller.step([]));
});

function observerThrows(this: unknown): void {
  throw new Error('observer failed');
}

it('preserves the real controller session when a diagnostic observer throws', async () => {
  const { controller } = setup({});
  const observer = vi.fn(observerThrows);
  controller.onDiagnostic = observer;
  const report = await controller.start();
  expect(report.turn).toBe('agent');
  controller.pause('away');
  expect(controller.isPaused).toBe(true);
  controller.resume('away');
  expect(controller.isPaused).toBe(false);
  controller.disconnect();
  expect(controller.isSuspended).toBe(true);
  expect(observer).toHaveBeenCalled();
  expect(observer.mock.contexts.every((receiver) => receiver === controller)).toBe(true);
});
