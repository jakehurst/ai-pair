// The release script on its own (#176): each check that stops it, the tag it pushes, and how it undoes a push
// that fails. Solitary: git (through node:child_process), the files, and the prompt are fakes; the script runs
// afresh on each import.

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** The programmer's answer to the tag prompt, and the question asked, made before the `vi.mock` factories run. */
const prompt = vi.hoisted(() => ({ answer: 'y', question: '' }));

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));
vi.mock('node:fs', () => ({ readFileSync: vi.fn() }));
vi.mock('node:readline/promises', () => ({
  createInterface: () => ({
    question: (question: string) => {
      prompt.question = question;
      return Promise.resolve(prompt.answer);
    },
    close: () => {},
  }),
}));

/** The repository the fakes describe. */
interface World {
  manifest: string;
  companion: string;
  changelog: string;
  branch: string;
  status: string;
  head: string;
  origin: string;
  tags: string;
  /** Commands that fail, by their command and first argument, like `git push`. */
  failing: Set<string>;
}

/** The manifest of the extension, as the fakes give it. */
const MANIFEST = JSON.stringify({ publisher: 'pub', name: 'ai-pair', version: '1.2.4' });

/** The manifest of the companion, as the fakes give it. */
const COMPANION = JSON.stringify({ publisher: 'pub', name: 'ai-pair-local-audio', version: '1.2.4' });

/** A changelog with a section for 1.2.4 and an empty one for 1.3.0. */
const CHANGELOG = '# Changelog\n\n## 1.3.0\n\n## 1.2.4\n\n- Fixed a thing.\n\n## 1.2.3\n\n- Older.\n';

/** What the fakes answer; each test starts from a release that goes through. */
let world: World;

/** Every command the script ran, as `cmd arg arg`. */
const ran: string[] = [];

/** Returns a world where the release of 1.2.4 goes through. */
function fresh(): World {
  return {
    manifest: MANIFEST,
    companion: COMPANION,
    changelog: CHANGELOG,
    branch: 'main\n',
    status: '',
    head: 'abc\n',
    origin: 'abc\n',
    tags: '',
    failing: new Set(),
  };
}

/** Answers a command as the world says: its output, or a throw for one that fails. */
function answer(cmd: string, args: readonly string[]): string {
  const line = [cmd, ...args].join(' ');
  ran.push(line);
  if (world.failing.has(`${cmd} ${args[0] ?? ''}`)) throw new Error(`${line} failed`);
  switch (line) {
    case 'git branch --show-current':
      return world.branch;
    case 'git status --porcelain':
      return world.status;
    case 'git rev-parse HEAD':
      return world.head;
    case 'git rev-parse origin/main':
      return world.origin;
    default:
      return line.startsWith('git tag --list') ? world.tags : '';
  }
}

/** Answers a file read as the world says: a manifest, by its folder, or the changelog. */
function file(name: string): string {
  if (name.endsWith('packages/vscode/package.json')) return world.manifest;
  return name.endsWith('package.json') ? world.companion : world.changelog;
}

/** What a run of the script printed, and whether it exited. */
interface Released {
  errors: string[];
  logs: string[];
  exit?: number;
}

/** Runs `npm run release -- <args>` against the world, and returns what it printed and its exit. */
async function release(...args: string[]): Promise<Released> {
  const errors: string[] = [];
  const logs: string[] = [];
  let exit: number | undefined;
  vi.spyOn(console, 'error').mockImplementation((line: string) => {
    errors.push(line);
  });
  vi.spyOn(console, 'log').mockImplementation((line: string) => {
    logs.push(line);
  });
  // An exit ends the script, as it does a process.
  vi.spyOn(process, 'exit').mockImplementation((code) => {
    exit = Number(code);
    throw new Error('exit');
  });
  const argv = process.argv;
  process.argv = ['node', 'scripts/release.ts', ...args];
  try {
    vi.resetModules();
    await import('./release.ts').catch(() => {});
  } finally {
    process.argv = argv;
  }
  return { errors, logs, exit };
}

/** Returns the reason a run stopped, as it printed it. */
function why(result: Released): string | undefined {
  return result.errors.at(-1)?.replace(/^\nFailed: /, '');
}

beforeEach(() => {
  world = fresh();
  prompt.answer = 'y';
  prompt.question = '';
  ran.length = 0;
  vi.mocked(execFileSync).mockImplementation((cmd, args) => answer(cmd, args ?? []));
  vi.mocked(fs.readFileSync).mockImplementation((name) => file(String(name)));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

describe('a release that goes through', () => {
  it('checks, asks, tags, and pushes only the tag, then says where publishing runs', async () => {
    const result = await release();
    expect(result.exit).toBeUndefined();
    expect(ran).toEqual([
      'git branch --show-current',
      'git status --porcelain',
      'git fetch --quiet --tags origin main',
      'git rev-parse HEAD',
      'git rev-parse origin/main',
      'git tag --list v1.2.4',
      'git tag -a v1.2.4 -m Release 1.2.4',
      'git push --quiet origin v1.2.4',
    ]);
    expect(prompt.question).toBe(
      "\nTag v1.2.4 and push it? That publishes pub.ai-pair and pub.ai-pair-local-audio 1.2.4 to the Marketplace; a version can't be published twice. [y/N] ",
    );
    expect(result.logs.slice(-2)).toEqual([
      '\nTagged 1.2.4. Publishing runs at https://github.com/mattyv/ai-pair/actions/workflows/publish.yml',
      'When it finishes: https://marketplace.visualstudio.com/items?itemName=pub.ai-pair',
    ]);
  });

  it('does not ask with --yes', async () => {
    const result = await release('--yes');
    expect(result.exit).toBeUndefined();
    expect(prompt.question).toBe('');
    expect(ran.at(-1)).toBe('git push --quiet origin v1.2.4');
  });
});

describe('what stops it before anything changes', () => {
  it('stops on an argument it does not know, such as a version to bump to', async () => {
    const result = await release('patch');
    expect(why(result)).toBe('Usage: npm run release [-- --yes]');
    expect(result.exit).toBe(1);
    expect(ran).toEqual([]);
  });

  it('stops on a manifest without its fields, or with a version that is not x.y.z', async () => {
    world.manifest = JSON.stringify({ publisher: 'pub', name: 'ai-pair' });
    expect(why(await release())).toBe('packages/vscode/package.json needs a publisher, a name, and a version.');
    world.manifest = MANIFEST;
    world.companion = JSON.stringify({ publisher: 'pub', version: '1.2.4' });
    expect(why(await release())).toBe('packages/audio-ui/package.json needs a publisher, a name, and a version.');
    world.manifest = JSON.stringify({ publisher: 'pub', name: 'ai-pair', version: 'one' });
    world.companion = COMPANION;
    expect(why(await release())).toBe('one is not an x.y.z version.');
  });

  it('stops on a companion at another version', async () => {
    world.companion = JSON.stringify({ publisher: 'pub', name: 'ai-pair-local-audio', version: '1.2.3' });
    const result = await release();
    expect(why(result)).toBe('ai-pair-local-audio is at 1.2.3, and ai-pair at 1.2.4: they release together.');
    expect(ran).toEqual([]);
  });

  it.each<{ name: string; change: Partial<World>; reason: string }>([
    { name: 'a branch other than main', change: { branch: 'feature\n' }, reason: 'Release from main.' },
    {
      name: 'a change not committed',
      change: { status: ' M packages/vscode/CHANGELOG.md\n?? notes.txt\n' },
      reason: 'Commit or stash these first:\n M packages/vscode/CHANGELOG.md\n?? notes.txt',
    },
    { name: 'main behind origin/main', change: { origin: 'def\n' }, reason: "main isn't the same as origin/main: pull first." },
    {
      name: 'a tag that exists',
      change: { tags: 'v1.2.4\n' },
      reason: 'v1.2.4 is already tagged: a change that ships bumps the version in its pull request.',
    },
    {
      name: 'no changelog section',
      change: { changelog: '## 1.2.3\n\n- Older.\n' },
      reason: 'packages/vscode/CHANGELOG.md has no section for 1.2.4: add "## 1.2.4" with what changed.',
    },
  ])('stops on $name', async ({ change, reason }) => {
    Object.assign(world, change);
    const result = await release();
    expect(why(result)).toBe(reason);
    expect(ran.some((line) => line.startsWith('git tag -a'))).toBe(false);
  });

  it('stops on an empty changelog section', async () => {
    world.manifest = JSON.stringify({ publisher: 'pub', name: 'ai-pair', version: '1.3.0' });
    world.companion = JSON.stringify({ publisher: 'pub', name: 'ai-pair-local-audio', version: '1.3.0' });
    expect(why(await release())).toBe('packages/vscode/CHANGELOG.md has no section for 1.3.0: add "## 1.3.0" with what changed.');
  });

  it('stops before tagging when the programmer says no', async () => {
    prompt.answer = ' N ';
    const result = await release();
    expect(why(result)).toBe('Not tagged.');
    expect(ran).not.toContain('git tag -a v1.2.4 -m Release 1.2.4');
  });
});

describe('a push that fails', () => {
  it('takes back the tag, since nothing has left this machine', async () => {
    world.failing.add('git push');
    const result = await release('--yes');
    expect(ran.slice(-2)).toEqual(['git push --quiet origin v1.2.4', 'git tag -d v1.2.4']);
    expect(why(result)).toBe('Pushing v1.2.4 failed; the tag is undone. Fix it, then: npm run release');
  });
});
