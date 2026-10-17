// Messages between the relay (pair-mcp) and the editor, over a local WebSocket.
// See "Discovery and connection" in ARCHITECTURE.md.

import * as os from 'node:os';
import * as path from 'node:path';
import { EDITOR_MESSAGE_SCHEMA, RELAY_MESSAGE_SCHEMA, type EditorMessage, type RelayMessage } from './schemas';

/** The wire protocol's version; a relay and an editor must agree on it. */
export const PROTOCOL_VERSION = 3;

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

/** Returns a frame's text as JSON, or `undefined` if it isn't JSON. */
function frameJson(data: Frame): unknown {
  const bytes = Array.isArray(data) ? Buffer.concat(data) : data instanceof ArrayBuffer ? Buffer.from(data) : data;
  try {
    const json: unknown = JSON.parse(bytes.toString('utf8'));
    return json;
  } catch {
    return undefined;
  }
}

/**
 * Returns a frame from the relay as a message, or `undefined` if it isn't one: not JSON, or no message schema fits it
 * (#4, #30, #163).
 */
export function parseRelayMessage(data: Frame): RelayMessage | undefined {
  const parsed = RELAY_MESSAGE_SCHEMA.safeParse(frameJson(data));
  return parsed.success ? parsed.data : undefined;
}

/**
 * Returns a frame from the editor as a message, or `undefined` if it isn't one: not JSON, or no message schema fits it
 * (#4, #30, #163).
 */
export function parseEditorMessage(data: Frame): EditorMessage | undefined {
  // specs/Wire.tla, `SendGarbage` with GuardedParse: a frame no schema fits is not a message.
  const parsed = EDITOR_MESSAGE_SCHEMA.safeParse(frameJson(data));
  return parsed.success ? parsed.data : undefined;
}
