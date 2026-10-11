// Messages between the relay (pair-mcp) and the editor, over a local WebSocket.
// See "Discovery and connection" in ARCHITECTURE.md.

import * as os from 'node:os';
import * as path from 'node:path';
import type { Report, ToolErrorCode } from './index';

/** The wire protocol's version; a relay and an editor must agree on it. */
export const PROTOCOL_VERSION = 3;

/** Written by each editor window to `<discoveryDir>/<pid>.json`. */
export interface Discovery {
  pid: number;
  workspaceFolders: string[];
  port: number;
  token: string;
  protocolVersion: number;
  /** Epoch milliseconds. */
  lastFocused: number;
}

/** The names of the tools an agent can call. */
export type ToolName = 'start' | 'step' | 'listen' | 'end' | 'read' | 'calibrate';

/** A frame from the relay to the editor: a greeting, a tool call, a cancel, or a report handed back. */
export type RelayMessage =
  | { type: 'hello'; token: string; protocolVersion: number }
  | { type: 'call'; id: number; tool: ToolName; args: Record<string, unknown> }
  | { type: 'cancel'; id: number }
  /** A report that arrived for a call the agent had already cancelled: deliver it again. */
  | { type: 'return'; report: Report; mayRepeat?: true };

/** A frame from the editor to the relay: a welcome, a refusal, or a call's result or error. */
export type EditorMessage =
  | { type: 'welcome' }
  | { type: 'rejected'; reason: string }
  | { type: 'result'; id: number; result: unknown }
  | { type: 'error'; id: number; code: ToolErrorCode | 'internal'; message: string };

/** The raw data of a WebSocket frame, as `ws` hands it over. */
export type Frame = Buffer | ArrayBuffer | Buffer[];

/** Returns the directory of the user's AI Pair files: `AI_PAIR_HOME`, or `~/.ai-pair`. */
export function aiPairHome(): string {
  return process.env.AI_PAIR_HOME ?? path.join(os.homedir(), '.ai-pair');
}

/** Returns the directory the editor windows write their discovery files to. */
export function discoveryDir(): string {
  return path.join(aiPairHome(), 'windows');
}

function hasType(m: unknown): m is { type: string } {
  return typeof m === 'object' && m !== null && 'type' in m && typeof m.type === 'string';
}

/**
 * Returns a frame's message, or `undefined` if it isn't one: not JSON, or JSON that isn't an object
 * with a string `type` (#4, #30).
 */
function parseFrame(data: Frame): { type: string } | undefined {
  const bytes = Array.isArray(data) ? Buffer.concat(data) : data instanceof ArrayBuffer ? Buffer.from(data) : data;
  const text = bytes.toString('utf8');
  let m: unknown;
  try {
    m = JSON.parse(text);
  } catch {
    return undefined;
  }
  return hasType(m) ? m : undefined;
}

// Only `type` is checked: the other fields are taken on trust from a peer that authenticated, as they always were.

/** Returns a frame from the relay as a message, or `undefined` if it isn't one. */
export function parseRelayMessage(data: Frame): RelayMessage | undefined {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return parseFrame(data) as RelayMessage | undefined;
}

/** Returns a frame from the editor as a message, or `undefined` if it isn't one. */
export function parseEditorMessage(data: Frame): EditorMessage | undefined {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return parseFrame(data) as EditorMessage | undefined;
}
