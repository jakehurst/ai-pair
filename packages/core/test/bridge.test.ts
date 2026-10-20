// The bridge on its own: who it lets in, how it answers each call, its discovery file, and its trace
// (specs/Bridge.tla, specs/Discovery.tla). Solitary: the ws server and its sockets are fakes the test drives, node:fs
// and randomBytes are mocks, the protocol's parse is a mock deciding by the real message schema, and the
// controller is a typed fake whose results are built by the protocol's schemas.

import * as path from 'node:path';
import { ok } from 'node:assert/strict';
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DISCOVERY_SCHEMA,
  EDITOR_MESSAGE_SCHEMA,
  FILE_CONTENT_SCHEMA,
  PROTOCOL_VERSION,
  REPORT_SCHEMA,
  ToolError,
  type EditorMessage,
} from '@ai-pair/protocol';
import { Bridge, type BridgeController, type BridgeOptions } from '../src/bridge';
import { LEFT_ARROW, RIGHT_ARROW } from '../src/constants';

/** What the mocked modules share with the tests, made before the `vi.mock` factories run. */
const fakes = vi.hoisted(() => {
  /** A socket's states, as `ws` numbers them. */
  const OPEN = 1;
  const CLOSING = 2;
  const CLOSED = 3;

  /** A relay's socket, as the bridge's server hands it over: the test drives it, and it records what the bridge sent. */
  class FakeSocket {
    readonly OPEN = OPEN;
    readyState = OPEN;
    /** What the bridge sent, as JSON. */
    readonly sent: unknown[] = [];
    readonly send = vi.fn((data: string) => {
      const message: unknown = JSON.parse(data);
      this.sent.push(message);
    });
    readonly close = vi.fn(() => {
      this.readyState = CLOSING;
    });
    readonly terminate = vi.fn();
    private readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>();

    on(event: string, listener: (...args: unknown[]) => void): void {
      this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    }

    /** Hands the bridge a frame from the relay; the mocked parse takes it as the message itself. */
    receive(message: unknown): void {
      this.emit('message', message);
    }

    /** Finishes closing. */
    closed(): void {
      this.readyState = CLOSED;
      this.emit('close');
    }

    private emit(event: string, ...args: unknown[]): void {
      for (const listener of this.listeners.get(event) ?? []) {
        listener(...args);
      }
    }
  }

  /** The `ws` server, faked: the test makes it listen or fail, and connects sockets to it. */
  class FakeServer {
    /** Every server a bridge made, in order. */
    static readonly made: FakeServer[] = [];
    readonly clients = new Set<FakeSocket>();
    readonly close = vi.fn();
    readonly address = vi.fn(() => ({ address: '127.0.0.1', family: 'IPv4', port: fakes.port }));
    private readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>();

    constructor(readonly options: unknown) {
      FakeServer.made.push(this);
    }

    on(event: string, listener: (...args: unknown[]) => void): void {
      this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    }

    once(event: string, listener: (...args: unknown[]) => void): void {
      this.on(event, listener);
    }

    /** Starts listening. */
    listen(): void {
      this.emit('listening');
    }

    /** Fails to listen. */
    fail(error: Error): void {
      this.emit('error', error);
    }

    /** Connects a relay's socket, as the server does when one opens. */
    connect(): FakeSocket {
      const socket = new FakeSocket();
      this.clients.add(socket);
      this.emit('connection', socket);
      return socket;
    }

    private emit(event: string, ...args: unknown[]): void {
      for (const listener of this.listeners.get(event) ?? []) {
        listener(...args);
      }
    }
  }

  return {
    FakeServer,
    FakeSocket,
    /** The port the server listens on. */
    port: 4321,
    /** The bytes randomBytes gives, which the token is made of. */
    tokenBytes: 7,
  };
});

/** The folder the discovery file is written in. */
const DIR = '/home/me/.ai-pair/windows';

/** The window's discovery file. */
const FILE = path.join(DIR, `${process.pid}.json`);

/** The token the bridge makes from the mocked random bytes. */
const TOKEN = Buffer.alloc(24, fakes.tokenBytes).toString('hex');

/** A report, built by its schema, as the controller answers. */
const REPORT = REPORT_SCHEMA.parse({ batches: [{ id: 1, status: 'completed' }], events: [{ kind: 'interrupt' }], turn: 'agent' });

/** A file, built by its schema, as the controller's `read` answers. */
const FILE_CONTENT = FILE_CONTENT_SCHEMA.parse({
  file: 'a.ts',
  dirty: false,
  lines: [{ number: 1, text: 'a' }],
  end: { final_newline: true },
});

vi.mock('ws', () => ({ WebSocketServer: fakes.FakeServer }));
vi.mock('node:fs', () => ({
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
  unlinkSync: vi.fn(),
  readFileSync: vi.fn(() => 'Some words.'),
}));
vi.mock(import('node:crypto'), async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, randomBytes: vi.fn((size: number) => Buffer.alloc(size, fakes.tokenBytes)) };
});
vi.mock(import('@ai-pair/protocol'), async (importOriginal) => {
  const original = await importOriginal();
  // The real parse reads a frame's JSON; the fake socket hands over the message itself, and the real schema checks it.
  return { ...original, parseRelayMessage: vi.fn((data: unknown) => original.RELAY_MESSAGE_SCHEMA.safeParse(data).data) };
});

/** A socket the bridge's server handed over. */
type FakeSocket = InstanceType<typeof fakes.FakeSocket>;

/** A server a bridge made. */
type FakeServer = InstanceType<typeof fakes.FakeServer>;

/** The controller, faked: each member a bridge calls. */
interface FakeController extends BridgeController {
  isActive: boolean;
  isSuspended: boolean;
}

let controller: FakeController;
let traced: string[];

/** The calibration the bridge hands passages to: it takes each one. */
const arm = vi.fn<BridgeOptions['calibrate']>(() => true);

/** Returns a controller with no session, whose calls answer with REPORT. */
function fakeController(): FakeController {
  return {
    isActive: false,
    isSuspended: false,
    start: vi.fn<BridgeController['start']>(() => Promise.resolve(REPORT)),
    step: vi.fn<BridgeController['step']>(() => Promise.resolve(REPORT)),
    listen: vi.fn<BridgeController['listen']>(() => Promise.resolve(REPORT)),
    end: vi.fn<BridgeController['end']>(() => Promise.resolve(REPORT)),
    read: vi.fn<BridgeController['read']>(() => Promise.resolve(FILE_CONTENT)),
    calibrate: vi.fn<BridgeController['calibrate']>(() => REPORT),
    resolveFile: vi.fn<BridgeController['resolveFile']>((file) => path.join('/project', file)),
    restore: vi.fn<BridgeController['restore']>(),
    disconnect: vi.fn<BridgeController['disconnect']>(),
  };
}

/** Returns the server the bridge made last. */
function lastServer(): FakeServer {
  const server = fakes.FakeServer.made.at(-1);
  ok(server);
  return server;
}

/** Makes a bridge, with `options` over a tracing default, lets its server listen, and starts it. */
async function started(options: Partial<BridgeOptions> = {}): Promise<{ bridge: Bridge; server: FakeServer }> {
  const bridge = new Bridge(controller, {
    dir: DIR,
    workspaceFolders: () => ['/project'],
    trace: (line) => {
      traced.push(line);
    },
    calibrate: arm,
    ...options,
  });
  const server = lastServer();
  server.listen();
  await bridge.start();
  return { bridge, server };
}

/** Returns the discovery the bridge wrote last, parsed by its schema. */
function writtenDiscovery(): ReturnType<typeof DISCOVERY_SCHEMA.parse> {
  const [, text] = vi.mocked(writeFileSync).mock.calls.at(-1) ?? [];
  ok(typeof text === 'string');
  return DISCOVERY_SCHEMA.parse(JSON.parse(text));
}

/** Returns what the bridge sent on `socket`, each parsed by the editor's message schema, so a wrong frame fails here. */
function sentOn(socket: FakeSocket): EditorMessage[] {
  return socket.sent.map((message) => EDITOR_MESSAGE_SCHEMA.parse(message));
}

/** Returns the last frame the bridge sent on `socket`. */
function lastSent(socket: FakeSocket): EditorMessage | undefined {
  return sentOn(socket).at(-1);
}

/** Lets the bridge's awaits run: everything the last step settled. */
function settle(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/** Connects a socket to `server` and greets the bridge with the right token. */
function welcomed(server: FakeServer): FakeSocket {
  const socket = server.connect();
  socket.receive({ type: 'hello', token: TOKEN, protocolVersion: PROTOCOL_VERSION });
  expect(lastSent(socket)).toEqual({ type: 'welcome' });
  return socket;
}

/** Sends a call on `socket` and returns the bridge's answer to it. */
async function call(socket: FakeSocket, id: number, tool: string, args?: Record<string, unknown>): Promise<EditorMessage | undefined> {
  socket.receive({ type: 'call', id, tool, ...(args === undefined ? {} : { args }) });
  await settle();
  return lastSent(socket);
}

/** Connects a socket that starts a session, which it then owns. */
async function owner(server: FakeServer): Promise<FakeSocket> {
  const socket = welcomed(server);
  expect(await call(socket, 1, 'start', {})).toEqual({ type: 'result', id: 1, result: REPORT });
  controller.isActive = true;
  return socket;
}

beforeEach(() => {
  controller = fakeController();
  traced = [];
});

afterEach(() => {
  fakes.FakeServer.made.length = 0;
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('start', () => {
  it('OpenWindow, FindsRunningProp: listens on 127.0.0.1, then writes its discovery file beside it and renames it over', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const startedAt = 1000;
    vi.setSystemTime(startedAt);
    const { bridge, server } = await started();
    expect(server.options).toEqual({ host: '127.0.0.1', port: 0 });
    expect(bridge.file).toBe(FILE);
    expect(mkdirSync).toHaveBeenCalledWith(DIR, { recursive: true, mode: 0o700 });
    const [written, , options] = vi.mocked(writeFileSync).mock.calls[0] ?? [];
    expect(written).toBe(`${FILE}.tmp`);
    expect(options).toEqual({ mode: 0o600 });
    expect(writtenDiscovery()).toEqual({
      pid: process.pid,
      workspaceFolders: ['/project'],
      port: fakes.port,
      token: TOKEN,
      protocolVersion: PROTOCOL_VERSION,
      lastFocused: startedAt,
    });
    expect(renameSync).toHaveBeenCalledWith(`${FILE}.tmp`, FILE);
  });

  it('fails to start when its server cannot listen', async () => {
    const bridge = new Bridge(controller, { dir: DIR, workspaceFolders: () => [], calibrate: arm });
    lastServer().fail(new Error('EADDRINUSE'));
    await expect(bridge.start()).rejects.toThrow('EADDRINUSE');
  });
});

describe('the discovery file', () => {
  it('Focus: is written again on focus, with the time the window gained it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1000);
    const { bridge } = await started();
    const focusedAt = 2000;
    vi.setSystemTime(focusedAt);
    bridge.focused();
    expect(writtenDiscovery().lastFocused).toBe(focusedAt);
  });

  it("ListWindow: reports a file it can't write without throwing, and goes on without a callback for it (#9)", async () => {
    const failures: unknown[] = [];
    const { bridge } = await started({
      failed: (error) => {
        failures.push(error);
      },
    });
    const denied = new Error('EACCES');
    vi.mocked(writeFileSync).mockImplementation(() => {
      throw denied;
    });
    bridge.focused();
    expect(failures).toEqual([denied]);
    const { bridge: silent } = await started();
    expect(() => {
      silent.focused();
    }).not.toThrow();
  });

  it('CloseWindow: is removed with the window, which drops every socket and closes its server, even when the file is gone', async () => {
    const { bridge, server } = await started();
    const socket = server.connect();
    expect(bridge.connections()).toBe(server.clients);
    bridge.dispose();
    expect(unlinkSync).toHaveBeenCalledWith(FILE);
    expect(socket.terminate).toHaveBeenCalled();
    expect(server.close).toHaveBeenCalled();
    vi.mocked(unlinkSync).mockImplementation(() => {
      throw new Error('ENOENT');
    });
    expect(() => {
      bridge.dispose();
    }).not.toThrow();
  });
});

describe('a relay that does not belong', () => {
  it.each([
    { name: 'a call before any hello', frame: { type: 'call', id: 1, tool: 'listen', args: {} } },
    { name: 'a hello whose token is not a string', frame: { type: 'hello', token: 5, protocolVersion: PROTOCOL_VERSION } },
    { name: 'a hello with a token of another length', frame: { type: 'hello', token: 'short', protocolVersion: PROTOCOL_VERSION } },
    {
      name: 'a hello with a wrong token of the same length',
      frame: { type: 'hello', token: TOKEN.replaceAll('7', '8'), protocolVersion: PROTOCOL_VERSION },
    },
  ])('is rejected and disconnected for $name', async ({ frame }) => {
    const { server } = await started();
    const socket = server.connect();
    socket.receive(frame);
    expect(sentOn(socket)).toEqual([{ type: 'rejected', reason: 'Authentication failed.' }]);
    expect(socket.close).toHaveBeenCalled();
  });

  it('is rejected and disconnected for another protocol version', async () => {
    const { server } = await started();
    const socket = server.connect();
    const old = PROTOCOL_VERSION - 1;
    socket.receive({ type: 'hello', token: TOKEN, protocolVersion: old });
    expect(sentOn(socket)).toEqual([
      {
        type: 'rejected',
        reason: `Protocol version mismatch (editor ${PROTOCOL_VERSION}, relay ${old}). The extension was updated: reload the VS Code window and restart the agent.`,
      },
    ]);
    expect(socket.close).toHaveBeenCalled();
  });

  it('GuardedParse: drops a frame that is not a message, before the hello and after it, and ignores a second hello (#30)', async () => {
    const { server } = await started();
    const socket = server.connect();
    socket.receive('not a message');
    expect(socket.sent).toEqual([]);
    socket.receive({ type: 'hello', token: TOKEN, protocolVersion: PROTOCOL_VERSION });
    socket.receive({ type: 'bogus' });
    socket.receive({ type: 'hello', token: TOKEN, protocolVersion: PROTOCOL_VERSION });
    expect(sentOn(socket)).toEqual([{ type: 'welcome' }]);
  });
});

describe('start calls', () => {
  it("BeginStart: starts a session with the call's task, folder, and rules, each only when it has the right type", async () => {
    const { server } = await started();
    const socket = welcomed(server);
    await call(socket, 1, 'start', { task: 'Fix it.', cwd: '/project', rules: ['a.md'] });
    await call(socket, 2, 'start', { task: 5, cwd: 5, rules: ['a.md', 5] });
    await call(socket, 3, 'start');
    expect(vi.mocked(controller.start).mock.calls).toEqual([
      ['Fix it.', '/project', ['a.md']],
      [undefined, undefined, undefined],
      [undefined, undefined, undefined],
    ]);
  });

  it("BeginStart: refuses another socket's start while a session runs, and takes it once the session is suspended", async () => {
    const { server } = await started();
    await owner(server);
    const other = welcomed(server);
    expect(await call(other, 1, 'start', {})).toEqual({
      type: 'error',
      id: 1,
      code: 'session_active',
      message: 'Another agent is already pairing in this editor window.',
    });
    controller.isSuspended = true;
    expect(await call(other, 2, 'start', {})).toEqual({ type: 'result', id: 2, result: REPORT });
  });

  it('BeginStart: lets the socket that owns the session start again', async () => {
    const { server } = await started();
    const socket = await owner(server);
    expect(await call(socket, 2, 'start', {})).toEqual({ type: 'result', id: 2, result: REPORT });
  });

  it('FinishStart: suspends a session whose socket closed while it started, and leaves it to no one (#42, #25)', async () => {
    const { server } = await started();
    const socket = await owner(server);
    const { promise, resolve } = Promise.withResolvers<typeof REPORT>();
    vi.mocked(controller.start).mockReturnValueOnce(promise);
    socket.receive({ type: 'call', id: 2, tool: 'start', args: {} });
    socket.closed();
    vi.mocked(controller.disconnect).mockClear();
    resolve(REPORT);
    await settle();
    expect(controller.disconnect).toHaveBeenCalledOnce();
    expect(socket.sent).toHaveLength(2);
    expect(traced).toContainEqual(`socket 1 ${RIGHT_ARROW} error 2 no_session (not sent: closed)`);
    const next = welcomed(server);
    controller.isActive = false;
    expect(await call(next, 1, 'listen', {})).toMatchObject({ type: 'error', code: 'no_session' });
  });
});

describe('calls', () => {
  it("refuses a call from a socket that doesn't own the session", async () => {
    const { server } = await started();
    const socket = welcomed(server);
    expect(await call(socket, 1, 'listen', {})).toEqual({
      type: 'error',
      id: 1,
      code: 'no_session',
      message: 'No pairing session is active. Call `start` to begin one.',
    });
  });

  it('passes step, listen, and end to the controller, with the call signal', async () => {
    const { server } = await started();
    const socket = await owner(server);
    const actions = [{ say: 'Hi.' }];
    expect(await call(socket, 2, 'step', { actions })).toEqual({ type: 'result', id: 2, result: REPORT });
    expect(await call(socket, 3, 'listen', {})).toEqual({ type: 'result', id: 3, result: REPORT });
    await call(socket, 4, 'end', { summary: 'Done.' });
    await call(socket, 5, 'end', { summary: 5 });
    expect(vi.mocked(controller.step).mock.calls[0]?.[0]).toEqual(actions);
    expect(vi.mocked(controller.step).mock.calls[0]?.[1]).toBeInstanceOf(AbortSignal);
    expect(vi.mocked(controller.listen).mock.calls[0]?.[0]).toBeInstanceOf(AbortSignal);
    expect(vi.mocked(controller.end).mock.calls.map(([summary]) => summary)).toEqual(['Done.', undefined]);
  });

  it('reads a file between the lines it is given, each only when it is a number', async () => {
    const { server } = await started();
    const socket = await owner(server);
    expect(await call(socket, 2, 'read', { file: 'a.ts', from_line: 1, to_line: 2 })).toEqual({
      type: 'result',
      id: 2,
      result: FILE_CONTENT,
    });
    await call(socket, 3, 'read', { file: 'a.ts', from_line: '1' });
    expect(vi.mocked(controller.read).mock.calls).toEqual([
      ['a.ts', 1, 2],
      ['a.ts', undefined, undefined],
    ]);
  });

  it('hands a calibration the passage read from its file, with its notice when it has one', async () => {
    const { server } = await started();
    const socket = await owner(server);
    expect(await call(socket, 2, 'calibrate', { title: 'Words', file: 'passage.txt', notice: 'From nowhere.' })).toEqual({
      type: 'result',
      id: 2,
      result: REPORT,
    });
    await call(socket, 3, 'calibrate', { title: 'Words', file: 'passage.txt' });
    expect(readFileSync).toHaveBeenCalledWith('/project/passage.txt', 'utf8');
    expect(vi.mocked(controller.calibrate).mock.calls).toEqual([
      [{ title: 'Words', text: 'Some words.', notice: 'From nowhere.' }, arm],
      [{ title: 'Words', text: 'Some words.' }, arm],
    ]);
  });

  it.each([
    { name: 'a step without actions', tool: 'step', args: {}, message: '`actions` must be an array.' },
    { name: 'a read without a file', tool: 'read', args: {}, message: '`file` must be a string.' },
    { name: 'a calibration without a title', tool: 'calibrate', args: { file: 'a' }, message: '`title` and `file` must be strings.' },
    { name: 'a calibration without a file', tool: 'calibrate', args: { title: 'a' }, message: '`title` and `file` must be strings.' },
    { name: 'an unknown tool', tool: 'bogus', args: {}, message: 'Unknown tool: bogus' },
  ])('answers $name with invalid_arguments', async ({ tool, args, message }) => {
    const { server } = await started();
    const socket = await owner(server);
    expect(await call(socket, 2, tool, args)).toEqual({ type: 'error', id: 2, code: 'invalid_arguments', message });
  });

  it('answers a ToolError with its code, and any other failure as internal, with its message', async () => {
    const { server } = await started();
    const socket = await owner(server);
    vi.mocked(controller.listen)
      .mockRejectedValueOnce(new ToolError('cancelled', 'The call was cancelled.'))
      .mockRejectedValueOnce(new Error('boom'));
    expect(await call(socket, 2, 'listen', {})).toEqual({ type: 'error', id: 2, code: 'cancelled', message: 'The call was cancelled.' });
    expect(await call(socket, 3, 'listen', {})).toEqual({ type: 'error', id: 3, code: 'internal', message: 'boom' });
  });

  it('aborts a call the relay cancels, and ignores a cancel for a call it already answered', async () => {
    const { server } = await started();
    const socket = await owner(server);
    const { promise, resolve } = Promise.withResolvers<typeof REPORT>();
    vi.mocked(controller.listen).mockReturnValueOnce(promise);
    socket.receive({ type: 'call', id: 2, tool: 'listen', args: {} });
    const signal = vi.mocked(controller.listen).mock.calls[0]?.[0];
    socket.receive({ type: 'cancel', id: 2 });
    expect(signal?.aborted).toBe(true);
    resolve(REPORT);
    await settle();
    socket.receive({ type: 'cancel', id: 2 });
    expect(lastSent(socket)).toEqual({ type: 'result', id: 2, result: REPORT });
  });

  it("Restore: takes back a report only from the session's socket, saying whether it may repeat", async () => {
    const { server } = await started();
    const socket = await owner(server);
    const stranger = welcomed(server);
    stranger.receive({ type: 'return', report: REPORT });
    socket.receive({ type: 'return', report: REPORT });
    socket.receive({ type: 'return', report: REPORT, mayRepeat: true });
    expect(vi.mocked(controller.restore).mock.calls).toEqual([
      [REPORT, false],
      [REPORT, true],
    ]);
  });

  it("NeverBlockedClosed, CloseSocket: aborts a closed socket's calls, and suspends the session only when the socket owned it", async () => {
    const { server } = await started();
    const socket = await owner(server);
    const stranger = welcomed(server);
    stranger.closed();
    expect(controller.disconnect).not.toHaveBeenCalled();
    vi.mocked(controller.listen).mockReturnValueOnce(new Promise(() => undefined));
    socket.receive({ type: 'call', id: 2, tool: 'listen', args: {} });
    const signal = vi.mocked(controller.listen).mock.calls[0]?.[0];
    socket.closed();
    expect(signal?.aborted).toBe(true);
    expect(controller.disconnect).toHaveBeenCalledOnce();
  });
});

describe('the trace', () => {
  it('names each frame both ways, and for a report what it reports (#27)', async () => {
    const { server } = await started();
    const socket = await owner(server);
    const flagged = REPORT_SCHEMA.parse({
      ...REPORT,
      waiting: true,
      rejected: { index: 1, action: { say: 'x' }, error: { kind: 'no_line', message: 'No.' } },
    });
    vi.mocked(controller.listen).mockResolvedValueOnce(flagged);
    await call(socket, 2, 'listen', {});
    await call(socket, 3, 'read', { file: 'a.ts' });
    await call(socket, 4, 'bogus', {});
    socket.receive({ type: 'cancel', id: 9 });
    socket.receive({ type: 'return', report: REPORT });
    expect(traced).toEqual([
      `socket 1 ${LEFT_ARROW} hello`,
      `socket 1 ${RIGHT_ARROW} welcome`,
      `socket 1 ${LEFT_ARROW} call 1 start`,
      `socket 1 ${RIGHT_ARROW} result 1 batches [1 completed] events [interrupt]`,
      `socket 1 ${LEFT_ARROW} call 2 listen`,
      `socket 1 ${RIGHT_ARROW} result 2 batches [1 completed] events [interrupt] rejected waiting`,
      `socket 1 ${LEFT_ARROW} call 3 read`,
      `socket 1 ${RIGHT_ARROW} result 3 `,
      `socket 1 ${LEFT_ARROW} call 4 bogus`,
      `socket 1 ${RIGHT_ARROW} error 4 invalid_arguments`,
      `socket 1 ${LEFT_ARROW} cancel 9`,
      `socket 1 ${LEFT_ARROW} return batches [1 completed] events [interrupt]`,
    ]);
    const rejected = server.connect();
    rejected.receive({ type: 'call', id: 1, tool: 'listen', args: {} });
    rejected.closed();
    expect(traced.slice(-3)).toEqual([`socket 2 ${LEFT_ARROW} call 1 listen`, `socket 2 ${RIGHT_ARROW} rejected`, 'socket 2 closed']);
  });

  it('works without a trace', async () => {
    const { server } = await started({ trace: undefined });
    const socket = await owner(server);
    socket.closed();
    expect(traced).toEqual([]);
  });
});
