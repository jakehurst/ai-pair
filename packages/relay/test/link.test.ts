// The relay's link against fake editor windows whose sockets the tests control. The cases are
// the counterexamples TLC found in specs/Wire.tla.

import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { type WebSocket, WebSocketServer } from "ws"
import { parseRelayMessage, PROTOCOL_VERSION } from "@ai-pair/protocol"
import { EditorLink } from "../src/link"

let dir: string
const servers: WebSocketServer[] = []

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-pair-link-"))
})

afterEach(async () => {
  for (const s of servers.splice(0)) await new Promise((r) => s.close(() => r(undefined)))
  fs.rmSync(dir, { recursive: true, force: true })
})

/**
 * A fake editor window for `folder`. It answers `hello` with `greeting`, a `welcome` unless given,
 * and keeps each socket and each call for the test to act on.
 */
async function fakeWindow(folder: string, greeting = JSON.stringify({ type: "welcome" })) {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 })
  servers.push(server)
  await new Promise((r) => server.once("listening", r))
  const address = server.address()
  if (address === null || typeof address === "string") throw new Error("no TCP address")
  const { port } = address
  const discovery = { pid: process.pid, workspaceFolders: [folder], port, token: "token", protocolVersion: PROTOCOL_VERSION, lastFocused: 0 }
  fs.writeFileSync(path.join(dir, `${port}.json`), JSON.stringify(discovery))
  const sockets: WebSocket[] = []
  const calls: { ws: WebSocket; id: number; tool: string }[] = []
  server.on("connection", (ws) => {
    sockets.push(ws)
    ws.on("message", (data) => {
      const m = parseRelayMessage(data)
      if (m?.type === "hello") ws.send(greeting)
      else if (m?.type === "call") calls.push({ ws, id: m.id, tool: m.tool })
    })
  })
  return { sockets, calls }
}

function answer(call: { ws: WebSocket; id: number }, result: unknown): void {
  call.ws.send(JSON.stringify({ type: "result", id: call.id, result }))
}

async function until(check: () => boolean): Promise<void> {
  while (!check()) await new Promise((r) => setTimeout(r, 5))
}

describe("link", () => {
  it("rejects a call only when the socket it was sent on closes", async () => {
    const a = await fakeWindow("/a")
    const b = await fakeWindow("/b")
    const link = new EditorLink("/a", dir)
    const first = link.call("read", {})
    await until(() => a.calls.length === 1)
    answer(a.calls[0]!, "from a")
    expect(await first).toBe("from a")

    // Hold A's end of the closing handshake, so that A's close event comes after the call on B.
    a.sockets[0]!.pause()
    link.locate(["/b"])
    const second = link.call("read", {})
    let settled = false
    second.then(() => (settled = true), () => (settled = true))
    await until(() => b.calls.length === 1)
    a.sockets[0]!.resume()
    await until(() => a.sockets[0]!.readyState === a.sockets[0]!.CLOSED)
    await new Promise((r) => setTimeout(r, 100))
    expect(settled).toBe(false)
    answer(b.calls[0]!, "from b")
    expect(await second).toBe("from b")
    link.close()
  })

  it("fails to connect, without crashing, when a window answers with a frame that is not JSON", async () => {
    await fakeWindow("/a", "not json")
    const link = new EditorLink("/a", dir)
    await expect(link.call("read", {})).rejects.toMatchObject({ code: "no_editor" })
  })

  for (const frame of ["null", "42", '"text"', "[]", '{ "kind": "welcome" }']) {
    it(`fails to connect, without crashing, when a window answers with JSON that isn't a message: ${frame}`, async () => {
      await fakeWindow("/a", frame)
      const link = new EditorLink("/a", dir)
      await expect(link.call("read", {})).rejects.toMatchObject({ code: "no_editor" })
    })
  }

  it("drops a frame that is not JSON after the welcome", async () => {
    const a = await fakeWindow("/a")
    const link = new EditorLink("/a", dir)
    const call = link.call("read", {})
    await until(() => a.calls.length === 1)
    a.sockets[0]!.send("not json")
    answer(a.calls[0]!, "result")
    expect(await call).toBe("result")
    link.close()
  })

  it("doesn't send a call that was cancelled before it went out", async () => {
    const a = await fakeWindow("/a")
    const link = new EditorLink("/a", dir)
    const abort = new AbortController()
    const call = link.call("listen", {}, abort.signal)
    abort.abort()
    await expect(call).rejects.toMatchObject({ code: "cancelled" })
    // Calls arrive in order, so a `listen` that went out would arrive before this `read`.
    const second = link.call("read", {})
    await until(() => a.calls.length > 0)
    expect(a.calls.map((c) => c.tool)).toEqual(["read"])
    answer(a.calls[0]!, "result")
    expect(await second).toBe("result")
    link.close()
  })
})
