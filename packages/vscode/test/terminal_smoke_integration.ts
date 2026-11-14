// Native Controller-path terminal smoke: every file and command is synthetic.
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import type { Api } from '../src/extension';

const DEADLINE_MS = 20_000;

/** Returns whether the activated extension has its test API. */
function isApi(value: unknown): value is Api {
  return typeof value === 'object' && value !== null && 'controller' in value && 'ready' in value;
}

/** Bounds a native test wait without changing or closing its terminal. */
async function bounded<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error('Controller response timed out'));
        }, DEADLINE_MS);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Verifies Controller command reports while terminals remain open. */
export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension('mattyv.ai-pair');
  assert.ok(extension, 'AI Pair extension not found');
  const exported: unknown = await extension.activate();
  assert.ok(isApi(exported), 'AI Pair did not export its test API');
  const { controller } = exported;
  await exported.ready;
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, 'No isolated workspace');
  const events: Array<{ kind: string; time: number; name: string; exitCode?: number }> = [];
  const listeners = [
    vscode.window.onDidStartTerminalShellExecution((event) => {
      events.push({ kind: 'start', time: Date.now(), name: event.terminal.name });
    }),
    vscode.window.onDidEndTerminalShellExecution((event) => {
      events.push({ kind: 'end', time: Date.now(), name: event.terminal.name, exitCode: event.exitCode });
    }),
    vscode.window.onDidCloseTerminal((terminal) => {
      events.push({ kind: 'close', time: Date.now(), name: terminal.name });
    }),
  ];
  try {
    controller.setConfirmCommands(false);
    controller.setSpeed(20);
    await controller.start('Native terminal smoke', folder.uri.fsPath);
    const cases = [
      { kind: 'success', command: 'printf "ai-pair-smoke\\n"', wait: 5 },
      { kind: 'pipeline', command: 'printf "alpha\\nbeta\\n" | tail -n 1', wait: 5 },
      { kind: 'failure', command: `cd /ai-pair-missing-${randomUUID()}`, wait: 5 },
      { kind: 'running', command: 'sleep 2', wait: 0.2 },
    ] as const;
    let firstTerminal: vscode.Terminal | undefined;
    for (const trial of cases) {
      const started = Date.now();
      const first = await bounded(controller.step([{ run: trial.command, wait: trial.wait }]));
      const second = await bounded(controller.step([]));
      const reports = [first, second];
      const runs = reports.flatMap((report) => report.batches.flatMap((batch) => batch.runs ?? []));
      const owned = vscode.window.terminals.filter((terminal) => terminal.name === 'AI Pair');
      console.log(
        `Native Controller run: ${JSON.stringify({ command: trial.command, elapsedMs: Date.now() - started, runs, open: owned.length, events })}`,
      );
      assert.equal(runs.length, 1, 'No command result was returned');
      assert.equal(owned.length, 1, 'The quiet terminal was closed or was not reused');
      const terminal = owned[0];
      assert.ok(terminal);
      firstTerminal ??= terminal;
      assert.equal(terminal, firstTerminal, 'The completed quiet terminal was not reused');
      assert.ok(
        'hideFromUser' in terminal.creationOptions && terminal.creationOptions.hideFromUser === true,
        'Terminal was not created hidden',
      );
      if (trial.kind === 'running') {
        assert.equal(runs[0]?.running, true, 'The wait timeout did not return a running command');
      } else if (trial.kind === 'failure') {
        assert.notEqual(runs[0]?.exit_code, undefined, 'The failing command did not return an exit code');
        assert.notEqual(runs[0]?.exit_code, 0, 'The failing command returned success');
      } else {
        assert.equal(runs[0]?.exit_code, 0, 'The completed command did not report success');
        assert.match(runs[0]?.output ?? '', trial.kind === 'pipeline' ? /beta/ : /ai-pair-smoke/);
      }
    }
    const marker = vscode.Uri.joinPath(folder.uri, 'heredoc-output.txt');
    const command = `cat <<'PAIR_END' | tail -n 1 > '${marker.fsPath}'\nalpha\nbeta\nPAIR_END`;
    const first = await bounded(controller.step([{ run: command, wait: 1 }]));
    const second = await bounded(controller.step([]));
    const commandRun = [first, second].flatMap((report) => report.batches.flatMap((batch) => batch.runs ?? []))[0];
    assert.ok(commandRun, 'heredoc command did not yield a report');
    assert.equal(new TextDecoder().decode(await vscode.workspace.fs.readFile(marker)), 'beta\n');
    if (commandRun.shell === 'bash') {
      assert.equal(commandRun.exit_code, 0, 'Bash heredoc did not report its observed completion');
      const visible = "cat <<'PAIR_END' | tail -n 1\nalpha\nbeta\nPAIR_END";
      const visibleFirst = await bounded(controller.step([{ run: visible, wait: 5 }]));
      const visibleSecond = await bounded(controller.step([]));
      const visibleRun = [visibleFirst, visibleSecond].flatMap((report) => report.batches.flatMap((batch) => batch.runs ?? []))[0];
      assert.equal(visibleRun?.exit_code, 0, 'Bash heredoc output run did not end');
      assert.match(visibleRun.output, /beta/, 'Bash heredoc output was not captured');
    } else if (commandRun.running === true) {
      assert.equal(commandRun.exit_code, undefined, 'unobserved completion must not claim success');
    } else {
      assert.equal(commandRun.exit_code, 0, 'reported completion must carry its observed exit code');
    }
    console.log(
      `Native heredoc pipeline: ${JSON.stringify({ running: commandRun.running, exitCode: commandRun.exit_code, output: commandRun.output })}`,
    );
    await vscode.workspace.fs.delete(marker);
  } finally {
    console.log(`Native Controller terminal events: ${JSON.stringify(events)}`);
    controller.endSession();
    for (const listener of listeners) listener.dispose();
  }
}
