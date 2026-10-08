import * as os from "node:os"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { isJSONRPCNotification, type CallToolResult, type RequestId } from "@modelcontextprotocol/sdk/types.js"
import { z } from "zod"
import { aiPairHome, type FileContent, type Report, type ToolName } from "@ai-pair/protocol"
import { readGuides, renderGuides, type Guide } from "./guide"
import { RelayError, type EditorLink } from "./link"
import { renderFile, renderReport } from "./render"
import { TOOLS } from "./tools"

/** The extension's version, which the build defines; unbuilt, as in tests, there's none. */
declare const AI_PAIR_VERSION: string | undefined
const VERSION = typeof AI_PAIR_VERSION === "string" ? AI_PAIR_VERSION : "dev"

/** Always loaded by the harness, so kept short; the full guide comes with `start`. */
export const INSTRUCTIONS = `Live pair programming in the programmer's editor (VS Code with the AI Pair extension). When the programmer asks to pair, call \`start\` with your working directory: its result includes the pairing guide, which you follow for the whole session. During a session, everything you do through \`step\` appears in their editor at a human pace, with your narration, and they can interrupt or take over at any moment. Never end your turn during a session; call \`listen\` instead.`

/** The agent-facing part of AGENT_GUIDE.md: everything after the first horizontal rule. */
export function agentGuide(markdown: string): string {
  const rule = /\r?\n---\r?\n/.exec(markdown)
  return (rule ? markdown.slice(rule.index + rule[0].length) : markdown).trim()
}

export function startPrompt(task?: string): string {
  const what = task?.trim() ? `The task: ${task.trim()}` : "Ask me what we're working on, unless it's clear from our conversation."
  return `Let's pair program. ${what}\n\nStart a session with the \`start\` tool of the pair server, then follow the guide it returns.`
}

/** A guide's path for the agent and the panel: `~` for the home folder. */
function shownPath(file: string): string {
  const home = os.homedir()
  return file.startsWith(home + path.sep) ? `~${file.slice(home.length)}` : file
}

/** How many answered reports the relay keeps, for a cancel that arrives after its answer (#67). */
const MAX_ANSWERED = 16

/** How long to wait for the harness to list its roots: one that claims to but never answers mustn't block `start`. */
const ROOTS_MS = 2000

/**
 * `cwd` is the relay's working directory. The agent's paths are relative to its own, which `start`
 * finds as the first of these that a VS Code window has open: the one the agent gives, the harness's
 * roots, and `cwd`. Some harnesses start MCP servers in `/` or in their own install folder.
 */
export function createServer(link: EditorLink, guide: string, cwd: string): McpServer {
  const server = new McpServer({ name: "ai-pair", version: VERSION }, { instructions: INSTRUCTIONS })

  const roots = async (): Promise<string[]> => {
    if (!server.server.getClientCapabilities()?.roots) return []
    try {
      const listed = await server.server.listRoots(undefined, { timeout: ROOTS_MS })
      return listed.roots.filter((r) => r.uri.startsWith("file:")).map((r) => fileURLToPath(r.uri))
    } catch {
      return []
    }
  }

  // The guides the last `start` read, for its result (#23).
  let guides: Guide[] = []

  // The reports the relay answered with, by request: a cancel for one may come after its answer (#67).
  const answered = new Map<RequestId, unknown>()
  const run = async (
    tool: ToolName,
    args: Record<string, unknown>,
    { signal, requestId }: { signal: AbortSignal; requestId: RequestId },
    before?: () => Promise<Record<string, unknown>>,
  ): Promise<CallToolResult> => {
    try {
      if (before) args = { ...args, ...(await before()) }
      const result = await link.call(tool, args, signal)
      // Canceled before its answer came, it was handed back already, and never reached the agent.
      if (tool !== "read" && !signal.aborted) {
        answered.set(requestId, result)
        for (const id of answered.keys()) if (answered.size > MAX_ANSWERED) answered.delete(id)
      }
      // The editor answers `read` with a FileContent and the other tools with a Report (`dispatch` in bridge.ts).
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      const text = tool === "read" ? renderFile(result as FileContent) : renderReport(result as Report, tool)
      const content: CallToolResult["content"] = [{ type: "text", text }]
      if (tool === "start") content.push({ type: "text", text: `# Pairing guide\n\n${guide}` })
      if (tool === "start" && guides.length > 0) content.push({ type: "text", text: renderGuides(guides, shownPath) })
      return { content }
    } catch (e) {
      const code = e instanceof RelayError ? e.code : "internal"
      const message = e instanceof Error ? e.message : String(e)
      return { isError: true, content: [{ type: "text", text: `${code}: ${message}` }] }
    }
  }

  server.registerTool("start", TOOLS.start, ({ cwd: given, ...args }, extra) =>
    run("start", args, extra, async () => {
      const folders = [...(given && path.isAbsolute(given) ? [given] : []), ...(await roots()), cwd]
      const located = link.locate(folders)
      const { folder, root } = link.workspace(located)
      guides = readGuides(aiPairHome(), folder, root)
      return { cwd: located, rules: guides.map((g) => shownPath(g.file)) }
    }),
  )
  server.registerTool("step", TOOLS.step, (args, extra) => run("step", args, extra))
  server.registerTool("listen", TOOLS.listen, (args, extra) => run("listen", args, extra))
  server.registerTool("end", TOOLS.end, (args, extra) => run("end", args, extra))
  server.registerTool("read", TOOLS.read, (args, extra) => run("read", args, extra))

  // A cancel for a request the relay already answered: the SDK ignores it, and the agent's client
  // dropped the answer, unless it had taken it first (its abort listener sends a cancel either way).
  // So the report is handed back, marked as one the agent may have seen (#67). The agent's next
  // request comes after the cancel on the same stream, so the `return` goes out before it.
  const connect = server.connect.bind(server)
  server.connect = async (transport) => {
    await connect(transport)
    const receive = transport.onmessage
    // A Transport has only this one handler, which the SDK set in connect().
    // oxlint-disable-next-line unicorn/prefer-add-event-listener
    transport.onmessage = (message, extra) => {
      if (isJSONRPCNotification(message) && message.method === "notifications/cancelled") {
        const id: unknown = message.params?.requestId
        if ((typeof id === "string" || typeof id === "number") && answered.has(id)) {
          link.handBack(answered.get(id))
          answered.delete(id)
        }
      }
      receive?.(message, extra)
    }
  }

  server.registerPrompt(
    "start",
    {
      description: "Start pair programming: the agent works in your editor at a human pace, narrating as it goes.",
      argsSchema: { task: z.string().optional().describe("What to work on.") },
    },
    ({ task }) => ({ messages: [{ role: "user", content: { type: "text", text: startPrompt(task) } }] }),
  )

  return server
}
