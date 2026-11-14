import { afterEach, describe, expect, it } from 'vitest';
import { deadline } from './scripted_agent_harness';

describe('scripted agent watchdog', () => {
  it('identifies a hung operation with its seed and trace', async () => {
    await expect(deadline(new Promise(() => {}), 10, 17, ['start', 'listen'])).rejects.toThrow(
      'seed 17: timed out after 10ms; trace: start -> listen',
    );
  });
});

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Bridge, Controller, type NarrationPort } from '@ai-pair/core';
import { FakeEditor, FakePanel, testConfig } from '../../core/test/fake';
import { EditorLink } from '../src/link';
import { createServer } from '../src/server';

function noop(): void {}

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0)) await dispose();
});

/** Builds a real MCP-to-websocket path with a deterministic in-memory editor. */
async function setup(seed: number, narration?: NarrationPort) {
  const trace: string[] = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-pair-script-'));
  const editor = new FakeEditor();
  const panel = new FakePanel();
  editor.files.set(editor.resolvePath('src/a.ts'), '');
  const controller = new Controller(
    editor,
    panel,
    {
      ...testConfig,
      timing: { ...testConfig.timing, reading: { msPerChar: 0, minMs: 1 }, beforeMoveMs: 1 },
    },
    narration,
  );
  editor.controller = controller;
  const bridge = new Bridge(controller, {
    dir,
    runtime: { version: 'test', build: 'test', relayHash: 'test' },
    workspaceFolders: () => ['/project'],
    calibrate: () => true,
    trace: (line) => {
      trace.push(line);
    },
  });
  const clients: Client[] = [];
  const links: EditorLink[] = [];
  const servers: Array<ReturnType<typeof createServer>> = [];
  cleanup.push(async () => {
    controller.endSession();
    for (const client of clients) await client.close();
    for (const server of servers) await server.close();
    for (const link of links) link.close();
    bridge.dispose();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  await bridge.start();
  async function connect(): Promise<Client> {
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const link = new EditorLink('/project/src', dir);
    links.push(link);
    const server = createServer(link, 'GUIDE', '/project/src');
    servers.push(server);
    await server.connect(serverSide);
    const client = new Client({ name: 'scripted-agent', version: '0' });
    await client.connect(clientSide);
    clients.push(client);
    return client;
  }
  async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
    trace.push(`script ${name}`);
    const result = await deadline(client.callTool({ name, arguments: args }), 2000, seed, trace);
    expect(result.isError, `seed ${seed}; trace: ${trace.join(' -> ')}`).not.toBe(true);
    const text = result.content;
    expect(Array.isArray(text)).toBe(true);
    return JSON.stringify(text);
  }
  async function waitFor(label: string, predicate: () => boolean) {
    trace.push(`wait ${label}`);
    let timer: ReturnType<typeof setInterval> | undefined;
    try {
      await deadline(
        new Promise<void>((resolve) => {
          function check() {
            if (predicate()) resolve();
          }
          check();
          timer = setInterval(check, 5);
        }),
        2000,
        seed,
        trace,
      );
    } finally {
      clearInterval(timer);
    }
  }
  return { bridge, controller, editor, panel, connect, call, waitFor, trace };
}

describe('scripted agent flows', () => {
  for (const seed of [17, 42, 99, 100, 101, 102, 103, 104]) {
    it(`delivers a batch and programmer events (seed ${seed})`, async () => {
      const h = await setup(seed);
      const client = await h.connect();
      await h.call(client, 'start');
      const first = await h.call(client, 'step', { actions: [{ say: `seed ${seed}` }] });
      expect(first).toContain('Batch 1 is playing');
      function message() {
        h.controller.userMessage(`reply-${seed}`);
      }
      function edit() {
        h.editor.userEdit('src/a.ts', { offset: 0, deleteLength: 0, text: `${seed}` });
      }
      for (const event of seed % 2 === 0 ? [message, edit] : [edit, message]) event();
      const report = await h.call(client, 'step', { actions: [] });
      expect(report).toContain('Batch 1');
      expect(report).toContain(`reply-${seed}`);
      expect(h.editor.text('src/a.ts')).toBe(`${seed}`);
      h.controller.userMessage(`next-${seed}`);
      const next = await h.call(client, 'listen');
      expect(next).toContain(`next-${seed}`);
      expect(next).not.toContain(`reply-${seed}`);
      await h.call(client, 'end');
    });
  }

  it('reports a typing pause and unsaved programmer edits before the listen timeout', async () => {
    const h = await setup(590);
    h.controller.setTimeouts({ navigatorIdleMs: 50, maxBlockMs: 1000 });
    const client = await h.connect();
    await h.call(client, 'start');
    h.controller.takeTurn();
    await h.call(client, 'listen');
    const listening = h.call(client, 'listen');
    await h.waitFor('listen received', () => h.trace.filter((line) => line.startsWith('socket ') && line.endsWith('listen')).length >= 2);
    h.editor.userEdit('src/a.ts', { offset: 0, deleteLength: 0, text: 'int main() {}' });
    const result = await deadline(listening, 500, 590, h.trace);
    expect(result).toContain('typing pause');
    expect(result).toContain('int main() {}');
    expect(result).not.toContain('timed out');
    await h.call(client, 'end');
  });

  it('allows pointing to lines delivered in a navigator diff', async () => {
    const h = await setup(591);
    h.controller.setTimeouts({ navigatorIdleMs: 30, maxBlockMs: 500 });
    const client = await h.connect();
    await h.call(client, 'start');
    h.controller.takeTurn();
    await h.call(client, 'listen');
    const listening = h.call(client, 'listen');
    await h.waitFor('listen received', () => h.trace.filter((line) => line.startsWith('socket ') && line.endsWith('listen')).length >= 2);
    h.editor.userEdit('src/a.ts', { offset: 0, deleteLength: 0, text: 'observed line' });
    expect(await listening).toContain('observed line');
    const result = await h.call(client, 'step', { actions: [{ point: { file: 'a.ts', line: 1, text: 'observed line' } }] });
    expect(result).toContain('Batch 1 is playing');
    await h.call(client, 'step', { actions: [] });
    expect(h.panel.events).toContainEqual(expect.objectContaining({ type: 'point', line: 1 }));
    h.editor.userEdit('src/a.ts', { offset: 13, deleteLength: 0, text: ' suffix' });
    const sameLine = await h.call(client, 'step', { actions: [{ point: { file: 'a.ts', line: 1, text: 'observed line' } }] });
    expect(sameLine).toContain('Batch 2 is playing');
    await h.call(client, 'step', { actions: [] });
    h.editor.userEdit('src/a.ts', { offset: 0, deleteLength: 0, text: 'new line\n' });
    const shifted = await h.call(client, 'step', { actions: [{ point: { file: 'a.ts', line: 2, text: 'observed line' } }] });
    expect(shifted).toContain("haven't seen line 2");
    await h.call(client, 'end');
  });

  it('does not report a typing pause for an edit undone before the quiet interval', async () => {
    const h = await setup(592);
    h.controller.setTimeouts({ navigatorIdleMs: 40, maxBlockMs: 180 });
    const client = await h.connect();
    await h.call(client, 'start');
    h.controller.takeTurn();
    await h.call(client, 'listen');
    const listening = h.call(client, 'listen');
    await h.waitFor('listen received', () => h.trace.filter((line) => line.startsWith('socket ') && line.endsWith('listen')).length >= 2);
    h.editor.userEdit('src/a.ts', { offset: 0, deleteLength: 0, text: 'temporary' });
    h.editor.userEdit('src/a.ts', { offset: 0, deleteLength: 9, text: '' });
    const result = await listening;
    expect(result).not.toContain('Listen returned because typing paused');
    expect(result).toContain('idle timeout elapsed');
    await h.call(client, 'end');
  });

  it('delivers a changed commentary preference through a pending MCP listen', async () => {
    const h = await setup(601);
    const client = await h.connect();
    await h.call(client, 'start');
    const listening = h.call(client, 'listen');
    await h.waitFor('listen received', () => h.trace.some((line) => line.startsWith('socket ') && line.endsWith('listen')));
    h.controller.setNavigatorCommentary('coach');
    const result = await deadline(listening, 500, 601, h.trace);
    expect(result).toContain('commentary preference changed');
    expect(result).toContain('Coach');
    await h.call(client, 'end');
  });

  it('suspends and resumes after the editor websocket drops', async () => {
    const h = await setup(101);
    const first = await h.connect();
    await h.call(first, 'start');
    await first.close();
    for (const connection of h.bridge.connections() ?? []) connection.close();
    await h.waitFor('suspended', () =>
      h.panel.events.some((event) => event.type === 'session' && 'suspended' in event && event.suspended === true),
    );
    const next = await h.connect();
    expect(await h.call(next, 'start')).toContain('resumed');
    h.controller.userMessage('after resume');
    expect(await h.call(next, 'listen')).toContain('after resume');
    await h.call(next, 'end');
  });

  it('holds a command for approval, revokes its grant, and reports completion once', async () => {
    const h = await setup(202);
    const client = await h.connect();
    await h.call(client, 'start');
    h.editor.commandScript.set('echo test', { ms: 1, exitCode: 0, output: 'script-output' });
    await h.call(client, 'step', { actions: [{ run: 'echo test' }] });
    await h.waitFor('command confirmation', () => h.panel.events.some((event) => event.type === 'run' && event.phase === 'confirm'));
    const confirmation = h.panel.events.find((event) => event.type === 'run' && event.phase === 'confirm');
    expect(confirmation?.type).toBe('run');
    if (confirmation?.type !== 'run') throw new Error('missing confirmation');
    expect(h.editor.commands).toHaveLength(0);
    const pending = h.call(client, 'step', { actions: [] });
    await expect(deadline(pending, 30, 202, h.trace)).rejects.toThrow('timed out');
    h.controller.revokeCommandApprovals();
    expect(h.editor.commands).toHaveLength(0);
    h.controller.decideRun(confirmation.id, true, 'command');
    const report = await pending;
    expect(report).toContain('script-output');
    expect(h.editor.commands).toHaveLength(1);
    h.controller.revokeCommandApprovals();
    expect(h.controller.commandApprovals.commands).toEqual([]);
    h.controller.userMessage('after command');
    const next = await h.call(client, 'listen');
    expect(next).toContain('after command');
    expect(next).not.toContain('script-output');
    await h.call(client, 'end');
  });

  it('distinguishes approval, pending execution and a later background completion', async () => {
    const h = await setup(620);
    const client = await h.connect();
    h.controller.setTimeouts({ maxBlockMs: 40 });
    h.editor.commandScript.set('slow command', { ms: 240, exitCode: 0, output: 'final output' });
    await h.call(client, 'start');
    await h.call(client, 'step', { actions: [{ run: 'slow command', wait: 0.1 }] });
    await h.waitFor('approval', () => h.panel.events.some((event) => event.type === 'run' && event.phase === 'confirm'));
    const confirmation = h.panel.events.find((event) => event.type === 'run' && event.phase === 'confirm');
    if (confirmation?.type !== 'run') throw new Error('missing confirmation');
    const approval = await h.call(client, 'listen');
    expect(approval).toContain("awaiting the programmer's approval");
    expect(approval).not.toContain('Nothing has happened yet');
    h.controller.decideRun(confirmation.id, true);
    await h.waitFor('running', () => h.editor.commands.length === 1);
    const running = await h.call(client, 'listen');
    expect(running).toContain('awaiting completion evidence');
    expect(running).not.toContain('Nothing has happened yet');
    let background = '';
    for (let attempt = 0; attempt < 5 && !background.includes('when its wait ended'); attempt++) {
      background = await h.call(client, 'listen');
    }
    expect(background).toContain('when its wait ended');
    let exit = '';
    for (let attempt = 0; attempt < 8 && !exit.includes('exited with 0'); attempt++) {
      exit = await h.call(client, 'listen');
    }
    expect(exit).toContain('exited with 0');
    expect(exit).toContain('final output');
    expect(exit).toContain(`Command ${confirmation.id}:`);
    await h.call(client, 'end');
  });

  it('keeps other background commands pending after one completes', async () => {
    const h = await setup(621);
    const client = await h.connect();
    h.controller.setConfirmCommands(false);
    h.controller.setTimeouts({ maxBlockMs: 30 });
    h.editor.commandScript.set('first slow', { ms: 180, exitCode: 0, output: 'first done' });
    h.editor.commandScript.set('second slow', { ms: 500, exitCode: 0, output: 'second done' });
    await h.call(client, 'start');
    await h.call(client, 'step', { actions: [{ run: 'first slow', wait: 0.01 }] });
    await h.call(client, 'step', { actions: [{ run: 'second slow', wait: 0.01 }] });
    const first = await h.call(client, 'listen');
    expect(first).toContain('first slow');
    expect(first).toContain('second slow');
    let update = '';
    for (let attempt = 0; attempt < 10 && !update.includes('first done'); attempt++) update = await h.call(client, 'listen');
    expect(update).toContain('first done');
    expect(update).toContain('second slow');
    expect(update).toContain('awaiting completion evidence');
    await h.call(client, 'end');
  });

  it('waits for controlled narration and continues when speech fails', async () => {
    let finish: () => void = noop;
    let fail: () => void = noop;
    let calls = 0;
    const narration: NarrationPort = {
      speak: () => {
        calls++;
        return new Promise<void>((resolve, reject) => {
          finish = resolve;
          fail = () => {
            reject(new Error('speech failed'));
          };
        });
      },
      attentionCue: () => Promise.resolve(),
      pause: () => {},
      resume: () => {},
      cancel: () => {
        finish();
      },
    };
    const h = await setup(303, narration);
    const client = await h.connect();
    await h.call(client, 'start');
    await h.call(client, 'step', { actions: [{ say: 'first' }] });
    await h.waitFor('speech started', () => calls === 1);
    h.controller.pause();
    const drain = h.call(client, 'step', { actions: [] });
    finish();
    await expect(deadline(drain, 30, 303, h.trace)).rejects.toThrow('timed out');
    h.controller.resume();
    expect(await drain).toContain('Batch 1 completed');
    await h.call(client, 'step', { actions: [{ say: 'second' }] });
    await h.waitFor('second speech started', () => calls === 2);
    fail();
    expect(await h.call(client, 'step', { actions: [] })).toContain('Batch 2 completed');
    await h.call(client, 'end');
  });

  it('recovers a reply after a pending listen is cancelled', async () => {
    const h = await setup(404);
    const client = await h.connect();
    await h.call(client, 'start');
    const abort = new AbortController();
    const pending = client.callTool({ name: 'listen', arguments: {} }, undefined, { signal: abort.signal });
    await h.waitFor('listen received', () => h.trace.some((line) => line.startsWith('socket ') && line.endsWith('listen')));
    await expect(deadline(pending, 30, 404, h.trace)).rejects.toThrow('timed out');
    abort.abort();
    await expect(deadline(pending, 2000, 404, h.trace)).rejects.toThrow();
    h.controller.userMessage('after cancellation');
    expect(await h.call(client, 'listen')).toContain('after cancellation');
    h.controller.userMessage('following reply');
    const next = await h.call(client, 'listen');
    expect(next).toContain('following reply');
    expect(next).not.toContain('after cancellation');
    await h.call(client, 'end');
  });

  it('pipelines two batches behind a withheld narration and wakes a pending listen', async () => {
    let release: () => void = noop;
    let entered = false;
    const narration: NarrationPort = {
      speak: () =>
        new Promise<void>((resolve) => {
          entered = true;
          release = resolve;
        }),
      attentionCue: () => Promise.resolve(),
      pause: noop,
      resume: noop,
      cancel: () => {
        release();
      },
    };
    const h = await setup(505, narration);
    const client = await h.connect();
    await h.call(client, 'start');
    expect(await h.call(client, 'step', { actions: [{ say: 'held' }] })).toContain('Batch 1 is playing');
    await h.waitFor('adapter entered', () => entered);
    const second = h.call(client, 'step', { actions: [{ say: 'queued' }] });
    await expect(deadline(second, 30, 505, h.trace)).rejects.toThrow('timed out');
    release();
    expect(await second).toContain('Batch 1 completed');
    await h.waitFor('second speech', () => h.panel.says().includes('queued'));
    release();
    expect(await h.call(client, 'step', { actions: [] })).toContain('Batch 2 completed');
    const listen = h.call(client, 'listen');
    await h.waitFor('listen received', () => h.trace.some((line) => line.startsWith('socket ') && line.endsWith('listen')));
    await expect(deadline(listen, 30, 505, h.trace)).rejects.toThrow('timed out');
    h.controller.userMessage('wake');
    expect(await listen).toContain('wake');
    await h.call(client, 'end');
  });

  it('wakes a settings notice while narration is still playing', async () => {
    let release: () => void = noop;
    let entered = false;
    let cancels = 0;
    const narration: NarrationPort = {
      speak: () =>
        new Promise<void>((resolve) => {
          entered = true;
          release = resolve;
        }),
      attentionCue: () => Promise.resolve(),
      pause: noop,
      resume: noop,
      cancel: () => {
        cancels++;
        release();
      },
    };
    const h = await setup(607, narration);
    const client = await h.connect();
    await h.call(client, 'start');
    await h.call(client, 'step', { actions: [{ say: 'still playing' }] });
    await h.waitFor('speech entered', () => entered);
    const listening = h.call(client, 'listen');
    await h.waitFor('listen received', () => h.trace.some((line) => line.startsWith('socket ') && line.endsWith('listen')));
    h.controller.setNavigatorCommentary('quiet');
    const result = await deadline(listening, 500, 607, h.trace);
    expect(result).toContain('commentary preference changed');
    expect(result).toContain('queued work and speech are unchanged');
    expect(cancels).toBe(0);
    release();
    expect(await h.call(client, 'step', { actions: [] })).toContain('Batch 1 completed');
    await h.call(client, 'end');
  });

  it('ignores a late narration completion from the previous session', async () => {
    let releaseOld: () => void = noop;
    let calls = 0;
    const narration: NarrationPort = {
      speak: () => {
        calls++;
        if (calls > 1) return Promise.resolve();
        return new Promise<void>((resolve) => {
          releaseOld = resolve;
        });
      },
      attentionCue: () => Promise.resolve(),
      pause: noop,
      resume: noop,
      cancel: noop,
    };
    const h = await setup(606, narration);
    const first = await h.connect();
    await h.call(first, 'start');
    await h.call(first, 'step', { actions: [{ say: 'old' }] });
    await h.waitFor('old speech', () => calls === 1);
    h.controller.endSession();
    await h.call(first, 'listen');
    const next = await h.connect();
    await h.call(next, 'start');
    await h.call(next, 'step', { actions: [{ say: 'new' }] });
    releaseOld();
    expect(await h.call(next, 'step', { actions: [] })).toContain('Batch 1 completed');
    h.controller.userMessage('new session');
    expect(await h.call(next, 'listen')).toContain('new session');
    await h.call(next, 'end');
  });
});
