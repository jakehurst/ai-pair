// The agent's `run` commands: played in a terminal the programmer can see, output captured
// through shell integration. See `run` in PROTOCOL.md.

import * as path from 'node:path';
import * as vscode from 'vscode';
import { reportDiagnostic, samePath, type CommandDiagnostic, type CommandOutcome, type RunOptions } from '@ai-pair/core';
import { MAX_OUTPUT, outcomeOf, Tail } from './output';
import { timings } from './timings';

/** The tail keeps this many times the output it reports, so a cut at its start loses nothing it shows. */
const TAIL_SLACK = 4;
/** The first printable ASCII code and DEL control code. */
const ASCII_PRINTABLE = 32;
const ASCII_DEL = 127;
/** Radix used by Bash hexadecimal escapes. */
const HEX_RADIX = 16;

interface Owned {
  terminal: vscode.Terminal;
  cwd: string;
  busy: boolean;
  inFlight: boolean;
  exposed: boolean;
  runId: number;
  execution?: vscode.TerminalShellExecution;
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
    }, timings.shellIntegrationMs);
    cleanup.push(() => {
      clearTimeout(timer);
    });
    signal.addEventListener('abort', abort, { once: true });
    cleanup.push(() => {
      signal.removeEventListener('abort', abort);
    });
  });
}

/** Waits briefly for authoritative shell identity, or stops when the terminal closes or the run is interrupted. */
function shellIdentity(terminal: vscode.Terminal, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted || terminal.state.shell !== undefined || terminal.exitStatus !== undefined) {
    return Promise.resolve(terminal.exitStatus !== undefined);
  }
  return new Promise((resolve) => {
    const cleanup: Array<() => void> = [];
    let settled = false;
    function done(closed: boolean): void {
      if (settled) return;
      settled = true;
      for (const undo of cleanup) undo();
      resolve(closed);
    }
    const state = vscode.window.onDidChangeTerminalState((changed) => {
      if (changed === terminal && terminal.state.shell !== undefined) done(false);
    });
    cleanup.push(() => {
      state.dispose();
    });
    const close = vscode.window.onDidCloseTerminal((changed) => {
      if (changed === terminal) done(true);
    });
    cleanup.push(() => {
      close.dispose();
    });
    const timer = setTimeout(() => {
      done(false);
    }, timings.shellIdentityMs);
    cleanup.push(() => {
      clearTimeout(timer);
    });
    function abort(): void {
      done(false);
    }
    signal.addEventListener('abort', abort, { once: true });
    cleanup.push(() => {
      signal.removeEventListener('abort', abort);
    });
    // Close the gap between the first state read and subscribing to changes.
    if (terminal.exitStatus !== undefined) done(true);
    else if (signal.aborted || terminal.state.shell !== undefined) done(false);
  });
}

/**
 * Resolves `false` when the wait is over or playback is interrupted (specs/Terminals.tla, `StopWaiting`). The signal
 * hasn't fired yet: `run` returned `notStarted` for one that had, and nothing awaits between that check and this.
 */
function stopWaiting(ms: number, signal: AbortSignal, ended: Promise<void>): Promise<false> {
  return new Promise((resolve) => {
    const cleanup: Array<() => void> = [];
    function done(): void {
      for (const undo of cleanup) {
        undo();
      }
      resolve(false);
    }
    const timer = setTimeout(done, ms);
    cleanup.push(() => {
      clearTimeout(timer);
    });
    signal.addEventListener('abort', done, { once: true });
    cleanup.push(() => {
      signal.removeEventListener('abort', done);
    });
    void ended.then(done);
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Encodes multiline Bash input without submitting physical newlines (specs/CommandEncoding.tla, Submit). */
export function commandForShell(command: string, shell: string | undefined): string {
  if (shell !== 'bash' || !command.includes('\n') || command.includes('\0')) return command;
  let encoded = '';
  for (const character of command) {
    // Only ASCII control codes need numeric inspection; all other characters pass through.
    // oxlint-disable-next-line unicorn/prefer-code-point
    const code = character.charCodeAt(0);
    if (character === "'") encoded += "\\'";
    else if (character === '\\') encoded += '\\\\';
    else if (character === '\n') encoded += '\\n';
    else if (character === '\r') encoded += '\\r';
    else if (code < ASCII_PRINTABLE || code === ASCII_DEL) encoded += `\\x${code.toString(HEX_RADIX).padStart(2, '0')}`;
    else encoded += character;
  }
  return `builtin eval -- $'${encoded}'`;
}

/** Runs the agent's commands in VS Code terminals with shell integration, and collects their output. */
export class PairTerminals implements vscode.Disposable {
  private readonly owned: Owned[] = [];
  private readonly disposables: vscode.Disposable[];

  constructor(
    private readonly showAutomatically: () => boolean,
    private readonly onDiagnostic?: (event: CommandDiagnostic) => void,
  ) {
    this.disposables = [
      // specs/TerminalReuse.tla, ForeignStart: another extension can access a hidden terminal.
      vscode.window.onDidStartTerminalShellExecution((event) => {
        const owned = this.owned.find((item) => item.terminal === event.terminal);
        if (owned && event.execution !== owned.execution) owned.exposed = true;
      }),
      // specs/Terminals.tla, `CloseTerminal`: a terminal the programmer closes is forgotten.
      vscode.window.onDidCloseTerminal((t) => {
        const i = this.owned.findIndex((o) => o.terminal === t);
        if (i !== -1) this.owned.splice(i, 1);
      }),
    ];
  }

  async run(command: string, options: RunOptions): Promise<CommandOutcome> {
    this.diagnostic({ kind: 'command', id: options.id, phase: 'requested', waitMs: options.waitMs });
    let owned: Owned;
    try {
      owned = this.acquire(options.cwd, options.id);
    } catch (error) {
      this.diagnostic({ kind: 'command', id: options.id, phase: 'failed' });
      throw error;
    }
    owned.busy = true;
    owned.inFlight = true;
    try {
      const { terminal } = owned;
      if (this.showAutomatically()) this.showOwned(owned);

      const integration = await shellIntegration(terminal, options.signal);
      this.diagnostic({ kind: 'command', id: options.id, phase: 'integration', available: integration !== undefined });
      // specs/Terminals.tla: `AbortBeforeStart`, or `SkipAborted` when the signal fired before the run.
      if (options.signal.aborted) {
        this.diagnostic({ kind: 'command', id: options.id, phase: 'abort' });
        owned.busy = false;
        return { output: '', notStarted: true };
      }
      if (!integration) {
        // Without shell integration we can't tell when it ends, so the terminal is never reused (specs/Terminals.tla, `SendText`).
        // A terminal closed meanwhile makes `sendText` throw, and `run` rejects (`RejectClosed`).
        this.showOwned(owned);
        terminal.sendText(command);
        this.diagnostic({ kind: 'command', id: options.id, phase: 'untracked' });
        return { output: '[output not captured: this terminal has no shell integration]' };
      }

      // specs/ShellIdentity.tla: wait only for unknown identity on multiline input; never guess a shell.
      const closedBeforeStart =
        command.includes('\n') && terminal.state.shell === undefined ? await shellIdentity(terminal, options.signal) : false;
      if (options.signal.aborted) {
        this.diagnostic({ kind: 'command', id: options.id, phase: 'abort' });
        owned.busy = false;
        return { output: '', notStarted: true };
      }
      if (closedBeforeStart || terminal.exitStatus !== undefined) throw new Error('Terminal closed before command submission');

      // specs/Terminals.tla, `ExecuteCommand`. Its end event comes through VS Code's event loop, so the
      // listeners below are in place before it can fire.
      const execution = integration.executeCommand(commandForShell(command, terminal.state.shell));
      owned.execution = execution;
      this.diagnostic({ kind: 'command', id: options.id, phase: 'start' });

      // specs/Terminals.tla: the command ends (`End`), or the programmer closes its terminal (`CloseTerminal`), and the terminal is free.
      let exitCode: number | undefined;
      let closed = false;
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
            this.diagnostic({ kind: 'command', id: options.id, phase: 'end', ...(exitCode === undefined ? {} : { exitCode }) });
            done();
          }),
          vscode.window.onDidCloseTerminal((t) => {
            if (t === terminal) {
              closed = true;
              this.diagnostic({ kind: 'command', id: options.id, phase: 'closed' });
              done();
            }
          }),
        );
      });
      void ended.then(() => {
        owned.busy = false;
        delete owned.execution;
      });

      const output = new Tail(MAX_OUTPUT * TAIL_SLACK);
      const drained = (async () => {
        for await (const data of execution.read()) {
          output.push(data);
        }
      })().catch(() => {
        // The read ends with the terminal; `ended` reports how.
      });

      const finished = await Promise.race([ended.then(() => true), stopWaiting(options.waitMs, options.signal, ended)]);
      if (finished) await Promise.race([drained, delay(timings.drainMs)]);
      else this.diagnostic({ kind: 'command', id: options.id, phase: options.signal.aborted ? 'abort' : 'timeout' });

      const outcome = outcomeOf(output, {
        shell: terminal.state.shell,
        finished,
        exitCode: () => exitCode,
        closed: () => closed,
        ended: ended.then(() => Promise.race([drained, delay(timings.drainMs)])),
      });
      return outcome;
    } catch (error) {
      this.diagnostic({ kind: 'command', id: options.id, phase: 'failed' });
      throw error;
    } finally {
      owned.inFlight = false;
    }
  }

  /** Reports diagnostics without allowing an observer to affect the command. */
  private diagnostic(event: CommandDiagnostic): void {
    reportDiagnostic(this.onDiagnostic, event, this);
  }

  /** Shows the terminal associated with a current command, if available. */
  showTerminal(id: number): boolean {
    const owned = this.owned.find((item) => item.runId === id);
    if (!owned) return false;
    this.showOwned(owned);
    return true;
  }

  /** Shows and protects an owned terminal without moving focus. */
  private showOwned(owned: Owned): void {
    owned.exposed = true;
    owned.terminal.show(/* preserveFocus= */ true);
  }

  /** Removes exited hidden terminals without closing any live shell. */
  cleanupIdle(): void {
    // specs/QuietTerminals.tla, Cleanup: live and exposed terminals are kept.
    for (const owned of this.owned.slice()) {
      if (owned.busy || owned.inFlight || owned.exposed || owned.terminal.exitStatus === undefined) continue;
      this.owned.splice(this.owned.indexOf(owned), 1);
      owned.terminal.dispose();
    }
  }

  // specs/Terminals.tla, Acquire; specs/TerminalReuse.tla, Attempt: only reuse an eligible shell.
  private acquire(cwd: string, id: number): Owned {
    const idle = this.owned.find((o) => {
      const at = o.terminal.shellIntegration?.cwd?.fsPath ?? o.cwd;
      return !o.busy && !o.inFlight && !o.exposed && o.terminal.exitStatus === undefined && samePath(path.resolve(at), path.resolve(cwd));
    });
    if (idle) {
      idle.runId = id;
      return idle;
    }
    const terminal = vscode.window.createTerminal({
      name: 'AI Pair',
      cwd,
      iconPath: new vscode.ThemeIcon('comment-discussion'),
      hideFromUser: true,
    });
    const owned: Owned = { terminal, cwd, busy: false, inFlight: false, exposed: false, runId: id };
    this.owned.push(owned);
    return owned;
  }

  dispose(): void {
    this.cleanupIdle();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
