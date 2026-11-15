// Builds the macOS CoreAudio helper for this host's architecture and stages it with its digest manifest (#82).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { stageAssets } from '../../audio-native/src/stage.ts';

/** The Swift target triple for each architecture a Mac build packages. */
const TARGETS = new Map([
  ['arm64', 'arm64-apple-macos13.0'],
  ['x64', 'x86_64-apple-macos13.0'],
]);

/**
 * Compiles `audio-darwin-<arch>` into `dist/audio-native` with its manifest on a
 * Mac, and returns whether it did. Other hosts ship no helper and keep the
 * webview output; a Mac build that cannot compile it fails.
 */
export async function stageAudioHelper(platform: string = process.platform, arch: string = process.arch): Promise<boolean> {
  const target = TARGETS.get(arch);
  if (platform !== 'darwin' || target === undefined) return false;
  const build = mkdtempSync(path.join(tmpdir(), 'ai-pair-audio-'));
  try {
    execFileSync('xcrun', [
      'swiftc',
      '-O',
      '-target',
      target,
      '-framework',
      'AudioToolbox',
      '-framework',
      'CoreAudio',
      '../audio-native/native/macos/main.swift',
      '-o',
      path.join(build, `audio-darwin-${arch}`),
    ]);
    await stageAssets(build, '.');
  } finally {
    rmSync(build, { recursive: true, force: true });
  }
  return true;
}
