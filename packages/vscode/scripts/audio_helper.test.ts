// The Mac audio-helper stager on its own (#82): the compiler, the file system and the asset stager are fakes.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { stageAssets } from '../../audio-native/src/stage.ts';
import { stageAudioHelper } from './audio_helper.mts';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));
vi.mock('node:fs', () => ({ mkdtempSync: vi.fn(() => '/tmp/ai-pair-audio-1'), rmSync: vi.fn() }));
vi.mock('../../audio-native/src/stage.ts', () => ({ stageAssets: vi.fn(() => Promise.resolve()) }));

beforeEach(() => {
  vi.mocked(mkdtempSync).mockReturnValue('/tmp/ai-pair-audio-1');
  vi.mocked(stageAssets).mockResolvedValue();
});

afterEach(() => {
  vi.resetAllMocks();
});

it('compiles the helper for each Mac architecture and stages it with its manifest', async () => {
  expect(await stageAudioHelper('darwin', 'arm64')).toBe(true);
  expect(execFileSync).toHaveBeenCalledWith('xcrun', [
    'swiftc',
    '-O',
    '-target',
    'arm64-apple-macos13.0',
    '-framework',
    'AudioToolbox',
    '-framework',
    'CoreAudio',
    '../audio-native/native/macos/main.swift',
    '-o',
    '/tmp/ai-pair-audio-1/audio-darwin-arm64',
  ]);
  expect(stageAssets).toHaveBeenCalledWith('/tmp/ai-pair-audio-1', '.');
  expect(rmSync).toHaveBeenCalledWith('/tmp/ai-pair-audio-1', { recursive: true, force: true });
  expect(await stageAudioHelper('darwin', 'x64')).toBe(true);
  expect(vi.mocked(execFileSync).mock.calls[1]?.[1]).toContain('x86_64-apple-macos13.0');
});

it('ships no helper on other hosts or architectures', async () => {
  expect(await stageAudioHelper('linux', 'x64')).toBe(false);
  expect(await stageAudioHelper('darwin', 'ia32')).toBe(false);
  expect(typeof (await stageAudioHelper())).toBe('boolean');
  expect(execFileSync).toHaveBeenCalledTimes(process.platform === 'darwin' && ['arm64', 'x64'].includes(process.arch) ? 1 : 0);
});

it('fails a Mac build whose helper does not compile, and still removes the build folder', async () => {
  vi.mocked(execFileSync).mockImplementation(() => {
    throw new Error('swiftc failed');
  });
  await expect(stageAudioHelper('darwin', 'arm64')).rejects.toThrow('swiftc failed');
  expect(stageAssets).not.toHaveBeenCalled();
  expect(rmSync).toHaveBeenCalledOnce();
});
