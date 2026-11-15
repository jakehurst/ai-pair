/* oxlint-disable eslint/no-use-before-define -- callbacks publish a snapshot assembled from the host's collaborators. */
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { AudioAdapter, AudioCapabilities, AudioChoice } from '../../audio-native/src';
import type { SpeechDiagnosticEvent } from '../../vscode/src/diagnostics';
import type { PanelWiring } from '../../vscode/src/panel';
import type { SpeechState } from '../../vscode/src/panel_messages';
import { SpeechCatalog, type CatalogView } from '../../vscode/src/speech_catalog';
import { SpeechCredentials } from '../../vscode/src/speech_credentials';
import { ElevenLabsClient } from '../../vscode/src/speech_elevenlabs';
import { OpenRouterClient } from '../../vscode/src/speech_openrouter';
import { SessionSpeechCost, type SessionSpeechCostView } from '../../vscode/src/session_speech_cost';
import { createOpenRouterAudioDecoder } from '../../vscode/src/speech_decode_bridge';
import { OpenRouterCatalog, type OpenRouterCatalogView } from '../../vscode/src/speech_openrouter_catalog';
import { SpeechOutputPreferences, type OutputPreferenceView } from '../../vscode/src/speech_output_preferences';
import { speechRuntimeAvailable } from '../../vscode/src/speech_runtime_status';
import { localSpeechPlatform } from '../../vscode/src/speech_platform';
import { SpeechService } from '../../vscode/src/speech_service';
import { createGpuHostBinding } from '../../vscode/src/speech_gpu_host_binding';
import { MAX_GPU_WORKER_DETAILS, type AudioDiagnostics } from '@ai-pair/protocol';
import { createGpuSynthesisClient } from '../../vscode/src/speech_gpu_client';
import { installedGpuModel, setupGpuModel } from '../../vscode/src/speech_gpu_model';
import { setupGpuFlow } from '../../vscode/src/speech_gpu_setup_flow';
import type { GpuBindingDependencies } from '../../vscode/src/speech_gpu_binding';
import type { SpeechComputeState } from '../../vscode/src/speech_compute_types';
import { speechReady } from '../../vscode/src/speech_readiness';
import { SpeechTempoClient } from '../../vscode/src/speech_tempo_client';
import { installedSpeechModel, setupSpeech, speechModelStatus } from '../../vscode/src/speech_setup';
import { speechListeningRate, type SpeechSettings } from '../../vscode/src/speech_types';
import { CompanionOutput } from './companion_output';

/** The local panel operations used by the speech host. */
export interface SpeechHostPanel {
  admitSpeechDecode?(id: number, signal: AbortSignal): Promise<import('../../vscode/src/speech_types').OpenRouterAudioDecodeLease>;
  showSpeechReadiness(value: AudioDiagnostics): void;
  showSpeechCost(value: SessionSpeechCostView): void;
  showSpeechKeyStatus(hasKey: boolean): void;
  showOpenRouterKeyStatus(hasKey: boolean): void;
  showOpenRouterCatalog(value: OpenRouterCatalogView): void;
  showSpeechOutputCatalog(value: OutputPreferenceView): void;
  showSpeechCatalog(value: CatalogView): void;
  showSpeechSettings(value: SpeechSettings): void;
  showSpeechComputeState(value: SpeechComputeState): void;
  showSpeechStatus(id: number, state: SpeechState, message?: string): void;
  refreshSpeechSupport(): void;
}

/** Local collaborators; no credentials or audio cross the workspace connection. */
export interface SpeechHostOptions {
  context: vscode.ExtensionContext;
  connectionEpoch: string;
  adapter: AudioAdapter;
  page: () => number | undefined;
  panel: () => SpeechHostPanel | undefined;
  diagnostic: (event: SpeechDiagnosticEvent) => void;
  /** Provides the isolated proof runner when the packaged worker is available. */
  gpuProof?: GpuBindingDependencies['proof'];
  /** Enables GPU inference only after the packaged path is reviewed and verified. */
  enableGpuInference?: boolean;
}

/** Sanitized local speech lifecycle facts for integration observation. */
export interface LocalSpeechObservation {
  id: number;
  state: SpeechState;
  started: boolean;
  terminal?: 'ended' | 'failed';
}

/** The UI-local speech service and its panel wiring. */
export interface SpeechHost {
  speech: SpeechService;
  output: CompanionOutput;
  panelSpeech: PanelWiring['speech'];
  observation(): LocalSpeechObservation | undefined;
  audioDiagnostics(): AudioDiagnostics;
  gpuDiagnostics(): import('@ai-pair/protocol').GpuDiagnostics;
  ready(): Promise<boolean>;
  dispose(): Promise<void>;
}

/** Returns the local AI Pair configuration. */
function config(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration('aiPair');
}

/** Creates the local speech, credentials and output composition. */
export function createSpeechHost(options: SpeechHostOptions): SpeechHost {
  const { context, adapter } = options;
  const desktop = vscode.env.uiKind === vscode.UIKind.Desktop;
  const platformResult = desktop ? localSpeechPlatform() : { supported: false as const, reason: 'host_platform' as const };
  const platform = platformResult.supported;
  const runtimeDirectory = path.join(context.extensionPath, 'dist', 'speech');
  let runtimeAvailable = false;
  let runtimeKnown = false;
  let keyConfigured: boolean | 'unknown' = 'unknown';
  let modelReady: boolean | 'unknown' = 'unknown';
  let modelGeneration = 0;
  let routeDiscovered = false;
  let lastPlayback: AudioDiagnostics['lastPlayback'] = 'unknown';
  let disposed = false;
  let keyEpoch = 0;
  let invalidVoice = false;
  let pending: SpeechSettings | undefined;
  let generation = 0;
  let tail: Promise<void> = Promise.resolve();
  let catalogActive = false;
  let speech: SpeechService;
  let credentials: SpeechCredentials;
  let openRouterCredentials: SpeechCredentials;
  let openRouterCatalog: OpenRouterCatalog;
  let openRouterKeyEpoch = 0;
  let openRouterKeyConfigured: boolean | 'unknown' = 'unknown';
  let catalog: SpeechCatalog;
  let output: CompanionOutput;
  let capability: AudioCapabilities | undefined;
  let capabilityGeneration = 0;
  let observation: LocalSpeechObservation | undefined;
  let previewCapture = false;
  let previewId: number | undefined;
  let previewSequence = 0;
  const sessionCost = new SessionSpeechCost((value) => {
    if (!disposed) options.panel()?.showSpeechCost(value);
  });
  const setupAbort = new AbortController();
  const binding =
    !desktop || options.gpuProof === undefined
      ? undefined
      : createGpuHostBinding({
          extensionPath: context.extensionPath,
          storageDirectory: context.globalStorageUri.fsPath,
          platform: process.platform,
          arch: process.arch,
          proof: options.gpuProof,
        });
  let gpuStage: 'idle' | 'preflight' | 'model' | 'verify' | 'admission' = 'idle';
  const gpuWorkerDetails: Array<import('../../vscode/src/speech_gpu_client').GpuWorkerDetail> = [];
  const compute = {
    state: () => speech.computeState(),
    select: (mode: import('../../vscode/src/speech_compute_types').SpeechComputeMode) => {
      speech.selectComputeMode(mode);
    },
    check: () => {
      gpuStage = 'preflight';
      const computeEpoch = speech.computeGeneration();
      return speech
        .checkGpu(async (signal, progress) => {
          if (!desktop) return { phase: 'unavailable', reason: 'unsupported' };
          if (binding === undefined) return { phase: 'unavailable', reason: 'runtime_missing' };
          const check = await setupGpuFlow({
            preflight: (proofSignal) => binding.preflight(proofSignal),
            cpuModel: () => {
              gpuStage = 'model';
              return installedSpeechModel(context.globalStorageUri.fsPath);
            },
            gpuModel: () => installedGpuModel(context.globalStorageUri.fsPath),
            download: (report) => setupGpuModel(context.globalStorageUri.fsPath, { signal, progress: report }),
            verify: async (directory, proofSignal) => {
              gpuStage = 'verify';
              const result = await binding.issue(proofSignal);
              if (result.check.phase !== 'ready') return result.check;
              return result.capability?.modelDirectory === directory ? result.check : { phase: 'unavailable', reason: 'model_missing' };
            },
            signal,
            progress,
          });
          return check.phase === 'ready' && options.enableGpuInference !== true ? { phase: 'unavailable', reason: 'inconclusive' } : check;
        }, setupAbort.signal)
        .then((result) => {
          if (!disposed && speech.computeGeneration() === computeEpoch && result.phase === 'unavailable' && result.reason === 'busy') {
            void vscode.window.showInformationMessage('Speech is still finishing; try GPU setup again shortly.');
          }
          return result;
        });
    },
  };

  let computeGeneration = 0;
  let computeTail: Promise<void> = Promise.resolve();
  let computePending = false;
  let previewProvider: SpeechSettings['provider'] = 'kokoro';

  function stored(): SpeechSettings {
    const enabled: unknown = config().get('speech.enabled');
    const voice: unknown = config().get('speech.voice');
    const speed: unknown = config().get('speech.speed');
    const provider: unknown = config().inspect('speech.provider')?.globalValue;
    const cloudVoice: unknown = config().get('speech.elevenLabsVoice');
    const cloudSpeed: unknown = config().get('speech.elevenLabsSpeed');
    const openRouterModel: unknown = config().get('speech.openRouterModel');
    const openRouterVoice: unknown = config().get('speech.openRouterVoice');
    const openRouterZdr: unknown = config().get('speech.openRouterZdr');
    const openRouterFormat: unknown = config().get('speech.openRouterFormat');
    return {
      enabled: enabled === true,
      contextEnabled: config().get('speech.contextEnabled') === true,
      listeningSpeed: speechListeningRate(config().get('speech.listeningSpeed')),
      voice: typeof voice === 'string' ? voice : 'af_heart',
      speed: typeof speed === 'number' ? speed : 1,
      provider: provider === 'elevenlabs' || provider === 'openrouter' ? provider : 'kokoro',
      elevenLabsVoice: !invalidVoice && typeof cloudVoice === 'string' ? cloudVoice : '',
      elevenLabsSpeed: typeof cloudSpeed === 'number' ? cloudSpeed : 1,
      ...(typeof openRouterModel === 'string' || typeof openRouterVoice === 'string' || openRouterZdr === true || provider === 'openrouter'
        ? {
            openRouterModel: typeof openRouterModel === 'string' ? openRouterModel : '',
            openRouterVoice: typeof openRouterVoice === 'string' ? openRouterVoice : '',
            openRouterZdr: openRouterZdr === true,
            openRouterFormat: openRouterFormat === 'pcm' ? 'pcm' : 'mp3',
          }
        : {}),
    };
  }
  let last = stored();
  const settings = {
    get: (): SpeechSettings => pending ?? stored(),
    set: (value: SpeechSettings): void => {
      const prior = settings.get();
      if ((prior.enabled && !value.enabled) || prior.provider !== value.provider) {
        speech.cancel();
        if (prior.provider !== value.provider) {
          credentials.supersede();
          catalog.invalidate();
          openRouterCredentials.supersede();
          openRouterCatalog.invalidate();
        }
      }
      if (
        prior.openRouterModel !== value.openRouterModel ||
        prior.openRouterVoice !== value.openRouterVoice ||
        prior.openRouterZdr !== value.openRouterZdr ||
        prior.openRouterFormat !== value.openRouterFormat
      ) {
        speech.cancel();
        if (prior.openRouterZdr !== value.openRouterZdr) openRouterCatalog.invalidate();
      }
      const restoresVoice = invalidVoice && value.elevenLabsVoice !== '' && catalog.contains(value.elevenLabsVoice);
      // specs/ProviderChoice.tla, Select: the latest local choice takes effect before persistence.
      const current = ++generation;
      pending = { ...value, listeningSpeed: speechListeningRate(value.listeningSpeed) };
      speech.configureNarrationContext();
      speech.prepare();
      if (
        prior.enabled !== value.enabled ||
        prior.provider !== value.provider ||
        prior.voice !== value.voice ||
        prior.elevenLabsVoice !== value.elevenLabsVoice
      ) {
        lastPlayback = 'unknown';
      }
      options.panel()?.showSpeechSettings(settings.get());
      publishReadiness();
      last = value;
      const save = tail.then(async () => {
        const updates: Array<[string, unknown]> = [
          ['speech.enabled', value.enabled],
          ['speech.contextEnabled', value.contextEnabled === true],
          ['speech.listeningSpeed', speechListeningRate(value.listeningSpeed)],
          ['speech.voice', value.voice],
          ['speech.speed', value.speed],
          ['speech.provider', value.provider],
          ['speech.elevenLabsVoice', value.elevenLabsVoice],
          ['speech.elevenLabsSpeed', value.elevenLabsSpeed],
          ...(value.openRouterModel === undefined ? [] : [['speech.openRouterModel', value.openRouterModel] as [string, unknown]]),
          ...(value.openRouterVoice === undefined ? [] : [['speech.openRouterVoice', value.openRouterVoice] as [string, unknown]]),
          ...(value.openRouterZdr === undefined ? [] : [['speech.openRouterZdr', value.openRouterZdr] as [string, unknown]]),
          ...(value.openRouterFormat === undefined ? [] : [['speech.openRouterFormat', value.openRouterFormat] as [string, unknown]]),
        ];
        for (const [key, setting] of updates) await config().update(key, setting, vscode.ConfigurationTarget.Global);
      });
      tail = save.catch(() => {});
      void save.then(
        () => {
          // specs/ProviderChoice.tla, Success: older writes cannot replace a newer choice.
          if (current !== generation || disposed) return;
          pending = undefined;
          speech.configureNarrationContext();
          if (restoresVoice) invalidVoice = false;
          options.panel()?.showSpeechSettings(stored());
          publishReadiness();
        },
        () => {
          if (current !== generation || disposed) return;
          pending = undefined;
          speech.configureNarrationContext();
          speech.cancel();
          speech.prepare();
          catalog.invalidate();
          last = stored();
          options.panel()?.showSpeechSettings(last);
          publishReadiness();
          void vscode.window.showErrorMessage('Could not save speech settings.');
        },
      );
    },
  };
  credentials = new SpeechCredentials(
    context.secrets,
    () =>
      vscode.window.showInputBox({
        title: 'ElevenLabs API key',
        password: true,
        ignoreFocusOut: true,
        prompt: 'Use a key with Text to Speech and Voices read access.',
      }),
    () => {
      keyEpoch++;
      keyConfigured = 'unknown';
      catalog.invalidate();
      speech.invalidateCloud();
      invalidVoice = true;
      settings.set({ ...settings.get(), elevenLabsVoice: '' });
    },
  );
  const cloud = new ElevenLabsClient(() => credentials.read());
  openRouterCredentials = new SpeechCredentials(
    context.secrets,
    () => vscode.window.showInputBox({ title: 'OpenRouter API key', password: true, ignoreFocusOut: true }),
    () => {
      openRouterKeyEpoch++;
      openRouterKeyConfigured = 'unknown';
      openRouterCatalog.invalidate();
      speech.invalidateCloud();
      settings.set({ ...settings.get(), openRouterModel: '', openRouterVoice: '' });
      publishReadiness();
    },
    'aiPair.openRouter.apiKey',
  );
  const openRouter = new OpenRouterClient(
    () => openRouterCredentials.read(),
    undefined,
    createOpenRouterAudioDecoder(() => options.panel()),
    () => sessionCost.capture(),
  );
  openRouterCatalog = new OpenRouterCatalog(openRouter, (value) => {
    if (!disposed) {
      if (value.state === 'ready') speech.openRouterCatalogChanged();
      options.panel()?.showOpenRouterCatalog(value);
      publishReadiness();
    }
  });
  function refreshOpenRouterKey(): void {
    const epoch = ++openRouterKeyEpoch;
    openRouterKeyConfigured = 'unknown';
    publishReadiness();
    void openRouterCredentials.hasKey().then(
      (hasKey) => {
        if (disposed || epoch !== openRouterKeyEpoch) return;
        openRouterKeyConfigured = hasKey;
        options.panel()?.showOpenRouterKeyStatus(hasKey);
        publishReadiness();
      },
      () => {
        if (!disposed && epoch === openRouterKeyEpoch) options.panel()?.showOpenRouterKeyStatus(false);
      },
    );
  }
  catalog = new SpeechCatalog(cloud, (value) => {
    if (value.reset) catalogActive = false;
    else if (value.loading) catalogActive = true;
    else if (catalogActive) {
      catalogActive = false;
      options.diagnostic({
        kind: 'speech',
        event: 'catalog',
        provider: 'elevenlabs',
        phase: value.error ? 'failed' : 'ready',
        ...(value.error ? { reason: value.errorKind ?? 'unknown' } : value.voices.length === 0 ? { reason: 'no_voice' } : {}),
      });
    }
    if (!disposed) options.panel()?.showSpeechCatalog(value);
  });
  function refreshKey(): void {
    const epoch = ++keyEpoch;
    keyConfigured = 'unknown';
    publishReadiness();
    void credentials.hasKey().then(
      (hasKey) => {
        if (disposed || epoch !== keyEpoch) return;
        keyConfigured = hasKey;
        publishReadiness();
        options.panel()?.showSpeechKeyStatus(hasKey);
        options.diagnostic({
          kind: 'speech',
          event: 'capability',
          provider: 'elevenlabs',
          phase: desktop && hasKey ? 'ready' : 'blocked',
          ...(!desktop ? { reason: 'unsupported' as const } : !hasKey ? { reason: 'no_key' as const } : {}),
        });
      },
      () => {
        if (!disposed && epoch === keyEpoch) {
          keyConfigured = 'unknown';
          publishReadiness();
        }
        if (!disposed && epoch === keyEpoch) options.panel()?.showSpeechKeyStatus(false);
      },
    );
  }
  const preferences = new SpeechOutputPreferences({
    initial: context.globalState.get('speechOutput'),
    write: async (value) => {
      await context.globalState.update('speechOutput', value);
    },
    stop: () => {
      speech.cancel();
      void output.stopAndWait().catch(() => {});
    },
    changed: (value) => {
      if (!disposed) {
        options.panel()?.showSpeechOutputCatalog(value);
        publishReadiness();
      }
    },
    discover: async () => {
      const sequence = ++capabilityGeneration;
      capability = undefined;
      routeDiscovered = false;
      publishReadiness();
      const discovered = await adapter.capabilities();
      // specs/OutputDiscoveryLifecycle.tla, Complete: do not start listing after disposal.
      if (disposed) return { supported: false, devices: [], reason: 'unavailable' };
      if (sequence === capabilityGeneration) capability = discovered;
      const backend = discovered.backend;
      if (
        (!discovered.defaultOutput && !discovered.deviceSelection) ||
        (backend !== 'pipewire' && backend !== 'coreaudio' && backend !== 'wasapi')
      ) {
        if (sequence === capabilityGeneration) routeDiscovered = true;
        return { supported: false, devices: [], reason: 'unsupported' };
      }
      const devices = discovered.deviceSelection ? await adapter.list() : [];
      if (!disposed && sequence === capabilityGeneration) routeDiscovered = true;
      return {
        supported: true,
        devices: devices.map((device) => ({
          choice: { kind: 'native' as const, backend, name: device.id },
          label: device.label,
          available: true,
        })),
      };
    },
  });
  function choice(): AudioChoice {
    const selected = preferences.choice();
    return selected.kind === 'default' ? { kind: 'default' } : { kind: 'device', id: selected.name };
  }
  function outputReady(): boolean {
    const selected = preferences.choice();
    // specs/LocalAudioAdmission.tla, Admit: do not dispatch a provider without the selected local route.
    return (
      capability !== undefined &&
      (selected.kind === 'default'
        ? capability.defaultOutput
        : capability.deviceSelection && capability.backend === selected.backend && preferences.ready())
    );
  }
  output = new CompanionOutput({
    adapter,
    connectionEpoch: options.connectionEpoch,
    page: options.page,
    choice,
    ready: outputReady,
    event: (event) => {
      const terminal = speech.audioEvent(event);
      if (terminal !== undefined && observation?.id === event.id) {
        observation = { ...observation, terminal };
        lastPlayback = terminal;
        publishReadiness();
      }
    },
    localDiagnostic: (phase, reason) => {
      options.diagnostic({ kind: 'speech', event: 'runtime', provider: 'kokoro', phase, ...(reason === undefined ? {} : { reason }) });
    },
    status: (id, state, message) => {
      if (previewCapture) previewId = id;
      if (id === previewId && (state === 'speaking' || state === 'unavailable')) {
        options.diagnostic({
          kind: 'speech',
          event: 'preview',
          provider: previewProvider,
          phase: state === 'speaking' ? 'ready' : 'failed',
          ...(state === 'unavailable' ? { reason: 'unknown' as const } : {}),
        });
      }
      if (state === 'unavailable') lastPlayback = 'failed';
      else if (state === 'speaking') lastPlayback = 'unknown';
      publishReadiness();
      const started = state === 'speaking' || (observation?.id === id && observation.started);
      observation = { id, state, started };
      if (!disposed) options.panel()?.showSpeechStatus(id, state, message);
    },
  });
  speech = new SpeechService({
    openRouterDiagnostic: (reason) => {
      options.diagnostic({ kind: 'speech', event: 'narration', provider: 'openrouter', phase: 'failed', reason });
    },
    cloudDiagnostic: (reason) => {
      options.diagnostic({ kind: 'speech', event: 'narration', provider: 'elevenlabs', phase: 'failed', reason });
    },
    runtimeDirectory,
    tempo: new SpeechTempoClient(path.join(runtimeDirectory, 'tempo_worker.mjs')),
    storageDirectory: context.globalStorageUri.fsPath,
    localDesktop: desktop,
    kokoroSupported: platform,
    cloud,
    openRouter,
    openRouterAllowed: (model, voice) => openRouterCatalog.allows(model, voice),
    settings: settings.get,
    ...(options.enableGpuInference === true && binding !== undefined
      ? {
          gpuCapability: (signal) => {
            gpuStage = 'admission';
            return binding.issue(signal);
          },
          createGpu: (
            gpuCapability: import('../../vscode/src/speech_gpu_client').GpuLaunchCapability,
            listener: import('../../vscode/src/speech_local_client').LocalListener,
          ) => {
            gpuWorkerDetails.length = 0;
            return createGpuSynthesisClient({
              capability: gpuCapability,
              listener,
              detail: (value) => {
                gpuWorkerDetails.push(value);
                if (gpuWorkerDetails.length > MAX_GPU_WORKER_DETAILS) gpuWorkerDetails.shift();
              },
            });
          },
        }
      : {}),
    computeMode: () => {
      const value: unknown = config().get('speech.computeMode');
      return value === 'gpu' || value === 'auto' ? value : 'cpu';
    },
    computeChanged: (value) => {
      if (!disposed) {
        options.panel()?.showSpeechComputeState(value);
        publishReadiness();
      }
    },
    output,
  });
  speech.prepare();
  void speechRuntimeAvailable(runtimeDirectory).then((available) => {
    if (disposed) return;
    runtimeAvailable = available;
    runtimeKnown = true;
    publishReadiness();
    options.diagnostic({
      kind: 'speech',
      event: 'capability',
      provider: 'kokoro',
      phase: platform && available ? 'ready' : 'blocked',
      ...(!platformResult.supported ? { reason: platformResult.reason } : !available ? { reason: 'not_ready' as const } : {}),
    });
    options.panel()?.refreshSpeechSupport();
  });
  // specs/OutputPreference.tla, Init: restore a saved device without opening Settings.
  if (preferences.choice().kind === 'native') {
    void preferences.refresh();
  } else {
    const initialCapability = ++capabilityGeneration;
    void adapter.capabilities().then(
      (value) => {
        if (!disposed && initialCapability === capabilityGeneration) {
          capability = value;
          options.panel()?.showSpeechOutputCatalog(preferences.view());
          publishReadiness();
        }
      },
      () => {},
    );
  }
  const panelSpeech: PanelWiring['speech'] = {
    sessionCost,
    narrationSession: (id, ongoing) => {
      speech.setNarrationSession(id, ongoing);
    },
    readiness: audioDiagnostics,
    computeState: () => compute.state(),
    computeMode: (value) => {
      compute.select(value);
      const current = ++computeGeneration;
      computePending = true;
      const save = computeTail.then(() => config().update('speech.computeMode', value, vscode.ConfigurationTarget.Global));
      computeTail = save.catch(() => {});
      void save.then(
        () => {
          if (current === computeGeneration) computePending = false;
        },
        () => {
          if (current !== computeGeneration) return;
          computePending = false;
          const storedMode: unknown = config().get('speech.computeMode');
          const restored = storedMode === 'auto' || storedMode === 'gpu' ? storedMode : 'cpu';
          compute.select(restored);
          void vscode.window.showErrorMessage('Could not save speech compute mode.');
        },
      );
    },
    checkGpuSetup: () => {
      void compute.check();
    },
    outputView: () => preferences.view(),
    outputReady,
    outputRetired: () => {},
    outputPageRetired: () => {},
    outputRefresh: () => {
      void preferences.refresh();
    },
    outputSelect: (value) => {
      lastPlayback = 'unknown';
      void preferences.choose(value);
    },
    settings,
    diagnostic: options.diagnostic,
    cloudSupported: () => desktop,
    keySet: async () => {
      await credentials.set();
      refreshKey();
    },
    keyRemove: async () => {
      await credentials.remove();
      refreshKey();
    },
    keyRefresh: refreshKey,
    openRouterKeySet: async () => {
      await openRouterCredentials.set();
      refreshOpenRouterKey();
    },
    openRouterKeyRemove: async () => {
      await openRouterCredentials.remove();
      refreshOpenRouterKey();
    },
    openRouterKeyRefresh: refreshOpenRouterKey,
    loadOpenRouterModels: () => {
      void openRouterCatalog.load(settings.get().openRouterZdr === true);
    },
    validOpenRouterVoice: (model, voice) => openRouterCatalog.contains(model, voice),
    loadVoices: (more) => {
      void catalog.load(more);
    },
    validCloudVoice: (id) => catalog.contains(id),
    supported: () => platform && runtimeAvailable,
    gpuSupported: () => options.enableGpuInference === true && binding !== undefined,
    installed: async () => {
      const current = ++modelGeneration;
      modelReady = 'unknown';
      publishReadiness();
      const installed = (await installedSpeechModel(context.globalStorageUri.fsPath)) !== undefined;
      if (current === modelGeneration && !disposed) {
        modelReady = installed;
        publishReadiness();
      }
      return installed;
    },
    modelStatus: async () => {
      const current = ++modelGeneration;
      modelReady = 'unknown';
      publishReadiness();
      const status = await speechModelStatus(context.globalStorageUri.fsPath);
      if (current === modelGeneration && !disposed) {
        modelReady = status.verified;
        publishReadiness();
      }
      return status;
    },
    setup: () => {
      modelGeneration++;
      modelReady = 'unknown';
      publishReadiness();
      return setupSpeech(context.globalStorageUri.fsPath).then(() => {
        speech.prepare(/* retry= */ true);
      });
    },
    preview: () => {
      previewProvider = settings.get().provider;
      const sequence = ++previewSequence;
      previewId = undefined;
      previewCapture = true;
      try {
        return speech.preview().finally(() => {
          if (sequence === previewSequence) previewId = undefined;
        });
      } finally {
        previewCapture = false;
      }
    },
    stop: () => {
      speech.cancel();
    },
    event: (event) => {
      speech.audioEvent(event);
    },
    pageClosed: (pageId) => {
      speech.pageClosed(pageId);
      catalog.invalidate();
      openRouterCatalog.invalidate();
    },
  };
  const subscriptions = [
    context.secrets.onDidChange((event) => {
      if (event.key === 'aiPair.openRouter.apiKey') {
        openRouterCredentials.invalidate();
        refreshOpenRouterKey();
      }
      if (event.key === 'aiPair.elevenLabs.apiKey') {
        credentials.invalidate();
        keyConfigured = 'unknown';
        refreshKey();
      }
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration('aiPair.speech')) return;
      if (!computePending) {
        const mode: unknown = config().get('speech.computeMode');
        const next = mode === 'auto' || mode === 'gpu' ? mode : 'cpu';
        if (next !== compute.state().requestedMode) {
          compute.select(next);
        }
      }
      const current = settings.get();
      speech.configureNarrationContext();
      // specs/ProviderChoice.tla, External: persistence echoes cannot override a pending choice.
      if (pending === undefined) {
        if ((last.enabled && !current.enabled) || current.provider !== last.provider) speech.cancel();
        if (current.provider !== last.provider) {
          credentials.supersede();
          catalog.invalidate();
          openRouterCredentials.supersede();
          openRouterCatalog.invalidate();
        }
        if (
          current.openRouterModel !== last.openRouterModel ||
          current.openRouterVoice !== last.openRouterVoice ||
          current.openRouterZdr !== last.openRouterZdr ||
          current.openRouterFormat !== last.openRouterFormat
        ) {
          speech.cancel();
          if (current.openRouterZdr !== last.openRouterZdr) openRouterCatalog.invalidate();
        }
        last = current;
      }
      speech.prepare();
      options.panel()?.showSpeechSettings(current);
      publishReadiness();
    }),
  ];
  /** Projects cached facts only; it never starts discovery or synthesis. */
  function audioDiagnostics(): AudioDiagnostics {
    const current = settings.get();
    const selected = preferences.choice();
    const openRouterModel = current.openRouterModel ?? '';
    const openRouterVoice = current.openRouterVoice ?? '';
    return {
      enabled: current.enabled,
      provider: current.provider,
      keyConfigured: current.provider === 'openrouter' ? openRouterKeyConfigured : keyConfigured,
      voiceConfigured:
        current.provider === 'openrouter'
          ? openRouterModel.trim() !== '' && openRouterCatalog.allows(openRouterModel, openRouterVoice)
          : (current.provider === 'kokoro' ? current.voice : current.elevenLabsVoice).trim() !== '',
      output: desktop ? (selected.kind === 'default' ? 'default' : 'override') : 'unknown',
      routeAvailable: !desktop || capability === undefined || (selected.kind !== 'default' && !routeDiscovered) ? 'unknown' : outputReady(),
      runtimeReady: desktop && runtimeKnown ? platform && runtimeAvailable && speech.localComputeUsable() : 'unknown',
      modelReady: desktop ? modelReady : 'unknown',
      lastPlayback,
    };
  }

  /** Sends the current cached facts to a connected page. */
  function publishReadiness(): void {
    if (!disposed) options.panel()?.showSpeechReadiness(audioDiagnostics());
  }

  return {
    speech,
    output,
    panelSpeech,
    observation: () => (observation === undefined ? undefined : { ...observation }),
    audioDiagnostics,
    gpuDiagnostics: () => {
      const { requestedMode, actualBackend, gpuCheck } = compute.state();
      const check = gpuCheck.phase === 'unavailable' ? gpuCheck : { phase: gpuCheck.phase };
      return {
        requestedMode,
        actualBackend,
        check,
        stage: gpuStage,
        ...(gpuWorkerDetails.length === 0 ? {} : { workerDetails: [...gpuWorkerDetails] }),
      };
    },
    ready: () =>
      speechReady({
        settings: settings.get,
        desktop: () => desktop && !disposed,
        local: () => platform && runtimeAvailable && speech.localComputeUsable(),
        output: () => options.page() !== undefined && outputReady(),
        model: panelSpeech.installed,
        key: (provider) => (provider === 'openrouter' ? openRouterCredentials.hasKey() : credentials.hasKey()),
        openRouterAllowed: (model, voice) => openRouterCatalog.allows(model, voice),
      }),
    dispose: async () => {
      disposed = true;
      setupAbort.abort();
      subscriptions.forEach((subscription) => {
        subscription.dispose();
      });
      credentials.supersede();
      openRouterCredentials.supersede();
      catalog.invalidate();
      openRouterCatalog.invalidate();
      output.dispose();
      await speech.dispose();
    },
  };
}
