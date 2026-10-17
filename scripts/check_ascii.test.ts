// The ASCII check on its own (#176): what it reports for the files git tracks. Solitary: git and the files are
// fakes, through node:child_process and node:fs; the script runs afresh on each import.

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));
vi.mock('node:fs', () => ({ existsSync: vi.fn(), readFileSync: vi.fn() }));

// Characters outside ASCII, from their code points, so this file stays ASCII.
const E_ACUTE = String.fromCodePoint(0xe9);
const Y_DIAERESIS = String.fromCodePoint(0xff);
const EM_DASH = String.fromCodePoint(0x2014);
const GRINNING_FACE = String.fromCodePoint(0x1f600);
const BOX_HORIZONTAL = String.fromCodePoint(0x2500);
const BOX_VERTICAL = String.fromCodePoint(0x2502);
const RIGHT_TRIANGLE = String.fromCodePoint(0x25b6);

/** The repository's files as the fakes give them, by their path from the root. */
const files = new Map<string, string>();

/** Runs the script, as `npm run check:ascii` does, against `tracked`, and returns what it printed and its exit. */
async function checked(tracked: Record<string, string | undefined>): Promise<{ errors: string[]; logs: string[]; exit?: number }> {
  files.clear();
  for (const [name, text] of Object.entries(tracked)) {
    if (text !== undefined) files.set(name, text);
  }
  vi.mocked(execFileSync).mockReturnValue(`${Object.keys(tracked).join('\0')}\0`);
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
  vi.resetModules();
  await import('./check_ascii.ts').catch(() => {});
  return { errors, logs, exit };
}

beforeEach(() => {
  vi.mocked(fs.existsSync).mockImplementation((file) => [...files.keys()].some((name) => String(file).endsWith(`/${name}`)));
  vi.mocked(fs.readFileSync).mockImplementation((file) => {
    const name = [...files.keys()].find((key) => String(file).endsWith(`/${key}`));
    if (name === undefined) throw new Error(`ENOENT: ${String(file)}`);
    return files.get(name) ?? '';
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

it('passes files that are ASCII, skipping the lock file, images, and files git tracks but the disk no longer has', async () => {
  const result = await checked({
    'a.ts': 'const a = 1;\n',
    'package-lock.json': `caf${E_ACUTE}`,
    'logo.png': Y_DIAERESIS,
    'shot.gif': Y_DIAERESIS,
    'gone.ts': undefined,
  });
  expect(result).toEqual({ errors: [], logs: ['1 files: ASCII, apart from what ALLOWED names.'], exit: undefined });
  expect(execFileSync).toHaveBeenCalledWith('git', ['ls-files', '-z'], expect.objectContaining({ encoding: 'utf8' }));
});

it('reports each character outside ASCII by file, line, column, and code point, and fails', async () => {
  const result = await checked({ 'notes.md': `plain\nan ${EM_DASH} dash, an ${GRINNING_FACE}\n` });
  expect(result.errors).toEqual([
    'notes.md:2:4: U+2014',
    'notes.md:2:15: U+1F600',
    '\n2 characters outside ASCII. Write each as an escape in code, an entity in markup, or a word in prose.',
  ]);
  expect(result.exit).toBe(1);
});

it('lets a file hold the characters ALLOWED names for it, and only those', async () => {
  const result = await checked({
    'ARCHITECTURE.md': `a ${BOX_HORIZONTAL}${RIGHT_TRIANGLE} b\n`,
    'README.md': `a ${EM_DASH} b ${BOX_HORIZONTAL}${RIGHT_TRIANGLE} c${BOX_VERTICAL}\n`,
  });
  expect(result.errors).toEqual([
    'README.md:1:11: U+2502',
    '\n1 characters outside ASCII. Write each as an escape in code, an entity in markup, or a word in prose.',
  ]);
});
