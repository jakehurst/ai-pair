import {
  LOCAL_PROTOCOL_VERSION,
  LOCAL_REQUEST,
  LOCAL_RESPONSE,
  LOCAL_WORKER_TIMEOUT_MS,
  localWorkerError,
  type LocalRequest,
  type LocalResponse,
} from './speech_local_protocol';
import type { LocalSpeechFailureReason } from './speech_types';

/** The transport-neutral worker surface; the shipped transport is a Node worker thread. */
export interface WorkerLike {
  postMessage: (message: unknown) => void;
  on: (event: 'message' | 'error' | 'exit', listener: (value: unknown) => void) => unknown;
  terminate: () => Promise<unknown>;
}

/** One inference the unit asks for; the client adds the protocol version and epoch. */
export type LocalSynthesisRequest = Omit<Extract<LocalRequest, { type: 'synthesize' }>, 'type' | 'version' | 'epoch'>;

/** Why an inference produced no audio. */
export type LocalSynthesisFailure = LocalSpeechFailureReason | 'canceled' | 'unavailable';

/** How one inference ended; the promise never rejects. */
export type LocalSynthesisOutcome =
  { status: 'audio'; wav: Uint8Array; durationMs: number } | { status: 'failed'; reason: LocalSynthesisFailure };

/** The lifecycle facts the client reports to its single owner. */
export interface LocalListener {
  /** Called once when the worker reported valid capabilities for its epoch. */
  ready: () => void;
  /** Called once when the worker was retired or exited, with a fixed category. */
  retired: (reason: LocalSpeechFailureReason) => void;
  /** Called after the matching worker has exited and its slot is cold. */
  reaped?: () => void;
}

/** A worker slot: cold, loading, ready, or retiring until the worker actually exits. */
export type LocalClientState = 'cold' | 'loading' | 'ready' | 'retiring';

/** The operations a narration service uses on its local synthesis engine. */
export interface LocalSynthesisPort {
  /** The slot state; retiring lasts until the worker has exited. */
  state: () => LocalClientState;
  /** True while an inference, even a canceled one, still owns the worker. */
  busy: () => boolean;
  /** Starts the one worker for a new epoch with the host-checked model. */
  load: (modelPath: string) => void;
  /** Dispatches one part; the outcome settles once. */
  synthesize: (request: LocalSynthesisRequest) => Promise<LocalSynthesisOutcome>;
  /** Invalidates the in-flight result while keeping ownership. */
  cancel: () => void;
  /** Retires the worker for a fixed reason. */
  retire: (reason: LocalSpeechFailureReason) => void;
}

/** Inputs of the client: the transport factory and the owner to report to. */
export interface LocalSynthesisClientOptions {
  /** Starts the transport; the model directory is also handed over for its bootstrap (e.g. worker data). */
  spawn(modelPath: string): WorkerLike;
  listener: LocalListener;
  /** Bounds the model load; a CoreML session compiles the model on each load (#42). */
  loadTimeoutMs?: number;
}

interface Inference {
  id: number;
  part: number;
  canceled: boolean;
  settle(outcome: LocalSynthesisOutcome): void;
}

/** Owns one warm local worker: one load, one inference, and its retirement until exit. */
export class LocalSynthesisClient implements LocalSynthesisPort {
  private epoch = 0;
  private worker?: WorkerLike;
  private phase: LocalClientState = 'cold';
  private inference?: Inference;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(private readonly options: LocalSynthesisClientOptions) {}

  /** Reports the slot state; retiring lasts until the worker has exited. */
  state(): LocalClientState {
    return this.phase;
  }

  /** Reports whether an inference, even a canceled one, still owns the worker. */
  busy(): boolean {
    return this.inference !== undefined;
  }

  /** Spawns the one worker for a new epoch and asks it to load the host-checked model. */
  load(modelPath: string): void {
    if (this.phase !== 'cold') {
      throw new Error('The local worker is already started.');
    }
    // specs/WarmSynthesisWorker.tla, Load: only a cold or dead slot starts a new epoch.
    const worker = this.options.spawn(modelPath);
    const epoch = ++this.epoch;
    this.worker = worker;
    this.phase = 'loading';
    worker.on('message', (value: unknown) => {
      this.message(worker, epoch, value);
    });
    worker.on('error', (error: unknown) => {
      this.retireWorker(worker, localWorkerError(error));
    });
    worker.on('exit', () => {
      this.exited(worker);
    });
    this.arm(this.options.loadTimeoutMs);
    try {
      worker.postMessage(LOCAL_REQUEST.parse({ type: 'init', version: LOCAL_PROTOCOL_VERSION, epoch, modelPath }));
    } catch (error: unknown) {
      this.retireWorker(worker, localWorkerError(error));
    }
  }

  /** Dispatches one part to the ready worker; the outcome settles once, by result, failure or retirement. */
  synthesize(request: LocalSynthesisRequest): Promise<LocalSynthesisOutcome> {
    const worker = this.worker;
    if (worker === undefined || this.phase !== 'ready' || this.inference !== undefined) {
      return Promise.resolve({ status: 'failed', reason: 'unavailable' });
    }
    const message = LOCAL_REQUEST.safeParse({ type: 'synthesize', version: LOCAL_PROTOCOL_VERSION, epoch: this.epoch, ...request });
    if (!message.success) {
      return Promise.resolve({ status: 'failed', reason: 'synthesis' });
    }
    const { promise, resolve } = Promise.withResolvers<LocalSynthesisOutcome>();
    this.inference = { id: request.id, part: request.part, canceled: false, settle: resolve };
    this.arm();
    try {
      // specs/WarmSynthesisWorker.tla, Dispatch and NextPart: one request names one unit and part.
      worker.postMessage(message.data);
    } catch {
      this.retireWorker(worker, 'worker_error');
    }
    return promise;
  }

  /** Invalidates the in-flight result now but keeps ownership until it returns or the watchdog retires the worker. */
  cancel(): void {
    const inference = this.inference;
    if (inference === undefined || inference.canceled) {
      return;
    }
    // specs/WarmSynthesisWorker.tla, Cancel: the unit ends; the slot stays owned until DiscardResult or Retire.
    inference.canceled = true;
    inference.settle({ status: 'failed', reason: 'canceled' });
  }

  /** Retires the worker for a fixed reason; the slot is held until the actual exit. */
  retire(reason: LocalSpeechFailureReason): void {
    if (this.worker !== undefined) {
      this.retireWorker(this.worker, reason);
    }
  }

  /** Accepts a response only from the current worker and epoch, and only when it matches what is owed. */
  private message(worker: WorkerLike, epoch: number, value: unknown): void {
    if (worker !== this.worker || this.phase === 'retiring') {
      return;
    }
    const parsed = LOCAL_RESPONSE.safeParse(value);
    if (!parsed.success) {
      this.retireWorker(worker, 'worker_error');
      return;
    }
    const response = parsed.data;
    if (response.epoch !== undefined && response.epoch !== epoch) {
      return;
    }
    if (response.type === 'ready') {
      this.ready();
    } else if (response.type === 'result') {
      this.result(response);
    } else {
      this.failure(worker, response);
    }
  }

  /** Marks a loading worker ready; a duplicate ready changes nothing. */
  private ready(): void {
    if (this.phase !== 'loading') {
      return;
    }
    // specs/WarmSynthesisWorker.tla, Ready: capabilities were validated for this epoch.
    this.clearTimer();
    this.phase = 'ready';
    this.options.listener.ready();
  }

  /** Settles the owed inference with a matching result; any other result is late or stale and changes nothing. */
  private result(response: Extract<LocalResponse, { type: 'result' }>): void {
    const inference = this.inference;
    if (inference === undefined || inference.id !== response.id || inference.part !== response.part) {
      // specs/WarmSynthesisWorker.tla, LateResult: rejected before buffering.
      return;
    }
    // specs/WarmSynthesisWorker.tla, Result and DiscardResult: only the owner of the slot settles it.
    this.clearTimer();
    this.inference = undefined;
    inference.settle({ status: 'audio', wav: response.wav, durationMs: response.durationMs });
  }

  /** Frees a failed inference but keeps the worker warm; any other failure retires the worker. */
  private failure(worker: WorkerLike, response: Extract<LocalResponse, { type: 'failure' }>): void {
    const inference = this.inference;
    if (response.id === undefined) {
      this.retireWorker(worker, this.phase === 'loading' && response.category === 'load' ? 'model_load' : 'worker_error');
      return;
    }
    if (inference === undefined || inference.id !== response.id || inference.part !== response.part) {
      return;
    }
    if (response.category !== 'synthesis') {
      this.retireWorker(worker, 'worker_error');
      return;
    }
    this.clearTimer();
    this.inference = undefined;
    inference.settle({ status: 'failed', reason: 'synthesis' });
  }

  /** Starts retirement once: the slot stays owned until the worker actually exits. */
  private retireWorker(worker: WorkerLike, reason: LocalSpeechFailureReason): void {
    if (worker !== this.worker || this.phase === 'retiring') {
      return;
    }
    // specs/WarmSynthesisWorker.tla, Retire: the worker keeps the slot until Exit.
    this.phase = 'retiring';
    this.clearTimer();
    this.drop(reason);
    try {
      worker.postMessage({ type: 'shutdown', version: LOCAL_PROTOCOL_VERSION });
    } catch {
      // The termination below does not depend on the courtesy shutdown request.
    }
    void worker.terminate().then(
      () => {},
      () => {},
    );
    this.options.listener.retired(reason);
  }

  /** Releases the slot when the worker has exited, reporting an exit nobody asked for. */
  private exited(worker: WorkerLike): void {
    if (worker !== this.worker) {
      return;
    }
    const unexpected = this.phase !== 'retiring';
    // specs/WarmSynthesisWorker.tla, Exit: only the matching exit releases the slot.
    this.clearTimer();
    this.drop('worker_exit');
    this.worker = undefined;
    this.phase = 'cold';
    if (unexpected) {
      this.options.listener.retired('worker_exit');
    }
    this.options.listener.reaped?.();
  }

  /** Ends any owed inference without a result: its text is never replayed. */
  private drop(reason: LocalSpeechFailureReason): void {
    const inference = this.inference;
    this.inference = undefined;
    if (inference !== undefined && !inference.canceled) {
      inference.settle({ status: 'failed', reason });
    }
  }

  /** Bounds the load or the current inference independently of any unit. */
  private arm(ms = LOCAL_WORKER_TIMEOUT_MS): void {
    this.clearTimer();
    const timer = setTimeout(() => {
      this.retire('timeout');
    }, ms);
    this.timer = timer;
  }

  private clearTimer(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }
}
