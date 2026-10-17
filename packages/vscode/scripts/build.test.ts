// The extension's build script on its own (#176): what it bundles, how `--production` changes that, and the
// manifest it refuses. Solitary: esbuild and the file system are fakes; the script runs afresh on each import.

import * as fs from 'node:fs';
import * as esbuild from 'esbuild';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('node:fs', () => ({ copyFileSync: vi.fn(), readFileSync: vi.fn(), rmSync: vi.fn() }));
vi.mock('esbuild', () => ({ build: vi.fn(() => Promise.resolve({})) }));

/** Runs the script, as `npm run build` does, with `args`. */
async function built(args: readonly string[] = []): Promise<void> {
  process.argv = ['node', 'scripts/build.mts', ...args];
  vi.resetModules();
  await import('./build.mts');
}

/** Returns the options of each esbuild run, in order. */
function builds(): esbuild.BuildOptions[] {
  return vi.mocked(esbuild.build).mock.calls.map(([options]) => options);
}

beforeEach(() => {
  vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ version: '1.2.3' }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

it('bundles the extension, the page script, the page styles, and the relay, with source maps and unminified', async () => {
  await built();
  expect(fs.rmSync).not.toHaveBeenCalled();
  expect(fs.copyFileSync).not.toHaveBeenCalled();
  expect(fs.readFileSync).toHaveBeenCalledWith('package.json', 'utf8');
  const common = {
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    minify: false,
    sourcemap: true,
    logLevel: 'warning',
    mainFields: ['module', 'main'],
  };
  expect(builds()).toEqual([
    { ...common, entryPoints: ['src/extension.ts'], external: ['vscode'], outfile: 'dist/extension.js' },
    {
      bundle: true,
      platform: 'browser',
      format: 'iife',
      target: 'es2025',
      minify: false,
      sourcemap: true,
      logLevel: 'warning',
      entryPoints: ['src/webview/panel.ts'],
      outfile: 'dist/panel.js',
    },
    { minify: false, logLevel: 'warning', entryPoints: ['src/webview/panel.css'], outfile: 'dist/panel.css' },
    {
      ...common,
      entryPoints: ['../relay/src/main.ts'],
      loader: { '.md': 'text' },
      define: { AI_PAIR_VERSION: '"1.2.3"' },
      outfile: 'dist/relay.js',
    },
  ]);
});

it('with --production, empties dist, copies the license in, and minifies without source maps', async () => {
  await built(['--production']);
  expect(fs.rmSync).toHaveBeenCalledWith('dist', { recursive: true, force: true });
  expect(fs.copyFileSync).toHaveBeenCalledWith('../../LICENSE', 'LICENSE');
  for (const options of builds()) {
    expect(options.minify).toBe(true);
    expect(options.sourcemap ?? false).toBe(false);
  }
});

it('refuses a manifest without a version string, before bundling the relay', async () => {
  for (const manifest of ['null', '"text"', '{}', '{ "version": 1 }']) {
    vi.mocked(esbuild.build).mockClear();
    vi.mocked(fs.readFileSync).mockReturnValue(manifest);
    await expect(built()).rejects.toThrow('package.json has no version.');
    expect(esbuild.build).toHaveBeenCalledTimes(3);
  }
});
