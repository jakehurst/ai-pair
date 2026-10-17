// The release script on its own (#176): each check that stops it, the version it picks, and how it undoes or
// reports a step that fails. Solitary: git, vsce, gh, and npm (through node:child_process), the files, and the
// prompt are fakes; the script runs afresh on each import.

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** The programmer's answer to the publish prompt, made before the `vi.mock` factories run. */
const prompt = vi.hoisted(() => ({ answer: 'y' }));

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));
vi.mock('node:fs', () => ({ readFileSync: vi.fn() }));
vi.mock('node:readline/promises', () => ({
  createInterface: () => ({ question: () => Promise.resolve(prompt.answer), close: () => {} }),
}));

/** The repository and accounts the fakes describe. */
interface World {
  manifest: string;
  changelog: string;
  branch: string;
  status: string;
  head: string;
  origin: string;
  tags: string;
  publishers: string;
  staged: string;
  /** Commands that fail, by their command and first argument, like `vsce publish`. */
  failing: Set<string>;
}

/** The manifest of the extension, as the fakes give it. */
const MANIFEST = JSON.stringify({ publisher: 'pub', name: 'ai-pair', version: '1.2.3' });

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
    changelog: CHANGELOG,
    branch: 'main\n',
    status: ' M packages/vscode/CHANGELOG.md\n',
    head: 'abc\n',
    origin: 'abc\n',
    tags: '',
    publishers: 'other\npub\n',
    staged: 'packages/vscode/package.json\n',
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
    case 'git diff --cached --name-only':
      return world.staged;
    case 'vsce ls-publishers':
      return world.publishers;
    default:
      return line.startsWith('git tag --list') ? world.tags : '';
  }
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
  ran.length = 0;
  vi.mocked(execFileSync).mockImplementation((cmd, args) => answer(cmd, args ?? []));
  vi.mocked(fs.readFileSync).mockImplementation((file) => (String(file).endsWith('package.json') ? world.manifest : world.changelog));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

describe('a release that goes through', () => {
  it('checks, tests, bumps, builds, asks, commits, tags, publishes, pushes, and makes the GitHub release', async () => {
    const result = await release('patch');
    expect(result.exit).toBeUndefined();
    expect(ran).toEqual([
      'git branch --show-current',
      'git status --porcelain',
      'git fetch --quiet --tags origin main',
      'git rev-parse HEAD',
      'git rev-parse origin/main',
      'git tag --list v1.2.4',
      'vsce ls-publishers',
      'gh auth status',
      'npm test',
      'npm run typecheck',
      'npm run lint',
      'npm run format:check',
      'npm run lint:swift',
      'npm run typecheck:swift',
      'npm run lint:sh',
      'npm run lint:web',
      'npm run lint:md',
      'npm run test:integration',
      'npm version 1.2.4 -w packages/vscode --no-git-tag-version',
      'npm run package',
      'git add packages/vscode/package.json package-lock.json packages/vscode/CHANGELOG.md',
      'git diff --cached --name-only',
      'git commit --quiet -m Release 1.2.4',
      'git tag -a v1.2.4 -m Release 1.2.4',
      'vsce publish --packagePath ai-pair-1.2.4.vsix',
      'git push --quiet origin main v1.2.4',
      'gh release create v1.2.4 ai-pair-1.2.4.vsix --title 1.2.4 --notes - Fixed a thing.',
    ]);
    expect(result.logs.at(-1)).toBe('\nReleased 1.2.4: https://marketplace.visualstudio.com/items?itemName=pub.ai-pair');
  });

  it.each([
    { bump: 'minor', version: '1.3.0' },
    { bump: 'major', version: '2.0.0' },
    { bump: '1.4.0', version: '1.4.0' },
  ])('bumps $bump to $version', async ({ bump, version }) => {
    world.changelog = `## ${version}\n\n- New.\n`;
    await release(bump, '--yes');
    expect(ran).toContain(`npm version ${version} -w packages/vscode --no-git-tag-version`);
  });

  it('releases the current version as it is, for its first release, with nothing left to commit', async () => {
    world.changelog = '## 1.2.3\n\n- First.\n';
    world.staged = '';
    const result = await release('1.2.3', '--yes');
    expect(result.exit).toBeUndefined();
    expect(ran.some((line) => line.startsWith('npm version'))).toBe(false);
    expect(ran).not.toContain('git commit --quiet -m Release 1.2.3');
  });
});

describe('what stops it before anything changes', () => {
  it.each([
    { name: 'no version given', args: [], reason: 'Usage: npm run release -- patch | minor | major | <x.y.z> [--yes]' },
    { name: 'a word that is no bump', args: ['huge'], reason: 'Say which version: patch, minor, major, or an exact x.y.z.' },
    { name: 'a version older than the current', args: ['1.2.2'], reason: '1.2.2 is older than the current 1.2.3.' },
  ])('stops on $name', async ({ args, reason }) => {
    const result = await release(...args);
    expect(why(result)).toBe(reason);
    expect(result.exit).toBe(1);
  });

  it('stops on a manifest without its fields, or with a version that is not x.y.z', async () => {
    world.manifest = JSON.stringify({ publisher: 'pub', name: 'ai-pair' });
    expect(why(await release('patch'))).toBe('packages/vscode/package.json needs a publisher, a name, and a version.');
    world.manifest = JSON.stringify({ publisher: 'pub', name: 'ai-pair', version: 'one' });
    expect(why(await release('patch'))).toBe('one is not an x.y.z version.');
  });

  it.each<{ name: string; change: Partial<World>; reason: string }>([
    { name: 'a branch other than main', change: { branch: 'feature\n' }, reason: 'Release from main.' },
    {
      name: 'a change besides the changelog',
      change: { status: ' M packages/vscode/CHANGELOG.md\n?? notes.txt\n' },
      reason: 'Commit or stash these first; only packages/vscode/CHANGELOG.md may have changes:\n?? notes.txt',
    },
    { name: 'main behind origin/main', change: { origin: 'def\n' }, reason: "main isn't the same as origin/main: pull or push first." },
    { name: 'a tag that exists', change: { tags: 'v1.2.4\n' }, reason: 'v1.2.4 is already tagged.' },
    {
      name: 'no changelog section',
      change: { changelog: '## 1.2.3\n\n- Older.\n' },
      reason: 'packages/vscode/CHANGELOG.md has no section for 1.2.4: add "## 1.2.4" with what changed.',
    },
    {
      name: 'no token for the publisher',
      change: { publishers: 'other\n' },
      reason: 'vsce has no token for the publisher pub: run `vsce login pub`.',
    },
  ])('stops on $name', async ({ change, reason }) => {
    Object.assign(world, change);
    const result = await release('patch');
    expect(why(result)).toBe(reason);
    expect(ran.some((line) => line.startsWith('npm'))).toBe(false);
  });

  it('stops on an empty changelog section', async () => {
    expect(why(await release('minor'))).toBe('packages/vscode/CHANGELOG.md has no section for 1.3.0: add "## 1.3.0" with what changed.');
  });

  it('stops before publishing when the programmer says no, saying how to undo the bump', async () => {
    prompt.answer = ' N ';
    const result = await release('patch');
    expect(why(result)).toBe('Not published. To undo the bump: git checkout packages/vscode/package.json package-lock.json');
    expect(ran).not.toContain('vsce publish --packagePath ai-pair-1.2.4.vsix');
  });
});

describe('a step that fails after the build', () => {
  it('takes back the commit and tag when publishing fails, keeping the bump', async () => {
    world.failing.add('vsce publish');
    const result = await release('patch', '--yes');
    expect(ran.slice(-3)).toEqual(['vsce publish --packagePath ai-pair-1.2.4.vsix', 'git tag -d v1.2.4', 'git reset --soft HEAD~1']);
    expect(why(result)).toBe('Publishing failed; the commit and tag are undone, the bump is kept. Fix it, then: npm run release -- 1.2.4');
  });

  it('takes back only the tag when there was nothing to commit', async () => {
    world.failing.add('vsce publish');
    world.staged = '';
    await release('patch', '--yes');
    expect(ran.at(-1)).toBe('git tag -d v1.2.4');
  });

  it('says how to finish by hand when pushing or the GitHub release fails, once published', async () => {
    world.failing.add('git push');
    expect(why(await release('patch', '--yes'))).toBe(
      '1.2.4 is published, but pushing failed. Finish with:\n  git push origin main v1.2.4\n  gh release create v1.2.4 ai-pair-1.2.4.vsix --title 1.2.4 --notes-file <its changelog section>',
    );
    world.failing = new Set(['gh release']);
    expect(why(await release('patch', '--yes'))).toBe(
      '1.2.4 is published and pushed, but the GitHub release failed. Finish with:\n  gh release create v1.2.4 ai-pair-1.2.4.vsix --title 1.2.4 --notes-file <its changelog section>',
    );
  });
});
