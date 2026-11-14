// Paths of the terminals that real use takes and no other integration case did (#176): a terminal shown by
// the setting and by the panel's button.

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { CURSOR_MARKER } from '@ai-pair/protocol';
import { z } from 'zod';
import type { Controller, PanelEvent } from '@ai-pair/core';
import * as vscode from 'vscode';
import type { Api } from '../src/extension';

/** How often, and how many times, to look for a run the panel shows. */
const POLL_MS = 50;
const POLLS = 200;

/** How long a report may take after an interrupt. */
const INTERRUPT_WAIT_MS = 5000;

/** Maximum terminal events kept for a failure-only foreign execution trace. */
const MAX_TERMINAL_TRACE = 40;
/** Bounds each diagnostic command and the diagnostic output tail. */
const MAX_TRACE_COMMAND = 512;
const MAX_TRACE_OUTPUT = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Waits for the panel to show a run of `command` in `phase`, and returns its id. */
async function runShown(api: Api, command: string, phase: string): Promise<number> {
  for (let i = 0; i < POLLS; i++) {
    const run = api.history().findLast((e) => e.type === 'run' && e.command === command && e.phase === phase);
    if (run?.type === 'run') return run.id;
    await sleep(POLL_MS);
  }
  return assert.fail(`the panel never showed ${command} ${phase}`);
}

/** Waits for the panel to show a run of `command` that has ended, whatever way it ended. */
async function runEnded(api: Api, command: string): Promise<void> {
  for (let i = 0; i < POLLS; i++) {
    const run = api.history().findLast((e) => e.type === 'run' && e.command === command);
    if (run?.type === 'run' && run.phase !== 'running' && run.phase !== 'confirm') return;
    await sleep(POLL_MS);
  }
  assert.fail(`the panel never showed ${command} ended`);
}

/** Disposes every terminal there is, so the next command opens a new one, and waits for the extension to forget them. */
async function closeTerminals(): Promise<void> {
  for (const terminal of vscode.window.terminals) {
    terminal.dispose();
  }
  for (let i = 0; i < POLLS && vscode.window.terminals.length > 0; i++) {
    await sleep(POLL_MS);
  }
}

/** Interrupts a command while an intentionally slow shell is starting. */
async function interruptedTerminalStart(api: Api): Promise<void> {
  if (process.platform !== 'linux' && process.platform !== 'darwin') return;
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, 'workspace not found');
  const shell = path.join(folder.uri.fsPath, 'integration-slow-shell.sh');
  const marker = path.join(folder.uri.fsPath, 'integration-command-started');
  fs.writeFileSync(shell, '#!/bin/sh\nsleep 5\nexec /bin/bash "$@"\n', { mode: 0o700 });
  const platform = process.platform === 'darwin' ? 'osx' : 'linux';
  const terminalSettings = vscode.workspace.getConfiguration('terminal.integrated');
  const profilesKey = `profiles.${platform}`;
  const defaultKey = `defaultProfile.${platform}`;
  const previousProfiles = terminalSettings.inspect<Record<string, unknown>>(profilesKey)?.globalValue;
  const previousDefault = terminalSettings.inspect<string>(defaultKey)?.globalValue;
  const global = vscode.ConfigurationTarget.Global;
  const { controller } = api;
  try {
    await terminalSettings.update(profilesKey, { ...previousProfiles, 'AI Pair slow integration shell': { path: shell } }, global);
    await terminalSettings.update(defaultKey, 'AI Pair slow integration shell', global);
    controller.setConfirmCommands(false);
    controller.setSpeed(20);
    await closeTerminals();
    await controller.start('interrupted terminal start');
    const command = `touch "${marker}"`;
    await controller.step([{ run: command, wait: 10 }]);
    await runShown(api, command, 'running');
    let settled = false;
    const pending = controller.step([]);
    void pending.finally(() => {
      settled = true;
    });
    for (let i = 0; i < POLLS && vscode.window.terminals.length === 0; i++) await sleep(1);
    const terminal = vscode.window.terminals.at(-1);
    assert.ok(terminal, 'the command never created a terminal');
    assert.equal(terminal.shellIntegration, undefined, 'the shell was ready before the interruption');
    assert.equal(settled, false, 'the command already completed before the interruption');
    controller.userInterrupt();
    const report = await Promise.race([pending, sleep(INTERRUPT_WAIT_MS).then(() => undefined)]);
    assert.ok(report, 'the command did not stop waiting after interruption');
    assert.ok(
      report.events.some((event) => event.kind === 'interrupt'),
      'the interruption was not reported',
    );
    await runShown(api, command, 'declined');
    assert.equal(fs.existsSync(marker), false, 'the command started despite interruption during shell setup');
    console.log('an interrupt while a slow shell starts stops the command before execution');
  } finally {
    controller.endSession();
    await closeTerminals();
    await terminalSettings.update(defaultKey, previousDefault, global);
    await terminalSettings.update(profilesKey, previousProfiles, global);
  }
}

/** An injected failure at VS Code's terminal API must be reported and recoverable. */
async function terminalCreationFailure(api: Api): Promise<void> {
  const { controller } = api;
  const original = Object.getOwnPropertyDescriptor(vscode.window, 'createTerminal');
  assert.ok(original, 'VS Code did not expose createTerminal');
  let attempts = 0;
  controller.setConfirmCommands(false);
  controller.setSpeed(20);
  await closeTerminals();
  try {
    await controller.start('terminal creation failure');
    Object.defineProperty(vscode.window, 'createTerminal', {
      ...original,
      value: () => {
        attempts++;
        throw new Error('injected terminal creation failure');
      },
    });
    try {
      await controller.step([{ run: 'printf should-not-start', wait: 1 }]);
      const result = await Promise.race([controller.step([]), sleep(INTERRUPT_WAIT_MS).then(() => undefined)]);
      assert.ok(result, 'the failed terminal creation left the session pending');
      assert.equal(attempts, 1, 'the injected VS Code boundary was not reached');
      assert.ok(
        result.batches.some(
          (batch) => batch.status === 'failed' && batch.error?.message.includes('injected terminal creation failure') === true,
        ),
        JSON.stringify(result),
      );
    } finally {
      Object.defineProperty(vscode.window, 'createTerminal', original);
    }
    controller.endSession();
    await controller.start('terminal recovery after injected failure');
    const recovery = 'printf terminal-recovered';
    await controller.step([{ run: recovery, wait: 5 }]);
    const recovered = await Promise.race([controller.step([]), sleep(INTERRUPT_WAIT_MS).then(() => undefined)]);
    assert.ok(recovered, 'terminal recovery did not complete');
    assert.ok(
      recovered.batches.some((batch) => batch.status === 'completed'),
      JSON.stringify(recovered),
    );
    await runEnded(api, recovery);
    console.log('an injected VS Code terminal-creation failure is reported and the next run recovers');
  } finally {
    Object.defineProperty(vscode.window, 'createTerminal', original);
    controller.endSession();
    await closeTerminals();
  }
}

/** Inject a rejected read on one real shell execution and verify the session recovers. */
async function terminalOutputReadFailure(api: Api): Promise<void> {
  const { controller } = api;
  controller.setConfirmCommands(false);
  controller.setSpeed(20);
  await closeTerminals();
  try {
    await controller.start('terminal read failure');
    await controller.step([{ run: 'printf terminal-ready', wait: 5 }]);
    const initial = await controller.step([]);
    assert.ok(
      initial.batches.some((batch) => batch.status === 'completed'),
      JSON.stringify(initial),
    );
    const terminal = vscode.window.terminals.at(-1);
    assert.ok(terminal?.shellIntegration, 'the reusable terminal has no shell integration');
    const integration = terminal.shellIntegration;
    const execute = Object.getOwnPropertyDescriptor(integration, 'executeCommand');
    assert.ok(execute && typeof execute.value === 'function', 'executeCommand is not a writable method');
    const originalExecute = integration.executeCommand.bind(integration);
    let reads = 0;
    let executionWithRead: vscode.TerminalShellExecution | undefined;
    let readDescriptor: PropertyDescriptor | undefined;
    Object.defineProperty(integration, 'executeCommand', {
      ...execute,
      value: (command: string) => {
        const execution = originalExecute(command);
        const read = Object.getOwnPropertyDescriptor(execution, 'read');
        assert.ok(read, 'the shell execution has no read method');
        executionWithRead = execution;
        readDescriptor = read;
        Object.defineProperty(execution, 'read', {
          ...read,
          value: () => {
            reads++;
            return { [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(new Error('injected output read failure')) }) };
          },
        });
        return execution;
      },
    });
    try {
      await controller.step([{ run: 'printf terminal-read-injection', wait: 5 }]);
      const result = await Promise.race([controller.step([]), sleep(INTERRUPT_WAIT_MS).then(() => undefined)]);
      assert.ok(result, 'the failed output read left the session pending');
      assert.equal(reads, 1, 'the injected real execution read was not reached');
      assert.ok(
        result.batches.some((batch) => batch.status === 'completed'),
        JSON.stringify(result),
      );
    } finally {
      if (executionWithRead !== undefined && readDescriptor !== undefined) Object.defineProperty(executionWithRead, 'read', readDescriptor);
      Object.defineProperty(integration, 'executeCommand', execute);
    }
    await controller.step([{ run: 'printf terminal-read-recovered', wait: 5 }]);
    const recovered = await Promise.race([controller.step([]), sleep(INTERRUPT_WAIT_MS).then(() => undefined)]);
    assert.ok(
      recovered !== undefined && recovered.batches.some((batch) => batch.status === 'completed'),
      'the terminal did not recover after restoring its read',
    );
    assert.ok(
      recovered.batches.some((batch) => batch.runs?.some((run) => run.output.includes('terminal-read-recovered')) === true),
      'the recovered shell output was not captured',
    );
    console.log('an injected shell output-read failure does not hang the run and the next command recovers');
  } finally {
    controller.endSession();
    await closeTerminals();
  }
}

/** Closing a terminal after execution starts must complete the real run. */
async function closedRunningTerminal(api: Api): Promise<void> {
  const { controller } = api;
  const command = "printf 'ai-pair-terminal-started\\n'; sleep 10";
  const started = Promise.withResolvers<vscode.Terminal>();
  const listener = vscode.window.onDidStartTerminalShellExecution((event) => {
    if (event.execution.commandLine.value === command) started.resolve(event.terminal);
  });
  controller.setConfirmCommands(false);
  controller.setSpeed(20);
  try {
    await closeTerminals();
    await controller.start('close a running terminal');
    await controller.step([{ run: command, wait: 10 }]);
    const report = controller.step([]);
    const terminal = await Promise.race([started.promise, sleep(INTERRUPT_WAIT_MS).then(() => undefined)]);
    assert.ok(terminal, 'the command never started in an integrated shell');
    terminal.dispose();
    const completed = await Promise.race([report, sleep(INTERRUPT_WAIT_MS).then(() => undefined)]);
    assert.ok(completed, 'closing the terminal left the batch pending');
    assert.ok(
      completed.batches.some((batch) => batch.status === 'completed'),
      JSON.stringify(completed),
    );
    assert.equal(vscode.window.terminals.includes(terminal), false, 'the closed terminal remained open');
    console.log('closing a running terminal completes the command without hanging the session');
  } finally {
    listener.dispose();
    controller.endSession();
    await closeTerminals();
  }
}

/** An unrelated terminal's end event must not finish a running Pair command. */
async function unrelatedTerminalEnd(api: Api): Promise<void> {
  const { controller } = api;
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, 'workspace not found');
  const releaseFile = path.join(folder.uri.fsPath, 'integration-terminal-release.flag');
  fs.rmSync(releaseFile, { force: true });
  const command = 'while [ ! -e integration-terminal-release.flag ]; do sleep 0.1; done';
  controller.setConfirmCommands(false);
  controller.setSpeed(20);
  await closeTerminals();
  const foreign = vscode.window.createTerminal({ name: 'Pair integration foreign terminal' });
  foreign.show(true);
  const started = Promise.withResolvers<void>();
  const startedListener = vscode.window.onDidStartTerminalShellExecution((event) => {
    if (event.execution.commandLine.value === command) started.resolve();
  });
  try {
    for (let i = 0; i < POLLS && foreign.shellIntegration === undefined; i++) await sleep(POLL_MS);
    assert.ok(foreign.shellIntegration, 'the foreign shell did not become ready');
    await controller.start('unrelated terminal end');
    await controller.step([{ run: command, wait: 10 }]);
    let complete = false;
    const pending = controller.step([]);
    void pending.finally(() => {
      complete = true;
    });
    await Promise.race([
      started.promise,
      sleep(INTERRUPT_WAIT_MS).then(() => {
        throw new Error('Pair command did not start');
      }),
    ]);
    const execution = foreign.shellIntegration.executeCommand('printf foreign-finished');
    const ended = Promise.withResolvers<void>();
    const endListener = vscode.window.onDidEndTerminalShellExecution((event) => {
      if (event.execution === execution) ended.resolve();
    });
    try {
      await Promise.race([
        ended.promise,
        sleep(INTERRUPT_WAIT_MS).then(() => {
          throw new Error('foreign command did not end');
        }),
      ]);
    } finally {
      endListener.dispose();
    }
    await sleep(500);
    assert.equal(complete, false, 'an unrelated command ended the Pair wait');
    fs.writeFileSync(releaseFile, '');
    const report = await Promise.race([pending, sleep(INTERRUPT_WAIT_MS).then(() => undefined)]);
    assert.ok(report, 'Pair did not finish after the release file appeared');
    assert.ok(
      report.batches.some((batch) => batch.status === 'completed'),
      JSON.stringify(report),
    );
    console.log('an unrelated terminal completion does not finish a running Pair command');
  } finally {
    fs.rmSync(releaseFile, { force: true });
    startedListener.dispose();
    foreign.dispose();
    controller.endSession();
    await closeTerminals();
  }
}

/** Interrupting an already-running command stops waiting without killing it. */
async function interruptRunningCommand(api: Api): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, 'workspace not found');
  const marker = path.join(folder.uri.fsPath, 'integration-running-started.flag');
  const release = path.join(folder.uri.fsPath, 'integration-running-release.flag');
  fs.rmSync(marker, { force: true });
  fs.rmSync(release, { force: true });
  const command = 'printf started > integration-running-started.flag; while [ ! -e integration-running-release.flag ]; do sleep 0.1; done';
  const { controller } = api;
  controller.setConfirmCommands(false);
  controller.setSpeed(20);
  await closeTerminals();
  let started = false;
  let background = false;
  try {
    await controller.start('interrupt an already-running command');
    await controller.step([{ run: command, wait: 10 }]);
    for (let i = 0; i < POLLS && !fs.existsSync(marker); i++) await sleep(POLL_MS);
    assert.ok(fs.existsSync(marker), 'the shell command did not actually start');
    started = true;
    const pending = controller.step([]);
    controller.userInterrupt();
    const report = await Promise.race([pending, sleep(INTERRUPT_WAIT_MS).then(() => undefined)]);
    assert.ok(report, 'interrupting the running command left the session pending');
    assert.ok(
      report.batches.some(
        (batch) => batch.status === 'interrupted' && batch.runs?.some((run) => run.command === command && run.running === true) === true,
      ),
      JSON.stringify(report),
    );
    background = true;
    fs.writeFileSync(release, '');
    await runShown(api, command, 'exited');
    console.log('interrupting an active command stops waiting while the command runs to exit');
  } finally {
    try {
      if (started && !fs.existsSync(release)) fs.writeFileSync(release, '');
      if (background) await runShown(api, command, 'exited');
    } finally {
      controller.endSession();
      await closeTerminals();
      fs.rmSync(marker, { force: true });
      fs.rmSync(release, { force: true });
    }
  }
}

/** A shell whose reported cwd is unavailable reuses its last known directory. */
async function terminalWithoutReportedCwd(api: Api): Promise<void> {
  const { controller } = api;
  controller.setConfirmCommands(false);
  controller.setSpeed(20);
  await closeTerminals();
  try {
    await controller.start('terminal without reported cwd');
    await controller.step([{ run: 'printf cwd-before', wait: 5 }]);
    const initial = await controller.step([]);
    assert.ok(
      initial.batches.some((batch) => batch.status === 'completed'),
      JSON.stringify(initial),
    );
    const terminal = vscode.window.terminals.at(-1);
    assert.ok(terminal?.shellIntegration, 'the reusable terminal has no shell integration');
    const integration = terminal.shellIntegration;
    const own = Object.getOwnPropertyDescriptor(integration, 'cwd');
    let reads = 0;
    Object.defineProperty(integration, 'cwd', {
      configurable: true,
      get: () => {
        reads++;
        return undefined;
      },
    });
    try {
      await controller.step([{ run: 'printf cwd-fallback-reused', wait: 5 }]);
      const report = await controller.step([]);
      assert.ok(
        report.batches.some((batch) => batch.runs?.some((run) => run.output.includes('cwd-fallback-reused')) === true),
        JSON.stringify(report),
      );
      assert.ok(reads > 0, 'the injected missing cwd was not read');
      assert.deepEqual(vscode.window.terminals, [terminal], 'the terminal was not reused');
    } finally {
      if (own === undefined) Reflect.deleteProperty(integration, 'cwd');
      else Object.defineProperty(integration, 'cwd', own);
    }
    console.log('a terminal without a reported cwd is reused at its last known directory');
  } finally {
    controller.endSession();
    await closeTerminals();
  }
}

/** A synthetic status-less shell-integration end must not invent an exit code. */
async function terminalEndWithoutStatus(api: Api): Promise<void> {
  const { controller } = api;
  const command = "printf '\\033]633;D\\007'; sleep 1";
  const ended = Promise.withResolvers<vscode.TerminalShellExecutionEndEvent>();
  const listener = vscode.window.onDidEndTerminalShellExecution((event) => {
    if (event.execution.commandLine.value === command) ended.resolve(event);
  });
  controller.setConfirmCommands(false);
  controller.setSpeed(20);
  await closeTerminals();
  try {
    await controller.start('shell integration without status');
    await controller.step([{ run: command, wait: 5 }]);
    const report = await controller.step([]);
    const event = await Promise.race([ended.promise, sleep(INTERRUPT_WAIT_MS).then(() => undefined)]);
    assert.ok(event, 'VS Code did not report the shell integration end');
    assert.equal(event.exitCode, undefined, 'the synthetic end unexpectedly contained a status');
    assert.ok(
      report.batches.some((batch) => batch.status === 'completed'),
      JSON.stringify(report),
    );
    const run = report.batches.flatMap((batch) => batch.runs ?? []).find((item) => item.command === command);
    assert.ok(run, JSON.stringify(report));
    assert.equal(run.exit_code, undefined, 'Pair invented an exit status');
    await sleep(1300);
    console.log('a synthetic shell integration end without status remains status-less');
  } finally {
    listener.dispose();
    controller.endSession();
    await closeTerminals();
  }
}

/** Exercises the shell-identity wait against a real terminal with delayed state metadata. */
async function delayedShellIdentity(api: Api): Promise<void> {
  if (process.platform !== 'linux') return;
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, 'workspace not found');
  await closeTerminals();
  const options = { id: 90_001, cwd: folder.uri.fsPath, waitMs: 5000, signal: new AbortController().signal };
  const warm = await api.editor.runCommand('printf shell-identity-ready', options);
  assert.equal(warm.exitCode, 0);
  const terminal = vscode.window.terminals.at(-1);
  assert.ok(terminal?.shellIntegration, 'the identity test has no integrated terminal');
  const originalState = Object.getOwnPropertyDescriptor(terminal, 'state');
  const originalEvent = Object.getOwnPropertyDescriptor(vscode.window, 'onDidChangeTerminalState');
  assert.ok(originalState);
  assert.ok(originalEvent);
  assert.equal(originalState.configurable, true);
  assert.equal(originalEvent.configurable, true);
  for (let i = 0; i < POLLS && terminal.state.shell !== 'bash'; i++) await sleep(POLL_MS);
  assert.equal(terminal.state.shell, 'bash', 'the identity test did not use Bash');
  const actualState = terminal.state;
  let known = false;
  let readsUntilKnown = 0;
  let identifyOnSubscribe = false;
  let listener: ((changed: vscode.Terminal) => unknown) | undefined;
  async function waitForListener(): Promise<(changed: vscode.Terminal) => unknown> {
    for (let i = 0; i < POLLS; i++) {
      const current = listener;
      if (current !== undefined) return current;
      await sleep(POLL_MS);
    }
    return assert.fail('the terminal did not wait for shell identity');
  }
  const listen = vscode.window.onDidChangeTerminalState;
  Object.defineProperty(terminal, 'state', {
    ...originalState,
    get: () => {
      if (readsUntilKnown > 0 && --readsUntilKnown === 0) known = true;
      return { ...actualState, shell: known ? 'bash' : undefined };
    },
  });
  Object.defineProperty(vscode.window, 'onDidChangeTerminalState', {
    ...originalEvent,
    value: (callback: (changed: vscode.Terminal) => unknown) => {
      listener = callback;
      if (identifyOnSubscribe) known = true;
      return listen(callback);
    },
  });
  try {
    const command = "printf 'delayed-one\\n'\nprintf delayed-two";
    const delayed = api.editor.runCommand(command, { ...options, id: 90_002 });
    const notifyState = await waitForListener();
    known = true;
    notifyState(terminal);
    // A callback already queued before disposal must not settle the wait twice.
    notifyState(terminal);
    const completed = await Promise.race([delayed, sleep(INTERRUPT_WAIT_MS).then(() => undefined)]);
    assert.ok(completed, 'the delayed Bash command did not finish');
    assert.equal(completed.exitCode, 0);
    assert.match(completed.output, /delayed-one[\s\S]*delayed-two/);

    known = false;
    identifyOnSubscribe = true;
    const registered = await api.editor.runCommand('printf registered-one\nprintf registered-two', { ...options, id: 90_005 });
    identifyOnSubscribe = false;
    assert.equal(registered.exitCode, 0);
    assert.match(registered.output, /registered-oneregistered-two/);

    known = false;
    readsUntilKnown = 2;
    const immediate = await api.editor.runCommand('printf immediate-one\nprintf immediate-two', { ...options, id: 90_006 });
    assert.equal(immediate.exitCode, 0);
    assert.match(immediate.output, /immediate-oneimmediate-two/);

    known = false;
    listener = undefined;
    const cancel = new AbortController();
    const interrupted = api.editor.runCommand('printf never\nprintf submitted', { ...options, id: 90_003, signal: cancel.signal });
    await waitForListener();
    cancel.abort();
    assert.deepEqual(await interrupted, { output: '', notStarted: true });

    known = false;
    listener = undefined;
    const timeout = api.editor.runCommand('printf identity-timeout\n', { ...options, id: 90_004 });
    await waitForListener();
    const result = await Promise.race([timeout, sleep(INTERRUPT_WAIT_MS).then(() => undefined)]);
    assert.ok(result, 'the unknown-shell timeout did not settle');
    assert.match(result.output, /identity-timeout/);

    known = false;
    listener = undefined;
    const closing = api.editor.runCommand('printf closed\nprintf never', { ...options, id: 90_007 });
    await waitForListener();
    terminal.dispose();
    await assert.rejects(closing, /Terminal closed before command submission/);
    console.log('ShellIdentity: delayed Bash, interruption and unknown-shell timeout use a real terminal');
  } finally {
    Object.defineProperty(terminal, 'state', originalState);
    Object.defineProperty(vscode.window, 'onDidChangeTerminalState', originalEvent);
    await closeTerminals();
  }
}

/** A foreign shell execution protects its terminal from reuse by Pair. */
async function foreignTerminalExecution(api: Api): Promise<void> {
  const { controller } = api;
  controller.setConfirmCommands(false);
  controller.setSpeed(20);
  await closeTerminals();
  const initialCommand = 'printf pair-initial';
  const initialStarted = Promise.withResolvers<vscode.TerminalShellExecutionStartEvent>();
  const initialEnded = Promise.withResolvers<vscode.TerminalShellExecutionEndEvent>();
  let initialExecution: vscode.TerminalShellExecution | undefined;
  let initialTerminal: vscode.Terminal | undefined;
  let foreign: vscode.TerminalShellExecution | undefined;
  let foreignOutput = '';
  const terminalTrace: Array<{
    kind: 'start' | 'end' | 'close';
    terminal: vscode.Terminal;
    execution?: vscode.TerminalShellExecution;
    command?: string;
    confidence?: vscode.TerminalShellExecutionCommandLineConfidence;
    trusted?: boolean;
    exitCode?: number;
  }> = [];
  function record(event: (typeof terminalTrace)[number]): void {
    if (terminalTrace.length < MAX_TERMINAL_TRACE) terminalTrace.push(event);
  }
  const traceListeners = [
    vscode.window.onDidStartTerminalShellExecution((event) => {
      const command = event.execution.commandLine;
      record({
        kind: 'start',
        terminal: event.terminal,
        execution: event.execution,
        command: command.value.slice(0, MAX_TRACE_COMMAND),
        confidence: command.confidence,
        trusted: command.isTrusted,
      });
    }),
    vscode.window.onDidEndTerminalShellExecution((event) => {
      const command = event.execution.commandLine;
      record({
        kind: 'end',
        terminal: event.terminal,
        execution: event.execution,
        command: command.value.slice(0, MAX_TRACE_COMMAND),
        confidence: command.confidence,
        trusted: command.isTrusted,
        exitCode: event.exitCode,
      });
    }),
    vscode.window.onDidCloseTerminal((terminal) => {
      record({ kind: 'close', terminal });
    }),
  ];
  const startListener = vscode.window.onDidStartTerminalShellExecution((event) => {
    if (event.execution.commandLine.value === initialCommand) {
      initialExecution = event.execution;
      initialTerminal = event.terminal;
      initialStarted.resolve(event);
    }
  });
  const endListener = vscode.window.onDidEndTerminalShellExecution((event) => {
    if (event.execution === initialExecution && event.terminal === initialTerminal) initialEnded.resolve(event);
  });
  try {
    await controller.start('foreign terminal execution');
    await controller.step([{ run: initialCommand, wait: 5 }]);
    const initial = await controller.step([]);
    assert.ok(
      initial.batches.some((batch) => batch.status === 'completed'),
      JSON.stringify(initial),
    );
    const initialRun = initial.batches.flatMap((batch) => batch.runs ?? []).find((run) => run.command === initialCommand);
    assert.ok(initialRun, JSON.stringify(initial));
    assert.equal(initialRun.running, undefined, 'Pair did not finish waiting for its initial command');
    assert.equal(initialRun.exit_code, 0, 'Pair did not report a successful initial command');
    const started = await Promise.race([
      initialStarted.promise,
      sleep(INTERRUPT_WAIT_MS).then(() => {
        throw new Error('initial shell command did not start');
      }),
    ]);
    const ended = await Promise.race([
      initialEnded.promise,
      sleep(INTERRUPT_WAIT_MS).then(() => {
        throw new Error('initial shell command did not end');
      }),
    ]);
    assert.equal(ended.execution, started.execution);
    assert.equal(ended.terminal, started.terminal);
    assert.equal(ended.exitCode, 0);
    const terminal = started.terminal;
    assert.ok(terminal.shellIntegration, 'Pair terminal has no shell integration');
    assert.ok(vscode.window.terminals.includes(terminal), 'Pair terminal closed after the initial command');
    const command = 'printf foreign-terminal-command';
    const foreignEnded = Promise.withResolvers<vscode.TerminalShellExecutionEndEvent>();
    const foreignListener = vscode.window.onDidEndTerminalShellExecution((event) => {
      if (event.terminal === terminal && event.execution === foreign) foreignEnded.resolve(event);
    });
    try {
      foreign = terminal.shellIntegration.executeCommand(command);
      const output = (async () => {
        for await (const chunk of foreign.read()) foreignOutput += chunk;
        return foreignOutput;
      })();
      const completed = await Promise.race([
        foreignEnded.promise,
        sleep(INTERRUPT_WAIT_MS).then(() => {
          throw new Error('foreign shell command did not end');
        }),
      ]);
      assert.equal(completed.execution, foreign);
      assert.equal(completed.execution.commandLine.value, command);
      const text = await Promise.race([
        output,
        sleep(INTERRUPT_WAIT_MS).then(() => {
          throw new Error('foreign shell output did not close');
        }),
      ]);
      assert.match(text, /foreign-terminal-command/);
    } finally {
      foreignListener.dispose();
    }
    await controller.step([{ run: 'printf pair-after-foreign', wait: 5 }]);
    const after = await controller.step([]);
    assert.ok(
      after.batches.some((batch) => batch.status === 'completed'),
      JSON.stringify(after),
    );
    assert.ok(vscode.window.terminals.includes(terminal), 'the foreign terminal was closed');
    assert.ok(
      vscode.window.terminals.some((other) => other !== terminal),
      'Pair reused the foreign terminal',
    );
    console.log('a foreign terminal execution keeps its terminal separate from the next Pair run');
  } catch (error) {
    // Collect silently during the test: logging can perturb the timing under investigation.
    console.error(
      'Foreign terminal failure trace:',
      JSON.stringify({
        output: foreignOutput.slice(-MAX_TRACE_OUTPUT),
        terminalOpen: initialTerminal !== undefined && vscode.window.terminals.includes(initialTerminal),
        shell: initialTerminal?.state.shell,
        dimensions: initialTerminal === undefined ? undefined : (Reflect.get(initialTerminal, 'dimensions') as unknown),
        events: terminalTrace.map((event) => ({
          kind: event.kind,
          sameTerminal: event.terminal === initialTerminal,
          sameInitial: event.execution !== undefined && event.execution === initialExecution,
          sameForeign: event.execution !== undefined && event.execution === foreign,
          command: event.command,
          confidence: event.confidence,
          trusted: event.trusted,
          exitCode: event.exitCode,
        })),
      }),
    );
    throw error;
  } finally {
    for (const listener of traceListeners) listener.dispose();
    startListener.dispose();
    endListener.dispose();
    controller.endSession();
    await closeTerminals();
  }
}

/** Diagnostic observers cannot disrupt an actual session when they throw. */
async function diagnosticObserverFailure(api: Api): Promise<void> {
  const { controller } = api;
  const original = controller.onDiagnostic;
  let seen = 0;
  controller.onDiagnostic = () => {
    seen++;
    throw new Error('test diagnostic observer');
  };
  try {
    const report = await controller.start('diagnostic observer failure');
    assert.equal(report.turn, 'agent');
    controller.pause();
    assert.equal(controller.isPaused, true);
    controller.resume();
    assert.equal(controller.isPaused, false);
    controller.endSession();
    assert.ok(seen >= 3, 'the throwing observer was not exercised');
  } finally {
    controller.onDiagnostic = original;
    controller.endSession();
  }
  console.log('a throwing diagnostic observer does not change the session');
}

/** A synchronous speech-settings failure must not prevent the real reading. */
async function narrationSettingsFailure(api: Api): Promise<void> {
  const { controller } = api;
  const original = Object.getOwnPropertyDescriptor(vscode.workspace, 'getConfiguration');
  assert.ok(original, 'VS Code did not expose getConfiguration');
  const getConfiguration = vscode.workspace.getConfiguration.bind(vscode.workspace);
  const text = 'Read this despite an injected settings failure.';
  let failures = 0;
  const inspected: string[] = [];
  controller.setSpeed(20);
  try {
    await controller.start('narration settings failure');
    Object.defineProperty(vscode.workspace, 'getConfiguration', {
      ...original,
      value: (section?: string, scope?: vscode.ConfigurationScope) => {
        const settings = getConfiguration(section, scope);
        if (section !== 'aiPair') return settings;
        return new Proxy(
          {},
          {
            get(target, key) {
              void target;
              if (key !== 'get') {
                const member: unknown = Reflect.get(settings, key);
                if (typeof member === 'function') {
                  const bound: unknown = member.bind(settings);
                  return bound;
                }
                return member;
              }
              const read = settings.get.bind(settings);
              return (...args: unknown[]) => {
                if (typeof args[0] === 'string') inspected.push(args[0]);
                if (
                  args[0] === 'speech.enabled' &&
                  failures === 0 &&
                  api.history().some((event) => event.type === 'say' && event.text === text)
                ) {
                  failures++;
                  throw new Error('injected speech settings failure');
                }
                const value: unknown = Reflect.apply(read, undefined, args);
                return value;
              };
            },
          },
        );
      },
    });
    try {
      await controller.step([{ say: text, speak: true }]);
      const report = await Promise.race([controller.step([]), sleep(INTERRUPT_WAIT_MS).then(() => undefined)]);
      assert.ok(report, 'the narration failure left the session pending');
      assert.equal(
        failures,
        1,
        `the injected speech settings boundary was not reached; reads=${JSON.stringify(inspected)} report=${JSON.stringify(report)}`,
      );
      assert.ok(
        report.batches.some((batch) => batch.status === 'completed'),
        JSON.stringify(report),
      );
      assert.ok(
        api.history().some((event) => event.type === 'say' && event.text === text),
        'the reading was not displayed',
      );
    } finally {
      Object.defineProperty(vscode.workspace, 'getConfiguration', original);
    }
    const after = 'Reading still works after restoring the settings API.';
    await controller.step([{ say: after, speak: true }]);
    const recovered = await Promise.race([controller.step([]), sleep(INTERRUPT_WAIT_MS).then(() => undefined)]);
    assert.ok(
      recovered !== undefined && recovered.batches.some((batch) => batch.status === 'completed'),
      'the following reading did not complete',
    );
    assert.ok(api.history().some((event) => event.type === 'say' && event.text === after));
    console.log('an injected synchronous speech-settings failure leaves reading and the next say usable');
  } finally {
    Object.defineProperty(vscode.workspace, 'getConfiguration', original);
    controller.endSession();
  }
}

/** VS Code diagnostics remain visible on each edit while the snapshot caveat appears once. */
export async function diagnosticSnapshotCaveat(api: Api): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, 'workspace not found');
  const name = 'integration-diagnostic-snapshot.txt';
  const filename = path.join(folder.uri.fsPath, name);
  const uri = vscode.Uri.file(filename);
  const collection = vscode.languages.createDiagnosticCollection('integration-snapshot');
  fs.writeFileSync(filename, 'add\n');
  const diagnostic = new vscode.Diagnostic(new vscode.Range(0, 0, 0, 3), '"add" is not defined', vscode.DiagnosticSeverity.Error);
  diagnostic.source = 'Pylance';
  collection.set(uri, [diagnostic]);
  const { controller } = api;
  const caveat = 'VS Code diagnostics are snapshots; freshness is not confirmed.';
  controller.setSpeed(20);
  try {
    await controller.start('diagnostic snapshots');
    await controller.read(name);
    for (let index = 0; index < 2; index++) {
      await controller.step([{ move: { file: name, line: 1, to: 'line_end' } }, { type_fast: `x${CURSOR_MARKER}` }]);
      const report = await controller.step([]);
      const batch = report.batches.find((item) => item.status === 'completed');
      assert.ok(batch, JSON.stringify(report));
      assert.ok(batch.diagnostics?.some((item) => item.message === '"add" is not defined' && item.source === 'Pylance') === true);
      assert.equal(batch.warnings?.includes(caveat) === true, index === 0);
    }
  } finally {
    collection.dispose();
    controller.endSession();
    fs.rmSync(filename, { force: true });
  }
}

/** An injected EditorPort diagnostics rejection is advisory and the next check recovers. */
export async function editorDiagnosticsFailure(api: Api): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, 'workspace not found');
  const name = 'integration-diagnostics-failure.txt';
  const filename = path.join(folder.uri.fsPath, name);
  fs.writeFileSync(filename, 'a\n');
  const { controller, editor } = api;
  const original = Object.getOwnPropertyDescriptor(editor, 'diagnostics');
  let checks = 0;
  controller.setSpeed(20);
  try {
    await controller.start('editor diagnostic failure');
    await controller.read(name);
    Object.defineProperty(editor, 'diagnostics', {
      configurable: true,
      writable: true,
      value: () => {
        checks++;
        return Promise.reject(new Error('injected editor diagnostics failure'));
      },
    });
    try {
      await controller.step([{ move: { file: name, line: 1, to: 'line_end' } }, { type_fast: `x${CURSOR_MARKER}` }]);
      const report = await controller.step([]);
      assert.equal(checks, 1, 'the injected EditorPort boundary was not reached');
      assert.ok(
        report.batches.some(
          (batch) => batch.status === 'completed' && batch.warnings?.includes('Diagnostics unavailable for an edited file.') === true,
        ),
        JSON.stringify(report),
      );
      assert.equal(fs.readFileSync(filename, 'utf8'), 'ax\n');
    } finally {
      if (original === undefined) Reflect.deleteProperty(editor, 'diagnostics');
      else Object.defineProperty(editor, 'diagnostics', original);
    }
    await controller.step([{ move: { file: name, line: 1, to: 'line_end' } }, { type_fast: `y${CURSOR_MARKER}` }]);
    const recovered = await controller.step([]);
    assert.ok(
      recovered.batches.some((batch) => batch.status === 'completed'),
      JSON.stringify(recovered),
    );
    assert.ok(recovered.batches.every((batch) => batch.warnings?.includes('Diagnostics unavailable for an edited file.') !== true));
    assert.equal(fs.readFileSync(filename, 'utf8'), 'axy\n');
    console.log('an injected EditorPort diagnostics failure remains advisory and the next check recovers');
  } finally {
    if (original === undefined) Reflect.deleteProperty(editor, 'diagnostics');
    else Object.defineProperty(editor, 'diagnostics', original);
    controller.endSession();
  }
}

/** A late EditorPort diagnostic cannot attach an old edit to a replacement session. */
export async function delayedDiagnosticsAfterReplacement(api: Api): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, 'workspace not found');
  const name = 'integration-diagnostics-replaced.txt';
  const filename = path.join(folder.uri.fsPath, name);
  fs.writeFileSync(filename, 'a\n');
  const { controller, editor } = api;
  const own = Object.getOwnPropertyDescriptor(editor, 'diagnostics');
  const diagnostics = editor.diagnostics.bind(editor);
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const settled = Promise.withResolvers<void>();
  const oldWarning = 'Delayed diagnostic from the old session';
  controller.setSpeed(20);
  try {
    await controller.start('old diagnostic session');
    await controller.read(name);
    Object.defineProperty(editor, 'diagnostics', {
      configurable: true,
      writable: true,
      value: async (file: string) => {
        entered.resolve();
        await release.promise;
        try {
          const checked = await diagnostics(file);
          return { ...checked, warnings: [...checked.warnings, oldWarning] };
        } finally {
          settled.resolve();
        }
      },
    });
    const first = await controller.step([{ move: { file: name, line: 1, to: 'line_end' } }, { type_fast: `x${CURSOR_MARKER}` }]);
    const oldId = first.submitted?.id;
    assert.equal(oldId, 1, 'the old session must start with batch 1');
    await Promise.race([
      entered.promise,
      sleep(INTERRUPT_WAIT_MS).then(() => {
        throw new Error('old diagnostic did not enter');
      }),
    ]);
    controller.endSession();
    const replacement = await controller.start('replacement diagnostic session');
    assert.deepEqual(replacement.batches, []);
    if (own === undefined) Reflect.deleteProperty(editor, 'diagnostics');
    else Object.defineProperty(editor, 'diagnostics', own);
    release.resolve();
    await Promise.race([
      settled.promise,
      sleep(INTERRUPT_WAIT_MS).then(() => {
        throw new Error('old diagnostic did not settle');
      }),
    ]);
    await controller.read(name);
    const submission = await controller.step([{ move: { file: name, line: 1, to: 'line_end' } }, { type_fast: `y${CURSOR_MARKER}` }]);
    const report = await controller.step([]);
    assert.equal(submission.submitted?.id, 1, 'the fresh replacement must start with batch 1');
    const batches = [...submission.batches, ...report.batches];
    assert.equal(batches.length, 1, JSON.stringify(batches));
    assert.equal(batches[0]?.id, 1);
    assert.equal(batches[0]?.status, 'completed');
    assert.ok(
      batches.every((batch) => batch.warnings?.includes(oldWarning) !== true),
      'the old diagnostic reached the replacement session',
    );
    assert.equal(fs.readFileSync(filename, 'utf8'), 'axy\n');
    console.log('late diagnostics from an ended session do not affect its replacement');
  } finally {
    release.resolve();
    if (own === undefined) Reflect.deleteProperty(editor, 'diagnostics');
    else Object.defineProperty(editor, 'diagnostics', own);
    controller.endSession();
  }
}

/** Interrupts normal typing after it passes the marker, preserving its exact unplayed suffix. */
async function interruptedTypingAfterMarker(api: Api): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, 'workspace not found');
  const filename = path.join(folder.uri.fsPath, 'integration-interrupt-after-marker.txt');
  fs.writeFileSync(filename, '\n');
  const document = await vscode.workspace.openTextDocument(filename);
  const settings = vscode.workspace.getConfiguration('aiPair');
  const global = vscode.ConfigurationTarget.Global;
  const controller = api.controller;
  const suffix = 'cdefghijklmnopqrstuvwxyz';
  await settings.update(
    'timing',
    {
      type: { charMs: 90, jitter: 0, wordStartMs: 0, punctuationMs: 0, openBracketMs: 0, newlineMs: 0 },
      beforeMoveMs: 0,
      afterMoveNearMs: 0,
      afterMoveFarMs: 0,
    },
    global,
  );
  controller.setSpeed(1);
  controller.setCodePlayback('typing');
  try {
    await controller.start('interrupt typing after marker');
    await controller.read('integration-interrupt-after-marker.txt');
    await controller.step([
      { move: { file: 'integration-interrupt-after-marker.txt', line: 1, to: 'line_end' } },
      { type: `ab${CURSOR_MARKER}${suffix}` },
    ]);
    const pending = controller.step([]);
    for (let i = 0; i < POLLS && document.lineAt(0).text.length < 5; i++) await sleep(POLL_MS);
    const typed = document.lineAt(0).text;
    assert.ok(typed.startsWith('abcde') && typed.length < 2 + suffix.length, `typing did not stop within the suffix: ${typed}`);
    controller.userInterrupt();
    const report = await pending;
    const interrupted = report.batches.find((batch) => batch.status === 'interrupted');
    assert.ok(interrupted, 'the typing batch was not interrupted');
    const rest = interrupted.unplayed?.[0];
    assert.ok(rest && 'type' in rest, 'the unplayed typing suffix was not reported');
    const finalText = document.lineAt(0).text;
    assert.equal(rest.type, CURSOR_MARKER + suffix.slice(finalText.length - 2));
    assert.equal(finalText + rest.type.replace(CURSOR_MARKER, ''), `ab${suffix}`);
    console.log('TypeAfter: interruption after the cursor marker reports the exact remaining suffix');
  } finally {
    controller.endSession();
    controller.setSpeed(20);
    await settings.update('timing', undefined, global);
  }
}

/** Keeps a displayed narration readable if its optional speech port throws synchronously. */
export async function synchronousNarrationFailure(api: Api): Promise<void> {
  const events: PanelEvent[] = [];
  let attempts = 0;
  // Use the extension's loaded constructor so coverage records the real source-mapped core bundle.
  const LoadedController = z.custom<typeof Controller>((value) => typeof value === 'function').parse(api.controller.constructor);
  const controller = new LoadedController(
    api.editor,
    {
      post: (event) => {
        events.push(event);
      },
    },
    undefined,
    {
      speak: () => {
        attempts++;
        throw new Error('injected synchronous speech failure');
      },
      attentionCue: () => Promise.resolve(),
      pause: () => {},
      resume: () => {},
      cancel: () => {},
    },
  );
  controller.setReadingSpeed(20);
  const trace: string[] = [];
  controller.trace = (line) => {
    trace.push(line);
  };
  let started = false;
  try {
    await controller.start('synchronous narration failure');
    started = true;
    const submitted = await controller.step([{ say: 'Still readable.', speak: true }]);
    assert.equal(submitted.rejected, undefined);
    const report = await controller.step([]);
    assert.equal(attempts, 1);
    assert.ok(events.some((event) => event.type === 'say' && event.text === 'Still readable.'));
    assert.ok(events.some((event) => event.type === 'reading'));
    assert.equal(report.batches[0]?.status, 'completed');
  } finally {
    if (started) {
      controller.endSession();
      await controller.step([]);
      assert.equal(controller.isActive, false);
      assert.ok(trace.includes('session closed'));
    }
  }
}

/** Runs a command with the setting that shows terminals, then shows its terminal again from the panel. */
export async function gapPaths(api: Api): Promise<void> {
  const { controller } = api;
  const settings = vscode.workspace.getConfiguration('aiPair');
  const global = vscode.ConfigurationTarget.Global;
  assert.equal(await vscode.commands.executeCommand('aiPair.localAudio.workspace', {}), false);
  controller.setConfirmCommands(false);
  controller.setSpeed(20);
  await controller.start('gaps');
  await settings.update('showTerminalsAutomatically', true, global);
  await controller.step([{ run: 'sleep 2', wait: 0.5 }]);
  const id = await runShown(api, 'sleep 2', 'running');
  api.panelMessage({ type: 'showTerminal', id });
  await runEnded(api, 'sleep 2');
  await settings.update('showTerminalsAutomatically', undefined, global);
  await controller.step([]);
  controller.endSession();
  console.log('the terminals: one shown by the setting and again from the panel');
  await interruptedTerminalStart(api);
  await terminalCreationFailure(api);
  await terminalOutputReadFailure(api);
  await closedRunningTerminal(api);
  await unrelatedTerminalEnd(api);
  await interruptRunningCommand(api);
  await terminalWithoutReportedCwd(api);
  await terminalEndWithoutStatus(api);
  await delayedShellIdentity(api);
  await foreignTerminalExecution(api);
  await diagnosticObserverFailure(api);
  await narrationSettingsFailure(api);
  await synchronousNarrationFailure(api);
  await diagnosticSnapshotCaveat(api);
  await editorDiagnosticsFailure(api);
  await delayedDiagnosticsAfterReplacement(api);
  await interruptedTypingAfterMarker(api);
}
