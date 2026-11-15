import type { GpuCapabilityResult } from './speech_gpu_capability';
import { GpuProcessBusyError } from './speech_gpu_slot';
import type { GpuLaunchCapability } from './speech_gpu_client';
import type { CoreMlLaunch } from './speech_coreml';
import type { GpuCheck, GpuCheckProgress, SpeechComputeBackend, SpeechComputeMode } from './speech_compute_types';
import type { LocalListener, LocalSynthesisOutcome, LocalSynthesisPort, LocalSynthesisRequest } from './speech_local_client';
import type { LocalSpeechFailureReason } from './speech_types';
import { localWorkerError } from './speech_local_protocol';

/** A snapshot of the one owner of local speech resources. */
export interface SpeechLifecycleSnapshot {
  requestedMode: SpeechComputeMode;
  actualBackend: SpeechComputeBackend;
  phase: 'cold' | 'checking' | 'loading' | 'ready' | 'retiring' | 'failed' | 'disposed';
  gpuCheck: GpuCheck;
  generation: number;
  failureReason?: LocalSpeechFailureReason;
}

/** An opaque identity for a single unit using a worker. */
export interface SpeechReadyLease {
  readonly unitId: number;
  readonly generation: number;
}

/** Fixed, non-sensitive reasons an acquisition could not start. */
export type SpeechLifecycleFailure = LocalSpeechFailureReason | 'busy' | 'gpu_unavailable';

/** The result of acquiring a worker for one unit. */
export type SpeechLifecycleResult =
  { status: 'ready'; lease: SpeechReadyLease } | { status: 'canceled' } | { status: 'unavailable'; reason: SpeechLifecycleFailure };

/** The operations that obtain verified resources for the lifecycle owner. */
export interface SpeechLifecycleOptions {
  requestedMode: SpeechComputeMode;
  resolveCpu: (signal: AbortSignal) => Promise<string | undefined>;
  proveGpu: (signal: AbortSignal) => Promise<GpuCapabilityResult>;
  createCpu: (listener: LocalListener) => LocalSynthesisPort;
  createGpu: (capability: GpuLaunchCapability | CoreMlLaunch, listener: LocalListener) => LocalSynthesisPort;
  changed: (snapshot: SpeechLifecycleSnapshot) => void;
}

type Lease =
  | { kind: 'proof'; controller: AbortController }
  | {
      kind: 'worker';
      worker: LocalSynthesisPort;
      backend: 'cpu' | 'gpu';
      planned: boolean;
      ready: Promise<boolean>;
      reap: Promise<void>;
      retire: () => void;
    };

/** Owns local proof and worker leases until their underlying resources are reaped. */
export class SpeechLifecycle {
  private value: SpeechLifecycleSnapshot;
  private lease?: Lease;
  private disposed = false;
  private activeLease?: { identity: SpeechReadyLease; worker: LocalSynthesisPort };
  private serial: Promise<void> = Promise.resolve();
  private warm = false;

  constructor(private readonly options: SpeechLifecycleOptions) {
    this.value = { requestedMode: options.requestedMode, actualBackend: 'none', phase: 'cold', gpuCheck: { phase: 'idle' }, generation: 0 };
  }

  /** Returns the current immutable state. */
  snapshot(): SpeechLifecycleSnapshot {
    return structuredClone(this.value);
  }

  /** Changes the desired backend and invalidates existing acquisition work. */
  select(mode: SpeechComputeMode): void {
    if (this.disposed || this.value.requestedMode === mode) return;
    // specs/SpeechLifecycle.tla, Select: invalidate the old request before retirement.
    this.update({
      requestedMode: mode,
      generation: this.value.generation + 1,
      actualBackend: 'none',
      phase: this.lease === undefined ? 'cold' : 'retiring',
      gpuCheck: { phase: 'idle' },
      failureReason: undefined,
    });
    this.activeLease = undefined;
    this.retire();
    if (this.warm) this.queueWarmup();
  }

  /** Reconciles whether a local worker should be warm before narration. */
  // specs/SpeechWarmup.tla, Change: reconcile demand before starting or retiring work.
  prepare(enabled: boolean, retry = false): void {
    if (
      this.disposed ||
      (this.warm === enabled && !(enabled && retry && (this.value.phase === 'failed' || this.value.failureReason !== undefined)))
    ) {
      return;
    }
    this.warm = enabled;
    if (enabled) {
      this.queueWarmup();
    } else {
      this.update({ generation: this.value.generation + 1, actualBackend: 'none', phase: this.lease === undefined ? 'cold' : 'retiring' });
      this.activeLease = undefined;
      this.retire();
    }
  }

  // specs/SpeechWarmup.tla, Start: serialize startup behind the previous owner.
  private queueWarmup(): void {
    const generation = this.value.generation;
    const operation = this.serial.then(async () => {
      if (!this.warm || this.value.generation !== generation) return;
      const result = await this.acquireSerial(0, generation, new AbortController().signal);
      if (result.status === 'ready' && this.activeLease?.identity === result.lease) this.activeLease = undefined;
    });
    this.serial = operation.catch(() => {});
  }

  /** Acquires the selected backend after all preceding ownership has ended. */
  acquire(unitId: number, signal: AbortSignal): Promise<SpeechLifecycleResult> {
    const generation = this.value.generation;
    const operation = this.serial
      .then(() => this.acquireSerial(unitId, generation, signal))
      .catch(() => ({ status: 'unavailable', reason: 'worker_error' }) as const);
    this.serial = operation.then(() => {});
    return operation;
  }

  /** Runs an explicit setup operation under the same exclusive proof lease. */
  check(
    operation: (signal: AbortSignal, progress: (value: GpuCheckProgress) => void) => Promise<GpuCheck>,
    signal: AbortSignal,
  ): Promise<GpuCheck> {
    const generation = this.value.generation;
    const pending = this.serial
      .then(async () => {
        if (!this.current(generation, signal)) return { phase: 'unavailable', reason: 'inconclusive' } as const;
        if (this.activeLease !== undefined) {
          return { phase: 'unavailable', reason: 'busy' } as const;
        }
        await this.reap();
        if (!this.current(generation, signal)) return { phase: 'unavailable', reason: 'inconclusive' } as const;
        const controller = new AbortController();
        function abort(): void {
          controller.abort();
        }
        signal.addEventListener('abort', abort, { once: true });
        const proof: Lease = { kind: 'proof', controller };
        // specs/SpeechLifecycle.tla, Launch: one proof owns the slot until it settles.
        this.lease = proof;
        this.update({ phase: 'checking', gpuCheck: { phase: 'checking' } });
        let result: GpuCheck;
        try {
          if (!this.current(generation, signal) || controller.signal.aborted) {
            return { phase: 'unavailable', reason: 'inconclusive' } as const;
          }
          result = await operation(controller.signal, (progress) => {
            if (this.lease === proof && this.current(generation, signal) && !controller.signal.aborted) {
              this.update({ gpuCheck: { phase: 'checking', progress } });
            }
          });
        } catch {
          result = { phase: 'unavailable', reason: 'probe_failed' };
        } finally {
          signal.removeEventListener('abort', abort);
          this.lease = undefined;
          if (!this.current(generation, signal)) {
            this.update({ phase: this.disposed ? 'disposed' : 'cold', gpuCheck: { phase: 'idle' } });
          }
        }
        if (this.current(generation, signal)) this.update({ phase: 'cold', gpuCheck: result });
        return this.current(generation, signal) ? result : ({ phase: 'unavailable', reason: 'inconclusive' } as const);
      })
      .catch(() => ({ phase: 'unavailable', reason: 'probe_failed' }) as const);
    this.serial = pending.then(() => {});
    void pending.then(() => {
      if (this.warm && !this.disposed) this.queueWarmup();
    });
    return pending;
  }

  private async acquireSerial(unitId: number, generation: number, signal: AbortSignal): Promise<SpeechLifecycleResult> {
    if (!this.current(generation, signal)) return { status: 'canceled' };
    if (this.activeLease !== undefined) return { status: 'unavailable', reason: 'busy' };
    if (
      this.value.phase === 'ready' &&
      this.lease?.kind === 'worker' &&
      this.lease.worker.state() === 'ready' &&
      !this.lease.worker.busy()
    ) {
      const lease = { unitId, generation };
      this.activeLease = { identity: lease, worker: this.lease.worker };
      return { status: 'ready', lease };
    }
    await this.reap();
    if (!this.current(generation, signal)) return { status: 'canceled' };
    let backend: 'cpu' | 'gpu' = 'cpu';
    let capability: GpuLaunchCapability | CoreMlLaunch | undefined;
    if (this.value.requestedMode !== 'cpu') {
      const controller = new AbortController();
      function abort(): void {
        controller.abort();
      }
      signal.addEventListener('abort', abort, { once: true });
      const proof: Lease = { kind: 'proof', controller };
      // specs/SpeechLifecycle.tla, Launch: one proof owns the slot until it settles.
      this.lease = proof;
      this.update({ phase: 'checking', gpuCheck: { phase: 'checking' } });
      let result: GpuCapabilityResult;
      try {
        if (!this.current(generation, signal) || controller.signal.aborted) return { status: 'canceled' };
        result = await this.options.proveGpu(controller.signal);
      } catch (error: unknown) {
        result = { check: { phase: 'unavailable', reason: error instanceof GpuProcessBusyError ? 'busy' : 'probe_failed' } };
      } finally {
        signal.removeEventListener('abort', abort);
        this.lease = undefined;
        if (!this.current(generation, signal)) {
          this.update({ phase: this.disposed ? 'disposed' : 'cold', gpuCheck: { phase: 'idle' } });
        }
      }
      if (!this.current(generation, signal)) return { status: 'canceled' };
      this.update({ gpuCheck: result.check });
      if (result.check.phase === 'checking' || (result.check.phase === 'unavailable' && result.check.reason === 'busy')) {
        this.update({ phase: 'failed' });
        return { status: 'unavailable', reason: 'busy' };
      }
      if (result.check.phase === 'ready' && result.capability !== undefined) {
        backend = 'gpu';
        capability = result.capability;
      } else if (this.value.requestedMode === 'gpu') {
        this.update({ phase: 'failed' });
        return { status: 'unavailable', reason: 'gpu_unavailable' };
      }
    }
    let model: string | undefined;
    if (backend === 'gpu') {
      model = capability?.modelDirectory;
    } else {
      const controller = new AbortController();
      function abort(): void {
        controller.abort();
      }
      signal.addEventListener('abort', abort, { once: true });
      const resolving: Lease = { kind: 'proof', controller };
      this.lease = resolving;
      this.update({ phase: 'loading' });
      try {
        if (!this.current(generation, signal) || controller.signal.aborted) return { status: 'canceled' };
        model = await this.options.resolveCpu(controller.signal);
      } catch {
        model = undefined;
      } finally {
        signal.removeEventListener('abort', abort);
        this.lease = undefined;
        if (!this.current(generation, signal)) this.update({ phase: this.disposed ? 'disposed' : 'cold' });
      }
    }
    if (!this.current(generation, signal)) return { status: 'canceled' };
    if (model === undefined) {
      this.update({ phase: 'failed' });
      return { status: 'unavailable', reason: 'model_missing' };
    }
    const ready = Promise.withResolvers<boolean>();
    const reaped = Promise.withResolvers<void>();
    let worker: LocalSynthesisPort;
    let owned: Lease;
    let failureReason: LocalSpeechFailureReason = 'worker_error';
    const listener: LocalListener = {
      ready: () => {
        if (this.lease !== owned || !this.current(generation, signal) || worker.state() !== 'ready') return;
        this.update({ phase: 'ready', actualBackend: backend });
        ready.resolve(true);
      },
      retired: (reason: LocalSpeechFailureReason) => {
        if (this.lease !== owned) return;
        failureReason = reason;
        this.activeLease = undefined;
        this.update({
          phase: 'retiring',
          actualBackend: 'none',
          failureReason: owned.kind === 'worker' && owned.planned ? undefined : reason,
        });
        ready.resolve(false);
      },
      // specs/SpeechLifecycle.tla, Reap: an exit, not retirement, releases ownership.
      reaped: () => {
        ready.resolve(false);
        if (this.lease === owned) {
          this.activeLease = undefined;
          this.lease = undefined;
          this.update({ phase: this.disposed ? 'disposed' : 'cold', actualBackend: 'none' });
        }
        reaped.resolve();
      },
    };
    try {
      worker =
        backend === 'gpu' && capability !== undefined ? this.options.createGpu(capability, listener) : this.options.createCpu(listener);
      owned = {
        kind: 'worker',
        worker,
        backend,
        planned: false,
        ready: ready.promise,
        reap: reaped.promise,
        retire: () => {
          worker.retire('worker_exit');
        },
      };
      // specs/SpeechLifecycle.tla, Launch: only a reaped slot can start a worker.
      this.lease = owned;
      this.update({ phase: 'loading', failureReason: undefined });
      if (!this.current(generation, signal)) {
        this.lease = undefined;
        this.update({ phase: this.disposed ? 'disposed' : 'cold' });
        return { status: 'canceled' };
      }
      worker.load(model);
    } catch (error: unknown) {
      if (this.lease?.kind === 'worker') {
        if (this.lease.worker.state() === 'cold') this.lease = undefined;
        else this.lease.retire();
      }
      this.update({ phase: 'failed' });
      return { status: 'unavailable', reason: localWorkerError(error) };
    }
    const abort = (): void => {
      this.retire();
    };
    signal.addEventListener('abort', abort, { once: true });
    const started = await ready.promise;
    signal.removeEventListener('abort', abort);
    if (!this.current(generation, signal)) return { status: 'canceled' };
    if (!started) return { status: 'unavailable', reason: failureReason };
    const lease = { unitId, generation };
    this.activeLease = { identity: lease, worker };
    return { status: 'ready', lease };
  }

  /** Sends inference only through the currently owned unit lease. */
  synthesize(lease: SpeechReadyLease, request: LocalSynthesisRequest): Promise<LocalSynthesisOutcome> {
    const active = this.activeLease;
    if (active?.identity !== lease || request.id !== lease.unitId || active.worker.state() !== 'ready') {
      return Promise.resolve({ status: 'failed', reason: 'canceled' });
    }
    return active.worker.synthesize(request);
  }

  /** Reports whether the owned worker still has an inference in flight. */
  busy(): boolean {
    return this.lease?.kind === 'worker' && this.lease.worker.busy();
  }

  /** Retires the currently owned worker after a timeout or failure. */
  retireWorker(reason: LocalSpeechFailureReason): boolean {
    if (this.lease?.kind !== 'worker') return false;
    this.lease.worker.retire(reason);
    return true;
  }

  /** Releases a unit without discarding an idle warm worker. */
  release(unitId: number): void {
    const active = this.activeLease;
    if (active?.identity.unitId !== unitId) return;
    this.activeLease = undefined;
    active.worker.cancel();
  }

  /** Retires current resources and waits for their actual exit. */
  async dispose(): Promise<void> {
    // specs/SpeechLifecycle.tla, Dispose and Close: wait for actual retirement before closing.
    this.disposed = true;
    this.update({
      generation: this.value.generation + 1,
      actualBackend: 'none',
      phase: this.lease === undefined ? 'disposed' : 'retiring',
    });
    this.retire();
    await this.serial;
    await this.reap();
    this.update({ phase: 'disposed', actualBackend: 'none' });
  }

  private current(generation: number, signal: AbortSignal): boolean {
    return !this.disposed && !signal.aborted && this.value.generation === generation;
  }

  private retire(): void {
    const lease = this.lease;
    if (lease === undefined) return;
    this.update({ phase: 'retiring', actualBackend: 'none' });
    if (lease.kind === 'proof') lease.controller.abort();
    else {
      lease.planned = true;
      lease.retire();
    }
  }

  private async reap(): Promise<void> {
    const lease = this.lease;
    if (lease === undefined || lease.kind !== 'worker') return;
    this.retire();
    await lease.reap;
  }

  private update(patch: Partial<SpeechLifecycleSnapshot>): void {
    this.value = { ...this.value, ...patch };
    try {
      this.options.changed(this.snapshot());
    } catch {
      /* Observers cannot affect ownership. */
    }
  }
}
