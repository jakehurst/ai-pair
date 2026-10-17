// The launcher, Set Up Agent, and the Claude Code starter (#9, #107, #115,
// specs/Start.tla). Solitary: the vscode module is a fake the test drives, node:fs and node:os are mocks, the
// protocol's aiPairHome is a mock, and agents.ts's AGENTS, execProgram, and which are mocks; the host is a fake passed
// in. The launcher written here is run by launcher.e2e.test.ts.

import * as path from 'node:path';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Host } from '../src/agents';
import { claudeStarter, setUpAgent, START_ARGS, START_PROMPT, START_TERMINAL, writeLauncher } from '../src/setup';

/** What the mocked modules share with the tests, made before the `vi.mock` factories run. */
const fakes = vi.hoisted(() => {
  /** An agent, faked: whether it is set up and installed, and how its set up goes. */
  interface FakeAgent {
    id: string;
    label: string;
    detect: ReturnType<typeof vi.fn<() => boolean>>;
    isSetUp: ReturnType<typeof vi.fn<() => boolean>>;
    setUp: ReturnType<typeof vi.fn<() => Promise<string>>>;
  }

  return {
    /** The agents, each not installed or set up, and setting up without trouble. */
    agents: [
      ['claude', 'Claude Code'],
      ['codex', 'Codex'],
      ['gemini', 'Gemini CLI'],
    ].map(([id = '', label = '']): FakeAgent => ({
      id,
      label,
      detect: vi.fn(() => false),
      isSetUp: vi.fn(() => false),
      setUp: vi.fn(() => Promise.resolve(`${id}'s file`)),
    })),
    /** The terminals createTerminal made, and the close listeners. */
    terminals: [] as Array<{ options: Record<string, unknown> }>,
    closeListeners: new Set<(terminal: unknown) => void>(),
    /** What the quick pick answers with, and what it was offered. */
    picked: undefined as undefined | Array<{ id: string }>,
    offered: [] as unknown[],
    /** The messages shown, and what went to the clipboard. */
    errors: [] as string[],
    infos: [] as string[],
    clipboard: [] as string[],
    /** The workspace's folders. */
    folders: undefined as undefined | Array<{ uri: { fsPath: string } }>,
    /** The program `which` finds, by its name. */
    programs: new Map<string, string>(),
  };
});

/** The launcher's path, as setUpAgent and the starter are given it. */
const LAUNCHER = '/home/me/.ai-pair/bin/pair-mcp';

/** AI_PAIR_HOME, as the mocked aiPairHome gives it. */
const PAIR_HOME = '/home/me/.ai-pair';

/** Where the extension is installed. */
const EXTENSION = '/ext';

/** The project folder open in the window. */
const FOLDER = '/home/me/project';

vi.mock('vscode', () => ({
  workspace: {
    get workspaceFolders() {
      return fakes.folders;
    },
  },
  window: {
    showErrorMessage: (message: string) => {
      fakes.errors.push(message);
      return Promise.resolve(undefined);
    },
    showInformationMessage: (message: string) => {
      fakes.infos.push(message);
      return Promise.resolve(undefined);
    },
    showQuickPick: (items: unknown[]) => {
      fakes.offered.push(items);
      return Promise.resolve(fakes.picked);
    },
    createTerminal: (options: Record<string, unknown>) => {
      const terminal = { options };
      fakes.terminals.push(terminal);
      return terminal;
    },
    onDidCloseTerminal: (listener: (terminal: unknown) => void) => {
      fakes.closeListeners.add(listener);
      return {
        dispose: () => {
          fakes.closeListeners.delete(listener);
        },
      };
    },
  },
  env: {
    clipboard: {
      writeText: (text: string) => {
        fakes.clipboard.push(text);
        return Promise.resolve();
      },
    },
  },
}));
vi.mock('node:fs', () => ({ mkdirSync: vi.fn(), writeFileSync: vi.fn(), chmodSync: vi.fn() }));
vi.mock('node:os', () => ({ homedir: vi.fn(() => '/home/me') }));
vi.mock('@ai-pair/protocol', () => ({ aiPairHome: vi.fn(() => PAIR_HOME) }));
vi.mock('../src/agents', () => ({
  AGENTS: fakes.agents,
  SERVER: 'pair',
  execProgram: vi.fn(),
  which: vi.fn((...[, name]: [unknown, string]) => fakes.programs.get(name)),
}));

/** The host the starter is given. */
const host: Host = { home: '/home/me', env: {}, platform: 'linux', exec: () => Promise.resolve() };

/** Returns the platform Node reports, and sets it for a case. */
function onPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

/** The platform this runs on, put back after each case. */
const realPlatform = process.platform;

/** Returns the agent faked with `id`. */
function agent(id: string): (typeof fakes.agents)[number] {
  const found = fakes.agents.find((a) => a.id === id);
  if (found === undefined) {
    throw new Error(`No agent ${id}.`);
  }
  return found;
}

/** Closes `terminal`, as VS Code tells its listeners. */
function close(terminal: unknown): void {
  for (const listener of fakes.closeListeners) {
    listener(terminal);
  }
}

/** Returns a starter on the fake host, with the window's folders. */
function starter(): ReturnType<typeof claudeStarter> {
  return claudeStarter(LAUNCHER, host);
}

/** Lets the starter's promises settle. */
function settle(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

beforeEach(() => {
  fakes.folders = [{ uri: { fsPath: FOLDER } }];
});

afterEach(() => {
  onPlatform(realPlatform);
  fakes.terminals.length = 0;
  fakes.closeListeners.clear();
  fakes.picked = undefined;
  fakes.offered.length = 0;
  fakes.errors.length = 0;
  fakes.infos.length = 0;
  fakes.clipboard.length = 0;
  fakes.programs.clear();
  vi.resetAllMocks();
});

describe('writeLauncher', () => {
  it("writes a sh launcher that runs this version's relay with VS Code's runtime, quoted, and makes it executable", () => {
    onPlatform('darwin');
    const launcher = writeLauncher("/ext it's");
    expect(launcher).toBe(path.join(PAIR_HOME, 'bin', 'pair-mcp'));
    expect(mkdirSync).toHaveBeenCalledWith(path.join(PAIR_HOME, 'bin'), { recursive: true });
    const relay = path.join("/ext it's", 'dist', 'relay.js').replaceAll("'", "'\\''");
    expect(vi.mocked(writeFileSync).mock.calls).toEqual([
      [launcher, `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec '${process.execPath.replaceAll("'", "'\\''")}' '${relay}' "$@"\n`],
    ]);
    expect(chmodSync).toHaveBeenCalledWith(launcher, 0o755);
  });

  it('writes a .cmd launcher on Windows, its percent signs doubled', () => {
    onPlatform('win32');
    const launcher = writeLauncher('C:\\ext\\100%');
    expect(launcher).toBe(path.join(PAIR_HOME, 'bin', 'pair-mcp.cmd'));
    const [, text] = vi.mocked(writeFileSync).mock.calls[0] ?? [];
    expect(text).toBe(
      `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${process.execPath.replaceAll('%', '%%')}" "${path.join('C:\\ext\\100%', 'dist', 'relay.js').replaceAll('%', '%%')}" %*\r\n`,
    );
    expect(chmodSync).not.toHaveBeenCalled();
  });

  it("says so, and goes on, when the launcher can't be written, with the failure's text, an Error or not (#9)", () => {
    vi.mocked(mkdirSync).mockImplementationOnce(() => {
      throw new Error('EACCES');
    });
    expect(writeLauncher(EXTENSION)).toMatch(/pair-mcp(\.cmd)?$/);
    vi.mocked(writeFileSync).mockImplementationOnce(() => {
      // A value that is not an Error, as a library may throw.
      // oxlint-disable-next-line no-throw-literal, only-throw-error
      throw 'disk full';
    });
    writeLauncher(EXTENSION);
    expect(fakes.errors).toEqual([
      expect.stringMatching(/^AI Pair couldn't write its launcher at .*, so agents can't start it: EACCES$/),
      expect.stringMatching(/: disk full$/),
    ]);
  });
});

describe('setUpAgent', () => {
  it("offers each agent, marked set up or installed, ticking the installed ones it isn't set up in yet, and another", async () => {
    agent('claude').isSetUp.mockReturnValue(true);
    agent('claude').detect.mockReturnValue(true);
    agent('codex').detect.mockReturnValue(true);
    await setUpAgent(LAUNCHER);
    expect(fakes.offered[0]).toEqual([
      { id: 'claude', label: 'Claude Code', description: 'set up', picked: false },
      { id: 'codex', label: 'Codex', description: 'installed', picked: true },
      { id: 'gemini', label: 'Gemini CLI', description: undefined, picked: false },
      { id: 'other', label: 'Another agent', description: 'Copy an MCP server configuration to the clipboard' },
    ]);
  });

  it('does nothing when the programmer picks none, or closes the picker', async () => {
    fakes.picked = [];
    await setUpAgent(LAUNCHER);
    fakes.picked = undefined;
    await setUpAgent(LAUNCHER);
    expect([fakes.infos, fakes.errors, agent('codex').setUp.mock.calls]).toEqual([[], [], []]);
  });

  it('sets up each agent picked, says which, and shows what went wrong with one, an Error or not', async () => {
    fakes.picked = [{ id: 'claude' }, { id: 'codex' }, { id: 'gemini' }];
    agent('codex').setUp.mockRejectedValueOnce(new Error('config.toml is read-only'));
    agent('gemini').setUp.mockRejectedValueOnce('no home');
    await setUpAgent(LAUNCHER);
    expect(fakes.errors).toEqual(["Couldn't set up Codex: config.toml is read-only", "Couldn't set up Gemini CLI: no home"]);
    expect(fakes.infos).toEqual(["Set up Claude Code. Restart it, then ask it to pair in a folder that's open here."]);
    fakes.picked = [{ id: 'claude' }, { id: 'codex' }, { id: 'gemini' }];
    fakes.infos.length = 0;
    await setUpAgent(LAUNCHER);
    expect(fakes.infos).toEqual([
      "Set up Claude Code, Codex and Gemini CLI. Restart it, then ask it to pair in a folder that's open here.",
    ]);
  });

  it('copies a configuration for another agent to the clipboard', async () => {
    fakes.picked = [{ id: 'other' }];
    await setUpAgent(LAUNCHER);
    expect(fakes.clipboard.map((text): unknown => JSON.parse(text))).toEqual([{ mcpServers: { pair: { command: LAUNCHER, args: [] } } }]);
    expect(fakes.infos).toEqual([`Copied. Add it to your agent's MCP configuration: a stdio server named "pair" running ${LAUNCHER}.`]);
  });
});

describe('claudeStarter', () => {
  it('GroundedProp: offers the button only once Claude Code is set up, its CLI is here, and a folder is open', async () => {
    const offered = starter();
    expect(await offered.available()).toBe(false);
    fakes.programs.set('claude', '/home/me/.local/bin/claude');
    expect(await offered.available()).toBe(false);
    agent('claude').isSetUp.mockReturnValue(true);
    expect(await offered.available()).toBe(true);
    fakes.folders = undefined;
    expect(await offered.available()).toBe(false);
  });

  it('GroundedProp: offers nothing with no Claude Code among the agents', async () => {
    const claude = fakes.agents.shift();
    fakes.programs.set('claude', '/home/me/.local/bin/claude');
    expect(await starter().available()).toBe(false);
    if (claude) {
      fakes.agents.unshift(claude);
    }
  });

  it('RunsAreClicks, StartsProp, StaysOnPair, KeepsLocation: runs the CLI with the prompt in a terminal it never shows, once per start', () => {
    fakes.programs.set('claude', '/home/me/.local/bin/claude');
    void starter().start();
    expect(fakes.terminals.map((terminal) => terminal.options)).toEqual([
      { name: START_TERMINAL, shellPath: '/home/me/.local/bin/claude', shellArgs: START_ARGS, cwd: FOLDER, isTransient: true },
    ]);
    expect(START_ARGS).toEqual(['-p', START_PROMPT, '--allowedTools', 'mcp__pair']);
  });

  it("OneAtATime, Closes: starts no second agent while the first one's terminal is open, and starts again once it closes", () => {
    fakes.programs.set('claude', '/home/me/.local/bin/claude');
    const started = starter();
    void started.start();
    void started.start();
    expect(fakes.terminals).toHaveLength(1);
    close({ name: 'another terminal' });
    void started.start();
    expect(fakes.terminals).toHaveLength(1);
    close(fakes.terminals[0]);
    void started.start();
    expect(fakes.terminals).toHaveLength(2);
  });

  it("Settles: resolves a start once its agent's terminal closes, a refused start with it, and one that runs nothing at once", async () => {
    const started = starter();
    await started.start();
    fakes.programs.set('claude', '/home/me/.local/bin/claude');
    fakes.folders = [];
    await started.start();
    expect(fakes.terminals).toHaveLength(0);
    fakes.folders = [{ uri: { fsPath: FOLDER } }];
    const ended: string[] = [];
    void started.start().then(() => {
      ended.push('first');
    });
    void started.start().then(() => {
      ended.push('refused');
    });
    await settle();
    expect(ended).toEqual([]);
    close(fakes.terminals[0]);
    await settle();
    expect(ended).toEqual(['first', 'refused']);
  });

  it('stops listening for closed terminals once it is disposed, and looks in the folders it is given', () => {
    const given = claudeStarter(LAUNCHER, host, () => ['/elsewhere']);
    fakes.programs.set('claude', '/home/me/.local/bin/claude');
    void given.start();
    expect(fakes.terminals[0]?.options.cwd).toBe('/elsewhere');
    given.dispose();
    expect(fakes.closeListeners.size).toBe(0);
  });
});
