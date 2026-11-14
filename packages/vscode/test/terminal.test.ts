// The agent's `run` commands in VS Code terminals (specs/Terminals.tla). Solitary: the vscode module is a fake whose
// terminals, shell integration, and events the test drives; core's samePath and output.ts are mocks, outcomeOf
// handing back what it was given.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reportDiagnostic, samePath } from '@ai-pair/core';
import { outcomeOf, Tail } from '../src/output';
import { PairTerminals, commandForShell } from '../src/terminal';

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
    readonly dispose = vi.fn();
    readonly sendText = vi.fn();
    readonly state: { shell: string | undefined } = { shell: 'zsh' };
    exitStatus: { code: number } | undefined = undefined;
    shellIntegration: { cwd?: { fsPath: string }; executeCommand: (command: string) => FakeExecution } | undefined;
    readonly executions: FakeExecution[] = [];

    constructor(
      readonly options: { cwd: string; hideFromUser?: boolean },
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
    failCreate: false,
    onStateSubscribe: undefined as (() => void) | undefined,
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
    onDidStartTerminalShellExecution: event('start'),
    onDidChangeTerminalShellIntegration: event('integration'),
    onDidChangeTerminalState: (listener: (value: unknown) => void) => {
      const subscription = event('state')(listener);
      fakes.onStateSubscribe?.();
      return subscription;
    },
    onDidEndTerminalShellExecution: event('end'),
    createTerminal: (options: { cwd: string; hideFromUser?: boolean }) => {
      if (fakes.failCreate) throw new Error('private creation error');
      const terminal = new fakes.FakeTerminal(options, fakes.integrated);
      fakes.terminals.push(terminal);
      return terminal;
    },
  },
}));
vi.mock('@ai-pair/core', () => ({
  samePath: vi.fn((a: string, b: string) => a === b),
  reportDiagnostic: vi.fn((observer: ((diagnosticEvent: unknown) => void) | undefined, diagnosticEvent: unknown, receiver: unknown) =>
    observer?.call(receiver, diagnosticEvent),
  ),
}));
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
  run: { shell: string | undefined; finished: boolean; exitCode: () => number | undefined; closed: () => boolean; ended: Promise<void> };
} {
  const [output, ran] = vi.mocked(outcomeOf).mock.calls.at(-1) ?? [];
  // The mocked Tail and the run outcomeOf is handed, of these types.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return { pushed: (output as unknown as { pushed: string[] }).pushed, run: ran as never };
}

/** Runs `command` in `cwd`, and returns the promise of its outcome. */
function runIn(terminals: PairTerminals, command: string, signal = new AbortController().signal, cwd = '/p'): Promise<unknown> {
  return terminals.run(command, { id: 1, cwd, waitMs: WAIT_MS, signal });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  fakes.terminals.length = 0;
  fakes.listeners.clear();
  fakes.integrated = true;
  fakes.failCreate = false;
  fakes.onStateSubscribe = undefined;
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('run', () => {
  it('waits for delayed Bash identity before submitting multiline input', async () => {
    const terminals = new PairTerminals(() => false);
    const promise = runIn(terminals, 'printf a\nprintf b');
    const terminal = lastTerminal();
    terminal.state.shell = undefined;
    const integration = terminal.shellIntegration;
    if (!integration) throw new Error('Missing integration');
    const submit = vi.spyOn(integration, 'executeCommand');
    await vi.advanceTimersByTimeAsync(0);
    expect(submit).not.toHaveBeenCalled();
    const other = new fakes.FakeTerminal({ cwd: '/other' }, true);
    fire('state', other);
    fire('close', other);
    fire('state', terminal);
    expect(submit).not.toHaveBeenCalled();
    const queued = [...(fakes.listeners.get('state') ?? [])][0];
    terminal.state.shell = 'bash';
    fire('state', terminal);
    queued?.(terminal);
    await vi.advanceTimersByTimeAsync(0);
    expect(submit).toHaveBeenCalledWith(commandForShell('printf a\nprintf b', 'bash'));
    expect(fakes.listeners.get('state')?.size ?? 0).toBe(0);
    fire('end', { execution: lastExecution(), exitCode: 0 });
    await vi.advanceTimersByTimeAsync(DRAIN_MS);
    await promise;
  });

  it('submits unchanged after the shell identity wait expires', async () => {
    const terminals = new PairTerminals(() => false);
    const promise = runIn(terminals, 'printf a\nprintf b');
    const terminal = lastTerminal();
    terminal.state.shell = undefined;
    const integration = terminal.shellIntegration;
    if (!integration) throw new Error('Missing integration');
    const submit = vi.spyOn(integration, 'executeCommand');
    await vi.advanceTimersByTimeAsync(499);
    expect(submit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(submit).toHaveBeenCalledWith('printf a\nprintf b');
    expect(fakes.listeners.get('state')?.size ?? 0).toBe(0);
    fire('end', { execution: lastExecution(), exitCode: 0 });
    await vi.advanceTimersByTimeAsync(DRAIN_MS);
    await promise;
  });

  it('does not submit a multiline command interrupted while shell identity is pending', async () => {
    const terminals = new PairTerminals(() => false);
    const abort = new AbortController();
    const promise = runIn(terminals, 'printf a\nprintf b', abort.signal);
    const terminal = lastTerminal();
    terminal.state.shell = undefined;
    const integration = terminal.shellIntegration;
    if (!integration) throw new Error('Missing integration');
    const submit = vi.spyOn(integration, 'executeCommand');
    await vi.advanceTimersByTimeAsync(0);
    abort.abort();
    await expect(promise).resolves.toEqual({ output: '', notStarted: true });
    expect(submit).not.toHaveBeenCalled();
    expect(fakes.listeners.get('state')?.size ?? 0).toBe(0);
  });

  it('does not submit a multiline command when its terminal closes during identification', async () => {
    const terminals = new PairTerminals(() => false);
    const promise = runIn(terminals, 'printf a\nprintf b');
    const terminal = lastTerminal();
    terminal.state.shell = undefined;
    const integration = terminal.shellIntegration;
    if (!integration) throw new Error('Missing integration');
    const submit = vi.spyOn(integration, 'executeCommand');
    await vi.advanceTimersByTimeAsync(0);
    terminal.exitStatus = { code: 0 };
    fire('close', terminal);
    await expect(promise).rejects.toThrow('Terminal closed before command submission');
    expect(submit).not.toHaveBeenCalled();
  });

  it('notices terminal closure while subscribing to shell state', async () => {
    const terminals = new PairTerminals(() => false);
    const promise = runIn(terminals, 'printf a\nprintf b');
    const terminal = lastTerminal();
    terminal.state.shell = undefined;
    fakes.onStateSubscribe = () => {
      terminal.exitStatus = { code: 0 };
    };
    await expect(promise).rejects.toThrow('Terminal closed before command submission');
    expect(terminal.executions).toHaveLength(0);
  });

  it('notices interruption while subscribing to shell state', async () => {
    const terminals = new PairTerminals(() => false);
    const abort = new AbortController();
    const promise = runIn(terminals, 'printf a\nprintf b', abort.signal);
    const terminal = lastTerminal();
    terminal.state.shell = undefined;
    fakes.onStateSubscribe = () => {
      abort.abort();
    };
    await expect(promise).resolves.toEqual({ output: '', notStarted: true });
    expect(terminal.executions).toHaveLength(0);
  });

  it('rechecks shell identity and cancellation when the terminal state changes at entry', async () => {
    const terminals = new PairTerminals(() => false);
    const abort = new AbortController();
    const promise = runIn(terminals, 'printf a\nprintf b', abort.signal);
    const terminal = lastTerminal();
    Object.defineProperty(terminal.state, 'shell', {
      get() {
        abort.abort();
        return undefined;
      },
    });
    await expect(promise).resolves.toEqual({ output: '', notStarted: true });
    expect(terminal.executions).toHaveLength(0);
  });

  it('does not submit when the terminal closes as identity checking starts', async () => {
    const terminals = new PairTerminals(() => false);
    const promise = runIn(terminals, 'printf a\nprintf b');
    const terminal = lastTerminal();
    Object.defineProperty(terminal.state, 'shell', {
      get() {
        terminal.exitStatus = { code: 0 };
        return undefined;
      },
    });
    await expect(promise).rejects.toThrow('Terminal closed before command submission');
    expect(terminal.executions).toHaveLength(0);
  });

  it('uses identity observed on the second immediate shell-state read', async () => {
    const terminals = new PairTerminals(() => false);
    const promise = runIn(terminals, 'printf a\nprintf b');
    const terminal = lastTerminal();
    let reads = 0;
    Object.defineProperty(terminal.state, 'shell', {
      get() {
        return ++reads === 1 ? undefined : 'bash';
      },
    });
    const integration = terminal.shellIntegration;
    if (!integration) throw new Error('Missing integration');
    const submit = vi.spyOn(integration, 'executeCommand');
    await vi.advanceTimersByTimeAsync(0);
    expect(submit).toHaveBeenCalledWith(commandForShell('printf a\nprintf b', 'bash'));
    fire('end', { execution: lastExecution(), exitCode: 0 });
    await vi.advanceTimersByTimeAsync(DRAIN_MS);
    await promise;
  });

  it('submits known non-Bash multiline input immediately without wrapping', async () => {
    const terminals = new PairTerminals(() => false);
    const promise = runIn(terminals, 'printf a\nprintf b');
    const integration = lastTerminal().shellIntegration;
    if (!integration) throw new Error('Missing integration');
    const submit = vi.spyOn(integration, 'executeCommand');
    await vi.advanceTimersByTimeAsync(0);
    expect(submit).toHaveBeenCalledWith('printf a\nprintf b');
    fire('end', { execution: lastExecution(), exitCode: 0 });
    await vi.advanceTimersByTimeAsync(DRAIN_MS);
    await promise;
  });

  it('observes shell identity that arrives while the state listener is registered', async () => {
    const terminals = new PairTerminals(() => false);
    const promise = runIn(terminals, 'printf a\nprintf b');
    const terminal = lastTerminal();
    terminal.state.shell = undefined;
    const integration = terminal.shellIntegration;
    if (!integration) throw new Error('Missing integration');
    const submit = vi.spyOn(integration, 'executeCommand');
    fakes.onStateSubscribe = () => {
      terminal.state.shell = 'bash';
    };
    await vi.advanceTimersByTimeAsync(0);
    expect(submit).toHaveBeenCalledWith(commandForShell('printf a\nprintf b', 'bash'));
    expect(fakes.listeners.get('state')?.size ?? 0).toBe(0);
    fire('end', { execution: lastExecution(), exitCode: 0 });
    await vi.advanceTimersByTimeAsync(DRAIN_MS);
    await promise;
  });

  it('does not wait for shell identity for a single-line command', async () => {
    const terminals = new PairTerminals(() => false);
    const promise = runIn(terminals, 'printf a');
    const terminal = lastTerminal();
    terminal.state.shell = undefined;
    const integration = terminal.shellIntegration;
    if (!integration) throw new Error('Missing integration');
    const submit = vi.spyOn(integration, 'executeCommand');
    await vi.advanceTimersByTimeAsync(0);
    expect(submit).toHaveBeenCalledWith('printf a');
    fire('end', { execution: lastExecution(), exitCode: 0 });
    await vi.advanceTimersByTimeAsync(DRAIN_MS);
    await promise;
  });

  it('records terminal creation failure without its error text', async () => {
    fakes.failCreate = true;
    const events: unknown[] = [];
    const terminals = new PairTerminals(
      () => false,
      (entry) => {
        events.push(entry);
      },
    );
    await expect(runIn(terminals, 'private command')).rejects.toThrow('private creation error');
    expect(events).toContainEqual({ kind: 'command', id: 1, phase: 'failed' });
    expect(JSON.stringify(events)).not.toContain('private');
  });

  it('records timeout and a later end without inventing an exit code', async () => {
    const events: unknown[] = [];
    const terminals = new PairTerminals(
      () => false,
      (entry) => {
        events.push(entry);
      },
    );
    const result = runIn(terminals, 'slow');
    await vi.advanceTimersByTimeAsync(WAIT_MS);
    await result;
    expect(events).toContainEqual({ kind: 'command', id: 1, phase: 'timeout' });
    fire('end', { execution: lastExecution(), exitCode: undefined });
    await vi.advanceTimersByTimeAsync(0);
    expect(events).toContainEqual({ kind: 'command', id: 1, phase: 'end' });
  });

  it('records execution failures without changing the thrown error', async () => {
    const events: unknown[] = [];
    const terminals = new PairTerminals(
      () => false,
      (entry) => {
        events.push(entry);
      },
    );
    const result = runIn(terminals, 'private command');
    const integration = lastTerminal().shellIntegration;
    if (!integration) throw new Error('Missing integration');
    integration.executeCommand = () => {
      throw new Error('private error');
    };
    await expect(result).rejects.toThrow('private error');
    expect(events).toContainEqual({ kind: 'command', id: 1, phase: 'failed' });
    expect(JSON.stringify(events)).not.toContain('private');
  });

  it('delegates diagnostics with its observer and terminal owner as receiver', async () => {
    let terminals: PairTerminals;
    const observer = vi.fn(function (this: PairTerminals) {
      expect(this).toBe(terminals);
    });
    terminals = new PairTerminals(() => false, observer);
    const result = runIn(terminals, 'printf ok');
    await vi.advanceTimersByTimeAsync(0);
    fire('end', { execution: lastExecution(), exitCode: 0 });
    await vi.advanceTimersByTimeAsync(DRAIN_MS);
    await expect(result).resolves.toMatchObject({ output: 'outcome' });
    expect(reportDiagnostic).toHaveBeenCalledWith(observer, expect.anything(), terminals);
  });

  it('emits typed command start and end without command text', async () => {
    const events: unknown[] = [];
    const terminals = new PairTerminals(
      () => false,
      (entry) => {
        events.push(entry);
      },
    );
    const result = runIn(terminals, 'private command');
    await vi.advanceTimersByTimeAsync(0);
    fire('end', { execution: lastExecution(), exitCode: 3 });
    await vi.advanceTimersByTimeAsync(DRAIN_MS);
    await result;
    expect(events).toEqual([
      { kind: 'command', id: 1, phase: 'requested', waitMs: WAIT_MS },
      { kind: 'command', id: 1, phase: 'integration', available: true },
      { kind: 'command', id: 1, phase: 'start' },
      { kind: 'command', id: 1, phase: 'end', exitCode: 3 },
    ]);
  });

  it('runs quietly and reveals only the owned terminal on request', async () => {
    const terminals = new PairTerminals(() => false);
    const outcome = runIn(terminals, 'printf ok');
    await vi.advanceTimersByTimeAsync(0);
    const terminal = lastTerminal();
    expect(terminal.show).not.toHaveBeenCalled();
    expect(terminal.options.hideFromUser).toBe(true);
    expect(terminals.showTerminal(1)).toBe(true);
    expect(terminal.show).toHaveBeenCalledWith(true);
    expect(terminals.showTerminal(99)).toBe(false);
    fire('end', { execution: lastExecution(), exitCode: 0 });
    await vi.advanceTimersByTimeAsync(DRAIN_MS);
    await outcome;
  });

  it('protects a terminal if another execution starts, while recognizing its own execution', async () => {
    const terminals = new PairTerminals(() => false);
    const first = runIn(terminals, 'one');
    await vi.advanceTimersByTimeAsync(0);
    const owned = lastTerminal();
    const execution = lastExecution();
    fire('start', { terminal: new fakes.FakeTerminal({ cwd: '/elsewhere' }, true), execution: new fakes.FakeExecution() });
    fire('start', { terminal: owned, execution });
    fire('end', { execution, exitCode: 0 });
    await vi.advanceTimersByTimeAsync(DRAIN_MS);
    await first;
    const second = runIn(terminals, 'two');
    await vi.advanceTimersByTimeAsync(0);
    expect(fakes.terminals).toHaveLength(1);
    fire('start', { terminal: owned, execution: new fakes.FakeExecution() });
    fire('end', { execution: lastExecution(), exitCode: 0 });
    await vi.advanceTimersByTimeAsync(DRAIN_MS);
    await second;
    void runIn(terminals, 'three');
    await vi.advanceTimersByTimeAsync(0);
    expect(fakes.terminals).toHaveLength(2);
  });

  it('pending output drain prevents reuse', async () => {
    const terminals = new PairTerminals(() => false);
    const first = runIn(terminals, 'one');
    await vi.advanceTimersByTimeAsync(0);
    fire('end', { execution: lastExecution(), exitCode: 0 });
    await vi.advanceTimersByTimeAsync(0);
    const second = runIn(terminals, 'two');
    await vi.advanceTimersByTimeAsync(0);
    expect(fakes.terminals).toHaveLength(2);
    fire('end', { execution: lastExecution(), exitCode: 0 });
    await vi.advanceTimersByTimeAsync(DRAIN_MS);
    await Promise.all([first, second]);
  });

  it('StartRespectsPreference: reveals commands when automatic display is enabled', async () => {
    const terminals = new PairTerminals(() => true);
    const run = runIn(terminals, 'npm test');
    await vi.advanceTimersByTimeAsync(0);
    const visible = lastTerminal();
    expect(visible.show).toHaveBeenCalledWith(true);
    fire('end', { execution: lastExecution(), exitCode: 0 });
    await vi.advanceTimersByTimeAsync(DRAIN_MS);
    await run;
    void runIn(terminals, 'next');
    await vi.advanceTimersByTimeAsync(0);
    expect(fakes.terminals).toHaveLength(2);
  });

  it('ShowExact: invalidates the old command ID when a hidden terminal is reused', async () => {
    const terminals = new PairTerminals(() => false);
    const first = terminals.run('one', { id: 41, cwd: '/p', waitMs: WAIT_MS, signal: new AbortController().signal });
    await vi.advanceTimersByTimeAsync(0);
    fire('end', { execution: lastExecution(), exitCode: 0 });
    await vi.advanceTimersByTimeAsync(DRAIN_MS);
    await first;
    const second = terminals.run('two', { id: 42, cwd: '/p', waitMs: WAIT_MS, signal: new AbortController().signal });
    await vi.advanceTimersByTimeAsync(0);
    expect(fakes.terminals).toHaveLength(1);
    expect(terminals.showTerminal(41)).toBe(false);
    expect(terminals.showTerminal(42)).toBe(true);
    fire('end', { execution: lastExecution(), exitCode: 0 });
    await vi.advanceTimersByTimeAsync(DRAIN_MS);
    await second;
    fire('close', lastTerminal());
    expect(terminals.showTerminal(42)).toBe(false);
  });

  it('cleans up exited owned terminals while preserving live, running and untracked shells', async () => {
    const terminals = new PairTerminals(() => false);
    const ended = runIn(terminals, 'printf ok');
    await vi.advanceTimersByTimeAsync(0);
    const idle = lastTerminal();
    fire('end', { execution: lastExecution(), exitCode: 0 });
    await vi.advanceTimersByTimeAsync(DRAIN_MS);
    await ended;
    const running = runIn(terminals, 'sleep 5', undefined, '/other');
    await vi.advanceTimersByTimeAsync(WAIT_MS);
    await running;
    const busy = lastTerminal();
    terminals.cleanupIdle();
    expect(idle.dispose).not.toHaveBeenCalled();
    expect(busy.dispose).not.toHaveBeenCalled();
    idle.exitStatus = { code: 0 };
    terminals.cleanupIdle();
    expect(idle.dispose).toHaveBeenCalledOnce();
    fakes.integrated = false;
    const untracked = runIn(terminals, 'read x', undefined, '/untracked');
    await vi.advanceTimersByTimeAsync(SHELL_INTEGRATION_MS);
    await untracked;
    const unknown = lastTerminal();
    expect(unknown.show).toHaveBeenCalledWith(true);
    terminals.cleanupIdle();
    expect(unknown.dispose).not.toHaveBeenCalled();
  });
  it("RunReturns, SkipAborted: doesn't wait for shell integration once playback is interrupted, and starts nothing", async () => {
    expect(await runIn(new PairTerminals(() => false), 'npm test', AbortSignal.abort())).toEqual({ output: '', notStarted: true });
    expect(lastTerminal().executions).toEqual([]);
    expect(lastTerminal().show).not.toHaveBeenCalled();
  });

  it('RunReturns, ExecuteCommand, End: runs the command, reads its output, and reports how it ended, with its shell', async () => {
    const outcome = runIn(new PairTerminals(() => false), 'npm test');
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
    const terminals = new PairTerminals(() => false);
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
    const terminals = new PairTerminals(() => false);
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
    const outcome = runIn(new PairTerminals(() => false), 'npm test');
    await vi.advanceTimersByTimeAsync(0);
    fire('close', new fakes.FakeTerminal({ cwd: '/' }, true));
    fire('close', lastTerminal());
    await vi.advanceTimersByTimeAsync(DRAIN_MS);
    await outcome;
    expect(given().run.exitCode()).toBeUndefined();
    expect(given().run.closed()).toBe(true);
  });

  it('RunReturns, SendText: waits for shell integration to come, for this terminal only, and types the command in without it', async () => {
    fakes.integrated = false;
    const terminals = new PairTerminals(() => false);
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
    const outcome = runIn(new PairTerminals(() => false), 'npm test', abort.signal);
    await vi.advanceTimersByTimeAsync(0);
    abort.abort();
    expect(await outcome).toEqual({ output: '', notStarted: true });
  });
});

describe('acquire', () => {
  it("NoReuseWhileBusy: gives a second command a new terminal while the first one's command still runs", async () => {
    const terminals = new PairTerminals(() => false);
    const first = runIn(terminals, 'npm run watch');
    await vi.advanceTimersByTimeAsync(WAIT_MS);
    await first;
    const second = runIn(terminals, 'npm test');
    await vi.advanceTimersByTimeAsync(WAIT_MS);
    await second;
    expect(fakes.terminals).toHaveLength(2);
  });

  it("FreedAfterEnd, Exit: reuses a terminal once its command ends, in the folder it's in, and not one whose shell exited", async () => {
    const terminals = new PairTerminals(() => false);
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
    const terminals = new PairTerminals(() => false);
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
    const terminals = new PairTerminals(() => false);
    expect(fakes.listeners.get('close')?.size).toBe(1);
    terminals.dispose();
    expect(fakes.listeners.get('close')?.size).toBe(0);
  });
});

it('waits for a timed-out execution output stream to drain after its matching end', async () => {
  const terminals = new PairTerminals(() => false);
  const outcome = runIn(terminals, 'long command');
  await vi.advanceTimersByTimeAsync(WAIT_MS);
  await outcome;
  const execution = lastExecution();
  let settled = false;
  void given().run.ended.then(() => {
    settled = true;
  });
  fire('end', { execution: new fakes.FakeExecution(), exitCode: 0 });
  await vi.advanceTimersByTimeAsync(0);
  expect(settled).toBe(false);
  fire('end', { execution, exitCode: 0 });
  execution.output = ['late output'];
  await vi.advanceTimersByTimeAsync(0);
  expect(settled).toBe(false);
  execution.released.resolve();
  await vi.advanceTimersByTimeAsync(0);
  expect(settled).toBe(true);
  expect(given().pushed).toEqual(['late output']);
});

it('encodes Bash multiline input on one physical line and leaves unsupported shells unchanged', () => {
  const command = "cat <<'EOF'\n$HOME \\n caf\u00E9\nEOF\n";
  expect(commandForShell(command, 'bash')).toBe("builtin eval -- $'cat <<\\'EOF\\'\\n$HOME \\\\n caf\u00E9\\nEOF\\n'");
  expect(commandForShell(command, 'zsh')).toBe(command);
  expect(commandForShell(command, undefined)).toBe(command);
  expect(commandForShell('echo ok', 'bash')).toBe('echo ok');
  expect(commandForShell('echo a\n\u0000b', 'bash')).toBe('echo a\n\u0000b');
});

it('encodes carriage return and control bytes without physical control input', () => {
  expect(commandForShell('a\r\n\t\u007F', 'bash')).toBe("builtin eval -- $'a\\r\\n\\x09\\x7f'");
});
