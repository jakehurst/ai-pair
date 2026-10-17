// The bridge's conversation with a relay over a WebSocket: who it lets in, and how it answers a call it cannot take
// (specs/Bridge.tla).

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { parseEditorMessage, PROTOCOL_VERSION, type EditorMessage } from '@ai-pair/protocol';
import { Bridge } from '../src/bridge';
import { Controller } from '../src/controller';
import { containing, FakeEditor, FakePanel, testConfig } from './fake';

/** A relay's end of a socket to the bridge. */
interface Client {
  socket: WebSocket;
  /** Resolves with the next frame the bridge sends, in order. One call at a time: a second call while one waits replaces its waiter. */
  next(): Promise<EditorMessage>;
  /** Resolves once the socket has closed. */
  closed: Promise<void>;
}

let dir: string;
let controller: Controller;
let bridge: Bridge;
let traced: string[];
const clients: Client[] = [];

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-pair-bridge-'));
  controller = new Controller(new FakeEditor(), new FakePanel(), testConfig);
  traced = [];
  bridge = new Bridge(controller, {
    dir,
    workspaceFolders: () => ['/project'],
    trace: (line) => {
      traced.push(line);
    },
  });
  await bridge.start();
});

afterEach(() => {
  for (const c of clients.splice(0)) {
    c.socket.terminate();
  }
  bridge.dispose();
  fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/** Returns the port and token a relay finds in the bridge's discovery file. */
function discovery(): { port: number; token: string } {
  const parsed: unknown = JSON.parse(fs.readFileSync(bridge.file, 'utf8'));
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('port' in parsed) ||
    typeof parsed.port !== 'number' ||
    !('token' in parsed) ||
    typeof parsed.token !== 'string'
  ) {
    throw new Error('not a discovery file');
  }
  return { port: parsed.port, token: parsed.token };
}

/** Opens a socket to the bridge, the way a relay does, and resolves with it once it is connected. */
async function connect(): Promise<Client> {
  const socket = new WebSocket(`ws://127.0.0.1:${discovery().port}`);
  const received: EditorMessage[] = [];
  let wake: (() => void) | undefined;
  socket.on('message', (data: Buffer) => {
    const message = parseEditorMessage(data);
    if (message) {
      received.push(message);
      wake?.();
    }
  });
  const closed = new Promise<void>((resolve) => {
    socket.once('close', () => {
      resolve();
    });
  });
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  const client: Client = {
    socket,
    closed,
    next: async () => {
      for (;;) {
        const message = received.shift();
        if (message !== undefined) return message;
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    },
  };
  clients.push(client);
  return client;
}

/** Sends a frame the way a relay does. */
function send(client: Client, frame: object): void {
  client.socket.send(JSON.stringify(frame));
}

/** Connects a relay, greets the bridge with the right token, and starts a session its socket then owns. */
async function paired(): Promise<Client> {
  const client = await connect();
  send(client, { type: 'hello', token: discovery().token, protocolVersion: PROTOCOL_VERSION });
  expect(await client.next()).toEqual({ type: 'welcome' });
  send(client, { type: 'call', id: 1, tool: 'start', args: { cwd: '/project' } });
  expect(await client.next()).toMatchObject({ type: 'result', id: 1 });
  return client;
}

describe('a relay that does not belong', () => {
  it.each([
    { name: 'a call before any hello', frame: { type: 'call', id: 1, tool: 'listen', args: {} } },
    { name: 'a hello with the wrong token', frame: { type: 'hello', token: 'wrong', protocolVersion: PROTOCOL_VERSION } },
    { name: 'a hello whose token is not a string', frame: { type: 'hello', token: 5, protocolVersion: PROTOCOL_VERSION } },
  ])('is rejected and disconnected for $name', async ({ frame }) => {
    const client = await connect();
    send(client, frame);
    expect(await client.next()).toEqual({ type: 'rejected', reason: 'Authentication failed.' });
    await client.closed;
  });

  it('is rejected and disconnected for another protocol version', async () => {
    const client = await connect();
    send(client, { type: 'hello', token: discovery().token, protocolVersion: PROTOCOL_VERSION + 1 });
    expect(await client.next()).toMatchObject({ type: 'rejected', reason: containing('Protocol version mismatch') });
    await client.closed;
  });
});

describe('calls it cannot take', () => {
  it.each([
    { name: 'a step without actions', tool: 'step', message: '`actions` must be an array.' },
    { name: 'a read without a file', tool: 'read', message: '`file` must be a string.' },
    { name: 'a calibration without a title and a file', tool: 'calibrate', message: '`title` and `file` must be strings.' },
    { name: 'an unknown tool', tool: 'bogus', message: 'Unknown tool: bogus' },
  ])('answers $name with invalid_arguments', async ({ tool, message }) => {
    const client = await paired();
    send(client, { type: 'call', id: 2, tool, args: {} });
    expect(await client.next()).toEqual({ type: 'error', id: 2, code: 'invalid_arguments', message });
  });

  it('answers a failure that is not a ToolError as internal, with its text', async () => {
    const client = await paired();
    vi.spyOn(controller, 'listen').mockRejectedValueOnce(new Error('boom')).mockRejectedValueOnce('plain text');
    send(client, { type: 'call', id: 2, tool: 'listen', args: {} });
    expect(await client.next()).toEqual({ type: 'error', id: 2, code: 'internal', message: 'boom' });
    send(client, { type: 'call', id: 3, tool: 'listen', args: {} });
    expect(await client.next()).toEqual({ type: 'error', id: 3, code: 'internal', message: 'plain text' });
  });

  it('takes a call with no args as one with none', async () => {
    const client = await connect();
    send(client, { type: 'hello', token: discovery().token, protocolVersion: PROTOCOL_VERSION });
    await client.next();
    send(client, { type: 'call', id: 1, tool: 'start' });
    expect(await client.next()).toMatchObject({ type: 'result', id: 1 });
  });

  it('reads a file between the lines it is given', async () => {
    const client = await paired();
    const read = vi.spyOn(controller, 'read');
    send(client, { type: 'call', id: 2, tool: 'read', args: { file: 'a.ts', from_line: 1, to_line: 2 } });
    await client.next();
    expect(read).toHaveBeenCalledWith('a.ts', 1, 2);
  });

  it('hands a calibration the passage and its notice', async () => {
    const client = await paired();
    const file = path.join(dir, 'passage.txt');
    fs.writeFileSync(file, 'Some words.');
    controller.onCalibrate = vi.fn(() => true);
    send(client, { type: 'call', id: 2, tool: 'calibrate', args: { title: 'Words', file, notice: 'From nowhere.' } });
    expect(await client.next()).toMatchObject({ type: 'result', id: 2 });
    expect(controller.onCalibrate).toHaveBeenCalledWith({ title: 'Words', text: 'Some words.', notice: 'From nowhere.' });
  });

  it('ignores a return from a socket that does not own the session, and a hello once welcomed', async () => {
    await paired();
    const stranger = await connect();
    send(stranger, { type: 'hello', token: discovery().token, protocolVersion: PROTOCOL_VERSION });
    await stranger.next();
    const restore = vi.spyOn(controller, 'restore');
    send(stranger, { type: 'return', report: { batches: [], events: [], turn: 'agent' } });
    send(stranger, { type: 'hello', token: discovery().token, protocolVersion: PROTOCOL_VERSION });
    send(stranger, { type: 'call', id: 9, tool: 'listen', args: {} });
    expect(await stranger.next()).toMatchObject({ type: 'error', id: 9, code: 'no_session' });
    expect(restore).not.toHaveBeenCalled();
  });
});

describe('the trace of a report', () => {
  it('names its batches, events, and flags, whatever shape they have', async () => {
    const client = await paired();
    // A report whose parts have the wrong shape: the trace names what it can.
    // oxlint-disable-next-line typescript/no-unsafe-argument
    vi.spyOn(controller, 'listen').mockResolvedValue(JSON.parse('{"batches":"none","events":7,"waiting":true,"rejected":{}}'));
    send(client, { type: 'call', id: 2, tool: 'listen', args: {} });
    await client.next();
    expect(traced).toContainEqual(containing('result 2 rejected waiting'));
  });
});

describe('a bridge that is not running', () => {
  it('has no connections and writes no discovery file', () => {
    const idle = new Bridge(controller, { dir: path.join(dir, 'idle'), workspaceFolders: () => [] });
    idle.writeDiscovery();
    expect(idle.connections().size).toBe(0);
    expect(fs.existsSync(idle.file)).toBe(false);
  });

  it('can be disposed twice', () => {
    bridge.dispose();
    expect(() => {
      bridge.dispose();
    }).not.toThrow();
  });

  it('records port 0 when its server has no network address', async () => {
    vi.spyOn(WebSocketServer.prototype, 'address').mockReturnValue('a pipe');
    const odd = new Bridge(controller, { dir: path.join(dir, 'odd'), workspaceFolders: () => [] });
    await odd.start();
    const written: unknown = JSON.parse(fs.readFileSync(odd.file, 'utf8'));
    odd.dispose();
    expect(written).toMatchObject({ port: 0 });
  });
});
