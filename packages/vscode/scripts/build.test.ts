// The extension's build script on its own (#176): what it bundles, how `--production` changes that, and the
// manifest it refuses. Solitary: esbuild and the file system are fakes; the script runs afresh on each import.

import * as fs from 'node:fs';
import { createHash } from 'node:crypto';
import * as esbuild from 'esbuild';
import { stageSpeechRuntime } from './speech_runtime.mts';
import { stageAudioHelper } from './audio_helper.mts';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('node:fs', () => ({
  copyFileSync: vi.fn(),
  readFileSync: vi.fn(),
  rmSync: vi.fn(),
  readdirSync: vi.fn((directory: string) =>
    directory === 'dist/speech'
      ? [
          { name: 'worker.mjs', isDirectory: () => false, isFile: () => true },
          { name: 'tempo_worker.mjs', isDirectory: () => false, isFile: () => true },
          { name: 'node_modules', isDirectory: () => true, isFile: () => false },
          { name: 'link', isDirectory: () => false, isFile: () => false },
        ]
      : [{ name: 'native.node', isDirectory: () => false, isFile: () => true }],
  ),
}));
vi.mock('./speech_runtime.mts', () => ({ stageSpeechRuntime: vi.fn() }));
vi.mock('./audio_helper.mts', () => ({ stageAudioHelper: vi.fn(() => Promise.resolve(false)) }));
vi.mock('esbuild', () => ({
  build: vi.fn(() => Promise.resolve({ outputFiles: [{ path: '/dist/extension.js', contents: Buffer.from('extension') }] })),
}));

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
  vi.mocked(stageSpeechRuntime).mockReturnValue(true);
  vi.mocked(stageAudioHelper).mockResolvedValue(false);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

it('bundles the extension, the page script, the page styles, and the relay, with source maps and unminified', async () => {
  await built();
  expect(fs.rmSync).not.toHaveBeenCalled();
  expect(stageSpeechRuntime).toHaveBeenCalledOnce();
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
  const relayHash = JSON.stringify(
    createHash('sha256')
      .update(JSON.stringify({ version: '1.2.3' }))
      .digest('hex'),
  );
  expect(fs.readFileSync).toHaveBeenCalledWith('dist/relay.js');
  expect(fs.readFileSync).toHaveBeenCalledWith('skills/ai-pair-demo/SKILL.md');
  expect(fs.readFileSync).toHaveBeenCalledWith('skills/ai-pair-diagnose/SKILL.md');
  const buildId = builds().at(-1)?.define?.AI_PAIR_BUILD_ID;
  expect(buildId).toMatch(/^"[a-f0-9]{16}"$/);
  expect(builds()).toEqual([
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
    {
      ...common,
      format: 'esm',
      entryPoints: ['src/speech_phonemizer_bridge.ts'],
      outfile: 'dist/speech/node_modules/phonemizer/index.mjs',
    },
    {
      ...common,
      format: 'esm',
      entryPoints: ['src/speech_worker.ts'],
      external: ['kokoro-js', '@huggingface/transformers', 'phonemizer'],
      outfile: 'dist/speech/worker.mjs',
    },
    {
      ...common,
      format: 'esm',
      entryPoints: ['src/speech_tempo_worker.ts'],
      outfile: 'dist/speech/tempo_worker.mjs',
    },
    {
      ...common,
      entryPoints: ['src/extension.ts'],
      external: ['vscode'],
      outfile: 'dist/extension.js',
      define: { AI_PAIR_VERSION: '"1.2.3"', AI_PAIR_BUILD_ID: '"pending"', AI_PAIR_RELAY_HASH: relayHash },
      write: false,
    },
    {
      ...common,
      entryPoints: ['src/extension.ts'],
      external: ['vscode'],
      outfile: 'dist/extension.js',
      define: { AI_PAIR_VERSION: '"1.2.3"', AI_PAIR_BUILD_ID: buildId, AI_PAIR_RELAY_HASH: relayHash },
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
    expect(esbuild.build).toHaveBeenCalledTimes(2);
  }
});

it('uses a stable build ID that changes with bundled content', async () => {
  await built();
  const first = builds().at(-1)?.define?.AI_PAIR_BUILD_ID;
  vi.mocked(esbuild.build).mockClear();
  await built();
  expect(builds().at(-1)?.define?.AI_PAIR_BUILD_ID).toBe(first);
  vi.mocked(esbuild.build).mockClear();
  vi.mocked(fs.readFileSync).mockReturnValue('changed bundle bytes');
  vi.mocked(fs.readFileSync).mockReturnValueOnce(JSON.stringify({ version: '1.2.3' }));
  await built();
  expect(builds().at(-1)?.define?.AI_PAIR_BUILD_ID).not.toBe(first);
});

it('distinguishes production and development builds of the same inputs', async () => {
  await built();
  const development = builds().at(-1)?.define?.AI_PAIR_BUILD_ID;
  vi.mocked(esbuild.build).mockClear();
  await built(['--production']);
  expect(builds().at(-1)?.define?.AI_PAIR_BUILD_ID).not.toBe(development);
});

it('changes the build ID when a nested staged runtime file changes', async () => {
  vi.mocked(fs.readFileSync).mockImplementation((file) =>
    String(file) === 'dist/speech/node_modules/native.node' ? 'first native runtime' : JSON.stringify({ version: '1.2.3' }),
  );
  await built();
  const first = builds().at(-1)?.define?.AI_PAIR_BUILD_ID;
  vi.mocked(esbuild.build).mockClear();
  vi.mocked(fs.readFileSync).mockImplementation((file) =>
    String(file) === 'dist/speech/node_modules/native.node' ? 'changed native runtime' : JSON.stringify({ version: '1.2.3' }),
  );
  await built();
  expect(builds().at(-1)?.define?.AI_PAIR_BUILD_ID).not.toBe(first);
});

it('keeps unsupported builds text-only without bundling the native bridge', async () => {
  vi.mocked(stageSpeechRuntime).mockReturnValue(false);
  await built();
  expect(stageSpeechRuntime).toHaveBeenCalledOnce();
  expect(builds().some((options) => options.outfile === 'dist/speech/node_modules/phonemizer/index.mjs')).toBe(false);
  expect(builds().some((options) => options.outfile === 'dist/speech/worker.mjs')).toBe(true);
});

it('does not read or follow a non-file entry in the staged runtime', async () => {
  await built();
  expect(fs.readFileSync).not.toHaveBeenCalledWith('dist/speech/link');
});

it('bundles the tempo worker into the hashed speech runtime', async () => {
  await built();
  expect(builds()).toContainEqual(
    expect.objectContaining({ entryPoints: ['src/speech_tempo_worker.ts'], outfile: 'dist/speech/tempo_worker.mjs' }),
  );
});

it('changes the build ID when the staged tempo worker changes', async () => {
  vi.mocked(fs.readFileSync).mockImplementation((file) =>
    String(file) === 'dist/speech/tempo_worker.mjs' ? 'first tempo worker' : JSON.stringify({ version: '1.2.3' }),
  );
  await built();
  const first = builds().at(-1)?.define?.AI_PAIR_BUILD_ID;
  vi.mocked(esbuild.build).mockClear();
  vi.mocked(fs.readFileSync).mockImplementation((file) =>
    String(file) === 'dist/speech/tempo_worker.mjs' ? 'changed tempo worker' : JSON.stringify({ version: '1.2.3' }),
  );
  await built();
  expect(builds().at(-1)?.define?.AI_PAIR_BUILD_ID).not.toBe(first);
});

it('hashes the staged Mac audio helper into the build identity (#82)', async () => {
  vi.mocked(stageAudioHelper).mockResolvedValue(true);
  await built();
  expect(stageAudioHelper).toHaveBeenCalledOnce();
  expect(fs.readdirSync).toHaveBeenCalledWith('dist/audio-native', { withFileTypes: true });
});
