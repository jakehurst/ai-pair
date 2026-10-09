// The Claude Code starter (#107, #115): offered only when Claude Code is set up for the pair server, its
// CLI is here, and a folder is open; a start runs the CLI with the prompt in a terminal never shown,
// one agent at a time.

import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { beforeEach, expect, it, vi } from "vitest"
import type { Host } from "../src/agents"
import { claudeStarter, START_ARGS, START_PROMPT, START_TERMINAL } from "../src/setup"

/** The terminals the fake VS Code was asked to create, and its close listeners. */
type FakeTerminal = { options: Record<string, unknown>; show: ReturnType<typeof vi.fn> }
let created: FakeTerminal[] = []
let closeListeners: ((t: FakeTerminal) => void)[] = []
let executed: unknown[][] = []
vi.mock("vscode", () => ({
  window: {
    createTerminal: (options: Record<string, unknown>) => {
      const t = { options, show: vi.fn() }
      created.push(t)
      return t
    },
    onDidCloseTerminal: (listener: (t: FakeTerminal) => void) => {
      closeListeners.push(listener)
      return { dispose: () => (closeListeners = closeListeners.filter((l) => l !== listener)) }
    },
  },
  commands: {
    executeCommand: (...args: unknown[]) => {
      executed.push(args)
      return Promise.resolve()
    },
  },
}))

const LAUNCHER = "/home/me/.ai-pair/bin/pair-mcp"
const FOLDER = "/home/me/project"
let host: Host
let folders: string[]

beforeEach(() => {
  created = []
  closeListeners = []
  executed = []
  folders = [FOLDER]
  host = {
    home: fs.mkdtempSync(path.join(os.tmpdir(), "ai-pair-start-")),
    env: { PATH: "" },
    platform: process.platform === "win32" ? "linux" : process.platform,
    exec: async () => {},
  }
})

/** What Set Up Agent leaves in `.claude.json`: the pair server running the launcher. */
const setUp = () => fs.writeFileSync(path.join(host.home, ".claude.json"), JSON.stringify({ mcpServers: { pair: { command: LAUNCHER } } }))
/** Claude Code's CLI where its installer puts it. */
const installCli = () => {
  const bin = path.join(host.home, ".local", "bin")
  fs.mkdirSync(bin, { recursive: true })
  fs.writeFileSync(path.join(bin, "claude"), "")
  return path.join(bin, "claude")
}
const starterHere = () => claudeStarter(LAUNCHER, host, () => folders)
const close = (t: FakeTerminal) => closeListeners.forEach((l) => l(t))

it("offers the button only once Claude Code is set up, its CLI is here, and a folder is open (Grounded)", async () => {
  const starter = starterHere()
  expect(await starter.available()).toBe(false)
  installCli()
  expect(await starter.available()).toBe(false)
  setUp()
  expect(await starter.available()).toBe(true)
  folders = []
  expect(await starter.available()).toBe(false)
})

it("runs the CLI with the prompt in a terminal it never shows, once per start, without Claude Code's open command (RunsAreClicks, Starts, StaysOnPair, KeepsLocation)", async () => {
  const cli = installCli()
  setUp()
  await starterHere().start()
  expect(created).toHaveLength(1)
  expect(created[0]!.options).toEqual({ name: START_TERMINAL, shellPath: cli, shellArgs: START_ARGS, cwd: FOLDER, isTransient: true })
  expect(START_ARGS).toEqual(["-p", START_PROMPT, "--allowedTools", "mcp__pair"])
  expect(created[0]!.show).not.toHaveBeenCalled()
  expect(executed).toEqual([])
})

it("starts no second agent while the first one's terminal is open, and starts again once it closes (OneAtATime, Closes)", async () => {
  installCli()
  setUp()
  const starter = starterHere()
  await starter.start()
  await starter.start()
  expect(created).toHaveLength(1)
  close(created[0]!)
  await starter.start()
  expect(created).toHaveLength(2)
})
