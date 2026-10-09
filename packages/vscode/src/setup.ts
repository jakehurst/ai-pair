// The launcher for pair-mcp, and connecting it to the programmer's agents.
// See "Starting a session" and "Distribution" in ARCHITECTURE.md.

import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import * as vscode from "vscode"
import { aiPairHome } from "@ai-pair/protocol"
import { AGENTS, execProgram, SERVER, type Host } from "./agents"
import type { Starter } from "./panel"

function relayPath(extensionPath: string): string {
  return path.join(extensionPath, "dist", "relay.js")
}

/**
 * Writes a launcher at a fixed path that runs this version's relay with VS Code's own runtime,
 * so the agent's MCP configuration never changes and Node needn't be installed.
 */
export function writeLauncher(extensionPath: string): string {
  const bin = path.join(aiPairHome(), "bin")
  const relay = relayPath(extensionPath)
  const windows = process.platform === "win32"
  const launcher = path.join(bin, windows ? "pair-mcp.cmd" : "pair-mcp")
  // A launcher that can't be written leaves agents without it, not the extension without its panel (#9).
  try {
    fs.mkdirSync(bin, { recursive: true })
    if (windows) {
      fs.writeFileSync(
        launcher,
        `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${cmdLiteral(process.execPath)}" "${cmdLiteral(relay)}" %*\r\n`,
      )
    } else {
      fs.writeFileSync(launcher, `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ${shQuoted(process.execPath)} ${shQuoted(relay)} "$@"\n`)
      // writeFileSync's `mode` applies only to a file it creates.
      fs.chmodSync(launcher, 0o755)
    }
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e)
    void vscode.window.showErrorMessage(`AI Pair couldn't write its launcher at ${launcher}, so agents can't start it: ${why}`)
  }
  return launcher
}

/** For sh: single quotes, inside which nothing expands; a single quote ends them, so it is `'\''` (#9). */
function shQuoted(s: string): string {
  return `'${s.replaceAll("'", "'\\''")}'`
}

/** For a .cmd file: `%` expands even inside quotes, and `%%` is a literal one. A path can't hold `"`. */
function cmdLiteral(s: string): string {
  return s.replaceAll("%", "%%")
}

/**
 * Offers the pair server to agents running in VS Code itself (Copilot), with no setup: it runs the
 * relay directly, in the workspace, which is how the relay finds this window.
 */
export function registerServerProvider(context: vscode.ExtensionContext): void {
  // Missing in editors built on an older VS Code.
  if (typeof vscode.lm?.registerMcpServerDefinitionProvider !== "function") return
  const changed = new vscode.EventEmitter<void>()
  context.subscriptions.push(
    changed,
    vscode.workspace.onDidChangeWorkspaceFolders(() => changed.fire()),
    vscode.lm.registerMcpServerDefinitionProvider("aiPair.pair", {
      onDidChangeMcpServerDefinitions: changed.event,
      provideMcpServerDefinitions: () => {
        const folder = vscode.workspace.workspaceFolders?.[0]
        if (!folder) return []
        const server = new vscode.McpStdioServerDefinition(
          SERVER,
          process.execPath,
          [relayPath(context.extensionPath)],
          { ELECTRON_RUN_AS_NODE: "1" },
          String(context.extension.packageJSON.version),
        )
        server.cwd = folder.uri
        return [server]
      },
    }),
  )
}

const host: Host = { home: os.homedir(), env: process.env, platform: process.platform, exec: execProgram }

export async function setUpAgent(launcher: string): Promise<void> {
  type Item = vscode.QuickPickItem & { id: string }
  const items: Item[] = AGENTS.map((agent) => ({
    id: agent.id,
    label: agent.label,
    description: agent.isSetUp(host, launcher) ? "set up" : agent.detect(host) ? "installed" : undefined,
    picked: agent.detect(host) && !agent.isSetUp(host, launcher),
  }))
  items.push({ id: "other", label: "Another agent", description: "Copy an MCP server configuration to the clipboard" })
  const picked = await vscode.window.showQuickPick(items, {
    title: "Which agents do you pair with?",
    placeHolder: "GitHub Copilot in VS Code needs no setup: it already has the pair server.",
    canPickMany: true,
  })
  if (!picked?.length) return

  const done: string[] = []
  for (const agent of AGENTS.filter((a) => picked.some((p) => p.id === a.id))) {
    try {
      await agent.setUp(host, launcher)
      done.push(agent.label)
    } catch (e) {
      void vscode.window.showErrorMessage(`Couldn't set up ${agent.label}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  if (picked.some((p) => p.id === "other")) {
    const config = { mcpServers: { [SERVER]: { command: launcher, args: [] } } }
    await vscode.env.clipboard.writeText(JSON.stringify(config, null, 2))
    void vscode.window.showInformationMessage(
      `Copied. Add it to your agent's MCP configuration: a stdio server named "${SERVER}" running ${launcher}.`,
    )
  }
  if (done.length) {
    void vscode.window.showInformationMessage(`Set up ${list(done)}. Restart it, then ask it to pair in a folder that's open here.`)
  }
}

function list(names: string[]): string {
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
}

/** What the Start a session button puts in Claude Code's input box, unsent: the programmer presses Enter. */
export const START_PROMPT = "start pairing session"
/**
 * The command Claude Code's extension registers to open a tab, `(sessionId, initialPrompt, ...)`: read
 * from its bundle (2.1.294), not documented, so it is looked up before the button is offered.
 */
const CLAUDE_OPEN = "claude-vscode.editor.open"

/** Starts a session with Claude Code from the idle view (#107). */
export function claudeStarter(launcher: string, h: Host = host): Starter {
  return {
    async available() {
      // specs/Start.tla, Answer: isSetUp read now, the command list when it resolves.
      const claude = AGENTS.find((a) => a.id === "claude")
      if (!claude?.isSetUp(h, launcher)) return false
      return (await vscode.commands.getCommands(true)).includes(CLAUDE_OPEN)
    },
    async start() {
      await vscode.commands.executeCommand(CLAUDE_OPEN, undefined, START_PROMPT)
    },
  }
}
