// Setting up an agent changes only the pair entry, and doing it twice equals doing it once
// (AgentSetup in #19): checked on the TOML and JSON editors over a set of config files.

import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { parse } from "jsonc-parser"
import { expect, it } from "vitest"
import { editJson, tomlTable, withTomlTable } from "../src/agents"

const BODY = ['command = "/x/launcher"', "args = []"]

const TOML = [
  "",
  "# a comment\n",
  "[a]\nx = 1\n",
  '[mcp_servers.other]\ncommand = "y"\n',
  '[mcp_servers.pair]\ncommand = "old"\n[mcp_servers.pair.env]\nA = "1"\n\n# about b\n[b]\ny = 2\n',
  '[a]\r\nx = 1\r\n[mcp_servers.pair]\r\ncommand = "old"\r\n',
  "[a]\nx = 1",
  '[mcp_servers."pair"]\ncommand = "old"\n# inside\nargs = ["z"]\n\n[c]\n',
]

/** The text with the pair table and its subtables taken out, and blank lines trimmed. */
function withoutPair(crlf: string): string {
  // tomlTable joins its lines with "\n".
  const text = crlf.replaceAll("\r\n", "\n")
  const own = tomlTable(text, "pair")
  const rest = own === undefined ? text : text.replace(own, "")
  return rest.split(/\r?\n/).filter((l) => l.trim() !== "").join("\n")
}

it("sets the TOML table once, however many times it's run, and leaves the rest as it was", () => {
  for (const text of TOML) {
    const once = withTomlTable(text, "pair", BODY)
    expect(withTomlTable(once, "pair", BODY), JSON.stringify(text)).toBe(once)
    // tomlTable counts the comments and blank lines before the next table as this one's; withTomlTable keeps them for the next.
    const keys = tomlTable(once, "pair")?.split(/\r?\n/).filter((l) => l.trim() !== "" && !l.trim().startsWith("#"))
    expect(keys, JSON.stringify(text)).toEqual(["[mcp_servers.pair]", ...BODY])
    expect(withoutPair(once), JSON.stringify(text)).toBe(withoutPair(text))
    expect(tomlTable(once, "other"), JSON.stringify(text)).toBe(tomlTable(text, "other"))
  }
})

const JSON_FILES = [
  "",
  "{}\n",
  '{\n  "theme": "dark"\n}\n',
  '{\n  "mcpServers": {\n    "other": { "command": "y" },\n    "pair": { "command": "old" }\n  }\n}\n',
  '{\n\t"mcpServers": {}, // servers\n\t"x": [1, 2,],\n}\n',
  '{\r\n  "a": 1\r\n}\r\n',
]

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)
const record = (v: unknown): Record<string, unknown> => (isRecord(v) ? v : {})
const servers = (o: Record<string, unknown>) => ({ ...record(o.mcpServers) })

it("sets the JSON entry once, however many times it's run, and leaves the rest as it was", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-pair-setup-"))
  const file = path.join(dir, "config.json")
  const value = { command: "/x/launcher", args: [] }
  for (const text of JSON_FILES) {
    fs.writeFileSync(file, text)
    editJson(file, ["mcpServers", "pair"], value)
    const once = fs.readFileSync(file, "utf8")
    editJson(file, ["mcpServers", "pair"], value)
    expect(fs.readFileSync(file, "utf8"), JSON.stringify(text)).toBe(once)
    const before = text.trim() === "" ? {} : record(parse(text, [], { allowTrailingComma: true }))
    const after = record(parse(once, [], { allowTrailingComma: true }))
    expect({ ...after, mcpServers: undefined }, JSON.stringify(text)).toEqual({ ...before, mcpServers: undefined })
    expect({ ...servers(after), pair: undefined }, JSON.stringify(text)).toEqual({ ...servers(before), pair: undefined })
    expect(servers(after).pair, JSON.stringify(text)).toEqual(value)
  }
  fs.rmSync(dir, { recursive: true, force: true })
})
