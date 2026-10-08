// Messages between the relay (pair-mcp) and the editor, over a local WebSocket.
// See "Discovery and connection" in ARCHITECTURE.md.

import * as os from "node:os"
import * as path from "node:path"
import type { Report, ToolErrorCode } from "./index"

export const PROTOCOL_VERSION = 3

/** Written by each editor window to `<discoveryDir>/<pid>.json`. */
export type Discovery = {
  pid: number
  workspaceFolders: string[]
  port: number
  token: string
  protocolVersion: number
  /** Epoch milliseconds. */
  lastFocused: number
}

export function aiPairHome(): string {
  return process.env.AI_PAIR_HOME ?? path.join(os.homedir(), ".ai-pair")
}

export function discoveryDir(): string {
  return path.join(aiPairHome(), "windows")
}

export type ToolName = "start" | "step" | "listen" | "end" | "read" | "calibrate"

export type RelayMessage =
  | { type: "hello"; token: string; protocolVersion: number }
  | { type: "call"; id: number; tool: ToolName; args: Record<string, unknown> }
  | { type: "cancel"; id: number }
  /** A report that arrived for a call the agent had already cancelled: deliver it again. */
  | { type: "return"; report: Report; mayRepeat?: true }

export type EditorMessage =
  | { type: "welcome" }
  | { type: "rejected"; reason: string }
  | { type: "result"; id: number; result: unknown }
  | { type: "error"; id: number; code: ToolErrorCode | "internal"; message: string }

/**
 * A frame's message, or `undefined` if it isn't one: not JSON, or JSON that isn't an object with a
 * string `type` (#4, #30).
 */
function parseFrame(data: Frame): { type: string } | undefined {
  const bytes = Array.isArray(data) ? Buffer.concat(data) : data instanceof ArrayBuffer ? Buffer.from(data) : data
  const text = bytes.toString("utf8")
  let m: unknown
  try {
    m = JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof m !== "object" || m === null || !("type" in m) || typeof m.type !== "string") return undefined
  // Checked just above; TypeScript doesn't narrow `m` itself from a check on its property.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return m as { type: string }
}

/** The raw data of a WebSocket frame, as `ws` hands it over. */
export type Frame = Buffer | ArrayBuffer | Buffer[]

// Only `type` is checked: the other fields are taken on trust from a peer that authenticated, as they always were.

/** A frame from the relay, or `undefined` if it isn't a message. */
export function parseRelayMessage(data: Frame): RelayMessage | undefined {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return parseFrame(data) as RelayMessage | undefined
}

/** A frame from the editor, or `undefined` if it isn't a message. */
export function parseEditorMessage(data: Frame): EditorMessage | undefined {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return parseFrame(data) as EditorMessage | undefined
}
