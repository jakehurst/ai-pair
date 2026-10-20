// The relay's link to an editor window, on its own. The cases are the counterexamples TLC found in specs/Wire.tla
// and specs/Discovery.tla. Solitary: the socket is a fake the test drives event by event, the discovery folder is a
// mocked disk, and the protocol's parse and folder check are mocks, the parse deciding by the real message schema.

import { ok } from 'node:assert/strict';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PROTOCOL_VERSION, RELAY_MESSAGE_SCHEMA, REPORT_SCHEMA, type Discovery, type RelayMessage } from '@ai-pair/protocol';
import { EDITOR_DISCONNECTED, EditorLink, findWindows, LINK_CLOSED } from '../src/link';

/** What the mocked modules share with the tests, made before the `vi.mock` factories run. */
const fakes = vi.hoisted(() => {
  /** A socket's states, as `ws` numbers them. */
  const CONNECTING = 0;
  const OPEN = 1;
  const CLOSING = 2;
  const CLOSED = 3;

  /** The `ws` socket, faked: the test drives its events, and it records what the link sent. */
  class FakeSocket {
    static readonly OPEN = OPEN;
    /** Every socket the link opened, in order. */
    static readonly made: FakeSocket[] = [];
    readyState = CONNECTING;
    /** What the link sent, as JSON. */
    readonly sent: unknown[] = [];
    readonly send = vi.fn((data: string) => {
      const message: unknown = JSON.parse(data);
      this.sent.push(message);
    });
    readonly close = vi.fn(() => {
      if (this.readyState !== CLOSED) {
        this.readyState = CLOSING;
      }
    });
    private readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>();

    constructor(
      readonly url: string,
      readonly options: unknown,
    ) {
      FakeSocket.made.push(this);
    }

    on(event: string, listener: (...args: unknown[]) => void): void {
      this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    }

    /** Opens: the link sends its hello. */
    open(): void {
      this.readyState = OPEN;
      this.emit('open');
    }

    /** Hands the link a frame from the editor; the mocked parse takes it as the message itself. */
    receive(message: unknown): void {
      this.emit('message', message);
    }

    /** Fails, as a socket does when nothing answers on its port. */
    fail(message: string): void {
      this.emit('error', new Error(message));
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

  return {
    FakeSocket,
    /** The folder the discovery files are in. */
    dir: '/windows',
    /** The mocked disk: each discovery file's text by its path. */
    files: new Map<string, string>(),
    /** Paths whose real path can't be found, so `realpathSync` throws on them. */
    missing: new Set<string>(),
  };
});

/** The folder the link reads discovery files from. */
const DIR = fakes.dir;

/** The first port a test window listens on; each window after it takes the next. */
const FIRST_PORT = 1000;

/** A report, built by its schema, as the editor answers. */
const REPORT = REPORT_SCHEMA.parse({ batches: [], events: [], turn: 'agent' });

vi.mock('ws', () => ({ default: fakes.FakeSocket }));
vi.mock('node:fs', () => ({
  readdirSync: vi.fn((dir: string) => {
    if (dir !== fakes.dir) {
      throw new Error(`ENOENT: no such directory, scandir '${dir}'`);
    }
    return [...fakes.files.keys()].map((file) => file.slice(fakes.dir.length + 1));
  }),
  readFileSync: vi.fn((file: string) => {
    const text = fakes.files.get(file);
    if (text === undefined) {
      throw new Error(`ENOENT: no such file, open '${file}'`);
    }
    return text;
  }),
  realpathSync: vi.fn((file: string) => {
    if (fakes.missing.has(file)) {
      throw new Error(`ENOENT: no such file, realpath '${file}'`);
    }
    return file;
  }),
}));
vi.mock(import('@ai-pair/protocol'), async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    // The real parse reads a frame's JSON; the fake socket hands over the message itself, and the real schema checks it.
    parseEditorMessage: vi.fn((data: unknown) => original.EDITOR_MESSAGE_SCHEMA.safeParse(data).data),
    // A folder holds itself and the paths under it, by their text: all these tests' paths need.
    withinFolder: vi.fn((folder: string, file: string) => (file === folder || file.startsWith(`${folder}/`) ? file : undefined)),
  };
});

/** A socket the link opened. */
type FakeSocket = InstanceType<typeof fakes.FakeSocket>;

/** A call the link sent. */
type SentCall = Extract<RelayMessage, { type: 'call' }>;

/** Puts a discovery file for window `name` on the mocked disk, open on `folders`, and returns it. */
function window(name: string, folders: string[], changes: Partial<Discovery> = {}): Discovery {
  const discovery: Discovery = {
    pid: process.pid,
    workspaceFolders: folders,
    port: FIRST_PORT + fakes.files.size,
    token: name,
    protocolVersion: PROTOCOL_VERSION,
    lastFocused: 0,
    ...changes,
  };
  fakes.files.set(`${DIR}/${name}.json`, JSON.stringify(discovery));
  return discovery;
}

/** Returns the socket the link opened last. */
function lastSocket(): FakeSocket {
  const socket = fakes.FakeSocket.made.at(-1);
  ok(socket);
  return socket;
}

/** Opens `socket` and welcomes the link, as an editor does once it checks the hello. */
function welcome(socket: FakeSocket): void {
  socket.open();
  socket.receive({ type: 'welcome' });
}

/** Returns what the link sent on `socket`, each parsed by the relay's message schema, so a wrong frame fails here. */
function sentOn(socket: FakeSocket): RelayMessage[] {
  return socket.sent.map((message) => RELAY_MESSAGE_SCHEMA.parse(message));
}

/** Returns the calls the link sent on `socket`. */
function callsOn(socket: FakeSocket): SentCall[] {
  return sentOn(socket).filter((message): message is SentCall => message.type === 'call');
}

/** Returns the call the link sent `n`th (from 0) on `socket`. */
function sentCall(socket: FakeSocket, n = 0): SentCall {
  const call = callsOn(socket)[n];
  ok(call);
  return call;
}

/** Answers the call `id` on `socket` with `result`. */
function answer(socket: FakeSocket, id: number, result: unknown): void {
  socket.receive({ type: 'result', id, result });
}

/** Lets the link's awaits run: everything the last step settled. */
function settle(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

afterEach(() => {
  fakes.FakeSocket.made.length = 0;
  fakes.files.clear();
  fakes.missing.clear();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('call', () => {
  it('OwnCloseOnly: rejects a call only when the socket it was sent on closes', async () => {
    window('a', ['/a']);
    window('b', ['/b']);
    const link = new EditorLink('/a', DIR);
    const first = link.call('read', {});
    const onA = lastSocket();
    welcome(onA);
    await settle();
    answer(onA, sentCall(onA).id, 'from a');
    expect(await first).toBe('from a');

    expect(link.locate(['/b'])).toBe('/b');
    expect(onA.close).toHaveBeenCalled();
    const second = link.call('read', {});
    const onB = lastSocket();
    welcome(onB);
    await settle();
    // A's close completes after the call went out on B: B's call is not A's to reject.
    onA.closed();
    const outcome = await Promise.race([
      second.then(
        () => 'settled',
        () => 'settled',
      ),
      settle().then(() => 'pending'),
    ]);
    expect(outcome).toBe('pending');
    answer(onB, sentCall(onB).id, 'from b');
    expect(await second).toBe('from b');
  });

  it('CallsAnswered: tells the agent to call `start` again when the editor disconnects during a call (#138)', async () => {
    window('a', ['/a']);
    const link = new EditorLink('/a', DIR);
    const call = link.call('listen', {});
    const socket = lastSocket();
    welcome(socket);
    await settle();
    socket.closed();
    await expect(call).rejects.toMatchObject({ code: 'no_editor', message: EDITOR_DISCONNECTED });
  });

  it.each([
    { name: 'a string', frame: 'not json' },
    { name: 'a number', frame: 42 },
    { name: 'an array', frame: [] },
    { name: 'an object with no type', frame: { kind: 'welcome' } },
    { name: "a rejection whose reason isn't a text", frame: { type: 'rejected', reason: 5 } },
  ])('RelayStaysUp: fails to connect, without crashing, when a window answers with $name', async ({ frame }) => {
    window('a', ['/a']);
    const link = new EditorLink('/a', DIR);
    const call = link.call('read', {});
    const socket = lastSocket();
    socket.open();
    socket.receive(frame);
    await expect(call).rejects.toMatchObject({
      code: 'no_editor',
      message: "The editor's port answered with something that isn't a message.",
    });
    expect(socket.close).toHaveBeenCalled();
  });

  it('RelayStaysUp: drops a frame that is not a message after the welcome, and an answer to no call', async () => {
    window('a', ['/a']);
    const link = new EditorLink('/a', DIR);
    const call = link.call('read', {});
    const socket = lastSocket();
    welcome(socket);
    await settle();
    socket.receive('not a message');
    const unknownId = 999;
    answer(socket, unknownId, 'stray');
    socket.receive({ type: 'error', id: unknownId, code: 'stray', message: 'An error for no call.' });
    expect(socket.close).not.toHaveBeenCalled();
    answer(socket, sentCall(socket).id, 'ok');
    expect(await call).toBe('ok');
  });

  it("NoReportLost: doesn't send a call that was cancelled before it went out", async () => {
    window('a', ['/a']);
    const link = new EditorLink('/a', DIR);
    const abort = new AbortController();
    const call = link.call('listen', {}, abort.signal);
    abort.abort();
    const socket = lastSocket();
    welcome(socket);
    await expect(call).rejects.toMatchObject({ code: 'cancelled' });
    expect(callsOn(socket)).toEqual([]);
  });

  it("PlaysAfterCompleted: sends the next call only after a canceled call's report is handed back (#59)", async () => {
    window('a', ['/a']);
    const link = new EditorLink('/a', DIR);
    const abort = new AbortController();
    const first = link.call('listen', {}, abort.signal);
    const socket = lastSocket();
    welcome(socket);
    await settle();
    abort.abort();
    expect(sentOn(socket).map((message) => message.type)).toEqual(['hello', 'call', 'cancel']);
    const second = link.call('read', {});
    await settle();
    expect(callsOn(socket)).toHaveLength(1);
    // The editor answered before the cancel reached it: the report goes back, to come with the next one.
    answer(socket, sentCall(socket).id, REPORT);
    expect(sentOn(socket).at(-1)).toEqual({ type: 'return', report: REPORT });
    expect(await first).toEqual(REPORT);
    await settle();
    answer(socket, sentCall(socket, 1).id, 'second');
    expect(await second).toBe('second');
  });

  it('sends the next call once the editor answers a cancelled call with an error, and hands back no answer to a read', async () => {
    window('a', ['/a']);
    const link = new EditorLink('/a', DIR);
    const listening = new AbortController();
    const first = link.call('listen', {}, listening.signal);
    const socket = lastSocket();
    welcome(socket);
    await settle();
    listening.abort();
    const second = link.call('read', {});
    await settle();
    expect(callsOn(socket)).toHaveLength(1);
    socket.receive({ type: 'error', id: sentCall(socket).id, code: 'cancelled', message: 'The call was cancelled.' });
    await expect(first).rejects.toMatchObject({ code: 'cancelled' });
    await settle();
    const reading = new AbortController();
    const third = link.call('read', {}, reading.signal);
    await settle();
    reading.abort();
    answer(socket, sentCall(socket, 1).id, 'second');
    expect(await second).toBe('second');
    answer(socket, sentCall(socket, 2).id, 'third');
    expect(await third).toBe('third');
    expect(sentOn(socket).filter((message) => message.type === 'return')).toEqual([]);
  });

  it('sends no cancel on a socket that is closing', async () => {
    window('a', ['/a']);
    window('b', ['/b']);
    const link = new EditorLink('/a', DIR);
    const closing = new AbortController();
    const second = link.call('listen', {}, closing.signal);
    const socket = lastSocket();
    welcome(socket);
    await settle();
    link.locate(['/b']);
    closing.abort();
    expect(sentOn(socket).map((message) => message.type)).toEqual(['hello', 'call']);
    socket.closed();
    await expect(second).rejects.toMatchObject({ code: 'no_editor', message: EDITOR_DISCONNECTED });
  });

  it("rejects a call with the editor's reason when a window answers `rejected` instead of a welcome", async () => {
    window('a', ['/a']);
    const link = new EditorLink('/a', DIR);
    const call = link.call('read', {});
    const socket = lastSocket();
    socket.open();
    socket.receive({ type: 'rejected', reason: 'Authentication failed.' });
    await expect(call).rejects.toMatchObject({ code: 'no_editor', message: 'Authentication failed.' });
  });

  it("fails to connect on the socket's error or close before the welcome, and leaves an error after it to the close", async () => {
    window('a', ['/a']);
    const link = new EditorLink('/a', DIR);
    const refused = link.call('read', {});
    lastSocket().fail('ECONNREFUSED');
    await expect(refused).rejects.toMatchObject({ code: 'no_editor', message: "Couldn't connect to the editor: ECONNREFUSED" });
    const hungUp = link.call('read', {});
    lastSocket().closed();
    await expect(hungUp).rejects.toMatchObject({ code: 'no_editor', message: 'The editor closed the connection.' });
    const call = link.call('read', {});
    const socket = lastSocket();
    welcome(socket);
    await settle();
    socket.fail('reset');
    answer(socket, sentCall(socket).id, 'ok');
    expect(await call).toBe('ok');
  });

  it('FindsOpen: opens one socket for calls made while it opens, reuses it, and opens again once it closed', async () => {
    window('a', ['/a']);
    const link = new EditorLink('/a', DIR);
    const first = link.call('read', {});
    const second = link.call('read', {});
    const socket = lastSocket();
    welcome(socket);
    await settle();
    answer(socket, sentCall(socket).id, 'one');
    answer(socket, sentCall(socket, 1).id, 'two');
    expect([await first, await second]).toEqual(['one', 'two']);
    const third = link.call('read', {});
    await settle();
    expect(fakes.FakeSocket.made).toHaveLength(1);
    answer(socket, sentCall(socket, 2).id, 'three');
    expect(await third).toBe('three');
    socket.closed();
    const fourth = link.call('read', {});
    expect(fakes.FakeSocket.made).toHaveLength(2);
    lastSocket().closed();
    await expect(fourth).rejects.toMatchObject({ code: 'no_editor' });
  });

  it('ConnectedToOpen, FindsOpen: tries the next window when one fails, and fails with the first error when all do', async () => {
    window('new', ['/a'], { lastFocused: 2 });
    window('old', ['/a'], { lastFocused: 1 });
    const link = new EditorLink('/a', DIR);
    const call = link.call('read', {});
    const first = lastSocket();
    expect(first.url).toBe(`ws://127.0.0.1:${FIRST_PORT}`);
    first.fail('ECONNREFUSED');
    await settle();
    const second = lastSocket();
    expect(second.url).toBe(`ws://127.0.0.1:${FIRST_PORT + 1}`);
    welcome(second);
    await settle();
    answer(second, sentCall(second).id, 'ok');
    expect(await call).toBe('ok');

    const other = new EditorLink('/a', DIR);
    const failing = other.call('read', {});
    lastSocket().fail('first');
    await settle();
    lastSocket().fail('second');
    await expect(failing).rejects.toMatchObject({ message: "Couldn't connect to the editor: first" });
  });

  it('keeps its socket when told to locate the folder it has, and locates another with no socket open', async () => {
    window('a', ['/a']);
    window('b', ['/b']);
    const link = new EditorLink('/a', DIR);
    const call = link.call('read', {});
    const socket = lastSocket();
    welcome(socket);
    await settle();
    expect(link.locate(['/a'])).toBe('/a');
    expect(socket.close).not.toHaveBeenCalled();
    answer(socket, sentCall(socket).id, 'ok');
    expect(await call).toBe('ok');
    expect(new EditorLink('/a', DIR).locate(['/b'])).toBe('/b');
  });
});

describe('close', () => {
  it('closes the open socket', async () => {
    window('a', ['/a']);
    const link = new EditorLink('/a', DIR);
    const call = link.call('read', {});
    const socket = lastSocket();
    welcome(socket);
    await settle();
    answer(socket, sentCall(socket).id, 'ok');
    await call;
    link.close();
    expect(socket.close).toHaveBeenCalled();
  });

  it('ExitsAfterShutdown: closes a socket the editor welcomes after the link closed, and opens none after it', async () => {
    window('a', ['/a']);
    const link = new EditorLink('/a', DIR);
    // The call opens the socket at once; the welcome comes after the close.
    const first = link.call('read', {});
    const socket = lastSocket();
    link.close();
    welcome(socket);
    await expect(first).rejects.toMatchObject({ code: 'no_editor', message: LINK_CLOSED });
    expect(socket.close).toHaveBeenCalled();
    await expect(link.call('read', {})).rejects.toMatchObject({ code: 'no_editor', message: LINK_CLOSED });
    expect(fakes.FakeSocket.made).toHaveLength(1);
  });

  it('ExitsAfterShutdown: tries no other window once the link closed while the first one failed', async () => {
    window('new', ['/a'], { lastFocused: 2 });
    window('old', ['/a'], { lastFocused: 1 });
    const link = new EditorLink('/a', DIR);
    const call = link.call('read', {});
    link.close();
    lastSocket().fail('ECONNREFUSED');
    await expect(call).rejects.toMatchObject({ code: 'no_editor', message: LINK_CLOSED });
    expect(fakes.FakeSocket.made).toHaveLength(1);
  });
});

describe('handBack', () => {
  it('DroppedHandedBack: hands a report back on the socket it came over, marked as maybe seen, and nothing it cannot', async () => {
    window('a', ['/a']);
    const link = new EditorLink('/a', DIR);
    const listen = link.call('listen', {});
    const socket = lastSocket();
    welcome(socket);
    await settle();
    answer(socket, sentCall(socket).id, REPORT);
    const report = await listen;
    expect(report).toEqual(REPORT);
    link.handBack(report);
    expect(sentOn(socket).at(-1)).toEqual({ type: 'return', report: REPORT, mayRepeat: true });

    const read = link.call('read', {});
    await settle();
    answer(socket, sentCall(socket, 1).id, { file: 'a.ts', dirty: false, lines: [] });
    const file = await read;
    // A `listen` answered with no object takes nothing to hand back.
    const text = link.call('listen', {});
    await settle();
    answer(socket, sentCall(socket, 2).id, 'not a report');
    const empty = link.call('listen', {});
    await settle();
    const jsonNull: unknown = JSON.parse('null');
    answer(socket, sentCall(socket, 3).id, jsonNull);
    await Promise.all([text, empty]);
    const sent = socket.sent.length;
    // `read` takes no report; a value that is no object, or JSON's null; a report it never answered; the socket gone.
    link.handBack(file);
    link.handBack('not a report');
    link.handBack(jsonNull);
    link.handBack(structuredClone(REPORT));
    socket.closed();
    link.handBack(report);
    expect(socket.sent).toHaveLength(sent);
  });
});

describe('findWindows', () => {
  it('picks the most specific workspace folder, then the most recently focused window', () => {
    window('wide', ['/work'], { lastFocused: 3 });
    window('old', ['/work/app'], { lastFocused: 1 });
    window('recent', ['/work/app'], { lastFocused: 2 });
    expect(findWindows(['/work/app/src'], DIR).windows.map((found) => found.token)).toEqual(['recent', 'old', 'wide']);
    expect(findWindows(['/work/app/src'], DIR).root).toBe('/work/app');
    expect(findWindows(['/work/lib'], DIR).windows.map((found) => found.token)).toEqual(['wide']);
    expect(findWindows(['/work/lib'], DIR).root).toBe('/work');
  });

  it('takes the first folder a window has open, and names the first one when none does', () => {
    window('b', ['/b']);
    expect(findWindows(['/a', '/b'], DIR).folder).toBe('/b');
    expect(() => findWindows(['/c', '/d'], DIR)).toThrow(
      'No VS Code window has /c open. Ask the programmer to open it in VS Code (with the AI Pair extension).',
    );
  });

  it('says no window runs when the folder has no discovery files, or does not exist', () => {
    const none = 'No VS Code window with the AI Pair extension is running. Ask the programmer to open /a in VS Code.';
    expect(() => findWindows(['/a'], DIR)).toThrow(none);
    expect(() => findWindows(['/a'], '/nowhere')).toThrow(none);
  });

  it("NoInternal: skips a file that isn't JSON, JSON that isn't a window's, and a file not named as JSON", () => {
    fakes.files.set(`${DIR}/half.json`, '{"pid":');
    fakes.files.set(`${DIR}/internal.json`, JSON.stringify({ pid: process.pid, workspaceFolders: ['/a'] }));
    fakes.files.set(`${DIR}/list.json`, JSON.stringify([process.pid]));
    fakes.files.set(`${DIR}/notes.txt`, JSON.stringify({}));
    window('real', ['/a']);
    expect(findWindows(['/a'], DIR).windows.map((found) => found.token)).toEqual(['real']);
  });

  it('ConnectedToOpen: skips a window whose pid is gone, and keeps one it may not signal, which is alive', () => {
    const gone = 4242;
    const otherUser = 4343;
    vi.spyOn(process, 'kill').mockImplementation((pid) => {
      if (pid === gone) {
        throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
      }
      if (pid === otherUser) {
        throw Object.assign(new Error('EPERM'), { code: 'EPERM' });
      }
      // oxlint-disable-next-line no-throw-literal, only-throw-error
      throw 'not an Error';
    });
    window('gone', ['/a'], { pid: gone });
    window('other user', ['/a'], { pid: otherUser });
    window('strange', ['/a']);
    expect(findWindows(['/a'], DIR).windows.map((found) => found.token)).toEqual(['other user']);
  });

  it('takes a folder whose real path cannot be found as it is', () => {
    fakes.missing.add('/a');
    window('a', ['/a']);
    expect(findWindows(['/a'], DIR).folder).toBe('/a');
  });
});

describe('workspace', () => {
  it("gives the folder and the innermost of its window's workspace folders that holds it", () => {
    window('ws', ['/work', '/work/app']);
    expect(new EditorLink('/work', DIR).workspace('/work/app/src')).toEqual({ folder: '/work/app/src', root: '/work/app' });
  });
});
