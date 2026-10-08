// Finding the right editor window and talking to it. See "Discovery and connection" in ARCHITECTURE.md.

import * as fs from "node:fs"
import * as path from "node:path"
import WebSocket from "ws"
import { parseEditorMessage, PROTOCOL_VERSION, withinFolder, type Discovery, type ToolName } from "@ai-pair/protocol"

export class RelayError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

function realpath(p: string): string {
  try {
    return fs.realpathSync(p)
  } catch {
    return p
  }
}

function contains(folder: string, file: string): boolean {
  return withinFolder(folder, file) !== undefined
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return e instanceof Error && "code" in e && e.code === "EPERM"
  }
}

/** Whether a discovery file holds a Discovery: one that parses but doesn't is skipped like garbage (#31). */
function isDiscovery(d: unknown): d is Discovery {
  return (
    typeof d === "object" &&
    d !== null &&
    "pid" in d &&
    typeof d.pid === "number" &&
    "port" in d &&
    typeof d.port === "number" &&
    "token" in d &&
    typeof d.token === "string" &&
    "protocolVersion" in d &&
    typeof d.protocolVersion === "number" &&
    "lastFocused" in d &&
    typeof d.lastFocused === "number" &&
    "workspaceFolders" in d &&
    Array.isArray(d.workspaceFolders) &&
    d.workspaceFolders.every((f: unknown) => typeof f === "string")
  )
}

/**
 * The first of `folders` inside a live window's workspace folder, and the windows it's in, best
 * first: the most closely containing workspace folder, then the most recently focused window.
 */
export function findWindows(folders: string[], dir: string): { folder: string; windows: Discovery[] } {
  const windows: Discovery[] = []
  let files: string[] = []
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"))
  } catch {
    // No windows have registered yet.
  }
  for (const f of files) {
    try {
      const d: unknown = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))
      if (isDiscovery(d) && alive(d.pid)) windows.push(d)
    } catch {
      // Being written, or garbage.
    }
  }

  for (const folder of folders) {
    const here = realpath(folder)
    const matches: { window: Discovery; length: number }[] = []
    for (const window of windows) {
      const lengths = window.workspaceFolders
        .map(realpath)
        .filter((f) => contains(f, here))
        .map((f) => f.length)
      if (lengths.length > 0) matches.push({ window, length: Math.max(...lengths) })
    }
    if (matches.length === 0) continue
    matches.sort((a, b) => b.length - a.length || b.window.lastFocused - a.window.lastFocused)
    return { folder, windows: matches.map((m) => m.window) }
  }
  throw new RelayError(
    "no_editor",
    windows.length === 0
      ? `No VS Code window with the AI Pair extension is running. Ask the programmer to open ${folders[0]} in VS Code.`
      : `No VS Code window has ${folders[0]} open. Ask the programmer to open it in VS Code (with the AI Pair extension).`,
  )
}

type Pending = {
  tool: ToolName
  cancelled: boolean
  resolve: (result: unknown) => void
  reject: (error: RelayError) => void
}

/** A port a stale window file points at may now belong to something that never answers. */
const HANDSHAKE_MS = 5000

/** Tools whose results are reports, which must be delivered at least once (#67). */
const REPORTING: ReadonlySet<ToolName> = new Set(["step", "listen", "end"])

/** A lazily (re)connected link to the editor window for the agent's folder, `cwd` until `locate` says otherwise. */
export class EditorLink {
  private ws: WebSocket | null = null
  private connecting: Promise<WebSocket> | null = null
  private nextId = 1
  /** Each socket's calls waiting for an answer, so that a socket's close rejects only its own. */
  private readonly pending = new WeakMap<WebSocket, Map<number, Pending>>()
  /** Each socket's cancelled calls not yet answered: settled once the editor's answer arrives. */
  private readonly cancelled = new WeakMap<WebSocket, Set<Promise<void>>>()
  /** The socket each report came over, for `handBack`. */
  private readonly answeredOn = new WeakMap<object, WebSocket>()
  private folder: string

  constructor(
    cwd: string,
    private readonly dir: string,
  ) {
    this.folder = cwd
  }

  /** Links to the window for the first of `folders` that one has open, and returns that folder. */
  locate(folders: string[]): string {
    const { folder } = findWindows(folders, this.dir)
    if (folder !== this.folder) {
      this.folder = folder
      this.ws?.close()
      this.ws = null
    }
    return folder
  }

  /**
   * `folder`, and the workspace folder of the window for it that holds it, both as real paths:
   * where a project's guides are looked for, and where that stops (#23).
   */
  workspace(folder: string): { folder: string; root: string } {
    const here = realpath(folder)
    const { windows } = findWindows([folder], this.dir)
    const roots = (windows[0]?.workspaceFolders ?? []).map(realpath).filter((f) => contains(f, here))
    return { folder: here, root: roots.toSorted((a, b) => b.length - a.length)[0] ?? here }
  }

  async call(tool: ToolName, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    // A cancelled call's report may be on its way back, to be handed back with `return`. This call
    // goes out after it, so the editor restores the report before it takes this call (#59). The socket
    // may close meanwhile, so it is taken again after each wait; from there to `send`, nothing awaits.
    let ws: WebSocket
    let cancelled: Set<Promise<void>>
    for (;;) {
      ws = await this.connect()
      cancelled = this.cancelled.get(ws)!
      if (cancelled.size === 0) break
      await Promise.all(cancelled)
    }
    // An abort that fired before the listener below is added won't fire again (#29). A call never
    // sent takes no report, so there is nothing to hand back.
    if (signal?.aborted) throw new RelayError("cancelled", "The call was cancelled.")
    const calls = this.pending.get(ws)!
    const id = this.nextId++
    let pending!: Pending
    const answer = new Promise((resolve, reject) => {
      pending = { tool, cancelled: false, resolve, reject }
      calls.set(id, pending)
      try {
        ws.send(JSON.stringify({ type: "call", id, tool, args }))
      } catch (e) {
        calls.delete(id)
        reject(new RelayError("no_editor", `Couldn't send to the editor: ${e instanceof Error ? e.message : String(e)}`))
      }
    })
    signal?.addEventListener(
      "abort",
      () => {
        pending.cancelled = true
        if (!calls.has(id)) return
        const settled = answer.then(
          () => {},
          () => {},
        )
        cancelled.add(settled)
        void settled.then(() => cancelled.delete(settled))
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "cancel", id }))
      },
      { once: true },
    )
    return answer
  }

  /**
   * Hands a report back to the editor, on the socket it came over, to be delivered with the next
   * report, marked as one the agent may have seen: for a call it canceled after the relay answered (#67).
   */
  handBack(report: unknown): void {
    if (typeof report !== "object" || report === null) return
    const ws = this.answeredOn.get(report)
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "return", report, mayRepeat: true }))
  }

  close(): void {
    this.ws?.close()
  }

  private connect(): Promise<WebSocket> {
    if (this.ws?.readyState === WebSocket.OPEN) return Promise.resolve(this.ws)
    this.connecting ??= this.open().finally(() => {
      this.connecting = null
    })
    return this.connecting
  }

  /**
   * Tries the matching windows best first. A window's file can outlive it when VS Code didn't shut
   * down cleanly, and its pid can then belong to another process, so an unreachable one is skipped.
   */
  private async open(): Promise<WebSocket> {
    let first: unknown
    for (const window of findWindows([this.folder], this.dir).windows) {
      try {
        return await this.openWindow(window)
      } catch (e) {
        first ??= e
      }
    }
    throw first
  }

  private openWindow(window: Discovery): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${window.port}`, { handshakeTimeout: HANDSHAKE_MS })
      let welcomed = false
      const calls = new Map<number, Pending>()
      this.pending.set(ws, calls)
      this.cancelled.set(ws, new Set())
      const settle = (id: number) => {
        const p = calls.get(id)
        calls.delete(id)
        return p
      }
      ws.on("open", () => {
        ws.send(JSON.stringify({ type: "hello", token: window.token, protocolVersion: PROTOCOL_VERSION }))
      })
      ws.on("message", (data) => {
        const m = parseEditorMessage(data)
        if (!m) {
          // Before the welcome, whatever is on this port isn't our editor. After it, drop the frame.
          if (!welcomed) {
            reject(new RelayError("no_editor", "The editor's port answered with something that isn't a message."))
            ws.close()
          }
          return
        }
        if (m.type === "welcome") {
          welcomed = true
          this.ws = ws
          resolve(ws)
        } else if (m.type === "rejected") {
          reject(new RelayError("no_editor", m.reason))
        } else if (m.type === "result") {
          const p = settle(m.id)
          // The call returned before our cancellation reached the editor, so the agent will never
          // see this report. Hand it back to be delivered with the next one.
          if (p?.cancelled && REPORTING.has(p.tool)) ws.send(JSON.stringify({ type: "return", report: m.result }))
          else if (p && REPORTING.has(p.tool) && typeof m.result === "object" && m.result !== null) this.answeredOn.set(m.result, ws)
          p?.resolve(m.result)
        } else if (m.type === "error") {
          settle(m.id)?.reject(new RelayError(m.code, m.message))
        }
      })
      ws.on("error", (e) => {
        if (!welcomed) reject(new RelayError("no_editor", `Couldn't connect to the editor: ${e.message}`))
      })
      ws.on("close", () => {
        if (this.ws === ws) this.ws = null
        if (!welcomed) reject(new RelayError("no_editor", "The editor closed the connection."))
        for (const p of calls.values()) {
          p.reject(new RelayError("no_editor", "The editor disconnected. If its window was reloaded, start a new session."))
        }
        calls.clear()
      })
    })
  }
}
