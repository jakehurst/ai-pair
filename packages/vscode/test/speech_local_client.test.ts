import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalSynthesisClient, type LocalListener, type LocalSynthesisRequest, type WorkerLike } from '../src/speech_local_client';
import {
  LOCAL_CAPABILITIES,
  LOCAL_MAX_WAV_BYTES,
  LOCAL_PROTOCOL_VERSION,
  LOCAL_REQUEST,
  LOCAL_RESPONSE,
  LOCAL_WORKER_TIMEOUT_MS,
  type LocalRequest,
} from '../src/speech_local_protocol';

const version = LOCAL_PROTOCOL_VERSION;
const WAV = new Uint8Array(44);

/** A worker whose events the test raises by hand; nothing runs in it. */
class FakeWorker implements WorkerLike {
  readonly sent: LocalRequest[] = [];
  readonly listeners = new Map<string, (value: unknown) => void>();
  failPost = false;
  failShutdown = false;
  terminateResult: Promise<unknown> = Promise.resolve(0);
  readonly terminate = vi.fn(() => this.terminateResult);
  readonly postMessage = (message: unknown): void => {
    const parsed = LOCAL_REQUEST.parse(message);
    if (this.failPost || (this.failShutdown && parsed.type === 'shutdown')) throw new Error('closed');
    this.sent.push(parsed);
  };
  readonly on = (event: string, listener: (value: unknown) => void): this => {
    this.listeners.set(event, listener);
    return this;
  };
  /** The requests of one type the worker received, in order. */
  ofType(type: LocalRequest['type']): LocalRequest[] {
    return this.sent.filter((message) => message.type === type);
  }
  /** Raises a raw event, as the worker thread would. */
  raise(event: string, value?: unknown): void {
    this.listeners.get(event)?.(value);
  }
  /** Sends a response after checking that the mock stays within the shared protocol. */
  reply(message: unknown): void {
    this.raise('message', LOCAL_RESPONSE.parse(message));
  }
}

const capabilities = {
  voices: [...LOCAL_CAPABILITIES.voices],
  speeds: [...LOCAL_CAPABILITIES.speeds],
  sampleRate: LOCAL_CAPABILITIES.sampleRate,
  sampleFormat: LOCAL_CAPABILITIES.sampleFormat,
  maxWavBytes: LOCAL_CAPABILITIES.maxWavBytes,
  maxDurationMs: LOCAL_CAPABILITIES.maxDurationMs,
  maxParts: LOCAL_CAPABILITIES.maxParts,
};
/** A ready response for an epoch. */
function ready(epoch = 1) {
  return { type: 'ready', version, epoch, capabilities };
}
/** A result response for a unit, part and epoch. */
function result(id = 1, part = 0, epoch = 1) {
  return { type: 'result', version, epoch, id, part, wav: WAV, durationMs: 1000 };
}
/** A failure response with the given fields. */
function failure(fields: Record<string, unknown>) {
  return { type: 'failure', version, ...fields };
}
/** A request for a unit and part. */
function request(id = 1, part = 0, final = true): LocalSynthesisRequest {
  return { id, part, final, text: 'Hello.', voice: 'af_heart', speed: 1 };
}

/** Makes a client over fake workers and records its listener calls. */
function harness(loadTimeoutMs?: number) {
  const made: FakeWorker[] = [];
  const listener: LocalListener = { ready: vi.fn<() => void>(), retired: vi.fn<(reason: string) => void>() };
  const spawn = vi.fn<(modelPath: string) => WorkerLike>(() => {
    const worker = new FakeWorker();
    made.push(worker);
    return worker;
  });
  const client = new LocalSynthesisClient(loadTimeoutMs === undefined ? { spawn, listener } : { spawn, listener, loadTimeoutMs });
  /** Loads the first worker and makes it ready. */
  function warm(): FakeWorker {
    client.load('/model');
    const worker = made.at(-1);
    if (worker === undefined) throw new Error('No worker');
    worker.reply(ready(made.length));
    return worker;
  }
  return { client, listener, spawn, made, warm };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

it('HandoffAfterReap: reports reaping once only after the matching exit makes the slot cold', async () => {
  const reaped = vi.fn<() => void>();
  const worker = new FakeWorker();
  const observed = new LocalSynthesisClient({
    spawn: () => worker,
    listener: { ready: vi.fn<() => void>(), retired: vi.fn<(reason: string) => void>(), reaped },
  });
  reaped.mockImplementation(() => {
    expect(observed.state()).toBe('cold');
  });
  observed.load('/model');
  observed.retire('worker_exit');
  await Promise.resolve();
  expect(reaped).not.toHaveBeenCalled();
  expect(observed.state()).toBe('retiring');
  worker.raise('exit');
  worker.raise('exit');
  expect(reaped).toHaveBeenCalledOnce();
  expect(observed.state()).toBe('cold');
});

describe('LocalSynthesisClient loading', () => {
  it('OneEngine: one load spawns one worker, sends the host-supplied model once, and refuses a second load', () => {
    const { client, spawn, made } = harness();
    expect(client.state()).toBe('cold');
    client.load('/model');
    expect(client.state()).toBe('loading');
    expect(made[0]?.sent).toEqual([{ type: 'init', version, epoch: 1, modelPath: '/model' }]);
    expect(() => {
      client.load('/model');
    }).toThrow('already');
    expect(spawn).toHaveBeenCalledTimes(1);
    // The transport receives the same host-checked model so it can hand it to its worker's bootstrap.
    expect(spawn).toHaveBeenCalledWith('/model');
    expect(made[0]?.sent).toHaveLength(1);
  });

  it('leaves the client cold and rethrows when the worker cannot be created', () => {
    const { client, spawn } = harness();
    spawn.mockImplementationOnce(() => {
      throw new Error('spawn failed');
    });
    expect(() => {
      client.load('/model');
    }).toThrow('spawn failed');
    expect(client.state()).toBe('cold');
    client.load('/model');
    expect(client.state()).toBe('loading');
  });

  it('ValidReady: accepts only validated capabilities for its own epoch, and reports ready once', () => {
    const { client, listener, made } = harness();
    client.load('/model');
    const worker = made[0];
    worker?.raise('message', { ...ready(), epoch: 2 });
    expect(client.state()).toBe('loading');
    worker?.reply(ready());
    expect(client.state()).toBe('ready');
    worker?.reply(ready());
    expect(listener.ready).toHaveBeenCalledTimes(1);
    expect(listener.retired).not.toHaveBeenCalled();
  });

  it('ValidReady: retires a worker whose capabilities differ from the host constants', () => {
    const { client, listener, made } = harness();
    client.load('/model');
    made[0]?.raise('message', { ...ready(), capabilities: { ...capabilities, sampleRate: 16_000 } });
    expect(client.state()).toBe('retiring');
    expect(listener.ready).not.toHaveBeenCalled();
    expect(listener.retired).toHaveBeenCalledExactlyOnceWith('worker_error');
  });

  it('retires a malformed or unknown message instead of trusting it', () => {
    const { client, listener, warm } = harness();
    const worker = warm();
    worker.raise('message', { type: 'audio', id: 1 });
    expect(client.state()).toBe('retiring');
    expect(listener.retired).toHaveBeenCalledExactlyOnceWith('worker_error');
  });

  it('classifies a fatal load failure and reports an unavailable state until a new explicit load', () => {
    const { client, listener, made } = harness();
    client.load('/model');
    made[0]?.reply(failure({ epoch: 1, category: 'load' }));
    expect(client.state()).toBe('retiring');
    expect(listener.retired).toHaveBeenCalledExactlyOnceWith('model_load');
  });
});

describe('LocalSynthesisClient synthesis', () => {
  it('HealthyProgress: reuses one warm worker and one load for consecutive units', async () => {
    const { client, spawn, warm } = harness();
    const worker = warm();
    const first = client.synthesize(request(1, 0, false));
    expect(worker.sent.at(-1)).toEqual({ type: 'synthesize', version, epoch: 1, ...request(1, 0, false) });
    worker.reply(result(1, 0));
    expect(await first).toEqual({ status: 'audio', wav: WAV, durationMs: 1000 });
    const second = client.synthesize(request(1, 1, true));
    worker.reply(result(1, 1));
    expect(await second).toMatchObject({ status: 'audio' });
    const third = client.synthesize(request(2, 0, true));
    worker.reply(result(2, 0));
    expect(await third).toMatchObject({ status: 'audio' });
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(worker.ofType('init')).toHaveLength(1);
    expect(client.state()).toBe('ready');
    expect(client.busy()).toBe(false);
  });

  it('OneEngine: allows one inference at a time and none before ready', async () => {
    const { client, made } = harness();
    client.load('/model');
    expect(await client.synthesize(request())).toEqual({ status: 'failed', reason: 'unavailable' });
    made[0]?.reply(ready());
    const first = client.synthesize(request());
    expect(client.busy()).toBe(true);
    expect(await client.synthesize(request(2))).toEqual({ status: 'failed', reason: 'unavailable' });
    expect(made[0]?.sent).toHaveLength(2);
    made[0]?.reply(result());
    await first;
  });

  it('rejects an invalid request without posting it or retiring the warm worker', async () => {
    const { client, warm } = harness();
    const worker = warm();
    expect(await client.synthesize({ ...request(), text: '' })).toEqual({ status: 'failed', reason: 'synthesis' });
    expect(worker.sent).toHaveLength(1);
    expect(client.state()).toBe('ready');
  });

  it('NoReplay: a dispatch names exactly the requested unit and part, once', async () => {
    const { client, warm } = harness();
    const worker = warm();
    void client.synthesize(request(3, 2, false));
    worker.reply(result(3, 2));
    await Promise.resolve();
    expect(worker.ofType('synthesize')).toEqual([{ type: 'synthesize', version, epoch: 1, ...request(3, 2, false) }]);
  });

  it('CorrectDelivery: rejects stale epoch, unit and part results before buffering and keeps ownership', async () => {
    const { client, listener, warm } = harness();
    const worker = warm();
    const pending = client.synthesize(request(2, 1));
    worker.raise('message', result(2, 1, 2));
    worker.reply(result(1, 1));
    worker.reply(result(2, 0));
    expect(client.busy()).toBe(true);
    worker.reply(result(2, 1));
    expect(await pending).toMatchObject({ status: 'audio' });
    expect(listener.retired).not.toHaveBeenCalled();
  });

  it('CorrectDelivery: rejects late result, a duplicate after settlement, and an oversized result', async () => {
    const { client, listener, warm } = harness();
    const worker = warm();
    worker.reply(result(1, 0));
    const pending = client.synthesize(request());
    worker.reply(result());
    await pending;
    worker.reply(result());
    expect(client.busy()).toBe(false);
    expect(client.state()).toBe('ready');
    void client.synthesize(request(2));
    worker.raise('message', { ...result(2), wav: new Uint8Array(LOCAL_MAX_WAV_BYTES + 1) });
    expect(client.state()).toBe('retiring');
    expect(listener.retired).toHaveBeenCalledExactlyOnceWith('worker_error');
  });

  it('reports a host synthesis failure for the owning request and keeps the worker warm', async () => {
    const { client, listener, warm } = harness();
    const worker = warm();
    const pending = client.synthesize(request(1, 1));
    worker.reply(failure({ epoch: 1, id: 2, part: 1, category: 'synthesis' }));
    worker.reply(failure({ epoch: 2, id: 1, part: 1, category: 'synthesis' }));
    expect(client.busy()).toBe(true);
    worker.reply(failure({ id: 1, part: 1, category: 'synthesis' }));
    expect(await pending).toEqual({ status: 'failed', reason: 'synthesis' });
    expect(client.state()).toBe('ready');
    expect(client.busy()).toBe(false);
    expect(listener.retired).not.toHaveBeenCalled();
  });

  it('retires on a failure that names the current request but is not a synthesis failure', async () => {
    const { client, listener, warm } = harness();
    const worker = warm();
    const pending = client.synthesize(request());
    worker.reply(failure({ epoch: 1, id: 1, part: 0, category: 'busy' }));
    expect(await pending).toEqual({ status: 'failed', reason: 'worker_error' });
    expect(listener.retired).toHaveBeenCalledExactlyOnceWith('worker_error');
  });

  it('retires on a failure with no owner once the worker is ready', () => {
    const { client, listener, warm } = harness();
    const worker = warm();
    worker.reply(failure({ epoch: 1, category: 'protocol' }));
    expect(client.state()).toBe('retiring');
    expect(listener.retired).toHaveBeenCalledExactlyOnceWith('worker_error');
  });

  it('ignores a failure that names a unit when nothing is outstanding', () => {
    const { client, listener, warm } = harness();
    const worker = warm();
    worker.reply(failure({ epoch: 1, id: 1, part: 0, category: 'synthesis' }));
    expect(client.state()).toBe('ready');
    expect(listener.retired).not.toHaveBeenCalled();
  });
});

describe('LocalSynthesisClient cancellation', () => {
  it('NoCanceledResume: cancel invalidates the result at once but keeps ownership until the inference returns', async () => {
    const { client, warm } = harness();
    const worker = warm();
    const canceled = client.synthesize(request(1, 0, false));
    client.cancel();
    expect(await canceled).toEqual({ status: 'failed', reason: 'canceled' });
    expect(client.busy()).toBe(true);
    expect(await client.synthesize(request(2))).toEqual({ status: 'failed', reason: 'unavailable' });
    client.cancel();
    worker.reply(result(1, 0));
    expect(client.busy()).toBe(false);
    expect(client.state()).toBe('ready');
    expect(worker.ofType('synthesize')).toHaveLength(1);
  });

  it('NoCanceledResume: a canceled inference that fails is discarded and the warm worker is reused', async () => {
    const { client, listener, warm } = harness();
    const worker = warm();
    void client.synthesize(request());
    client.cancel();
    worker.reply(failure({ epoch: 1, id: 1, part: 0, category: 'synthesis' }));
    expect(client.busy()).toBe(false);
    const next = client.synthesize(request(2));
    worker.reply(result(2));
    expect(await next).toMatchObject({ status: 'audio' });
    expect(listener.retired).not.toHaveBeenCalled();
  });

  it('cancel with no inference outstanding does nothing, including while loading', () => {
    const { client, made } = harness();
    client.cancel();
    client.load('/model');
    client.cancel();
    expect(client.state()).toBe('loading');
    expect(made[0]?.terminate).not.toHaveBeenCalled();
  });
});

describe('LocalSynthesisClient retirement', () => {
  it('TruthfulUnavailable: a fatal worker error reports its category, drops the pending result and refuses new work', async () => {
    const { client, listener, warm } = harness();
    const worker = warm();
    const pending = client.synthesize(request());
    worker.raise('error', { code: 'ERR_DLOPEN_FAILED' });
    expect(client.state()).toBe('retiring');
    expect(client.busy()).toBe(false);
    expect(await pending).toEqual({ status: 'failed', reason: 'worker_native' });
    expect(listener.retired).toHaveBeenCalledExactlyOnceWith('worker_native');
    expect(await client.synthesize(request(2))).toEqual({ status: 'failed', reason: 'unavailable' });
    expect(() => {
      client.load('/model');
    }).toThrow('already');
  });

  it('OneEngine: keeps the slot until the actual exit, whatever terminate reports, then retries only on a new load', async () => {
    const { client, spawn, made, warm } = harness();
    const worker = warm();
    worker.terminateResult = Promise.reject(new Error('refused'));
    void client.synthesize(request());
    client.retire('timeout');
    await Promise.resolve();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(client.state()).toBe('retiring');
    client.retire('worker_error');
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledTimes(1);
    worker.raise('exit', 1);
    expect(client.state()).toBe('cold');
    expect(spawn).toHaveBeenCalledTimes(1);
    client.load('/model');
    expect(made[1]?.sent).toEqual([{ type: 'init', version, epoch: 2, modelPath: '/model' }]);
    expect(worker.ofType('synthesize')).toHaveLength(1);
  });

  it('OneEngine: a terminate that resolves does not release the slot before the exit event', () => {
    const { client, warm } = harness();
    const worker = warm();
    client.retire('timeout');
    expect(client.state()).toBe('retiring');
    expect(worker.sent.at(-1)).toEqual({ type: 'shutdown', version });
    worker.raise('exit', 0);
    expect(client.state()).toBe('cold');
  });

  it('absorbs a failure to send the shutdown request', () => {
    const { client, listener, warm } = harness();
    const worker = warm();
    worker.failShutdown = true;
    client.retire('timeout');
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(listener.retired).toHaveBeenCalledExactlyOnceWith('timeout');
  });

  it('retire is a no-op without a worker', () => {
    const { client, listener } = harness();
    client.retire('timeout');
    expect(listener.retired).not.toHaveBeenCalled();
  });

  it('an unexpected exit reports worker_exit and frees the slot at once', async () => {
    const { client, listener, warm } = harness();
    const worker = warm();
    const pending = client.synthesize(request());
    worker.raise('exit', 1);
    expect(client.state()).toBe('cold');
    expect(worker.terminate).not.toHaveBeenCalled();
    expect(await pending).toEqual({ status: 'failed', reason: 'worker_exit' });
    expect(listener.retired).toHaveBeenCalledExactlyOnceWith('worker_exit');
  });

  it('CorrectDelivery: ignores every event from a retiring or replaced worker', () => {
    const { client, listener, made, warm } = harness();
    const old = warm();
    client.retire('timeout');
    old.raise('message', ready());
    old.raise('error', new Error('late'));
    old.raise('exit', 1);
    client.load('/model');
    old.raise('message', ready(2));
    old.raise('error', { code: 'EACCES' });
    old.raise('exit', 1);
    expect(client.state()).toBe('loading');
    expect(made[1]?.terminate).not.toHaveBeenCalled();
    expect(listener.ready).toHaveBeenCalledTimes(1);
    expect(listener.retired).toHaveBeenCalledTimes(1);
  });

  it('retires with a classified reason when the init request cannot be sent', () => {
    const { client, listener, spawn } = harness();
    spawn.mockImplementationOnce(() => {
      const worker = new FakeWorker();
      worker.failPost = true;
      return worker;
    });
    client.load('/model');
    expect(client.state()).toBe('retiring');
    expect(listener.retired).toHaveBeenCalledExactlyOnceWith('worker_error');
  });

  it('retires and fails the pending request when a synthesis request cannot be sent', async () => {
    const { client, listener, warm } = harness();
    const worker = warm();
    worker.failPost = true;
    expect(await client.synthesize(request())).toEqual({ status: 'failed', reason: 'worker_error' });
    expect(client.state()).toBe('retiring');
    expect(listener.retired).toHaveBeenCalledExactlyOnceWith('worker_error');
  });
});

describe('LocalSynthesisClient watchdog', () => {
  it('HealthyProgress: retires a worker that never becomes ready, independent of any unit', () => {
    const { client, listener, made } = harness();
    client.load('/model');
    vi.advanceTimersByTime(LOCAL_WORKER_TIMEOUT_MS - 1);
    expect(client.state()).toBe('loading');
    vi.advanceTimersByTime(1);
    expect(client.state()).toBe('retiring');
    expect(made[0]?.terminate).toHaveBeenCalledTimes(1);
    expect(listener.retired).toHaveBeenCalledExactlyOnceWith('timeout');
  });

  it('HealthyProgress: bounds a slow CoreML load by its own load timeout, and inference by the usual one (#42)', () => {
    const loadTimeoutMs = LOCAL_WORKER_TIMEOUT_MS * 6;
    const { client, listener, made } = harness(loadTimeoutMs);
    client.load('/model');
    vi.advanceTimersByTime(loadTimeoutMs - 1);
    expect(client.state()).toBe('loading');
    made[0]?.reply(ready(1));
    expect(client.state()).toBe('ready');
    void client.synthesize(request());
    vi.advanceTimersByTime(LOCAL_WORKER_TIMEOUT_MS);
    expect(listener.retired).toHaveBeenCalledExactlyOnceWith('timeout');
  });

  it('CancellationProgress: retires a canceled inference that never returns, and clears the timer when it does', () => {
    const { client, listener, warm } = harness();
    const worker = warm();
    vi.advanceTimersByTime(LOCAL_WORKER_TIMEOUT_MS * 2);
    void client.synthesize(request());
    client.cancel();
    worker.reply(result());
    vi.advanceTimersByTime(LOCAL_WORKER_TIMEOUT_MS * 2);
    expect(listener.retired).not.toHaveBeenCalled();
    void client.synthesize(request(2));
    client.cancel();
    vi.advanceTimersByTime(LOCAL_WORKER_TIMEOUT_MS);
    expect(client.state()).toBe('retiring');
    expect(client.busy()).toBe(false);
    expect(listener.retired).toHaveBeenCalledExactlyOnceWith('timeout');
    worker.reply(result(2));
    worker.raise('exit', 1);
    expect(client.state()).toBe('cold');
  });

  it('RetirementProgress: a retired worker that exits returns the client to cold exactly once', () => {
    const { client, listener, warm } = harness();
    const worker = warm();
    client.retire('timeout');
    worker.raise('exit', 1);
    worker.raise('exit', 1);
    expect(client.state()).toBe('cold');
    expect(listener.retired).toHaveBeenCalledTimes(1);
  });
});
