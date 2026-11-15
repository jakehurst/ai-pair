/* oxlint-disable typescript/unbound-method -- Lifecycle methods are Vitest mocks without a receiver. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';
import { LOCAL_PROTOCOL_VERSION, LOCAL_REQUEST } from '../src/speech_local_protocol';
import { installedSpeechModel } from '../src/speech_setup';
import { speechRuntimeAvailable } from '../src/speech_runtime_status';
import { SpeechService, type SpeechOutput } from '../src/speech_service';
import type { LocalListener, LocalSynthesisOutcome, LocalSynthesisPort, LocalSynthesisRequest } from '../src/speech_local_client';
import type { ElevenLabsSpeechPort, LocalSpeechFailureReason, SpeechSettings } from '../src/speech_types';
import { decodeSpeechWav, encodeTempoWav } from '../src/speech_tempo_pcm';
import type { SpeechLifecycle, SpeechLifecycleOptions, SpeechLifecycleResult, SpeechLifecycleSnapshot } from '../src/speech_lifecycle';

const contextDouble = vi.hoisted(() => ({ session: vi.fn(), configure: vi.fn(), disconnect: vi.fn(), capture: vi.fn() }));
vi.mock('@ai-pair/core', () => ({
  // A constructor mock must be constructable.
  // oxlint-disable-next-line eslint/prefer-arrow-callback
  SpeechContext: vi.fn(function () {
    return contextDouble;
  }),
}));

const fake = vi.hoisted(() => {
  const Worker = vi.fn();
  const makeLifecycle = vi.fn<(options: SpeechLifecycleOptions) => SpeechLifecycle>();
  /** The inert stand-in for the real client, used by every service built without an injected one. */
  class LocalSynthesisClient {
    static made: Array<{ spawn: (modelPath: string) => unknown; listener: unknown }> = [];
    constructor(options: { spawn: (modelPath: string) => unknown; listener: unknown }) {
      LocalSynthesisClient.made.push(options);
    }
  }
  return { Worker, LocalSynthesisClient, makeLifecycle };
});
vi.mock('../src/speech_lifecycle', () => ({
  // A constructor mock must be constructable.
  // oxlint-disable-next-line eslint/prefer-arrow-callback
  SpeechLifecycle: vi.fn(function (options: SpeechLifecycleOptions) {
    return fake.makeLifecycle(options);
  }),
}));
vi.mock('node:worker_threads', () => ({ Worker: fake.Worker }));
vi.mock('../src/speech_local_client', () => ({ LocalSynthesisClient: fake.LocalSynthesisClient }));
vi.mock('../src/speech_setup', () => ({ installedSpeechModel: vi.fn() }));
vi.mock('../src/speech_runtime_status', () => ({ speechRuntimeAvailable: vi.fn() }));
vi.mock('../src/speech_types', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/speech_types')>();
  return { ...actual, speechListeningRate: vi.fn((value: unknown) => (value === 0.75 || value === 1.25 || value === 1.5 ? value : 1)) };
});
vi.mock('../src/speech_tempo_pcm', () => ({ decodeSpeechWav: vi.fn(), encodeTempoWav: vi.fn() }));
vi.mock('../src/speech_segments', () => ({
  speechSegments: vi.fn((text: string) => text.match(/[^.!?]+[.!?]\s*/gu) ?? [text]),
}));

/** Returns a Linux GPU launch capability; the service only routes it by shape. */
function linuxCapability(): import('../src/speech_gpu_client').GpuLaunchCapability {
  return {
    runtimeDirectory: '/runtime',
    modelDirectory: '/gpu-model',
    executablePath: '/node',
    loaderPath: '/loader',
    loaderSha256: 'a'.repeat(64),
    driverPath: '/driver',
    driverSha256: 'b'.repeat(64),
    driverDevice: '1',
    driverInode: '2',
    environment: { LANG: 'C', VK_DRIVER_FILES: '/icd.json', VK_LOADER_LAYERS_DISABLE: '~all~', LD_PRELOAD: '' },
  };
}

/** Checks a callback captured from the timer fake. */
function isTimerCallback(value: unknown): value is () => void {
  return typeof value === 'function';
}

/** Lets model discovery and worker initialization settle. */
async function settle(): Promise<void> {
  for (let index = 0; index < 6; index++) await Promise.resolve();
}

/** Keeps the process host settings so each test can restore them. */
const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
const originalArch = Object.getOwnPropertyDescriptor(process, 'arch');

/** One request the service made of the local engine, which the test settles by hand. */
interface LocalCall {
  request: LocalSynthesisRequest;
  settle: (outcome: LocalSynthesisOutcome) => void;
  returned: boolean;
}

/** A controlled manager mock: tests settle acquisitions and synthesis without implementing worker ownership. */
class LocalDouble {
  readonly manager = mock<SpeechLifecycle>();
  readonly calls: LocalCall[] = [];
  readonly acquisitions: Array<{ id: number; resolve: (result: SpeechLifecycleResult) => void }> = [];
  options?: SpeechLifecycleOptions;
  private value: SpeechLifecycleSnapshot = {
    requestedMode: 'cpu',
    actualBackend: 'none',
    phase: 'cold',
    gpuCheck: { phase: 'idle' },
    generation: 0,
  };

  constructor() {
    this.manager.snapshot.mockImplementation(() => this.value);
    this.manager.select.mockImplementation((requestedMode) => {
      this.value = { ...this.value, requestedMode };
    });
    this.manager.acquire.mockImplementation((id) => {
      const pending = Promise.withResolvers<SpeechLifecycleResult>();
      this.acquisitions.push({ id, resolve: pending.resolve });
      return pending.promise;
    });
    this.manager.synthesize.mockImplementation((lease, request) => {
      expect(lease.unitId).toBe(request.id);
      LOCAL_REQUEST.parse({ type: 'synthesize', version: LOCAL_PROTOCOL_VERSION, epoch: 1, ...request });
      const outcome = Promise.withResolvers<LocalSynthesisOutcome>();
      this.calls.push({ request, settle: outcome.resolve, returned: false });
      return outcome.promise;
    });
    this.manager.busy.mockReturnValue(false);
    this.manager.dispose.mockResolvedValue();
    this.manager.retireWorker.mockReturnValue(true);
  }

  attach(options: SpeechLifecycleOptions): SpeechLifecycle {
    this.options = options;
    this.value = { ...this.value, requestedMode: options.requestedMode };
    return this.manager;
  }

  change(patch: Partial<SpeechLifecycleSnapshot>): void {
    this.value = { ...this.value, ...patch };
    this.options?.changed(this.value);
  }

  async ready(): Promise<void> {
    this.value = { ...this.value, phase: 'ready', actualBackend: 'cpu' };
    this.options?.changed(this.value);
    for (const pending of this.acquisitions.splice(0)) {
      pending.resolve({ status: 'ready', lease: { unitId: pending.id, generation: this.value.generation } });
    }
    await settle();
  }

  async audio(id: number, part = 0, durationMs = 1000, wav = new Uint8Array(44)): Promise<void> {
    this.take(id, part)?.settle({ status: 'audio', wav, durationMs });
    await settle();
  }

  async failure(id: number, part = 0): Promise<void> {
    this.take(id, part)?.settle({ status: 'failed', reason: 'synthesis' });
    await settle();
  }

  retired(reason: LocalSpeechFailureReason): void {
    this.value = { ...this.value, phase: 'retiring', actualBackend: 'none', failureReason: reason };
    this.options?.changed(this.value);
    for (const pending of this.acquisitions.splice(0)) pending.resolve({ status: 'unavailable', reason });
  }

  private take(id: number, part: number): LocalCall | undefined {
    const call = this.calls.find((candidate) => !candidate.returned && candidate.request.id === id && candidate.request.part === part);
    if (call !== undefined) call.returned = true;
    return call;
  }
}

/** The local engine of the service most recently built by a test. */
let local = new LocalDouble();

/** Starts a new local engine fake for the next service. */
function newLocal(): LocalDouble {
  local = new LocalDouble();
  return local;
}

/** Makes a service with a live page and local preferences. */
function harness(enabled = true, computeMode: () => 'cpu' | 'auto' | 'gpu' = () => 'cpu') {
  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
  Object.defineProperty(process, 'arch', { value: 'x64', configurable: true });
  const output = mock<SpeechOutput>();
  output.prepare = undefined;
  output.play.mockReturnValue(7);
  const double = newLocal();
  const service = new SpeechService({
    runtimeDirectory: '/runtime',
    storageDirectory: '/storage',
    localDesktop: true,
    output,
    computeMode,
    settings: () => ({ enabled, provider: 'kokoro', voice: 'af_heart', speed: 1, elevenLabsVoice: '', elevenLabsSpeed: 1 }),
  });
  return { service, output, local: double };
}

beforeEach(() => {
  vi.useFakeTimers();
  fake.LocalSynthesisClient.made.length = 0;
  local = new LocalDouble();
  fake.makeLifecycle.mockImplementation((options) => local.attach(options));
  vi.mocked(installedSpeechModel).mockResolvedValue('/model');
  vi.mocked(speechRuntimeAvailable).mockResolvedValue(true);
});
afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
  if (originalPlatform !== undefined) Object.defineProperty(process, 'platform', originalPlatform);
  if (originalArch !== undefined) Object.defineProperty(process, 'arch', originalArch);
});

describe('SpeechService', () => {
  it('uses a supported test host even when the test process is not Linux', async () => {
    const original = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    try {
      const { service } = harness();
      const gate = service.speak('Hello.');
      await settle();
      expect(local.manager.acquire).toHaveBeenCalledOnce();
      service.cancel();
      await gate;
    } finally {
      if (original !== undefined) Object.defineProperty(process, 'platform', original);
    }
  });

  it('defaults to silent behavior when disabled', async () => {
    const { service, output } = harness(false);
    await service.speak('Hello.');
    expect(local.manager.acquire).not.toHaveBeenCalled();
    expect(output.play).not.toHaveBeenCalled();
  });

  it('matches generation and page acknowledgements before resolving speech', async () => {
    const { service, output } = harness();
    const gate = service.speak('Hello.');
    await settle();
    expect(local.manager.acquire).toHaveBeenCalledOnce();
    await local.ready();
    expect(local.calls.map((call) => call.request)).toEqual([{ id: 1, part: 0, final: true, text: 'Hello.', voice: 'af_heart', speed: 1 }]);
    await local.audio(1);
    expect(output.play).toHaveBeenCalledWith(1, new Uint8Array(44), 1000);
    let done = false;
    void gate.then(() => {
      done = true;
    });
    expect(service.audioEvent({ id: 1, pageId: 8, event: 'ended' })).toBeUndefined();
    await settle();
    expect(done).toBe(false);
    expect(service.audioEvent({ id: 1, pageId: 7, event: 'started' })).toBeUndefined();
    expect(service.audioEvent({ id: 1, pageId: 7, event: 'ended' })).toBe('ended');
    expect(service.audioEvent({ id: 1, pageId: 7, event: 'ended' })).toBeUndefined();
    await gate;
    expect(done).toBe(true);
  });

  it('retains prepared audio during pause and never revives canceled audio', async () => {
    const { service, output } = harness();
    const gate = service.speak('Hello.');
    await settle();
    await local.ready();
    service.pause();
    await local.audio(1);
    expect(output.play).not.toHaveBeenCalled();
    service.cancel();
    await gate;
    service.resume();
    expect(output.play).not.toHaveBeenCalled();
  });

  it('a retired worker ends its unit with a fixed reason and a late output changes nothing', async () => {
    const { service, output } = harness();
    const gate = service.speak('Hello.');
    await settle();
    await local.ready();
    local.retired('timeout');
    await gate;
    expect(output.localDiagnostic).toHaveBeenCalledWith('failed', 'timeout');
    expect(output.status).toHaveBeenCalledWith(1, 'unavailable', 'Local speech stopped. Retry setup.');
    await local.audio(1);
    expect(output.play).not.toHaveBeenCalled();
  });
});

describe('SpeechService lifecycle', () => {
  it('does not start work when a preparing notification synchronously cancels it', async () => {
    const { service, output } = harness();
    output.status.mockImplementation((id, state) => {
      if (id === 1 && state === 'preparing') service.cancel();
    });
    await service.speak('Hello.');
    expect(installedSpeechModel).not.toHaveBeenCalled();
    expect(local.manager.acquire).not.toHaveBeenCalled();
  });

  it('does not post audio when its preparing notification synchronously cancels it', async () => {
    const { service, output } = harness();
    let preparations = 0;
    output.status.mockImplementation((id, state) => {
      if (id === 1 && state === 'preparing' && ++preparations === 2) service.cancel();
    });
    const gate = service.speak('Hello.');
    await settle();
    await local.ready();
    await local.audio(1);
    await gate;
    expect(output.play).not.toHaveBeenCalled();
  });

  it('stops an audio post if cancellation happens while the page accepts it', async () => {
    const { service, output } = harness();
    output.play.mockImplementation(() => {
      service.cancel();
      return 7;
    });
    const gate = service.speak('Hello.');
    await settle();
    await local.ready();
    await local.audio(1);
    await gate;
    expect(output.control).toHaveBeenCalledWith(1, 7, 'stop');
  });

  it('shows preparation again when a synthesis pause clears', async () => {
    const { service, output } = harness();
    const gate = service.speak('Hello.');
    service.pause();
    service.resume();
    expect(output.status).toHaveBeenLastCalledWith(1, 'preparing');
    service.cancel();
    await gate;
  });

  it('does not extend the playback watchdog for duplicate started events', async () => {
    const { service } = harness();
    const gate = service.speak('Hello.');
    await settle();
    await local.ready();
    await local.audio(1);
    service.audioEvent({ id: 1, pageId: 7, event: 'started' });
    await vi.advanceTimersByTimeAsync(3000);
    service.audioEvent({ id: 1, pageId: 7, event: 'started' });
    await vi.advanceTimersByTimeAsync(3000);
    let done = false;
    void gate.then(() => {
      done = true;
    });
    await settle();
    expect(done).toBe(true);
  });

  it('does not count paused time against the playback watchdog', async () => {
    const { service } = harness();
    const gate = service.speak('Hello.');
    await settle();
    await local.ready();
    await local.audio(1);
    service.audioEvent({ id: 1, pageId: 7, event: 'started' });
    await vi.advanceTimersByTimeAsync(3000);
    service.pause();
    await vi.advanceTimersByTimeAsync(60_000);
    let done = false;
    void gate.then(() => {
      done = true;
    });
    await settle();
    expect(done).toBe(false);
    service.resume();
    await vi.advanceTimersByTimeAsync(2999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await gate;
    expect(done).toBe(true);
  });

  it.each(['cancel', 'pageClosed'] as const)('never accepts a late ended event after playback starts and %s occurs', async (reason) => {
    const { service, output } = harness();
    const gate = service.speak('Hello.');
    await settle();
    await local.ready();
    await local.audio(1);
    service.audioEvent({ id: 1, pageId: 7, event: 'started' });
    if (reason === 'cancel') service.cancel();
    else service.pageClosed(7);
    await gate;
    expect(output.status).toHaveBeenLastCalledWith(1, 'idle');
    expect(service.audioEvent({ id: 1, pageId: 7, event: 'ended' })).toBeUndefined();
  });

  it('cancels on page closure and ignores a late page acknowledgement', async () => {
    const { service, output } = harness();
    const gate = service.speak('Hello.');
    await settle();
    await local.ready();
    await local.audio(1);
    service.pageClosed(7);
    await gate;
    expect(output.control).toHaveBeenCalledWith(1, 7, 'stop');
    service.audioEvent({ id: 1, pageId: 7, event: 'started' });
    expect(output.status).not.toHaveBeenCalledWith(1, 'speaking');
  });

  it('uses text-only fallback when model or page is missing and for invalid worker audio', async () => {
    const missing = harness();
    vi.mocked(installedSpeechModel).mockResolvedValueOnce(undefined);
    const missingGate = missing.service.speak('Hello.');
    expect(await local.options?.resolveCpu(new AbortController().signal)).toBeUndefined();
    local.acquisitions[0]?.resolve({ status: 'unavailable', reason: 'model_missing' });
    await missingGate;
    expect(missing.output.status).toHaveBeenCalledWith(1, 'unavailable', expect.stringContaining('Download the Kokoro model'));
    const noPage = harness();
    noPage.output.play.mockReturnValue(undefined);
    const gate = noPage.service.speak('Hello.');
    await settle();
    await local.ready();
    await local.audio(1);
    await gate;
    expect(noPage.output.status).toHaveBeenCalledWith(1, 'unavailable', expect.stringContaining('panel'));
    const invalid = noPage.service.speak('Again.');
    await local.ready();
    await local.audio(2, 0, 1000, new Uint8Array(43));
    await invalid;
    expect(noPage.output.status).toHaveBeenCalledWith(2, 'unavailable', expect.stringContaining('invalid'));
  });
});

describe('SpeechService failures and races', () => {
  it('falls back for an invalid persisted voice or speed', async () => {
    for (const settings of [
      { enabled: true, provider: 'kokoro' as const, voice: 'invalid', speed: 1, elevenLabsVoice: '', elevenLabsSpeed: 1 },
      { enabled: true, provider: 'kokoro' as const, voice: 'af_heart', speed: 3, elevenLabsVoice: '', elevenLabsSpeed: 1 },
    ]) {
      const output = mock<SpeechOutput>();
      output.prepare = undefined;
      const service = new SpeechService({
        runtimeDirectory: '/runtime',
        storageDirectory: '/storage',
        localDesktop: true,
        output,
        settings: () => settings,
      });
      await service.speak('Hello.');
      expect(output.status).toHaveBeenCalledWith(1, 'unavailable', expect.stringContaining('supported'));
      expect(local.manager.acquire).not.toHaveBeenCalled();
    }
  });

  it.each([
    ['win32', 'x64'],
    ['linux', 'arm64'],
    ['darwin', 'ia32'],
  ])('leaves speech unavailable on %s %s', async (platform, arch) => {
    Object.defineProperty(process, 'platform', { value: platform, configurable: true });
    Object.defineProperty(process, 'arch', { value: arch, configurable: true });
    const output = mock<SpeechOutput>();
    output.prepare = undefined;
    const service = new SpeechService({
      runtimeDirectory: '/runtime',
      storageDirectory: '/storage',
      localDesktop: true,
      output,
      settings: () => ({ enabled: true, provider: 'kokoro', voice: 'af_heart', speed: 1, elevenLabsVoice: '', elevenLabsSpeed: 1 }),
    });
    await service.speak('Hello.');
    expect(output.status).toHaveBeenCalledWith(1, 'unavailable', expect.stringContaining('local Linux'));
    expect(local.manager.acquire).not.toHaveBeenCalled();
  });

  it.each([
    ['darwin', 'arm64'],
    ['darwin', 'x64'],
  ])('admits local speech on %s %s', async (platform, arch) => {
    const { service } = harness();
    Object.defineProperty(process, 'platform', { value: platform, configurable: true });
    Object.defineProperty(process, 'arch', { value: arch, configurable: true });
    const gate = service.speak('Hello.');
    await settle();
    expect(local.manager.acquire).toHaveBeenCalledOnce();
    service.cancel();
    await gate;
  });

  it('explains unsupported extension hosts without starting a worker', async () => {
    const output = mock<SpeechOutput>();
    output.prepare = undefined;
    const service = new SpeechService({
      runtimeDirectory: '/runtime',
      storageDirectory: '/storage',
      localDesktop: false,
      output,
      settings: () => ({ enabled: true, provider: 'kokoro', voice: 'af_heart', speed: 1, elevenLabsVoice: '', elevenLabsSpeed: 1 }),
    });
    await service.speak('Hello.');
    expect(output.status).toHaveBeenCalledWith(1, 'unavailable', expect.stringContaining('local Linux'));
    expect(local.manager.acquire).not.toHaveBeenCalled();
  });

  it('resumes a prepared waveform only when the global pause clears', async () => {
    const { service, output } = harness();
    const gate = service.speak('Hello.');
    await settle();
    await local.ready();
    service.pause();
    await local.audio(1);
    expect(output.play).not.toHaveBeenCalled();
    service.resume();
    expect(output.play).toHaveBeenCalledOnce();
    service.audioEvent({ id: 1, pageId: 7, event: 'started' });
    service.pause();
    expect(output.control).toHaveBeenCalledWith(1, 7, 'pause');
    service.resume();
    expect(output.control).toHaveBeenCalledWith(1, 7, 'resume');
    service.audioEvent({ id: 1, pageId: 7, event: 'ended' });
    await gate;
    expect(output.status).toHaveBeenCalledWith(1, 'idle');
  });

  it('keeps the startup watchdog paused if playback acknowledges while paused', async () => {
    const { service, output } = harness();
    const gate = service.speak('Hello.');
    await settle();
    await local.ready();
    await local.audio(1);
    service.pause();
    service.audioEvent({ id: 1, pageId: 7, event: 'started' });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(output.status).toHaveBeenLastCalledWith(1, 'paused');
    service.resume();
    service.audioEvent({ id: 1, pageId: 7, event: 'ended' });
    await gate;
  });

  it.each(['worker_error', 'worker_exit'] as const)('falls back when the worker is retired for %s', async (reason) => {
    const { service, output } = harness();
    const gate = service.speak('Hello.');
    await settle();
    local.retired(reason);
    await gate;
    expect(output.status).toHaveBeenCalledWith(1, 'unavailable', expect.stringContaining('stopped'));
    expect(output.localDiagnostic).toHaveBeenCalledWith('failed', reason);
  });

  it('handles a client that retires a worker it could not send a request to', async () => {
    const { service, output } = harness();
    const gate = service.speak('Hello.');
    await settle();
    await local.ready();
    local.retired('worker_error');
    await gate;
    expect(output.status).toHaveBeenCalledWith(1, 'unavailable', expect.any(String));
  });

  it('does not complete a newer speech unit when an old timeout is delivered late', async () => {
    const { service, output } = harness();
    const timers = vi.spyOn(globalThis, 'setTimeout');
    const first = service.speak('Old.');
    const callback: unknown = timers.mock.calls[0]?.[0];
    service.cancel();
    await first;
    const second = service.speak('New.');
    if (!isTimerCallback(callback)) throw new Error('No timeout callback');
    callback();
    expect(output.status).not.toHaveBeenCalledWith(2, 'unavailable', expect.any(String));
    service.cancel();
    await second;
    timers.mockRestore();
  });

  it('handles cancellation during a failed page post and idle controls', async () => {
    const { service, output } = harness();
    service.pause();
    service.resume();
    service.cancel();
    output.play.mockImplementation(() => {
      service.cancel();
      return undefined;
    });
    const gate = service.speak('Hello.');
    await settle();
    await local.ready();
    await local.audio(1);
    await gate;
    expect(output.control).not.toHaveBeenCalled();
    await service.dispose();
    await service.dispose();
  });

  it('keeps the watchdog remaining time after a duplicate pause', async () => {
    const { service } = harness();
    const gate = service.speak('Hello.');
    await settle();
    await local.ready();
    await local.audio(1);
    service.audioEvent({ id: 1, pageId: 7, event: 'started' });
    service.pause();
    service.pause();
    service.resume();
    service.audioEvent({ id: 1, pageId: 7, event: 'ended' });
    await gate;
  });

  it('TruthfulUnavailable: a worker that cannot load its model ends the unit with the model_load category', async () => {
    const { service, output } = harness();
    const gate = service.speak('Hello.');
    await settle();
    local.retired('model_load');
    await gate;
    expect(output.status).toHaveBeenCalledWith(1, 'unavailable', expect.stringContaining('stopped'));
    expect(output.localDiagnostic).toHaveBeenCalledWith('failed', 'model_load');
    expect(local.calls).toHaveLength(0);
  });

  it('resumes an audio element that has not acknowledged starting yet', async () => {
    const { service, output } = harness();
    const gate = service.speak('Hello.');
    await settle();
    await local.ready();
    await local.audio(1);
    service.pageClosed(8);
    service.pause();
    service.resume();
    expect(output.status).toHaveBeenLastCalledWith(1, 'preparing');
    service.audioEvent({ id: 1, pageId: 7, event: 'ended' });
    await gate;
  });

  it('falls back on a retired worker and on audio play failures', async () => {
    const first = harness();
    const gate = first.service.speak('Hello.');
    await settle();
    local.retired('worker_error');
    await gate;
    expect(first.output.status).toHaveBeenCalledWith(1, 'unavailable', expect.stringContaining('stopped'));

    const second = harness();
    second.output.play.mockImplementation(() => {
      throw new Error('closed page');
    });
    const next = second.service.speak('Hello.');
    await settle();
    await local.ready();
    await local.audio(1);
    await next;
    expect(second.output.status).toHaveBeenCalledWith(1, 'unavailable', expect.stringContaining('Audio'));
  });

  it('surfaces a synthesis failure and page errors without releasing another generation', async () => {
    const { service, output } = harness();
    const first = service.speak('One.');
    await settle();
    await local.ready();
    await local.failure(1);
    await first;
    expect(output.status).toHaveBeenCalledWith(1, 'unavailable', 'Could not speak this text. Continue reading it.');
    expect(output.localDiagnostic).toHaveBeenCalledWith('failed', 'synthesis');
    const next = service.speak('Two.');
    await local.ready();
    await local.audio(2);
    expect(service.audioEvent({ id: 1, pageId: 7, event: 'failed' })).toBeUndefined();
    expect(service.audioEvent({ id: 2, pageId: 7, event: 'failed' })).toBe('failed');
    await next;
    expect(output.status).toHaveBeenCalledWith(2, 'unavailable', expect.stringContaining('Preview'));
  });

  it('allows preview while disabled and gives live speech priority over preview', async () => {
    const disabled = harness(false);
    const preview = disabled.service.preview();
    await settle();
    expect(local.manager.acquire).toHaveBeenCalledTimes(1);
    disabled.service.cancel();
    await preview;

    const live = harness();
    const sample = live.service.preview();
    await settle();
    await local.ready();
    local.manager.acquire.mockResolvedValueOnce({ status: 'unavailable', reason: 'busy' });
    const next = live.service.speak('Live.');
    await sample;
    await next;
    expect(live.output.status).toHaveBeenCalledWith(2, 'unavailable', expect.stringContaining('finishing'));
  });

  it('NoReplay: after a failure the next explicit request sends only its own text', async () => {
    const { service } = harness();
    const first = service.speak('Failed text.');
    await settle();
    await local.ready();
    await local.failure(1);
    await first;
    const second = service.speak('Next text.');
    await local.ready();
    expect(local.calls.map((call) => call.request.text)).toEqual(['Failed text.', 'Next text.']);
    service.cancel();
    await second;
  });

  it('fails the unit visibly if the client refuses the request instead of waiting for the deadline', async () => {
    const { service, output } = harness();
    const gate = service.speak('Hello.');
    await settle();
    await local.ready();
    local.calls[0]?.settle({ status: 'failed', reason: 'unavailable' });
    await gate;
    expect(output.status).toHaveBeenCalledWith(1, 'unavailable', 'Could not speak this text. Continue reading it.');
  });

  it('disposes a worker and refuses new requests', async () => {
    const { service } = harness();
    const gate = service.speak('Hello.');
    await settle();
    await service.dispose();
    await gate;
    expect(local.manager.dispose).toHaveBeenCalledOnce();
    await service.speak('Later.');
    expect(local.manager.acquire).toHaveBeenCalledTimes(1);
  });

  it('builds the packaged Node worker client when none is injected', () => {
    const service = new SpeechService({
      runtimeDirectory: '/runtime',
      storageDirectory: '/storage',
      localDesktop: true,
      output: mock<SpeechOutput>(),
      settings: () => ({ enabled: true, provider: 'kokoro', voice: 'af_heart', speed: 1, elevenLabsVoice: '', elevenLabsSpeed: 1 }),
    });
    expect(service).toBeInstanceOf(SpeechService);
    local.options?.createCpu(mock<LocalListener>());
    const options = fake.LocalSynthesisClient.made[0];
    expect(options).toBeDefined();
    // The pinned phonemizer bridge reads the verified model directory from workerData.
    options?.spawn('/storage/speech/model');
    expect(fake.Worker).toHaveBeenCalledExactlyOnceWith('/runtime/worker.mjs', { workerData: { modelPath: '/storage/speech/model' } });
  });
});

describe('cloud narration', () => {
  it('sends the selected text once, and accepts only the current page ending', async () => {
    const cloud = mock<ElevenLabsSpeechPort>();
    cloud.synthesize.mockResolvedValue({ wav: new Uint8Array(44), durationMs: 1000 });
    const output = mock<SpeechOutput>();
    output.prepare = undefined;
    output.play.mockReturnValue(7);
    const service = new SpeechService({
      runtimeDirectory: '',
      storageDirectory: '',
      localDesktop: true,
      output,
      cloud,
      settings: () => ({
        enabled: true,
        provider: 'elevenlabs',
        voice: 'af_heart',
        speed: 1,
        elevenLabsVoice: 'voice-id',
        elevenLabsSpeed: 1.2,
      }),
    });
    const gate = service.speak('Exact selected text.');
    await settle();
    expect(cloud.synthesize.mock.calls).toHaveLength(1);
    expect(cloud.synthesize.mock.calls[0]?.[0]).toEqual({ text: 'Exact selected text.', voiceId: 'voice-id', speed: 1.2 });
    expect(output.play).toHaveBeenCalledWith(1, new Uint8Array(44), 1000);
    expect(service.audioEvent({ id: 1, pageId: 7, event: 'ended' })).toBe('ended');
    await gate;
  });

  it('aborts a canceled request and ignores its late output without queuing a successor', async () => {
    const cloud = mock<ElevenLabsSpeechPort>();
    const pending = Promise.withResolvers<{ wav: Uint8Array; durationMs: number }>();
    cloud.synthesize.mockReturnValue(pending.promise);
    const output = mock<SpeechOutput>();
    output.prepare = undefined;
    const service = new SpeechService({
      runtimeDirectory: '',
      storageDirectory: '',
      localDesktop: true,
      output,
      cloud,
      settings: () => ({
        enabled: true,
        provider: 'elevenlabs',
        voice: 'af_heart',
        speed: 1,
        elevenLabsVoice: 'voice-id',
        elevenLabsSpeed: 1,
      }),
    });
    const gate = service.speak('First.');
    const signal = cloud.synthesize.mock.calls[0]?.[1];
    service.cancel();
    await gate;
    expect(signal?.aborted).toBe(true);
    await service.speak('Second.');
    expect(cloud.synthesize.mock.calls).toHaveLength(1);
    pending.resolve({ wav: new Uint8Array(44), durationMs: 1000 });
    await settle();
    expect(output.play).not.toHaveBeenCalled();
  });
});

/** A cloud-only fixture with an explicitly selected nonsecret voice. */
function cloudHarness() {
  const cloud = mock<ElevenLabsSpeechPort>();
  const output = mock<SpeechOutput>();
  output.prepare = undefined;
  output.play.mockReturnValue(7);
  const cloudDiagnostic = vi.fn<(reason: string) => void>();
  const settings = {
    enabled: true,
    provider: 'elevenlabs' as const,
    voice: 'af_heart',
    speed: 1,
    elevenLabsVoice: 'voice-id',
    elevenLabsSpeed: 1,
  };
  const service = new SpeechService({
    runtimeDirectory: '',
    storageDirectory: '',
    localDesktop: true,
    output,
    cloud,
    cloudDiagnostic,
    settings: () => settings,
  });
  return { cloud, output, service, settings, cloudDiagnostic };
}

it('reports a categorized second failure and accepts the next narration', async () => {
  const { cloud, service, output, cloudDiagnostic } = cloudHarness();
  cloud.synthesize.mockResolvedValueOnce({ wav: new Uint8Array(44), durationMs: 1000 });
  cloud.synthesize.mockRejectedValueOnce({ kind: 'rate', message: 'private provider response' });
  cloud.synthesize.mockResolvedValueOnce({ wav: new Uint8Array(44), durationMs: 1000 });
  const first = service.speak('First private text.');
  await settle();
  service.audioEvent({ id: 1, pageId: 7, event: 'ended' });
  await first;
  await service.speak('Second private text.');
  expect(output.status).toHaveBeenCalledWith(2, 'unavailable', expect.stringContaining('rate'));
  expect(cloudDiagnostic).toHaveBeenCalledWith('rate');
  const third = service.speak('Third private text.');
  await settle();
  expect(cloud.synthesize.mock.calls).toHaveLength(3);
  expect(output.play).toHaveBeenCalledTimes(2);
  service.audioEvent({ id: 3, pageId: 7, event: 'ended' });
  await third;
  expect(JSON.stringify(cloudDiagnostic.mock.calls)).not.toContain('private');
});

it.each([
  ['key', 'no_key', 'API key'],
  ['auth', 'auth', 'authorize'],
  ['rate', 'rate', 'rate limit'],
  ['network', 'network', 'service returned an error'],
  ['timeout', 'timeout', 'timed out'],
  ['invalid', 'invalid', 'invalid response or request'],
  ['unexpected', 'unknown', 'unavailable'],
])('reports the fixed %s cloud category without provider details', async (kind, reason, message) => {
  const { cloud, service, output, cloudDiagnostic } = cloudHarness();
  cloud.synthesize.mockRejectedValueOnce({ kind, message: 'private key and response' });
  await service.speak('private narration');
  expect(cloudDiagnostic).toHaveBeenCalledWith(reason);
  expect(output.status).toHaveBeenCalledWith(1, 'unavailable', expect.stringContaining(message));
  expect(JSON.stringify(output.status.mock.calls)).not.toContain('private');
});

it('settles an unexpected canceled result without an unavailable banner', async () => {
  const { cloud, service, output, cloudDiagnostic } = cloudHarness();
  cloud.synthesize.mockRejectedValueOnce({ kind: 'canceled' });
  await service.speak('Canceled.');
  expect(cloudDiagnostic).toHaveBeenCalledWith('canceled');
  expect(output.status).not.toHaveBeenCalledWith(1, 'unavailable', expect.anything());
  expect(output.status).toHaveBeenCalledWith(1, 'idle');
});

it('ignores a synchronous provider throw after cancellation', async () => {
  const { cloud, service, output, cloudDiagnostic } = cloudHarness();
  cloud.synthesize.mockImplementationOnce(() => {
    service.cancel();
    throw new Error('private');
  });
  await service.speak('Canceled.');
  expect(cloudDiagnostic).not.toHaveBeenCalled();
  expect(output.status).not.toHaveBeenCalledWith(1, 'unavailable', expect.anything());
});

it('keeps failure handling working when diagnostics throw', async () => {
  const { cloud, service, output, cloudDiagnostic } = cloudHarness();
  cloudDiagnostic.mockImplementation(() => {
    throw new Error('private');
  });
  cloud.synthesize.mockRejectedValueOnce({ kind: 'network' });
  await service.speak('Failure.');
  expect(output.status).toHaveBeenCalledWith(1, 'unavailable', expect.stringContaining('service returned an error'));
});

it('supports cloud on macOS without requiring the local runtime', async () => {
  Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
  const { cloud, service } = cloudHarness();
  cloud.synthesize.mockResolvedValue({ wav: new Uint8Array(44), durationMs: 1000 });
  const gate = service.speak('Hello.');
  await settle();
  expect(local.manager.acquire).not.toHaveBeenCalled();
  expect(service.audioEvent({ id: 1, pageId: 7, event: 'ended' })).toBe('ended');
  await gate;
});

it('never invokes cloud when disabled or no cloud voice is selected', async () => {
  const { cloud, service, settings, output } = cloudHarness();
  settings.enabled = false;
  await service.speak('No send.');
  settings.enabled = true;
  settings.elevenLabsVoice = '';
  await service.speak('No voice.');
  expect(cloud.synthesize.mock.calls).toHaveLength(0);
  expect(output.status).toHaveBeenCalledWith(1, 'unavailable', expect.stringContaining('voice'));
});

it('keeps prepared cloud speech paused until resume and rejects stale page events', async () => {
  const { cloud, service, output } = cloudHarness();
  const pending = Promise.withResolvers<{ wav: Uint8Array; durationMs: number }>();
  cloud.synthesize.mockReturnValue(pending.promise);
  const gate = service.speak('Hello.');
  service.pause();
  pending.resolve({ wav: new Uint8Array(44), durationMs: 1000 });
  await settle();
  expect(output.play).not.toHaveBeenCalled();
  service.resume();
  expect(output.play).toHaveBeenCalledOnce();
  expect(service.audioEvent({ id: 1, pageId: 8, event: 'ended' })).toBeUndefined();
  expect(service.audioEvent({ id: 1, pageId: 7, event: 'ended' })).toBe('ended');
  await gate;
});

it('cancels cloud work when credentials change and discards the late response', async () => {
  const { cloud, service, output } = cloudHarness();
  const pending = Promise.withResolvers<{ wav: Uint8Array; durationMs: number }>();
  cloud.synthesize.mockReturnValue(pending.promise);
  const gate = service.speak('Hello.');
  const signal = cloud.synthesize.mock.calls[0]?.[1];
  service.invalidateCloud();
  await gate;
  expect(signal?.aborted).toBe(true);
  pending.resolve({ wav: new Uint8Array(44), durationMs: 1000 });
  await settle();
  expect(output.play).not.toHaveBeenCalled();
});

it('releases a hung cloud request at its watchdog without reviving late output', async () => {
  const { cloud, service, output, cloudDiagnostic } = cloudHarness();
  const pending = Promise.withResolvers<{ wav: Uint8Array; durationMs: number }>();
  cloud.synthesize.mockReturnValue(pending.promise);
  const gate = service.speak('Hello.');
  await vi.advanceTimersByTimeAsync(20_000);
  await gate;
  expect(output.status).toHaveBeenCalledWith(1, 'unavailable', expect.stringContaining('timed out'));
  pending.resolve({ wav: new Uint8Array(44), durationMs: 1000 });
  await settle();
  expect(output.play).not.toHaveBeenCalled();
  expect(cloudDiagnostic.mock.calls).toEqual([['timeout']]);
});

it('falls back safely for invalid cloud audio and sanitized provider failures', async () => {
  const { cloud, service, output } = cloudHarness();
  cloud.synthesize.mockResolvedValueOnce({ wav: new Uint8Array(2), durationMs: 1000 });
  await service.speak('First.');
  cloud.synthesize.mockRejectedValueOnce(new Error('secret provider response'));
  await service.speak('Second.');
  expect(output.play).not.toHaveBeenCalled();
  expect(output.status).toHaveBeenCalledWith(2, 'unavailable', expect.not.stringContaining('secret'));
});

it('rejects unknown providers without falling back or starting a request', async () => {
  const { cloud, service, settings, output } = cloudHarness();
  Object.assign(settings, { provider: 'unknown' });
  await service.speak('Do not send.');
  expect(cloud.synthesize.mock.calls).toHaveLength(0);
  expect(local.manager.acquire).not.toHaveBeenCalled();
  expect(output.status).toHaveBeenCalledWith(1, 'unavailable', expect.stringContaining('provider'));
});

it('never sends cloud speech from a remote extension host', async () => {
  const cloud = mock<ElevenLabsSpeechPort>();
  const output = mock<SpeechOutput>();
  output.prepare = undefined;
  const service = new SpeechService({
    runtimeDirectory: '',
    storageDirectory: '',
    localDesktop: false,
    output,
    cloud,
    settings: () => ({ enabled: true, provider: 'elevenlabs', voice: 'af_heart', speed: 1, elevenLabsVoice: 'voice', elevenLabsSpeed: 1 }),
  });
  await service.speak('Do not send.');
  expect(cloud.synthesize.mock.calls).toHaveLength(0);
  expect(output.status).toHaveBeenCalledWith(1, 'unavailable', expect.stringContaining('local desktop'));
});

it('keeps cloud audio independent of an invalid saved local voice', async () => {
  const { cloud, service, settings } = cloudHarness();
  settings.voice = 'old-invalid-local-voice';
  cloud.synthesize.mockResolvedValue({ wav: new Uint8Array(44), durationMs: 1000 });
  const gate = service.speak('Cloud.');
  await settle();
  expect(service.audioEvent({ id: 1, pageId: 7, event: 'ended' })).toBe('ended');
  await gate;
});

it('sanitizes synchronous provider failures', async () => {
  const { cloud, service, output } = cloudHarness();
  cloud.synthesize.mockImplementationOnce(() => {
    throw new Error('private');
  });
  await service.speak('Hello.');
  expect(output.status).toHaveBeenCalledWith(1, 'unavailable', expect.not.stringContaining('private'));
});

it('allows an existing local speech unit to survive a cloud key change', async () => {
  const { service } = harness();
  const gate = service.speak('Local.');
  await settle();
  service.invalidateCloud();
  await local.ready();
  await local.audio(1);
  expect(service.audioEvent({ id: 1, pageId: 7, event: 'ended' })).toBe('ended');
  await gate;
});

it('does not report a late rejected cloud request after cancellation', async () => {
  const { cloud, service, output, cloudDiagnostic } = cloudHarness();
  const pending = Promise.withResolvers<{ wav: Uint8Array; durationMs: number }>();
  cloud.synthesize.mockReturnValue(pending.promise);
  const gate = service.speak('Hello.');
  service.cancel();
  await gate;
  output.status.mockClear();
  pending.reject(new Error('late'));
  await settle();
  expect(output.status).not.toHaveBeenCalled();
  expect(cloudDiagnostic).not.toHaveBeenCalled();
});

it('expires a canceled request that ignores abort, without another status update', async () => {
  const { cloud, service, output, cloudDiagnostic } = cloudHarness();
  const pending = Promise.withResolvers<{ wav: Uint8Array; durationMs: number }>();
  cloud.synthesize.mockReturnValue(pending.promise);
  const gate = service.speak('Hello.');
  service.cancel();
  await gate;
  output.status.mockClear();
  await vi.advanceTimersByTimeAsync(20_000);
  expect(output.status).not.toHaveBeenCalled();
  expect(cloudDiagnostic).not.toHaveBeenCalled();
});

it('does not let an idle local worker failure interrupt an active cloud unit', async () => {
  const output = mock<SpeechOutput>();
  output.prepare = undefined;
  output.play.mockReturnValue(7);
  const cloud = mock<ElevenLabsSpeechPort>();
  const pending = Promise.withResolvers<{ wav: Uint8Array; durationMs: number }>();
  cloud.synthesize.mockReturnValue(pending.promise);
  const settings = {
    enabled: true,
    provider: 'kokoro' as 'kokoro' | 'elevenlabs',
    voice: 'af_heart',
    speed: 1,
    elevenLabsVoice: 'voice',
    elevenLabsSpeed: 1,
  };
  const service = new SpeechService({
    runtimeDirectory: '',
    storageDirectory: '',
    localDesktop: true,
    output,
    cloud,
    settings: () => settings,
  });
  const localGate = service.speak('Local.');
  await settle();
  await local.ready();
  await local.audio(1);
  service.audioEvent({ id: 1, pageId: 7, event: 'ended' });
  await localGate;
  settings.provider = 'elevenlabs';
  const cloudGate = service.speak('Cloud.');
  local.retired('worker_error');
  pending.resolve({ wav: new Uint8Array(44), durationMs: 1000 });
  await settle();
  expect(service.audioEvent({ id: 2, pageId: 7, event: 'ended' })).toBe('ended');
  await cloudGate;
});

it('resolves the speech gate if cloud service disappears during the preparing callback', async () => {
  const cloud = mock<ElevenLabsSpeechPort>();
  const output = mock<SpeechOutput>();
  output.prepare = undefined;
  const options = {
    runtimeDirectory: '',
    storageDirectory: '',
    localDesktop: true,
    output,
    cloud: cloud as ElevenLabsSpeechPort | undefined,
    settings: () => ({
      enabled: true,
      provider: 'elevenlabs' as const,
      voice: 'af_heart',
      speed: 1,
      elevenLabsVoice: 'voice',
      elevenLabsSpeed: 1,
    }),
  };
  output.status.mockImplementation(() => {
    options.cloud = undefined;
  });
  const service = new SpeechService(options);
  await service.speak('Hello.');
  expect(cloud.synthesize.mock.calls).toHaveLength(0);
});

it('blocks local speech on a non-glibc host while leaving cloud available', async () => {
  const cloud = mock<ElevenLabsSpeechPort>();
  cloud.synthesize.mockResolvedValue({ wav: new Uint8Array(44), durationMs: 1000 });
  const output = mock<SpeechOutput>();
  output.prepare = undefined;
  output.play.mockReturnValue(7);
  const settings = {
    enabled: true,
    provider: 'kokoro' as 'kokoro' | 'elevenlabs',
    voice: 'af_heart',
    speed: 1,
    elevenLabsVoice: 'voice',
    elevenLabsSpeed: 1,
  };
  const service = new SpeechService({
    runtimeDirectory: '',
    storageDirectory: '',
    localDesktop: true,
    kokoroSupported: false,
    output,
    cloud,
    settings: () => settings,
  });
  await service.speak('Local.');
  expect(local.manager.acquire).not.toHaveBeenCalled();
  settings.provider = 'elevenlabs';
  const cloudGate = service.speak('Cloud.');
  await settle();
  expect(service.audioEvent({ id: 2, pageId: 7, event: 'ended' })).toBe('ended');
  await cloudGate;
});

it('uses local defaults for a preference saved before providers existed', async () => {
  const output = mock<SpeechOutput>();
  output.prepare = undefined;
  const settings = { enabled: true, provider: 'kokoro' as const, voice: 'af_heart', speed: 1, elevenLabsVoice: '', elevenLabsSpeed: 1 };
  Reflect.deleteProperty(settings, 'provider');
  const service = new SpeechService({
    runtimeDirectory: '',
    storageDirectory: '',
    localDesktop: true,
    output,
    settings: () => settings,
  });
  const gate = service.speak('Local.');
  await settle();
  expect(local.manager.acquire).toHaveBeenCalledTimes(1);
  service.cancel();
  await gate;
});

it('ignores a stale queued cloud watchdog after its request settles', async () => {
  const { cloud, service, output } = cloudHarness();
  const spy = vi.spyOn(globalThis, 'setTimeout');
  cloud.synthesize.mockResolvedValue({ wav: new Uint8Array(44), durationMs: 1000 });
  const gate = service.speak('Hello.');
  const callback: unknown = spy.mock.calls[0]?.[0];
  await settle();
  output.status.mockClear();
  if (!isTimerCallback(callback)) throw new Error('No watchdog');
  callback();
  expect(output.status).not.toHaveBeenCalled();
  service.cancel();
  await gate;
});

it('records a local worker-ready checkpoint before synthesis', async () => {
  const { service, output } = harness();
  const gate = service.speak('Synthetic.');
  await settle();
  await local.ready();
  expect(output.localDiagnostic).toHaveBeenCalledWith('ready', undefined);
  service.cancel();
  await gate;
});

it('reports the worker category the client gives for a retirement before and after readiness', async () => {
  const first = harness();
  const firstGate = first.service.speak('Synthetic.');
  await settle();
  local.retired('model_load');
  await firstGate;
  expect(first.output.localDiagnostic).toHaveBeenCalledWith('failed', 'model_load');
  const second = harness();
  const secondGate = second.service.speak('Synthetic.');
  await settle();
  await local.ready();
  local.retired('worker_error');
  await secondGate;
  expect(second.output.localDiagnostic).toHaveBeenCalledWith('failed', 'worker_error');
});

it('does not let diagnostic callback failures interrupt local speech', async () => {
  const { service, output } = harness();
  vi.mocked(output.localDiagnostic)?.mockImplementation(() => {
    throw new Error('private diagnostic failure');
  });
  const gate = service.speak('Synthetic.');
  await settle();
  await local.ready();
  await local.audio(1);
  expect(service.audioEvent({ id: 1, pageId: 7, event: 'ended' })).toBe('ended');
  await gate;
});

it('handles cloud audio page failures without reporting local runtime failures', async () => {
  for (const mode of ['throw', 'missing', 'failed', 'timeout'] as const) {
    const { cloud, service, output } = cloudHarness();
    cloud.synthesize.mockResolvedValue({ wav: new Uint8Array(44), durationMs: 1000 });
    if (mode === 'throw') {
      output.play.mockImplementationOnce(() => {
        throw new Error('page');
      });
    }
    if (mode === 'missing') output.play.mockReturnValueOnce(undefined);
    const gate = service.speak('Synthetic.');
    await settle();
    if (mode === 'failed') service.audioEvent({ id: 1, pageId: 7, event: 'failed' });
    if (mode === 'timeout') await vi.advanceTimersByTimeAsync(20_000);
    await gate;
    expect(output.localDiagnostic).not.toHaveBeenCalled();
  }
});

it('blocks provider synthesis when output admission rejects or returns unavailable', async () => {
  const { cloud, output, service } = cloudHarness();
  output.prepare = vi.fn().mockResolvedValueOnce(false).mockRejectedValueOnce(new Error('private'));
  await service.speak('One');
  await service.speak('Two');
  expect(cloud.synthesize.mock.calls).toHaveLength(0);
  expect(output.status).toHaveBeenCalledWith(1, 'unavailable', 'Selected speech output is unavailable.');
  expect(output.status).toHaveBeenCalledWith(2, 'unavailable', 'Selected speech output is unavailable.');
  expect(JSON.stringify(output.status.mock.calls)).not.toContain('private');
});

it('starts the provider only after successful current admission', async () => {
  const { cloud, output, service } = cloudHarness();
  const pending = Promise.withResolvers<boolean>();
  output.prepare = vi.fn(() => pending.promise);
  cloud.synthesize.mockReturnValue(new Promise(() => {}));
  const gate = service.speak('One');
  expect(cloud.synthesize.mock.calls).toHaveLength(0);
  pending.resolve(true);
  await settle();
  expect(cloud.synthesize.mock.calls).toHaveLength(1);
  service.cancel();
  await gate;
});

it('times out admission and ignores its late success without sending text', async () => {
  const { cloud, output, service } = cloudHarness();
  const pending = Promise.withResolvers<boolean>();
  output.prepare = vi.fn(() => pending.promise);
  const gate = service.speak('One');
  await vi.advanceTimersByTimeAsync(5000);
  await gate;
  pending.resolve(true);
  await settle();
  expect(cloud.synthesize.mock.calls).toHaveLength(0);
  expect(output.status).toHaveBeenCalledWith(1, 'unavailable', 'Selected speech output is unavailable.');
});

it('ignores canceled admission success or rejection after a replacement starts', async () => {
  const { cloud, output, service } = cloudHarness();
  const first = Promise.withResolvers<boolean>();
  const second = Promise.withResolvers<boolean>();
  output.prepare = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const a = service.speak('One');
  service.cancel();
  await a;
  const b = service.speak('Two');
  first.reject(new Error('private'));
  await settle();
  expect(cloud.synthesize.mock.calls).toHaveLength(0);
  second.resolve(false);
  await b;
  expect(cloud.synthesize.mock.calls).toHaveLength(0);
});

it('ignores a canceled admission timeout after a replacement starts', async () => {
  const { cloud, output, service } = cloudHarness();
  const timers = vi.spyOn(globalThis, 'setTimeout');
  output.prepare = vi.fn(() => new Promise<boolean>(() => {}));
  const first = service.speak('Old');
  const callback: unknown = timers.mock.calls[0]?.[0];
  service.cancel();
  await first;
  const second = service.speak('New');
  if (!isTimerCallback(callback)) throw new Error('No admission timer');
  callback();
  expect(output.status).not.toHaveBeenCalledWith(2, 'unavailable', expect.any(String));
  expect(cloud.synthesize.mock.calls).toHaveLength(0);
  service.cancel();
  await second;
  timers.mockRestore();
});

it('does not let a canceled worker readiness bypass a newer pending output admission', async () => {
  const { service, output } = harness();
  const first = service.speak('Old');
  await settle();
  service.cancel();
  await first;
  const pending = Promise.withResolvers<boolean>();
  output.prepare = vi.fn(() => pending.promise);
  const second = service.speak('New');
  await local.ready();
  expect(local.calls).toHaveLength(0);
  pending.resolve(false);
  await second;
  expect(local.calls).toHaveLength(0);
});

it('starts synthesis only after the newer admission and acquisition succeed', async () => {
  const { service, output } = harness();
  const first = service.speak('Old');
  await settle();
  service.cancel();
  await first;
  const pending = Promise.withResolvers<boolean>();
  output.prepare = vi.fn(() => pending.promise);
  const second = service.speak('New');
  await local.ready();
  expect(local.calls).toHaveLength(0);
  pending.resolve(true);
  await settle();
  await local.ready();
  expect(local.calls.map((call) => call.request)).toEqual([{ id: 2, part: 0, final: true, text: 'New', voice: 'af_heart', speed: 1 }]);
  service.cancel();
  await second;
});

it('retires pending admission on cancel, timeout, and disposal before late results', async () => {
  for (const reason of ['cancel', 'timeout', 'dispose'] as const) {
    const { cloud, output, service } = cloudHarness();
    const pending = Promise.withResolvers<boolean>();
    const cancelOutput = vi.fn();
    Object.assign(output, { cancel: cancelOutput });
    output.prepare = vi.fn(() => pending.promise);
    const gate = service.speak('One');
    if (reason === 'cancel') service.cancel();
    else if (reason === 'dispose') await service.dispose();
    else await vi.advanceTimersByTimeAsync(5000);
    await gate;
    expect(cancelOutput).toHaveBeenCalledWith(1);
    pending.resolve(true);
    await settle();
    expect(cloud.synthesize.mock.calls).toHaveLength(0);
  }
});

it('SentencePipeline waits for the first started acknowledgement before one lookahead and completes only after the final part', async () => {
  const { service, output } = harness();
  output.parts = true;
  const gate = service.speak('First sentence. Second sentence.');
  let done = false;
  void gate.then(() => {
    done = true;
  });
  await settle();
  await local.ready();
  expect(local.calls.at(-1)?.request).toEqual({
    id: 1,
    part: 0,
    final: false,
    text: 'First sentence. ',
    voice: 'af_heart',
    speed: 1,
  });
  await local.audio(1, 0);
  expect(output.play).toHaveBeenCalledWith(1, new Uint8Array(44), 1000, 0);
  expect(local.calls).toHaveLength(1);
  service.audioEvent({ id: 1, pageId: 7, part: 0, event: 'started' });
  expect(local.calls.at(-1)?.request).toEqual({
    id: 1,
    part: 1,
    final: true,
    text: 'Second sentence.',
    voice: 'af_heart',
    speed: 1,
  });
  await local.audio(1, 1);
  expect(output.play).toHaveBeenCalledTimes(1);
  expect(service.audioEvent({ id: 1, pageId: 7, part: 0, event: 'ended' })).toBeUndefined();
  expect(output.play).toHaveBeenCalledTimes(2);
  await settle();
  expect(done).toBe(false);
  service.audioEvent({ id: 1, pageId: 7, part: 0, event: 'ended' });
  expect(done).toBe(false);
  service.audioEvent({ id: 1, pageId: 7, part: 1, event: 'started' });
  expect(service.audioEvent({ id: 1, pageId: 7, part: 1, event: 'ended' })).toBe('ended');
  await gate;
  expect(done).toBe(true);
  expect(output.control).toHaveBeenCalledWith(1, 7, 'stop');
});

it('SentencePipeline does not dispatch the next part until its own started acknowledgement after pause and close', async () => {
  const { service, output } = harness();
  output.parts = true;
  const gate = service.speak('First. Second. Third.');
  await settle();
  await local.ready();
  await local.audio(1, 0);
  service.audioEvent({ id: 1, pageId: 7, part: 0, event: 'started' });
  local.manager.busy.mockReturnValue(true);
  service.audioEvent({ id: 1, pageId: 7, part: 0, event: 'ended' });
  await local.audio(1, 1);
  local.manager.busy.mockReturnValue(false);
  service.pause();
  service.resume();
  expect(local.calls).toHaveLength(2);
  service.audioEvent({ id: 1, pageId: 7, part: 1, event: 'started' });
  expect(local.calls).toHaveLength(3);
  service.cancel();
  await gate;
});

it('NoPausedDispatch: SentencePipeline holds first synthesis while paused during model loading', async () => {
  const { service, output } = harness();
  output.parts = true;
  const gate = service.speak('First. Second.');
  await settle();
  service.pause();
  await local.ready();
  expect(local.calls).toHaveLength(0);
  service.resume();
  expect(local.calls).toHaveLength(1);
  service.cancel();
  await gate;
});

it('SentencePipeline ignores a repeated part result without releasing the current inference', async () => {
  const { service, output } = harness();
  output.parts = true;
  const gate = service.speak('First. Second.');
  await settle();
  await local.ready();
  await local.audio(1, 0);
  service.audioEvent({ id: 1, pageId: 7, part: 0, event: 'started' });
  await local.audio(1, 0);
  service.audioEvent({ id: 1, pageId: 7, part: 0, event: 'ended' });
  expect(output.play).toHaveBeenCalledTimes(1);
  await local.audio(1, 1);
  expect(output.play).toHaveBeenCalledTimes(2);
  service.cancel();
  await gate;
});

it('NoCanceledResume: SentencePipeline cancels a delayed lookahead on reply and ignores its result', async () => {
  const { service, output } = harness();
  output.parts = true;
  const gate = service.speak('First. Second.');
  await settle();
  await local.ready();
  await local.audio(1, 0);
  service.audioEvent({ id: 1, pageId: 7, part: 0, event: 'started' });
  service.cancel();
  await gate;
  await local.audio(1, 1);
  expect(output.play).toHaveBeenCalledTimes(1);
  expect(output.control).toHaveBeenCalledWith(1, 7, 'stop');
});

it('SentencePipeline fails the whole unit if aggregate audio exceeds its bound', async () => {
  const { service, output } = harness();
  output.parts = true;
  const gate = service.speak('First. Second.');
  await settle();
  await local.ready();
  await local.audio(1, 0, 25_000);
  service.audioEvent({ id: 1, pageId: 7, part: 0, event: 'started' });
  await local.audio(1, 1, 16_000);
  await gate;
  expect(output.play).toHaveBeenCalledTimes(1);
  expect(output.status).toHaveBeenCalledWith(1, 'unavailable', 'Generated speech was invalid; continue reading.');
  expect(output.control).toHaveBeenCalledWith(1, 7, 'stop');
});

it('SentencePipeline keeps paused model-ready speech pending past the playback-start deadline', async () => {
  const { service, output } = harness();
  output.parts = true;
  const gate = service.speak('First. Second.');
  let done = false;
  void gate.then(() => {
    done = true;
  });
  await settle();
  service.pause();
  await local.ready();
  await vi.advanceTimersByTimeAsync(21_000);
  expect(done).toBe(false);
  expect(output.status).not.toHaveBeenCalledWith(1, 'unavailable', expect.anything());
  service.resume();
  expect(local.calls).toHaveLength(1);
  service.cancel();
  await gate;
});

it('SentencePipeline does not launch lookahead if a status callback cancels the unit', async () => {
  const { service, output } = harness();
  output.parts = true;
  output.status.mockImplementation((id, state) => {
    if (id === 1 && state === 'speaking') service.cancel();
  });
  const gate = service.speak('First. Second.');
  await settle();
  await local.ready();
  await local.audio(1, 0);
  service.audioEvent({ id: 1, pageId: 7, part: 0, event: 'started' });
  await gate;
  expect(local.calls).toHaveLength(1);
});

it('SentencePipeline fails an end acknowledgement before the part starts', async () => {
  const { service, output } = harness();
  output.parts = true;
  const gate = service.speak('First. Second.');
  await settle();
  await local.ready();
  await local.audio(1, 0);
  expect(service.audioEvent({ id: 1, pageId: 7, part: 0, event: 'ended' })).toBe('failed');
  await gate;
  expect(local.calls).toHaveLength(1);
});

it('SentencePipeline keeps a finished lookahead paused until the current part retires and resumes', async () => {
  const { service, output } = harness();
  output.parts = true;
  const gate = service.speak('First. Second.');
  await settle();
  await local.ready();
  await local.audio(1, 0);
  service.audioEvent({ id: 1, pageId: 7, part: 0, event: 'started' });
  await local.audio(1, 1);
  service.pause();
  service.audioEvent({ id: 1, pageId: 7, part: 0, event: 'ended' });
  expect(output.play).toHaveBeenCalledTimes(1);
  service.resume();
  expect(output.play).toHaveBeenCalledTimes(2);
  service.cancel();
  await gate;
});

it('SentencePipeline discards a late synthesis error after cancellation', async () => {
  const { service, output } = harness();
  output.parts = true;
  const gate = service.speak('First. Second.');
  await settle();
  await local.ready();
  service.cancel();
  await gate;
  await local.failure(1, 0);
  expect(output.status).not.toHaveBeenCalledWith(1, 'unavailable', expect.any(String));
  expect(output.localDiagnostic).not.toHaveBeenCalledWith('failed', 'synthesis');
});

it('SentencePipeline resumes a model that is still loading without losing its watchdog', async () => {
  const { service, output } = harness();
  output.parts = true;
  const gate = service.speak('First. Second.');
  await settle();
  service.pause();
  service.resume();
  await vi.advanceTimersByTimeAsync(20_001);
  await gate;
  expect(output.status).toHaveBeenCalledWith(1, 'unavailable', expect.any(String));
});

it('SentencePipeline keeps the start watchdog frozen when admission completes while paused', async () => {
  const { service, output } = harness();
  output.parts = true;
  const admission = Promise.withResolvers<boolean>();
  output.prepare = vi.fn().mockReturnValue(admission.promise);
  const gate = service.speak('First. Second.');
  let done = false;
  void gate.then(() => {
    done = true;
  });
  service.pause();
  admission.resolve(true);
  await settle();
  await local.ready();
  await vi.advanceTimersByTimeAsync(21_000);
  expect(done).toBe(false);
  service.resume();
  expect(local.calls).toHaveLength(1);
  service.cancel();
  await gate;
});

it('SentencePipeline does not synthesize if a ready diagnostic cancels the unit', async () => {
  const { service, output } = harness();
  output.parts = true;
  output.localDiagnostic = vi.fn((phase) => {
    if (phase === 'ready') service.cancel();
  });
  const gate = service.speak('First. Second.');
  await settle();
  await local.ready();
  await gate;
  expect(local.calls).toHaveLength(0);
});

function tempoHarness(listeningSpeed: number, hasTempo = true, busy = vi.fn(() => false)) {
  const settings: SpeechSettings = {
    enabled: true,
    provider: 'elevenlabs',
    voice: 'af_heart',
    speed: 1,
    elevenLabsVoice: 'voice',
    elevenLabsSpeed: 1.2,
    listeningSpeed,
  };
  const wav = new Uint8Array(44);
  const synthesize = vi.fn().mockResolvedValue({ wav, durationMs: 1000 });
  const transform = vi.fn();
  const dispose = vi.fn().mockResolvedValue(undefined);
  const output: SpeechOutput = {
    play: vi.fn(() => 7),
    control: vi.fn<SpeechOutput['control']>(),
    status: vi.fn<SpeechOutput['status']>(),
  };
  const service = new SpeechService({
    runtimeDirectory: '/runtime',
    storageDirectory: '/storage',
    localDesktop: true,
    settings: () => settings,
    output,
    cloud: { synthesize, voices: vi.fn() },
    ...(hasTempo ? { tempo: { transform, dispose, busy } } : {}),
  });
  return { service, settings, wav, synthesize, transform, dispose, output };
}

describe('listening-speed processing', () => {
  it('Admit: refuses a transformed unit while the previous tempo worker is still retiring', async () => {
    const { service, synthesize, output } = tempoHarness(
      1.25,
      true,
      vi.fn(() => true),
    );
    await service.speak('Selected text.');
    expect(output.status).toHaveBeenCalledWith(1, 'unavailable', 'Speech is still finishing; try again shortly.');
    expect(synthesize).not.toHaveBeenCalled();
  });

  it('admits an unchanged-rate unit even while a tempo worker is retiring', async () => {
    const { service, synthesize, output } = tempoHarness(
      1,
      true,
      vi.fn(() => true),
    );
    const finished = service.speak('Selected text.');
    await vi.waitFor(() => {
      expect(synthesize).toHaveBeenCalledOnce();
    });
    await vi.waitFor(() => {
      expect(output.play).toHaveBeenCalled();
    });
    service.audioEvent({ id: 1, pageId: 7, event: 'started' });
    service.audioEvent({ id: 1, pageId: 7, event: 'ended' });
    await finished;
  });

  beforeEach(() => {
    vi.useRealTimers();
    vi.mocked(decodeSpeechWav).mockReturnValue(new Int16Array([1, -1]));
    vi.mocked(encodeTempoWav).mockReturnValue({ wav: new Uint8Array(48), durationMs: 601 });
  });
  it('snapshots listening speed, transforms once, and uses transformed duration without a second cloud request', async () => {
    const { service, settings, synthesize, transform, output } = tempoHarness(1.25);
    const pending = Promise.withResolvers<Int16Array>();
    transform.mockReturnValueOnce(pending.promise);
    const finished = service.speak('Selected text.');
    await vi.waitFor(() => {
      expect(transform).toHaveBeenCalledOnce();
    });
    settings.listeningSpeed = 1.5;
    expect(transform.mock.calls[0]?.[0]).toMatchObject({ unitId: 1, part: 0, rate: 1.25 });
    expect(output.play).not.toHaveBeenCalled();
    pending.resolve(new Int16Array([1, -1, 1]));
    await vi.waitFor(() => {
      expect(output.play).toHaveBeenCalledWith(1, expect.any(Uint8Array), 601);
    });
    expect(encodeTempoWav).toHaveBeenCalledWith(expect.any(Int16Array), true);
    expect(synthesize).toHaveBeenCalledOnce();
    service.audioEvent({ id: 1, pageId: 7, event: 'started' });
    service.audioEvent({ id: 1, pageId: 7, event: 'ended' });
    await finished;
  });

  it('keeps normal-speed provider WAV byte-identical and makes no transform or extra cloud request', async () => {
    const { service, wav, synthesize, transform, output } = tempoHarness(1);
    const finished = service.speak('Selected text.');
    await vi.waitFor(() => {
      expect(output.play).toHaveBeenCalledWith(1, wav, 1000);
    });
    expect(transform).not.toHaveBeenCalled();
    expect(decodeSpeechWav).not.toHaveBeenCalled();
    expect(synthesize).toHaveBeenCalledOnce();
    service.audioEvent({ id: 1, pageId: 7, event: 'ended' });
    await finished;
  });

  it('ignores a canceled transform result and never plays it', async () => {
    const { service, transform, output } = tempoHarness(1.25);
    const pending = Promise.withResolvers<Int16Array>();
    transform.mockReturnValueOnce(pending.promise);
    const finished = service.speak('Selected text.');
    await vi.waitFor(() => {
      expect(transform).toHaveBeenCalledOnce();
    });
    service.cancel();
    await finished;
    pending.resolve(new Int16Array([1, -1]));
    await Promise.resolve();
    await Promise.resolve();
    expect(output.play).not.toHaveBeenCalled();
    expect(encodeTempoWav).not.toHaveBeenCalled();
  });

  it('fails closed when transformed audio exceeds the complete-unit duration limit', async () => {
    const { service, transform, output } = tempoHarness(0.75);
    transform.mockResolvedValueOnce(new Int16Array([1, -1]));
    vi.mocked(encodeTempoWav).mockReturnValueOnce({ wav: new Uint8Array(48), durationMs: 40_601 });
    await service.speak('Selected text.');
    expect(output.play).not.toHaveBeenCalled();
    expect(output.status).toHaveBeenCalledWith(1, 'unavailable', expect.any(String));
  });

  it('fails closed and releases the unit when the tempo worker rejects', async () => {
    const { service, transform, output } = tempoHarness(1.5);
    transform.mockRejectedValueOnce(new Error('worker failed'));
    await service.speak('Selected text.');
    expect(output.play).not.toHaveBeenCalled();
    expect(output.status).toHaveBeenCalledWith(1, 'unavailable', expect.any(String));
    await service.dispose();
  });

  it('reports unavailable without starting playback when the tempo worker is absent', async () => {
    const { service, output } = tempoHarness(1.25, false);
    await service.speak('Selected text.');
    expect(output.play).not.toHaveBeenCalled();
    expect(output.status).toHaveBeenCalledWith(1, 'unavailable', expect.any(String));
  });

  it.each(['provider waveform', 'worker waveform'] as const)('fails safely on malformed %s', async (which) => {
    const { service, transform, output } = tempoHarness(1.25);
    transform.mockResolvedValue(new Int16Array([1, -1]));
    if (which === 'provider waveform') {
      vi.mocked(decodeSpeechWav).mockImplementationOnce(() => {
        throw new Error('bad waveform');
      });
    } else {
      vi.mocked(encodeTempoWav).mockImplementationOnce(() => {
        throw new Error('bad worker result');
      });
    }
    await service.speak('Selected text.');
    expect(output.play).not.toHaveBeenCalled();
    expect(output.status).toHaveBeenCalledWith(1, 'unavailable', expect.any(String));
  });

  it('ignores rejection from a tempo request after cancellation', async () => {
    const { service, transform, output } = tempoHarness(1.25);
    const pending = Promise.withResolvers<Int16Array>();
    transform.mockReturnValueOnce(pending.promise);
    const finished = service.speak('Selected text.');
    await vi.waitFor(() => {
      expect(transform).toHaveBeenCalledOnce();
    });
    service.cancel();
    pending.reject(new Error('late failure'));
    await finished;
    await Promise.resolve();
    expect(output.play).not.toHaveBeenCalled();
  });

  it('does not report a synchronous worker failure after reentrant cancellation', async () => {
    const { service, transform, output } = tempoHarness(1.25);
    transform.mockImplementationOnce(() => {
      service.cancel();
      throw new Error('failed after cancellation');
    });
    await service.speak('Selected text.');
    expect(output.status).not.toHaveBeenCalledWith(1, 'unavailable', expect.any(String));
  });

  it('absorbs tempo disposal failure after stopping the service', async () => {
    const { service, dispose } = tempoHarness(1.25);
    dispose.mockRejectedValueOnce(new Error('worker already failed'));
    await service.dispose();
    await Promise.resolve();
  });

  it('keeps a completed transform silent while paused and plays it on resume', async () => {
    const { service, transform, output } = tempoHarness(1.25);
    const pending = Promise.withResolvers<Int16Array>();
    transform.mockReturnValueOnce(pending.promise);
    const finished = service.speak('Selected text.');
    await vi.waitFor(() => {
      expect(transform).toHaveBeenCalledOnce();
    });
    service.pause();
    pending.resolve(new Int16Array([1, -1]));
    await vi.waitFor(() => {
      expect(encodeTempoWav).toHaveBeenCalledOnce();
    });
    expect(output.play).not.toHaveBeenCalled();
    service.resume();
    expect(output.play).toHaveBeenCalledWith(1, expect.any(Uint8Array), 601);
    service.audioEvent({ id: 1, pageId: 7, event: 'ended' });
    await finished;
  });

  it('does not start a third synthesis while the second part is still transforming', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    Object.defineProperty(process, 'arch', { value: 'x64', configurable: true });
    const second = Promise.withResolvers<Int16Array>();
    const transform = vi
      .fn()
      .mockResolvedValueOnce(new Int16Array([1, -1]))
      .mockReturnValueOnce(second.promise);
    const output: SpeechOutput = {
      parts: true,
      play: vi.fn(() => 7),
      control: vi.fn<SpeechOutput['control']>(),
      status: vi.fn<SpeechOutput['status']>(),
    };
    const service = new SpeechService({
      runtimeDirectory: '/runtime',
      storageDirectory: '/storage',
      localDesktop: true,
      output,
      tempo: { transform, busy: () => false, dispose: vi.fn().mockResolvedValue(undefined) },
      settings: () => ({
        enabled: true,
        provider: 'kokoro',
        voice: 'af_heart',
        speed: 1,
        elevenLabsVoice: '',
        elevenLabsSpeed: 1,
        listeningSpeed: 1.25,
      }),
    });
    const finished = service.speak('First sentence. Second sentence. Third sentence.');
    await vi.waitFor(() => {
      expect(local.manager.acquire).toHaveBeenCalled();
    });
    await local.ready();
    await local.audio(1, 0);
    await vi.waitFor(() => {
      expect(output.play).toHaveBeenCalledTimes(1);
    });
    service.audioEvent({ id: 1, pageId: 7, part: 0, event: 'started' });
    expect(local.calls).toHaveLength(2);
    await local.audio(1, 1);
    await vi.waitFor(() => {
      expect(transform).toHaveBeenCalledTimes(2);
    });
    service.audioEvent({ id: 1, pageId: 7, part: 0, event: 'ended' });
    expect(local.calls).toHaveLength(2);
    expect(output.play).toHaveBeenCalledTimes(1);
    second.resolve(new Int16Array([1, -1]));
    await vi.waitFor(() => {
      expect(output.play).toHaveBeenCalledTimes(2);
    });
    service.audioEvent({ id: 1, pageId: 7, part: 1, event: 'started' });
    expect(local.calls).toHaveLength(3);
    service.cancel();
    await finished;
    await service.dispose();
  });
});

it('keeps cloud narration available during a local GPU setup check', async () => {
  const cloud = mock<ElevenLabsSpeechPort>();
  cloud.synthesize.mockResolvedValue({ wav: new Uint8Array(44), durationMs: 100 });
  const output = mock<SpeechOutput>();
  output.prepare = undefined;
  output.play.mockReturnValue(7);
  const service = new SpeechService({
    runtimeDirectory: '/runtime',
    storageDirectory: '/storage',
    localDesktop: true,
    cloud,
    output,
    settings: () => ({ enabled: true, provider: 'elevenlabs', voice: 'af_heart', speed: 1, elevenLabsVoice: 'voice', elevenLabsSpeed: 1 }),
  });
  const pending = Promise.withResolvers<import('../src/speech_compute_types').GpuCheck>();
  local.manager.check.mockReturnValueOnce(pending.promise);
  const operation = vi.fn(() => pending.promise);
  const signal = new AbortController().signal;
  const check = service.checkGpu(operation, signal);
  expect(local.manager.check).toHaveBeenCalledWith(operation, signal);
  const unit = service.speak('Hello.');
  await settle();
  expect(cloud.synthesize.mock.calls).toHaveLength(1);
  service.audioEvent({ id: 1, pageId: 7, event: 'ended' });
  await unit;
  pending.resolve({ phase: 'unavailable', reason: 'probe_failed' });
  await check;
});

it.each([
  { saved: 'cpu' as const, selected: 'gpu' as const },
  { saved: 'gpu' as const, selected: 'cpu' as const },
])('uses selected $selected for preview before saved $saved changes', async ({ saved, selected }) => {
  vi.resetModules();
  const lifecycle = mock<import('../src/speech_lifecycle').SpeechLifecycle>();
  let mode: 'cpu' | 'gpu' = saved;
  lifecycle.snapshot.mockImplementation(() => ({
    requestedMode: mode,
    actualBackend: 'none',
    phase: 'cold',
    gpuCheck: { phase: 'idle' },
    generation: 0,
  }));
  lifecycle.select.mockImplementation((value) => {
    if (value === 'cpu' || value === 'gpu') mode = value;
  });
  lifecycle.acquire.mockReturnValue(new Promise(() => {}));
  vi.doMock('../src/speech_lifecycle', () => ({
    // A constructor mock must be constructable.
    // oxlint-disable-next-line eslint/prefer-arrow-callback
    SpeechLifecycle: vi.fn(function () {
      return lifecycle;
    }),
  }));
  try {
    const { SpeechService: IsolatedSpeechService } = await import('../src/speech_service');
    const output = mock<SpeechOutput>();
    output.prepare = undefined;
    const service = new IsolatedSpeechService({
      runtimeDirectory: '/runtime',
      storageDirectory: '/storage',
      localDesktop: true,
      output,
      computeMode: () => saved,
      gpuCapability: vi.fn(),
      createGpu: vi.fn(),
      settings: () => ({ enabled: true, provider: 'kokoro', voice: 'af_heart', speed: 1, elevenLabsVoice: '', elevenLabsSpeed: 1 }),
    });
    service.selectComputeMode(selected);
    const unit = service.preview();
    expect(lifecycle.select).toHaveBeenLastCalledWith(selected);
    expect(lifecycle.acquire).toHaveBeenCalledOnce();
    service.cancel();
    await unit;
  } finally {
    vi.doUnmock('../src/speech_lifecycle');
    vi.resetModules();
  }
});

it('times out discovery without waiting for acquisition and aborts its signal', async () => {
  vi.resetModules();
  const lifecycle = mock<import('../src/speech_lifecycle').SpeechLifecycle>();
  lifecycle.snapshot.mockReturnValue({
    requestedMode: 'cpu',
    actualBackend: 'none',
    phase: 'loading',
    gpuCheck: { phase: 'idle' },
    generation: 0,
  });
  lifecycle.acquire.mockReturnValue(new Promise(() => {}));
  lifecycle.retireWorker.mockReturnValue(false);
  vi.doMock('../src/speech_lifecycle', () => ({
    // A constructor mock must be constructable.
    // oxlint-disable-next-line eslint/prefer-arrow-callback
    SpeechLifecycle: vi.fn(function () {
      return lifecycle;
    }),
  }));
  try {
    const { SpeechService: IsolatedSpeechService } = await import('../src/speech_service');
    const output = mock<SpeechOutput>();
    output.prepare = undefined;
    const service = new IsolatedSpeechService({
      runtimeDirectory: '/runtime',
      storageDirectory: '/storage',
      localDesktop: true,
      output,
      settings: () => ({ enabled: true, provider: 'kokoro', voice: 'af_heart', speed: 1, elevenLabsVoice: '', elevenLabsSpeed: 1 }),
    });
    const unit = service.speak('Hello.');
    const signal = lifecycle.acquire.mock.calls[0]?.[1];
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    await unit;
    expect(lifecycle.retireWorker).toHaveBeenCalledWith('timeout');
    expect(signal?.aborted).toBe(true);
    expect(output.status).toHaveBeenCalledWith(1, 'unavailable', 'Speech timed out; continue reading.');
  } finally {
    vi.doUnmock('../src/speech_lifecycle');
    vi.resetModules();
  }
});

it('supplies cancelable runtime and model discovery callbacks to the manager', async () => {
  const { output } = harness();
  const options = local.options;
  if (options === undefined) throw new Error('Missing lifecycle options');
  const controller = new AbortController();
  vi.mocked(speechRuntimeAvailable).mockResolvedValueOnce(false);
  expect(await options.resolveCpu(controller.signal)).toBeUndefined();
  expect(output.localDiagnostic).toHaveBeenCalledWith('failed', 'runtime_missing');
  expect(await options.resolveCpu(controller.signal)).toBe('/model');
  const runtime = Promise.withResolvers<boolean>();
  vi.mocked(speechRuntimeAvailable).mockReturnValueOnce(runtime.promise);
  const abortedRuntime = options.resolveCpu(controller.signal);
  controller.abort();
  runtime.resolve(true);
  expect(await abortedRuntime).toBeUndefined();
  const modelController = new AbortController();
  const model = Promise.withResolvers<string | undefined>();
  vi.mocked(installedSpeechModel).mockReturnValueOnce(model.promise);
  const abortedModel = options.resolveCpu(modelController.signal);
  await settle();
  modelController.abort();
  model.resolve('/model');
  expect(await abortedModel).toBeUndefined();
});

it('passes GPU proof and worker factories through to the manager', async () => {
  harness();
  const options = local.options;
  if (options === undefined) throw new Error('Missing lifecycle options');
  const signal = new AbortController().signal;
  expect(await options.proveGpu(signal)).toEqual({ check: { phase: 'unavailable', reason: 'runtime_missing' } });
  expect(() => options.createGpu(linuxCapability(), mock())).toThrow('GPU worker unavailable');
  const createGpu = vi.fn(() => mock<LocalSynthesisPort>());
  const gpuCapability = vi.fn().mockResolvedValue({ check: { phase: 'unavailable', reason: 'probe_failed' } });
  const configuredService = new SpeechService({
    runtimeDirectory: '/runtime',
    storageDirectory: '/storage',
    localDesktop: true,
    output: mock<SpeechOutput>(),
    gpuCapability,
    createGpu,
    settings: () => ({ enabled: true, provider: 'kokoro', voice: 'af_heart', speed: 1, elevenLabsVoice: '', elevenLabsSpeed: 1 }),
  });
  expect(configuredService).toBeInstanceOf(SpeechService);
  const configured = local.options;
  if (configured === undefined) throw new Error('Missing lifecycle options');
  await configured.proveGpu(signal);
  expect(gpuCapability).toHaveBeenCalledWith(signal);
  const capability = linuxCapability();
  const listener = mock<LocalListener>();
  configured.createGpu(capability, listener);
  expect(createGpu).toHaveBeenCalledWith(capability, listener);
});

it('CoreMlCompute Check and Load: launches a CoreML worker only after the runtime and model check (#42)', async () => {
  const createCoreMl = vi.fn(() => mock<LocalSynthesisPort>());
  const output = mock<SpeechOutput>();
  const service = new SpeechService({
    runtimeDirectory: '/runtime',
    storageDirectory: '/storage',
    localDesktop: true,
    output,
    createCoreMl,
    computeMode: () => 'gpu',
    settings: () => ({ enabled: true, provider: 'kokoro', voice: 'af_heart', speed: 1, elevenLabsVoice: '', elevenLabsSpeed: 1 }),
  });
  const options = local.options;
  if (options === undefined) throw new Error('Missing lifecycle options');
  const signal = new AbortController().signal;
  vi.mocked(speechRuntimeAvailable).mockResolvedValueOnce(false);
  expect(await options.proveGpu(signal)).toEqual({ check: { phase: 'unavailable', reason: 'runtime_missing' } });
  vi.mocked(speechRuntimeAvailable).mockResolvedValueOnce(true);
  vi.mocked(installedSpeechModel).mockResolvedValueOnce(undefined);
  expect(await options.proveGpu(signal)).toEqual({ check: { phase: 'unavailable', reason: 'model_missing' } });
  vi.mocked(speechRuntimeAvailable).mockResolvedValueOnce(true);
  vi.mocked(installedSpeechModel).mockResolvedValueOnce('/model');
  const result = await options.proveGpu(signal);
  expect(result).toEqual({ check: { phase: 'ready' }, capability: { kind: 'coreml', modelDirectory: '/model' } });
  const aborted = new AbortController();
  aborted.abort();
  vi.mocked(speechRuntimeAvailable).mockResolvedValueOnce(true);
  expect(await options.proveGpu(aborted.signal)).toEqual({ check: { phase: 'unavailable', reason: 'runtime_missing' } });
  const late = new AbortController();
  const lookup = Promise.withResolvers<string | undefined>();
  vi.mocked(speechRuntimeAvailable).mockResolvedValueOnce(true);
  vi.mocked(installedSpeechModel).mockReturnValueOnce(lookup.promise);
  const pending = options.proveGpu(late.signal);
  await settle();
  late.abort();
  lookup.resolve('/model');
  expect(await pending).toEqual({ check: { phase: 'unavailable', reason: 'model_missing' } });
  const listener = mock<LocalListener>();
  options.createGpu({ kind: 'coreml', modelDirectory: '/model' }, listener);
  expect(createCoreMl).toHaveBeenCalledWith(listener);
  expect(() => options.createGpu(linuxCapability(), listener)).toThrow('GPU worker unavailable');
  await service.speak('Hello');
  expect(output.status).not.toHaveBeenCalledWith(1, 'unavailable', expect.stringContaining('unavailable on this computer'));
});

it('refuses a CoreML launch when no CoreML worker factory was given', () => {
  harness();
  const options = local.options;
  if (options === undefined) throw new Error('Missing lifecycle options');
  expect(() => options.createGpu({ kind: 'coreml', modelDirectory: '/model' }, mock<LocalListener>())).toThrow('GPU worker unavailable');
});

it('projects manager snapshots and ignores a repeated mode selection', () => {
  const { service } = harness();
  expect(service.computeState()).toEqual({
    requestedMode: 'cpu',
    actualBackend: 'none',
    gpuCheck: { phase: 'idle' },
    phase: 'cold',
    failureReason: undefined,
  });
  expect(service.computeGeneration()).toBe(0);
  local.change({ generation: 7 });
  expect(service.computeGeneration()).toBe(7);
  service.selectComputeMode('cpu');
  expect(local.manager.select).not.toHaveBeenCalled();
});

it('publishes unavailable GPU checks', () => {
  const checked = vi.fn<(value: Extract<import('../src/speech_compute_types').GpuCheck, { phase: 'unavailable' }>) => void>();
  const output = mock<SpeechOutput>();
  const service = new SpeechService({
    runtimeDirectory: '/runtime',
    storageDirectory: '/storage',
    localDesktop: true,
    output,
    gpuCheck: checked,
    settings: () => ({ enabled: true, provider: 'kokoro', voice: 'af_heart', speed: 1, elevenLabsVoice: '', elevenLabsSpeed: 1 }),
  });
  expect(service).toBeInstanceOf(SpeechService);
  local.change({ phase: 'ready', actualBackend: 'gpu', gpuCheck: { phase: 'unavailable', reason: 'probe_failed' } });
  expect(checked).toHaveBeenCalledWith({ phase: 'unavailable', reason: 'probe_failed' });
});

it('reports readiness from the selected mode and current lifecycle snapshot', () => {
  const { service } = harness();
  local.change({
    requestedMode: 'cpu',
    phase: 'failed',
    gpuCheck: { phase: 'unavailable', reason: 'probe_failed' },
    failureReason: 'worker_error',
  });
  expect(service.localComputeUsable()).toBe(true);
  local.change({ requestedMode: 'auto' });
  expect(service.localComputeUsable()).toBe(true);
  local.change({ requestedMode: 'gpu' });
  expect(service.localComputeUsable()).toBe(false);
  local.change({ gpuCheck: { phase: 'idle' } });
  expect(service.localComputeUsable()).toBe(false);
  local.change({ phase: 'cold' });
  expect(service.localComputeUsable()).toBe(false);
  local.change({ failureReason: undefined });
  expect(service.localComputeUsable()).toBe(true);
  local.change({ gpuCheck: { phase: 'checking' } });
  expect(service.localComputeUsable()).toBe(true);
});

it('refuses explicit GPU when GPU collaborators are missing', async () => {
  const { service, output } = harness(true, () => 'gpu');
  await service.speak('Hello');
  expect(output.status).toHaveBeenCalledWith(1, 'unavailable', 'GPU speech is unavailable on this computer. Choose CPU in Pair Settings.');
  expect(local.manager.acquire).not.toHaveBeenCalled();
});

it.each(['canceled', 'gpu_unavailable'] as const)('handles manager acquisition %s', async (result) => {
  const { service, output } = harness();
  local.manager.acquire.mockResolvedValueOnce(result === 'canceled' ? { status: 'canceled' } : { status: 'unavailable', reason: result });
  const unit = service.speak('Hello');
  await settle();
  if (result === 'canceled') service.cancel();
  await unit;
  if (result === 'gpu_unavailable') {
    expect(output.status).toHaveBeenCalledWith(1, 'unavailable', 'GPU speech is not available. Check GPU setup.');
  }
});

it('does not synthesize before an acquisition returns a lease even if the snapshot is ready', async () => {
  const { service } = harness();
  const unit = service.speak('Hello. Next.');
  local.change({ phase: 'ready' });
  service.pause();
  service.resume();
  expect(local.manager.synthesize).not.toHaveBeenCalled();
  service.cancel();
  await unit;
});

it('tolerates reentrant cancellation from an unavailable status callback', async () => {
  const { service, output } = harness();
  output.status.mockImplementation((id, status) => {
    expect(id).toBe(1);
    if (status === 'unavailable') service.cancel();
  });
  local.manager.acquire.mockResolvedValueOnce({ status: 'unavailable', reason: 'busy' });
  await service.speak('Hello');
  expect(output.status).toHaveBeenCalledWith(1, 'idle');
});

it('asks the manager to retire a loading worker on startup timeout', async () => {
  const { service } = harness();
  const unit = service.speak('Hello');
  local.change({ phase: 'loading' });
  await vi.advanceTimersByTimeAsync(20_000);
  expect(local.manager.retireWorker).toHaveBeenCalledWith('timeout');
  service.cancel();
  await unit;
});

it('uses the fixed worker-exit diagnostic when a retirement has no reason', async () => {
  const { service, output } = harness();
  const unit = service.speak('Hello.');
  await local.ready();
  local.change({ phase: 'retiring', actualBackend: 'none' });
  await unit;
  expect(output.localDiagnostic).toHaveBeenCalledWith('failed', 'worker_exit');
});

it('uses fresh generation snapshots when switching GPU to CPU and back', () => {
  const { service } = harness();
  local.change({
    requestedMode: 'gpu',
    phase: 'failed',
    gpuCheck: { phase: 'unavailable', reason: 'probe_failed' },
    failureReason: 'worker_error',
  });
  expect(service.localComputeUsable()).toBe(false);
  local.change({ requestedMode: 'cpu', phase: 'cold', gpuCheck: { phase: 'idle' }, failureReason: undefined, generation: 1 });
  expect(service.localComputeUsable()).toBe(true);
  local.change({ requestedMode: 'gpu', generation: 2 });
  expect(service.localComputeUsable()).toBe(true);
  local.change({ phase: 'checking', gpuCheck: { phase: 'checking' } });
  expect(service.localComputeUsable()).toBe(true);
  local.change({ phase: 'failed', gpuCheck: { phase: 'unavailable', reason: 'probe_failed' } });
  expect(service.localComputeUsable()).toBe(false);
});

it('reports a fixed worker-module acquisition failure without private details', async () => {
  const { service, output } = harness();
  local.manager.acquire.mockResolvedValueOnce({ status: 'unavailable', reason: 'worker_module' });
  await service.speak('Hello.');
  expect(output.localDiagnostic).toHaveBeenCalledWith('failed', 'worker_module');
  expect(output.status).toHaveBeenCalledWith(1, 'unavailable', 'Local speech stopped. Retry setup.');
});

it('reconciles prewarming only for enabled local speech', () => {
  const { service, local: engine } = harness();
  service.prepare();
  expect(engine.manager.prepare).toHaveBeenCalledWith(true, false);
  const disabled = harness(false);
  disabled.service.prepare();
  expect(disabled.local.manager.prepare).toHaveBeenCalledWith(false, false);
  const output = mock<SpeechOutput>();
  const cloud = new SpeechService({
    runtimeDirectory: '/runtime',
    storageDirectory: '/storage',
    localDesktop: true,
    output,
    settings: () => ({ enabled: true, provider: 'elevenlabs', voice: 'af_heart', speed: 1, elevenLabsVoice: 'voice', elevenLabsSpeed: 1 }),
  });
  cloud.prepare();
  expect(local.manager.prepare).toHaveBeenCalledWith(false, false);
});

it('CloudNarration: snapshots OpenRouter model, voice and ZDR into the shared playback slot', async () => {
  const openRouter = { synthesize: vi.fn().mockResolvedValue({ wav: new Uint8Array(44), durationMs: 1000 }), models: vi.fn() };
  const output = mock<SpeechOutput>();
  output.prepare = undefined;
  output.play.mockReturnValue(7);
  const settings = {
    enabled: true,
    provider: 'openrouter' as const,
    voice: 'af_heart',
    speed: 1,
    elevenLabsVoice: '',
    elevenLabsSpeed: 1,
    openRouterModel: 'model',
    openRouterVoice: 'voice',
    openRouterZdr: true,
  };
  const service = new SpeechService({
    runtimeDirectory: '/runtime',
    storageDirectory: '/storage',
    localDesktop: true,
    output,
    settings: () => settings,
    openRouter,
  });
  const gate = service.speak('Hello.');
  settings.openRouterModel = 'changed';
  await settle();
  expect(openRouter.synthesize).toHaveBeenCalledWith(
    { id: 1, format: 'pcm', text: 'Hello.', modelId: 'model', voiceId: 'voice', zdr: true, purpose: 'narration' },
    expect.any(AbortSignal),
  );
  expect(output.play).toHaveBeenCalledOnce();
  service.audioEvent({ id: 1, pageId: 7, event: 'ended' });
  await gate;
});

it('marks an OpenRouter voice preview separately from session narration', async () => {
  const openRouter = { synthesize: vi.fn().mockResolvedValue({ wav: new Uint8Array(44), durationMs: 1000 }), models: vi.fn() };
  const output = mock<SpeechOutput>();
  output.prepare = undefined;
  output.play.mockReturnValue(7);
  const service = new SpeechService({
    runtimeDirectory: '/runtime',
    storageDirectory: '/storage',
    localDesktop: true,
    output,
    openRouter,
    settings: () => ({
      enabled: true,
      provider: 'openrouter',
      voice: 'af_heart',
      speed: 1,
      elevenLabsVoice: '',
      elevenLabsSpeed: 1,
      openRouterModel: 'model',
      openRouterVoice: 'voice',
    }),
  });
  const gate = service.preview();
  await settle();
  expect(openRouter.synthesize).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'preview' }), expect.any(AbortSignal));
  service.audioEvent({ id: 1, pageId: 7, event: 'ended' });
  await gate;
});

it('CloudNarration: cancels OpenRouter and ignores its late response after credential invalidation', async () => {
  const pending = Promise.withResolvers<{ wav: Uint8Array; durationMs: number }>();
  const openRouter = {
    synthesize: vi.fn<import('../src/speech_types').OpenRouterSpeechPort['synthesize']>().mockReturnValue(pending.promise),
    models: vi.fn(),
  };
  const output = mock<SpeechOutput>();
  output.prepare = undefined;
  const settings = {
    enabled: true,
    provider: 'openrouter' as const,
    voice: 'af_heart',
    speed: 1,
    elevenLabsVoice: '',
    elevenLabsSpeed: 1,
    openRouterModel: 'model',
    openRouterVoice: 'voice',
    openRouterZdr: false,
  };
  const service = new SpeechService({
    runtimeDirectory: '/runtime',
    storageDirectory: '/storage',
    localDesktop: true,
    output,
    settings: () => settings,
    openRouter,
  });
  const gate = service.speak('Hello.');
  const signal = openRouter.synthesize.mock.calls[0]?.[1];
  service.invalidateCloud();
  await gate;
  expect(signal?.aborted).toBe(true);
  pending.resolve({ wav: new Uint8Array(44), durationMs: 1000 });
  await settle();
  expect(output.play).not.toHaveBeenCalled();
});

it('reports OpenRouter failures without naming another provider or leaking exception text', async () => {
  const openRouter = { synthesize: vi.fn().mockRejectedValue({ kind: 'auth', secret: 'private' }), models: vi.fn() };
  const output = mock<SpeechOutput>();
  output.prepare = undefined;
  const settings = {
    enabled: true,
    provider: 'openrouter' as const,
    voice: 'af_heart',
    speed: 1,
    elevenLabsVoice: '',
    elevenLabsSpeed: 1,
    openRouterModel: 'model',
    openRouterVoice: 'voice',
    openRouterZdr: false,
  };
  const service = new SpeechService({
    runtimeDirectory: '/runtime',
    storageDirectory: '/storage',
    localDesktop: true,
    output,
    settings: () => settings,
    openRouter,
  });
  await service.speak('Hello.');
  expect(output.status).toHaveBeenCalledWith(1, 'unavailable', expect.stringContaining('OpenRouter'));
  expect(JSON.stringify(output.status.mock.calls)).not.toContain('private');
});

it('requires an OpenRouter client and model but permits a provider-default voice', async () => {
  const output = mock<SpeechOutput>();
  output.prepare = undefined;
  const settings = {
    enabled: true,
    provider: 'openrouter' as const,
    voice: 'af_heart',
    speed: 1,
    elevenLabsVoice: '',
    elevenLabsSpeed: 1,
    openRouterModel: '',
    openRouterVoice: '',
    openRouterZdr: false,
  };
  const openRouter = { synthesize: vi.fn(), models: vi.fn() };
  const service = new SpeechService({
    runtimeDirectory: '/runtime',
    storageDirectory: '/storage',
    localDesktop: true,
    output,
    settings: () => settings,
    openRouter,
  });
  await service.speak('No model');
  expect(openRouter.synthesize).not.toHaveBeenCalled();
  expect(output.status).toHaveBeenCalledWith(1, 'unavailable', expect.stringContaining('model'));
  settings.openRouterModel = 'model';
  await service.speak('Default voice');
  expect(openRouter.synthesize).toHaveBeenCalledWith(
    { id: 2, format: 'pcm', text: 'Default voice', modelId: 'model', voiceId: '', zdr: false, purpose: 'narration' },
    expect.any(AbortSignal),
  );
  const withoutClient = new SpeechService({
    runtimeDirectory: '/runtime',
    storageDirectory: '/storage',
    localDesktop: true,
    output,
    settings: () => settings,
  });
  settings.openRouterVoice = 'voice';
  await withoutClient.speak('No client');
  expect(openRouter.synthesize).toHaveBeenCalledOnce();
});

it('CatalogEligibility: blocks a remembered pair excluded by current catalog evidence', async () => {
  const openRouter = { synthesize: vi.fn(), models: vi.fn() };
  const output = mock<SpeechOutput>();
  output.prepare = undefined;
  const allowed = vi.fn<(model: string, voice: string) => boolean>().mockReturnValue(false);
  const settings = {
    enabled: true,
    provider: 'openrouter' as const,
    voice: 'af_heart',
    speed: 1,
    elevenLabsVoice: '',
    elevenLabsSpeed: 1,
    openRouterModel: 'model',
    openRouterVoice: 'voice',
    openRouterZdr: true,
  };
  const service = new SpeechService({
    runtimeDirectory: '/runtime',
    storageDirectory: '/storage',
    localDesktop: true,
    output,
    settings: () => settings,
    openRouter,
    openRouterAllowed: allowed,
  });
  await service.speak('No request');
  expect(allowed).toHaveBeenCalledWith('model', 'voice');
  expect(openRouter.synthesize).not.toHaveBeenCalled();
  expect(output.status).toHaveBeenCalledWith(1, 'unavailable', expect.stringContaining('model and voice'));
});

it('CatalogEligibility: rechecks denial after output admission before dispatch', async () => {
  const output = mock<SpeechOutput>();
  const admission = Promise.withResolvers<boolean>();
  output.prepare = vi.fn().mockReturnValue(admission.promise);
  const openRouter = { synthesize: vi.fn(), models: vi.fn() };
  let allowed = true;
  const settings = {
    enabled: true,
    provider: 'openrouter' as const,
    voice: 'af_heart',
    speed: 1,
    elevenLabsVoice: '',
    elevenLabsSpeed: 1,
    openRouterModel: 'model',
    openRouterVoice: 'voice',
    openRouterZdr: true,
  };
  const service = new SpeechService({
    runtimeDirectory: '/runtime',
    storageDirectory: '/storage',
    localDesktop: true,
    output,
    settings: () => settings,
    openRouter,
    openRouterAllowed: () => allowed,
  });
  const gate = service.speak('No request');
  allowed = false;
  admission.resolve(true);
  await gate;
  expect(openRouter.synthesize).not.toHaveBeenCalled();
  expect(output.status).toHaveBeenCalledWith(1, 'unavailable', expect.stringContaining('model and voice'));
});

it('CatalogEligibility: cancels an in-flight OpenRouter request when new evidence denies it', async () => {
  const pending = Promise.withResolvers<{ wav: Uint8Array; durationMs: number }>();
  const openRouter = {
    synthesize: vi.fn<import('../src/speech_types').OpenRouterSpeechPort['synthesize']>().mockReturnValue(pending.promise),
    models: vi.fn(),
  };
  const output = mock<SpeechOutput>();
  output.prepare = undefined;
  let allowed = true;
  const settings = {
    enabled: true,
    provider: 'openrouter' as const,
    voice: 'af_heart',
    speed: 1,
    elevenLabsVoice: '',
    elevenLabsSpeed: 1,
    openRouterModel: 'model',
    openRouterVoice: 'voice',
    openRouterZdr: true,
  };
  const service = new SpeechService({
    runtimeDirectory: '/runtime',
    storageDirectory: '/storage',
    localDesktop: true,
    output,
    settings: () => settings,
    openRouter,
    openRouterAllowed: () => allowed,
  });
  service.openRouterCatalogChanged();
  const gate = service.speak('No request');
  service.openRouterCatalogChanged();
  const signal = openRouter.synthesize.mock.calls[0]?.[1];
  allowed = false;
  service.openRouterCatalogChanged();
  await gate;
  expect(signal?.aborted).toBe(true);
  pending.resolve({ wav: new Uint8Array(44), durationMs: 1000 });
  await settle();
  expect(output.play).not.toHaveBeenCalled();
});

it('SpeechContext: completes only accepted playback and cancels other captures', async () => {
  const complete = vi.fn();
  const cancel = vi.fn();
  contextDouble.capture.mockReturnValue({ previousText: 'Earlier', complete, cancel });
  const openRouter = { synthesize: vi.fn().mockResolvedValue({ wav: new Uint8Array(44), durationMs: 1000 }), models: vi.fn() };
  const output = mock<SpeechOutput>();
  output.prepare = undefined;
  output.play.mockReturnValue(7);
  const service = new SpeechService({
    runtimeDirectory: '',
    storageDirectory: '',
    localDesktop: true,
    output,
    openRouter,
    settings: () => ({
      enabled: true,
      contextEnabled: true,
      provider: 'openrouter',
      voice: 'af_heart',
      speed: 1,
      elevenLabsVoice: '',
      elevenLabsSpeed: 1,
      openRouterModel: 'elevenlabs/eleven-v4',
      openRouterVoice: 'voice',
      openRouterZdr: true,
    }),
  });
  service.setNarrationSession('session', true);
  service.configureNarrationContext();
  const done = service.speak('Hello', 'curious');
  await settle();
  expect(openRouter.synthesize).toHaveBeenCalledWith(
    expect.objectContaining({ text: '[curious] Hello', previousText: 'Earlier' }),
    expect.any(AbortSignal),
  );
  service.audioEvent({ id: 1, pageId: 8, event: 'ended' });
  expect(complete).not.toHaveBeenCalled();
  service.audioEvent({ id: 1, pageId: 7, event: 'ended' });
  await done;
  expect(complete).toHaveBeenCalledOnce();
  const canceled = service.speak('Cancel');
  service.cancel();
  await canceled;
  expect(complete).toHaveBeenCalledOnce();
  expect(cancel).toHaveBeenCalledTimes(2);
  contextDouble.capture.mockReset();
  await service.dispose();
  expect(contextDouble.disconnect).toHaveBeenCalled();
});

it('SpeechContext: configures an empty OpenRouter voice when none is selected', async () => {
  const service = new SpeechService({
    runtimeDirectory: '',
    storageDirectory: '',
    localDesktop: true,
    output: mock<SpeechOutput>(),
    settings: () => ({ enabled: true, provider: 'openrouter', voice: 'af_heart', speed: 1, elevenLabsVoice: '', elevenLabsSpeed: 1 }),
  });
  service.configureNarrationContext();
  expect(contextDouble.configure).toHaveBeenLastCalledWith({ enabled: false, provider: 'openrouter', model: '', voice: '' });
  await service.dispose();
});

it('replays the fixed attention cue without another synthesis or narration context', async () => {
  const { service, output, local: engine } = harness();
  contextDouble.capture.mockClear();
  const first = service.attentionCue();
  await settle();
  await engine.ready();
  expect(engine.calls[0]?.request.text).toBe("What's up?");
  await engine.audio(1);
  service.audioEvent({ id: 1, pageId: 7, event: 'ended' });
  await first;
  const second = service.attentionCue();
  await settle();
  expect(engine.calls).toHaveLength(1);
  expect(output.play).toHaveBeenLastCalledWith(2, new Uint8Array(44), 1000);
  expect(contextDouble.capture).not.toHaveBeenCalled();
  service.audioEvent({ id: 2, pageId: 7, event: 'ended' });
  await second;
});

it('does not cache a canceled attention cue', async () => {
  const { service, output, local: engine } = harness();
  const first = service.attentionCue();
  await settle();
  await engine.ready();
  service.cancel();
  await first;
  await engine.audio(1);
  expect(output.play).not.toHaveBeenCalled();
  const second = service.attentionCue();
  await settle();
  await engine.ready();
  expect(engine.calls).toHaveLength(2);
  service.cancel();
  await second;
});

it('does not synthesize attention audio while disabled', async () => {
  const { service, output, local: engine } = harness(false);
  await service.attentionCue();
  expect(engine.manager.acquire).not.toHaveBeenCalled();
  expect(output.play).not.toHaveBeenCalled();
});

it('invalidates attention audio eagerly when settings change away and back', async () => {
  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
  Object.defineProperty(process, 'arch', { value: 'x64', configurable: true });
  const output = mock<SpeechOutput>();
  output.prepare = undefined;
  output.play.mockReturnValue(7);
  const engine = newLocal();
  let voice = 'af_heart';
  const service = new SpeechService({
    runtimeDirectory: '/runtime',
    storageDirectory: '/storage',
    localDesktop: true,
    output,
    settings: () => ({ enabled: true, provider: 'kokoro', voice, speed: 1, elevenLabsVoice: '', elevenLabsSpeed: 1 }),
  });
  const first = service.attentionCue();
  await settle();
  await engine.ready();
  await engine.audio(1);
  service.audioEvent({ id: 1, pageId: 7, event: 'ended' });
  await first;
  voice = 'am_michael';
  service.configureNarrationContext();
  voice = 'af_heart';
  service.configureNarrationContext();
  const second = service.attentionCue();
  await settle();
  await engine.ready();
  expect(engine.calls).toHaveLength(2);
  service.cancel();
  await second;
});

it('rejects a late attention result after a settings change', async () => {
  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
  Object.defineProperty(process, 'arch', { value: 'x64', configurable: true });
  const output = mock<SpeechOutput>();
  output.prepare = undefined;
  output.play.mockReturnValue(7);
  const engine = newLocal();
  let voice = 'af_heart';
  const service = new SpeechService({
    runtimeDirectory: '/runtime',
    storageDirectory: '/storage',
    localDesktop: true,
    output,
    settings: () => ({ enabled: true, provider: 'kokoro', voice, speed: 1, elevenLabsVoice: '', elevenLabsSpeed: 1 }),
  });
  const first = service.attentionCue();
  await settle();
  await engine.ready();
  voice = 'am_michael';
  service.configureNarrationContext();
  await first;
  await engine.audio(1);
  expect(output.play).not.toHaveBeenCalled();
  const second = service.attentionCue();
  await settle();
  await engine.ready();
  expect(engine.calls).toHaveLength(2);
  service.cancel();
  await second;
});

it('reserves the current route again when replaying attention audio', async () => {
  const { service, output, local: engine } = harness();
  output.prepare = vi.fn().mockResolvedValue(true);
  const first = service.attentionCue();
  await settle();
  await engine.ready();
  await engine.audio(1);
  service.audioEvent({ id: 1, pageId: 7, event: 'ended' });
  await first;
  const second = service.attentionCue();
  await settle();
  expect(output.prepare).toHaveBeenCalledWith(2);
  expect(engine.calls).toHaveLength(1);
  service.audioEvent({ id: 2, pageId: 7, event: 'ended' });
  await second;
});

it('rejects attention synthesis when settings change before notification', async () => {
  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
  Object.defineProperty(process, 'arch', { value: 'x64', configurable: true });
  const output = mock<SpeechOutput>();
  output.prepare = undefined;
  output.play.mockReturnValue(7);
  const engine = newLocal();
  let voice = 'af_heart';
  const service = new SpeechService({
    runtimeDirectory: '/runtime',
    storageDirectory: '/storage',
    localDesktop: true,
    output,
    settings: () => ({ enabled: true, provider: 'kokoro', voice, speed: 1, elevenLabsVoice: '', elevenLabsSpeed: 1 }),
  });
  const cue = service.attentionCue();
  await settle();
  await engine.ready();
  voice = 'am_michael';
  await engine.audio(1);
  await cue;
  expect(output.play).not.toHaveBeenCalled();
});

it('retries attention synthesis after a failed result', async () => {
  const { service, output, local: engine } = harness();
  const first = service.attentionCue();
  await settle();
  await engine.ready();
  await engine.failure(1);
  await first;
  expect(output.play).not.toHaveBeenCalled();
  const second = service.attentionCue();
  await settle();
  await engine.ready();
  expect(engine.calls).toHaveLength(2);
  service.cancel();
  await second;
});

it('rejects cached attention when settings change during output admission', async () => {
  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
  Object.defineProperty(process, 'arch', { value: 'x64', configurable: true });
  const output = mock<SpeechOutput>();
  output.prepare = undefined;
  output.play.mockReturnValue(7);
  const engine = newLocal();
  let voice = 'af_heart';
  const service = new SpeechService({
    runtimeDirectory: '/runtime',
    storageDirectory: '/storage',
    localDesktop: true,
    output,
    settings: () => ({ enabled: true, provider: 'kokoro', voice, speed: 1, elevenLabsVoice: '', elevenLabsSpeed: 1 }),
  });
  const first = service.attentionCue();
  await settle();
  await engine.ready();
  await engine.audio(1);
  service.audioEvent({ id: 1, pageId: 7, event: 'ended' });
  await first;
  const admission = Promise.withResolvers<boolean>();
  output.prepare = vi.fn().mockReturnValue(admission.promise);
  const second = service.attentionCue();
  voice = 'am_michael';
  admission.resolve(true);
  await second;
  expect(output.play).toHaveBeenCalledOnce();
});

it('rejects attention completion after a settings change during playback', async () => {
  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
  Object.defineProperty(process, 'arch', { value: 'x64', configurable: true });
  const output = mock<SpeechOutput>();
  output.prepare = undefined;
  output.play.mockReturnValue(7);
  const engine = newLocal();
  let voice = 'af_heart';
  const service = new SpeechService({
    runtimeDirectory: '/runtime',
    storageDirectory: '/storage',
    localDesktop: true,
    output,
    settings: () => ({ enabled: true, provider: 'kokoro', voice, speed: 1, elevenLabsVoice: '', elevenLabsSpeed: 1 }),
  });
  const first = service.attentionCue();
  await settle();
  await engine.ready();
  await engine.audio(1);
  voice = 'am_michael';
  expect(service.audioEvent({ id: 1, pageId: 7, event: 'ended' })).toBeUndefined();
  await first;
  const second = service.attentionCue();
  await settle();
  await engine.ready();
  expect(engine.calls).toHaveLength(2);
  service.cancel();
  await second;
});
