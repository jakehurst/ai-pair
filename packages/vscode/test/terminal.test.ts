// A command whose batch was interrupted before it started isn't started, and says so at once. A terminal
// is given to a command only once the one before it ended (specs/Terminals.tla).

import { afterEach, beforeEach, expect, it, vi } from 'vitest';

type Execution = { read: () => AsyncIterable<string> };
type FakeTerminal = {
  show: () => void;
  sendText: () => void;
  state: { shell: string | undefined };
  shellIntegration: { executeCommand: () => Execution };
  executions: Execution[];
};
type EndEvent = { execution: Execution; exitCode: number | undefined };

const fake = vi.hoisted(() => ({
  terminals: [] as FakeTerminal[],
  onEnd: new Set<(e: EndEvent) => void>(),
}));

const none = { dispose: () => {} };
vi.mock('vscode', () => ({
  ThemeIcon: class {
    constructor(readonly id: string) {}
  },
  window: {
    onDidCloseTerminal: () => none,
    onDidChangeTerminalShellIntegration: () => none,
    onDidEndTerminalShellExecution: (listener: (e: EndEvent) => void) => {
      fake.onEnd.add(listener);
      return { dispose: () => fake.onEnd.delete(listener) };
    },
    createTerminal: () => {
      const executions: Execution[] = [];
      const executeCommand = () => {
        const execution = { read: async function* () {} };
        executions.push(execution);
        return execution;
      };
      const terminal: FakeTerminal = {
        show: () => {},
        sendText: () => {},
        state: { shell: undefined },
        shellIntegration: { executeCommand },
        executions,
      };
      fake.terminals.push(terminal);
      return terminal;
    },
  },
}));

const { PairTerminals } = await import('../src/terminal');

/** How long `run` waits for a command before it returns with the command still running. */
const WAIT_MS = 1000;

beforeEach(() => {
  vi.useFakeTimers();
  fake.terminals.length = 0;
  fake.onEnd.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Runs a command that doesn't end within the wait, and resolves once `run` returns. */
async function runPastTheWait(terminals: InstanceType<typeof PairTerminals>, command: string): Promise<void> {
  const returned = terminals.run(command, { cwd: '/', waitMs: WAIT_MS, signal: new AbortController().signal });
  await vi.advanceTimersByTimeAsync(WAIT_MS);
  await returned;
}

it("RunReturns: doesn't wait for shell integration once playback is interrupted", async () => {
  const interrupted = AbortSignal.abort();
  let outcome;
  void new PairTerminals().run('npm test', { cwd: '/', waitMs: WAIT_MS, signal: interrupted }).then((o) => (outcome = o));
  await vi.advanceTimersByTimeAsync(0);
  expect(outcome).toEqual({ output: '', notStarted: true });
});

it("NoReuseWhileBusy: gives a second command a new terminal while the first one's command still runs", async () => {
  const terminals = new PairTerminals();
  await runPastTheWait(terminals, 'npm run watch');
  await runPastTheWait(terminals, 'npm test');
  expect(fake.terminals).toHaveLength(2);
  expect(fake.terminals.map((t) => t.executions.length)).toEqual([1, 1]);
});

it('FreedAfterEnd: reuses a terminal once its command ends', async () => {
  const terminals = new PairTerminals();
  await runPastTheWait(terminals, 'npm run build');
  const [first] = fake.terminals;
  for (const listener of fake.onEnd) listener({ execution: first!.executions[0]!, exitCode: 0 });
  await vi.advanceTimersByTimeAsync(0);
  await runPastTheWait(terminals, 'npm test');
  expect(fake.terminals).toHaveLength(1);
  expect(first!.executions).toHaveLength(2);
});
