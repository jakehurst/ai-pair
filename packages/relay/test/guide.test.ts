// The guides `start` reads (#23, specs/ProjectGuide.tla): the user's, then every project guide from
// the workspace folder down to the working directory, outer first, never one above the folder.
// Solitary: the disk and git are mocks, so each test says which files exist, what they hold, and
// what git answers.

import * as childProcess from 'node:child_process';
import * as path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { gitIgnores, GUIDE_FILE, MAX_GUIDE, projectGuides, readGuides, renderGuides } from '../src/guide';

/** The mocked disk: each file's text by its path, and the exit status `git check-ignore` answers with. */
const disk = vi.hoisted(() => ({ files: new Map<string, string>(), gitStatus: 1 }));

vi.mock('node:fs', () => ({
  existsSync: (file: string) => disk.files.has(file),
  readFileSync: (file: string) => {
    const text = disk.files.get(file);
    if (text === undefined) throw new Error(`ENOENT: no such file, open '${file}'`);
    return text;
  },
}));

vi.mock('node:child_process', () => ({ spawnSync: vi.fn(() => ({ status: disk.gitStatus })) }));

/** Returns the guide's path in `dir`, after putting it on the mocked disk with `text`. */
function guide(dir: string, text = 'rules'): string {
  const file = path.join(dir, GUIDE_FILE);
  disk.files.set(file, text);
  return file;
}

/** A fake `ignored` check: git ignores nothing. */
function ignoresNone(): boolean {
  return false;
}

afterEach(() => {
  disk.files.clear();
  disk.gitStatus = 1;
  vi.clearAllMocks();
});

it('Exactly, OuterFirst, Contained: reads the guides from the workspace folder down to the working directory, outer first', () => {
  guide('/top');
  const outer = guide('/top/ws');
  guide('/top/ws/other');
  const inner = guide('/top/ws/app/src');
  expect(projectGuides('/top/ws/app/src/deep', '/top/ws', ignoresNone)).toEqual([outer, inner]);
  expect(projectGuides('/top/ws', '/top/ws', ignoresNone)).toEqual([outer]);
});

it('Exactly, Contained: leaves out a guide git ignores', () => {
  const outer = guide('/top/ws');
  const ignored = guide('/top/ws/app');
  const inner = guide('/top/ws/app/src');
  expect(projectGuides('/top/ws/app/src', '/top/ws', (file) => file === ignored)).toEqual([outer, inner]);
});

it("stops at the file system's root when `root` doesn't contain `cwd`", () => {
  const top = guide('/');
  const inner = guide('/top/app');
  expect(projectGuides('/top/app', '/elsewhere', ignoresNone)).toEqual([top, inner]);
});

it('asks git whether it ignores a file: exit 0 is ignored; 1, not; 128, outside a repository', () => {
  const file = path.join('/top/ws', GUIDE_FILE);
  for (const [status, ignored] of [
    [0, true],
    [1, false],
    [128, false],
  ] as const) {
    disk.gitStatus = status;
    expect(gitIgnores(file)).toBe(ignored);
  }
  expect(childProcess.spawnSync).toHaveBeenCalledWith('git', ['check-ignore', '-q', file], { cwd: '/top/ws/.ai-pair', stdio: 'ignore' });
});

it("puts the user's guide first, skips empty ones, and cuts a long one with a note", () => {
  disk.files.set('/home/GUIDE.md', 'everywhere');
  guide('/top/ws', '   \n');
  const long = guide('/top/ws/app', 'x'.repeat(MAX_GUIDE + 5));
  const guides = readGuides('/home', '/top/ws/app', '/top/ws');
  expect(guides.map((g) => g.file)).toEqual(['/home/GUIDE.md', long]);
  expect(guides[1]?.text).toMatch(/\[Cut: the file goes on for 5 more characters\.\]$/);
});

it('leaves out a guide it cannot read', () => {
  const project = guide('/top/ws');
  expect(readGuides('/home', '/top/ws', '/top/ws').map((g) => g.file)).toEqual([project]);
});

it('renders them after an introduction that says which takes precedence', () => {
  const text = renderGuides(
    [
      { file: '/home/GUIDE.md', text: 'a\n' },
      { file: '/ws/.ai-pair/GUIDE.md', text: 'b' },
    ],
    (f) => f,
  );
  expect(text).toBe(
    '# Project rules\n\nRules decided with the programmer in earlier sessions. Where they differ from the pairing guide, they take precedence, and a later file takes precedence over an earlier one.\n\n## From /home/GUIDE.md\n\na\n\n## From /ws/.ai-pair/GUIDE.md\n\nb',
  );
});
