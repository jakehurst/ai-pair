// The agent's `run` commands in VS Code terminals (specs/Terminals.tla). Solitary: the vscode module is a fake whose
// terminals, shell integration, and events the test drives; core's samePath and output.ts are mocks, outcomeOf
// handing back what it was given.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { samePath } from '@ai-pair/core';
import { outcomeOf, Tail } from '../src/output';
import { PairTerminals } from '../src/terminal';

/** What the mocked modules share with the tests, made before the `vi.mock` factories run. */
const fakes = vi.hoisted(() => {
  /** A command's execution, as shell integration gives it: its output stream, which the test sets. */
  class FakeExecution {
    output: string[] = [];
    fails = false;
    /** Holds the stream until the test releases it, as a command's output comes while it runs. */
    readonly released = Promise.withResolvers<void>();
    async *read(): AsyncIterable<string> {
      await this.released.promise;
      for (const data of this.output) {
        yield data;
      }
      if (this.fails) {
        throw new Error('The terminal closed.');
      }
    }
  }

  /** A terminal, faked: whether it has shell integration, and what it was asked to run. */
  class FakeTerminal {
    readonly show = vi.fn();
    readonly sendText = vi.fn();
    readonly state: { shell: string | undefined } = { shell: 'zsh' };
    exitStatus: { code: number } | undefined = undefined;
    shellIntegration: { cwd?: { fsPath: string }; executeCommand: (command: string) => FakeExecution } | undefined;
    readonly executions: FakeExecution[] = [];

    constructor(
      readonly options: { cwd: string },
      integrated: boolean,
    ) {
      this.shellIntegration = integrated ? this.integration() : undefined;
    }

    /** Returns shell integration for this terminal. */
    integration(): { executeCommand: (command: string) => FakeExecution } {
      return {
        executeCommand: () => {
          const made = new FakeExecution();
          this.executions.push(made);
          return made;
        },
      };
    }
  }

  return {
    FakeTerminal,
    FakeExecution,
    /** Whether the next terminal has shell integration from the start. */
    integrated: true,
    terminals: [] as FakeTerminal[],
    /** The listeners each event has, by its name. */
    listeners: new Map<string, Set<(value: unknown) => void>>(),
  };
});

/** How long `run` waits for a command before it returns with the command still running. */
const WAIT_MS = 1000;

/** How long a new terminal gets to report shell integration, as terminal.ts has it. */
const SHELL_INTEGRATION_MS = 5000;

/** How long the output gets to drain after the command ends, as terminal.ts has it. */
const DRAIN_MS = 500;

/** Returns an event's registration: it adds the listener, and its disposable takes it away. */
function event(name: string): (listener: (value: unknown) => void) => { dispose: () => void } {
  return (listener) => {
    const set = fakes.listeners.get(name) ?? new Set();
    set.add(listener);
    fakes.listeners.set(name, set);
    return {
      dispose: () => {
        set.delete(listener);
      },
    };
  };
}

vi.mock('vscode', () => ({
  ThemeIcon: class {
    constructor(readonly id: string) {}
  },
  window: {
    onDidCloseTerminal: event('close'),
    onDidChangeTerminalShellIntegration: event('integration'),
    onDidEndTerminalShellExecution: event('end'),
    createTerminal: (options: { cwd: string }) => {
      const terminal = new fakes.FakeTerminal(options, fakes.integrated);
      fakes.terminals.push(terminal);
      return terminal;
    },
  },
}));
vi.mock('@ai-pair/core', () => ({ samePath: vi.fn((a: string, b: string) => a === b) }));
vi.mock('../src/output', () => ({
  MAX_OUTPUT: 10,
  Tail: vi.fn(
    class {
      readonly pushed: string[] = [];
      push(data: string): void {
        this.pushed.push(data);
      }
    },
  ),
  outcomeOf: vi.fn((output: unknown, run: unknown) => ({ output: 'outcome', given: { output, run } })),
}));

/** Fires event `name` with `value`. */
function fire(name: string, value: unknown): void {
  for (const listener of fakes.listeners.get(name) ?? []) {
    listener(value);
  }
}

/** Returns the terminal made last. */
function lastTerminal(): InstanceType<typeof fakes.FakeTerminal> {
  const made = fakes.terminals.at(-1);
  if (made === undefined) {
    throw new Error('No terminal was made.');
  }
  return made;
}

/** Returns the last execution in the terminal made last. */
function lastExecution(): InstanceType<typeof fakes.FakeExecution> {
  const made = lastTerminal().executions.at(-1);
  if (made === undefined) {
    throw new Error('No command was executed.');
  }
  return made;
}

/** Returns what outcomeOf was last given: the tail's pushes, and the run. */
function given(): {
  pushed: string[];
  run: { shell: string | undefined; finished: boolean; exitCode: () => number | undefined; ended: Promise<void> };
} {
  const [output, ran] = vi.mocked(outcomeOf).mock.calls.at(-1) ?? [];
  // The mocked Tail and the run outcomeOf is handed, of these types.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return { pushed: (output as unknown as { pushed: string[] }).pushed, run: ran as never };
}

/** Runs `command` in `cwd`, and returns the promise of its outcome. */
function runIn(terminals: PairTerminals, command: string, signal = new AbortController().signal, cwd = '/p'): Promise<unknown> {
  return terminals.run(command, { cwd, waitMs: WAIT_MS, signal });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  fakes.terminals.length = 0;
  fakes.listeners.clear();
  fakes.integrated = true;
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('run', () => {
  it("RunReturns, SkipAborted: doesn't wait for shell integration once playback is interrupted, and starts nothing", async () => {
    expect(await runIn(new PairTerminals(), 'npm test', AbortSignal.abort())).toEqual({ output: '', notStarted: true });
    expect(lastTerminal().executions).toEqual([]);
    expect(lastTerminal().show).toHaveBeenCalledWith(/* preserveFocus= */ true);
  });

  it('RunReturns, ExecuteCommand, End: runs the command, reads its output, and reports how it ended, with its shell', async () => {
    const outcome = runIn(new PairTerminals(), 'npm test');
    await vi.advanceTimersByTimeAsync(0);
    lastExecution().output = ['ok', '\n'];
    fire('end', { execution: new fakes.FakeExecution(), exitCode: 9 });
    fire('end', { execution: lastExecution(), exitCode: 0 });
    await vi.advanceTimersByTimeAsync(DRAIN_MS);
    expect(await outcome).toMatchObject({ output: 'outcome' });
    const { pushed, run: ran } = given();
    expect([ran.shell, ran.finished, ran.exitCode()]).toEqual(['zsh', true, 0]);
    expect(vi.mocked(Tail).mock.calls).toEqual([[10 * 4]]);
    expect(pushed).toEqual([]);
  });

  it('drains the output after the command ends, for at most DRAIN_MS, and takes a read the closing terminal cut short', async () => {
    const terminals = new PairTerminals();
    const outcome = runIn(terminals, 'npm test');
    await vi.advanceTimersByTimeAsync(0);
    const first = lastExecution();
    first.output = ['a', 'b'];
    first.fails = true;
    first.released.resolve();
    fire('end', { execution: first, exitCode: 1 });
    await vi.advanceTimersByTimeAsync(DRAIN_MS);
    await outcome;
    expect(given().pushed).toEqual(['a', 'b']);
  });

  it('RunReturns, StopWaiting: returns with the command still running when the wait is over, or playback is interrupted', async () => {
    const terminals = new PairTerminals();
    const waited = runIn(terminals, 'npm run watch');
    await vi.advanceTimersByTimeAsync(WAIT_MS);
    await waited;
    expect(given().run.finished).toBe(false);
    const abort = new AbortController();
    const interrupted = runIn(terminals, 'npm run serve', abort.signal);
    await vi.advanceTimersByTimeAsync(0);
    abort.abort();
    await interrupted;
    expect(given().run.finished).toBe(false);
  });

  it('RunReturns, CloseTerminal: ends the wait when the programmer closes the terminal, and not for another terminal', async () => {
    const outcome = runIn(new PairTerminals(), 'npm test');
    await vi.advanceTimersByTimeAsync(0);
    fire('close', new fakes.FakeTerminal({ cwd: '/' }, true));
    fire('close', lastTerminal());
    await vi.advanceTimersByTimeAsync(DRAIN_MS);
    await outcome;
    expect(given().run.exitCode()).toBeUndefined();
  });

  it('RunReturns, SendText: waits for shell integration to come, for this terminal only, and types the command in without it', async () => {
    fakes.integrated = false;
    const terminals = new PairTerminals();
    const late = runIn(terminals, 'npm test');
    await vi.advanceTimersByTimeAsync(0);
    const waiting = lastTerminal();
    fire('integration', { terminal: new fakes.FakeTerminal({ cwd: '/' }, true), shellIntegration: undefined });
    fire('integration', { terminal: waiting, shellIntegration: waiting.integration() });
    await vi.advanceTimersByTimeAsync(0);
    fire('end', { execution: lastExecution(), exitCode: 0 });
    await vi.advanceTimersByTimeAsync(DRAIN_MS);
    expect(await late).toMatchObject({ output: 'outcome' });
    const typed = runIn(terminals, 'ls', undefined, '/q');
    await vi.advanceTimersByTimeAsync(SHELL_INTEGRATION_MS);
    expect(await typed).toEqual({ output: '[output not captured: this terminal has no shell integration]' });
    expect(lastTerminal().sendText).toHaveBeenCalledWith('ls');
  });

  it('AbortBeforeStart: starts nothing when playback is interrupted while it waits for shell integration', async () => {
    fakes.integrated = false;
    const abort = new AbortController();
    const outcome = runIn(new PairTerminals(), 'npm test', abort.signal);
    await vi.advanceTimersByTimeAsync(0);
    abort.abort();
    expect(await outcome).toEqual({ output: '', notStarted: true });
  });
});

describe('acquire', () => {
  it("NoReuseWhileBusy: gives a second command a new terminal while the first one's command still runs", async () => {
    const terminals = new PairTerminals();
    const first = runIn(terminals, 'npm run watch');
    await vi.advanceTimersByTimeAsync(WAIT_MS);
    await first;
    const second = runIn(terminals, 'npm test');
    await vi.advanceTimersByTimeAsync(WAIT_MS);
    await second;
    expect(fakes.terminals).toHaveLength(2);
  });

  it("FreedAfterEnd, Exit: reuses a terminal once its command ends, in the folder it's in, and not one whose shell exited", async () => {
    const terminals = new PairTerminals();
    const first = runIn(terminals, 'npm run build');
    await vi.advanceTimersByTimeAsync(0);
    fire('end', { execution: lastExecution(), exitCode: 0 });
    await vi.advanceTimersByTimeAsync(DRAIN_MS);
    await first;
    const reused = runIn(terminals, 'npm test');
    await vi.advanceTimersByTimeAsync(0);
    expect(fakes.terminals).toHaveLength(1);
    fire('end', { execution: lastExecution(), exitCode: 0 });
    await vi.advanceTimersByTimeAsync(DRAIN_MS);
    await reused;
    const only = lastTerminal();
    if (only.shellIntegration) {
      only.shellIntegration.cwd = { fsPath: '/q' };
    }
    const moved = runIn(terminals, 'ls', undefined, '/q');
    await vi.advanceTimersByTimeAsync(0);
    expect(fakes.terminals).toHaveLength(1);
    fire('end', { execution: lastExecution(), exitCode: 0 });
    await vi.advanceTimersByTimeAsync(DRAIN_MS);
    await moved;
    only.exitStatus = { code: 0 };
    void runIn(terminals, 'ls', undefined, '/q');
    await vi.advanceTimersByTimeAsync(0);
    expect(fakes.terminals).toHaveLength(2);
    expect(samePath).toHaveBeenCalled();
  });

  it('CloseTerminal: forgets a terminal the programmer closes, and ignores the close of one it never made', async () => {
    const terminals = new PairTerminals();
    const first = runIn(terminals, 'npm run build');
    await vi.advanceTimersByTimeAsync(0);
    fire('end', { execution: lastExecution(), exitCode: 0 });
    await vi.advanceTimersByTimeAsync(DRAIN_MS);
    await first;
    fire('close', new fakes.FakeTerminal({ cwd: '/' }, true));
    fire('close', lastTerminal());
    void runIn(terminals, 'npm test');
    await vi.advanceTimersByTimeAsync(0);
    expect(fakes.terminals).toHaveLength(2);
  });

  it('disposes of its listener for closed terminals', () => {
    const terminals = new PairTerminals();
    expect(fakes.listeners.get('close')?.size).toBe(1);
    terminals.dispose();
    expect(fakes.listeners.get('close')?.size).toBe(0);
  });
});
