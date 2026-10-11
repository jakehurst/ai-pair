// The Claude Code starter (#107, #115): offered only when Claude Code is set up for the pair server, its
// CLI is here, and a folder is open; a start runs the CLI with the prompt in a terminal never shown,
// one agent at a time.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ok } from 'node:assert/strict';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Host } from '../src/agents';
import { claudeStarter, START_ARGS, START_PROMPT, START_TERMINAL } from '../src/setup';

/** A terminal the fake VS Code was asked to create. */
interface FakeTerminal {
  options: Record<string, unknown>;
  show: ReturnType<typeof vi.fn>;
}
/** The terminals the fake VS Code was asked to create. */
let created: FakeTerminal[] = [];
/** The fake's close listeners. */
let closeListeners: Array<(t: FakeTerminal) => void> = [];
/** The commands run through the fake. */
let executed: unknown[][] = [];
vi.mock('vscode', () => ({
  window: {
    createTerminal: (options: Record<string, unknown>) => {
      const t = { options, show: vi.fn() };
      created.push(t);
      return t;
    },
    onDidCloseTerminal: (listener: (t: FakeTerminal) => void) => {
      closeListeners.push(listener);
      return {
        dispose: () => {
          closeListeners = closeListeners.filter((l) => l !== listener);
        },
      };
    },
  },
  commands: {
    executeCommand: (...args: unknown[]) => {
      executed.push(args);
      return Promise.resolve();
    },
  },
}));

const LAUNCHER = '/home/me/.ai-pair/bin/pair-mcp';
const FOLDER = '/home/me/project';
let host: Host;
let folders: string[];

beforeEach(() => {
  created = [];
  closeListeners = [];
  executed = [];
  folders = [FOLDER];
  host = {
    home: fs.mkdtempSync(path.join(os.tmpdir(), 'ai-pair-start-')),
    env: { PATH: '' },
    platform: process.platform === 'win32' ? 'linux' : process.platform,
    exec: async () => {},
  };
});

/** Writes what Set Up Agent leaves in `.claude.json`: the pair server running the launcher. */
function setUp(): void {
  fs.writeFileSync(path.join(host.home, '.claude.json'), JSON.stringify({ mcpServers: { pair: { command: LAUNCHER } } }));
}
/** Puts Claude Code's CLI where its installer puts it. */
function installCli(): string {
  const bin = path.join(host.home, '.local', 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'claude'), '');
  return path.join(bin, 'claude');
}
function starterHere(): ReturnType<typeof claudeStarter> {
  return claudeStarter(LAUNCHER, host, () => folders);
}
function close(t: FakeTerminal): void {
  for (const listener of closeListeners) {
    listener(t);
  }
}

it('GroundedProp: offers the button only once Claude Code is set up, its CLI is here, and a folder is open', async () => {
  const starter = starterHere();
  expect(await starter.available()).toBe(false);
  installCli();
  expect(await starter.available()).toBe(false);
  setUp();
  expect(await starter.available()).toBe(true);
  folders = [];
  expect(await starter.available()).toBe(false);
});

it("RunsAreClicks, StartsProp, StaysOnPair, KeepsLocation: runs the CLI with the prompt in a terminal it never shows, once per start, without Claude Code's open command", async () => {
  const cli = installCli();
  setUp();
  void starterHere().start();
  const first = created[0];
  ok(first);
  expect(created).toHaveLength(1);
  expect(first.options).toEqual({ name: START_TERMINAL, shellPath: cli, shellArgs: START_ARGS, cwd: FOLDER, isTransient: true });
  expect(START_ARGS).toEqual(['-p', START_PROMPT, '--allowedTools', 'mcp__pair']);
  expect(first.show).not.toHaveBeenCalled();
  expect(executed).toEqual([]);
});

it("OneAtATime, Closes: starts no second agent while the first one's terminal is open, and starts again once it closes", async () => {
  installCli();
  setUp();
  const starter = starterHere();
  void starter.start();
  void starter.start();
  const first = created[0];
  ok(first);
  expect(created).toHaveLength(1);
  close(first);
  void starter.start();
  expect(created).toHaveLength(2);
});

it("Settles: resolves a start once its agent's terminal closes, a refused start with it, and a start that runs nothing at once", async () => {
  const starter = starterHere();
  await starter.start();
  expect(created).toHaveLength(0);
  installCli();
  setUp();
  const ended: string[] = [];
  void starter.start().then(() => {
    ended.push('first');
  });
  void starter.start().then(() => {
    ended.push('refused');
  });
  await new Promise((resolve) => {
    setTimeout(resolve);
  });
  expect(ended).toEqual([]);
  const first = created[0];
  ok(first);
  close(first);
  await new Promise((resolve) => {
    setTimeout(resolve);
  });
  expect(ended).toEqual(['first', 'refused']);
});
