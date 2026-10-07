// The launcher runs the relay at its path, whatever the path holds, and a launcher that can't be
// written doesn't stop the extension (#9).

import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

const shown: string[] = []
vi.mock("vscode", () => ({ window: { showErrorMessage: (m: string) => void shown.push(m) } }))

const { writeLauncher } = await import("../src/setup")

let home: string
beforeEach(() => {
  // Its real path: Node reports the relay's that way (on macOS, under /private).
  home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ai-pair-launcher-")))
  vi.stubEnv("AI_PAIR_HOME", home)
  shown.length = 0
})
afterEach(() => {
  vi.unstubAllEnvs()
  fs.chmodSync(home, 0o700)
  fs.rmSync(home, { recursive: true, force: true })
})

it.skipIf(process.platform === "win32")("runs the relay at a path with quotes, dollars and backticks in it", () => {
  const extension = path.join(home, `ext $HOME \`echo x\` "q" 'a'`)
  fs.mkdirSync(path.join(extension, "dist"), { recursive: true })
  // A stand-in relay: says where it is and what it was given.
  fs.writeFileSync(path.join(extension, "dist", "relay.js"), "console.log(JSON.stringify([__filename, ...process.argv.slice(2)]))\n")
  const launcher = writeLauncher(extension)
  const out = execFileSync(launcher, ["one", "two words"], { encoding: "utf8" })
  expect(JSON.parse(out)).toEqual([path.join(extension, "dist", "relay.js"), "one", "two words"])
  expect(fs.statSync(launcher).mode & 0o777).toBe(0o755)
})

it.skipIf(process.platform === "win32")("makes an existing launcher executable again", () => {
  const launcher = writeLauncher(home)
  fs.chmodSync(launcher, 0o600)
  writeLauncher(home)
  expect(fs.statSync(launcher).mode & 0o777).toBe(0o755)
})

it.skipIf(process.platform === "win32" || process.getuid?.() === 0)("says so, and goes on, when the launcher can't be written", () => {
  fs.chmodSync(home, 0o500)
  expect(writeLauncher(home)).toBe(path.join(home, "bin", "pair-mcp"))
  expect(shown).toEqual([expect.stringContaining("couldn't write its launcher")])
})
