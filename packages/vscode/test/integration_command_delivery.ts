// Exercises command-result wakeup with a real player and terminal in VS Code.
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as vscode from 'vscode';
import { defaultConfig } from '@ai-pair/core';
import { REPORT_SCHEMA } from '@ai-pair/protocol';
import type { Api } from '../src/extension';

/** Waits for a condition without advancing the controller's heartbeat. */
async function waitFor(predicate: () => boolean, description: string): Promise<void> {
  const deadline = Date.now() + 8000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, description);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 20);
    });
  }
}

/** Bounds a native test wait and clears its timer after settlement. */
async function within<T>(promise: Promise<T>, message: string, timeoutMs = 8000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(message));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Delivers a real command result while a later accepted batch is still playing. */
export async function commandDeliveryPaths(api: Api): Promise<void> {
  const { controller } = api;
  const originalTerminals = new Set(vscode.window.terminals);
  const confirmCommands = vscode.workspace.getConfiguration('aiPair').get<boolean>('confirmCommands', true);
  const previousTrace = controller.trace;
  const traces: string[] = [];
  let releaseFile: string | undefined;
  controller.trace = (line) => {
    traces.push(line);
    previousTrace?.(line);
  };
  controller.setConfirmCommands(false);
  try {
    for (const kind of ['listen', 'empty step'] as const) {
      traces.length = 0;
      const priorHistory = new Set(api.history());
      await controller.start(`command delivery ${kind}`);
      const first = await controller.step([{ run: 'sleep 2; printf command-delivery-first' }]);
      assert.equal(first.submitted?.status, 'playing');
      const cancel = new AbortController();
      const queued = controller.step(
        [{ say: 'A later explanation remains visible while the first command result is delivered. '.repeat(2) }],
        cancel.signal,
      );
      await waitFor(() => traces.some((line) => line.startsWith('batch 2 queued:')), 'later batch was not accepted');
      assert.ok(
        api.history().some((event) => !priorHistory.has(event) && event.type === 'state' && event.ready === 1),
        'queued work was not shown as ready',
      );
      cancel.abort();
      await assert.rejects(queued, /cancel/i);
      const began = Date.now();
      const waiting = kind === 'listen' ? controller.listen() : controller.step([]);
      const result = await within(waiting, `${kind} did not receive the command result promptly`);
      assert.ok(Date.now() - began < 8000, `${kind} waited too long`);
      assert.equal(result.waiting, undefined, 'result waited for the heartbeat');
      assert.deepEqual(
        result.batches.map((batch) => batch.id),
        [1],
      );
      assert.equal(result.batches[0]?.runs?.[0]?.command, 'sleep 2; printf command-delivery-first');
      assert.match(result.batches[0]?.runs?.[0]?.output ?? '', /command-delivery-first/);
      assert.ok(traces.includes('batch 2 playing'), 'later work had not started');
      assert.ok(!traces.includes('batch 2 completed'), 'later work had already completed');
      const later = await within(controller.step([]), 'later batch did not finish', 20_000);
      assert.deepEqual(
        later.batches.map((batch) => batch.id),
        [2],
        'command result was lost or repeated',
      );
      assert.equal(later.batches[0]?.status, 'completed');
      await controller.end();
      for (const terminal of vscode.window.terminals) {
        if (!originalTerminals.has(terminal)) terminal.dispose();
      }
      await waitFor(() => vscode.window.terminals.every((terminal) => originalTerminals.has(terminal)), 'test terminals did not close');
    }
    // A quiet completed batch is not command news: an empty step must wait for later work.
    traces.length = 0;
    await controller.start('quiet delivery');
    const first = await controller.step([{ say: 'The first quiet explanation is still playing.' }]);
    assert.equal(first.submitted?.status, 'playing');
    const abort = new AbortController();
    const queued = controller.step(
      [{ say: 'The later quiet explanation remains visible while the empty step is waiting. '.repeat(2) }],
      abort.signal,
    );
    await waitFor(() => traces.some((line) => line.startsWith('batch 2 queued:')), 'later quiet batch was not accepted');
    abort.abort();
    await assert.rejects(queued, /cancel/i);
    await waitFor(() => traces.includes('batch 2 playing'), 'later quiet batch did not start');
    assert.ok(!traces.includes('batch 2 completed'), 'later quiet batch already completed');
    let returned = false;
    const empty = controller.step([]).then((report) => {
      returned = true;
      return report;
    });
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 100);
    });
    assert.equal(returned, false, 'quiet completion incorrectly woke the empty step');
    const report = await within(empty, 'quiet batches did not finish', 20_000);
    assert.deepEqual(
      report.batches.map((batch) => batch.id),
      [1, 2],
    );
    assert.ok(report.batches.every((batch) => batch.status === 'completed' && batch.runs === undefined));
    await controller.end();
    console.log('CommandDelivery NoQuietWake: empty step waited for later work after quiet completion');

    // Verify the Bash workaround through the actual extension and shell integration.
    await controller.start('Bash heredoc command');
    const identifyFirst = await within(controller.step([{ run: 'printf shell-ready', wait: 5 }]), 'shell probe did not start');
    const identifySecond = await within(controller.step([]), 'shell probe did not complete');
    const identified = [identifyFirst, identifySecond].flatMap((result) => result.batches.flatMap((batch) => batch.runs ?? []))[0];
    assert.ok(identified, 'shell probe did not report a run');
    const shellTerminal = vscode.window.terminals.find((terminal) => !originalTerminals.has(terminal));
    if (process.platform === 'linux') {
      assert.ok(shellTerminal, 'the Bash probe did not create a terminal');
      await waitFor(() => shellTerminal.state.shell === 'bash', 'Linux integration did not identify the Bash shell');
    }
    if (process.platform === 'linux' || identified.shell === 'bash') {
      const command = "cat <<'PAIR_END' | tail -n 1\nalpha\nbeta\nPAIR_END";
      const initial = await within(controller.step([{ run: command, wait: 5 }]), 'heredoc did not start');
      const completed = await within(controller.step([]), 'heredoc did not complete');
      const observed = [initial, completed].flatMap((result) => result.batches.flatMap((batch) => batch.runs ?? []))[0];
      assert.equal(observed?.exit_code, 0, 'Bash heredoc did not report its observed exit');
      assert.equal(observed.shell, 'bash', 'the heredoc did not use the identified Bash shell');
      assert.match(observed.output, /beta/, 'Bash heredoc output was not captured');
      assert.equal(observed.command, command, 'report changed the approved command');
      const controls = "printf '%s' 'a\\b\r\u0001' | od -An -tx1\n";
      const submitted = await within(controller.step([{ run: controls, wait: 5 }]), 'control-character command did not start');
      const finished = await within(controller.step([]), 'control-character command did not finish');
      const result = [submitted, finished].flatMap((reply) => reply.batches.flatMap((batch) => batch.runs ?? []))[0];
      assert.equal(result?.exit_code, 0);
      assert.equal(result.command, controls);
      assert.match(result.output, /61 5c 62 0d 01/);
    }
    await controller.end();

    // A returned report from a previous session must not be revived in a replacement session.
    await controller.start('predecessor report');
    controller.userMessage('predecessor-only message');
    const predecessor = await within(controller.listen(), 'predecessor report did not arrive');
    assert.ok(predecessor.events.some((event) => event.kind === 'message' && event.text === 'predecessor-only message'));
    await controller.end();
    const replacementStart = await controller.start('replacement report');
    assert.match(predecessor.sessionId ?? '', /\S/);
    assert.match(replacementStart.sessionId ?? '', /\S/);
    assert.notEqual(predecessor.sessionId, replacementStart.sessionId);
    // Exercise the wire representation rather than preserving object identity.
    // oxlint-disable-next-line unicorn/prefer-structured-clone
    controller.restore(REPORT_SCHEMA.parse(JSON.parse(JSON.stringify(predecessor))));
    controller.setTimeouts({ maxBlockMs: 250 });
    const replacement = await within(controller.listen(), 'replacement listen did not return');
    assert.equal(replacement.waiting, true);
    assert.ok(!replacement.events.some((event) => event.kind === 'message' && event.text === 'predecessor-only message'));
    await controller.end();

    if (process.platform === 'linux') {
      // Observe approval, running, and an eventually truncated output tail through real VS Code.
      controller.setConfirmCommands(true);
      await controller.start('approval and late output');
      const release = `/tmp/ai-pair-62-native-${process.pid}`;
      releaseFile = release;
      fs.rmSync(release, { force: true });
      const command = `while [ ! -f '${release}' ]; do sleep 0.05; done; head -c 52000 /dev/zero | tr '\\0' X; printf LATE-END`;
      const initial = await controller.step([{ run: command, wait: 0.3 }]);
      assert.equal(initial.submitted?.status, 'playing');
      await waitFor(
        () => api.history().some((event) => event.type === 'run' && event.command === command && event.phase === 'confirm'),
        'command approval was not shown',
      );
      const approval = await within(controller.listen(), 'approval report did not return');
      const pending = approval.commands?.find((item) => item.command === command);
      assert.equal(pending?.phase, 'confirm');
      controller.decideRun(pending.id, true);
      await waitFor(
        () => api.history().some((event) => event.type === 'run' && event.command === command && event.phase === 'running'),
        'approved command did not start',
      );
      const active = await within(controller.listen(), 'active command report did not return');
      assert.equal(
        active.commands?.some((item) => item.id === pending.id && item.phase === 'running'),
        true,
      );
      const alreadyReported = active.batches.some(
        (batch) => batch.runs?.some((run) => run.id === pending.id && run.running === true) === true,
      );
      if (!alreadyReported) {
        const background = await within(controller.step([]), 'background command did not report');
        assert.ok(background.batches.some((batch) => batch.runs?.some((run) => run.id === pending.id && run.running === true) === true));
      }
      controller.setTimeouts({ maxBlockMs: 5000 });
      fs.writeFileSync(release, '');
      const completion = await within(controller.listen(), 'late command output was not delivered');
      const news = completion.events.find((event) => event.kind === 'command_exit' && event.id === pending.id);
      assert.ok(news && news.kind === 'command_exit');
      assert.equal(news.exit_code, 0);
      assert.equal(news.truncated, true);
      assert.match(news.output, /LATE-END$/);
      assert.ok(news.output.length <= 12_000);
      await controller.end();
      fs.rmSync(release, { force: true });
      releaseFile = undefined;
      controller.setConfirmCommands(false);
    }

    console.log('CommandDelivery: listen and empty step deliver command output once while later work plays');
  } catch (error) {
    console.error('CommandDelivery trace:', JSON.stringify(traces));
    throw error;
  } finally {
    if (releaseFile !== undefined) fs.writeFileSync(releaseFile, '');
    controller.endSession();
    if (releaseFile !== undefined) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 100);
      });
      fs.rmSync(releaseFile, { force: true });
    }
    for (const terminal of vscode.window.terminals) {
      if (!originalTerminals.has(terminal)) terminal.dispose();
    }
    controller.trace = previousTrace;
    controller.setTimeouts({ maxBlockMs: defaultConfig.maxBlockMs });
    controller.setConfirmCommands(confirmCommands);
    await waitFor(() => vscode.window.terminals.every((terminal) => originalTerminals.has(terminal)), 'test terminals did not close');
  }
}
