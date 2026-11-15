import { KOKORO_HOSTS, type SpeechDelivery } from '@ai-pair/protocol';
import { SpeechContext, type NarrationPort } from '@ai-pair/core';
import { speechContextCapabilities } from './speech_context_capabilities';
import * as path from 'node:path';
import { Worker } from 'node:worker_threads';
import { LocalSynthesisClient, type LocalListener, type LocalSynthesisOutcome, type LocalSynthesisPort } from './speech_local_client';
import { LOCAL_MAX_DURATION_MS, LOCAL_MAX_WAV_BYTES, LOCAL_MIN_WAV_BYTES, LOCAL_WORKER_TIMEOUT_MS } from './speech_local_protocol';
import { installedSpeechModel } from './speech_setup';
import { speechRuntimeAvailable } from './speech_runtime_status';
import {
  ELEVENLABS_SPEEDS,
  SPEECH_PREVIEW_TEXT,
  SPEECH_SPEEDS,
  SPEECH_VOICES,
  speechListeningRate,
  type ElevenLabsSpeechPort,
  type OpenRouterAudioFormat,
  type OpenRouterSpeechPort,
  type LocalSpeechFailureReason,
  type SpeechProvider,
  type SpeechSettings,
  type SpeechVoice,
} from './speech_types';
import { speechSegments } from './speech_segments';
import { decodeSpeechWav, encodeTempoWav } from './speech_tempo_pcm';
import type { SpeechTempoRate } from './speech_tempo';
import type { GpuCheck, GpuCheckProgress, SpeechComputeBackend, SpeechComputeMode, SpeechComputeState } from './speech_compute_types';
import type { GpuCapabilityResult } from './speech_gpu_capability';
import type { GpuLaunchCapability } from './speech_gpu_client';
import { SpeechLifecycle, type SpeechReadyLease } from './speech_lifecycle';

/** The panel operations used by local speech; audio is never added to history. */
export interface SpeechOutput {
  /** Supports sequential parts under one local route reservation. */
  parts?: boolean;
  /** Checks and reserves the selected route before synthesis. */
  prepare?: (id: number) => Promise<boolean>;
  /** Cancels a reserved or pending route before a page has begun playback. */
  cancel?: (id: number) => void;
  /** Fixed, non-sensitive local worker lifecycle facts. */
  localDiagnostic?: (phase: 'ready' | 'failed', reason?: LocalSpeechFailureReason) => void;
  /** Posts audio and returns its current page ID, or undefined when no page is ready. */
  play: (id: number, wav: Uint8Array, durationMs: number, part?: number) => number | undefined;
  /** Controls only the audio belonging to the given page and generation. */
  control: (id: number, pageId: number, action: 'pause' | 'resume' | 'stop') => void;
  /** Displays a short live state or a text-only fallback reason. */
  status: (id: number, state: 'preparing' | 'speaking' | 'paused' | 'unavailable' | 'idle', message?: string) => void;
}

/** A local, single-slot tempo worker with cancelable unit ownership. */
export interface SpeechTempoProcessor {
  transform(request: { unitId: number; part: number; rate: SpeechTempoRate; pcm: Int16Array }, signal: AbortSignal): Promise<Int16Array>;
  /** True while a transform, even a retiring one, still owns the worker slot. */
  busy(): boolean;
  dispose(): Promise<void>;
}

/** Fixed, non-sensitive cloud request failure categories. */
export type CloudSpeechFailureReason = 'no_key' | 'auth' | 'rate' | 'network' | 'timeout' | 'invalid' | 'canceled' | 'unknown';

/** Maps only recognized provider categories; never forwards exception text. */
function cloudFailureReason(error: unknown): CloudSpeechFailureReason {
  const kind = typeof error === 'object' && error !== null && 'kind' in error ? error.kind : undefined;
  if (kind === 'key') return 'no_key';
  if (kind === 'auth' || kind === 'rate' || kind === 'network' || kind === 'timeout' || kind === 'invalid' || kind === 'canceled') {
    return kind;
  }
  return 'unknown';
}

/** Gives the programmer a fixed explanation without exposing provider data. */
function cloudFailureMessage(reason: Exclude<CloudSpeechFailureReason, 'canceled'>, provider: SpeechProvider): string {
  if (provider === 'openrouter') return 'OpenRouter speech is unavailable. Check your key, model, voice and account access.';
  switch (reason) {
    case 'no_key':
      return 'Cloud speech needs an ElevenLabs API key.';
    case 'auth':
      return 'ElevenLabs could not authorize this request. Check your key, voice and account access.';
    case 'rate':
      return 'ElevenLabs rate limit reached. Continue reading and try again later.';
    case 'network':
      return 'Cloud speech could not reach ElevenLabs or the service returned an error.';
    case 'timeout':
      return 'Cloud speech timed out; continue reading.';
    case 'invalid':
      return 'Cloud speech received an invalid response or request.';
    default:
      return 'Cloud speech is unavailable. Continue reading.';
  }
}

/** Explains where bundled local speech runs (#39). */
const UNSUPPORTED_HOST_MESSAGE = 'Local speech is available on a local Linux x64 desktop using glibc, or on a Mac.';

/** Inputs needed by the speech service. */
export interface SpeechServiceOptions {
  runtimeDirectory: string;
  storageDirectory: string;
  localDesktop: boolean;
  kokoroSupported?: boolean;
  cloud?: ElevenLabsSpeechPort;
  openRouter?: OpenRouterSpeechPort;
  /** Admits remembered choices until current catalog evidence excludes them. */
  openRouterAllowed?: (model: string, voice: string) => boolean;
  openRouterDiagnostic?: (reason: CloudSpeechFailureReason) => void;
  /** Records a sanitized failure for preview and ordinary narration. */
  cloudDiagnostic?: (reason: CloudSpeechFailureReason) => void;
  tempo?: SpeechTempoProcessor;
  /** Makes the local synthesis engine; absent means the packaged Node worker. */
  createLocal?: (listener: LocalListener) => LocalSynthesisPort;
  output: SpeechOutput;
  settings(): SpeechSettings;
  /** Reads the initial local compute preference once; later changes use selectComputeMode. */
  computeMode?: () => SpeechComputeMode;
  /** Reports the local worker's observed backend. */
  actualBackend?: (value: SpeechComputeBackend) => void;
  /** Publishes the lifecycle owner's compute projection. */
  computeChanged?: (value: SpeechComputeState) => void;
  /** Requests fresh GPU proof before starting a GPU worker. */
  gpuCapability?: (signal: AbortSignal) => Promise<GpuCapabilityResult>;
  /** Creates an isolated GPU worker using the fresh capability. */
  createGpu?: (capability: GpuLaunchCapability, listener: LocalListener) => LocalSynthesisPort;
  /** Starts the speech worker on CoreML, on the one host with that GPU path (#42). */
  createCoreMl?: (listener: LocalListener) => LocalSynthesisPort;
  /** Reports fixed GPU availability when Auto falls back. */
  gpuCheck?: (value: Extract<GpuCheck, { phase: 'unavailable' }>) => void;
}

/** An acknowledgement from the page that received a particular generation. */
export interface SpeechAudioEvent {
  id: number;
  pageId: number;
  event: 'started' | 'ended' | 'failed';
  part?: number;
}

interface ActiveSpeech {
  id: number;
  text: string;
  parts: string[];
  multipart: boolean;
  nextPart: number;
  part: number;
  lookaheadAllowed: boolean;
  buffered?: { part: number; wav: Uint8Array; durationMs: number };
  aggregateMs: number;
  listeningRate: SpeechTempoRate;
  processing?: { part: number; controller: AbortController };
  provider: SpeechProvider;
  computeMode: SpeechComputeMode;
  lifecycleAbort: AbortController;
  lease?: SpeechReadyLease;
  cloudVoice: string;
  openRouterModel: string;
  openRouterZdr: boolean;
  openRouterFormat: OpenRouterAudioFormat;
  voice: SpeechVoice;
  speed: number;
  resolve(): void;
  phase: 'admitting' | 'loading' | 'synthesizing' | 'transforming' | 'prepared' | 'playing';
  wav: Uint8Array;
  durationMs: number;
  pageId?: number;
  started: boolean;
  preview: boolean;
  attention: boolean;
  cueGeneration: number;
  cueAudio?: { wav: Uint8Array; durationMs: number };
  context?: ReturnType<SpeechContext['capture']>;
  providerText: string;
  timer?: ReturnType<typeof setTimeout>;
  deadline?: number;
  remaining: number;
}

/** Maximum time for a worker or page to acknowledge its work. */
const START_TIMEOUT_MS = LOCAL_WORKER_TIMEOUT_MS;
// Three 120-second proof stages plus the physical probe and scheduling allowance.
const GPU_PROOF_TIMEOUT_MS = 400_000;
/** Maximum time to discover a selected output before provider requests. */
const OUTPUT_TIMEOUT_MS = 5000;
/** Extra unpaused time allowed after the waveform's duration. */
const PLAYBACK_GRACE_MS = 5000;
const MIN_WAV_BYTES = LOCAL_MIN_WAV_BYTES;
const MAX_WAV_BYTES = LOCAL_MAX_WAV_BYTES;
const MAX_DURATION_MS = LOCAL_MAX_DURATION_MS;

/** Coordinates one local synthesis job and one page-owned audio buffer. */
export class SpeechService implements NarrationPort {
  private readonly context = new SpeechContext();
  private nextId = 1;
  private current?: ActiveSpeech;
  private paused = false;
  private readonly lifecycle: SpeechLifecycle;
  private cloudBusy?: { id: number; controller: AbortController; timer: ReturnType<typeof setTimeout> };
  private disposed = false;
  private cueKey?: string;
  private cueGeneration = 0;
  private cueCache?: { wav: Uint8Array; durationMs: number };
  private cpuFailure = 'Local speech could not start. Retry setup.';

  constructor(private readonly options: SpeechServiceOptions) {
    this.lifecycle = new SpeechLifecycle({
      requestedMode: options.computeMode?.() ?? 'cpu',
      resolveCpu: async (signal) => {
        const available = await speechRuntimeAvailable(options.runtimeDirectory);
        if (signal.aborted) return undefined;
        if (!available) {
          this.cpuFailure = 'This installation does not include the local speech runtime.';
          this.localDiagnostic('failed', 'runtime_missing');
          return undefined;
        }
        const model = await installedSpeechModel(options.storageDirectory);
        if (signal.aborted) return undefined;
        if (model === undefined) {
          this.cpuFailure = 'Download the Kokoro model in Settings to hear local narration.';
          this.localDiagnostic('failed', 'model_missing');
        }
        return model;
      },
      proveGpu: (signal) =>
        options.gpuCapability?.(signal) ??
        (options.createCoreMl === undefined
          ? Promise.resolve({ check: { phase: 'unavailable', reason: 'runtime_missing' } })
          : this.coreMlLaunch(signal)),
      createCpu: (listener) =>
        options.createLocal?.(listener) ??
        new LocalSynthesisClient({
          spawn: (modelPath) => new Worker(path.join(options.runtimeDirectory, 'worker.mjs'), { workerData: { modelPath } }),
          listener,
        }),
      createGpu: (capability, listener) => {
        // specs/CoreMlCompute.tla, Load: a CoreML launch runs the CPU worker on the CoreML provider.
        if ('kind' in capability) {
          if (options.createCoreMl === undefined) throw new Error('GPU worker unavailable');
          return options.createCoreMl(listener);
        }
        if (options.createGpu === undefined) throw new Error('GPU worker unavailable');
        return options.createGpu(capability, listener);
      },
      changed: (snapshot) => {
        options.actualBackend?.(snapshot.actualBackend);
        options.computeChanged?.({
          phase: snapshot.phase,
          failureReason: snapshot.failureReason,
          requestedMode: snapshot.requestedMode,
          actualBackend: snapshot.actualBackend,
          gpuCheck: snapshot.gpuCheck,
        });
        if (snapshot.gpuCheck.phase === 'unavailable') options.gpuCheck?.(snapshot.gpuCheck);
        const current = this.current;
        if (snapshot.phase === 'ready') this.localDiagnostic('ready');
        if (snapshot.phase === 'retiring' && current?.lease !== undefined) {
          this.localDiagnostic('failed', snapshot.failureReason ?? 'worker_exit');
          this.fail(current, 'Local speech stopped. Retry setup.');
        }
      },
    });
  }

  /**
   * Checks the CoreML path before a GPU launch: the runtime and the installed
   * q8 model. Whether CoreML can run it is proved by the worker's load, and
   * only a loaded worker reports the GPU backend.
   */
  private async coreMlLaunch(signal: AbortSignal): Promise<GpuCapabilityResult> {
    // specs/CoreMlCompute.tla, Check.
    if (!(await speechRuntimeAvailable(this.options.runtimeDirectory)) || signal.aborted) {
      return { check: { phase: 'unavailable', reason: 'runtime_missing' } };
    }
    const model = await installedSpeechModel(this.options.storageDirectory);
    if (model === undefined || signal.aborted) return { check: { phase: 'unavailable', reason: 'model_missing' } };
    return { check: { phase: 'ready' }, capability: { kind: 'coreml', modelDirectory: model } };
  }

  /** Selects the desired backend and invalidates old acquisition work. */
  selectComputeMode(mode: SpeechComputeMode): void {
    if (mode === this.lifecycle.snapshot().requestedMode) return;
    this.cancel();
    this.lifecycle.select(mode);
  }

  /** Reconciles pre-session local worker preparation with current settings. */
  prepare(retry = false): void {
    const settings = this.options.settings();
    this.lifecycle.prepare(
      settings.enabled && settings.provider === 'kokoro' && this.options.localDesktop && this.options.kokoroSupported !== false,
      retry,
    );
  }

  /** Returns the manager's compute state projection. */
  computeState(): SpeechComputeState {
    const { requestedMode, actualBackend, gpuCheck, phase, failureReason } = this.lifecycle.snapshot();
    return { requestedMode, actualBackend, gpuCheck, phase, failureReason };
  }

  /** Returns the manager generation for fencing transient feedback. */
  computeGeneration(): number {
    return this.lifecycle.snapshot().generation;
  }

  /** Runs a GPU setup check under the same resource owner as speech. */
  checkGpu(
    operation: (signal: AbortSignal, progress: (value: GpuCheckProgress) => void) => Promise<GpuCheck>,
    signal: AbortSignal,
  ): Promise<GpuCheck> {
    return this.lifecycle.check(operation, signal);
  }

  /** Reports whether the selected local backend has a known failure. */
  localComputeUsable(): boolean {
    const state = this.lifecycle.snapshot();
    return (
      state.requestedMode !== 'gpu' ||
      (state.gpuCheck.phase !== 'unavailable' && state.phase !== 'failed' && state.failureReason === undefined)
    );
  }

  /** Updates context from the accepted pairing session projection. */
  setNarrationSession(id: string | number, ongoing: boolean): void {
    this.context.session(id, ongoing);
  }

  /** Applies selection changes immediately, including changes between turns. */
  configureNarrationContext(): void {
    const settings = this.options.settings();
    const key = JSON.stringify([
      settings.enabled,
      settings.provider,
      settings.voice,
      settings.speed,
      settings.elevenLabsVoice,
      settings.elevenLabsSpeed,
      settings.openRouterModel,
      settings.openRouterVoice,
      settings.openRouterZdr,
      settings.openRouterFormat,
      speechListeningRate(settings.listeningSpeed),
    ]);
    if (this.cueKey !== key) {
      this.cueKey = key;
      this.cueGeneration++;
      this.cueCache = undefined;
      if (this.current?.attention === true) this.cancel();
    }
    const model = settings.openRouterModel ?? '';
    const voice = settings.provider === 'openrouter' ? (settings.openRouterVoice ?? '') : settings.elevenLabsVoice;
    this.context.configure({
      enabled:
        settings.contextEnabled === true &&
        settings.openRouterZdr === true &&
        speechContextCapabilities(settings.provider, model).previousText,
      provider: settings.provider,
      model,
      voice,
    });
  }

  /** Speaks an explicitly selected live unit when enabled. */
  speak(text: string, delivery?: SpeechDelivery): Promise<void> {
    if (!this.options.settings().enabled) return Promise.resolve();
    if (this.current?.preview === true) this.cancel();
    return this.begin(text, false, delivery);
  }

  /** Plays the fixed, visible voice sample without requiring a pairing session. */
  preview(): Promise<void> {
    return this.begin(SPEECH_PREVIEW_TEXT, true);
  }

  /** Plays the fixed attention cue without adding it to narration context. */
  attentionCue(): Promise<void> {
    if (!this.options.settings().enabled) return Promise.resolve();
    return this.begin("What's up?", false, undefined, true);
  }

  private begin(text: string, preview: boolean, delivery?: SpeechDelivery, attention = false): Promise<void> {
    if (this.current !== undefined || this.disposed) return Promise.resolve();
    const id = this.nextId++;
    const settings = this.options.settings();
    if (!this.options.localDesktop) {
      this.options.output.status(
        id,
        'unavailable',
        settings.provider !== 'kokoro' ? 'Cloud speech is available only on a local desktop.' : UNSUPPORTED_HOST_MESSAGE,
      );
      return Promise.resolve();
    }
    const provider = settings.provider ?? 'kokoro';
    if (provider !== 'kokoro' && provider !== 'elevenlabs' && provider !== 'openrouter') {
      this.options.output.status(id, 'unavailable', 'Choose a supported speech provider.');
      return Promise.resolve();
    }
    // specs/GpuSetup.tla, ExplicitNoFallback: explicit GPU must never fall back to the CPU worker.
    const computeMode = this.lifecycle.snapshot().requestedMode;
    if (
      provider === 'kokoro' &&
      computeMode === 'gpu' &&
      (this.options.gpuCapability === undefined || this.options.createGpu === undefined) &&
      this.options.createCoreMl === undefined
    ) {
      // specs/CoreMlCompute.tla, NoGpuWithoutPath: a saved GPU setting fails visibly here.
      this.options.output.status(id, 'unavailable', 'GPU speech is unavailable on this computer. Choose CPU in Pair Settings.');
      return Promise.resolve();
    }
    const voice = SPEECH_VOICES.find((candidate) => candidate === settings.voice);
    if (
      provider === 'kokoro' &&
      (this.options.kokoroSupported === false || !KOKORO_HOSTS.includes(`${process.platform}-${process.arch}`))
    ) {
      this.options.output.status(id, 'unavailable', UNSUPPORTED_HOST_MESSAGE);
      return Promise.resolve();
    }
    if (provider === 'kokoro' && (voice === undefined || !SPEECH_SPEEDS.some((speed) => speed === settings.speed))) {
      this.options.output.status(id, 'unavailable', 'Choose a supported speech voice and speed.');
      return Promise.resolve();
    }
    if (
      provider === 'elevenlabs' &&
      (this.options.cloud === undefined ||
        settings.elevenLabsVoice.length === 0 ||
        !ELEVENLABS_SPEEDS.some((speed) => speed === settings.elevenLabsSpeed))
    ) {
      this.options.output.status(id, 'unavailable', 'Choose an available ElevenLabs voice and speed.');
      return Promise.resolve();
    }
    const openRouterModel = settings.openRouterModel ?? '';
    const openRouterVoice = settings.openRouterVoice ?? '';
    if (
      provider === 'openrouter' &&
      (this.options.openRouter === undefined ||
        openRouterModel === '' ||
        this.options.openRouterAllowed?.(openRouterModel, openRouterVoice) === false)
    ) {
      this.options.output.status(id, 'unavailable', 'Choose an available OpenRouter model and voice.');
      return Promise.resolve();
    }
    // specs/SpeechTempo.tla, Admit: a transformed unit waits for the previous transform worker to retire.
    const listeningRate = speechListeningRate(settings.listeningSpeed);
    if (this.cloudBusy !== undefined || (listeningRate !== 1 && this.options.tempo?.busy() === true)) {
      this.options.output.status(id, 'unavailable', 'Speech is still finishing; try again shortly.');
      return Promise.resolve();
    }
    this.configureNarrationContext();
    const capabilities = speechContextCapabilities(provider, openRouterModel);
    const context = preview || attention ? undefined : this.context.capture(text);
    const cue =
      !preview && settings.contextEnabled === true && capabilities.tags && delivery !== undefined && delivery !== 'neutral'
        ? `[${delivery}] `
        : '';
    const { promise, resolve } = Promise.withResolvers<void>();
    const current: ActiveSpeech = {
      id,
      text,
      context,
      providerText: cue + text,
      parts: provider === 'kokoro' && this.options.output.parts === true ? speechSegments(text) : [text],
      multipart: false,
      nextPart: 0,
      part: 0,
      lookaheadAllowed: false,
      aggregateMs: 0,
      // specs/SpeechTempo.tla, Select: the unit samples its listening rate once, here.
      listeningRate,
      provider,
      computeMode,
      lifecycleAbort: new AbortController(),
      cloudVoice: provider === 'openrouter' ? openRouterVoice : settings.elevenLabsVoice,
      openRouterModel,
      openRouterZdr: settings.openRouterZdr === true,
      openRouterFormat: settings.openRouterFormat ?? 'pcm',
      voice: voice ?? 'af_heart',
      speed: provider === 'elevenlabs' ? settings.elevenLabsSpeed : settings.speed,
      resolve,
      phase: 'admitting',
      wav: new Uint8Array(),
      durationMs: 0,
      started: false,
      preview,
      attention,
      cueGeneration: this.cueGeneration,
      remaining: START_TIMEOUT_MS,
    };
    current.multipart = current.parts.length > 1;
    this.current = current;
    this.options.output.status(id, 'preparing');
    if (this.current === current) {
      if (this.options.output.prepare === undefined) this.beginProvider(current);
      else void this.admit(current);
    }
    return promise;
  }

  private beginProvider(current: ActiveSpeech): void {
    // specs/OutputHandoff.tla, Admit: worker readiness cannot bypass admission.
    // specs/OpenRouterCatalog.tla, Admit: recheck current evidence after output admission.
    if (current.provider === 'openrouter' && this.options.openRouterAllowed?.(current.openRouterModel, current.cloudVoice) === false) {
      this.fail(current, 'Choose an available OpenRouter model and voice.');
      return;
    }
    if (current.attention && this.cueCache !== undefined) {
      this.acceptAudio(current, 0, this.cueCache);
      return;
    }
    current.phase = 'loading';
    if (current.provider !== 'kokoro') this.startCloud(current);
    else {
      this.armStartup(current, START_TIMEOUT_MS);
      void this.start(current);
    }
  }

  private async admit(current: ActiveSpeech): Promise<void> {
    current.timer = setTimeout(() => {
      if (this.current === current) this.fail(current, 'Selected speech output is unavailable.');
    }, OUTPUT_TIMEOUT_MS);
    try {
      const ready = await this.options.output.prepare?.(current.id);
      if (this.current !== current) return;
      this.clearTimer(current);
      if (ready !== true) this.fail(current, 'Selected speech output is unavailable.');
      else this.beginProvider(current);
    } catch {
      if (this.current === current) this.fail(current, 'Selected speech output is unavailable.');
    }
  }

  /** CloudNarration: one request owns its slot until settlement or watchdog. */
  private startCloud(current: ActiveSpeech): void {
    const cloud = current.provider === 'openrouter' ? this.options.openRouter : this.options.cloud;
    if (cloud === undefined) {
      this.failCloud(current, 'unknown');
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      if (this.cloudBusy?.id !== current.id) return;
      controller.abort();
      this.cloudBusy = undefined;
      if (this.current === current) this.failCloud(current, 'timeout');
    }, START_TIMEOUT_MS);
    this.cloudBusy = { id: current.id, controller, timer };
    current.phase = 'synthesizing';
    const release = (): void => {
      if (this.cloudBusy?.id !== current.id) return;
      clearTimeout(timer);
      this.cloudBusy = undefined;
    };
    try {
      const request =
        'models' in cloud
          ? cloud.synthesize(
              {
                id: current.id,
                text: current.providerText,
                ...(current.context?.previousText === undefined ? {} : { previousText: current.context.previousText }),
                modelId: current.openRouterModel,
                voiceId: current.cloudVoice,
                zdr: current.openRouterZdr,
                format: current.openRouterFormat,
                purpose: current.preview ? 'preview' : 'narration',
              },
              controller.signal,
            )
          : cloud.synthesize({ text: current.text, voiceId: current.cloudVoice, speed: current.speed }, controller.signal);
      void request.then(
        (audio) => {
          release();
          if (this.current !== current || controller.signal.aborted) return;
          this.receiveAudio(current, 0, audio, true);
        },
        (error: unknown) => {
          release();
          if (this.current === current) this.failCloud(current, cloudFailureReason(error));
        },
      );
    } catch (error: unknown) {
      release();
      this.failCloud(current, cloudFailureReason(error));
    }
  }

  private failCloud(current: ActiveSpeech, reason: CloudSpeechFailureReason): void {
    if (this.current !== current) return;
    try {
      if (current.provider === 'openrouter') this.options.openRouterDiagnostic?.(reason);
      else this.options.cloudDiagnostic?.(reason);
    } catch {
      /* Observability must not change speech behavior. */
    }
    if (reason === 'canceled') this.finish(current);
    else this.fail(current, cloudFailureMessage(reason, current.provider));
  }

  /** Cancels a current selection when new catalog evidence excludes it. */
  openRouterCatalogChanged(): void {
    const current = this.current;
    if (current?.provider === 'openrouter' && this.options.openRouterAllowed?.(current.openRouterModel, current.cloudVoice) === false) {
      this.cancel();
    }
  }

  /** A credential change invalidates current cloud audio and pending requests. */
  invalidateCloud(): void {
    this.cueGeneration++;
    this.cueCache = undefined;
    this.cloudBusy?.controller.abort();
    if (this.current !== undefined && this.current.provider !== 'kokoro') this.cancel();
  }

  private async start(current: ActiveSpeech): Promise<void> {
    if (current.computeMode !== 'cpu') this.armStartup(current, GPU_PROOF_TIMEOUT_MS);
    const result = await this.lifecycle.acquire(current.id, current.lifecycleAbort.signal);
    if (this.current !== current) return;
    if (result.status === 'canceled') return;
    if (result.status === 'unavailable') {
      if (result.reason !== 'busy' && result.reason !== 'gpu_unavailable' && result.reason !== 'model_missing') {
        this.localDiagnostic('failed', result.reason);
      }
      this.fail(
        current,
        result.reason === 'busy'
          ? 'Speech is still finishing; try again shortly.'
          : result.reason === 'gpu_unavailable'
            ? 'GPU speech is not available. Check GPU setup.'
            : result.reason === 'model_missing'
              ? this.cpuFailure
              : 'Local speech stopped. Retry setup.',
      );
      return;
    }
    current.lease = result.lease;
    this.armStartup(current, START_TIMEOUT_MS);
    this.synthesize(current);
  }

  private synthesize(current: ActiveSpeech): void {
    if (this.current !== current || this.lifecycle.snapshot().phase !== 'ready' || (this.paused && current.multipart)) return;
    const part = current.nextPart;
    // A bounded slice is empty if an internal ordinal is invalid; the client rejects it.
    const text = current.parts.slice(part, part + 1).join('');
    current.nextPart++;
    if (current.phase !== 'playing') current.phase = 'synthesizing';
    if (current.phase !== 'playing') this.clearTimer(current);
    // specs/SentencePipeline.tla, Synthesize: one inference owns its unit and part.
    if (current.lease === undefined) return;
    void this.lifecycle
      .synthesize(current.lease, {
        id: current.id,
        part,
        final: part === current.parts.length - 1,
        text,
        voice: current.voice,
        speed: current.speed,
      })
      .then((outcome) => {
        this.localOutcome(current, part, outcome);
      });
  }

  /** Starts at most one lookahead after the prior part actually started. */
  private lookahead(current: ActiveSpeech): void {
    if (
      this.current !== current ||
      !current.multipart ||
      this.paused ||
      !current.lookaheadAllowed ||
      current.buffered !== undefined ||
      current.processing !== undefined ||
      this.lifecycle.busy() ||
      this.lifecycle.snapshot().phase !== 'ready' ||
      current.nextPart >= current.parts.length
    ) {
      return;
    }
    this.synthesize(current);
  }

  /** Applies one inference outcome to the unit that asked for it, if that unit is still current. */
  private localOutcome(current: ActiveSpeech, part: number, outcome: LocalSynthesisOutcome): void {
    // specs/SentencePipeline.tla, SynthDone: a stale outcome cannot touch another unit.
    if (this.current !== current) return;
    if (outcome.status === 'audio') {
      this.receiveAudio(current, part, outcome, part === current.parts.length - 1);
    } else {
      // A retirement already ended the unit through localRetired, and a cancellation is the
      // service's own, so a failure that reaches a current unit is a synthesis the client refused.
      this.localDiagnostic('failed', 'synthesis');
      this.fail(current, 'Could not speak this text. Continue reading it.');
    }
  }

  /** Applies listening speed locally before exposing a waveform to playback. */
  private receiveAudio(current: ActiveSpeech, part: number, audio: { wav: Uint8Array; durationMs: number }, final: boolean): void {
    if (current.attention) {
      this.configureNarrationContext();
      if (this.current !== current) return;
    }
    if (
      audio.wav.length < MIN_WAV_BYTES ||
      audio.wav.length > MAX_WAV_BYTES ||
      !Number.isFinite(audio.durationMs) ||
      audio.durationMs <= 0
    ) {
      this.fail(current, 'Generated speech was invalid; continue reading.');
      return;
    }
    if (current.listeningRate === 1) {
      this.acceptAudio(current, part, audio);
      return;
    }
    const tempo = this.options.tempo;
    if (tempo === undefined || current.processing !== undefined) {
      this.fail(current, 'Listening speed is unavailable; continue reading.');
      return;
    }
    // specs/SpeechTempo.tla, Transform: one unit and part own the one transform.
    const processing = { part, controller: new AbortController() };
    current.processing = processing;
    if (current.phase !== 'playing') current.phase = 'transforming';
    try {
      const pcm = decodeSpeechWav(audio.wav, final);
      void tempo.transform({ unitId: current.id, part, rate: current.listeningRate, pcm }, processing.controller.signal).then(
        (result) => {
          if (this.current !== current || current.processing !== processing || processing.controller.signal.aborted) return;
          current.processing = undefined;
          try {
            this.acceptAudio(current, part, encodeTempoWav(result, final));
          } catch {
            this.fail(current, 'Listening speed is unavailable; continue reading.');
          }
        },
        () => {
          if (this.current === current && current.processing === processing) {
            current.processing = undefined;
            this.fail(current, 'Listening speed is unavailable; continue reading.');
          }
        },
      );
    } catch {
      if (this.current === current) {
        current.processing = undefined;
        this.fail(current, 'Listening speed is unavailable; continue reading.');
      }
    }
  }

  /** Bounds the complete transformed unit and buffers at most one next part. */
  private acceptAudio(current: ActiveSpeech, part: number, audio: { wav: Uint8Array; durationMs: number }): void {
    if (current.attention) {
      this.configureNarrationContext();
      if (this.current !== current) return;
    }
    // specs/SpeechTempo.tla, Result and Play: duration and the aggregate bound come from the transformed samples.
    if (
      audio.wav.length < MIN_WAV_BYTES ||
      audio.wav.length > MAX_WAV_BYTES ||
      !Number.isFinite(audio.durationMs) ||
      audio.durationMs <= 0 ||
      current.aggregateMs + audio.durationMs > MAX_DURATION_MS
    ) {
      this.fail(current, 'Generated speech was invalid; continue reading.');
      return;
    }
    current.aggregateMs += audio.durationMs;
    if (current.phase === 'playing') {
      current.buffered = { part, wav: audio.wav, durationMs: audio.durationMs };
      return;
    }
    if (current.attention) current.cueAudio = { wav: audio.wav.slice(), durationMs: audio.durationMs };
    current.part = part;
    current.wav = audio.wav;
    current.durationMs = audio.durationMs;
    current.phase = 'prepared';
    this.clearTimer(current);
    if (this.paused) this.options.output.status(current.id, 'paused');
    else this.play(current);
  }

  private play(current: ActiveSpeech): void {
    if (current.multipart) current.lookaheadAllowed = false;
    this.options.output.status(current.id, 'preparing');
    if (this.current !== current) return;
    let pageId: number | undefined;
    try {
      pageId = current.multipart
        ? this.options.output.play(current.id, current.wav, current.durationMs, current.part)
        : this.options.output.play(current.id, current.wav, current.durationMs);
    } catch {
      if (current.provider === 'kokoro') this.localDiagnostic('failed', 'audio_page');
      this.fail(current, 'Audio could not play. Open the Pair panel and try Preview voice.');
      return;
    }
    current.wav = new Uint8Array();
    if (this.current !== current) {
      if (pageId !== undefined) this.options.output.control(current.id, pageId, 'stop');
      return;
    }
    if (pageId === undefined) {
      if (current.provider === 'kokoro') this.localDiagnostic('failed', 'audio_page');
      this.fail(current, 'Open the Pair panel to hear speech.');
      return;
    }
    current.pageId = pageId;
    current.phase = 'playing';
    this.arm(current, START_TIMEOUT_MS);
  }

  /** Accepts page acknowledgements only for the current page and generation. */
  audioEvent(event: SpeechAudioEvent): 'ended' | 'failed' | undefined {
    const current = this.current;
    if (
      current === undefined ||
      current.id !== event.id ||
      current.pageId !== event.pageId ||
      current.phase !== 'playing' ||
      (event.part ?? 0) !== current.part
    ) {
      return undefined;
    }
    if (event.event === 'failed') {
      if (current.provider === 'kokoro') this.localDiagnostic('failed', 'audio_page');
      this.fail(current, 'Audio could not play. Use Preview voice to enable audio.');
      return 'failed';
    } else if (event.event === 'ended') {
      if (current.attention) {
        this.configureNarrationContext();
        if (this.current !== current) return undefined;
      }
      if (current.multipart && !current.started) {
        this.fail(current, 'Audio could not play. Use Preview voice to enable audio.');
        return 'failed';
      }
      if (current.multipart && current.part < current.parts.length - 1) {
        // specs/SentencePipeline.tla, Close: intermediate retirement never completes the unit.
        this.clearTimer(current);
        current.started = false;
        const buffered = current.buffered;
        current.buffered = undefined;
        current.phase = buffered === undefined ? (current.processing === undefined ? 'synthesizing' : 'transforming') : 'prepared';
        if (buffered !== undefined) {
          current.part = buffered.part;
          current.wav = buffered.wav;
          current.durationMs = buffered.durationMs;
          current.lookaheadAllowed = false;
          if (!this.paused) this.play(current);
        } else this.lookahead(current);
        return undefined;
      }
      // specs/AttentionCache.tla, Complete: only the still-current generation may populate the cache.
      if (current.attention && current.cueGeneration === this.cueGeneration && current.cueAudio !== undefined) {
        this.cueCache = current.cueAudio;
      }
      current.context?.complete();
      this.finish(current);
      return 'ended';
    } else {
      if (current.started) return undefined;
      current.started = true;
      current.remaining = current.durationMs + PLAYBACK_GRACE_MS;
      if (!this.paused) this.arm(current, current.remaining);
      this.options.output.status(current.id, this.paused ? 'paused' : 'speaking');
      current.lookaheadAllowed = true;
      this.lookahead(current);
      return undefined;
    }
  }

  /** Pauses current playback and its watchdog without advancing reading. */
  pause(): void {
    this.paused = true;
    const current = this.current;
    if (current === undefined) return;
    if (current.multipart && current.phase === 'loading') this.freeze(current);
    if (current.phase === 'playing' && current.pageId !== undefined) {
      this.freeze(current);
      this.options.output.control(current.id, current.pageId, 'pause');
    }
    this.options.output.status(current.id, 'paused');
  }

  /** Resumes only the current generation after all pause reasons clear. */
  resume(): void {
    this.paused = false;
    const current = this.current;
    if (current === undefined) return;
    if (current.phase === 'prepared') {
      this.play(current);
    } else if (current.phase === 'playing' && current.pageId !== undefined) {
      this.options.output.control(current.id, current.pageId, 'resume');
      this.arm(current, current.remaining);
      this.options.output.status(current.id, current.started ? 'speaking' : 'preparing');
      this.lookahead(current);
    } else {
      if (current.phase === 'loading' && this.lifecycle.snapshot().phase === 'ready') this.synthesize(current);
      else {
        if (current.multipart && current.phase === 'loading') this.arm(current, current.remaining);
        this.lookahead(current);
      }
      this.options.output.status(current.id, 'preparing');
    }
  }

  /** Stops audio and invalidates pending synthesis without waiting for CPU inference. */
  cancel(): void {
    const current = this.current;
    if (current !== undefined) this.finish(current);
  }

  /** Cancels audio if its owning page disappears. */
  pageClosed(pageId: number): void {
    const current = this.current;
    if (current !== undefined && (current.pageId === pageId || current.pageId === undefined)) this.cancel();
  }

  /** Releases the worker and all pending speech. */
  async dispose(): Promise<void> {
    this.disposed = true;
    this.context.disconnect();
    this.cancel();
    await Promise.all([this.options.tempo?.dispose().catch(() => {}), this.lifecycle.dispose()]);
  }

  private armStartup(current: ActiveSpeech, ms: number): void {
    this.clearTimer(current);
    current.remaining = ms;
    if (!this.paused || !current.multipart) this.arm(current, ms);
  }

  private arm(current: ActiveSpeech, ms: number): void {
    this.clearTimer(current);
    current.remaining = ms;
    current.deadline = Date.now() + ms;
    current.timer = setTimeout(() => {
      const state = this.lifecycle.snapshot().phase;
      if ((current.phase === 'loading' || current.phase === 'synthesizing') && (state === 'loading' || state === 'ready')) {
        // specs/WarmSynthesisWorker.tla, Retire: the unit's deadline also retires a worker that is still busy.
        if (!this.lifecycle.retireWorker('timeout')) {
          this.localDiagnostic('failed', 'timeout');
          this.fail(current, 'Speech timed out; continue reading.');
        }
      } else {
        if (current.provider === 'kokoro') this.localDiagnostic('failed', 'timeout');
        this.fail(current, 'Speech timed out; continue reading.');
      }
    }, ms);
  }

  private freeze(current: ActiveSpeech): void {
    if (current.deadline !== undefined) current.remaining = Math.max(0, current.deadline - Date.now());
    this.clearTimer(current);
  }

  private clearTimer(current: ActiveSpeech): void {
    if (current.timer !== undefined) clearTimeout(current.timer);
    current.timer = undefined;
    current.deadline = undefined;
  }

  private fail(current: ActiveSpeech, message: string): void {
    if (this.current !== current) return;
    this.options.output.status(current.id, 'unavailable', message);
    this.finish(current, /* showIdle= */ false);
  }

  private finish(current: ActiveSpeech, showIdle = true): void {
    if (this.current !== current) return;
    this.current = undefined;
    current.context?.cancel();
    if (current.provider !== 'kokoro' && this.cloudBusy?.id === current.id) this.cloudBusy.controller.abort();
    // specs/SpeechTempo.tla, Cancel: abort invalidates the transform; the worker slot retires on its own.
    current.processing?.controller.abort();
    // specs/WarmSynthesisWorker.tla, Cancel: the result is invalid now; the worker stays owned until it returns.
    current.lifecycleAbort.abort();
    this.lifecycle.release(current.id);
    this.clearTimer(current);
    if (current.pageId !== undefined) this.options.output.control(current.id, current.pageId, 'stop');
    else this.options.output.cancel?.(current.id);
    if (showIdle) this.options.output.status(current.id, 'idle');
    current.resolve();
  }

  /** Diagnostics must never change speech behavior or reveal exception text. */
  private localDiagnostic(phase: 'ready' | 'failed', reason?: LocalSpeechFailureReason): void {
    try {
      this.options.output.localDiagnostic?.(phase, reason);
    } catch {
      /* Observability is best effort. */
    }
  }
}
