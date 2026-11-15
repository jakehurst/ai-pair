import { beforeEach, expect, it, vi } from 'vitest';
const tempoPaths = vi.hoisted(() => [] as string[]);
vi.mock('../../vscode/src/speech_tempo_client', () => ({
  SpeechTempoClient: class {
    constructor(path: string) {
      tempoPaths.push(path);
    }
    dispose = vi.fn().mockResolvedValue(undefined);
  },
}));
import type * as vscode from 'vscode';
import type { AudioAdapter } from '../../audio-native/src';
import type { SpeechDiagnosticEvent } from '../../vscode/src/diagnostics';
import { createSpeechHost } from '../src/speech_host';

const fakes = vi.hoisted(() => ({
  configureContext: vi.fn<() => void>(),
  setContextSession: vi.fn<(id: string | number, ongoing: boolean) => void>(),
  gpuClientFactory: vi.fn<typeof import('../../vscode/src/speech_gpu_client').createGpuSynthesisClient>(),
  setupBusy: vi.fn<() => boolean>().mockReturnValue(false),
  computeUsable: vi.fn<() => boolean>().mockReturnValue(true),
  gpuFlowResult: vi
    .fn<() => Promise<import('../../vscode/src/speech_compute_types').GpuCheck>>()
    .mockResolvedValue({ phase: 'unavailable', reason: 'probe_failed' }),
  gpuFlow: undefined as import('../../vscode/src/speech_gpu_setup_flow').GpuSetupFlowOptions | undefined,
  gpuPreflight: vi.fn().mockResolvedValue({ phase: 'ready' }),
  gpuIssue: vi.fn().mockResolvedValue({ check: { phase: 'unavailable', reason: 'probe_failed' } }),
  gpuInstalled: vi.fn().mockResolvedValue('/gpu'),
  gpuDownload: vi.fn().mockResolvedValue('/gpu'),
  speechOptions: undefined as
    | Pick<
        import('../../vscode/src/speech_service').SpeechServiceOptions,
        'computeMode' | 'computeChanged' | 'gpuCapability' | 'createGpu' | 'openRouterAllowed'
      >
    | undefined,
  cloudDiagnostic: undefined as ((reason: 'auth') => void) | undefined,
  readiness: vi.fn<(options: import('../../vscode/src/speech_readiness').SpeechReadiness) => Promise<boolean>>().mockResolvedValue(true),
  platform: vi.fn<() => import('../../vscode/src/speech_platform').SpeechPlatformResult>().mockReturnValue({ supported: true }),
  config: new Map<string, unknown>(),
  update: vi.fn().mockResolvedValue(undefined),
  choice: vi.fn<() => import('../../vscode/src/speech_output_types').OutputChoice>().mockReturnValue({ kind: 'default' }),
  ready: vi.fn().mockReturnValue(true),
  refresh: vi.fn().mockResolvedValue(undefined),
  secretChanged: undefined as ((event: { key: string }) => void) | undefined,
  credentialInvalidate: vi.fn(),
  errorMessage: vi.fn(),
  informationMessage: vi.fn(),
  uiKind: 1,
  showInputBox: vi.fn(),
  readKey: undefined as (() => Promise<string | undefined>) | undefined,
  catalogPublish: undefined as ((value: import('../../vscode/src/speech_catalog').CatalogView) => void) | undefined,
  preferencesWiring: undefined as import('../../vscode/src/speech_output_preferences').OutputPreferenceWiring | undefined,
  outputWiring: undefined as import('../src/companion_output').CompanionOutputOptions | undefined,
  credentialChanged: undefined as (() => void) | undefined,
  openChanged: undefined as (() => void) | undefined,
  openPrompt: undefined as (() => PromiseLike<string | undefined>) | undefined,
  openReadKey: undefined as (() => Promise<string | undefined>) | undefined,
  openDecoder: undefined as import('../../vscode/src/speech_types').OpenRouterAudioDecoder | undefined,
  openCostCapture: undefined as (() => (() => ((cost: number | undefined) => void) | undefined) | undefined) | undefined,
  costPublish: undefined as ((view: import('../../vscode/src/session_speech_cost').SessionSpeechCostView) => void) | undefined,
  costCapture: vi.fn<() => (() => ((cost: number | undefined) => void) | undefined) | undefined>(),
  openPublish: undefined as ((value: import('../../vscode/src/speech_openrouter_catalog').OpenRouterCatalogView) => void) | undefined,
  openDiagnostic: undefined as ((reason: 'auth') => void) | undefined,
  openHasKey: vi.fn<() => Promise<boolean>>().mockResolvedValue(false),
  openRead: vi.fn().mockResolvedValue(undefined),
  openSet: vi.fn().mockResolvedValue(undefined),
  openRemove: vi.fn().mockResolvedValue(undefined),
  openSupersede: vi.fn(),
  openCredentialInvalidate: vi.fn(),
  openInvalidate: vi.fn(),
  openLoad: vi.fn().mockResolvedValue(undefined),
  openContains: vi.fn().mockReturnValue(false),
  openCatalogChanged: vi.fn(),
  openAllows: vi.fn().mockReturnValue(true),
  credentialPrompt: undefined as (() => PromiseLike<string | undefined>) | undefined,
  configChanged: undefined as ((event: { affectsConfiguration(key: string): boolean }) => void) | undefined,
  prepare: vi.fn(),
  cancel: vi.fn(),
  invalidateCloud: vi.fn(),
  audioEvent: vi.fn(),
  dispose: vi.fn(),
  preview: vi.fn().mockResolvedValue(undefined),
  invalidate: vi.fn(),
  contains: vi.fn().mockReturnValue(false),
  load: vi.fn(),
  read: vi.fn(),
  hasKey: vi.fn().mockResolvedValue(false),
  set: vi.fn().mockResolvedValue(undefined),
  remove: vi.fn().mockResolvedValue(undefined),
  supersede: vi.fn(),
  outputDispose: vi.fn(),
  stopAndWait: vi.fn().mockResolvedValue(undefined),
  runtime: vi.fn().mockResolvedValue(false),
  installed: vi.fn().mockResolvedValue(undefined),
  setup: vi.fn().mockResolvedValue(undefined),
  modelStatus: vi
    .fn()
    .mockResolvedValue({ path: '/model', source: 'https://example.test', revision: 'abc', verified: false, download: 'missing' }),
}));

vi.mock('../../vscode/src/session_speech_cost', () => ({
  SessionSpeechCost: class {
    constructor(publish: NonNullable<typeof fakes.costPublish>) {
      fakes.costPublish = publish;
    }
    capture = fakes.costCapture;
    start = vi.fn();
    restore = vi.fn();
    end = vi.fn();
    view = vi.fn(() => ({ seen: false, total: 0, pending: 0, partial: false }));
  },
}));
vi.mock('../../vscode/src/speech_gpu_client', () => ({ createGpuSynthesisClient: fakes.gpuClientFactory }));
vi.mock('../../vscode/src/speech_gpu_host_binding', () => ({
  createGpuHostBinding: () => ({ preflight: fakes.gpuPreflight, issue: fakes.gpuIssue }),
}));
vi.mock('../../vscode/src/speech_gpu_model', () => ({ installedGpuModel: fakes.gpuInstalled, setupGpuModel: fakes.gpuDownload }));
vi.mock('../../vscode/src/speech_gpu_setup_flow', () => ({
  setupGpuFlow: (options: import('../../vscode/src/speech_gpu_setup_flow').GpuSetupFlowOptions) => {
    fakes.gpuFlow = options;
    return fakes.gpuFlowResult();
  },
}));
vi.mock('../../vscode/src/speech_readiness', () => ({ speechReady: fakes.readiness }));
vi.mock('../../vscode/src/speech_platform', () => ({ localSpeechPlatform: fakes.platform }));
vi.mock('vscode', () => ({
  env: {
    get uiKind() {
      return fakes.uiKind;
    },
  },
  UIKind: { Desktop: 1 },
  ConfigurationTarget: { Global: 1 },
  workspace: {
    getConfiguration: () => ({
      get: (key: string) => fakes.config.get(key),
      inspect: (key: string) => ({ globalValue: fakes.config.get(key) }),
      update: fakes.update,
    }),
    onDidChangeConfiguration: (callback: typeof fakes.configChanged) => {
      fakes.configChanged = callback;
      return { dispose: vi.fn() };
    },
  },
  window: { showInputBox: fakes.showInputBox, showErrorMessage: fakes.errorMessage, showInformationMessage: fakes.informationMessage },
}));
vi.mock('../../vscode/src/speech_service', () => ({
  SpeechService: class {
    private value: import('../../vscode/src/speech_compute_types').SpeechComputeState;
    private generation = 0;
    private readonly changed?: import('../../vscode/src/speech_service').SpeechServiceOptions['computeChanged'];
    constructor(
      options: { cloudDiagnostic?: (reason: 'auth') => void; openRouterDiagnostic?: (reason: 'auth') => void } & Pick<
        import('../../vscode/src/speech_service').SpeechServiceOptions,
        'computeMode' | 'computeChanged' | 'gpuCapability' | 'createGpu' | 'openRouterAllowed'
      >,
    ) {
      fakes.cloudDiagnostic = options.cloudDiagnostic;
      fakes.openDiagnostic = options.openRouterDiagnostic;
      fakes.speechOptions = options;
      this.changed = options.computeChanged;
      this.value = { requestedMode: options.computeMode?.() ?? 'cpu', actualBackend: 'none', gpuCheck: { phase: 'idle' } };
    }
    localComputeUsable = fakes.computeUsable;
    computeGeneration() {
      return this.generation;
    }
    computeState() {
      return this.value;
    }
    selectComputeMode(requestedMode: import('../../vscode/src/speech_compute_types').SpeechComputeMode) {
      fakes.cancel();
      this.generation++;
      this.value = { ...this.value, requestedMode };
      this.changed?.(this.value);
    }
    async checkGpu(
      operation: (
        signal: AbortSignal,
        progress: (value: import('../../vscode/src/speech_compute_types').GpuCheckProgress) => void,
      ) => Promise<import('../../vscode/src/speech_compute_types').GpuCheck>,
      signal: AbortSignal,
    ) {
      const result = fakes.setupBusy() ? { phase: 'unavailable' as const, reason: 'busy' as const } : await operation(signal, () => {});
      const gpuCheck = signal.aborted ? { phase: 'unavailable' as const, reason: 'inconclusive' as const } : result;
      if (gpuCheck.phase !== 'unavailable' || gpuCheck.reason !== 'busy') {
        this.value = { ...this.value, gpuCheck };
        this.changed?.(this.value);
      }
      return gpuCheck;
    }
    configureNarrationContext = fakes.configureContext;
    setNarrationSession = fakes.setContextSession;
    prepare = fakes.prepare;
    cancel = fakes.cancel;
    invalidateCloud = fakes.invalidateCloud;
    openRouterCatalogChanged = fakes.openCatalogChanged;
    audioEvent = fakes.audioEvent;
    dispose = fakes.dispose;
    preview = fakes.preview;
    pageClosed = vi.fn();
  },
}));
vi.mock('../../vscode/src/speech_catalog', () => ({
  SpeechCatalog: class {
    constructor(client: unknown, publish: NonNullable<typeof fakes.catalogPublish>) {
      void client;
      fakes.catalogPublish = publish;
    }
    invalidate = fakes.invalidate;
    contains = fakes.contains;
    load = fakes.load;
  },
}));
vi.mock('../../vscode/src/speech_credentials', () => ({
  SpeechCredentials: class {
    constructor(
      storage: unknown,
      prompt: NonNullable<typeof fakes.credentialPrompt>,
      changed: NonNullable<typeof fakes.credentialChanged>,
      key?: string,
    ) {
      void storage;
      if (key === undefined) {
        fakes.credentialPrompt = prompt;
        fakes.credentialChanged = changed;
      } else {
        fakes.openPrompt = prompt;
        fakes.openChanged = changed;
        this.read = fakes.openRead;
        this.hasKey = fakes.openHasKey;
        this.set = fakes.openSet;
        this.remove = fakes.openRemove;
        this.supersede = fakes.openSupersede;
        this.invalidate = fakes.openCredentialInvalidate;
      }
    }
    read = fakes.read;
    hasKey = fakes.hasKey;
    set = fakes.set;
    remove = fakes.remove;
    supersede = fakes.supersede;
    invalidate = fakes.credentialInvalidate;
  },
}));
vi.mock('../../vscode/src/speech_openrouter', () => ({
  OpenRouterClient: class {
    readonly client = true;
    constructor(
      read: NonNullable<typeof fakes.openReadKey>,
      fetcher: typeof fetch | undefined,
      decoder: import('../../vscode/src/speech_types').OpenRouterAudioDecoder,
      captureCost: NonNullable<typeof fakes.openCostCapture>,
    ) {
      void fetcher;
      fakes.openReadKey = read;
      fakes.openDecoder = decoder;
      fakes.openCostCapture = captureCost;
    }
  },
}));
vi.mock('../../vscode/src/speech_openrouter_catalog', () => ({
  OpenRouterCatalog: class {
    constructor(client: unknown, publish: NonNullable<typeof fakes.openPublish>) {
      void client;
      fakes.openPublish = publish;
    }
    invalidate = fakes.openInvalidate;
    contains = fakes.openContains;
    allows = fakes.openAllows;
    load = fakes.openLoad;
  },
}));
vi.mock('../../vscode/src/speech_elevenlabs', () => ({
  ElevenLabsClient: class {
    readonly client = true;
    constructor(read: NonNullable<typeof fakes.readKey>) {
      fakes.readKey = read;
    }
  },
}));
vi.mock('../../vscode/src/speech_output_preferences', () => ({
  SpeechOutputPreferences: class {
    constructor(wiring: NonNullable<typeof fakes.preferencesWiring>) {
      fakes.preferencesWiring = wiring;
    }
    choice = fakes.choice;
    view = vi.fn();
    ready = fakes.ready;
    refresh = fakes.refresh;
    choose = vi.fn().mockResolvedValue(undefined);
  },
}));
vi.mock('../../vscode/src/speech_runtime_status', () => ({ speechRuntimeAvailable: fakes.runtime }));
vi.mock('../../vscode/src/speech_setup', () => ({
  installedSpeechModel: fakes.installed,
  speechModelStatus: fakes.modelStatus,
  setupSpeech: fakes.setup,
}));
vi.mock('../src/companion_output', () => ({
  CompanionOutput: class {
    constructor(wiring: NonNullable<typeof fakes.outputWiring>) {
      fakes.outputWiring = wiring;
    }
    dispose = fakes.outputDispose;
    stopAndWait = fakes.stopAndWait;
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  fakes.platform.mockReturnValue({ supported: true });
  fakes.config.clear();
  fakes.uiKind = 1;
  fakes.update.mockReset().mockResolvedValue(undefined);
  fakes.choice.mockReturnValue({ kind: 'default' });
  fakes.ready.mockReturnValue(true);
  fakes.runtime.mockReset().mockResolvedValue(false);
  fakes.hasKey.mockReset().mockResolvedValue(false);
  fakes.openHasKey.mockReset().mockResolvedValue(false);
  fakes.openContains.mockReturnValue(false);
  fakes.openAllows.mockReturnValue(true);
  fakes.contains.mockReturnValue(false);
});

/** Creates a local host with typed isolated collaborators. */
function harness(
  capabilities?: () => Promise<import('../../audio-native/src').AudioCapabilities>,
  gpuProof?: import('../../vscode/src/speech_gpu_binding').GpuBindingDependencies['proof'],
  enableGpuInference = false,
) {
  // The solitary fixture implements the VS Code context methods this module calls.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const context = {
    extensionPath: '/extension',
    globalStorageUri: { fsPath: '/storage' },
    secrets: {
      onDidChange: (callback: typeof fakes.secretChanged) => {
        fakes.secretChanged = callback;
        return { dispose: vi.fn() };
      },
    },
    globalState: { get: () => undefined, update: vi.fn() },
  } as unknown as vscode.ExtensionContext;
  const list = vi.fn<() => Promise<Array<import('../../audio-native/src').AudioDevice>>>().mockResolvedValue([]);
  const adapter: AudioAdapter = {
    capabilities:
      capabilities ??
      vi.fn().mockResolvedValue({ backend: 'pipewire', location: 'ui', defaultOutput: true, deviceSelection: true, pauseResume: true }),
    list,
    admit: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(),
    onEvent: vi.fn(),
  };
  const panel = {
    showSpeechReadiness: vi.fn(),
    showSpeechKeyStatus: vi.fn(),
    showOpenRouterKeyStatus: vi.fn(),
    showOpenRouterCatalog: vi.fn(),
    showSpeechOutputCatalog: vi.fn(),
    showSpeechCatalog: vi.fn(),
    showSpeechSettings: vi.fn(),
    showSpeechComputeState: vi.fn(),
    showSpeechStatus: vi.fn(),
    showSpeechCost: vi.fn(),
    refreshSpeechSupport: vi.fn(),
  };
  const diagnostic = vi.fn<(event: SpeechDiagnosticEvent) => void>();
  const host = createSpeechHost({
    context,
    adapter,
    connectionEpoch: 'epoch',
    ...(gpuProof === undefined ? {} : { gpuProof }),
    enableGpuInference,
    page: () => 1,
    panel: () => panel,
    diagnostic,
  });
  return { host, adapter, panel, list, diagnostic };
}

it('keeps the OpenRouter cost ledger in the local companion host', () => {
  const { host, panel } = harness();
  expect(host.panelSpeech.sessionCost).toBeDefined();
  fakes.openCostCapture?.();
  expect(fakes.costCapture).toHaveBeenCalledOnce();
  const snapshot = { seen: true, total: 0.03, pending: 0, partial: false };
  fakes.costPublish?.(snapshot);
  expect(panel.showSpeechCost).toHaveBeenCalledWith(snapshot);
});

it('ignores a late cost update after the host is disposed', async () => {
  const { host, panel } = harness();
  const publish = fakes.costPublish;
  if (publish === undefined) throw new Error('Missing cost publisher');
  await host.dispose();
  publish({ seen: true, total: 0.03, pending: 0, partial: false });
  expect(panel.showSpeechCost).not.toHaveBeenCalled();
});

it('prepares on activation and speech settings changes', () => {
  fakes.config.set('speech.enabled', true);
  const { host } = harness();
  expect(fakes.prepare).toHaveBeenCalledOnce();
  fakes.configChanged?.({ affectsConfiguration: () => false });
  expect(fakes.prepare).toHaveBeenCalledOnce();
  fakes.config.set('speech.provider', 'elevenlabs');
  fakes.configChanged?.({ affectsConfiguration: () => true });
  expect(host.panelSpeech.settings.get()).toMatchObject({ enabled: true, provider: 'elevenlabs' });
  expect(fakes.prepare).toHaveBeenCalledTimes(2);
  fakes.config.set('speech.enabled', false);
  fakes.configChanged?.({ affectsConfiguration: () => true });
  expect(host.panelSpeech.settings.get().enabled).toBe(false);
  expect(fakes.prepare).toHaveBeenCalledTimes(3);
  fakes.config.set('speech.computeMode', 'gpu');
  fakes.configChanged?.({ affectsConfiguration: () => true });
  expect(fakes.prepare).toHaveBeenCalledTimes(4);
});

it('routes OpenRouter decoder admission through the current local panel', async () => {
  harness();
  const decoder = fakes.openDecoder;
  if (decoder === undefined) throw new Error('Missing decoder');
  await expect(decoder.admit(42, new AbortController().signal)).rejects.toThrow('Decoder unavailable');
});

it('uses local settings and credentials through panel callbacks', async () => {
  const { host, panel } = harness();
  expect(fakes.refresh).not.toHaveBeenCalled();
  expect(host.panelSpeech.settings.get().enabled).toBe(false);
  fakes.catalogPublish?.({ voices: [], more: false, loading: true, error: false });
  fakes.catalogPublish?.({ voices: [], more: false, loading: false, error: false });
  fakes.catalogPublish?.({ voices: [], more: false, loading: false, error: false, reset: true });
  fakes.outputWiring?.event({ id: 1, pageId: 1, event: 'started' });
  fakes.outputWiring?.status(1, 'speaking');
  expect(panel.showSpeechStatus).toHaveBeenCalled();
  expect(fakes.outputWiring?.choice()).toEqual({ kind: 'default' });
  await fakes.preferencesWiring?.write({ kind: 'default' });
  fakes.preferencesWiring?.stop();
  await fakes.preferencesWiring?.discover();
  fakes.credentialChanged?.();
  await fakes.credentialPrompt?.();
  fakes.configChanged?.({ affectsConfiguration: () => true });
  const setting = { ...host.panelSpeech.settings.get(), enabled: true, provider: 'elevenlabs' as const, elevenLabsVoice: 'voice' };
  host.panelSpeech.settings.set(setting);
  expect(host.panelSpeech.settings.get()).toEqual(setting);
  await vi.waitFor(() => {
    expect(panel.showSpeechSettings).toHaveBeenCalled();
  });
  expect(fakes.cancel).toHaveBeenCalled();
  expect(await host.panelSpeech.modelStatus()).toMatchObject({ download: 'missing' });
  host.panelSpeech.outputView();
  host.panelSpeech.outputReady();
  host.panelSpeech.outputRefresh();
  host.panelSpeech.outputSelect({ kind: 'default' });
  host.panelSpeech.outputRetired(1, 1);
  host.panelSpeech.outputPageRetired(1);
  host.panelSpeech.loadVoices(false);
  expect(fakes.load).toHaveBeenCalledWith(false);
  expect(host.panelSpeech.validCloudVoice('voice')).toBe(false);
  expect(host.panelSpeech.cloudSupported()).toBe(true);
  expect(await host.panelSpeech.installed()).toBe(false);
  await host.panelSpeech.setup();
  host.panelSpeech.event({ id: 1, pageId: 1, event: 'started' });
  host.panelSpeech.pageClosed(1);
  expect(fakes.audioEvent).toHaveBeenCalled();
  await host.panelSpeech.keySet();
  expect(fakes.set).toHaveBeenCalledOnce();
  await host.panelSpeech.keyRemove();
  expect(fakes.remove).toHaveBeenCalledOnce();
  await host.panelSpeech.preview();
  expect(fakes.preview).toHaveBeenCalledOnce();
  host.panelSpeech.stop();
  expect(fakes.cancel).toHaveBeenCalled();
  void host.dispose();
  expect(fakes.dispose).toHaveBeenCalledOnce();
  expect(fakes.outputDispose).toHaveBeenCalledOnce();
});

it('keeps the latest setting while serialized writes are pending and rolls back a failed latest save', async () => {
  const { host, panel } = harness();
  const pending = Promise.withResolvers<void>();
  fakes.update.mockReturnValueOnce(pending.promise);
  const initial = host.panelSpeech.settings.get();
  const first = { ...initial, enabled: true };
  const second = { ...first, provider: 'elevenlabs' as const, elevenLabsVoice: 'voice' };
  host.panelSpeech.settings.set(first);
  host.panelSpeech.settings.set(second);
  expect(host.panelSpeech.settings.get()).toEqual(second);
  await vi.waitFor(() => {
    expect(fakes.update).toHaveBeenCalledTimes(1);
  });
  pending.resolve();
  await vi.waitFor(() => {
    expect(fakes.update).toHaveBeenCalledTimes(16);
  });
  expect(panel.showSpeechSettings).toHaveBeenCalledTimes(3);
  fakes.update.mockRejectedValueOnce(new Error('private'));
  host.panelSpeech.settings.set(first);
  await vi.waitFor(() => {
    expect(fakes.errorMessage).toHaveBeenCalledWith('Could not save speech settings.');
  });
  expect(host.panelSpeech.settings.get()).toEqual(initial);
  expect(fakes.cancel).toHaveBeenCalled();
  expect(fakes.invalidate).toHaveBeenCalled();
  void host.dispose();
});

it('invalidates pending voice and speech when the local key changes', async () => {
  const { host, panel } = harness();
  fakes.config.set('speech.elevenLabsVoice', 'old_voice');
  fakes.credentialChanged?.();
  expect(fakes.invalidateCloud).toHaveBeenCalledOnce();
  expect(host.panelSpeech.settings.get().elevenLabsVoice).toBe('');
  await vi.waitFor(() => {
    expect(panel.showSpeechSettings).toHaveBeenCalled();
  });
  fakes.secretChanged?.({ key: 'unrelated' });
  expect(fakes.credentialInvalidate).not.toHaveBeenCalled();
  fakes.secretChanged?.({ key: 'aiPair.elevenLabs.apiKey' });
  expect(fakes.credentialInvalidate).toHaveBeenCalledOnce();
  await vi.waitFor(() => {
    expect(panel.showSpeechKeyStatus).toHaveBeenCalledWith(false);
  });
  void host.dispose();
});

it('cancels local speech when external settings disable it or switch provider', () => {
  fakes.config.set('speech.enabled', true);
  const { host, panel } = harness();
  fakes.config.set('speech.enabled', false);
  fakes.configChanged?.({ affectsConfiguration: () => false });
  expect(fakes.cancel).not.toHaveBeenCalled();
  fakes.configChanged?.({ affectsConfiguration: () => true });
  expect(fakes.cancel).toHaveBeenCalledOnce();
  fakes.config.set('speech.provider', 'elevenlabs');
  fakes.configChanged?.({ affectsConfiguration: () => true });
  expect(fakes.supersede).toHaveBeenCalled();
  expect(fakes.invalidate).toHaveBeenCalled();
  expect(panel.showSpeechSettings).toHaveBeenCalledTimes(2);
  void host.dispose();
});

it('drops asynchronous key, capability and runtime results after disposal', async () => {
  const runtime = Promise.withResolvers<boolean>();
  const key = Promise.withResolvers<boolean>();
  const capability = Promise.withResolvers<import('../../audio-native/src').AudioCapabilities>();
  fakes.runtime.mockReturnValueOnce(runtime.promise);
  fakes.hasKey.mockReturnValueOnce(key.promise);
  const { host, panel } = harness(() => capability.promise);
  host.panelSpeech.keyRefresh();
  void host.dispose();
  runtime.resolve(true);
  key.resolve(true);
  capability.resolve({ backend: 'pipewire', location: 'ui', defaultOutput: true, deviceSelection: true, pauseResume: true });
  await Promise.resolve();
  expect(panel.refreshSpeechSupport).not.toHaveBeenCalled();
  expect(panel.showSpeechKeyStatus).not.toHaveBeenCalled();
});

it('only admits the selected backend and never substitutes a missing route', async () => {
  const { host, list } = harness();
  await vi.waitFor(() => {
    expect(host.panelSpeech.outputReady()).toBe(true);
  });
  fakes.choice.mockReturnValue({ kind: 'native', backend: 'coreaudio', name: 'headset' });
  expect(host.panelSpeech.outputReady()).toBe(false);
  expect(fakes.outputWiring?.choice()).toEqual({ kind: 'device', id: 'headset' });
  fakes.choice.mockReturnValue({ kind: 'native', backend: 'pipewire', name: 'headset' });
  fakes.ready.mockReturnValue(false);
  expect(host.panelSpeech.outputReady()).toBe(false);
  fakes.ready.mockReturnValue(true);
  expect(host.panelSpeech.outputReady()).toBe(true);
  list.mockResolvedValueOnce([{ id: 'headset', label: 'Headset' }]);
  expect(await fakes.preferencesWiring?.discover()).toEqual({
    supported: true,
    devices: [{ choice: { kind: 'native', backend: 'pipewire', name: 'headset' }, label: 'Headset', available: true }],
  });
  fakes.preferencesWiring?.changed({ supported: true, devices: [], selected: { kind: 'default' } });
  void host.dispose();
});

it('reports unavailable output and key failures without exposing their details', async () => {
  const unavailable = { backend: 'unknown', location: 'ui' as const, defaultOutput: false, deviceSelection: false, pauseResume: false };
  const { host, panel } = harness(() => Promise.resolve(unavailable));
  expect(await fakes.preferencesWiring?.discover()).toEqual({ supported: false, devices: [], reason: 'unsupported' });
  fakes.hasKey.mockRejectedValueOnce(new Error('secret'));
  host.panelSpeech.keyRefresh();
  await vi.waitFor(() => {
    expect(panel.showSpeechKeyStatus).toHaveBeenCalledWith(false);
  });
  fakes.stopAndWait.mockRejectedValueOnce(new Error('private'));
  fakes.preferencesWiring?.stop();
  expect(fakes.cancel).toHaveBeenCalled();
  void host.dispose();
});

it('reports catalog outcomes using only fixed diagnostic reasons', () => {
  const { host } = harness();
  const publish = fakes.catalogPublish;
  publish?.({ voices: [], more: false, loading: true, error: false });
  publish?.({ voices: [], more: false, loading: false, error: true });
  publish?.({ voices: [], more: false, loading: true, error: false });
  publish?.({ voices: [], more: false, loading: false, error: true, errorKind: 'network' });
  publish?.({ voices: [], more: false, loading: true, error: false });
  publish?.({ voices: [{ id: 'voice', name: 'Voice' }], more: false, loading: false, error: false });
  void host.dispose();
  publish?.({ voices: [], more: false, loading: false, error: false });
});

it('reads local settings, previews installed models, and keeps cloud unavailable in web hosts', async () => {
  fakes.uiKind = 2;
  fakes.config.set('speech.enabled', true);
  fakes.config.set('speech.voice', 'am_michael');
  fakes.config.set('speech.speed', 1.25);
  fakes.config.set('speech.provider', 'elevenlabs');
  fakes.config.set('speech.elevenLabsVoice', 'voice');
  fakes.config.set('speech.elevenLabsSpeed', 1.1);
  fakes.installed.mockResolvedValueOnce('/model');
  const { host, panel } = harness();
  expect(host.panelSpeech.settings.get()).toEqual({
    contextEnabled: false,
    enabled: true,
    voice: 'am_michael',
    speed: 1.25,
    provider: 'elevenlabs',
    elevenLabsVoice: 'voice',
    elevenLabsSpeed: 1.1,
    listeningSpeed: 1,
  });
  expect(host.panelSpeech.cloudSupported()).toBe(false);
  expect(host.panelSpeech.supported()).toBe(false);
  expect(host.panelSpeech.gpuSupported()).toBe(false);
  expect(await host.panelSpeech.installed()).toBe(true);
  fakes.hasKey.mockResolvedValueOnce(true);
  host.panelSpeech.keyRefresh();
  await vi.waitFor(() => {
    expect(panel.showSpeechKeyStatus).toHaveBeenCalledWith(true);
  });
  await fakes.readKey?.();
  expect(fakes.read).toHaveBeenCalled();
  void host.dispose();
});

it('restores a newly validated voice and ignores a superseded failed save', async () => {
  const { host } = harness();
  fakes.credentialChanged?.();
  await vi.waitFor(() => {
    expect(fakes.update).toHaveBeenCalledTimes(8);
  });
  const blocked = Promise.withResolvers<void>();
  fakes.update.mockReturnValueOnce(blocked.promise);
  const first = { ...host.panelSpeech.settings.get(), enabled: true };
  host.panelSpeech.settings.set(first);
  await vi.waitFor(() => {
    expect(fakes.update).toHaveBeenCalledTimes(8);
  });
  fakes.contains.mockReturnValue(true);
  const second = { ...first, elevenLabsVoice: 'new_voice' };
  host.panelSpeech.settings.set(second);
  blocked.reject(new Error('old failure'));
  await vi.waitFor(() => {
    expect(fakes.update).toHaveBeenCalledTimes(17);
  });
  expect(fakes.errorMessage).not.toHaveBeenCalled();
  fakes.config.set('speech.elevenLabsVoice', 'new_voice');
  await vi.waitFor(() => {
    expect(host.panelSpeech.settings.get().elevenLabsVoice).toBe('new_voice');
  });
  void host.dispose();
});

it('handles unsupported adapters and superseded capability discovery', async () => {
  const first = Promise.withResolvers<import('../../audio-native/src').AudioCapabilities>();
  const capabilities = vi
    .fn<() => Promise<import('../../audio-native/src').AudioCapabilities>>()
    .mockRejectedValueOnce(new Error('unavailable'))
    .mockReturnValueOnce(first.promise)
    .mockResolvedValueOnce({ backend: 'unknown', location: 'ui', defaultOutput: true, deviceSelection: true, pauseResume: false })
    .mockResolvedValueOnce({ backend: 'pipewire', location: 'ui', defaultOutput: true, deviceSelection: false, pauseResume: false });
  const { host } = harness(capabilities);
  const stale = fakes.preferencesWiring?.discover();
  expect(await fakes.preferencesWiring?.discover()).toEqual({ supported: false, devices: [], reason: 'unsupported' });
  first.resolve({ backend: 'unknown', location: 'ui', defaultOutput: true, deviceSelection: true, pauseResume: true });
  await stale;
  expect(await fakes.preferencesWiring?.discover()).toEqual({ supported: true, devices: [] });
  fakes.choice.mockReturnValue({ kind: 'native', backend: 'pipewire', name: 'headset' });
  expect(host.panelSpeech.outputReady()).toBe(false);
  void host.dispose();
  fakes.preferencesWiring?.changed({ supported: false, devices: [], selected: { kind: 'default' } });
  fakes.outputWiring?.status(1, 'idle');
});

it('supports a ready local runtime and suppresses stale key failures', async () => {
  const key = Promise.withResolvers<boolean>();
  fakes.runtime.mockResolvedValueOnce(true);
  fakes.hasKey.mockReturnValueOnce(key.promise).mockResolvedValueOnce(true);
  const { host, panel } = harness();
  await vi.waitFor(() => {
    expect(host.panelSpeech.supported()).toBe(true);
  });
  host.panelSpeech.keyRefresh();
  host.panelSpeech.keyRefresh();
  await vi.waitFor(() => {
    expect(panel.showSpeechKeyStatus).toHaveBeenCalledWith(true);
  });
  key.reject(new Error('late'));
  await Promise.resolve();
  expect(panel.showSpeechKeyStatus).toHaveBeenCalledTimes(1);
  void host.dispose();
});

it('reports unavailable process evidence without exposing host details', async () => {
  fakes.platform.mockReturnValue({ supported: false, reason: 'libc_report_failed' });
  const host = harness();
  expect(host.host.panelSpeech.supported()).toBe(false);
  await vi.waitFor(() => {
    expect(host.diagnostic).toHaveBeenCalledWith({
      kind: 'speech',
      event: 'capability',
      phase: 'blocked',
      provider: 'kokoro',
      reason: 'libc_report_failed',
    });
  });
  void host.host.dispose();
});

it('cancels on disable without invalidating the unchanged provider', () => {
  fakes.config.set('speech.enabled', true);
  const { host } = harness();
  fakes.configChanged?.({ affectsConfiguration: () => true });
  expect(fakes.cancel).not.toHaveBeenCalled();
  host.panelSpeech.settings.set({ ...host.panelSpeech.settings.get(), enabled: false });
  expect(fakes.cancel).toHaveBeenCalledOnce();
  expect(fakes.supersede).not.toHaveBeenCalled();
  void host.dispose();
});

it('exposes only bounded local speech lifecycle facts for integration observation', () => {
  const { host } = harness();
  expect(host.observation()).toBeUndefined();
  fakes.outputWiring?.status(7, 'preparing', 'private text');
  expect(host.observation()).toEqual({ id: 7, state: 'preparing', started: false });
  fakes.outputWiring?.status(7, 'speaking');
  fakes.audioEvent.mockReturnValueOnce('ended');
  fakes.outputWiring?.event({ id: 7, pageId: 1, event: 'ended' });
  expect(host.observation()).toEqual({ id: 7, state: 'speaking', started: true, terminal: 'ended' });
  expect(JSON.stringify(host.observation())).not.toContain('private text');
  void host.dispose();
});

it('records local worker and preview outcomes without sensitive content', async () => {
  const { host, diagnostic } = harness();
  fakes.outputWiring?.localDiagnostic?.('failed', 'worker_module');
  fakes.preview.mockImplementationOnce(() => {
    fakes.outputWiring?.status(9, 'preparing');
    return Promise.resolve();
  });
  const preview = host.panelSpeech.preview();
  fakes.outputWiring?.status(9, 'speaking');
  await preview;
  expect(diagnostic).toHaveBeenCalledWith({
    kind: 'speech',
    event: 'runtime',
    provider: 'kokoro',
    phase: 'failed',
    reason: 'worker_module',
  });
  expect(diagnostic).toHaveBeenCalledWith({ kind: 'speech', event: 'preview', provider: 'kokoro', phase: 'ready' });
  void host.dispose();
});

it('records preview failure and ignores an older preview settlement', async () => {
  const { host, diagnostic } = harness();
  fakes.outputWiring?.localDiagnostic?.('ready');
  fakes.outputWiring?.status(1, 'preparing');
  fakes.outputWiring?.status(1, 'idle');
  const older = Promise.withResolvers<void>();
  const newer = Promise.withResolvers<void>();
  fakes.preview.mockImplementationOnce(() => {
    fakes.outputWiring?.status(2, 'preparing');
    return older.promise;
  });
  fakes.preview.mockImplementationOnce(() => {
    fakes.outputWiring?.status(3, 'preparing');
    return newer.promise;
  });
  const first = host.panelSpeech.preview();
  const second = host.panelSpeech.preview();
  older.resolve();
  await first;
  fakes.outputWiring?.status(3, 'unavailable', 'private');
  expect(diagnostic).toHaveBeenCalledWith({ kind: 'speech', event: 'preview', provider: 'kokoro', phase: 'failed', reason: 'unknown' });
  expect(diagnostic).toHaveBeenCalledWith({ kind: 'speech', event: 'runtime', provider: 'kokoro', phase: 'ready' });
  newer.resolve();
  await second;
  void host.dispose();
});

it('defaults invalid listening speed and persists it independently of synthesis speed', async () => {
  const { host } = harness();
  expect(host.panelSpeech.settings.get()).toMatchObject({ listeningSpeed: 1, speed: 1, elevenLabsSpeed: 1 });
  fakes.config.set('speech.listeningSpeed', 9);
  expect(host.panelSpeech.settings.get()).toMatchObject({ listeningSpeed: 1 });
  fakes.config.set('speech.listeningSpeed', 1.1);
  expect(host.panelSpeech.settings.get()).toMatchObject({ listeningSpeed: 1.1 });
  const current = host.panelSpeech.settings.get();
  host.panelSpeech.settings.set({ ...current, listeningSpeed: 1.1 });
  expect(fakes.cancel).not.toHaveBeenCalled();
  await vi.waitFor(() => {
    expect(fakes.update).toHaveBeenCalledWith('speech.listeningSpeed', 1.1, 1);
  });
  void host.dispose();
});

it('constructs the listening-speed worker from the fixed local extension path', () => {
  tempoPaths.length = 0;
  const { host } = harness();
  expect(tempoPaths).toEqual(['/extension/dist/speech/tempo_worker.mjs']);
  void host.dispose();
});

it('passes local readiness facts to the readiness check', async () => {
  const { host } = harness();
  expect(await host.ready()).toBe(true);
  const facts = fakes.readiness.mock.lastCall?.[0];
  expect(facts).toBeDefined();
  expect(facts?.settings().enabled).toBe(false);
  expect(facts?.desktop()).toBe(true);
  await expect(facts?.key('elevenlabs')).resolves.toBe(false);
  await expect(facts?.model()).resolves.toBe(false);
  expect(facts?.local()).toBe(false);
  await Promise.resolve();
  expect(facts?.output()).toBe(true);
  void host.dispose();
  expect(facts?.desktop()).toBe(false);
});

it('persists the compute choice and runs an explicit GPU check without assuming readiness', async () => {
  const { host, panel } = harness();
  expect(host.panelSpeech.computeState().requestedMode).toBe('cpu');
  expect(fakes.speechOptions?.computeMode?.()).toBe('cpu');
  host.panelSpeech.computeMode('gpu');
  expect(fakes.cancel).toHaveBeenCalled();
  await vi.waitFor(() => {
    expect(fakes.update).toHaveBeenCalledWith('speech.computeMode', 'gpu', 1);
  });
  host.panelSpeech.checkGpuSetup();
  await vi.waitFor(() => {
    expect(host.panelSpeech.computeState().gpuCheck).toEqual({ phase: 'unavailable', reason: 'runtime_missing' });
  });
  expect(panel.showSpeechComputeState).toHaveBeenCalled();
});

it('records cloud narration failures in companion diagnostics', () => {
  const { host, diagnostic } = harness();
  fakes.cloudDiagnostic?.('auth');
  expect(diagnostic).toHaveBeenCalledWith({ kind: 'speech', event: 'narration', provider: 'elevenlabs', phase: 'failed', reason: 'auth' });
  void host.dispose();
});

it('keeps the latest compute choice across pending saves and restores it after a failed save', async () => {
  const { host } = harness();
  const first = Promise.withResolvers<void>();
  fakes.update.mockReturnValueOnce(first.promise);
  host.panelSpeech.computeMode('auto');
  host.panelSpeech.computeMode('gpu');
  fakes.configChanged?.({ affectsConfiguration: () => true });
  expect(host.panelSpeech.computeState().requestedMode).toBe('gpu');
  first.resolve();
  await vi.waitFor(() => {
    expect(fakes.update).toHaveBeenCalledTimes(2);
  });
  fakes.config.set('speech.computeMode', 'auto');
  fakes.update.mockRejectedValueOnce(new Error('private'));
  host.panelSpeech.computeMode('gpu');
  await vi.waitFor(() => {
    expect(fakes.errorMessage).toHaveBeenCalledWith('Could not save speech compute mode.');
  });
  expect(host.panelSpeech.computeState().requestedMode).toBe('auto');
  fakes.config.set('speech.computeMode', 'cpu');
  fakes.configChanged?.({ affectsConfiguration: () => true });
  expect(host.panelSpeech.computeState().requestedMode).toBe('cpu');
});

it('ignores a stale compute save failure and normalizes stored and external choices', async () => {
  const { host } = harness();
  const stale = Promise.withResolvers<void>();
  fakes.update.mockReturnValueOnce(stale.promise);
  host.panelSpeech.computeMode('auto');
  host.panelSpeech.computeMode('gpu');
  stale.reject(new Error('private'));
  await vi.waitFor(() => {
    expect(fakes.update).toHaveBeenCalledTimes(2);
  });
  expect(fakes.errorMessage).not.toHaveBeenCalled();
  fakes.config.set('speech.computeMode', 'gpu');
  fakes.update.mockRejectedValueOnce(new Error('private'));
  host.panelSpeech.computeMode('cpu');
  await vi.waitFor(() => {
    expect(fakes.errorMessage).toHaveBeenCalledOnce();
  });
  expect(host.panelSpeech.computeState().requestedMode).toBe('gpu');
  fakes.config.set('speech.computeMode', 'invalid');
  fakes.update.mockRejectedValueOnce(new Error('private'));
  host.panelSpeech.computeMode('auto');
  await vi.waitFor(() => {
    expect(fakes.errorMessage).toHaveBeenCalledTimes(2);
  });
  expect(host.panelSpeech.computeState().requestedMode).toBe('cpu');
  fakes.config.set('speech.computeMode', 'gpu');
  fakes.configChanged?.({ affectsConfiguration: () => true });
  expect(host.panelSpeech.computeState().requestedMode).toBe('gpu');
});

it('exposes a bounded GPU failure snapshot for copied diagnostics', async () => {
  fakes.gpuFlowResult.mockResolvedValueOnce({ phase: 'unavailable', reason: 'no_hardware' });
  const { host } = harness(undefined, () => Promise.resolve('failed'), true);
  host.panelSpeech.computeMode('gpu');
  host.panelSpeech.checkGpuSetup();
  await vi.waitFor(() => {
    expect(host.gpuDiagnostics()).toEqual({
      requestedMode: 'gpu',
      actualBackend: 'none',
      check: { phase: 'unavailable', reason: 'no_hardware' },
      stage: 'preflight',
    });
  });
  void host.dispose();
});

it('routes explicit GPU setup through preflight, model installation, fresh proof and disposal cancellation', async () => {
  const { host } = harness(undefined, () => Promise.resolve('failed'));
  host.panelSpeech.checkGpuSetup();
  await vi.waitFor(() => {
    expect(fakes.gpuFlow).toBeDefined();
  });
  const flow = fakes.gpuFlow;
  if (flow === undefined) throw new Error('Missing GPU setup flow');
  expect(await flow.preflight(flow.signal)).toEqual({ phase: 'ready' });
  await flow.cpuModel();
  expect(fakes.installed).toHaveBeenCalledWith('/storage');
  expect(await flow.gpuModel()).toBe('/gpu');
  await flow.download(() => {});
  expect(fakes.gpuDownload).toHaveBeenCalledWith('/storage', expect.objectContaining({ signal: flow.signal }));
  expect(await flow.verify('/gpu', flow.signal)).toEqual({ phase: 'unavailable', reason: 'probe_failed' });
  fakes.gpuIssue.mockResolvedValueOnce({ check: { phase: 'ready' }, capability: { modelDirectory: '/other' } });
  expect(await flow.verify('/gpu', flow.signal)).toEqual({ phase: 'unavailable', reason: 'model_missing' });
  fakes.gpuIssue.mockResolvedValueOnce({ check: { phase: 'ready' }, capability: { modelDirectory: '/gpu' } });
  expect(await flow.verify('/gpu', flow.signal)).toEqual({ phase: 'ready' });
  void host.dispose();
  expect(flow.signal.aborted).toBe(true);
  fakes.speechOptions?.computeChanged?.({ requestedMode: 'cpu', actualBackend: 'none', gpuCheck: { phase: 'idle' } });
});

it('enables GPU inference only with an explicit reviewed gate and fresh host capability', async () => {
  const { host } = harness(undefined, () => Promise.resolve('failed'), /* enableGpuInference= */ true);
  expect(host.panelSpeech.gpuSupported()).toBe(true);
  const capability: import('../../vscode/src/speech_gpu_client').GpuLaunchCapability = {
    modelDirectory: '/gpu',
    runtimeDirectory: '/runtime',
    executablePath: '/node',
    loaderPath: '/loader',
    loaderSha256: 'a'.repeat(64),
    driverPath: '/driver-library',
    driverSha256: 'b'.repeat(64),
    driverDevice: '1',
    driverInode: '2',
    environment: { LANG: 'C', VK_DRIVER_FILES: '/driver', VK_LOADER_LAYERS_DISABLE: '~all~', LD_PRELOAD: '/loader' },
  };
  fakes.gpuIssue.mockResolvedValueOnce({ check: { phase: 'ready' }, capability });
  expect(await fakes.speechOptions?.gpuCapability?.(new AbortController().signal)).toEqual({ check: { phase: 'ready' }, capability });
  const listener = { ready: vi.fn(), retired: vi.fn() };
  fakes.speechOptions?.createGpu?.(capability, listener);
  expect(fakes.gpuClientFactory.mock.calls[0]?.[0].capability).toBe(capability);
  expect(fakes.gpuClientFactory.mock.calls[0]?.[0].listener).toBe(listener);
  const detail = fakes.gpuClientFactory.mock.calls[0]?.[0].detail;
  detail?.('spawn_error');
  detail?.('exit_nonzero');
  expect(host.gpuDiagnostics().workerDetails).toEqual(['spawn_error', 'exit_nonzero']);
  for (let i = 0; i < 8; i++) detail?.('loading');
  expect(host.gpuDiagnostics().workerDetails).toEqual(Array.from({ length: 8 }, () => 'loading'));
  void host.dispose();
});

it('does not run GPU setup while an inference worker still owns the slot', async () => {
  const { host } = harness(undefined, () => Promise.resolve('failed'), /* enableGpuInference= */ true);
  fakes.setupBusy.mockReturnValue(true);
  fakes.gpuFlow = undefined;
  host.panelSpeech.checkGpuSetup();
  await vi.waitFor(() => {
    expect(fakes.informationMessage).toHaveBeenCalledWith('Speech is still finishing; try GPU setup again shortly.');
  });
  expect(host.panelSpeech.computeState().gpuCheck).toEqual({ phase: 'idle' });
  expect(fakes.gpuFlow).toBeUndefined();
  void host.dispose();
  fakes.setupBusy.mockReturnValue(false);
});

it('drops a setup proof that settles after the host is disposed', async () => {
  const { host, panel } = harness(undefined, () => Promise.resolve('failed'), /* enableGpuInference= */ true);
  const pending = Promise.withResolvers<import('../../vscode/src/speech_compute_types').GpuCheck>();
  fakes.gpuFlowResult.mockReturnValueOnce(pending.promise);
  host.panelSpeech.checkGpuSetup();
  await vi.waitFor(() => {
    expect(fakes.gpuFlow).toBeDefined();
  });
  void host.dispose();
  const updates = panel.showSpeechComputeState.mock.calls.length;
  pending.resolve({ phase: 'ready' });
  await vi.waitFor(() => {
    expect(host.panelSpeech.computeState().gpuCheck).toEqual({ phase: 'unavailable', reason: 'inconclusive' });
  });
  expect(panel.showSpeechComputeState).toHaveBeenCalledTimes(updates);
});

it('does not offer GPU setup from a non-desktop host', async () => {
  fakes.uiKind = 2;
  const { host } = harness(undefined, () => Promise.resolve('failed'), /* enableGpuInference= */ true);
  fakes.gpuFlow = undefined;
  host.panelSpeech.checkGpuSetup();
  await vi.waitFor(() => {
    expect(host.panelSpeech.computeState().gpuCheck).toEqual({ phase: 'unavailable', reason: 'unsupported' });
  });
  expect(fakes.gpuFlow).toBeUndefined();
  void host.dispose();
  fakes.uiKind = 1;
});

it('projects cached audio facts without probing or exposing sensitive values', async () => {
  fakes.config.set('speech.enabled', true);
  fakes.config.set('speech.provider', 'elevenlabs');
  fakes.config.set('speech.elevenLabsVoice', 'private-voice');
  fakes.hasKey.mockResolvedValue(true);
  const capabilities = vi
    .fn()
    .mockResolvedValue({ backend: 'pipewire', location: 'ui', defaultOutput: true, deviceSelection: true, pauseResume: true });
  const { host, list } = harness(capabilities);
  expect(host.audioDiagnostics()).toEqual({
    enabled: true,
    provider: 'elevenlabs',
    keyConfigured: 'unknown',
    voiceConfigured: true,
    output: 'default',
    routeAvailable: 'unknown',
    runtimeReady: 'unknown',
    modelReady: 'unknown',
    lastPlayback: 'unknown',
  });
  await vi.waitFor(() => {
    expect(capabilities).toHaveBeenCalledTimes(1);
  });
  host.panelSpeech.keyRefresh();
  await vi.waitFor(() => {
    expect(host.audioDiagnostics().keyConfigured).toBe(true);
  });
  expect(host.audioDiagnostics()).toMatchObject({ routeAvailable: true, runtimeReady: false, modelReady: 'unknown' });
  await host.panelSpeech.installed();
  expect(host.audioDiagnostics().modelReady).toBe(false);
  fakes.outputWiring?.status(7, 'speaking');
  fakes.audioEvent.mockReturnValueOnce('failed');
  fakes.outputWiring?.event({ id: 7, pageId: 1, event: 'failed' });
  expect(host.audioDiagnostics().lastPlayback).toBe('failed');
  expect(JSON.stringify(host.audioDiagnostics())).not.toContain('private-voice');
  expect(capabilities).toHaveBeenCalledTimes(1);
  expect(list).not.toHaveBeenCalled();
  void host.dispose();
});

it('keeps unavailable and unobserved evidence unknown and invalidates cached checks', async () => {
  fakes.uiKind = 2;
  fakes.config.set('speech.provider', 'elevenlabs');
  const { host } = harness();
  await host.panelSpeech.modelStatus();
  host.panelSpeech.keyRefresh();
  await vi.waitFor(() => {
    expect(host.audioDiagnostics().keyConfigured).toBe(false);
  });
  expect(host.audioDiagnostics()).toMatchObject({
    voiceConfigured: false,
    output: 'unknown',
    routeAvailable: 'unknown',
    runtimeReady: 'unknown',
    modelReady: 'unknown',
  });
  fakes.credentialChanged?.();
  expect(host.audioDiagnostics().keyConfigured).toBe('unknown');
  void host.dispose();
});

it('uses discovered output availability and resets model evidence on setup', async () => {
  const { host } = harness();
  fakes.choice.mockReturnValue({ kind: 'native', backend: 'pipewire', name: 'private-device' });
  await vi.waitFor(() => {
    expect(host.panelSpeech.outputReady()).toBe(true);
  });
  expect(host.audioDiagnostics()).toMatchObject({ output: 'override', routeAvailable: 'unknown' });
  await fakes.preferencesWiring?.discover();
  expect(host.audioDiagnostics().routeAvailable).toBe(true);
  await host.panelSpeech.modelStatus();
  expect(host.audioDiagnostics().modelReady).toBe(false);
  await host.panelSpeech.setup();
  expect(host.audioDiagnostics().modelReady).toBe('unknown');
  expect(JSON.stringify(host.audioDiagnostics())).not.toContain('private-device');
  void host.dispose();
});

it('refreshes a restored native output at startup without opening Settings', () => {
  fakes.choice.mockReturnValue({ kind: 'native', backend: 'pipewire', name: 'headset' });
  const { host } = harness();
  expect(fakes.refresh).toHaveBeenCalledOnce();
  void host.dispose();
});

it('does not list devices after a restored host is disposed during discovery', async () => {
  const capability = Promise.withResolvers<import('../../audio-native/src').AudioCapabilities>();
  fakes.choice.mockReturnValue({ kind: 'native', backend: 'pipewire', name: 'headset' });
  const { host, list, panel } = harness(() => capability.promise);
  const discovery = fakes.preferencesWiring?.discover();
  void host.dispose();
  capability.resolve({ backend: 'pipewire', location: 'ui', defaultOutput: true, deviceSelection: true, pauseResume: true });
  await discovery;
  expect(list).not.toHaveBeenCalled();
  expect(panel.showSpeechOutputCatalog).not.toHaveBeenCalled();
});

it('ignores a device list that settles after disposal', async () => {
  const devices = Promise.withResolvers<Array<import('../../audio-native/src').AudioDevice>>();
  fakes.choice.mockReturnValue({ kind: 'native', backend: 'pipewire', name: 'headset' });
  const { host, list } = harness();
  list.mockReturnValueOnce(devices.promise);
  const discovery = fakes.preferencesWiring?.discover();
  await vi.waitFor(() => {
    expect(list).toHaveBeenCalledOnce();
  });
  void host.dispose();
  devices.resolve([{ id: 'headset', label: 'Headset' }]);
  await discovery;
  expect(host.audioDiagnostics().routeAvailable).toBe('unknown');
});

it('publishes conservative validated facts and ignores an older model result', async () => {
  fakes.runtime.mockResolvedValue(true);
  fakes.platform.mockReturnValue({ supported: false, reason: 'host_platform' });
  const older = Promise.withResolvers<string | undefined>();
  fakes.installed.mockReturnValueOnce(older.promise);
  fakes.installed.mockResolvedValueOnce(undefined);
  const { host, panel } = harness();
  const old = host.panelSpeech.installed();
  const latest = host.panelSpeech.installed();
  await latest;
  older.resolve('/old-model');
  await old;
  await vi.waitFor(() => {
    expect(host.audioDiagnostics().runtimeReady).toBe(false);
  });
  expect(host.audioDiagnostics().modelReady).toBe(false);
  expect(panel.showSpeechReadiness).toHaveBeenCalled();
  expect(panel.showSpeechReadiness.mock.lastCall?.[0]).toMatchObject({ runtimeReady: false, modelReady: false });
  void host.dispose();
});

it('invalidates model evidence on failure and ignores superseded or disposed status results', async () => {
  const status = { path: '/model', source: 'https://example.test', revision: 'abc', verified: true, download: 'installed' };
  const { host, panel } = harness();
  fakes.modelStatus.mockRejectedValueOnce(new Error('read failed'));
  await expect(host.panelSpeech.modelStatus()).rejects.toThrow('read failed');
  expect(host.audioDiagnostics().modelReady).toBe('unknown');
  const older = Promise.withResolvers<typeof status>();
  fakes.modelStatus.mockReturnValueOnce(older.promise);
  const old = host.panelSpeech.modelStatus();
  await host.panelSpeech.installed();
  older.resolve(status);
  await old;
  expect(host.audioDiagnostics().modelReady).toBe(false);
  const afterDispose = Promise.withResolvers<typeof status>();
  fakes.modelStatus.mockReturnValueOnce(afterDispose.promise);
  const pending = host.panelSpeech.modelStatus();
  void host.dispose();
  const sent = panel.showSpeechReadiness.mock.calls.length;
  afterDispose.resolve(status);
  await pending;
  expect(panel.showSpeechReadiness).toHaveBeenCalledTimes(sent);
});

it('projects an Auto preference and does not advertise a usable GPU when inference is disabled', async () => {
  fakes.config.set('speech.computeMode', 'auto');
  fakes.gpuFlowResult.mockResolvedValueOnce({ phase: 'ready' });
  const { host } = harness(undefined, () => Promise.resolve('failed'), false);
  expect(host.panelSpeech.computeState().requestedMode).toBe('auto');
  host.panelSpeech.checkGpuSetup();
  await vi.waitFor(() => {
    expect(host.panelSpeech.computeState().gpuCheck).toEqual({ phase: 'unavailable', reason: 'inconclusive' });
  });
  await host.dispose();
});

it('reports explicit GPU failure as unavailable while preserving Auto fallback readiness', async () => {
  fakes.runtime.mockResolvedValue(true);
  fakes.config.set('speech.computeMode', 'gpu');
  const { host } = harness();
  await vi.waitFor(() => {
    expect(host.audioDiagnostics().runtimeReady).toBe(true);
  });
  fakes.computeUsable.mockReturnValue(false);
  expect(host.audioDiagnostics().runtimeReady).toBe(false);
  await host.ready();
  expect(fakes.readiness.mock.lastCall?.[0].local()).toBe(false);
  fakes.computeUsable.mockReturnValue(true);
  expect(host.audioDiagnostics().runtimeReady).toBe(true);
  await host.dispose();
});

it('drops transient busy feedback after an ABA mode change', async () => {
  fakes.setupBusy.mockReturnValue(true);
  const { host } = harness(undefined, () => Promise.resolve('failed'), /* enableGpuInference= */ true);
  host.panelSpeech.checkGpuSetup();
  host.panelSpeech.computeMode('gpu');
  host.panelSpeech.computeMode('cpu');
  await Promise.resolve();
  await Promise.resolve();
  expect(fakes.informationMessage).not.toHaveBeenCalled();
  expect(host.panelSpeech.computeState().gpuCheck).toEqual({ phase: 'idle' });
  fakes.setupBusy.mockReturnValue(false);
  await host.dispose();
});

it('restores OpenRouter model, voice and ZDR settings in the local companion', () => {
  fakes.config.set('speech.provider', 'openrouter');
  fakes.config.set('speech.openRouterModel', 'model');
  fakes.config.set('speech.openRouterVoice', 'voice');
  fakes.config.set('speech.openRouterZdr', true);
  fakes.config.set('speech.openRouterFormat', 'pcm');
  const { host } = harness();
  expect(host.panelSpeech.settings.get()).toMatchObject({
    provider: 'openrouter',
    openRouterModel: 'model',
    openRouterVoice: 'voice',
    openRouterZdr: true,
    openRouterFormat: 'pcm',
  });
});

it('restores OpenRouter settings and routes its account catalog through the local host', async () => {
  fakes.config.set('speech.provider', 'openrouter');
  fakes.config.set('speech.openRouterModel', 'model');
  fakes.config.set('speech.openRouterVoice', 'voice');
  fakes.config.set('speech.openRouterZdr', true);
  fakes.openHasKey.mockResolvedValue(true);
  const { host, panel, diagnostic } = harness();
  expect(host.panelSpeech.settings.get()).toMatchObject({
    provider: 'openrouter',
    openRouterModel: 'model',
    openRouterVoice: 'voice',
    openRouterZdr: true,
  });
  host.panelSpeech.openRouterKeyRefresh();
  await vi.waitFor(() => {
    expect(panel.showOpenRouterKeyStatus).toHaveBeenCalledWith(true);
  });
  expect(host.audioDiagnostics()).toMatchObject({ provider: 'openrouter', keyConfigured: true, voiceConfigured: true });
  await fakes.openReadKey?.();
  expect(fakes.openRead).toHaveBeenCalled();
  await fakes.openPrompt?.();
  expect(fakes.showInputBox).toHaveBeenCalledWith(expect.objectContaining({ title: 'OpenRouter API key', password: true }));
  expect(fakes.speechOptions?.openRouterAllowed?.('model', 'voice')).toBe(true);
  host.panelSpeech.loadOpenRouterModels();
  expect(fakes.openLoad).toHaveBeenCalledWith(true);
  fakes.openContains.mockReturnValueOnce(true);
  expect(host.panelSpeech.validOpenRouterVoice('model', 'voice')).toBe(true);
  fakes.openPublish?.({ state: 'loading', verified: false, models: [] });
  expect(fakes.openCatalogChanged).not.toHaveBeenCalled();
  fakes.openPublish?.({ state: 'ready', verified: true, models: [] });
  expect(fakes.openCatalogChanged).toHaveBeenCalledOnce();
  expect(panel.showOpenRouterCatalog).toHaveBeenCalledWith({ state: 'ready', verified: true, models: [] });
  fakes.openDiagnostic?.('auth');
  expect(diagnostic).toHaveBeenCalledWith({ kind: 'speech', event: 'narration', provider: 'openrouter', phase: 'failed', reason: 'auth' });
  await host.panelSpeech.openRouterKeySet();
  await host.panelSpeech.openRouterKeyRemove();
  expect(fakes.openSet).toHaveBeenCalledOnce();
  expect(fakes.openRemove).toHaveBeenCalledOnce();
  await host.ready();
  const readiness = fakes.readiness.mock.calls.at(-1)?.[0];
  await readiness?.key('openrouter');
  expect(readiness?.openRouterAllowed?.('model', 'voice')).toBe(true);
  fakes.openAllows.mockReturnValueOnce(false);
  expect(readiness?.openRouterAllowed?.('model', 'voice')).toBe(false);
  expect(fakes.openHasKey).toHaveBeenCalled();
  host.panelSpeech.pageClosed(1);
  expect(fakes.openInvalidate).toHaveBeenCalled();
  await host.dispose();
  const count = panel.showOpenRouterCatalog.mock.calls.length;
  fakes.openPublish?.({ state: 'idle', verified: false, models: [] });
  expect(panel.showOpenRouterCatalog).toHaveBeenCalledTimes(count);
});

it('invalidates OpenRouter selections and requests when key or policy changes', async () => {
  fakes.config.set('speech.provider', 'openrouter');
  const { host, panel } = harness();
  const restored = host.panelSpeech.settings.get();
  expect(restored).toMatchObject({ openRouterModel: '', openRouterVoice: '', openRouterZdr: false });
  host.panelSpeech.settings.set({ ...restored, openRouterModel: 'model', openRouterVoice: 'voice', openRouterZdr: true });
  expect(fakes.cancel).toHaveBeenCalled();
  expect(fakes.openInvalidate).toHaveBeenCalled();
  await vi.waitFor(() => {
    expect(fakes.update).toHaveBeenCalledWith('speech.openRouterZdr', true, 1);
  });
  fakes.openChanged?.();
  expect(host.panelSpeech.settings.get()).toMatchObject({ openRouterModel: '', openRouterVoice: '' });
  expect(fakes.invalidateCloud).toHaveBeenCalled();
  fakes.secretChanged?.({ key: 'aiPair.openRouter.apiKey' });
  expect(fakes.openCredentialInvalidate).toHaveBeenCalled();
  await vi.waitFor(() => {
    expect(panel.showOpenRouterKeyStatus).toHaveBeenCalledWith(false);
  });
  await host.dispose();
});

it('ignores stale key checks and reports only current key-check failure', async () => {
  const { host, panel } = harness();
  const old = Promise.withResolvers<boolean>();
  fakes.openHasKey.mockReturnValueOnce(old.promise).mockRejectedValueOnce(new Error('private'));
  host.panelSpeech.openRouterKeyRefresh();
  host.panelSpeech.openRouterKeyRefresh();
  await vi.waitFor(() => {
    expect(panel.showOpenRouterKeyStatus).toHaveBeenCalledWith(false);
  });
  old.resolve(true);
  await Promise.resolve();
  expect(panel.showOpenRouterKeyStatus).not.toHaveBeenCalledWith(true);
  expect(JSON.stringify(panel.showOpenRouterKeyStatus.mock.calls)).not.toContain('private');
  await host.dispose();
});

it('invalidates the catalog on external ZDR changes and cancels changed model settings', () => {
  fakes.config.set('speech.provider', 'openrouter');
  const { host } = harness();
  fakes.config.set('speech.openRouterModel', 'model');
  fakes.configChanged?.({ affectsConfiguration: () => true });
  expect(fakes.cancel).toHaveBeenCalled();
  fakes.config.set('speech.openRouterZdr', true);
  fakes.configChanged?.({ affectsConfiguration: () => true });
  expect(fakes.openInvalidate).toHaveBeenCalled();
  void host.dispose();
});

it('handles an incomplete OpenRouter choice and ignores a superseded key failure', async () => {
  const { host, panel } = harness();
  const choice = { ...host.panelSpeech.settings.get(), provider: 'openrouter' as const };
  host.panelSpeech.settings.set(choice);
  expect(host.audioDiagnostics().voiceConfigured).toBe(false);
  host.panelSpeech.settings.set({ ...choice, openRouterModel: 'model' });
  const stale = Promise.withResolvers<boolean>();
  fakes.openHasKey.mockReturnValueOnce(stale.promise).mockResolvedValueOnce(true);
  host.panelSpeech.openRouterKeyRefresh();
  host.panelSpeech.openRouterKeyRefresh();
  await vi.waitFor(() => {
    expect(panel.showOpenRouterKeyStatus).toHaveBeenCalledWith(true);
  });
  stale.reject(new Error('private'));
  await Promise.resolve();
  expect(panel.showOpenRouterKeyStatus).not.toHaveBeenCalledWith(false);
  await host.dispose();
});

it('loads models with the pending ZDR choice before settings persistence finishes', async () => {
  fakes.config.set('speech.provider', 'openrouter');
  const save = Promise.withResolvers<void>();
  fakes.update.mockReturnValueOnce(save.promise);
  const { host } = harness();
  host.panelSpeech.settings.set({ ...host.panelSpeech.settings.get(), openRouterZdr: true });
  host.panelSpeech.loadOpenRouterModels();
  expect(fakes.openLoad).toHaveBeenCalledWith(true);
  save.resolve();
  await host.dispose();
});

it('applies pending and external context changes immediately and forwards session identity', () => {
  const { host } = harness();
  const configure = fakes.configureContext;
  const seen: boolean[] = [];
  configure.mockImplementation(() => {
    seen.push(host.panelSpeech.settings.get().contextEnabled === true);
  });
  const initial = host.panelSpeech.settings.get();
  host.panelSpeech.settings.set({ ...initial, contextEnabled: true });
  host.panelSpeech.settings.set({ ...initial, contextEnabled: false });
  expect(seen).toEqual([true, false]);
  host.panelSpeech.narrationSession?.(9, true);
  expect(fakes.setContextSession).toHaveBeenCalledWith(9, true);
  fakes.configChanged?.({ affectsConfiguration: () => true });
  expect(seen).toEqual([true, false, false]);
});
