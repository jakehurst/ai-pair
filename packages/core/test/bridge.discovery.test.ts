// A window's discovery file is never half written, though it is rewritten each time the window
// gains focus: a relay reading it then still finds the window (#72, specs/Discovery.tla).

import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { Worker } from "node:worker_threads"
import { expect, it } from "vitest"
import { Bridge } from "../src/bridge"
import { Controller } from "../src/controller"
import { FakeEditor, FakePanel, testConfig } from "./fake"

// Reads and parses the file as findWindows does, until told to stop; counts the reads that fail.
const READER = `
const { parentPort, workerData } = require("node:worker_threads")
const fs = require("node:fs")
const stop = new Int32Array(workerData.stop)
let reads = 0, broken = 0
while (Atomics.load(stop, 0) === 0) {
  try { JSON.parse(fs.readFileSync(workerData.file, "utf8")) } catch { broken++ }
  reads++
}
parentPort.postMessage({ reads, broken })
`

it("rewrites the discovery file on focus without a reader ever seeing it half written", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-pair-discovery-"))
  const bridge = new Bridge(new Controller(new FakeEditor(), new FakePanel(), testConfig), { dir, workspaceFolders: () => ["/project"] })
  await bridge.start()
  const stop = new SharedArrayBuffer(4)
  const reader = new Worker(READER, { eval: true, workerData: { file: bridge.file, stop } })
  const counted = new Promise<{ reads: number; broken: number }>((r) => reader.once("message", r))
  await new Promise((r) => setTimeout(r, 100))
  for (let i = 0; i < 5000; i++) bridge.focused()
  Atomics.store(new Int32Array(stop), 0, 1)
  const { reads, broken } = await counted
  await reader.terminate()
  bridge.dispose()
  fs.rmSync(dir, { recursive: true, force: true })
  expect(reads).toBeGreaterThan(0)
  expect(broken).toBe(0)
}, 30_000)
