import { afterEach, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';
import { Worker } from 'node:worker_threads';
import { LocalSynthesisClient, type LocalListener, type LocalSynthesisPort } from '../src/speech_local_client';
import { coreMlCompute, proveCoreMl } from '../src/speech_coreml';

vi.mock('node:worker_threads', () => ({
  // A constructor mock must be constructable.
  // oxlint-disable-next-line eslint/prefer-arrow-callback
  Worker: vi.fn(function () {
    return {};
  }),
}));
vi.mock('../src/speech_local_client', () => ({
  // oxlint-disable-next-line eslint/prefer-arrow-callback
  LocalSynthesisClient: vi.fn(function () {
    return {};
  }),
}));

afterEach(() => {
  vi.clearAllMocks();
});

/** A worker whose listener the test drives, recording load and retire calls. */
function port(): { worker: LocalSynthesisPort; listener: () => LocalListener; create: (listener: LocalListener) => LocalSynthesisPort } {
  let captured: LocalListener | undefined;
  const worker = mock<LocalSynthesisPort>();
  return {
    worker,
    listener: () => {
      if (captured === undefined) throw new Error('No listener');
      return captured;
    },
    create: (listener) => {
      captured = listener;
      return worker;
    },
  };
}

/** The host inputs of macOS arm64 with local speech supported. */
function macHost(overrides: Partial<Parameters<typeof coreMlCompute>[0]> = {}): Parameters<typeof coreMlCompute>[0] {
  return {
    supported: true,
    platform: 'darwin',
    arch: 'arm64',
    runtimeDirectory: '/runtime',
    storageDirectory: '/storage',
    installedModel: vi.fn(),
    ...overrides,
  };
}

it.each([
  [{ platform: 'darwin', arch: 'x64' }],
  [{ platform: 'linux', arch: 'x64' }],
  [{ platform: 'win32', arch: 'arm64' }],
  [{ supported: false }],
])('OfferedOnlyWhereCapable: offers no GPU and checks nothing without the CoreML path (%j)', async (overrides) => {
  const compute = coreMlCompute(macHost(overrides));
  expect(compute.gpu).toBe(false);
  expect(compute.speechOptions).toEqual({});
  expect(await compute.check(new AbortController().signal)).toEqual({ phase: 'unavailable', reason: 'unsupported' });
});

it('starts the speech worker with the CoreML device, a long load timeout, and the model it is given', async () => {
  const model = vi.fn(() => Promise.resolve(undefined));
  const compute = coreMlCompute(macHost({ installedModel: model }));
  expect(compute.gpu).toBe(true);
  const listener = mock<LocalListener>();
  compute.speechOptions.createCoreMl?.(listener);
  const options = vi.mocked(LocalSynthesisClient).mock.calls[0]?.[0];
  if (options === undefined) throw new Error('No client');
  expect(options.listener).toBe(listener);
  expect(options.loadTimeoutMs).toBe(120_000);
  options.spawn('/model');
  expect(Worker).toHaveBeenCalledWith('/runtime/worker.mjs', { workerData: { modelPath: '/model', device: 'coreml' } });
  expect(await compute.check(new AbortController().signal)).toEqual({ phase: 'unavailable', reason: 'model_missing' });
  expect(model).toHaveBeenCalledExactlyOnceWith('/storage');
});

it('GpuOnlyIfLoaded: reports ready only after a CoreML session loads, and waits for the worker to exit', async () => {
  const fake = port();
  vi.mocked(fake.worker.load).mockImplementation(() => {
    queueMicrotask(() => {
      fake.listener().ready();
    });
  });
  vi.mocked(fake.worker.retire).mockImplementation(() => {
    queueMicrotask(() => {
      fake.listener().reaped?.();
    });
  });
  const check = await proveCoreMl({ model: () => Promise.resolve('/model'), create: fake.create }, new AbortController().signal);
  expect(check).toEqual({ phase: 'ready' });
  expect(fake.worker.load).toHaveBeenCalledWith('/model');
  expect(fake.worker.retire).toHaveBeenCalledWith('worker_exit');
});

it('GpuOnlyIfLoaded: a CoreML session that fails to load fails the check', async () => {
  const fake = port();
  vi.mocked(fake.worker.load).mockImplementation(() => {
    queueMicrotask(() => {
      fake.listener().retired('model_load');
      fake.listener().reaped?.();
    });
  });
  const check = await proveCoreMl({ model: () => Promise.resolve('/model'), create: fake.create }, new AbortController().signal);
  expect(check).toEqual({ phase: 'unavailable', reason: 'probe_failed' });
});

it('Settles: reports a missing model, and an abort before or during the load', async () => {
  const missing = port();
  expect(await proveCoreMl({ model: () => Promise.resolve(undefined), create: missing.create }, new AbortController().signal)).toEqual({
    phase: 'unavailable',
    reason: 'model_missing',
  });
  const early = new AbortController();
  early.abort();
  expect(await proveCoreMl({ model: () => Promise.resolve('/model'), create: missing.create }, early.signal)).toEqual({
    phase: 'unavailable',
    reason: 'inconclusive',
  });
  expect(missing.worker.load).not.toHaveBeenCalled();
  const fake = port();
  const during = new AbortController();
  vi.mocked(fake.worker.load).mockImplementation(() => {
    queueMicrotask(() => {
      during.abort();
    });
  });
  vi.mocked(fake.worker.retire).mockImplementation(() => {
    fake.listener().retired('worker_exit');
    queueMicrotask(() => {
      fake.listener().reaped?.();
    });
  });
  expect(await proveCoreMl({ model: () => Promise.resolve('/model'), create: fake.create }, during.signal)).toEqual({
    phase: 'unavailable',
    reason: 'inconclusive',
  });
});
