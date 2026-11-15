import { isAbsolute } from 'node:path';
import type { AudioAdapter } from './index';
import { LinuxBackend } from './linux_backend';
import { NativeAdapter } from './native_adapter';
import { VerifiedBackend } from './verified_backend';

/** Called by the local companion and the main extension's default output (#82, #84); unpackaged platforms fail closed. */
export function createLocalAudioAdapter(extensionRoot: string): AudioAdapter {
  if (isAbsolute(extensionRoot) && process.platform === 'linux') return new NativeAdapter(new LinuxBackend());
  return new NativeAdapter(new VerifiedBackend(extensionRoot, process.platform, process.arch));
}
