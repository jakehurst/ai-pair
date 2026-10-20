// Finding the right editor window and talking to it. See "Discovery and connection" in ARCHITECTURE.md.

import * as fs from 'node:fs';
import * as path from 'node:path';
import WebSocket from 'ws';
import { DISCOVERY_SCHEMA, parseEditorMessage, PROTOCOL_VERSION, withinFolder, type Discovery, type ToolName } from '@ai-pair/protocol';
import { RELAY_TIMINGS } from './timings';

/** A call's error when its window's socket closes: a reloaded window keeps the session for a `start` (#25, #138). */
export const EDITOR_DISCONNECTED = 'The editor disconnected. If its window was reloaded, call `start` again to resume the session.';

/** A call's error once the link is closed: the harness ended the relay's stdin (#163). */
export const LINK_CLOSED = 'The relay is shutting down.';

/** Tools whose results are reports, which must be delivered at least once (#67). */
const REPORTING: ReadonlySet<ToolName> = new Set(['step', 'listen', 'end']);

interface Pending {
  tool: ToolName;
  cancelled: boolean;
  resolve: (result: unknown) => void;
  reject: (error: RelayError) => void;
}

/** A welcomed socket, with its calls: what `openWindow` resolves with. */
interface Connection {
  ws: WebSocket;
  /** The socket's calls waiting for an answer, so that its close rejects only its own. */
  calls: Map<number, Pending>;
  /** The socket's cancelled calls not yet answered: settled once the editor's answer arrives. */
  cancelled: Set<Promise<void>>;
}

/** A call's failure the agent reads as `code: message`. */
export class RelayError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function realpath(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

function contains(folder: string, file: string): boolean {
  return withinFolder(folder, file) !== undefined;
}

/**
 * Returns whether the process is running: a window that crashed (specs/Discovery.tla, `Crash`) leaves its file
 * behind, and its pid may since belong to another process (`Reuse`), which the window's port then tells apart.
 */
function alive(pid: number): boolean {
  try {
    process.kill(pid, /* signal= */ 0);
    return true;
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'EPERM';
  }
}

/**
 * Finds the first of `folders` inside a live window's workspace folder, and the windows it's in,
 * best first: the most closely containing workspace folder, then the most recently focused window.
 * `root` is the best window's workspace folder that holds it, as a real path.
 */
export function findWindows(folders: string[], dir: string): { folder: string; root: string; windows: [Discovery, ...Discovery[]] } {
  const windows: Discovery[] = [];
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {
    // No windows have registered yet.
  }
  for (const f of files) {
    try {
      const d: unknown = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      // specs/Discovery.tla, `Start`: the candidates hold a Discovery by its schema (`CheckFiles`), with a live pid.
      const parsed = DISCOVERY_SCHEMA.safeParse(d);
      if (parsed.success && alive(parsed.data.pid)) windows.push(parsed.data);
    } catch {
      // Being written, or garbage.
    }
  }

  for (const folder of folders) {
    const here = realpath(folder);
    const matches: Array<{ window: Discovery; root: string }> = [];
    for (const window of windows) {
      const [root] = window.workspaceFolders
        .map((f) => realpath(f))
        .filter((f) => contains(f, here))
        .toSorted((a, b) => b.length - a.length);
      if (root !== undefined) matches.push({ window, root });
    }
    matches.sort((a, b) => b.root.length - a.root.length || b.window.lastFocused - a.window.lastFocused);
    const [best, ...rest] = matches;
    if (best) return { folder, root: best.root, windows: [best.window, ...rest.map((m) => m.window)] };
  }
  throw new RelayError(
    'no_editor',
    windows.length === 0
      ? `No VS Code window with the AI Pair extension is running. Ask the programmer to open ${folders[0]} in VS Code.`
      : `No VS Code window has ${folders[0]} open. Ask the programmer to open it in VS Code (with the AI Pair extension).`,
  );
}

/** A lazily (re)connected link to the editor window for the agent's folder, `cwd` until `locate` says otherwise. */
export class EditorLink {
  private connection: Connection | undefined;
  private connecting: Promise<Connection> | undefined;
  private closed = false;
  private nextId = 1;
  /** The socket each report came over, for `handBack`. */
  private readonly answeredOn = new WeakMap<object, WebSocket>();
  private folder: string;

  constructor(
    cwd: string,
    private readonly dir: string,
  ) {
    this.folder = cwd;
  }

  /** Links to the window for the first of `folders` that one has open, and returns that folder. */
  locate(folders: string[]): string {
    const { folder } = findWindows(folders, this.dir);
    if (folder !== this.folder) {
      this.folder = folder;
      // specs/Wire.tla, `CloseSocket`: calls no longer go out on this socket; its close handler rejects its own.
      this.connection?.ws.close();
      this.connection = undefined;
    }
    return folder;
  }

  /**
   * Returns `folder`, and the workspace folder of the window for it that holds it, both as real paths:
   * where a project's guides are looked for, and where that stops (#23).
   */
  workspace(folder: string): { folder: string; root: string } {
    // specs/Discovery.tla, `Start`: the root is the workspace folder the best window was found by.
    return { folder: realpath(folder), root: findWindows([folder], this.dir).root };
  }

  /** Sends the agent's tool call (specs/Wire.tla, `Request`) on the open socket (`Send`). */
  async call(tool: ToolName, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    // A cancelled call's report may be on its way back, to be handed back with `return`. This call
    // goes out after it, so the editor restores the report before it takes this call (#59; specs/Wire.tla,
    // `Send` with WaitCancelled; specs/Controller.tla, `Sendable` with WaitForReturn). The socket may close
    // meanwhile, so it is taken again after each wait; from there to `send`, nothing awaits.
    let connection: Connection;
    for (;;) {
      connection = await this.connect();
      if (connection.cancelled.size === 0) break;
      await Promise.all(connection.cancelled);
    }
    // An abort that fired before the listener below is added won't fire again (#29). A call never
    // sent takes no report, so there is nothing to hand back (`Send` with CheckAbort).
    if (signal?.aborted === true) throw new RelayError('cancelled', 'The call was cancelled.');
    const { ws, calls, cancelled } = connection;
    const id = this.nextId++;
    const { promise: answer, resolve, reject } = Promise.withResolvers<unknown>();
    const pending: Pending = { tool, cancelled: false, resolve, reject };
    calls.set(id, pending);
    // The socket is open, and nothing awaited since connect() said so; the arguments are the agent's JSON.
    ws.send(JSON.stringify({ type: 'call', id, tool, args }));
    // specs/Wire.tla, `Abort`: the relay handles the client's cancel of a call it sent. The SDK aborts a call only
    // while it is unanswered, so the call is still in `calls`.
    signal?.addEventListener(
      'abort',
      () => {
        pending.cancelled = true;
        // Only its settling matters here; its outcome is the caller's.
        const settled = answer.then(
          () => {},
          () => {},
        );
        cancelled.add(settled);
        void settled.then(() => {
          cancelled.delete(settled);
        });
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'cancel', id }));
      },
      { once: true },
    );
    return answer;
  }

  /**
   * Hands a report back to the editor, on the socket it came over, to be delivered with the next
   * report, marked as one the agent may have seen: for a call it canceled after the relay answered (#67;
   * specs/Wire.tla, `Abort` with HandBackAnswered and MarkRepeats; specs/Controller.tla, `BounceLate`).
   */
  handBack(report: unknown): void {
    // A WeakMap answers undefined for a key that isn't an object, as for a report this link never answered.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const ws = this.answeredOn.get(report as object);
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'return', report, mayRepeat: true }));
  }

  /** Closes the link for good: its socket closes, and it opens no other (specs/Wire.tla, `Shutdown`). */
  close(): void {
    this.closed = true;
    this.connection?.ws.close();
  }

  private connect(): Promise<Connection> {
    // specs/Wire.tla, `OpenSocket` with CloseAfterShutdown: a closed link opens no socket.
    if (this.closed) return Promise.reject(new RelayError('no_editor', LINK_CLOSED));
    if (this.connection?.ws.readyState === WebSocket.OPEN) return Promise.resolve(this.connection);
    // specs/Wire.tla, `OpenSocket`: with no socket open, one attempt at a time.
    this.connecting ??= this.open().finally(() => {
      this.connecting = undefined;
    });
    return this.connecting;
  }

  /**
   * Tries the matching windows best first. A window's file can outlive it when VS Code didn't shut
   * down cleanly, and its pid can then belong to another process, so an unreachable one is skipped
   * (specs/Discovery.tla, `Try`).
   */
  private async open(): Promise<Connection> {
    let first: unknown;
    for (const window of findWindows([this.folder], this.dir).windows) {
      try {
        return await this.openWindow(window);
      } catch (error) {
        first ??= error;
      }
    }
    throw first;
  }

  private openWindow(window: Discovery): Promise<Connection> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${window.port}`, { handshakeTimeout: RELAY_TIMINGS.handshakeMs });
      let welcomed = false;
      const calls = new Map<number, Pending>();
      const connection: Connection = { ws, calls, cancelled: new Set() };
      function settle(id: number): Pending | undefined {
        const p = calls.get(id);
        calls.delete(id);
        return p;
      }
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'hello', token: window.token, protocolVersion: PROTOCOL_VERSION }));
      });
      // ws hands over each frame as one Buffer, as no binaryType is set (#180).
      ws.on('message', (data: Buffer) => {
        const message = parseEditorMessage(data);
        if (!message) {
          // Before the welcome, whatever is on this port isn't our editor. After it, drop the frame
          // (specs/Wire.tla, `SendGarbage`).
          if (!welcomed) {
            reject(new RelayError('no_editor', "The editor's port answered with something that isn't a message."));
            ws.close();
          }
          return;
        }
        if (message.type === 'welcome') {
          // specs/Wire.tla, `Welcome` with CloseAfterShutdown: after the link closed, the socket closes, so
          // nothing keeps the relay's process alive.
          if (this.closed) {
            reject(new RelayError('no_editor', LINK_CLOSED));
            ws.close();
            return;
          }
          // specs/Wire.tla, `Welcome`: calls go out on this socket.
          welcomed = true;
          this.connection = connection;
          resolve(connection);
        } else if (message.type === 'rejected') {
          // specs/Wire.tla, `RejectHello`: the editor refused the hello, and closes its end.
          reject(new RelayError('no_editor', message.reason));
        } else if (message.type === 'result') {
          const call = settle(message.id);
          // The call returned before our cancellation reached the editor, so the agent will never
          // see this report. Hand it back to be delivered with the next one (specs/Wire.tla, `Reply`;
          // specs/Controller.tla, `Bounce`).
          if (call?.cancelled === true && REPORTING.has(call.tool)) {
            ws.send(JSON.stringify({ type: 'return', report: message.result }));
          } else if (call && REPORTING.has(call.tool) && typeof message.result === 'object' && message.result !== null) {
            this.answeredOn.set(message.result, ws);
          }
          call?.resolve(message.result);
        } else {
          settle(message.id)?.reject(new RelayError(message.code, message.message));
        }
      });
      ws.on('error', (e) => {
        if (!welcomed) reject(new RelayError('no_editor', `Couldn't connect to the editor: ${e.message}`));
      });
      // specs/Wire.tla, `HandleClose`: a close rejects only this socket's calls (#3).
      ws.on('close', () => {
        // specs/Discovery.tla, `Disconnect`: the next call opens again.
        if (this.connection?.ws === ws) this.connection = undefined;
        if (!welcomed) reject(new RelayError('no_editor', 'The editor closed the connection.'));
        for (const p of calls.values()) {
          p.reject(new RelayError('no_editor', EDITOR_DISCONNECTED));
        }
        calls.clear();
      });
    });
  }
}
