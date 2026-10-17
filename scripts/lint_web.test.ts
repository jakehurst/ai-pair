// The panel's HTML and CSS lint on its own (#176): what it runs, and what fails it. Solitary: esbuild,
// html-validate, Stylelint, vnu (through node:child_process), the file system, and the page bundle are fakes;
// the script runs afresh on each import.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { build } from 'esbuild';
import { HtmlValidate } from 'html-validate/node';
import stylelint from 'stylelint';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

/** What the fakes answer, made before the `vi.mock` factories run. */
const fakes = vi.hoisted(() => {
  /** The bundle of panel_html.ts, as the script imports it. */
  const bundle: object = { panelHtml: (csp: string, css: string, js: string) => `<page ${csp} ${css} ${js}>` };
  return {
    bundle,
    /** html-validate's answer about the page. */
    valid: true,
    /** The formatter's text for html-validate's results. */
    formatted: 'html-validate says no\n',
  };
});

/** Returns Stylelint's result: whether it found errors, and its report. */
function linted(errored: boolean, report: string): Awaited<ReturnType<typeof stylelint.lint>> {
  return { errored, report, cwd: '/', results: [], reportedDisables: [], ruleMetadata: {} };
}

/** Where the fake mkdtempSync puts the bundle. */
const BUNDLE_DIR = '/tmp/lint_web-fake';

vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }));
vi.mock('node:fs', () => ({ mkdtempSync: vi.fn(), readFileSync: vi.fn(), rmSync: vi.fn() }));
vi.mock('node:os', () => ({ tmpdir: () => '/tmp' }));
// The bundle is imported by its path, which the bundle's mock below is registered under.
vi.mock('node:url', () => ({ pathToFileURL: (file: string) => ({ href: file }) }));
vi.mock('esbuild', () => ({ build: vi.fn(() => Promise.resolve({})) }));
vi.mock('html-validate/node', () => ({
  FileSystemConfigLoader: class {
    readonly from = 'the file system';
  },
  HtmlValidate: vi.fn(
    class {
      validateString = vi.fn(() => Promise.resolve({ valid: fakes.valid, results: ['a result'] }));
    },
  ),
  formatterFactory: () => () => fakes.formatted,
}));
vi.mock('stylelint', () => ({ default: { lint: vi.fn() } }));
vi.mock('./stylelint.config.ts', () => ({ config: { rules: 'the config' } }));
vi.mock('/tmp/lint_web-fake/panelHtml.mjs', () => fakes.bundle);

/** What the script printed, and its exit code. */
interface Ran {
  stderr: string;
  errors: string[];
  exitCode: number | undefined;
}

/** Runs the script, as `npm run lint:web` does, and returns what it printed and its exit code. */
async function ran(): Promise<Ran> {
  let stderr = '';
  const errors: string[] = [];
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
    stderr += String(chunk);
    return true;
  });
  vi.spyOn(console, 'error').mockImplementation((line: string) => {
    errors.push(line);
  });
  process.exitCode = undefined;
  vi.resetModules();
  await import('./lint_web.ts');
  const { exitCode } = process;
  process.exitCode = undefined;
  return { stderr, errors, exitCode: exitCode === undefined ? undefined : Number(exitCode) };
}

/** Returns what spawnSync gives for a run of java that ended with `status`, or that could not start. */
function spawned(status: number | undefined, stderr: string, error?: Error): ReturnType<typeof spawnSync> {
  // Node's type spells a missing status and signal as `null`, as spawnSync gives them.
  // oxlint-disable-next-line unicorn/no-null
  return { status: status ?? null, signal: null, stderr, stdout: '', pid: 1, output: [], ...(error === undefined ? {} : { error }) };
}

/** Makes vnu answer `status`, for the page first and then the stylesheet. */
function vnuAnswers(page: number, stylesheet: number): void {
  vi.mocked(spawnSync).mockReturnValueOnce(spawned(page, 'vnu page\n')).mockReturnValueOnce(spawned(stylesheet, 'vnu css\n'));
}

beforeEach(() => {
  fakes.valid = true;
  vi.mocked(mkdtempSync).mockReturnValue(BUNDLE_DIR);
  vi.mocked(readFileSync).mockImplementation((file) => (String(file) === '.prettierrc.json' ? '{ "printWidth": 20 }' : 'short\nshort'));
  vi.mocked(stylelint.lint).mockResolvedValue(linted(false, 'stylelint ok\n'));
  vnuAnswers(0, 0);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

it('passes a page and a stylesheet every checker passes, rendering the page from a bundle it then removes', async () => {
  const result = await ran();
  expect(result).toEqual({ stderr: 'stylelint ok\nvnu page\nvnu css\n', errors: [], exitCode: undefined });
  expect(vi.mocked(build).mock.lastCall?.[0]).toMatchObject({
    entryPoints: ['packages/vscode/src/panel_html.ts'],
    outfile: `${BUNDLE_DIR}/panelHtml.mjs`,
  });
  expect(vi.mocked(rmSync).mock.lastCall).toEqual([BUNDLE_DIR, { recursive: true, force: true }]);
  const page =
    '<page https://*.vscode-cdn.net https://file.vscode-resource.vscode-cdn.net/dist/panel.css https://file.vscode-resource.vscode-cdn.net/dist/panel.js>';
  expect(vi.mocked(spawnSync).mock.calls).toEqual([
    ['java', ['-jar', 'node_modules/vnu-jar/build/dist/vnu.jar', '--Werror', '--format', 'gnu', '-'], { input: page, encoding: 'utf8' }],
    [
      'java',
      [
        '-jar',
        'node_modules/vnu-jar/build/dist/vnu.jar',
        '--Werror',
        '--format',
        'gnu',
        '--css',
        '--filterpattern',
        '.*mask.*radial-gradient.*',
        'packages/vscode/src/webview/panel.css',
      ],
      { input: undefined, encoding: 'utf8' },
    ],
  ]);
  expect(vi.mocked(stylelint.lint).mock.lastCall?.[0]).toEqual({
    config: { rules: 'the config' },
    files: 'packages/vscode/src/webview/panel.css',
    formatter: 'string',
  });
  expect(HtmlValidate).toHaveBeenCalledOnce();
});

it('fails on what Stylelint finds', async () => {
  vi.mocked(stylelint.lint).mockResolvedValueOnce(linted(true, 'stylelint says no\n'));
  expect(await ran()).toMatchObject({ exitCode: 1 });
});

it('fails on what html-validate finds, printing its report', async () => {
  fakes.valid = false;
  const result = await ran();
  expect(result.stderr).toContain('html-validate says no\n');
  expect(result.exitCode).toBe(1);
});

it.each([
  { name: 'the page', page: 1, stylesheet: 0 },
  { name: 'the stylesheet', page: 0, stylesheet: 1 },
])('fails when vnu finds fault with $name', async ({ page, stylesheet }) => {
  vi.mocked(spawnSync).mockReset();
  vnuAnswers(page, stylesheet);
  expect(await ran()).toMatchObject({ exitCode: 1 });
});

it("fails on a line of panel_html.ts past Prettier's print width, which Prettier can't wrap in a template", async () => {
  vi.mocked(readFileSync).mockImplementation((file) =>
    String(file) === '.prettierrc.json' ? '{ "printWidth": 20 }' : 'short\nthis line is longer than twenty',
  );
  const result = await ran();
  expect(result.errors).toEqual(['packages/vscode/src/panel_html.ts:2: over 20 columns']);
  expect(result.exitCode).toBe(1);
});

it.each(['null', '{}', '{ "printWidth": "80" }'])('stops when .prettierrc.json is %s, with no print width', async (prettier) => {
  vi.mocked(readFileSync).mockImplementation((file) => (String(file) === '.prettierrc.json' ? prettier : ''));
  await expect(ran()).rejects.toThrow('.prettierrc.json has no printWidth.');
});

it('stops when java cannot run', async () => {
  vi.mocked(spawnSync).mockReset();
  vi.mocked(spawnSync).mockReturnValue(spawned(undefined, '', new Error('spawn java ENOENT')));
  await expect(ran()).rejects.toThrow('spawn java ENOENT');
});

it.each([
  { name: 'has no panelHtml', bundle: {} },
  { name: 'has a panelHtml that is no function', bundle: { panelHtml: 'page' } },
])('stops, and still removes the bundle, when the bundle $name', async ({ bundle }) => {
  const kept = fakes.bundle;
  fakes.bundle = bundle;
  vi.doMock('/tmp/lint_web-fake/panelHtml.mjs', () => bundle);
  try {
    await expect(ran()).rejects.toThrow('packages/vscode/src/panel_html.ts bundled with no panelHtml export.');
    expect(rmSync).toHaveBeenCalledWith(BUNDLE_DIR, { recursive: true, force: true });
  } finally {
    fakes.bundle = kept;
    vi.doMock('/tmp/lint_web-fake/panelHtml.mjs', () => kept);
  }
});
