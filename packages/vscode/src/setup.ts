// The launcher for pair-mcp, and connecting it to the programmer's agents.
// See "Starting a session" and "Distribution" in ARCHITECTURE.md.

import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import * as vscode from "vscode"
import { aiPairHome } from "@ai-pair/protocol"
import { AGENTS, execProgram, SERVER, type Host } from "./agents"

function relayPath(extensionPath: string): string {
  return path.join(extensionPath, "dist", "relay.js")
}

/**
 * Writes a launcher at a fixed path that runs this version's relay with VS Code's own runtime,
 * so the agent's MCP configuration never changes and Node needn't be installed.
 */
export function writeLauncher(extensionPath: string): string {
  const bin = path.join(aiPairHome(), "bin")
  fs.mkdirSync(bin, { recursive: true })
  const relay = relayPath(extensionPath)
  if (process.platform === "win32") {
    const launcher = path.join(bin, "pair-mcp.cmd")
    fs.writeFileSync(launcher, `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${process.execPath}" "${relay}" %*\r\n`)
    return launcher
  }
  const launcher = path.join(bin, "pair-mcp")
  fs.writeFileSync(launcher, `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "${process.execPath}" "${relay}" "$@"\n`, { mode: 0o755 })
  return launcher
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
