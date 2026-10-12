// Setting up agents: each agent's file ends up with the server, keeps what the programmer had in it,
// and setting up again changes nothing.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ok } from 'node:assert/strict';
import { beforeEach, describe, expect, it } from 'vitest';
import { AGENTS, type Agent, type Host, withTomlTable } from '../src/agents';

const LAUNCHER = '/home/me/.ai-pair/bin/pair-mcp';
let host: Host;
let calls: string[][];

beforeEach(() => {
  calls = [];
  host = {
    home: fs.mkdtempSync(path.join(os.tmpdir(), 'ai-pair-agents-')),
    env: { PATH: '' },
    platform: process.platform,
    exec: (program, args) => {
      calls.push([program, ...args]);
      return Promise.resolve();
    },
  };
});

function agent(id: string): Agent {
  const found = AGENTS.find((a) => a.id === id);
  ok(found);
  return found;
}
function file(...parts: string[]): string {
  return path.join(host.home, ...parts);
}
function read(...parts: string[]): string {
  return fs.readFileSync(file(...parts), 'utf8');
}
function put(text: string, ...parts: string[]): void {
  fs.mkdirSync(path.dirname(file(...parts)), { recursive: true });
  fs.writeFileSync(file(...parts), text);
}

async function setUpTwice(id: string, ...parts: string[]): Promise<string> {
  expect(agent(id).isSetUp(host, LAUNCHER)).toBe(false);
  await agent(id).setUp(host, LAUNCHER);
  const once = read(...parts);
  await agent(id).setUp(host, LAUNCHER);
  expect(read(...parts)).toBe(once);
  expect(agent(id).isSetUp(host, LAUNCHER)).toBe(true);
  return once;
}

describe('Claude Code', () => {
  it("runs its CLI when it's installed, replacing an old entry", async () => {
    const cli = file('.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude');
    put('', '.local', 'bin', path.basename(cli));
    expect(agent('claude').detect(host)).toBe(true);
    await agent('claude').setUp(host, LAUNCHER);
    expect(calls).toEqual([
      [cli, 'mcp', 'remove', '--scope', 'user', 'pair'],
      [cli, 'mcp', 'add', '--scope', 'user', 'pair', '--', LAUNCHER],
    ]);
  });

  it("runs an npm shim on Windows through the host's ComSpec (#11)", async () => {
    host.platform = 'win32';
    host.env = { PATH: '', PATHEXT: '.CMD', ComSpec: 'C:\\Windows\\system32\\cmd.exe' };
    put('', '.local', 'bin', 'claude.CMD');
    await agent('claude').setUp(host, LAUNCHER);
    expect(calls.map((c) => c[0])).toEqual(['C:\\Windows\\system32\\cmd.exe', 'C:\\Windows\\system32\\cmd.exe']);
  });

  it('edits ~/.claude.json without it, keeping the rest', async () => {
    put(`{\n  "numStartups": 3,\n  "mcpServers": {\n    "other": { "command": "x" }\n  }\n}\n`, '.claude.json');
    const text = await setUpTwice('claude', '.claude.json');
    const json: unknown = JSON.parse(text);
    expect(json).toEqual({
      numStartups: 3,
      mcpServers: { other: { command: 'x' }, pair: { type: 'stdio', command: LAUNCHER, args: [], env: {} } },
    });
  });

  it("leaves a file it can't parse alone", async () => {
    put(`{ "mcpServers": `, '.claude.json');
    await expect(agent('claude').setUp(host, LAUNCHER)).rejects.toThrow(/isn't valid JSON/);
    expect(read('.claude.json')).toBe(`{ "mcpServers": `);
  });
});

describe('Codex', () => {
  it('creates config.toml', async () => {
    expect(agent('codex').detect(host)).toBe(false);
    expect(await setUpTwice('codex', '.codex', 'config.toml')).toBe(`[mcp_servers.pair]\ncommand = "${LAUNCHER}"\nargs = []\n`);
  });

  it("adds the table after what's there, keeping comments", async () => {
    put(`# my settings\nmodel = "o3" # the best\n\n[mcp_servers.other]\ncommand = "x"\n`, '.codex', 'config.toml');
    expect(await setUpTwice('codex', '.codex', 'config.toml')).toBe(
      `# my settings\nmodel = "o3" # the best\n\n[mcp_servers.other]\ncommand = "x"\n\n` +
        `[mcp_servers.pair]\ncommand = "${LAUNCHER}"\nargs = []\n`,
    );
  });

  it('replaces an old table and its subtables in place', async () => {
    put(
      `[mcp_servers.pair]\ncommand = "old"\nstartup_timeout_sec = 5\n\n[mcp_servers.pair.env]\nX = "1"\n\n# next\n[profiles.x]\nmodel = "y"\n`,
      '.codex',
      'config.toml',
    );
    expect(await setUpTwice('codex', '.codex', 'config.toml')).toBe(
      `[mcp_servers.pair]\ncommand = "${LAUNCHER}"\nargs = []\n\n# next\n[profiles.x]\nmodel = "y"\n`,
    );
  });

  it('honors CODEX_HOME', async () => {
    host.env.CODEX_HOME = file('elsewhere');
    await agent('codex').setUp(host, LAUNCHER);
    expect(read('elsewhere', 'config.toml')).toContain('[mcp_servers.pair]');
  });

  it('escapes Windows paths, keeping CRLF', () => {
    expect(withTomlTable(`a = 1\r\n`, 'pair', [`command = ${JSON.stringify('C:\\Users\\me\\pair-mcp.cmd')}`])).toBe(
      `a = 1\r\n\r\n[mcp_servers.pair]\r\ncommand = "C:\\\\Users\\\\me\\\\pair-mcp.cmd"\r\n`,
    );
  });

  it("refuses a server it can't replace safely", () => {
    expect(() => withTomlTable(`[mcp_servers]\npair = { command = "x" }\n`, 'pair', [])).toThrow(/can't update/);
    expect(() => withTomlTable(`mcp_servers.pair.command = "x"\n`, 'pair', [])).toThrow(/can't update/);
    expect(() => withTomlTable(`mcp_servers = {}\n`, 'pair', [])).toThrow(/can't update/);
  });
});

describe('OpenCode', () => {
  it('creates opencode.json with its schema', async () => {
    const json: unknown = JSON.parse(await setUpTwice('opencode', '.config', 'opencode', 'opencode.json'));
    expect(json).toEqual({
      $schema: 'https://opencode.ai/config.json',
      mcp: { pair: { type: 'local', command: [LAUNCHER], enabled: true } },
    });
  });

  it('edits an existing opencode.jsonc, keeping comments', async () => {
    put(`{\n\t// my theme\n\t"theme": "dark",\n}\n`, '.config', 'opencode', 'opencode.jsonc');
    const text = await setUpTwice('opencode', '.config', 'opencode', 'opencode.jsonc');
    expect(text).toContain(`\t// my theme\n\t"theme": "dark",`);
    expect(text).toContain(`\t"mcp": {\n\t\t"pair": {`);
  });

  it("isn't set up by a command that is a string, not a list (#11)", () => {
    put(`{ "mcp": { "pair": { "type": "local", "command": "x" } } }`, '.config', 'opencode', 'opencode.json');
    expect(agent('opencode').isSetUp(host, 'x')).toBe(false);
  });

  it('honors XDG_CONFIG_HOME', async () => {
    host.env.XDG_CONFIG_HOME = file('xdg');
    await agent('opencode').setUp(host, LAUNCHER);
    expect(read('xdg', 'opencode', 'opencode.json')).toContain(LAUNCHER);
  });
});

describe('Gemini CLI and Cursor', () => {
  it('add the server to their files', async () => {
    put(`{ "theme": "GitHub" }`, '.gemini', 'settings.json');
    const gemini: unknown = JSON.parse(await setUpTwice('gemini', '.gemini', 'settings.json'));
    expect(gemini).toEqual({ theme: 'GitHub', mcpServers: { pair: { command: LAUNCHER, args: [] } } });

    const cursor: unknown = JSON.parse(await setUpTwice('cursor', '.cursor', 'mcp.json'));
    expect(cursor).toEqual({ mcpServers: { pair: { type: 'stdio', command: LAUNCHER, args: [] } } });
  });
});
