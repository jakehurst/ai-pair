// The relay's link against fake editor windows whose sockets the tests control. The cases are
// the counterexamples TLC found in specs/Wire.tla.

import { ok } from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type WebSocket, WebSocketServer } from 'ws';
import { parseRelayMessage, PROTOCOL_VERSION } from '@ai-pair/protocol';
import { EDITOR_DISCONNECTED, EditorLink } from '../src/link';

let dir: string;
const servers: WebSocketServer[] = [];

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-pair-link-'));
});

afterEach(async () => {
  for (const s of servers.splice(0)) {
    await new Promise((r) => {
      s.close(() => {
        r(undefined);
      });
    });
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * Starts a fake editor window for `folder`. It answers `hello` with `greeting`, a `welcome` unless given,
 * and keeps each socket and each call for the test to act on.
 */
async function fakeWindow(folder: string, greeting = JSON.stringify({ type: 'welcome' })) {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  servers.push(server);
  await new Promise((r) => {
    server.once('listening', r);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no TCP address');
  const { port } = address;
  const discovery = {
    pid: process.pid,
    workspaceFolders: [folder],
    port,
    token: 'token',
    protocolVersion: PROTOCOL_VERSION,
    lastFocused: 0,
  };
  fs.writeFileSync(path.join(dir, `${port}.json`), JSON.stringify(discovery));
  const sockets: WebSocket[] = [];
  const calls: Array<{ ws: WebSocket; id: number; tool: string }> = [];
  /** The type of each message after `hello`, in the order it arrived. */
  const received: string[] = [];
  server.on('connection', (ws) => {
    sockets.push(ws);
    ws.on('message', (data) => {
      const m = parseRelayMessage(data);
      if (m?.type === 'hello') {
        ws.send(greeting);
      } else if (m) {
        received.push(m.type);
      }
      if (m?.type === 'call') calls.push({ ws, id: m.id, tool: m.tool });
    });
  });
  return { sockets, calls, received };
}

function answer(call: { ws: WebSocket; id: number }, result: unknown): void {
  call.ws.send(JSON.stringify({ type: 'result', id: call.id, result }));
}

async function until(check: () => boolean): Promise<void> {
  while (!check()) {
    await new Promise((r) => {
      setTimeout(r, 5);
    });
  }
}

describe('link', () => {
  it('OwnCloseOnly: rejects a call only when the socket it was sent on closes', async () => {
    const fakeA = await fakeWindow('/a');
    const fakeB = await fakeWindow('/b');
    const link = new EditorLink('/a', dir);
    const first = link.call('read', {});
    await until(() => fakeA.calls.length === 1);
    const callOnA = fakeA.calls[0];
    ok(callOnA);
    answer(callOnA, 'from a');
    expect(await first).toBe('from a');

    // Hold A's end of the closing handshake, so that A's close event comes after the call on B.
    const socketA = fakeA.sockets[0];
    ok(socketA);
    socketA.pause();
    link.locate(['/b']);
    const second = link.call('read', {});
    let settled = false;
    second.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await until(() => fakeB.calls.length === 1);
    socketA.resume();
    await until(() => socketA.readyState === socketA.CLOSED);
    await new Promise((r) => {
      setTimeout(r, 100);
    });
    expect(settled).toBe(false);
    const callOnB = fakeB.calls[0];
    ok(callOnB);
    answer(callOnB, 'from b');
    expect(await second).toBe('from b');
    link.close();
  });

  it('CallsAnswered: tells the agent to call `start` again when the editor disconnects during a call (#138)', async () => {
    const fake = await fakeWindow('/a');
    const link = new EditorLink('/a', dir);
    const call = link.call('listen', {});
    await until(() => fake.calls.length === 1);
    const socket = fake.sockets[0];
    ok(socket);
    socket.close();
    await expect(call).rejects.toMatchObject({ code: 'no_editor', message: EDITOR_DISCONNECTED });
    link.close();
  });

  it('RelayStaysUp: fails to connect, without crashing, when a window answers with a frame that is not JSON', async () => {
    await fakeWindow('/a', 'not json');
    const link = new EditorLink('/a', dir);
    await expect(link.call('read', {})).rejects.toMatchObject({ code: 'no_editor' });
  });

  for (const frame of ['null', '42', '"text"', '[]', '{ "kind": "welcome" }']) {
    it(`RelayStaysUp: fails to connect, without crashing, when a window answers with JSON that isn't a message: ${frame}`, async () => {
      await fakeWindow('/a', frame);
      const link = new EditorLink('/a', dir);
      await expect(link.call('read', {})).rejects.toMatchObject({ code: 'no_editor' });
    });
  }

  it('RelayStaysUp: drops a frame that is not JSON after the welcome', async () => {
    const fake = await fakeWindow('/a');
    const link = new EditorLink('/a', dir);
    const call = link.call('read', {});
    await until(() => fake.calls.length === 1);
    const socket = fake.sockets[0];
    ok(socket);
    socket.send('not json');
    const first = fake.calls[0];
    ok(first);
    answer(first, 'result');
    expect(await call).toBe('result');
    link.close();
  });

  it("NoReportLost: doesn't send a call that was cancelled before it went out", async () => {
    const fake = await fakeWindow('/a');
    const link = new EditorLink('/a', dir);
    const abort = new AbortController();
    const call = link.call('listen', {}, abort.signal);
    abort.abort();
    await expect(call).rejects.toMatchObject({ code: 'cancelled' });
    // Calls arrive in order, so fake `listen` that went out would arrive before this `read`.
    const second = link.call('read', {});
    await until(() => fake.calls.length > 0);
    expect(fake.calls.map((c) => c.tool)).toEqual(['read']);
    const first = fake.calls[0];
    ok(first);
    answer(first, 'result');
    expect(await second).toBe('result');
    link.close();
  });

  it("PlaysAfterCompleted: sends the next call only after a canceled call's report is handed back (#59)", async () => {
    const fake = await fakeWindow('/a');
    const link = new EditorLink('/a', dir);
    const abort = new AbortController();
    // Aborted below; the test watches the window's side.
    void link.call('listen', {}, abort.signal).catch(() => {});
    await until(() => fake.calls.length === 1);
    abort.abort();
    await until(() => fake.received.includes('cancel'));
    // The agent's next call, made while the editor's answer to the cancelled one is on its way.
    const second = link.call('step', { actions: [] });
    await new Promise((r) => {
      setTimeout(r, 50);
    });
    const first = fake.calls[0];
    ok(first);
    answer(first, { batches: [], events: [], turn: 'agent' });
    await until(() => fake.calls.length === 2);
    // The editor restores the report before it takes the next call.
    expect(fake.received).toEqual(['call', 'cancel', 'return', 'call']);
    const next = fake.calls[1];
    ok(next);
    answer(next, 'second');
    expect(await second).toBe('second');
    link.close();
  });

  it('sends the next call once the editor answers a cancelled call with an error', async () => {
    const fake = await fakeWindow('/a');
    const link = new EditorLink('/a', dir);
    const abort = new AbortController();
    const first = link.call('listen', {}, abort.signal);
    await until(() => fake.calls.length === 1);
    abort.abort();
    await until(() => fake.received.includes('cancel'));
    const second = link.call('read', {});
    await new Promise((r) => {
      setTimeout(r, 50);
    });
    expect(fake.calls).toHaveLength(1);
    const cancelled = fake.calls[0];
    ok(cancelled);
    cancelled.ws.send(JSON.stringify({ type: 'error', id: cancelled.id, code: 'cancelled', message: 'The call was cancelled.' }));
    await expect(first).rejects.toMatchObject({ code: 'cancelled' });
    await until(() => fake.calls.length === 2);
    const next = fake.calls[1];
    ok(next);
    answer(next, 'second');
    expect(await second).toBe('second');
    link.close();
  });
});
