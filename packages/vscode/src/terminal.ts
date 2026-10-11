// The agent's `run` commands: played in a terminal the programmer can see, output captured
// through shell integration. See `run` in PROTOCOL.md.

import * as path from 'node:path';
import * as vscode from 'vscode';
import { samePath, type CommandOutcome, type RunOptions } from '@ai-pair/core';
import { MAX_OUTPUT, outcomeOf, Tail } from './output';

/** How long a new terminal gets to report shell integration before the command is just typed in. */
const SHELL_INTEGRATION_MS = 5000;
/** After the command ends, how long its output stream gets to drain. */
const DRAIN_MS = 500;

interface Owned {
  terminal: vscode.Terminal;
  cwd: string;
  busy: boolean;
}

function shellIntegration(terminal: vscode.Terminal, signal: AbortSignal): Promise<vscode.TerminalShellIntegration | undefined> {
  // An interrupt before it (during the save): the abort event has fired already.
  if (signal.aborted) return Promise.resolve(undefined);
  if (terminal.shellIntegration) return Promise.resolve(terminal.shellIntegration);
  return new Promise((resolve) => {
    const cleanup: Array<() => void> = [];
    function done(value: vscode.TerminalShellIntegration | undefined): void {
      for (const undo of cleanup) {
        undo();
      }
      resolve(value);
    }
    function abort(): void {
      done(undefined);
    }
    const listener = vscode.window.onDidChangeTerminalShellIntegration((e) => {
      if (e.terminal === terminal) done(e.shellIntegration);
    });
    cleanup.push(() => {
      listener.dispose();
    });
    const timer = setTimeout(() => {
      done(terminal.shellIntegration);
    }, SHELL_INTEGRATION_MS);
    cleanup.push(() => clearTimeout(timer));
    signal.addEventListener('abort', abort, { once: true });
    cleanup.push(() => signal.removeEventListener('abort', abort));
  });
}

/** Resolves `false` when the wait is over or playback is interrupted (specs/Terminals.tla, `StopWaiting`). */
function stopWaiting(ms: number, signal: AbortSignal, ended: Promise<void>): Promise<false> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }
    const cleanup: Array<() => void> = [];
    function done(): void {
      for (const undo of cleanup) {
        undo();
      }
      resolve(false);
    }
    const timer = setTimeout(done, ms);
    cleanup.push(() => clearTimeout(timer));
    signal.addEventListener('abort', done, { once: true });
    cleanup.push(() => signal.removeEventListener('abort', done));
    void ended.then(done);
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class PairTerminals implements vscode.Disposable {
  private readonly owned: Owned[] = [];
  private readonly disposables: vscode.Disposable[];

  constructor() {
    this.disposables = [
      // specs/Terminals.tla, `Close`: a terminal the programmer closes is forgotten.
      vscode.window.onDidCloseTerminal((t) => {
        const i = this.owned.findIndex((o) => o.terminal === t);
        if (i !== -1) this.owned.splice(i, 1);
      }),
    ];
  }

  async run(command: string, options: RunOptions): Promise<CommandOutcome> {
    const owned = this.acquire(options.cwd);
    owned.busy = true;
    const { terminal } = owned;
    terminal.show(/* preserveFocus= */ true);

    const integration = await shellIntegration(terminal, options.signal);
    // specs/Terminals.tla: `AbortBeforeStart`, or `SkipAborted` when the signal fired before the run.
    if (options.signal.aborted) {
      owned.busy = false;
      return { output: '', notStarted: true };
    }
    if (!integration) {
      // Without shell integration we can't tell when it ends, so the terminal is never reused (specs/Terminals.tla, `SendText`).
      // A terminal closed meanwhile makes `sendText` throw, and `run` rejects (`RejectClosed`).
      terminal.sendText(command);
      return { output: '[output not captured: this terminal has no shell integration]' };
    }

    // specs/Terminals.tla, `ExecuteCommand`. Its end event comes through VS Code's event loop, so the
    // listeners below are in place before it can fire.
    const execution = integration.executeCommand(command);

    // specs/Terminals.tla: the command ends (`End`), or the programmer closes its terminal (`Close`), and the terminal is free.
    let exitCode: number | undefined;
    const ended = new Promise<void>((resolve) => {
      const listeners: vscode.Disposable[] = [];
      function done(): void {
        for (const listener of listeners) {
          listener.dispose();
        }
        resolve();
      }
      listeners.push(
        vscode.window.onDidEndTerminalShellExecution((e) => {
          if (e.execution !== execution) return;
          exitCode = e.exitCode;
          done();
        }),
        vscode.window.onDidCloseTerminal((t) => {
          if (t === terminal) done();
        }),
      );
    });
    void ended.then(() => {
      owned.busy = false;
    });

    const output = new Tail(MAX_OUTPUT * 4);
    const drained = (async () => {
      for await (const data of execution.read()) {
        output.push(data);
      }
    })().catch(() => {});

    const finished = await Promise.race([ended.then(() => true), stopWaiting(options.waitMs, options.signal, ended)]);
    if (finished) await Promise.race([drained, delay(DRAIN_MS)]);

    return outcomeOf(output, { shell: terminal.state.shell, finished, exitCode: () => exitCode, ended });
  }

  // specs/Terminals.tla, `Start`: a terminal that isn't busy, whose shell is alive (`Exit`), in the directory, else a new one.
  private acquire(cwd: string): Owned {
    const idle = this.owned.find((o) => {
      const at = o.terminal.shellIntegration?.cwd?.fsPath ?? o.cwd;
      return !o.busy && o.terminal.exitStatus === undefined && samePath(path.resolve(at), path.resolve(cwd));
    });
    if (idle) return idle;
    const terminal = vscode.window.createTerminal({ name: 'AI Pair', cwd, iconPath: new vscode.ThemeIcon('comment-discussion') });
    const owned: Owned = { terminal, cwd, busy: false };
    this.owned.push(owned);
    return owned;
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
