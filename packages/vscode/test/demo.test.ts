// The scripted demo on its own (#176): how it reads before a batch, sets up its files, and stops when derailed.
// Solitary: the controller is a typed fake, and vscode's window and file system are fakes; the script itself is
// demo.e2e.test.ts's to check, against the real controller.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';
import type { Controller } from '@ai-pair/core';
import type { Report } from '@ai-pair/protocol';
import { INITIAL_SERVER, playDemo, SCRIPT, SERVER, stepScript, TODOS } from '../src/demo';

/** What the mocked vscode records, made before its factory runs. */
const fakes = vi.hoisted(() => ({
  warnings: [] as string[],
  made: [] as string[],
  written: new Map<string, string>(),
  deleted: [] as string[],
  /** Whether deleting the todos file fails, as it does before the demo has written it. */
  missing: false,
}));

vi.mock('vscode', () => ({
  Uri: { file: (fsPath: string) => ({ fsPath }) },
  window: {
    showWarningMessage: (message: string) => {
      fakes.warnings.push(message);
      return Promise.resolve(undefined);
    },
  },
  workspace: {
    fs: {
      createDirectory: (uri: { fsPath: string }) => {
        fakes.made.push(uri.fsPath);
        return Promise.resolve();
      },
      writeFile: (uri: { fsPath: string }, data: Uint8Array) => {
        fakes.written.set(uri.fsPath, new TextDecoder().decode(data));
        return Promise.resolve();
      },
      delete: (uri: { fsPath: string }) => {
        if (fakes.missing) return Promise.reject(new Error('ENOENT'));
        fakes.deleted.push(uri.fsPath);
        return Promise.resolve();
      },
    },
  },
}));

/** A report with nothing in it but one completed batch. */
const DONE: Report = { batches: [{ id: 1, status: 'completed' }], events: [], turn: 'agent' };

/** The demo's closing words, as playDemo ends the session with them. */
const SUMMARY =
  "That's the demo: the direction first, then one path end to end, then broadening one case at a time. Updating and deleting would follow the same cycle.";

/** Returns a controller fake that is idle, and answers every step with `DONE`. */
function idle(): ReturnType<typeof mock<Controller>> {
  const controller = mock<Controller>();
  Object.defineProperty(controller, 'isActive', { value: false });
  controller.start.mockResolvedValue(DONE);
  controller.step.mockResolvedValue(DONE);
  controller.read.mockResolvedValue({ file: 'f', dirty: false, lines: [] });
  controller.end.mockResolvedValue(DONE);
  return controller;
}

beforeEach(() => {
  fakes.missing = false;
});

afterEach(() => {
  vi.restoreAllMocks();
  fakes.warnings.length = 0;
  fakes.made.length = 0;
  fakes.written.clear();
  fakes.deleted.length = 0;
});

describe('stepScript', () => {
  it('reads the file a batch works in before a batch that gives a line, as an agent does, and keeps it for the next', async () => {
    const controller = idle();
    const current: { file?: string } = {};
    await stepScript(controller, [{ move: { file: 'a.ts', line: 2, to: 'line_end' } }], current);
    expect(controller.read.mock.lastCall).toEqual(['a.ts']);
    expect(current.file).toBe('a.ts');
    await stepScript(controller, [{ select: { line: 1, text: 'x' } }], current);
    expect(controller.read.mock.lastCall).toEqual(['a.ts']);
    await stepScript(controller, [{ point: { file: 'b.ts', line: 1, text: 'y' } }], current);
    expect(controller.read.mock.lastCall).toEqual(['b.ts']);
    expect(controller.step.mock.calls).toHaveLength(3);
  });

  it("reads nothing for a batch without a line, or before any file, and goes on when the file isn't there yet", async () => {
    const controller = idle();
    await stepScript(controller, [{ move: { line: 1, to: 'line_end' } }], {});
    await stepScript(controller, [{ say: 'Hi.' }, { type: 'x' }], { file: 'a.ts' });
    expect(controller.read.mock.calls).toEqual([]);
    controller.read.mockRejectedValueOnce(new Error('a.ts does not exist'));
    expect(await stepScript(controller, [{ move: { file: 'a.ts', line: 1, to: 'line_end' } }], {})).toBe(DONE);
  });
});

describe('playDemo', () => {
  it('says a session is already active, and plays nothing', async () => {
    const controller = mock<Controller>();
    Object.defineProperty(controller, 'isActive', { value: true });
    await playDemo(controller, '/w');
    expect(fakes.warnings).toEqual(['A pairing session is already active.']);
    expect(controller.start.mock.calls).toEqual([]);
  });

  it('writes the server fresh, deletes the todos, plays every batch, and ends with its summary', async () => {
    const controller = idle();
    await playDemo(controller, '/w');
    expect(fakes.made).toEqual(['/w/ai-pair-demo/src']);
    expect(fakes.written.get(`/w/${SERVER}`)).toBe(INITIAL_SERVER);
    expect(fakes.deleted).toEqual([`/w/${TODOS}`]);
    expect(controller.start.mock.calls).toContainEqual(['Demo: add a todos API to an Express app']);
    // Every batch of the script, then the empty one that collects the last report.
    expect(controller.step.mock.calls).toHaveLength(SCRIPT.length + 1);
    expect(controller.step.mock.lastCall).toEqual([[]]);
    expect(controller.end.mock.calls).toContainEqual([SUMMARY]);
  });

  it('goes on when there are no todos yet to delete', async () => {
    fakes.missing = true;
    const controller = idle();
    await playDemo(controller, '/w');
    expect(controller.end.mock.calls).toContainEqual([SUMMARY]);
  });

  it.each<{ name: string; derailing: Partial<Report> }>([
    { name: 'an event', derailing: { events: [{ kind: 'interrupt' }] } },
    { name: 'a rejection', derailing: { rejected: { index: 1, action: { say: 'x' }, error: { kind: 'invalid_action', message: 'No.' } } } },
    { name: 'a batch that did not complete', derailing: { batches: [{ id: 1, status: 'discarded' }] } },
  ])('stops early, saying why, after $name', async ({ derailing }) => {
    const controller = idle();
    controller.step.mockResolvedValueOnce({ ...DONE, ...derailing });
    await playDemo(controller, '/w');
    expect(controller.step.mock.calls).toHaveLength(2);
    expect(controller.step.mock.lastCall).toEqual([[{ say: "I'm a scripted demo, so I can't adapt to that. Let's stop here." }]]);
    expect(controller.end.mock.calls).toContainEqual([]);
  });

  it('stops early after the last report too, when it says the programmer derailed it', async () => {
    const controller = idle();
    for (const [i] of SCRIPT.entries()) {
      controller.step.mockResolvedValueOnce({ ...DONE, batches: [{ id: i, status: 'completed' }] });
    }
    controller.step.mockResolvedValueOnce({ ...DONE, events: [{ kind: 'interrupt' }] });
    await playDemo(controller, '/w');
    expect(controller.step.mock.calls).toHaveLength(SCRIPT.length + 2);
    expect(controller.end.mock.calls).toEqual([[]]);
  });

  it('stops without a word when the programmer ended the session, after a batch or after the last report', async () => {
    const ended: Report = { ...DONE, events: [{ kind: 'end' }] };
    const early = idle();
    early.step.mockResolvedValueOnce(ended);
    await playDemo(early, '/w');
    expect(early.step.mock.calls).toHaveLength(1);
    expect(early.end.mock.calls).toEqual([]);
    const late = idle();
    for (const [i] of SCRIPT.entries()) {
      late.step.mockResolvedValueOnce({ ...DONE, batches: [{ id: i, status: 'completed' }] });
    }
    late.step.mockResolvedValueOnce(ended);
    await playDemo(late, '/w');
    expect(late.end.mock.calls).toEqual([]);
  });

  it('logs and stops when the session was ended or replaced under it', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const controller = idle();
    controller.start.mockRejectedValueOnce(new Error('session_active'));
    await playDemo(controller, '/w');
    expect(logged).toHaveBeenCalledWith('AI Pair demo stopped:', new Error('session_active'));
  });
});
