// The Claude Code starter (#107): offered only when Claude Code is set up and its open command is
// registered, and a start runs that command with the prompt.

import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { beforeEach, expect, it, vi } from "vitest"
import type { Host } from "../src/agents"
import { claudeStarter, START_PROMPT } from "../src/setup"

/** What the fake VS Code lists as commands, and what it was asked to execute. */
let commands: string[] = []
let executed: unknown[][] = []
vi.mock("vscode", () => ({
  commands: {
    getCommands: () => Promise.resolve(commands),
    executeCommand: (...args: unknown[]) => {
      executed.push(args)
      return Promise.resolve()
    },
  },
}))

const LAUNCHER = "/home/me/.ai-pair/bin/pair-mcp"
let host: Host

beforeEach(() => {
  commands = []
  executed = []
  host = {
    home: fs.mkdtempSync(path.join(os.tmpdir(), "ai-pair-start-")),
    env: { PATH: "" },
    platform: process.platform,
    exec: async () => {},
  }
})

/** What Set Up Agent leaves in `.claude.json`: the pair server running the launcher. */
const setUp = () => fs.writeFileSync(path.join(host.home, ".claude.json"), JSON.stringify({ mcpServers: { pair: { command: LAUNCHER } } }))

it("offers the button only once Claude Code is set up and its open command is registered (Grounded)", async () => {
  const starter = claudeStarter(LAUNCHER, host)
  expect(await starter.available()).toBe(false)
  commands = ["claude-vscode.editor.open"]
  expect(await starter.available()).toBe(false)
  setUp()
  expect(await starter.available()).toBe(true)
  commands = []
  expect(await starter.available()).toBe(false)
})

it("opens a new Claude Code tab with the prompt, once per start (RunsAreClicks)", async () => {
  const starter = claudeStarter(LAUNCHER, host)
  await starter.start()
  expect(executed).toEqual([["claude-vscode.editor.open", undefined, START_PROMPT]])
})
