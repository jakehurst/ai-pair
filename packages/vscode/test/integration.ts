// Runs inside a real VS Code (see scripts/integration.sh): plays the demo and checks the result,
// then that changes the programmer didn't make are reported as not theirs, interrupting only batches
// planned against the text before them, and that a programmer edit interrupts, with an exact report.

import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Worker } from 'node:worker_threads';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import * as vscode from 'vscode';
import { WebSocket, WebSocketServer } from 'ws';
import { CURSOR_MARKER, discoveryDir, fieldsProblem, PROTOCOL_VERSION, typeProblem, type Report, type ToolName } from '@ai-pair/protocol';
import { LEFT_ARROW } from '@ai-pair/core/constants';
import { EditorLink, findWindows } from '../../relay/src/link';
import type { Api } from '../src/extension';
import { DEFAULT_TIMINGS } from '../src/timings';
import { controllerPaths, extensionPaths, playerPaths } from './integration_paths';

const EXPECTED_TODOS = `export interface Todo {
  id: number;
  title: string;
  done: boolean;
}

const todos: Todo[] = [];
let nextId = 1;

export function createTodo(title: string): Todo {
  const todo = { id: nextId++, title, done: false };
  todos.push(todo);
  return todo;
}

export function listTodos(): Todo[] {
  return todos;
}
`;

const EXPECTED_SERVER = `import express from "express";
import { createTodo, listTodos } from "./todos";

const app = express();
app.use(express.json());

app.post("/todos", (req, res) => {
  const todo = createTodo(req.body.title);
  res.status(201).json(todo);
});

app.get("/todos", (req, res) => {
  res.json(listTodos());
});

app.listen(3000, () => console.log("Listening on http://localhost:3000"));
`;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => {
    setTimeout(r, ms);
  });
}

/** A glide long enough to catch mid-way, set as both `glideMs` and `glideMaxMs`: 500 ms at speed 20. */
const LONG_GLIDE_MS = 10_000;

/** With no call open this long, the panel says the agent isn't listening: the controller's `absentMs`. */
const ABSENT_MS = 45_000;

/** Past a timer, so it has fired. */
const GRACE_SLACK_MS = 1000;
/** The navigator's idle time, as the default is. */
const NAVIGATOR_IDLE_MS = 3000;

/** A relay's socket the test drives by hand: the frames the bridge answers with, one at a time, and its close. */
interface RawSocket {
  socket: WebSocket;
  /** Resolves with the next frame the bridge sends, as JSON. One call at a time. */
  next(): Promise<unknown>;
  closed: Promise<void>;
}

/**
 * Inserts text as the programmer would, while the agent may be typing into the same document. VS Code
 * rejects an extension's edit made against a version the document has moved past, which the agent's
 * next keystroke may do at any moment; the programmer typing would simply go through, so try again.
 */
async function insertAsProgrammer(uri: vscode.Uri, position: vscode.Position, text: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const edit = new vscode.WorkspaceEdit();
    edit.insert(uri, position, text);
    if (await vscode.workspace.applyEdit(edit)) return;
    await sleep(5);
  }
  assert.fail("VS Code kept rejecting the programmer's edit");
}

/** Returns whether `e` is the rejection of a `read` of a file that doesn't exist (#89). */
function missing(e: unknown): boolean {
  return e instanceof Error && 'code' in e && e.code === 'invalid_arguments' && e.message.includes("doesn't exist");
}

/** Returns whether `v` is the extension's `Api`, by its members: the bundle's classes are not this bundle's, so no `instanceof`. */
function isApi(v: unknown): v is Api {
  return typeof v === 'object' && v !== null && 'controller' in v && 'editor' in v && 'bridge' in v && 'playDemo' in v && 'ready' in v;
}

/** Returns the extension host's environment without `leftOut`, for a relay the test starts. */
function relayEnv(leftOut = ''): Record<string, string> {
  return Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined && e[0] !== leftOut));
}

/** Opens a socket to the bridge on `port`, as a relay or any other process on the machine can. */
async function rawSocket(port: number): Promise<RawSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  const frames: unknown[] = [];
  let wake: (() => void) | undefined;
  socket.on('message', (data: Buffer) => {
    const frame: unknown = JSON.parse(data.toString('utf8'));
    frames.push(frame);
    wake?.();
  });
  const closed = new Promise<void>((resolve) => {
    socket.once('close', () => {
      resolve();
    });
  });
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => {
      resolve();
    });
    socket.once('error', reject);
  });
  return {
    socket,
    closed,
    next: async () => {
      for (;;) {
        const frame = frames.shift();
        if (frame !== undefined) {
          return frame;
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    },
  };
}

/** Sends a call on `peer`, with `args` unless they are left out, and resolves with the bridge's answer. */
function ask(peer: RawSocket, id: number, name: string, args?: Record<string, unknown>): Promise<unknown> {
  peer.socket.send(JSON.stringify({ type: 'call', id, tool: name, ...(args === undefined ? {} : { args }) }));
  return peer.next();
}

/** Calls `name` on `client` and returns whether it failed, and its text. */
async function called(
  client: Client,
  name: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<{ failed: boolean; text: string }> {
  const result = await client.callTool({ name, arguments: args }, undefined, signal === undefined ? undefined : { signal });
  // The relay answers with text parts only.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const parts = result.content as Array<{ text: string }>;
  return { failed: result.isError === true, text: parts.map((part) => part.text).join('\n\n') };
}

/** Starts a WebSocket server standing in for an editor window, which runs `answer` on each frame it gets. */
async function fakeEditor(answer: (socket: WebSocket) => void): Promise<{ server: WebSocketServer; port: number }> {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise((resolve) => {
    server.once('listening', resolve);
  });
  server.on('connection', (socket) => {
    socket.on('message', () => {
      answer(socket);
    });
  });
  const address = server.address();
  // ws gives null before the server listens, a string for a pipe, and an object for a port.
  assert.ok(typeof address === 'object' && address !== null);
  return { server, port: address.port };
}

/** Writes the discovery file of a window that isn't this one, open on `folders`, and returns its path. */
function fakeWindow(name: string, folders: string[], port: number, changes: { pid?: number; lastFocused?: number } = {}): string {
  const written = path.join(discoveryDir(), `${name}.json`);
  fs.writeFileSync(
    written,
    JSON.stringify({
      pid: process.pid,
      workspaceFolders: folders,
      port,
      token: name,
      protocolVersion: PROTOCOL_VERSION,
      lastFocused: Date.now(),
      ...changes,
    }),
  );
  return written;
}

/** Runs every scenario inside VS Code; the extension host exits with its result. */
export async function run(): Promise<void> {
  const ext = vscode.extensions.getExtension('michalstrba.ai-pair');
  assert.ok(ext, 'extension not found');
  const exported: unknown = await ext.activate();
  assert.ok(isApi(exported), 'the extension exported something other than its Api');
  const api = exported;
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, 'no workspace folder is open');
  const root = folder.uri.fsPath;
  function file(name: string): string {
    return path.join(root, name);
  }
  async function buffer(name: string): Promise<string> {
    return (await vscode.workspace.openTextDocument(file(name))).getText();
  }
  async function disk(name: string): Promise<string> {
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.file(file(name))));
  }

  // The demo, sped up. If our own edits were mistaken for the programmer's, it would stop early.
  api.controller.setSpeed(20);
  api.controller.setReadingSpeed(10);
  const started = Date.now();
  await api.playDemo();
  console.log(`demo played in ${Date.now() - started} ms`);
  assert.equal(await buffer('ai-pair-demo/src/todos.ts'), EXPECTED_TODOS);
  assert.equal(await buffer('ai-pair-demo/src/server.ts'), EXPECTED_SERVER);
  assert.equal(await disk('ai-pair-demo/src/server.ts'), EXPECTED_SERVER, 'saved after each batch');

  // Changes the programmer didn't make are reported, without interrupting: a tool writing to another file...
  const controller = api.controller;
  controller.setSpeed(1);
  async function until(done: () => boolean): Promise<void> {
    for (let i = 0; i < 100 && !done(); i++) {
      await sleep(50);
    }
    assert.ok(done(), 'timed out');
  }
  fs.writeFileSync(file('other.txt'), 'before\n');
  const other = await vscode.workspace.openTextDocument(file('other.txt'));
  await controller.start('other edits');
  await controller.step([{ move: { file: 'tool.txt', line: 1, to: 'line_end' } }, { type_fast: `${'x'.repeat(200)}${CURSOR_MARKER}` }]);
  const queued = controller.step([{ type: `abc${CURSOR_MARKER}` }]);
  await sleep(1500);
  fs.writeFileSync(file('other.txt'), 'after\n');
  await until(() => other.getText() === 'after\n');
  const first = await queued;
  assert.deepEqual(
    first.batches.map((b) => b.status),
    ['completed'],
  );
  assert.deepEqual(first.events, [{ kind: 'edit', file: 'other.txt', diff: '@@ -1,1 +1,1 @@\n-before\n+after', by: 'other' }]);
  const toolDone = await controller.step([]);
  assert.deepEqual(
    toolDone.batches.map((b) => b.status),
    ['completed'],
  );

  // ...and a save participant, trimming what the agent typed when its batch is saved: its change isn't
  // the programmer's, and the batch queued behind it, planned against the untrimmed text, is discarded.
  await vscode.workspace.getConfiguration('files').update('trimTrailingWhitespace', true, vscode.ConfigurationTarget.Global);
  await controller.step([{ type: `\nend   ${CURSOR_MARKER}` }]);
  const trimmed = await controller.step([{ type: `!${CURSOR_MARKER}` }]);
  const trimDone = await controller.step([]);
  await vscode.workspace.getConfiguration('files').update('trimTrailingWhitespace', undefined, vscode.ConfigurationTarget.Global);
  assert.deepEqual(
    [...trimmed.batches, ...trimDone.batches].map((b) => b.status),
    ['completed', 'discarded'],
  );
  assert.deepEqual(
    [...trimmed.events, ...trimDone.events].map((e) => e.kind === 'edit' && `${e.file} ${e.by}`),
    ['tool.txt other'],
  );
  assert.ok((await buffer('tool.txt')).endsWith('abc\nend'));
  await controller.end();
  console.log('RightAuthor, ChangesHandled: changes by others are reported as theirs');
  // From here, nothing is timed against the playback until the glide tests: play fast.
  controller.setSpeed(10);

  // A keystroke just before the agent saves is the programmer's, even though its change event is
  // handled while the save runs (#40). The test's own edit stands in for the keystroke.
  fs.writeFileSync(file('race.txt'), 'a\n');
  const race = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file('race.txt')));
  await controller.start('save race');
  await race.edit((b) => {
    b.insert(new vscode.Position(0, 1), 'b');
  });
  await controller.listen();
  const keystroke = race.edit((b) => {
    b.insert(new vscode.Position(0, 2), 'c');
  });
  await api.editor.save(file('race.txt'));
  await keystroke;
  const raced = await controller.listen();
  assert.deepEqual(
    raced.events.map((e) => e.kind === 'edit' && `${e.file} ${e.by}`),
    ['race.txt programmer'],
  );
  await controller.end();
  console.log("RightAuthor, ChangesHandled: a keystroke just before a save is the programmer's");

  // Our own move to another file doesn't pause playback, however long VS Code takes to show it (#56).
  // With no window after our navigation, only the hold while show() awaits covers it.
  fs.writeFileSync(file('follow-a.txt'), 'a\n');
  fs.writeFileSync(file('follow-b.txt'), 'b\n');
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file('follow-a.txt')));
  await controller.start('follow');
  await controller.read('follow-a.txt');
  await controller.step([{ move: { file: 'follow-a.txt', line: 1, to: 'line_end' } }]);
  assert.deepEqual(
    (await controller.step([])).batches.map((b) => b.status),
    ['completed'],
  );
  await controller.read('follow-b.txt');
  api.setTimings({ selfNavMs: 0 });
  await controller.step([{ move: { file: 'follow-b.txt', line: 1, to: 'line_end' } }, { type: `x${CURSOR_MARKER}` }]);
  const moved = await controller.step([]);
  api.setTimings({ selfNavMs: DEFAULT_TIMINGS.selfNavMs });
  assert.equal(controller.isPaused, false, 'paused by our own move');
  assert.deepEqual(
    moved.batches.map((b) => b.status),
    ['completed'],
  );
  assert.equal(await buffer('follow-b.txt'), 'bx\n');
  await controller.end();
  console.log("NoPauseFromOurOwnShow, MoveEnds: our own move to another file doesn't pause");

  // An action without `file` acts in the file its batch named, not the cursor's (#58).
  fs.writeFileSync(file('named-a.txt'), 'a\n');
  fs.writeFileSync(file('named-b.txt'), 'b\nsecond\n');
  await controller.start('named file');
  await controller.read('named-a.txt');
  await controller.read('named-b.txt');
  await controller.step([{ move: { file: 'named-a.txt', line: 1, to: 'line_end' } }]);
  const twice = await controller.step([{ point: { file: 'named-b.txt', line: 1, text: 'b' } }, { point: { line: 2, text: 'second' } }]);
  assert.equal(twice.rejected, undefined);
  const pointed = await controller.step([]);
  assert.deepEqual(
    pointed.batches.map((b) => b.status),
    ['completed'],
  );
  assert.equal(vscode.window.activeTextEditor?.document.uri.fsPath, file('named-b.txt'));
  const outside = await controller.step([{ point: { file: 'named-b.txt', line: 1, text: 'b' } }, { type: `y${CURSOR_MARKER}` }]);
  assert.equal(outside.rejected?.error.kind, 'invalid_action');
  await controller.step([]);
  assert.equal(await buffer('named-a.txt'), 'a\n');
  assert.equal(await buffer('named-b.txt'), 'b\nsecond\n');
  await controller.end();
  console.log('an action without file acts in the file its batch named');

  // A report the agent cancelled as it returned is handed back before the agent's next call goes out,
  // so the editor restores it first: the next batch isn't played without it (#59), and once the
  // programmer ends the session, the session still takes it (#60). The relay's own link, against this window.
  const link = new EditorLink(root, discoveryDir());
  // The editor answers these tools with reports.
  function relayed(name: ToolName, args: Record<string, unknown>, signal?: AbortSignal): Promise<Report> {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return link.call(name, args, signal) as Promise<Report>;
  }
  fs.writeFileSync(file('return.txt'), 'a\n');
  await relayed('start', { task: 'return', cwd: root });
  await link.call('read', { file: 'return.txt' });
  const cancelListen = new AbortController();
  void relayed('listen', {}, cancelListen.signal);
  await sleep(300);
  controller.userMessage('stop');
  cancelListen.abort();
  const restored = await relayed('step', {
    actions: [{ move: { file: 'return.txt', line: 1, to: 'line_end' } }, { type: `x${CURSOR_MARKER}` }],
  });
  assert.deepEqual(
    restored.events.map((e) => e.kind),
    ['message'],
  );
  assert.deepEqual(
    restored.batches.map((b) => b.status),
    ['discarded'],
  );
  assert.equal(await buffer('return.txt'), 'a\n');

  const cancelLast = new AbortController();
  void relayed('listen', {}, cancelLast.signal);
  await sleep(300);
  controller.userMessage('one more thing');
  controller.endSession();
  cancelLast.abort();
  const ended = await relayed('listen', {});
  assert.deepEqual(
    ended.events.map((e) => e.kind),
    ['message', 'end'],
  );
  link.close();
  // The bridge disconnects the socket's session when it sees the close; let that happen before the next start.
  await sleep(300);
  console.log('a cancelled report is restored before the next call');

  // Every check of an action refuses it by name in the editor, when the relay's own schema is skipped, as a link
  // can (specs/ActionValidation.tla); and a frame that isn't JSON, or isn't a message, is dropped (specs/Wire.tla,
  // `SendGarbage`), while the socket goes on.
  const refusing = new EditorLink(root, discoveryDir());
  await refusing.call('start', { task: 'refusals', cwd: root });
  const refusals: object[] = [
    {},
    { move: { before: 'x' } },
    { move: { line: 0, to: 'line_end' } },
    { move: { to: 'start' } },
    { move: { at: `x${CURSOR_MARKER}`, to: 'line_end' } },
    { move: {} },
    { move: { at: 5 } },
    { move: { at: 'x' } },
    { move: { at: `x${CURSOR_MARKER}y${CURSOR_MARKER}` } },
    { move: { at: CURSOR_MARKER } },
    { move: { to: 'line_end', extra: 1 } },
    { select: { near_line: 3, text: 'a' } },
    { select: { to: 'y' } },
    { select: { line: 1.5, text: 'a' } },
    { select: { text: 'a', from: 'a', through: 'b' } },
    { select: { from: 'a' } },
    { select: {} },
    { select: { text: '' } },
    { select: [] },
    { point: 5 },
    { say: 'x', loud: true },
    { delete: false },
    { run: 'true', wait: '2' },
    { type: ['x'] },
    { type: 5 },
    { type: 'x' },
    { type: `${CURSOR_MARKER}x${CURSOR_MARKER}` },
  ];
  for (const action of refusals) {
    // The editor answers a step with a report.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const answer = (await refusing.call('step', { actions: [action] })) as Report;
    const expected = fieldsProblem(action) ?? ('type' in action ? typeProblem(action.type) : undefined);
    assert.equal(answer.rejected?.error.kind, 'invalid_action', JSON.stringify(action));
    if (expected !== undefined) {
      assert.equal(answer.rejected.error.message, expected, JSON.stringify(action));
    }
  }
  const window = findWindows([root], discoveryDir()).windows[0];
  const raw = new WebSocket(`ws://127.0.0.1:${window.port}`);
  const frames: string[] = [];
  raw.on('message', (data: Buffer) => {
    frames.push(data.toString('utf8'));
  });
  await new Promise<void>((resolve, reject) => {
    raw.once('open', () => {
      resolve();
    });
    raw.once('error', reject);
  });
  raw.send(JSON.stringify({ type: 'hello', token: window.token, protocolVersion: PROTOCOL_VERSION }));
  await until(() => frames.length === 1);
  raw.send('not json');
  raw.send(JSON.stringify({ type: 'bogus' }));
  raw.send(JSON.stringify({ type: 'call', id: 1, tool: 'listen', args: {} }));
  await until(() => frames.length === 2);
  assert.match(frames[1] ?? '', /^\{"type":"error","id":1,"code":"no_session"/);
  raw.close();
  await refusing.call('end', {});
  refusing.close();
  await sleep(300);
  console.log(
    `MoveExactly, SpanExactly, NeverThrows: ${refusals.length} malformed actions refused by name in the editor; frames that aren't messages dropped`,
  );

  // The bridge, driven by hand as any process on the machine could (specs/Bridge.tla). It turns away a socket without
  // the token, or with another protocol version; it answers each kind of call a session's owner makes, and a call
  // it can't take by name; it refuses a second agent; and a socket that closes, with a call open or while its start
  // runs, leaves the session suspended to no one.
  const here = findWindows([root], discoveryDir()).windows[0];
  /** Opens a socket and greets the bridge with this window's token. */
  async function greeted(): Promise<RawSocket> {
    const peer = await rawSocket(here.port);
    peer.socket.send(JSON.stringify({ type: 'hello', token: here.token, protocolVersion: PROTOCOL_VERSION }));
    assert.deepEqual(await peer.next(), { type: 'welcome' });
    return peer;
  }
  const tokenless = await rawSocket(here.port);
  tokenless.socket.send(JSON.stringify({ type: 'hello', token: 5, protocolVersion: PROTOCOL_VERSION }));
  assert.deepEqual(await tokenless.next(), { type: 'rejected', reason: 'Authentication failed.' });
  await tokenless.closed;
  const outdated = await rawSocket(here.port);
  outdated.socket.send(JSON.stringify({ type: 'hello', token: here.token, protocolVersion: PROTOCOL_VERSION - 1 }));
  assert.match(JSON.stringify(await outdated.next()), /^\{"type":"rejected","reason":"Protocol version mismatch/);
  await outdated.closed;
  const driver = await greeted();
  assert.match(JSON.stringify(await ask(driver, 1, 'start', { task: 'by hand', cwd: root })), /^\{"type":"result","id":1,/);
  assert.ok(api.bridge.connections().size > 0);
  driver.socket.send(JSON.stringify({ type: 'cancel', id: 99 }));
  const refusedCalls: Array<[string, Record<string, unknown> | undefined, string]> = [
    ['step', undefined, '`actions` must be an array.'],
    ['read', {}, '`file` must be a string.'],
    ['calibrate', { title: 'Words' }, '`title` and `file` must be strings.'],
    ['bogus', {}, 'Unknown tool: bogus'],
  ];
  for (const [i, [name, args, message]] of refusedCalls.entries()) {
    assert.deepEqual(await ask(driver, i + 2, name, args), { type: 'error', id: i + 2, code: 'invalid_arguments', message });
  }
  fs.writeFileSync(file('lines.txt'), 'one\ntwo\nthree\n');
  assert.match(
    JSON.stringify(await ask(driver, 10, 'read', { file: 'lines.txt', from_line: 2, to_line: 2 })),
    /"lines":\[\{"number":2,"text":"two"\}\]/,
  );
  assert.match(
    JSON.stringify(await ask(driver, 11, 'calibrate', { title: 'Words', file: 'missing.txt' })),
    /"code":"internal","message":"ENOENT/,
  );
  fs.writeFileSync(file('passage.txt'), 'Some words to read, timed.\n');
  assert.match(
    JSON.stringify(await ask(driver, 12, 'calibrate', { title: 'Words', file: 'passage.txt', notice: 'From the test.' })),
    /^\{"type":"result","id":12,/,
  );
  assert.match(JSON.stringify(await ask(driver, 13, 'calibrate', { title: 'Words', file: 'passage.txt' })), /"code":"calibration_busy"/);
  const second = await greeted();
  assert.match(JSON.stringify(await ask(second, 1, 'start', { cwd: root })), /"code":"session_active"/);
  driver.socket.send(JSON.stringify({ type: 'call', id: 14, tool: 'listen', args: {} }));
  await sleep(300);
  driver.socket.close();
  await driver.closed;
  await until(() => controller.isSuspended);
  const realStart = controller.start.bind(controller);
  controller.start = async (...args) => {
    await second.closed;
    return realStart(...args);
  };
  second.socket.send(JSON.stringify({ type: 'call', id: 2, tool: 'start', args: { cwd: root } }));
  await sleep(300);
  second.socket.close();
  await second.closed;
  await sleep(300);
  controller.start = realStart;
  assert.equal(controller.isSuspended, true);
  controller.endSession();
  assert.equal(controller.isPaused, false, 'the calibration still holds playback');
  // A listen with nothing to report comes back once it waited its longest, saying so (specs/Navigator.tla, `Timeout`).
  const waiter = await greeted();
  await ask(waiter, 1, 'start', { cwd: root });
  assert.match(JSON.stringify(await ask(waiter, 2, 'listen', {})), /"waiting":true/);
  // "Your move" stays for the grace, then, with no call open for longer, the panel says the agent isn't
  // listening, until its next call (#126, #149, specs/ListenGrace.tla: `Expire`, `GoAbsent`, `Call`).
  await sleep(ABSENT_MS + GRACE_SLACK_MS);
  assert.ok(
    api.history().some((e) => e.type === 'state' && e.state === 'absent'),
    'the panel never said the agent was absent',
  );
  await ask(waiter, 3, 'read', { file: 'other.txt' });
  // A call made during the grace ends it at once (`Call`).
  assert.match(JSON.stringify(await ask(waiter, 4, 'listen', {})), /"waiting":true/);
  await ask(waiter, 5, 'read', { file: 'other.txt' });
  waiter.socket.close();
  await waiter.closed;
  controller.endSession();
  await sleep(300);
  // A discovery file the window can't write is reported, and the window goes on (#9; specs/Discovery.tla, `OpenWindow`
  // unlisted). A regular file where the folder was fails the write even for root, as in a container.
  const windows = discoveryDir();
  fs.renameSync(windows, `${windows}.kept`);
  fs.writeFileSync(windows, '');
  api.bridge.focused();
  // Failing again says nothing more: the error was shown once.
  api.bridge.focused();
  fs.rmSync(windows);
  fs.renameSync(`${windows}.kept`, windows);
  api.bridge.focused();
  assert.ok(fs.existsSync(api.bridge.file), 'the discovery file was not written again');
  console.log('a socket driven by hand: turned away without the token, each call answered, a close leaves the session to no one');

  // A file changed on disk, as a git checkout does, comes from VS Code as one change spanning the
  // lines between the changed ones; the agent's selection there stays on its text (#65).
  fs.writeFileSync(file('reload.txt'), '1\n2\n3\n4\n5\n6\n');
  const reloading = await vscode.workspace.openTextDocument(file('reload.txt'));
  await vscode.window.showTextDocument(reloading);
  await controller.start('reload');
  await controller.read('reload.txt');
  await controller.step([{ select: { file: 'reload.txt', line: 3, text: '3' } }]);
  await controller.step([]);
  fs.writeFileSync(file('reload.txt'), '1\nX\n3\n4\nY\n6\n');
  await until(() => reloading.getText() === '1\nX\n3\n4\nY\n6\n');
  const reloaded = await controller.step([{ point: { file: 'reload.txt', line: 4, text: '4' } }, { delete: true }]);
  assert.equal(reloaded.rejected, undefined);
  await controller.step([]);
  assert.equal(await buffer('reload.txt'), '1\nX\n\n4\nY\n6\n');
  await controller.end();
  console.log('a file changed on disk keeps the selection on its text');

  // A file that doesn't exist is reported as missing, and a move creates it (#89). One deleted on
  // disk while VS Code holds a document for it, as Claude Code's file tools leave one, isn't read with
  // its old text, and a move creates it empty (#88). Unsaved text for a deleted file is kept.
  await controller.start('missing files');
  await assert.rejects(controller.read('missing-89.txt'), missing);
  fs.writeFileSync(file('stale-88.txt'), 'old\n');
  const stale = await vscode.workspace.openTextDocument(file('stale-88.txt'));
  assert.equal(stale.getText(), 'old\n');
  fs.unlinkSync(file('stale-88.txt'));
  await assert.rejects(controller.read('stale-88.txt'), missing);
  const recreated = await controller.step([{ move: { file: 'stale-88.txt', line: 1, to: 'line_end' } }, { type: `new${CURSOR_MARKER}` }]);
  assert.equal(recreated.rejected, undefined);
  const played = (await controller.step([])).batches;
  assert.deepEqual(
    played.map((b) => b.status),
    ['completed'],
    JSON.stringify(played),
  );
  assert.equal(await buffer('stale-88.txt'), 'new');
  assert.equal(await disk('stale-88.txt'), 'new');
  fs.writeFileSync(file('unsaved-88.txt'), 'a\n');
  const unsaved = await vscode.workspace.openTextDocument(file('unsaved-88.txt'));
  await insertAsProgrammer(unsaved.uri, new vscode.Position(0, 1), 'b');
  // The programmer's edit interrupts: its report comes first, or the move would be discarded unrehearsed.
  assert.equal((await controller.listen()).events.at(-1)?.kind, 'edit');
  fs.unlinkSync(file('unsaved-88.txt'));
  assert.deepEqual((await controller.read('unsaved-88.txt')).lines, [{ number: 1, text: 'ab' }]);
  // A move to it shows the document as it is: no file is created over the programmer's text.
  const keptMove = await controller.step([{ move: { file: 'unsaved-88.txt', line: 1, to: 'line_end' } }]);
  assert.equal(keptMove.rejected, undefined);
  const keptPlayed = (await controller.step([])).batches;
  assert.deepEqual(
    keptPlayed.map((b) => b.status),
    ['completed'],
    JSON.stringify(keptPlayed),
  );
  assert.equal(await buffer('unsaved-88.txt'), 'ab\n');
  assert.equal(fs.existsSync(file('unsaved-88.txt')), false);
  await unsaved.save();
  await controller.end();
  console.log(
    'NotStale, MissingIsReported, CreatedIsEmpty, KeepsUnsavedProp: missing and deleted files read as missing, and are created empty',
  );

  // A file written on disk outside the protocol is marked, during a session, until it's opened; a
  // save and a file the agent created aren't (#15, specs/Outside.tla).
  fs.writeFileSync(file('outside-saved.txt'), 'a\n');
  const savedDoc = await vscode.workspace.openTextDocument(file('outside-saved.txt'));
  // The watcher reports that write late; outside a session it isn't marked.
  await sleep(2000);
  await controller.start('outside');
  fs.writeFileSync(file('outside-written.txt'), 'by another tool\n');
  await until(() => api.outside.isMarked(file('outside-written.txt')));
  await insertAsProgrammer(savedDoc.uri, new vscode.Position(0, 1), 'b');
  await savedDoc.save();
  await controller.step([{ move: { file: 'outside-new.txt', line: 1, to: 'line_end' } }, { type: `x${CURSOR_MARKER}` }]);
  await controller.step([]);
  // Past the group's settling, and the watcher's own delay.
  await sleep(2000);
  assert.equal(api.outside.isMarked(file('outside-saved.txt')), false, 'a save was marked');
  assert.equal(api.outside.isMarked(file('outside-new.txt')), false, "the agent's new file was marked");
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file('outside-written.txt')));
  await until(() => !api.outside.isMarked(file('outside-written.txt')));
  // One opened as soon as it's written was seen, though its writes weren't decided yet.
  fs.writeFileSync(file('outside-opened.txt'), 'seen at once\n');
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file('outside-opened.txt')));
  await sleep(2000);
  assert.equal(api.outside.isMarked(file('outside-opened.txt')), false, 'a file seen as soon as it was written was marked');
  await controller.end();
  console.log("a file written outside is marked until it's opened; saves and new files aren't");

  // During the programmer's turn, a listen made after they resume typing waits for their next pause
  // (specs/Navigator.tla). The idle time is set here to what the default is, through the controller's setTimeouts.
  api.controller.setTimeouts({ navigatorIdleMs: NAVIGATOR_IDLE_MS });
  fs.writeFileSync(file('navigator.txt'), 'abc\n');
  const navigator = await vscode.workspace.openTextDocument(file('navigator.txt'));
  await vscode.window.showTextDocument(navigator);
  await controller.start('navigator');
  controller.takeTurn();
  await controller.listen();
  await insertAsProgrammer(navigator.uri, new vscode.Position(0, 3), 'd');
  await sleep(NAVIGATOR_IDLE_MS + GRACE_SLACK_MS);
  await insertAsProgrammer(navigator.uri, new vscode.Position(0, 4), 'e');
  const listenedAt = Date.now();
  const afterPause = await controller.listen();
  const waited = Date.now() - listenedAt;
  assert.ok(waited > 2000, `listen returned ${waited} ms after the programmer typed`);
  assert.deepEqual(
    afterPause.events.map((e) => e.kind === 'edit' && e.diff.includes('+abcde')),
    [true],
  );
  await controller.end();
  console.log(`a listen during the programmer's typing waited ${waited} ms for their pause`);

  // An edit the programmer undid still comes with the batches it discarded (specs/EditEvents.tla).
  // The programmer's edit must land while the agent is still typing: real speed.
  controller.setSpeed(1);
  fs.writeFileSync(file('undone.txt'), 'abc\n');
  const undone = await vscode.workspace.openTextDocument(file('undone.txt'));
  await vscode.window.showTextDocument(undone);
  await controller.start('undone');
  await controller.read('undone.txt');
  // The first step returns at once; nothing waits for a report while the programmer types and undoes.
  await controller.step([{ move: { file: 'undone.txt', line: 1, to: 'line_end' } }, { type_fast: `${'x'.repeat(100)}${CURSOR_MARKER}` }]);
  await sleep(800);
  await insertAsProgrammer(undone.uri, new vscode.Position(0, 0), '#');
  const undo = new vscode.WorkspaceEdit();
  undo.delete(undone.uri, new vscode.Range(0, 0, 0, 1));
  await vscode.workspace.applyEdit(undo);
  const discardedReport = await controller.step([]);
  assert.ok(
    discardedReport.batches.some((b) => b.status !== 'completed'),
    JSON.stringify(discardedReport.batches),
  );
  assert.deepEqual(discardedReport.events, [{ kind: 'edit', file: 'undone.txt', diff: '', by: 'programmer' }]);
  await controller.end();
  console.log('an edit the programmer undid is reported with the batches it discarded');

  // A scroll a command cut short goes on once the command is done (specs/Scroll.tla). The moves
  // there and back first measure the view, so the last one glides from the top: the timing makes a
  // glide 500 ms, and at speed 20 the command starts some 50 ms into it.
  const ai = vscode.workspace.getConfiguration('aiPair');
  await ai.update('confirmCommands', false, vscode.ConfigurationTarget.Global);
  await ai.update('timing', { glideMs: LONG_GLIDE_MS, glideMaxMs: LONG_GLIDE_MS }, vscode.ConfigurationTarget.Global);
  fs.writeFileSync(file('glide.txt'), Array.from({ length: 300 }, (_, i) => `line ${i + 1}\n`).join(''));
  const glide = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file('glide.txt')));
  controller.setSpeed(20);
  await controller.start('glide');
  await controller.read('glide.txt');
  for (const line of [150, 1]) {
    await controller.step([{ move: { file: 'glide.txt', line, to: 'line_end' } }]);
    await controller.step([]);
    await sleep(800);
  }
  assert.equal(glide.visibleRanges[0]?.start.line, 0);
  await controller.step([{ move: { file: 'glide.txt', line: 250, to: 'line_end' } }, { run: 'sleep 1' }]);
  const ran = await controller.step([]);
  assert.deepEqual(
    ran.batches.map((b) => b.status),
    ['completed'],
  );
  await sleep(800);
  const shown = glide.visibleRanges.map((r) => `${r.start.line + 1}-${r.end.line + 1}`);
  assert.ok(
    glide.visibleRanges.some((r) => r.start.line <= 249 && 249 <= r.end.line),
    `line 250 not in view: ${shown.join(', ')}`,
  );
  controller.setSpeed(1);
  await controller.end();
  await ai.update('confirmCommands', undefined, vscode.ConfigurationTarget.Global);
  console.log(`ComesInView: a scroll a command cut short went on to line 250: ${shown.join(', ')}`);

  // The follow scroll's glide takes its time from the playback speed (#123): at `slow`, a glide of
  // LONG_GLIDE_MS takes a second, part way at `sampleMs`; at `fast` it takes 100 ms, done by then.
  const slow = 10;
  const fast = 100;
  const sampleMs = 300;
  function top(): number {
    return glide.visibleRanges[0]?.start.line ?? 0;
  }
  async function glideTo(line: number, speed: number): Promise<number> {
    controller.setSpeed(speed);
    await controller.step([{ move: { file: 'glide.txt', line, to: 'line_end' } }]);
    await controller.step([]);
    await sleep(sampleMs);
    return top();
  }
  await controller.start('glide speed');
  await controller.read('glide.txt');
  assert.equal(await glideTo(1, fast), 0);
  const midway = await glideTo(250, slow);
  await sleep(LONG_GLIDE_MS / slow);
  const landed = top();
  assert.ok(midway > 0 && midway < landed, `slow glide not part way: ${midway} of ${landed}`);
  assert.equal(await glideTo(1, fast), 0);
  assert.equal(await glideTo(250, fast), landed);
  controller.setSpeed(1);
  await controller.end();
  await ai.update('timing', undefined, vscode.ConfigurationTarget.Global);
  console.log(`a glide took its time from the speed: part way at line ${midway + 1} of ${landed + 1}`);

  // An interrupt while a `run` saves its files stops it, without waiting to ask the programmer.
  fs.writeFileSync(file('asked.txt'), 'a\n');
  await controller.start('asked');
  await controller.read('asked.txt');
  const interrupting = vscode.workspace.onWillSaveTextDocument(() => {
    controller.userInterrupt();
  });
  controller.setSpeed(20);
  await controller.step([{ move: { file: 'asked.txt', line: 1, to: 'line_end' } }, { type: `b${CURSOR_MARKER}` }, { run: 'true' }]);
  const asked = await Promise.race([controller.listen(), sleep(3000).then(() => undefined)]);
  interrupting.dispose();
  assert.ok(asked, 'listen is still waiting');
  assert.deepEqual(
    asked.batches.map((b) => b.status),
    ['interrupted'],
  );
  controller.setSpeed(10);
  await controller.end();
  console.log('an interrupt while a run saves stops it, without asking');

  // A batch interrupted after a type with nothing to type changed nothing, so it's discarded (specs/Actions.tla).
  fs.writeFileSync(file('nothing.txt'), 'a\n');
  await controller.start('nothing');
  await controller.read('nothing.txt');
  await controller.step([{ move: { file: 'nothing.txt', line: 1, to: 'line_end' } }]);
  await controller.step([]);
  const eol = api.editor.eol.bind(api.editor);
  let eols = 0;
  api.editor.eol = async (f) => {
    if (++eols === 2) controller.userInterrupt();
    return eol(f);
  };
  await controller.step([{ type: CURSOR_MARKER }, { say: 'Typed.' }]);
  const untyped = await controller.listen();
  api.editor.eol = eol;
  assert.deepEqual(
    untyped.batches.map((b) => b.status),
    ['discarded'],
  );
  await controller.end();
  console.log('a batch interrupted after a type with nothing to type is discarded');

  // A pause holds a sleep with what is left of it, and the resume plays the rest (specs/Timeline.tla, `Pause`,
  // `Resume`). An interrupt while a move waits for its file to show cuts the move's next pause at once, and the
  // next batch plays on a timeline reset (`Interrupt`, `Reset`).
  fs.writeFileSync(file('paused.txt'), 'a\nb\n');
  await controller.start('paused');
  await controller.read('paused.txt');
  controller.setReadingSpeed(1);
  await controller.step([{ say: Array.from({ length: 10 }, (_, i) => `word${i}`).join(' ') }]);
  await sleep(200);
  controller.pause('programmer');
  await sleep(1000);
  assert.equal(controller.isPaused, true);
  controller.resume('programmer');
  assert.deepEqual(
    (await controller.step([])).batches.map((b) => b.status),
    ['completed'],
  );
  controller.setReadingSpeed(10);
  const show = api.editor.show.bind(api.editor);
  api.editor.show = (f) => {
    api.editor.show = show;
    controller.userInterrupt();
    return show(f);
  };
  await controller.step([{ move: { file: 'paused.txt', line: 1, to: 'line_end' } }, { say: 'Not said.' }]);
  assert.deepEqual(
    (await controller.listen()).batches.map((b) => b.status),
    ['interrupted'],
  );
  await controller.step([{ move: { file: 'paused.txt', line: 2, to: 'line_end' } }]);
  assert.deepEqual(
    (await controller.step([])).batches.map((b) => b.status),
    ['completed'],
  );
  await controller.end();
  console.log(
    'NoTimerWhilePaused, ResumeContinues, ResolvedOnce: a pause held a say until the resume; an interrupt during a show cut the move, and the next batch played',
  );

  // A line a tool inserts, read while a queued batch edits other files, is accepted (specs/Rehearsal.tla).
  fs.writeFileSync(file('inserted.txt'), 'hello\n');
  const inserted = await vscode.workspace.openTextDocument(file('inserted.txt'));
  await vscode.window.showTextDocument(inserted);
  await controller.start('inserted');
  await controller.read('inserted.txt');
  controller.setReadingSpeed(1);
  await controller.step([{ say: Array.from({ length: 25 }, (_, i) => `word${i}`).join(' ') }]);
  fs.writeFileSync(file('inserted.txt'), 'XX\nhello\n');
  await until(() => inserted.getText() === 'XX\nhello\n');
  assert.deepEqual(
    (await controller.read('inserted.txt')).lines.map((l) => l.text),
    ['XX', 'hello'],
  );
  const movedThere = await controller.step([{ move: { file: 'inserted.txt', line: 1, to: 'line_end' } }]);
  assert.equal(movedThere.rejected, undefined, JSON.stringify(movedThere.rejected));
  await controller.step([]);
  controller.setReadingSpeed(10);
  await controller.end();
  console.log('a line a tool inserted, read while a queued batch edits other files, is accepted');

  // A session the agent disconnects from waits, suspended, saved in the workspace's storage; one
  // brought back from it, as after a reload, resumes on a start from its folder (#25, specs/Resume.tla).
  fs.writeFileSync(file('kept.txt'), 'one\ntwo\n');
  await controller.start('kept');
  await controller.read('kept.txt');
  await controller.step([{ move: { file: 'kept.txt', line: 2, to: 'line_end' } }]);
  await controller.step([]);
  controller.disconnect();
  assert.equal(controller.isSuspended, true);
  await sleep(500);
  const kept = api.saved();
  assert.ok(kept?.scene.cursor, "the suspended session wasn't saved");
  controller.endSession();
  controller.revive(kept);
  const revived = await controller.start('kept');
  assert.equal(revived.resumed, true);
  assert.match(revived.cursor?.lines.find((l) => l.text.includes(CURSOR_MARKER))?.text ?? '', /two/);
  await controller.end();
  console.log('a session saved while suspended resumes, with its cursor');

  // A folder in the workspace whose name starts with two dots is in the workspace (#5).
  fs.mkdirSync(file('..cache'), { recursive: true });
  fs.writeFileSync(file('..cache/x.txt'), 'a\n');
  const dotted = await vscode.workspace.openTextDocument(file('..cache/x.txt'));
  await vscode.window.showTextDocument(dotted);
  await controller.start('dotted');
  fs.writeFileSync(file('..cache/x.txt'), 'b\n');
  await until(() => dotted.getText() === 'b\n');
  const dottedReport = await controller.listen();
  assert.deepEqual(
    dottedReport.events.map((e) => e.kind === 'edit' && e.file),
    ['..cache/x.txt'],
  );
  await controller.end();
  console.log('a change in ..cache/ is reported, by its path in the workspace');

  // Finding short text on a line of a long file, where it matches on every line, takes no time (#2).
  fs.writeFileSync(file('long.ts'), '  foo(bar(baz(1), 2), 3);\n'.repeat(40_000));
  await controller.start('long');
  await controller.read('long.ts', 39_999, 40_000);
  const finding = Date.now();
  const found = await controller.step([{ point: { file: 'long.ts', line: 40_000, text: 'foo(' } }]);
  const findMs = Date.now() - finding;
  assert.equal(found.rejected, undefined);
  assert.ok(findMs < 2000, `the step took ${findMs} ms`);
  await controller.end();
  console.log(`a point on line 40,000 was rehearsed in ${findMs} ms`);

  // The panel's page reloading takes its draft with it, and the draft's pause (#69). The test can't
  // type into the page, so it adds the pause the page's `draft` message adds.
  await vscode.commands.executeCommand('aiPair.narration.focus');
  await sleep(1000);
  controller.pause('reply');
  await vscode.commands.executeCommand('workbench.action.webview.reloadWebviewAction');
  await until(() => !controller.isPaused);
  console.log("a reloaded panel ends its draft's pause");

  // The window's discovery file, rewritten on focus, is never half written for a relay reading it (#72).
  await api.ready;
  const stop = new SharedArrayBuffer(4);
  const reader = new Worker(
    `const { parentPort, workerData } = require("node:worker_threads"); const fs = require("node:fs")
    const stop = new Int32Array(workerData.stop); let reads = 0, broken = 0
    while (Atomics.load(stop, 0) === 0) { try { JSON.parse(fs.readFileSync(workerData.file, "utf8")) } catch { broken++ } reads++ }
    parentPort.postMessage({ reads, broken })`,
    { eval: true, workerData: { file: api.bridge.file, stop } },
  );
  const counted = new Promise<{ reads: number; broken: number }>((r) => {
    reader.once('message', r);
  });
  await sleep(100);
  for (let i = 0; i < 2000; i++) {
    api.bridge.focused();
  }
  Atomics.store(new Int32Array(stop), 0, 1);
  const { reads, broken } = await counted;
  await reader.terminate();
  assert.ok(reads > 0);
  assert.equal(broken, 0, `${broken} of ${reads} reads didn't parse`);
  assert.ok(findWindows([root], discoveryDir()).windows.some((w) => w.pid === process.pid));
  console.log(`FindsRunningProp: the discovery file is never half written (${reads} reads)`);

  // A programmer edit mid-typing interrupts, and the report shows exactly what was typed.
  const alphabet = 'abcdefghijklmnopqrstuvwxyz';
  controller.setSpeed(1);
  await controller.start('interrupt test');
  await controller.step([{ move: { file: 'scratch.ts', line: 1, to: 'line_end' } }, { type: `${alphabet}${CURSOR_MARKER}` }]);
  const pending = controller.step([{ type: `!${CURSOR_MARKER}` }]);
  // Past the pauses around moving into a new file (~1 s), and into the typing.
  await sleep(1500);
  const doc = await vscode.workspace.openTextDocument(file('scratch.ts'));
  await insertAsProgrammer(doc.uri, new vscode.Position(0, 0), '// mine\n');

  const report = await pending;
  const [typing, next] = report.batches;
  assert.equal(typing?.status, 'interrupted', JSON.stringify(report));
  // What's left of the cut `type` comes back first, ready to resubmit.
  const rest = typing.unplayed?.[0];
  const left = rest && 'type' in rest ? rest.type.replace(CURSOR_MARKER, '') : '';
  const typed = alphabet.slice(0, alphabet.length - left.length);
  assert.ok(typed.length > 0 && left.length > 0 && alphabet.endsWith(left), `left: ${JSON.stringify(left)}`);
  assert.equal(next?.status, 'discarded');
  assert.equal(report.events[0]?.kind, 'edit');
  assert.equal(doc.getText(), `// mine\n${typed}`);
  assert.deepEqual(typing.code, {
    file: 'scratch.ts',
    lines: [
      { number: 1, text: '// mine' },
      { number: 2, text: typed + CURSOR_MARKER },
    ],
    end: { final_newline: false },
  });
  await controller.end();
  console.log(`interrupted after typing ${JSON.stringify(typed)}`);

  // A programmer edit outside the workspace is none of the session's business: it interrupts nothing.
  const away = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-pair-away-'));
  const awayFile = path.join(away, 'notes.txt');
  fs.writeFileSync(awayFile, 'theirs\n');
  const awayDoc = await vscode.workspace.openTextDocument(awayFile);
  await controller.start('edit elsewhere');
  await controller.read('scratch.ts');
  const unbothered = controller.step([{ move: { file: 'scratch.ts', line: 2, to: 'line_end' } }, { type: `${alphabet}${CURSOR_MARKER}` }]);
  await sleep(1500);
  await insertAsProgrammer(awayDoc.uri, new vscode.Position(0, 0), '// theirs\n');
  // A step comes back while its batch plays on; the next steps wait for the end.
  let unbotheredReport = await unbothered;
  while (unbotheredReport.batches.length === 0) {
    unbotheredReport = await controller.step([]);
  }
  assert.deepEqual(
    unbotheredReport.batches.map((b) => b.status),
    ['completed'],
    JSON.stringify(unbotheredReport),
  );
  assert.equal(awayDoc.getText(), '// theirs\ntheirs\n');
  assert.equal(doc.getText(), `// mine\n${typed}${alphabet}`);
  await controller.end();
  fs.rmSync(away, { recursive: true });
  console.log('an edit outside the workspace interrupts nothing');

  // An agent connecting the way a harness does: the launcher, over stdio, from the project folder.
  await api.ready;
  // Its frames at Info, with `aiPair.trace` (#27): checked in the log once it's done.
  await vscode.workspace.getConfiguration('aiPair').update('trace', true, vscode.ConfigurationTarget.Global);
  const transport = new StdioClientTransport({
    command: api.launcher,
    cwd: root,
    env: relayEnv(),
  });
  const agent = new Client({ name: 'integration', version: '0' });
  await agent.connect(transport);
  const tools = await agent.listTools();
  assert.deepEqual(tools.tools.map((t) => t.name).toSorted(), ['calibrate', 'end', 'listen', 'read', 'start', 'step']);
  // Every text part of a tool's result, joined.
  async function toolAll(name: string, args: Record<string, unknown> = {}): Promise<string> {
    const result = await agent.callTool({ name, arguments: args });
    // The relay answers with text parts only.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return (result.content as Array<{ text: string }>).map((part) => part.text).join('\n\n');
  }
  async function tool(name: string, args: Record<string, unknown> = {}): Promise<string> {
    const result = await agent.callTool({ name, arguments: args });
    // The relay answers with text parts only.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const content = result.content as Array<{ type: string; text: string }>;
    const part = content[0];
    assert.ok(result.isError !== true, part?.text ?? 'tool error');
    assert.ok(part, `${name} answered with no text`);
    return part.text;
  }
  controller.setSpeed(20);
  // The project's guide reaches the agent with the pairing guide (#23).
  fs.mkdirSync(file('.ai-pair'), { recursive: true });
  fs.writeFileSync(file('.ai-pair/GUIDE.md'), 'Name every test after the issue it covers.\n');
  const startText = await toolAll('start', { task: 'relay test' });
  assert.match(startText, /# Project rules[\s\S]*\.ai-pair\/GUIDE\.md\n\nName every test after the issue it covers\./);
  await tool('step', {
    actions: [
      { say: 'Hello from the relay.' },
      { move: { file: 'relay.txt', line: 1, to: 'line_end' } },
      { type: `typed via the relay${CURSOR_MARKER}` },
    ],
  });
  const last = await tool('step', { actions: [] });
  assert.match(last, /Batch \d+ completed/);
  assert.equal(await buffer('relay.txt'), 'typed via the relay');
  // A call the agent cancels after taking its answer: the SDK's client still sends the cancel, so
  // the relay hands the report back, and it comes again saying it may repeat (#67).
  const cancelAfter = new AbortController();
  const taken = agent.callTool({ name: 'listen', arguments: {} }, undefined, { signal: cancelAfter.signal });
  await sleep(300);
  controller.userMessage('seen once');
  // The relay answers with text parts only.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const takenFirst = ((await taken).content as Array<{ text: string }>)[0];
  assert.ok(takenFirst, 'listen answered with no text');
  assert.match(takenFirst.text, /seen once/);
  cancelAfter.abort();
  const repeated = await tool('listen');
  assert.match(repeated, /seen once/);
  assert.match(repeated, /may repeat/);
  console.log('a report canceled after it was taken comes again, marked');
  await tool('end', { summary: 'Bye.' });
  // Two rejections cancelled after the agent took them come back, each in a report marked as one
  // that may repeat, and a session the programmer ends stays until both are out (specs/Controller.tla).
  await toolAll('start', { task: 'held' });
  async function rejectedOnce(line: number): Promise<AbortController> {
    const abort = new AbortController();
    const actions = [{ move: { file: 'relay.txt', line, to: 'line_end' } }];
    const result = await agent.callTool({ name: 'step', arguments: { actions } }, undefined, { signal: abort.signal });
    // The relay answers with text parts only.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const answer = (result.content as Array<{ text: string }>)[0];
    assert.ok(answer, 'step answered with no text');
    assert.match(answer.text, /rejected/);
    return abort;
  }
  const one = await rejectedOnce(5);
  const two = await rejectedOnce(6);
  one.abort();
  two.abort();
  // The cancels reach the relay, and its returns the editor, before anything else happens.
  await sleep(300);
  controller.endSession();
  const backs = [await toolAll('listen'), await toolAll('listen')];
  for (const [i, back] of backs.entries()) {
    assert.match(back, /may repeat/);
    assert.match(back, new RegExp(`"line":${i + 5}`));
  }
  assert.ok((await agent.callTool({ name: 'listen', arguments: {} })).isError === true, 'the ended session is still open');
  console.log('rejections handed back after their answers each come again, marked, before an ended session closes');
  // The relay's own schema refuses each malformed action before it reaches the editor, saying what is wrong
  // (specs/ActionValidation.tla): the ones the editor refused above, and a few more only the schema sees.
  const schemaRefusals: unknown[] = [
    ...refusals,
    5,
    { say: 'a', type: `b${CURSOR_MARKER}` },
    { move: { line: '3', to: 'line_end' } },
    { select: { line: 1, text: 5 } },
    { select: { text: 'a', extra: 1 } },
    { type_fast: 5 },
    { type_fast: 'x' },
  ];
  for (const action of schemaRefusals) {
    const refused = await agent.callTool({ name: 'step', arguments: { actions: [action] } });
    assert.equal(refused.isError, true, JSON.stringify(action));
  }
  console.log(`the relay's schema refused ${schemaRefusals.length} malformed actions`);
  await agent.close();
  // The run's log, in the user data folder next to the workspace (scripts/integration.sh).
  const logs = path.join(root, '..', 'user', 'logs');
  function traced(): string {
    return fs
      .readdirSync(logs, { recursive: true, encoding: 'utf8' })
      .filter((f) => path.basename(f) === 'AI Pair.log')
      .map((f) => fs.readFileSync(path.join(logs, f), 'utf8'))
      .join('');
  }
  await until(() => new RegExp(`\\[info\\] socket \\d+ ${LEFT_ARROW} call \\d+ start`).test(traced()));
  await vscode.workspace.getConfiguration('aiPair').update('trace', undefined, vscode.ConfigurationTarget.Global);
  console.log("relay session OK, with the project's guide");

  // A relay tries the windows best first, skipping a file that isn't a window's, a window whose pid is gone, one whose
  // port nothing answers, one that rejects its hello, and one that answers with something not a message; a folder that
  // doesn't exist is no folder to look for (specs/Discovery.tla, `Start`, `Try`; specs/Wire.tla, `RejectHello`,
  // `SendGarbage`). The windows that aren't hold this window's folder, focused later, so they come first.
  const refused = await fakeEditor(() => undefined);
  refused.server.close();
  const rejecting = await fakeEditor((socket) => {
    socket.send(JSON.stringify({ type: 'rejected', reason: 'Not you.' }));
    socket.close();
  });
  const garbled = await fakeEditor((socket) => {
    socket.send('not a message');
  });
  const later = Date.now() + 60_000;
  const gone = spawnSync('true').pid;
  fs.writeFileSync(path.join(discoveryDir(), 'junk.json'), '{');
  const fakes = [
    path.join(discoveryDir(), 'junk.json'),
    fakeWindow('gone', [root], garbled.port, { pid: gone, lastFocused: later + 4 }),
    fakeWindow('refused', [root], refused.port, { lastFocused: later + 3 }),
    fakeWindow('rejecting', [root], rejecting.port, { lastFocused: later + 2 }),
    fakeWindow('garbled', [root], garbled.port, { lastFocused: later + 1 }),
  ];
  /** Starts a relay as a harness does, with `env`, in `cwd`. */
  async function relayAgent(env: Record<string, string>, cwd = root): Promise<Client> {
    const client = new Client({ name: 'integration', version: '0' });
    await client.connect(new StdioClientTransport({ command: api.launcher, cwd, env }));
    return client;
  }
  const fooled = await relayAgent(relayEnv());
  const fooledStart = await called(fooled, 'start', { task: 'fakes', cwd: '/no/such/folder' });
  assert.equal(fooledStart.failed, false, fooledStart.text);
  // Another folder of the window: the relay closes its socket and finds the window again (specs/Wire.tla, `CloseSocket`).
  fs.mkdirSync(file('sub'), { recursive: true });
  const relocated = await called(fooled, 'start', { task: 'moved', cwd: file('sub') });
  assert.equal(relocated.failed, false, relocated.text);
  // A folder only a window that isn't one holds: every window fails, and the first failure is the answer.
  const outsider = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-pair-outsider-'));
  fakes.push(fakeWindow('outside', [outsider], refused.port));
  const nowhere = await called(fooled, 'start', { task: 'outside', cwd: outsider });
  assert.ok(nowhere.failed && nowhere.text.startsWith("no_editor: Couldn't connect to the editor: "), nowhere.text);
  assert.equal((await called(fooled, 'start', { task: 'back', cwd: root })).failed, false);
  // A listen the agent cancels before the editor answers: the next call waits until that answer comes, and goes
  // back to the editor first (specs/Wire.tla, `Abort`, `Send` with WaitForReturn, `Reply`).
  const realListen = controller.listen.bind(controller);
  let held = Promise.withResolvers<void>();
  controller.listen = async () => {
    await held.promise;
    return realListen();
  };
  controller.userMessage('held');
  const cancelling = new AbortController();
  const cancelled = called(fooled, 'listen', {}, cancelling.signal).catch(() => undefined);
  await sleep(300);
  cancelling.abort();
  await cancelled;
  const afterCancel = called(fooled, 'step', { actions: [] });
  await sleep(300);
  held.resolve();
  assert.match((await afterCancel).text, /held/);
  // The editor's end closing during a call: the agent is told to start again (#138; specs/Wire.tla, `HandleClose`).
  const dropped = called(fooled, 'listen', {});
  await sleep(300);
  for (const socket of api.bridge.connections()) {
    socket.terminate();
  }
  const droppedAnswer = await dropped;
  assert.ok(droppedAnswer.failed && droppedAnswer.text.includes('call `start` again'), droppedAnswer.text);
  await until(() => controller.isSuspended);
  // The harness going away while a call waits for a cancelled one: the relay shuts down, and the waiting call
  // opens no socket (specs/Wire.tla, `Shutdown`, `OpenSocket` with CloseAfterShutdown).
  assert.equal((await called(fooled, 'start', { task: 'resumed', cwd: root })).failed, false);
  held = Promise.withResolvers<void>();
  const abandoning = new AbortController();
  const abandoned = called(fooled, 'listen', {}, abandoning.signal).catch(() => undefined);
  await sleep(300);
  abandoning.abort();
  await abandoned;
  void fooled.callTool({ name: 'step', arguments: { actions: [] } }).catch(() => undefined);
  await sleep(300);
  await fooled.close();
  await sleep(500);
  held.resolve();
  controller.listen = realListen;
  controller.endSession();
  for (const fake of fakes) {
    fs.rmSync(fake);
  }
  rejecting.server.close();
  garbled.server.close();
  // A relay whose windows' folder holds no windows file yet, and one whose folder no window has open.
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-pair-home-'));
  const lonely = await relayAgent({ ...relayEnv(), AI_PAIR_HOME: empty });
  const noWindow = await called(lonely, 'start', { task: 'none' });
  assert.ok(noWindow.failed && noWindow.text.includes('No VS Code window with the AI Pair extension is running'), noWindow.text);
  await lonely.close();
  const elsewhere = await relayAgent(relayEnv(), outsider);
  const notOpen = await called(elsewhere, 'start', { task: 'elsewhere', cwd: outsider });
  assert.ok(notOpen.failed && notOpen.text.includes(`No VS Code window has ${outsider} open`), notOpen.text);
  // A window slowEditor to welcome: a call the agent cancels meanwhile isn't sent, and a welcome after the harness went
  // away closes its socket (specs/Wire.tla, `Send` with CheckAbort; `Welcome` with CloseAfterShutdown).
  const greetedSlowly: WebSocket[] = [];
  const slowEditor = await fakeEditor((socket) => {
    greetedSlowly.push(socket);
  });
  const slowFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-pair-slowEditor-'));
  const slowFile = fakeWindow('slow', [slowFolder], slowEditor.port);
  const impatient = new AbortController();
  const gaveUp = called(elsewhere, 'start', { task: 'slow', cwd: slowFolder }, impatient.signal).catch(() => undefined);
  await sleep(500);
  impatient.abort();
  await gaveUp;
  await sleep(300);
  greetedSlowly.at(-1)?.send(JSON.stringify({ type: 'welcome' }));
  await sleep(300);
  await elsewhere.close();
  const leaving = await relayAgent(relayEnv(), outsider);
  void leaving.callTool({ name: 'start', arguments: { task: 'leaving', cwd: slowFolder } }).catch(() => undefined);
  await sleep(500);
  // The SDK's close kills a relay still running after 2 s, and a killed one writes no coverage: the welcome comes first.
  const closing = leaving.close();
  await sleep(500);
  greetedSlowly.at(-1)?.send(JSON.stringify({ type: 'welcome' }));
  await closing;
  // The harness going away while the first window has not welcomed, which then drops the socket: the relay tries no
  // other window (#220, specs/Wire.tla, `OpenSocket` with CloseAfterShutdown). The second is the same editor, which
  // would be greeted again.
  const secondFile = fakeWindow('second', [slowFolder], slowEditor.port, { lastFocused: 0 });
  const dropping = await relayAgent(relayEnv(), outsider);
  void dropping.callTool({ name: 'start', arguments: { task: 'dropping', cwd: slowFolder } }).catch(() => undefined);
  await sleep(500);
  const greetedBefore = greetedSlowly.length;
  const dropClosing = dropping.close();
  await sleep(500);
  greetedSlowly.at(-1)?.close();
  await dropClosing;
  assert.equal(greetedSlowly.length, greetedBefore, 'the relay tried another window after it closed');
  fs.rmSync(secondFile);
  fs.rmSync(slowFile);
  slowEditor.server.close();
  fs.rmSync(outsider, { recursive: true });
  fs.rmSync(slowFolder, { recursive: true });
  fs.rmSync(empty, { recursive: true });
  // A relay with no AI_PAIR_HOME looks for the windows under the home directory; listing its tools reads nothing.
  const homeless = await relayAgent(relayEnv('AI_PAIR_HOME'));
  assert.equal((await homeless.listTools()).tools.length, tools.tools.length);
  await homeless.close();
  console.log(
    'RelayStaysUp, ConnectedToOpen: a relay skipped the windows that are not, canceled and shut down cleanly, and started without AI_PAIR_HOME',
  );

  // Set Up Agent, with the agents' config folders in the run's folder and no agent installed (scripts/integration.sh):
  // closing the picker changes nothing; Another agent puts the configuration on the clipboard; and of the agents
  // picked, one whose file is broken is reported, and the rest are set up. The picker's items are Claude Code, Codex,
  // OpenCode, Gemini CLI, Cursor, and Another agent, in that order, none ticked. Gemini CLI and Cursor write under the
  // real home, so they are never picked here.
  const agents = path.join(root, '..', 'agents');
  /** Runs Set Up Agent, ticks the items at `indexes` in its picker with VS Code's quick input commands, and accepts, or hides it with none. */
  async function setUpAgents(indexes: number[]): Promise<void> {
    const running = vscode.commands.executeCommand('aiPair.setUpAgent');
    await sleep(1000);
    if (indexes.length === 0) {
      await vscode.commands.executeCommand('quickInput.hide');
    } else {
      await vscode.commands.executeCommand('quickInput.first');
      let at = 0;
      for (const index of indexes) {
        for (; at < index; at++) {
          await vscode.commands.executeCommand('quickInput.next');
        }
        await vscode.commands.executeCommand('quickInput.toggleCheckbox');
      }
      await vscode.commands.executeCommand('quickInput.accept');
    }
    await running;
  }
  await vscode.env.clipboard.writeText('');
  await setUpAgents([]);
  assert.equal(await vscode.env.clipboard.readText(), '');
  await setUpAgents([5]);
  const copied: unknown = JSON.parse(await vscode.env.clipboard.readText());
  assert.deepEqual(copied, { mcpServers: { pair: { command: api.launcher, args: [] } } });
  fs.mkdirSync(path.join(agents, 'claude'), { recursive: true });
  fs.writeFileSync(path.join(agents, 'claude', '.claude.json'), '{ "mcpServers": ');
  await setUpAgents([0, 1]);
  assert.equal(fs.readFileSync(path.join(agents, 'claude', '.claude.json'), 'utf8'), '{ "mcpServers": ', 'the broken file was changed');
  assert.match(fs.readFileSync(path.join(agents, 'codex', 'config.toml'), 'utf8'), /\[mcp_servers\.pair\]/);
  // Opened again, it lists Codex as set up; from the run's own config files, so the same on every machine.
  await setUpAgents([]);
  console.log('Set Up Agent: closed, copied for another agent, and set up Codex past a broken Claude Code file');

  // Last, since they change the playback's settings: the player's and the controller's paths (#176).
  await playerPaths(api, root);
  await controllerPaths(api, root);
  await extensionPaths(api, root);

  // The window's file and its sockets go with it, at exit: here the file is gone already, and a socket is still open
  // (specs/Discovery.tla, `CloseWindow`).
  await greeted();
  fs.rmSync(api.bridge.file);
}
