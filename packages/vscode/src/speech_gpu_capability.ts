import { GpuProcessBusyError } from './speech_gpu_slot';
import * as path from 'node:path';
import type { GpuLaunchCapability } from './speech_gpu_client';
import type { CoreMlLaunch } from './speech_coreml';
import type { GpuCheck } from './speech_compute_types';
import { gpuEnvironment } from './speech_gpu_environment';
import { checkGpuSetup, type GpuSetupDependencies } from './speech_gpu_setup';
import type { GpuProbe } from './speech_gpu_check';

/** One candidate whose proof must use these same paths and isolated environment. */
export interface GpuCapabilityInputs extends Omit<GpuSetupDependencies, 'probe'> {
  probeFor: (capability: GpuLaunchCapability) => GpuProbe;
  runtimeDirectory: string;
  modelDirectory: string;
  executablePath: string;
  loaderPath: string;
  loaderSha256: string;
  driverManifest: string;
  driverPath: string;
  driverSha256: string;
  driverDevice: string;
  driverInode: string;
}

/** Result of a fresh setup and launch capability check. */
export interface GpuCapabilityResult<C extends GpuLaunchCapability | CoreMlLaunch = GpuLaunchCapability | CoreMlLaunch> {
  check: GpuCheck;
  capability?: C;
}

/** Issues a capability only after a fresh fail-closed check succeeds. */
export async function issueGpuCapability(
  options: GpuCapabilityInputs,
  signal?: AbortSignal,
): Promise<GpuCapabilityResult<GpuLaunchCapability>> {
  function checkAbort(): void {
    if (signal?.aborted === true) throw new DOMException('Aborted', 'AbortError');
  }
  checkAbort();
  const paths = [
    options.runtimeDirectory,
    options.modelDirectory,
    options.executablePath,
    options.loaderPath,
    options.driverManifest,
    options.driverPath,
  ];
  if (
    paths.some((value) => !path.isAbsolute(value) || path.normalize(value) !== value) ||
    !/^[a-f0-9]{64}$/.test(options.loaderSha256) ||
    !/^[a-f0-9]{64}$/.test(options.driverSha256) ||
    !/^\d+$/.test(options.driverDevice) ||
    !/^\d+$/.test(options.driverInode)
  ) {
    return { check: { phase: 'unavailable', reason: 'inconclusive' } };
  }
  const capability: GpuLaunchCapability = Object.freeze({
    runtimeDirectory: options.runtimeDirectory,
    modelDirectory: options.modelDirectory,
    executablePath: options.executablePath,
    loaderPath: options.loaderPath,
    loaderSha256: options.loaderSha256,
    driverPath: options.driverPath,
    driverSha256: options.driverSha256,
    driverDevice: options.driverDevice,
    driverInode: options.driverInode,
    environment: Object.freeze(gpuEnvironment(options.driverManifest, options.loaderPath)),
  });
  try {
    const check = await checkGpuSetup({ ...options, probe: options.probeFor(capability) }, signal);
    // specs/GpuProofAbort.tla, Settle: aborted proof cannot issue a capability.
    checkAbort();
    return check.phase === 'ready' ? { check, capability } : { check };
  } catch (error: unknown) {
    checkAbort();
    return { check: { phase: 'unavailable', reason: error instanceof GpuProcessBusyError ? 'busy' : 'inconclusive' } };
  }
}
