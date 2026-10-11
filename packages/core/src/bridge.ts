// The editor side of the relay connection: a WebSocket server on localhost that forwards tool
// calls to the controller, and the discovery file that lets relays find it.

import { randomBytes, timingSafeEqual } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  parseRelayMessage,
  PROTOCOL_VERSION,
  ToolError,
  type Action,
  type Discovery,
  type EditorMessage,
  type RelayMessage,
  type ToolName,
} from '@ai-pair/protocol';
import type { Controller } from './controller';
import { LEFT_ARROW, RIGHT_ARROW } from './constants';

/** What a bridge needs from its window: the discovery folder, the workspace folders, and where to report. */
export interface BridgeOptions {
  /** Where discovery files live; see `discoveryDir()`. */
  dir: string;
  workspaceFolders: () => string[];
  /** Called with a line for each frame sent or received, for diagnosing deliveries (#27). */
  trace?: (line: string) => void;
  /** Called when the discovery file can't be written, so relays won't find this window (#9). */
  failed?: (error: unknown) => void;
}

/** Returns what a report says, for `trace`: its batches, events, and flags. */
function reported(report: unknown): string {
  if (typeof report !== 'object' || report === null || !('batches' in report) || !('events' in report)) return '';
  const { batches, events } = report;
  const parts = [
    Array.isArray(batches)
      ? `batches [${batches.map((b: { id?: unknown; status?: unknown }) => `${String(b.id)} ${String(b.status)}`).join(', ')}]`
      : '',
    Array.isArray(events) ? `events [${events.map((e: { kind?: unknown }) => String(e.kind)).join(', ')}]` : '',
  ];
  if ('rejected' in report && report.rejected) parts.push('rejected');
  if ('waiting' in report && report.waiting) parts.push('waiting');
  return parts.filter(Boolean).join(' ');
}

/** Returns what a frame says, for `trace`: its type and id, and for a report, what it reports. */
function describe(message: RelayMessage | EditorMessage): string {
  switch (message.type) {
    case 'call':
      return `call ${message.id} ${message.tool}`;
    case 'cancel':
      return `cancel ${message.id}`;
    case 'return':
      return `return ${reported(message.report)}`;
    case 'result':
      return `result ${message.id} ${reported(message.result)}`;
    case 'error':
      return `error ${message.id} ${message.code}`;
    default:
      return message.type;
  }
}

function optionalString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function optionalStrings(v: unknown): string[] | undefined {
  return Array.isArray(v) && v.every((s) => typeof s === 'string') ? v : undefined;
}

function optionalNumber(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined;
}

/** The editor's end of the relay connection: a WebSocket server on localhost that forwards tool calls to the controller, found by relays through a discovery file. */
export class Bridge {
  private server?: WebSocketServer;
  private readonly token = randomBytes(24).toString('hex');
  private port = 0;
  private lastFocused = Date.now();
  /** The relay connection whose agent started the current (or last) session. */
  private owner: WebSocket | null = null;
  /** Sockets accepted so far, to tell them apart in `trace`. */
  private accepted = 0;

  constructor(
    private readonly controller: Controller,
    private readonly options: BridgeOptions,
  ) {}

  get file(): string {
    return path.join(this.options.dir, `${process.pid}.json`);
  }

  async start(): Promise<void> {
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const address = server.address();
    this.port = typeof address === 'object' && address ? address.port : 0;
    // A relay connects (specs/Resume.tla, `Connect`).
    server.on('connection', (ws) => {
      this.accept(ws);
    });
    // specs/Discovery.tla, `OpenWindow`: if the write fails, the window runs, and no relay finds it.
    this.writeDiscovery();
  }

  /** Records that the window gained focus, so relays prefer it among windows with the same folder. */
  focused(): void {
    this.lastFocused = Date.now();
    // specs/Discovery.tla, `Focus`; after a write that failed, `ListWindow`.
    this.writeDiscovery();
  }

  /** Writes the discovery file: on start, on focus, and when the workspace folders change. */
  writeDiscovery(): void {
    if (!this.server) return;
    const discovery: Discovery = {
      pid: process.pid,
      workspaceFolders: this.options.workspaceFolders(),
      port: this.port,
      token: this.token,
      protocolVersion: PROTOCOL_VERSION,
      lastFocused: this.lastFocused,
    };
    // Reported, not thrown: it runs on every focus, and the server works without it (#9).
    try {
      fs.mkdirSync(this.options.dir, { recursive: true, mode: 0o700 });
      // Written beside it, then renamed over it, so a relay reading it never sees it half written
      // (#72, `AtomicWrite` in specs/Discovery.tla). Not a `.json`, so relays don't read the temporary one.
      const written = `${this.file}.tmp`;
      fs.writeFileSync(written, JSON.stringify(discovery), { mode: 0o600 });
      fs.renameSync(written, this.file);
    } catch (e) {
      this.options.failed?.(e);
    }
  }

  /** Returns the relay connections open now. */
  connections(): ReadonlySet<WebSocket> {
    return this.server?.clients ?? new Set();
  }

  dispose(): void {
    // specs/Discovery.tla, `CloseWindow`: the file goes with the window.
    try {
      fs.unlinkSync(this.file);
    } catch {
      // Already gone.
    }
    for (const client of this.server?.clients ?? []) {
      client.terminate();
    }
    this.server?.close();
    this.server = undefined;
  }

  private accept(ws: WebSocket): void {
    let authenticated = false;
    const calls = new Map<number, AbortController>();
    const socket = ++this.accepted;
    const trace = this.options.trace;
    function send(m: EditorMessage): void {
      const open = ws.readyState === ws.OPEN;
      trace?.(`socket ${socket} ${RIGHT_ARROW} ${describe(m)}${open ? '' : ' (not sent: closed)'}`);
      if (open) ws.send(JSON.stringify(m));
    }

    ws.on('message', (data) => {
      // A frame that isn't a message is dropped (#30).
      const message = parseRelayMessage(data);
      if (!message) return;
      trace?.(`socket ${socket} ${LEFT_ARROW} ${describe(message)}`);
      if (!authenticated) {
        if (message.type !== 'hello' || !this.tokenMatches(message.token)) {
          send({ type: 'rejected', reason: 'Authentication failed.' });
          ws.close();
        } else if (message.protocolVersion !== PROTOCOL_VERSION) {
          send({
            type: 'rejected',
            reason: `Protocol version mismatch (editor ${PROTOCOL_VERSION}, relay ${message.protocolVersion}). The extension was updated: reload the VS Code window and restart the agent.`,
          });
          ws.close();
        } else {
          authenticated = true;
          send({ type: 'welcome' });
        }
        return;
      }
      if (message.type === 'cancel') {
        calls.get(message.id)?.abort();
      } else if (message.type === 'return') {
        // specs/Bridge.tla, `Restore`: only the owner's socket brings its session's report back.
        if (this.owner === ws) this.controller.restore(message.report, message.mayRepeat === true);
      } else if (message.type === 'call') {
        const abort = new AbortController();
        calls.set(message.id, abort);
        this.dispatch(ws, message.tool, message.args ?? {}, abort.signal)
          .then(
            (result) => {
              send({ type: 'result', id: message.id, result });
            },
            (e: unknown) => {
              send({
                type: 'error',
                id: message.id,
                code: e instanceof ToolError ? e.code : 'internal',
                message: e instanceof Error ? e.message : String(e),
              });
            },
          )
          .finally(() => {
            calls.delete(message.id);
          });
      }
    });

    ws.on('close', () => {
      trace?.(`socket ${socket} closed`);
      // specs/Bridge.tla, `Close`: the owner's socket gone, the session is suspended, or closed if it ended.
      for (const abort of calls.values()) {
        abort.abort();
      }
      if (this.owner === ws) {
        this.owner = null;
        this.controller.disconnect();
      }
    });
  }

  private async dispatch(ws: WebSocket, tool: ToolName, args: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
    const controller = this.controller;
    if (tool === 'start') {
      // specs/Bridge.tla, `BeginStart`: refused while another socket's session is active.
      if (controller.isActive && !controller.isSuspended && this.owner !== ws) {
        throw new ToolError('session_active', 'Another agent is already pairing in this editor window.');
      }
      const report = await controller.start(optionalString(args.task), optionalString(args.cwd), optionalStrings(args.rules));
      // specs/Bridge.tla, `FinishStart`: the socket may have closed while the session started, when its close handler didn't own it yet:
      // suspend the session rather than leave it to no one (#42, #25). From here to `owner`, nothing awaits. The owner is
      // cleared too: a socket that owned an ended session the start replaced must not drive the suspended one.
      if (ws.readyState !== ws.OPEN) {
        this.owner = null;
        controller.disconnect();
        throw new ToolError('no_session', 'The connection closed while the session started.');
      }
      this.owner = ws;
      return report;
    }
    if (this.owner !== ws) {
      throw new ToolError('no_session', 'No pairing session is active. Call `start` to begin one.');
    }
    switch (tool) {
      case 'step':
        if (!Array.isArray(args.actions)) throw new ToolError('invalid_arguments', '`actions` must be an array.');
        // Each action is checked as it's rehearsed and played; the relay's schema checked them too.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        return controller.step(args.actions as Action[], signal);
      case 'listen':
        return controller.listen(signal);
      case 'end':
        return controller.end(optionalString(args.summary), signal);
      case 'read':
        if (typeof args.file !== 'string') throw new ToolError('invalid_arguments', '`file` must be a string.');
        return controller.read(args.file, optionalNumber(args.from_line), optionalNumber(args.to_line));
      case 'calibrate': {
        if (typeof args.title !== 'string' || typeof args.file !== 'string') {
          throw new ToolError('invalid_arguments', '`title` and `file` must be strings.');
        }
        const notice = optionalString(args.notice);
        const text = fs.readFileSync(controller.resolveFile(args.file), 'utf8');
        return controller.calibrate({ title: args.title, text, ...(notice ? { notice } : {}) });
      }
      default:
        throw new ToolError('invalid_arguments', `Unknown tool: ${String(tool)}`);
    }
  }

  private tokenMatches(token: unknown): boolean {
    if (typeof token !== 'string') return false;
    const a = Buffer.from(token);
    const b = Buffer.from(this.token);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
