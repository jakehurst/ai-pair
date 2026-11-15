import * as path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { GpuCheck } from './speech_compute_types';
import { LocalSynthesisClient, type LocalListener, type LocalSynthesisPort } from './speech_local_client';

/** The one host whose GPU path is ONNX Runtime's CoreML execution provider (#42). */
const COREML_HOST = 'darwin-arm64';
/** CoreML compiles the model on every load: 13 to 34 seconds measured on an M-series Mac. */
const COREML_LOAD_TIMEOUT_MS = 120_000;

/** A GPU launch on CoreML: the CPU worker, with the q8 model on the CoreML provider. */
export interface CoreMlLaunch {
  readonly kind: 'coreml';
  readonly modelDirectory: string;
}

/** Starts the speech worker with the CoreML execution provider. */
function createCoreMlWorker(runtimeDirectory: string, listener: LocalListener): LocalSynthesisPort {
  return new LocalSynthesisClient({
    spawn: (modelPath) => new Worker(path.join(runtimeDirectory, 'worker.mjs'), { workerData: { modelPath, device: 'coreml' } }),
    listener,
    loadTimeoutMs: COREML_LOAD_TIMEOUT_MS,
  });
}

/** Inputs of the explicit CoreML check. */
export interface CoreMlProof {
  model: () => Promise<string | undefined>;
  create: (listener: LocalListener) => LocalSynthesisPort;
}

/**
 * Proves CoreML by loading the installed model in a CoreML session, then
 * retires the worker and waits for it to exit before settling.
 */
export async function proveCoreMl(options: CoreMlProof, signal: AbortSignal): Promise<GpuCheck> {
  const model = await options.model();
  if (signal.aborted) return { phase: 'unavailable', reason: 'inconclusive' };
  if (model === undefined) return { phase: 'unavailable', reason: 'model_missing' };
  const loaded = Promise.withResolvers<boolean>();
  const exited = Promise.withResolvers<void>();
  const worker = options.create({
    ready: () => {
      loaded.resolve(true);
    },
    retired: () => {
      loaded.resolve(false);
    },
    reaped: () => {
      loaded.resolve(false);
      exited.resolve();
    },
  });
  function abort(): void {
    worker.retire('worker_exit');
  }
  signal.addEventListener('abort', abort, { once: true });
  worker.load(model);
  const ready = await loaded.promise;
  signal.removeEventListener('abort', abort);
  // specs/SpeechLifecycle.tla, Reap: the proof owns the slot until its worker exits.
  worker.retire('worker_exit');
  await exited.promise;
  if (signal.aborted) return { phase: 'unavailable', reason: 'inconclusive' };
  return ready ? { phase: 'ready' } : { phase: 'unavailable', reason: 'probe_failed' };
}

/** The GPU wiring of one host: whether GPU is offered, the worker factory, and the explicit check. */
export interface CoreMlCompute {
  gpu: boolean;
  speechOptions: { createCoreMl?: (listener: LocalListener) => LocalSynthesisPort };
  check: (signal: AbortSignal) => Promise<GpuCheck>;
}

/** Inputs of the host's GPU wiring. */
export interface CoreMlHost {
  supported: boolean;
  platform: string;
  arch: string;
  runtimeDirectory: string;
  /** The extension's global storage, where the verified CPU model lives. */
  storageDirectory: string;
  /** Returns the verified model directory under a storage directory, if installed. */
  installedModel: (storageDirectory: string) => Promise<string | undefined>;
}

/** Wires CoreML GPU speech on macOS arm64 (#42), and no GPU anywhere else. */
export function coreMlCompute(host: CoreMlHost): CoreMlCompute {
  // specs/CoreMlCompute.tla, Init: `capable` is fixed by the host.
  if (!host.supported || `${host.platform}-${host.arch}` !== COREML_HOST) {
    return { gpu: false, speechOptions: {}, check: () => Promise.resolve({ phase: 'unavailable', reason: 'unsupported' }) };
  }
  function create(listener: LocalListener): LocalSynthesisPort {
    return createCoreMlWorker(host.runtimeDirectory, listener);
  }
  return {
    gpu: true,
    speechOptions: { createCoreMl: create },
    check: (signal) => proveCoreMl({ model: () => host.installedModel(host.storageDirectory), create }, signal),
  };
}
