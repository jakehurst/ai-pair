// Setting up agents: each agent's file ends up with the server, keeps what the programmer had in it, and setting up
// again changes nothing, the editors checked over a set of config files too (AgentSetup in #19). Solitary: node:fs
// is an in-memory disk and node:child_process's execFile a mock, so the test reads and writes no real file and runs
// no program; jsonc-parser is pure parsing, and real; the host is a fake passed in.

import * as path from 'node:path';
import { ok } from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { parse } from 'jsonc-parser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AGENTS, editJson, execProgram, tomlTable, which, withTomlTable, type Agent, type Host } from '../src/agents';

/** What the mocked modules share with the tests, made before the `vi.mock` factories run. */
const fakes = vi.hoisted(() => ({
  /** The disk: each file's text by its path, and the folders made. */
  files: new Map<string, string>(),
  dirs: new Set<string>(),
  /** What the next program execFile runs fails with, if anything. */
  failure: undefined as unknown,
  /** Returns whether `p` is a folder: one made, or one a file is in. */
  isDir: (p: string): boolean => fakes.dirs.has(p) || [...fakes.files.keys()].some((known) => known.startsWith(`${p}/`)),
}));

/** The launcher the agents are set up to run. */
const LAUNCHER = '/home/me/.ai-pair/bin/pair-mcp';

/** The home folder of the fake host. */
const HOME = '/home/me';

/** The body the TOML property case gives the server's table. */
const BODY = ['command = "/x/launcher"', 'args = []'];

/** Config files the TOML editor is checked over. */
const TOML = [
  '',
  '# a comment\n',
  '[a]\nx = 1\n',
  '[mcp_servers.other]\ncommand = "y"\n',
  '[mcp_servers.pair]\ncommand = "old"\n[mcp_servers.pair.env]\nA = "1"\n\n# about b\n[b]\ny = 2\n',
  '[a]\r\nx = 1\r\n[mcp_servers.pair]\r\ncommand = "old"\r\n',
  '[a]\nx = 1',
  '[mcp_servers."pair"]\ncommand = "old"\n# inside\nargs = ["z"]\n\n[c]\n',
];

/** Config files the JSON editor is checked over. */
const JSON_FILES = [
  '',
  '{}\n',
  '{\n  "theme": "dark"\n}\n',
  '{\n  "mcpServers": {\n    "other": { "command": "y" },\n    "pair": { "command": "old" }\n  }\n}\n',
  '{\n\t"mcpServers": {}, // servers\n\t"x": [1, 2,],\n}\n',
  '{\r\n  "a": 1\r\n}\r\n',
];

vi.mock('node:fs', () => {
  const { isDir } = fakes;
  return {
    existsSync: vi.fn((p: string) => fakes.files.has(p) || isDir(p)),
    statSync: vi.fn((p: string) => {
      if (!fakes.files.has(p) && !isDir(p)) {
        throw new Error(`ENOENT: no such file, stat '${p}'`);
      }
      return { isFile: () => fakes.files.has(p) };
    }),
    readFileSync: vi.fn((p: string) => {
      const text = fakes.files.get(p);
      if (text === undefined) {
        throw new Error(`ENOENT: no such file, open '${p}'`);
      }
      return text;
    }),
    mkdirSync: vi.fn((p: string) => {
      fakes.dirs.add(p);
    }),
    writeFileSync: vi.fn((p: string, text: string) => {
      fakes.files.set(p, text);
    }),
  };
});
vi.mock('node:child_process', () => ({
  // execFile(file, args, options, callback), as promisify calls it.
  execFile: vi.fn((...args: unknown[]) => {
    // The last argument is promisify's callback.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const callback = args.at(-1) as (error: unknown, stdout: string, stderr: string) => void;
    callback(fakes.failure, '', '');
  }),
}));

let host: Host;
let calls: string[][];

/** Returns the agent with `id`. */
function agent(id: string): Agent {
  const found = AGENTS.find((a) => a.id === id);
  ok(found);
  return found;
}

/** Returns the path of a file under the home folder. */
function file(...parts: string[]): string {
  return path.join(HOME, ...parts);
}

/** Returns a file's text on the disk. */
function read(...parts: string[]): string {
  const text = fakes.files.get(file(...parts));
  ok(text !== undefined, `no file ${file(...parts)}`);
  return text;
}

/** Puts a file on the disk. */
function put(text: string, ...parts: string[]): void {
  fakes.files.set(file(...parts), text);
}

/** Sets an agent up twice, and returns its file's text after the first: the second changes nothing. */
async function setUpTwice(id: string, ...parts: string[]): Promise<string> {
  expect(agent(id).isSetUp(host, LAUNCHER)).toBe(false);
  await agent(id).setUp(host, LAUNCHER);
  const once = read(...parts);
  await agent(id).setUp(host, LAUNCHER);
  expect(read(...parts)).toBe(once);
  expect(agent(id).isSetUp(host, LAUNCHER)).toBe(true);
  return once;
}

/** Returns the text with the pair table and its subtables taken out, and blank lines trimmed. */
function withoutPair(crlf: string): string {
  // tomlTable joins its lines with "\n".
  const text = crlf.replaceAll('\r\n', '\n');
  const own = tomlTable(text, 'pair');
  const rest = own === undefined ? text : text.replace(own, '');
  return rest
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
    .join('\n');
}

/** Returns `v` if it is a JSON object, and an empty one otherwise. */
function record(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? { ...v } : {};
}

/** Returns a config's servers. */
function servers(o: Record<string, unknown>): Record<string, unknown> {
  return record(o.mcpServers);
}

beforeEach(() => {
  calls = [];
  host = {
    home: HOME,
    env: { PATH: '' },
    platform: 'linux',
    exec: (program, args) => {
      calls.push([program, ...args]);
      return Promise.resolve();
    },
  };
});

afterEach(() => {
  fakes.files.clear();
  fakes.dirs.clear();
  fakes.failure = undefined;
  vi.clearAllMocks();
});

describe('which', () => {
  it('finds a program on the PATH, or in an extra folder, and not a folder of its name or a missing one', () => {
    host.env = { PATH: '/usr/bin:/opt/bin' };
    put('', 'bin', 'tool');
    fakes.dirs.add('/opt/bin/claude');
    fakes.files.set('/usr/bin/codex', '');
    expect(which(host, 'codex')).toBe('/usr/bin/codex');
    expect(which(host, 'tool', [file('bin')])).toBe(file('bin', 'tool'));
    expect(which(host, 'claude')).toBeUndefined();
    expect(which(host, 'missing')).toBeUndefined();
  });

  it("finds one on Windows with PATHEXT's extensions, or the default ones, in the Path the environment names", () => {
    host.platform = 'win32';
    host.env = { Path: 'C:\\bin;C:\\tools', PATHEXT: '.EXE' };
    fakes.files.set(path.join('C:\\tools', 'cursor.EXE'), '');
    expect(which(host, 'cursor')).toBe(path.join('C:\\tools', 'cursor.EXE'));
    host.env = { Path: 'C:\\bin' };
    fakes.files.set(path.join('C:\\bin', 'gemini.CMD'), '');
    expect(which(host, 'gemini')).toBe(path.join('C:\\bin', 'gemini.CMD'));
    host.env = {};
    expect(which(host, 'gemini')).toBeUndefined();
  });
});

describe('execProgram', () => {
  it('runs a program, with verbatim arguments for cmd.exe only, and a timeout', async () => {
    await execProgram('/usr/bin/claude', ['mcp']);
    await execProgram('C:\\Windows\\system32\\cmd.exe', ['/c']);
    expect(vi.mocked(execFile).mock.calls.map((call) => call[2])).toEqual([
      { windowsVerbatimArguments: false, timeout: 30_000 },
      { windowsVerbatimArguments: true, timeout: 30_000 },
    ]);
  });

  it("fails with the program's stderr, or else the error's message, or else its text", async () => {
    fakes.failure = Object.assign(new Error('Command failed'), { stderr: '  no such server\n' });
    await expect(execProgram('claude', [])).rejects.toThrow(/^no such server$/);
    fakes.failure = Object.assign(new Error('Command failed'), { stderr: ' ' });
    await expect(execProgram('claude', [])).rejects.toThrow(/^Command failed$/);
    fakes.failure = 'killed';
    await expect(execProgram('claude', [])).rejects.toThrow(/^killed$/);
  });
});

describe('editJson', () => {
  it('refuses to set a value at no key', () => {
    expect(() => {
      editJson(file('x.json'), [], 1);
    }).toThrow('setIn needs at least one key.');
  });

  it("AgentSetup: sets the JSON entry once, however many times it's run, and leaves the rest as it was", () => {
    const config = file('config.json');
    const value = { command: '/x/launcher', args: [] };
    for (const text of JSON_FILES) {
      fakes.files.set(config, text);
      editJson(config, ['mcpServers', 'pair'], value);
      const once = fakes.files.get(config) ?? '';
      editJson(config, ['mcpServers', 'pair'], value);
      expect(fakes.files.get(config), JSON.stringify(text)).toBe(once);
      const before = text.trim() === '' ? {} : record(parse(text, [], { allowTrailingComma: true }));
      const after = record(parse(once, [], { allowTrailingComma: true }));
      expect({ ...after, mcpServers: undefined }, JSON.stringify(text)).toEqual({ ...before, mcpServers: undefined });
      expect({ ...servers(after), pair: undefined }, JSON.stringify(text)).toEqual({ ...servers(before), pair: undefined });
      expect(servers(after).pair, JSON.stringify(text)).toEqual(value);
    }
  });
});

describe('the TOML table', () => {
  it("AgentSetup: sets the TOML table once, however many times it's run, and leaves the rest as it was", () => {
    for (const text of TOML) {
      const once = withTomlTable(text, 'pair', BODY);
      expect(withTomlTable(once, 'pair', BODY), JSON.stringify(text)).toBe(once);
      // tomlTable counts the comments and blank lines before the next table as this one's; withTomlTable keeps them for the next.
      const keys = tomlTable(once, 'pair')
        ?.split(/\r?\n/)
        .filter((l) => l.trim() !== '' && !l.trim().startsWith('#'));
      expect(keys, JSON.stringify(text)).toEqual(['[mcp_servers.pair]', ...BODY]);
      expect(withoutPair(once), JSON.stringify(text)).toBe(withoutPair(text));
      expect(tomlTable(once, 'other'), JSON.stringify(text)).toBe(tomlTable(text, 'other'));
    }
  });

  it('keeps the comments after the last table when that table is the one replaced, and drops blank lines before a new one', () => {
    expect(withTomlTable('[mcp_servers.pair]\ncommand = "old"\n# the end\n', 'pair', BODY)).toBe(
      `[mcp_servers.pair]\n${BODY.join('\n')}\n# the end\n`,
    );
    expect(withTomlTable('a = 1\n\n\n', 'pair', BODY)).toBe(`a = 1\n\n[mcp_servers.pair]\n${BODY.join('\n')}\n`);
  });
});

describe('Claude Code', () => {
  it("runs its CLI when it's installed, replacing an old entry, even when there was none to remove", async () => {
    put('', '.local', 'bin', 'claude');
    expect(agent('claude').detect(host)).toBe(true);
    host.exec = (program, args) => {
      calls.push([program, ...args]);
      return args[1] === 'remove' ? Promise.reject(new Error('No server named pair.')) : Promise.resolve();
    };
    expect(await agent('claude').setUp(host, LAUNCHER)).toBe('claude mcp add');
    expect(calls).toEqual([
      [file('.local', 'bin', 'claude'), 'mcp', 'remove', '--scope', 'user', 'pair'],
      [file('.local', 'bin', 'claude'), 'mcp', 'add', '--scope', 'user', 'pair', '--', LAUNCHER],
    ]);
  });

  it("runs an npm shim on Windows through the host's ComSpec, or cmd.exe, quoting what needs it (#11)", async () => {
    host.platform = 'win32';
    host.env = { PATH: '', PATHEXT: '.CMD', ComSpec: 'C:\\Windows\\system32\\cmd.exe' };
    put('', '.local', 'bin', 'claude.CMD');
    await agent('claude').setUp(host, LAUNCHER);
    expect(calls.map((c) => c[0])).toEqual(['C:\\Windows\\system32\\cmd.exe', 'C:\\Windows\\system32\\cmd.exe']);
    host.env = { PATH: '', PATHEXT: '.CMD' };
    calls = [];
    await agent('claude').setUp(host, 'C:\\Program Files\\pair "mcp".cmd');
    expect(calls[1]?.[0]).toBe('cmd.exe');
    expect(calls[1]?.at(-1)).toContain('"C:\\Program Files\\pair ""mcp"".cmd"');
  });

  it('edits ~/.claude.json without it, keeping the rest, where CLAUDE_CONFIG_DIR says if it is set', async () => {
    put(`{\n  "numStartups": 3,\n  "mcpServers": {\n    "other": { "command": "x" }\n  }\n}\n`, '.claude.json');
    expect(agent('claude').detect(host)).toBe(true);
    const text = await setUpTwice('claude', '.claude.json');
    const json: unknown = JSON.parse(text);
    expect(json).toEqual({
      numStartups: 3,
      mcpServers: { other: { command: 'x' }, pair: { type: 'stdio', command: LAUNCHER, args: [], env: {} } },
    });
    host.env.CLAUDE_CONFIG_DIR = file('elsewhere');
    expect(await agent('claude').setUp(host, LAUNCHER)).toBe(file('elsewhere', '.claude.json'));
  });

  it("leaves a file it can't parse alone, and isn't detected with neither its CLI nor its file", async () => {
    expect(agent('claude').detect(host)).toBe(false);
    put(`{ "mcpServers": `, '.claude.json');
    await expect(agent('claude').setUp(host, LAUNCHER)).rejects.toThrow(/isn't valid JSON/);
    expect(read('.claude.json')).toBe(`{ "mcpServers": `);
  });
});

describe('Codex', () => {
  it('creates config.toml, and is detected by its CLI or its folder', async () => {
    expect(agent('codex').detect(host)).toBe(false);
    expect(await setUpTwice('codex', '.codex', 'config.toml')).toBe(`[mcp_servers.pair]\ncommand = "${LAUNCHER}"\nargs = []\n`);
    expect(agent('codex').detect(host)).toBe(true);
    host.env = { PATH: '/usr/bin' };
    fakes.files.clear();
    fakes.files.set('/usr/bin/codex', '');
    expect(agent('codex').detect(host)).toBe(true);
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
    expect(withTomlTable(`[mcp_servers]\nother = { command = "x" }\n`, 'pair', [])).toContain('[mcp_servers.pair]');
  });
});

describe('OpenCode', () => {
  it('creates opencode.json with its schema, and is detected by its folder', async () => {
    expect(agent('opencode').detect(host)).toBe(false);
    const json: unknown = JSON.parse(await setUpTwice('opencode', '.config', 'opencode', 'opencode.json'));
    expect(json).toEqual({
      $schema: 'https://opencode.ai/config.json',
      mcp: { pair: { type: 'local', command: [LAUNCHER], enabled: true } },
    });
    expect(agent('opencode').detect(host)).toBe(true);
  });

  it('edits an existing opencode.jsonc, keeping comments, and an existing opencode.json', async () => {
    put(`{\n\t// my theme\n\t"theme": "dark",\n}\n`, '.config', 'opencode', 'opencode.jsonc');
    const text = await setUpTwice('opencode', '.config', 'opencode', 'opencode.jsonc');
    expect(text).toContain(`\t// my theme\n\t"theme": "dark",`);
    expect(text).toContain(`\t"mcp": {\n\t\t"pair": {`);
    fakes.files.clear();
    put('{\n    "theme": "light"\n}\n', '.config', 'opencode', 'opencode.json');
    expect(await setUpTwice('opencode', '.config', 'opencode', 'opencode.json')).toContain('    "theme": "light"');
  });

  it("isn't set up by a command that is a string, not a list (#11), and is by config.json's", () => {
    put(`{ "mcp": { "pair": { "type": "local", "command": "x" } } }`, '.config', 'opencode', 'opencode.json');
    expect(agent('opencode').isSetUp(host, 'x')).toBe(false);
    put(`{ "mcp": { "pair": { "type": "local", "command": ["x"] } } }`, '.config', 'opencode', 'config.json');
    expect(agent('opencode').isSetUp(host, 'x')).toBe(true);
  });

  it('honors XDG_CONFIG_HOME', async () => {
    host.env.XDG_CONFIG_HOME = file('xdg');
    await agent('opencode').setUp(host, LAUNCHER);
    expect(read('xdg', 'opencode', 'opencode.json')).toContain(LAUNCHER);
  });
});

describe('Gemini CLI and Cursor', () => {
  it('add the server to their files, and are detected by their folders', async () => {
    expect([agent('gemini').detect(host), agent('cursor').detect(host)]).toEqual([false, false]);
    put(`{ "theme": "GitHub" }`, '.gemini', 'settings.json');
    const gemini: unknown = JSON.parse(await setUpTwice('gemini', '.gemini', 'settings.json'));
    expect(gemini).toEqual({ theme: 'GitHub', mcpServers: { pair: { command: LAUNCHER, args: [] } } });
    const cursor: unknown = JSON.parse(await setUpTwice('cursor', '.cursor', 'mcp.json'));
    expect(cursor).toEqual({ mcpServers: { pair: { type: 'stdio', command: LAUNCHER, args: [] } } });
    expect([agent('gemini').detect(host), agent('cursor').detect(host)]).toEqual([true, true]);
  });

  it('are detected by their CLIs on the PATH', () => {
    host.env = { PATH: '/usr/bin' };
    fakes.files.set('/usr/bin/gemini', '');
    fakes.files.set('/usr/bin/cursor', '');
    expect([agent('gemini').detect(host), agent('cursor').detect(host)]).toEqual([true, true]);
  });
});
