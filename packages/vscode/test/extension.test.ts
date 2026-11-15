// The extension's wiring on its own (#176): what activate makes, the commands and settings it registers, and the
// Api it hands the integration test. Solitary: vscode, node:os, core's Bridge and Controller, and every module of
// the extension it builds on are fakes, so a test says what each answers and sees what activate asked of it.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const tempoPaths = vi.hoisted(() => [] as string[]);
const costFake = vi.hoisted(() => ({
  publish: undefined as ((value: import('../src/session_speech_cost').SessionSpeechCostView) => void) | undefined,
  capture: vi.fn<() => (() => ((cost: number | undefined) => void) | undefined) | undefined>(),
  captures: [] as Array<NonNullable<ConstructorParameters<typeof import('../src/speech_openrouter').OpenRouterClient>[3]>>,
}));
vi.mock('../src/session_speech_cost', () => ({
  SessionSpeechCost: class {
    constructor(publish: NonNullable<typeof costFake.publish>) {
      costFake.publish = publish;
    }
    begin = vi.fn();
    capture = costFake.capture;
    start = vi.fn();
    restore = vi.fn();
    end = vi.fn();
    view = vi.fn(() => ({ seen: false, total: 0, pending: 0, partial: false }));
  },
}));
vi.mock('../src/speech_openrouter', () => ({
  OpenRouterClient: class {
    readonly decoder: import('../src/speech_types').OpenRouterAudioDecoder | undefined;
    constructor(
      readonly readKey: () => Promise<string | undefined>,
      fetcher: typeof fetch | undefined,
      decoder: import('../src/speech_types').OpenRouterAudioDecoder | undefined,
      captureCost: NonNullable<ConstructorParameters<typeof import('../src/speech_openrouter').OpenRouterClient>[3]> | undefined,
    ) {
      void fetcher;
      this.decoder = decoder;
      if (captureCost !== undefined) costFake.captures.push(captureCost);
    }
    async models(zdr: boolean, signal: AbortSignal): Promise<Array<import('../src/speech_types').OpenRouterModel>> {
      void zdr;
      void signal;
      if ((await this.readKey()) === undefined) throw new Error('Missing API key');
      return [];
    }
    synthesize(): Promise<never> {
      return Promise.reject(new Error('Unexpected OpenRouter synthesis'));
    }
  },
}));
vi.mock('../src/speech_tempo_client', () => ({
  SpeechTempoClient: class {
    constructor(path: string) {
      tempoPaths.push(path);
    }
    dispose = vi.fn().mockResolvedValue(undefined);
  },
}));
import * as vscode from 'vscode';
import { isSavedSession } from '@ai-pair/core';
import { playDemo } from '../src/demo';
import { collectDiagnostics } from '../src/diagnostics_collector';
import { LOCAL_AUDIO_VERSION, AUDIO_DIAGNOSTICS_SCHEMA, DIAGNOSTIC_SNAPSHOT_SCHEMA } from '@ai-pair/protocol';
import { activate, deactivate } from '../src/extension';
import { setTimings } from '../src/timings';
import { watchOutside } from '../src/outside_watch';
import { settingSpeed } from '../src/panel_html';
import { speechRuntimeAvailable } from '../src/speech_runtime_status';
import { speechReady } from '../src/speech_readiness';
import { OpenRouterClient } from '../src/speech_openrouter';
import { localSpeechPlatform } from '../src/speech_platform';
import { coreMlCompute } from '../src/speech_coreml';
import type { SpeechOutput } from '../src/speech_service';
import type { PanelWiring } from '../src/panel';
import type { CatalogView } from '../src/speech_catalog';
vi.mock('../src/speech_platform', () => ({ localSpeechPlatform: vi.fn() }));
vi.mock('../src/speech_coreml', () => ({ coreMlCompute: vi.fn() }));
import type { SpeechSettings } from '../src/speech_types';
import type { OutputPreferenceWiring } from '../src/speech_output_preferences';
import type { SpeechOutputRouter } from '../src/speech_output_router';
import { installedSpeechModel, setupSpeech, speechModelStatus } from '../src/speech_setup';
import { discoverOutputs } from '../src/speech_native_output';
import { systemOutputDriver } from '../src/speech_system_output';
import { builtInPassage } from '../src/passage';
import { claudeStarter, setUpAgent, writeLauncher } from '../src/setup';
import { warnOldExtension } from '../src/old_extension';

/** What the mocked modules share with the tests, made before the `vi.mock` factories run. */
const fakes = vi.hoisted(() => {
  /** Each event's listeners, by the event's name. */
  const listeners = new Map<string, Set<(value: unknown) => void>>();

  /** Returns an event's registration: it adds the listener, and its disposable takes it away. */
  function event(name: string): (listener: (value: unknown) => void) => { dispose: () => void } {
    return (listener) => {
      const set = listeners.get(name) ?? new Set();
      set.add(listener);
      listeners.set(name, set);
      return {
        dispose: () => {
          set.delete(listener);
        },
      };
    };
  }

  /** What was made, and what the fakes answer. */
  const made = {
    controllers: [] as Array<InstanceType<typeof FakeController>>,
    bridges: [] as Array<InstanceType<typeof FakeBridge>>,
    editors: [] as Array<InstanceType<typeof FakeEditor>>,
    panels: [] as Array<InstanceType<typeof FakePanel>>,
    calibrations: [] as Array<InstanceType<typeof FakeCalibration>>,
    diagnostics: [] as Array<InstanceType<typeof FakeDiagnostics>>,
    speech: [] as Array<InstanceType<typeof FakeSpeech>>,
    cloudClients: [] as Array<InstanceType<typeof FakeCloudClient>>,
    catalogs: [] as Array<InstanceType<typeof FakeCatalog>>,
    credentials: [] as Array<InstanceType<typeof FakeCredentials>>,
    outputs: [] as Array<InstanceType<typeof FakeOutputPreferences>>,
    routers: [] as Array<InstanceType<typeof FakeOutputRouter>>,
    starting: Promise.resolve(),
    arms: true,
  };

  class FakeNativeDriver {
    readonly fake = true;
    readonly available = vi.fn().mockReturnValue(true);
  }
  class FakeOutputRouter {
    readonly invalidate = vi.fn();
    readonly browserRetired = vi.fn<(id: number, pageId: number) => void>();
    readonly pageClosed = vi.fn<(pageId: number) => void>();
    readonly prepare = vi.fn(() => Promise.resolve(true));
    readonly idle = vi.fn(() => true);
    readonly play: SpeechOutput['play'];
    readonly control: SpeechOutput['control'];
    readonly status: SpeechOutput['status'];
    readonly localDiagnostic: SpeechOutput['localDiagnostic'];
    constructor(readonly options: ConstructorParameters<typeof SpeechOutputRouter>[0]) {
      this.play = options.defaultOutput.play;
      this.control = options.defaultOutput.control;
      this.status = options.defaultOutput.status;
      this.localDiagnostic = options.defaultOutput.localDiagnostic;
      made.routers.push(this);
    }
  }

  class FakeOutputPreferences {
    readonly view = vi.fn(() => ({ supported: false, devices: [], selected: { kind: 'default' as const } }));
    readonly ready = vi.fn(() => true);
    readonly choice = vi.fn<() => import('../src/speech_output_types').OutputChoice>(() => ({ kind: 'default' }));
    readonly choose = vi.fn(() => Promise.resolve());
    readonly refresh = vi.fn(() => Promise.resolve());
    constructor(readonly wiring: OutputPreferenceWiring) {
      if (wiring.initial !== undefined) this.choice.mockReturnValue({ kind: 'native', backend: 'coreaudio', name: 'headset' });
      made.outputs.push(this);
    }
  }

  class FakeCloudClient {
    readonly voices = vi.fn(() => Promise.resolve({ voices: [] }));
    constructor(readonly readKey: () => Promise<string | undefined>) {
      made.cloudClients.push(this);
    }
  }

  class FakeCredentials {
    constructor(
      private readonly storage: {
        get(key: string): Promise<string | undefined>;
        store(key: string, value: string): Promise<void>;
        delete(key: string): Promise<void>;
      },
      private readonly prompt: () => Promise<string | undefined>,
      private readonly onCredentialChange: () => void,
      private readonly key = 'aiPair.elevenLabs.apiKey',
    ) {
      made.credentials.push(this);
    }
    readonly read = vi.fn(() => this.storage.get(this.key));
    readonly hasKey = vi.fn(async () => (await this.read()) !== undefined);
    readonly set = vi.fn(async () => {
      const key = await this.prompt();
      if (key === undefined || key.length === 0) return;
      this.onCredentialChange();
      await this.storage.store(this.key, key);
    });
    readonly remove = vi.fn(async () => {
      this.onCredentialChange();
      await this.storage.delete(this.key);
    });
    readonly invalidate = vi.fn(() => {
      this.onCredentialChange();
    });
    readonly supersede = vi.fn();
  }

  class FakeCatalog {
    constructor(
      client: unknown,
      readonly publish: (view: CatalogView) => void,
    ) {
      void client;
      made.catalogs.push(this);
    }
    readonly contains = vi.fn(() => false);
    readonly load = vi.fn(() => {
      this.publish({ voices: [], more: false, loading: true, error: false });
      return Promise.resolve();
    });
    readonly invalidate = vi.fn();
  }

  class FakeSpeech {
    readonly configureNarrationContext = vi.fn();
    readonly setNarrationSession = vi.fn();
    readonly prepare = vi.fn();
    readonly speak = vi.fn<() => Promise<void>>().mockResolvedValue();
    readonly attentionCue = vi.fn<() => Promise<void>>().mockResolvedValue();
    readonly pause = vi.fn<() => void>();
    readonly resume = vi.fn<() => void>();
    readonly cancel = vi.fn<() => void>();
    readonly invalidateCloud = vi.fn<() => void>();
    readonly openRouterCatalogChanged = vi.fn<() => void>();
    readonly dispose = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    private compute: import('../src/speech_compute_types').SpeechComputeState;
    readonly selectComputeMode = vi.fn((requestedMode: import('../src/speech_compute_types').SpeechComputeMode) => {
      this.compute = { ...this.compute, requestedMode };
      this.options.computeChanged(this.compute);
    });
    readonly computeState = vi.fn(() => this.compute);
    readonly checkGpu = vi.fn(
      async (
        operation: (
          signal: AbortSignal,
          progress: (value: import('../src/speech_compute_types').GpuCheckProgress) => void,
        ) => Promise<import('../src/speech_compute_types').GpuCheck>,
        signal: AbortSignal,
      ) => {
        const gpuCheck = await operation(signal, () => {});
        this.compute = { ...this.compute, gpuCheck };
        this.options.computeChanged(this.compute);
        return gpuCheck;
      },
    );
    readonly preview = vi.fn<() => Promise<void>>().mockResolvedValue();
    readonly audioEvent =
      vi.fn<(event: { id: number; pageId: number; event: 'started' | 'ended' | 'failed' }) => 'ended' | 'failed' | undefined>();
    readonly pageClosed = vi.fn();
    constructor(
      readonly options: {
        settings: () => { enabled: boolean; provider: string; voice: string; speed: number };
        output: SpeechOutput;
        localDesktop: boolean;
        cloudDiagnostic?: (reason: 'auth') => void;
        openRouterDiagnostic?: (reason: 'auth') => void;
        openRouterAllowed?: (model: string, voice: string) => boolean;
        computeMode: () => import('../src/speech_compute_types').SpeechComputeMode;
        computeChanged: (value: import('../src/speech_compute_types').SpeechComputeState) => void;
        createCoreMl?: (listener: import('../src/speech_local_client').LocalListener) => unknown;
      },
    ) {
      this.compute = { requestedMode: options.computeMode(), actualBackend: 'none', gpuCheck: { phase: 'idle' } };
      made.speech.push(this);
    }
    setComputeState(value: import('../src/speech_compute_types').SpeechComputeState): void {
      this.compute = value;
      this.options.computeChanged(value);
    }
  }

  class FakeDiagnostics {
    readonly record = vi.fn<(event: unknown) => void>();
    readonly snapshot = vi.fn<() => import('../src/diagnostics').DiagnosticSnapshot>(() => ({
      version: 'test',
      build: 'test',
      session: 'unavailable' as const,
      connection: 'unavailable' as const,
      connectionId: 'unavailable' as const,
      paused: 'unavailable' as const,
      pauseReasons: 'unavailable' as const,
      events: [],
    }));
    constructor(readonly identity: unknown) {
      made.diagnostics.push(this);
    }
  }

  /** Core's Controller, faked: what activate sets, and the calls its commands make. */
  class FakeController {
    trace?: (line: string) => void;
    onChange?: () => void;
    onDiagnostic?: (event: unknown) => void;
    isPaused = false;
    isActive = false;
    isAttentionGranted = false;
    isSuspended = false;
    turn: string | undefined = undefined;
    saved: unknown = undefined;
    readonly setSpeed = vi.fn();
    readonly setReadingSpeed = vi.fn();
    readonly setCodePlayback = vi.fn();
    readonly setNavigatorCommentary = vi.fn();
    readonly setTiming = vi.fn();
    readonly setConfirmCommands = vi.fn();
    readonly pause = vi.fn();
    readonly resume = vi.fn();
    readonly userInterrupt = vi.fn();
    readonly requestAttention = vi.fn();
    readonly takeTurn = vi.fn();
    readonly handBack = vi.fn();
    readonly endSession = vi.fn();
    readonly disconnect = vi.fn();
    readonly revive = vi.fn();

    constructor(
      readonly editor: unknown,
      readonly panel: unknown,
      readonly config: unknown,
      readonly narration: import('@ai-pair/core').NarrationPort,
    ) {
      made.controllers.push(this);
    }
  }

  /** Core's Bridge, faked: its options, and whether its server starts. */
  class FakeBridge {
    readonly file = '/discovery/1.json';
    readonly start = vi.fn(() => made.starting);
    readonly dispose = vi.fn();
    readonly focused = vi.fn();
    readonly writeDiscovery = vi.fn();

    constructor(
      readonly controller: unknown,
      readonly options: {
        workspaceFolders: () => string[];
        trace: (line: string) => void;
        failed: (error: unknown) => void;
        calibrate: (passage: unknown) => boolean;
        onDiagnostic: (event: unknown) => void;
      },
    ) {
      made.bridges.push(this);
    }
  }

  /** The editor, faked: what activate gives and sets it. */
  class FakeEditor {
    onSelection?: (ref: unknown) => void;
    readonly setAgentName = vi.fn();
    readonly programmerSelection = vi.fn(() => 'selection');
    readonly selectionRef = vi.fn(() => 'ref');
    readonly resolvePath = vi.fn((file: string) => `/project/${file}`);
    readonly dispose = vi.fn();
    readonly showTerminal = vi.fn(() => true);

    constructor(
      readonly root: string,
      readonly agentName: string,
      readonly controller: () => unknown,
      readonly showAutomatically: () => boolean,
      readonly onDiagnostic: (event: unknown) => void,
    ) {
      made.editors.push(this);
    }
  }

  /** The panel, faked: what activate gives and sets it, and what it shows. */
  class FakePanel {
    static readonly viewId = 'aiPair.panel';
    onPost?: () => void;
    readonly history = ['history'];
    readonly showSelection = vi.fn();
    readonly showSpeed = vi.fn();
    readonly showReadingSpeed = vi.fn();
    readonly showChatOrder = vi.fn();
    readonly showNavigatorCommentary = vi.fn();
    readonly showReplyBehavior = vi.fn();
    readonly showCommandApprovalSound = vi.fn();
    readonly showCommandApprovals = vi.fn();
    readonly showCodePlayback = vi.fn();
    readonly showSpeechSettings = vi.fn<(value: SpeechSettings) => void>();
    readonly showSpeechComputeState = vi.fn();
    readonly showSpeechKeyStatus = vi.fn();
    readonly showSpeechReadiness = vi.fn();
    readonly showSpeechTransport = vi.fn();
    readonly showSpeechCatalog = vi.fn();
    readonly showOpenRouterCatalog = vi.fn();
    readonly showOpenRouterKeyStatus = vi.fn();
    readonly showSpeechOutputCatalog = vi.fn();
    readonly speechReadyPageId = vi.fn(() => 7);
    readonly showSpeechStatus = vi.fn();
    readonly showSpeechCost = vi.fn();
    readonly playSpeech = vi.fn(() => 7);
    readonly controlSpeech = vi.fn();
    readonly refreshSpeechSupport = vi.fn();
    readonly speechPageIsReady = vi.fn(() => true);
    readonly showTerminalPreference = vi.fn();
    readonly showCalibration = vi.fn();
    readonly showTimings = vi.fn();
    readonly receiveFromPage = vi.fn();
    readonly restoreHistory = vi.fn();
    readonly focusReply = vi.fn();
    readonly askStart = vi.fn();

    constructor(
      readonly resolvePath: (file: string) => string,
      readonly speed: { get: () => number; set: (value: number) => void },
      readonly readingSpeed: { get: () => number; set: (value: number) => void },
      readonly selection: { current: () => unknown; ref: () => unknown },
      readonly trace: (line: string) => void,
      readonly extensionUri: unknown,
      readonly wiring: {
        controller: () => unknown;
        calibration: () => unknown;
        starter: unknown;
        copyDiagnostics: () => Promise<void>;
        requireCommandApproval: () => Promise<void>;
        speech: PanelWiring['speech'];
      },
      readonly chatOrder: { get: () => string; set: (value: string) => void },
      readonly buildInfo: unknown,
      readonly terminalSettings: { get: () => boolean; set: (value: boolean) => void },
      readonly showTerminal: (id: number) => boolean,
      readonly codePlayback: { get: () => string; set: (value: string) => void },
      readonly replyBehavior: { get: () => string; set: (value: string) => void },
      readonly commandApprovalSound: { get: () => boolean; set: (value: boolean) => void },
      readonly navigatorCommentary: { get: () => string; set: (value: string) => void },
    ) {
      made.panels.push(this);
    }
  }

  /** The calibration, faked: its host's hooks, and whether it takes a passage. */
  class FakeCalibration {
    readonly arm = vi.fn(() => made.arms);

    constructor(
      readonly host: {
        now: () => number;
        pause: () => void;
        resume: () => void;
        store: (msPerChar: number) => Promise<void>;
        show: (view: unknown) => void;
      },
      readonly passage: unknown,
    ) {
      made.calibrations.push(this);
    }
  }

  return {
    listeners,
    collect: vi.fn<typeof import('../src/diagnostics_collector').collectDiagnostics>().mockResolvedValue({
      version: 'test',
      build: 'test',
      session: 'unavailable',
      connection: 'unavailable',
      connectionId: 'unavailable',
      paused: 'unavailable',
      pauseReasons: 'unavailable',
      events: [],
    }),
    event,
    FakeController,
    FakeBridge,
    FakeEditor,
    FakePanel,
    FakeCalibration,
    FakeDiagnostics,
    FakeSpeech,
    FakeCloudClient,
    FakeOutputPreferences,
    FakeNativeDriver,
    FakeOutputRouter,
    FakeCredentials,
    FakeCatalog,
    made,
    /** The workspace's folders; none until a test says. */
    folders: undefined as Array<{ uri: { fsPath: string } }> | undefined,
    /** The `aiPair` settings, by name. */
    settings: new Map<string, unknown>(),
    delaySettings: false,
    providerGate: undefined as Promise<void> | undefined,
    computeGate: undefined as Promise<void> | undefined,
    commentaryGate: undefined as Promise<void> | undefined,
    updated: [] as Array<[string, unknown, unknown]>,
    commands: new Map<string, (value?: unknown) => unknown>(),
    providerRegistered: vi.fn(),
    companionAvailable: false,
    companionInstalled: false,
    placementChoice: undefined as Promise<import('../src/panel_placement').PanelOwner> | undefined,
    placementCommit: undefined as Promise<unknown> | undefined,
    placementChoose: vi.fn(),
    session: undefined as
      | {
          narration: {
            speak: ReturnType<typeof vi.fn>;
            attentionCue: ReturnType<typeof vi.fn>;
            waitForRetirement: ReturnType<typeof vi.fn>;
            pause: ReturnType<typeof vi.fn>;
            resume: ReturnType<typeof vi.fn>;
            cancel: ReturnType<typeof vi.fn>;
          };
          accept: ReturnType<typeof vi.fn>;
          pageReady: ReturnType<typeof vi.fn<() => boolean>>;
        }
      | undefined,
    frameAccepted: true,
    // The companion can return any untrusted value.
    // oxlint-disable-next-line typescript/no-unnecessary-type-assertion
    gpuSnapshot: undefined as unknown,
    diagnosticsInvalid: false,
    diagnosticsReject: false,
    placementOptions: undefined as import('../src/panel_placement').PanelPlacementOptions | undefined,
    workspaceOptions: undefined as import('../src/workspace_session').WorkspaceSessionOptions | undefined,
    commandCalls: [] as Array<[string, unknown]>,
    failedCommands: new Set<string>(),
    errors: [] as string[],
    infos: [] as string[],
    /** The button the programmer picks on the next information message. */
    answer: undefined as string | undefined,
    remoteName: undefined as string | undefined,
    workspaceProvider: undefined as string | undefined,
    logged: [] as Array<[string, string]>,
    showOutput: vi.fn(),
  };
});

vi.mock('vscode', () => ({
  extensions: { getExtension: () => (fakes.companionInstalled ? {} : undefined) },
  ConfigurationTarget: { Global: 1 },
  UIKind: { Desktop: 1 },
  workspace: {
    get workspaceFolders() {
      return fakes.folders;
    },
    getConfiguration: () => ({
      get: (key: string, fallback?: unknown) =>
        key === 'speech.provider' && fakes.workspaceProvider !== undefined
          ? fakes.workspaceProvider
          : fakes.settings.has(key)
            ? fakes.settings.get(key)
            : fallback,
      inspect: (key: string) => ({ globalValue: fakes.settings.get(key) }),
      update: (key: string, value: unknown, target: unknown) => {
        fakes.updated.push([key, value, target]);
        if (key === 'navigatorCommentary' && fakes.commentaryGate !== undefined) return fakes.commentaryGate;
        if (key === 'speech.computeMode' && fakes.computeGate !== undefined) {
          const gate = fakes.computeGate;
          fakes.computeGate = undefined;
          return gate.then(() => {
            fakes.settings.set(key, value);
          });
        }
        if (key === 'speech.provider' && fakes.providerGate !== undefined) {
          const gate = fakes.providerGate;
          fakes.providerGate = undefined;
          return gate.then(() => {
            fakes.settings.set(key, value);
          });
        }
        if (!fakes.delaySettings) fakes.settings.set(key, value);
        return Promise.resolve();
      },
    }),
    onDidChangeConfiguration: fakes.event('configuration'),
    onDidChangeWorkspaceFolders: fakes.event('folders'),
  },
  window: {
    createOutputChannel: () => ({
      info: (line: string) => fakes.logged.push(['info', line]),
      trace: (line: string) => fakes.logged.push(['trace', line]),
      dispose: () => {},
      show: fakes.showOutput,
    }),
    showInputBox: vi.fn().mockResolvedValue(undefined),
    showWarningMessage: (message: string) => {
      fakes.infos.push(message);
      return Promise.resolve(fakes.answer);
    },
    showErrorMessage: (message: string) => {
      fakes.errors.push(message);
      return Promise.resolve(undefined);
    },
    showInformationMessage: (message: string) => {
      fakes.infos.push(message);
      return Promise.resolve(fakes.answer);
    },
    onDidChangeWindowState: fakes.event('window'),
    registerWebviewViewProvider: (...args: unknown[]) => {
      fakes.providerRegistered(...args);
      return { dispose: () => {} };
    },
  },
  env: {
    uiKind: 1,
    get remoteName() {
      return fakes.remoteName;
    },
    clipboard: { writeText: vi.fn(() => Promise.resolve()) },
  },
  commands: {
    executeCommand: (name: string, value: unknown) => {
      fakes.commandCalls.push([name, value]);
      if (fakes.failedCommands.has(name)) return Promise.reject(new Error('private'));
      if (
        name === 'aiPair.localAudio.prepare' &&
        fakes.companionAvailable &&
        typeof value === 'object' &&
        value !== null &&
        'epoch' in value
      ) {
        return Promise.resolve({ version: LOCAL_AUDIO_VERSION, epoch: value.epoch, token: 'token' });
      }
      if (name === 'aiPair.localAudio.activate') return Promise.resolve(true);
      if (name === 'aiPair.localAudio.gpuDiagnostics' && fakes.companionAvailable) return Promise.resolve(fakes.gpuSnapshot);
      if (name === 'aiPair.localAudio.diagnostics' && fakes.companionAvailable) {
        if (fakes.diagnosticsReject) return Promise.reject(new Error('private'));
        return Promise.resolve(fakes.diagnosticsInvalid ? { secret: 'private' } : { version: '0.19.0', build: 'abcdef', events: [] });
      }
      if (name === 'aiPair.localAudio.frame' && fakes.companionAvailable) return Promise.resolve(fakes.frameAccepted);
      if (name === 'workbench.extensions.action.installVSIX') return Promise.resolve();
      if (name === 'workbench.action.openGlobalKeybindings') return Promise.resolve();
      if (name.startsWith('aiPair.localAudio.') && fakes.companionAvailable) return Promise.resolve(true);
      return Promise.reject(new Error('missing command'));
    },
    registerCommand: (name: string, run: (value?: unknown) => unknown) => {
      fakes.commands.set(name, run);
      return { dispose: () => {} };
    },
  },
}));
vi.mock('node:crypto', () => ({ randomUUID: () => 'test-epoch' }));
vi.mock('node:os', () => ({ homedir: () => '/home' }));
vi.mock('@ai-pair/core', () => ({
  Bridge: fakes.FakeBridge,
  Controller: fakes.FakeController,
  isSavedSession: vi.fn(() => false),
}));
vi.mock(import('@ai-pair/protocol'), async (original) => ({ ...(await original()), discoveryDir: () => '/discovery' }));
vi.mock('../src/panel_placement', () => ({
  PanelPlacement: class {
    constructor(private readonly options: import('../src/panel_placement').PanelPlacementOptions) {
      fakes.placementOptions = options;
    }
    choose(): Promise<import('../src/panel_placement').PanelOwner> {
      fakes.placementChoose();
      if (fakes.placementChoice !== undefined) return fakes.placementChoice;
      if (this.options.companionInstalled === true) return Promise.resolve('incompatible');
      if (fakes.companionAvailable) {
        this.options.beforeCommit?.();
        if (fakes.placementCommit !== undefined) {
          return fakes.placementCommit.then((accepted) => {
            if (accepted === true) this.options.afterCommit?.();
            else this.options.commitFailed?.();
            return 'companion';
          });
        }
        this.options.afterCommit?.();
        return Promise.resolve('companion');
      }
      return Promise.resolve(this.options.remote ? 'remote-text' : 'legacy');
    }
  },
}));
vi.mock('../src/old_extension', () => ({ warnOldExtension: vi.fn(() => Promise.resolve()) }));
vi.mock('../src/workspace_session', () => ({
  WorkspaceSession: class {
    narration = {
      speak: vi.fn(() => Promise.resolve()),
      attentionCue: vi.fn(() => Promise.resolve()),
      waitForRetirement: vi.fn<(_: AbortSignal) => Promise<boolean>>().mockResolvedValue(true),
      pause: vi.fn(),
      resume: vi.fn(),
      cancel: vi.fn(),
    };
    constructor(options: import('../src/workspace_session').WorkspaceSessionOptions) {
      fakes.workspaceOptions = options;
      fakes.session = this;
    }
    accept = vi.fn(() => true);
    pageReady = vi.fn(() => true);
    dispose = vi.fn();
  },
}));
vi.mock('../src/demo', () => ({ playDemo: vi.fn(() => Promise.resolve()) }));
vi.mock('../src/editor', () => ({ VsCodeEditor: fakes.FakeEditor }));
vi.mock('../src/diagnostics', () => ({ Diagnostics: fakes.FakeDiagnostics }));
vi.mock('../src/diagnostics_collector', () => ({ collectDiagnostics: fakes.collect }));
vi.mock('../src/speech_runtime_status', () => ({ speechRuntimeAvailable: vi.fn(() => Promise.resolve(false)) }));
vi.mock('../src/speech_readiness', () => ({ speechReady: vi.fn().mockResolvedValue(false) }));
vi.mock('../src/speech_service', () => ({ SpeechService: fakes.FakeSpeech }));
vi.mock('../src/speech_elevenlabs', () => ({ ElevenLabsClient: fakes.FakeCloudClient }));
vi.mock('../src/speech_credentials', () => ({ SpeechCredentials: fakes.FakeCredentials }));
vi.mock('../src/speech_catalog', () => ({ SpeechCatalog: fakes.FakeCatalog }));
vi.mock('../src/speech_output_preferences', () => ({ SpeechOutputPreferences: fakes.FakeOutputPreferences }));
vi.mock('../src/speech_native_output', () => ({
  NativeOutputDriver: fakes.FakeNativeDriver,
  discoverOutputs: vi.fn(() => Promise.resolve({ supported: false, devices: [], reason: 'unsupported' })),
}));
vi.mock('../src/speech_output_router', () => ({ SpeechOutputRouter: fakes.FakeOutputRouter }));
vi.mock('../src/speech_system_output', () => ({ systemOutputDriver: vi.fn(() => undefined) }));
vi.mock('../src/speech_setup', () => ({
  installedSpeechModel: vi.fn(() => Promise.resolve(undefined)),
  speechModelStatus: vi.fn(() =>
    Promise.resolve({ path: '/model', source: 'https://example.test', revision: 'abc', verified: false, download: 'missing' }),
  ),
  setupSpeech: vi.fn(() => Promise.resolve()),
}));
vi.mock('../src/outside_watch', () => ({ watchOutside: vi.fn(() => ({ outside: 'outside', disposable: { dispose: () => {} } })) }));
vi.mock('../src/panel', () => ({ NarrationPanel: fakes.FakePanel }));
vi.mock('../src/panel_html', () => ({ settingSpeed: vi.fn((value: unknown) => (typeof value === 'number' ? value : 1)) }));
vi.mock('../src/setup', () => ({
  claudeStarter: vi.fn(() => ({ dispose: () => {} })),
  setUpAgent: vi.fn(() => Promise.resolve()),
  writeLauncher: vi.fn(() => '/ext/launcher'),
}));
vi.mock('../src/calibration', () => ({ Calibration: fakes.FakeCalibration }));
vi.mock('../src/timings', () => ({ timings: { saveMs: 200 }, setTimings: vi.fn() }));
vi.mock('../src/passage', () => ({ builtInPassage: vi.fn(() => ({ title: 'Built in', text: 'Built-in words.' })) }));

/** The extension's context, faked: its storage, and what it is asked to dispose. */
function context(stored: Map<string, unknown> = new Map(), offered = true) {
  const global = new Map<string, unknown>([['aiPair.offeredSetup', offered]]);
  return {
    subscriptions: [] as Array<{ dispose: () => unknown }>,
    extensionPath: '/ext',
    globalStorageUri: { fsPath: '/storage' },
    secrets: {
      get: vi.fn().mockResolvedValue(undefined),
      store: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      onDidChange: fakes.event('secrets'),
    },
    extensionUri: { fsPath: '/ext' },
    workspaceState: {
      get: (key: string) => stored.get(key),
      update: (key: string, value: unknown) => {
        stored.set(key, value);
        return Promise.resolve();
      },
    },
    globalState: {
      get: (key: string) => global.get(key),
      update: (key: string, value: unknown) => {
        global.set(key, value);
        return Promise.resolve();
      },
    },
  };
}

/** Returns the one made last. */
function last<T>(list: T[]): T {
  const made = list.at(-1);
  if (made === undefined) throw new Error('Not made.');
  return made;
}

/** Activates the extension with `given`, and returns its Api and what it made. */
function activated(given = context()) {
  // The fake stands in for VS Code's ExtensionContext.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const api = activate(given as unknown as Parameters<typeof activate>[0]);
  return {
    api,
    context: given,
    controller: last(fakes.made.controllers),
    bridge: last(fakes.made.bridges),
    editor: last(fakes.made.editors),
    panel: last(fakes.made.panels),
    calibration: last(fakes.made.calibrations),
  };
}

/** Runs the command registered as `name`. */
function command(name: string, value?: unknown): unknown {
  const run = fakes.commands.get(name);
  if (run === undefined) throw new Error(`No command ${name}.`);
  return run(value);
}

/** Fires event `name` with `value`. */
function fire(name: string, value: unknown): void {
  for (const listener of fakes.listeners.get(name) ?? []) {
    listener(value);
  }
}

/** Fires a settings change that affects the settings named. */
function changed(...names: string[]): void {
  fire('configuration', { affectsConfiguration: (section: string) => names.some((name) => section === `aiPair.${name}`) });
}

/** Save and simulate the supported host without depending on the CI machine. */
beforeEach(() => {
  vi.mocked(localSpeechPlatform).mockReturnValue({ supported: true });
  vi.mocked(coreMlCompute).mockReturnValue({
    gpu: false,
    speechOptions: {},
    check: () => Promise.resolve({ phase: 'unavailable', reason: 'unsupported' }),
  });
  fakes.folders = [{ uri: { fsPath: '/project' } }];
  fakes.made.starting = Promise.resolve();
  fakes.made.arms = true;
  fakes.answer = undefined;
  fakes.companionAvailable = false;
  fakes.companionInstalled = false;
  fakes.placementChoice = undefined;
  fakes.placementCommit = undefined;
  fakes.session = undefined;
  fakes.frameAccepted = true;
  fakes.gpuSnapshot = undefined;
  fakes.diagnosticsInvalid = false;
  fakes.diagnosticsReject = false;
  fakes.placementOptions = undefined;
  fakes.workspaceOptions = undefined;
  fakes.commandCalls.length = 0;
  fakes.failedCommands.clear();
  fakes.providerRegistered.mockClear();
  fakes.placementChoose.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  costFake.captures.length = 0;
  fakes.listeners.clear();
  fakes.remoteName = undefined;
  fakes.settings.clear();
  fakes.delaySettings = false;
  fakes.commentaryGate = undefined;
  fakes.providerGate = undefined;
  fakes.commands.clear();
  for (const list of [fakes.made.controllers, fakes.made.bridges, fakes.made.editors, fakes.made.panels, fakes.made.calibrations]) {
    list.length = 0;
  }
  fakes.updated.length = 0;
  fakes.errors.length = 0;
  fakes.infos.length = 0;
  fakes.logged.length = 0;
});

it('deactivates safely before a service is activated', async () => {
  await expect(deactivate()).resolves.toBeUndefined();
});

describe('activate', () => {
  it('builds the editor in the first folder, or the home folder with none, and wires the controller to it', () => {
    const h = activated();
    expect(h.editor.root).toBe('/project');
    expect(h.editor.agentName).toBe('Agent');
    expect(h.editor.controller()).toBe(h.controller);
    expect(h.panel.extensionUri).toEqual({ fsPath: '/ext' });
    expect(h.panel.wiring.controller()).toBe(h.controller);
    expect(h.panel.wiring.calibration()).toBe(h.calibration);
    expect(h.panel.wiring.starter).toBe(vi.mocked(claudeStarter).mock.results[0]?.value);
    expect(h.api).toMatchObject({
      controller: h.controller,
      editor: h.editor,
      bridge: h.bridge,
      outside: 'outside',
      launcher: '/ext/launcher',
    });
    expect(writeLauncher).toHaveBeenCalledWith('/ext');
    expect(warnOldExtension).toHaveBeenCalled();
    expect(claudeStarter).toHaveBeenCalledWith('/ext/launcher');
    expect(watchOutside).toHaveBeenCalledWith(h.controller, h.editor, h.panel);
    expect(h.bridge.options.workspaceFolders()).toEqual(['/project']);
    fakes.folders = undefined;
    expect(activated().editor.root).toBe('/home');
    expect(activated().bridge.options.workspaceFolders()).toEqual([]);
  });

  it('gives the controller and the panel the speeds from the settings, and stores the ones the panel sets', () => {
    fakes.settings.set('speed', 2);
    fakes.settings.set('readingSpeed', 3);
    fakes.settings.set('timing', { glideMs: 1 });
    fakes.settings.set('confirmCommands', false);
    const h = activated();
    expect(h.controller.setSpeed).toHaveBeenCalledWith(2);
    expect(h.controller.setReadingSpeed).toHaveBeenCalledWith(3);
    expect(h.controller.setTiming).toHaveBeenCalledWith({ glideMs: 1 });
    expect(h.controller.setConfirmCommands).toHaveBeenCalledWith(false);
    expect(settingSpeed).toHaveBeenCalledWith(2);
    h.panel.speed.set(4);
    h.panel.readingSpeed.set(0.5);
    expect(fakes.updated).toEqual([
      ['speed', 4, 1],
      ['readingSpeed', 0.5, 1],
    ]);
    expect(h.panel.resolvePath('a.ts')).toBe('/project/a.ts');
    expect(h.panel.selection.current()).toBe('selection');
    expect(h.panel.selection.ref()).toBe('ref');
    h.editor.onSelection?.('a ref');
    expect(h.panel.showSelection).toHaveBeenCalledWith('a ref');
  });

  it('persists the request to require command approval in global settings', async () => {
    const h = activated();
    await h.panel.wiring.requireCommandApproval();
    expect(fakes.updated).toContainEqual(['confirmCommands', true, 1]);
  });

  it('ChoiceSaved: reads, stores and applies the playback mode, defaulting invalid values to typing', () => {
    const h = activated();
    expect(h.controller.setCodePlayback).toHaveBeenCalledWith('typing');
    expect(h.panel.codePlayback.get()).toBe('typing');
    fakes.settings.set('codePlayback', 'blocks');
    changed('codePlayback');
    expect(h.controller.setCodePlayback).toHaveBeenLastCalledWith('blocks');
    expect(h.panel.showCodePlayback).toHaveBeenLastCalledWith('blocks');
    h.panel.codePlayback.set('lines');
    expect(fakes.updated).toContainEqual(['codePlayback', 'lines', 1]);
    fakes.settings.set('codePlayback', 'invalid');
    changed('codePlayback');
    expect(h.controller.setCodePlayback).toHaveBeenLastCalledWith('typing');
    expect(h.panel.showCodePlayback).toHaveBeenLastCalledWith('typing');
  });

  it('persists navigator commentary and applies the workspace snapshot on changes', () => {
    const h = activated();
    expect(h.controller.setNavigatorCommentary).toHaveBeenCalledWith('helpful');
    expect(h.panel.navigatorCommentary.get()).toBe('helpful');
    h.panel.navigatorCommentary.set('coach');
    expect(fakes.updated).toContainEqual(['navigatorCommentary', 'coach', 1]);
    fakes.settings.set('navigatorCommentary', 'quiet');
    changed('navigatorCommentary');
    expect(h.controller.setNavigatorCommentary).toHaveBeenLastCalledWith('quiet');
    expect(h.panel.showNavigatorCommentary).toHaveBeenLastCalledWith('quiet');
    fakes.settings.set('navigatorCommentary', 'invalid');
    changed('navigatorCommentary');
    expect(h.controller.setNavigatorCommentary).toHaveBeenLastCalledWith('helpful');
    expect(h.panel.showNavigatorCommentary).toHaveBeenLastCalledWith('helpful');
  });

  it('restores the effective preference if saving fails', async () => {
    const gate = Promise.withResolvers<void>();
    fakes.commentaryGate = gate.promise;
    const h = activated();
    h.panel.navigatorCommentary.set('coach');
    gate.reject(new Error('save failed'));
    await Promise.resolve();
    expect(h.panel.showNavigatorCommentary).toHaveBeenCalledWith('helpful');
    expect(fakes.errors).toContain('Could not save navigator commentary.');
  });

  it('restores saved navigator commentary on activation', () => {
    fakes.settings.set('navigatorCommentary', 'coach');
    const h = activated();
    expect(h.controller.setNavigatorCommentary).toHaveBeenCalledWith('coach');
    expect(h.panel.navigatorCommentary.get()).toBe('coach');
  });

  it('persists reply behavior and defaults invalid values to interrupt', () => {
    const h = activated();
    expect(h.panel.replyBehavior.get()).toBe('interrupt');
    fakes.settings.set('replyBehavior', 'finishAction');
    changed('replyBehavior');
    expect(h.panel.showReplyBehavior).toHaveBeenLastCalledWith('finishAction');
    h.panel.replyBehavior.set('interrupt');
    expect(fakes.updated).toContainEqual(['replyBehavior', 'interrupt', 1]);
    fakes.settings.set('replyBehavior', 'invalid');
    changed('replyBehavior');
    expect(h.panel.showReplyBehavior).toHaveBeenLastCalledWith('interrupt');
  });

  it('persists the optional command approval sound and defaults invalid values to off', () => {
    const h = activated();
    expect(h.panel.commandApprovalSound.get()).toBe(false);
    fakes.settings.set('commandApprovalSound', true);
    changed('commandApprovalSound');
    expect(h.panel.showCommandApprovalSound).toHaveBeenLastCalledWith(true);
    h.panel.commandApprovalSound.set(false);
    expect(fakes.updated).toContainEqual(['commandApprovalSound', false, 1]);
    fakes.settings.set('commandApprovalSound', 'true');
    changed('commandApprovalSound');
    expect(h.panel.showCommandApprovalSound).toHaveBeenLastCalledWith(false);
  });

  it('reads, saves, and applies the chat order, defaulting invalid values to newest first', () => {
    const h = activated();
    expect(h.panel.chatOrder.get()).toBe('newestFirst');
    fakes.settings.set('chatOrder', 'oldestFirst');
    expect(h.panel.chatOrder.get()).toBe('oldestFirst');
    changed('chatOrder');
    expect(h.panel.showChatOrder).toHaveBeenCalledWith('oldestFirst');
    h.panel.chatOrder.set('newestFirst');
    expect(fakes.updated).toContainEqual(['chatOrder', 'newestFirst', 1]);
    fakes.settings.set('chatOrder', 'invalid');
    changed('chatOrder');
    expect(h.panel.showChatOrder).toHaveBeenLastCalledWith('newestFirst');
  });

  it('wires the local session speech cost to the legacy panel', () => {
    const h = activated();
    expect(h.panel.wiring.speech.sessionCost).toBeDefined();
    const snapshot = { seen: true, total: 0.01, pending: 0, partial: false };
    costFake.publish?.(snapshot);
    expect(h.panel.showSpeechCost).toHaveBeenCalledWith(snapshot);
  });

  it('ignores a late session cost publication after the legacy host shuts down', async () => {
    const h = activated();
    await h.api.ready;
    await deactivate();
    h.panel.showSpeechCost.mockClear();
    costFake.publish?.({ seen: true, total: 0.01, pending: 0, partial: false });
    expect(h.panel.showSpeechCost).not.toHaveBeenCalled();
  });

  it('exposes the same preview service and page readiness to integration tests', async () => {
    const h = activated();
    await h.api.ready;
    expect(h.api.speechPageReady()).toBe(true);
    await h.api.previewSpeech();
    expect(fakes.made.speech.at(-1)?.preview.mock.calls).toEqual([[]]);
  });

  it('exposes only the latest speech state and whether that unit started', async () => {
    const h = activated();
    await h.api.ready;
    const speech = fakes.made.speech.at(-1);
    if (speech === undefined) throw new Error('Missing speech');
    expect(h.api.speechStatus()).toBeUndefined();
    speech.options.output.status(1, 'preparing');
    speech.options.output.status(1, 'speaking');
    speech.options.output.status(1, 'idle');
    expect(h.api.speechStatus()).toEqual({ id: 1, state: 'idle', started: true });
    // An idle status after a cancel is not an accepted audio end.
    speech.audioEvent.mockReturnValueOnce(undefined);
    h.panel.wiring.speech.event({ id: 1, pageId: 7, event: 'ended' });
    expect(h.api.speechStatus()).toEqual({ id: 1, state: 'idle', started: true });
    speech.audioEvent.mockReturnValueOnce('ended');
    h.panel.wiring.speech.event({ id: 1, pageId: 7, event: 'ended' });
    expect(h.api.speechStatus()).toEqual({ id: 1, state: 'idle', started: true, terminal: 'ended' });
    speech.options.output.status(2, 'unavailable', 'Audio could not play.');
    expect(h.api.speechStatus()).toEqual({ id: 2, state: 'unavailable', started: false, message: 'Audio could not play.' });
    speech.audioEvent.mockReturnValueOnce('failed');
    h.panel.wiring.speech.event({ id: 2, pageId: 8, event: 'failed' });
    expect(h.api.speechStatus()).toEqual({
      id: 2,
      state: 'unavailable',
      started: false,
      terminal: 'failed',
      message: 'Audio could not play.',
    });
    expect(h.panel.showSpeechStatus).toHaveBeenCalledWith(2, 'unavailable', 'Audio could not play.');
  });

  it('records only sanitized actual preview failures and panel diagnostics', async () => {
    const h = activated();
    const speech = last(fakes.made.speech);
    const diagnostics = last(fakes.made.diagnostics);
    h.panel.wiring.speech.diagnostic({ kind: 'speech', event: 'preview', phase: 'received', provider: 'kokoro' });
    speech.preview.mockImplementationOnce(() => {
      speech.options.output.status(8, 'unavailable', 'private provider detail');
      return Promise.resolve();
    });
    await h.panel.wiring.speech.preview();
    expect(diagnostics.record.mock.calls).toContainEqual([
      { kind: 'speech', event: 'preview', phase: 'failed', provider: 'kokoro', reason: 'unknown' },
    ]);
    expect(JSON.stringify(diagnostics.record.mock.calls)).not.toContain('private provider detail');
  });

  it('reports cloud capability without exposing key material', async () => {
    const ctx = context();
    ctx.secrets.get.mockResolvedValue('private-key');
    const h = activated(ctx);
    const diagnostics = last(fakes.made.diagnostics);
    h.panel.wiring.speech.keyRefresh();
    await vi.waitFor(() => {
      expect(diagnostics.record.mock.calls).toContainEqual([
        { kind: 'speech', event: 'capability', provider: 'elevenlabs', phase: 'ready' },
      ]);
    });
    expect(JSON.stringify(diagnostics.record.mock.calls)).not.toContain('private-key');
  });

  it('plays the default output natively only on a local desktop, never on a remote host (#84)', () => {
    const ctx = context();
    activated(ctx);
    expect(vi.mocked(systemOutputDriver)).toHaveBeenLastCalledWith(ctx.extensionPath, true);
    fakes.remoteName = 'ssh-remote';
    activated(context());
    expect(vi.mocked(systemOutputDriver)).toHaveBeenLastCalledWith(expect.any(String), false);
    fakes.remoteName = undefined;
  });

  it('reports cloud capability as unsupported on remote hosts', async () => {
    fakes.remoteName = 'remote';
    const ctx = context();
    ctx.secrets.get.mockResolvedValue('private-key');
    const h = activated(ctx);
    const diagnostics = last(fakes.made.diagnostics);
    h.panel.wiring.speech.keyRefresh();
    await vi.waitFor(() => {
      expect(diagnostics.record.mock.calls).toContainEqual([
        { kind: 'speech', event: 'capability', provider: 'elevenlabs', phase: 'blocked', reason: 'unsupported' },
      ]);
    });
    fakes.remoteName = undefined;
  });

  it('keeps the newer preview diagnostic when an older preview settles late', async () => {
    const h = activated();
    const speech = last(fakes.made.speech);
    const diagnostics = last(fakes.made.diagnostics);
    const old = Promise.withResolvers<void>();
    const current = Promise.withResolvers<void>();
    speech.preview.mockImplementationOnce(() => {
      speech.options.output.status(1, 'preparing');
      return old.promise;
    });
    speech.preview.mockImplementationOnce(() => {
      speech.options.output.status(2, 'preparing');
      return current.promise;
    });
    const first = h.panel.wiring.speech.preview();
    const second = h.panel.wiring.speech.preview();
    old.resolve();
    await first;
    speech.options.output.status(2, 'speaking', 'private content');
    expect(diagnostics.record.mock.calls).toContainEqual([{ kind: 'speech', event: 'preview', provider: 'kokoro', phase: 'ready' }]);
    expect(JSON.stringify(diagnostics.record.mock.calls)).not.toContain('private content');
    current.resolve();
    await second;
  });

  it('copies a fresh diagnostic snapshot only on request and connects lifecycle sources', async () => {
    const h = activated();
    const diagnostics = fakes.made.diagnostics.at(-1);
    if (diagnostics === undefined) throw new Error('Missing diagnostics');
    h.editor.onDiagnostic({ kind: 'command', id: 4, phase: 'start' });
    h.controller.onDiagnostic?.({ kind: 'session', state: 'active' });
    h.bridge.options.onDiagnostic({ kind: 'connection', state: 'connected', connectionId: 1 });
    expect(diagnostics.record).toHaveBeenCalledTimes(3);
    expect(diagnostics.snapshot).not.toHaveBeenCalled();
    await h.panel.wiring.copyDiagnostics();
    const options = vi.mocked(collectDiagnostics).mock.calls.at(-1)?.[0];
    if (options === undefined) throw new Error('Missing collector options');
    expect(DIAGNOSTIC_SNAPSHOT_SCHEMA.parse(options.snapshot())).toEqual(options.snapshot());
    expect(
      DIAGNOSTIC_SNAPSHOT_SCHEMA.safeParse(JSON.parse(vi.mocked(vscode.env.clipboard).writeText.mock.calls.at(-1)?.[0] ?? '')).success,
    ).toBe(true);
  });

  it('reports the current idle, active, and suspended session without changing it', async () => {
    const h = activated();
    await h.panel.wiring.copyDiagnostics();
    const options = vi.mocked(collectDiagnostics).mock.calls.at(-1)?.[0];
    if (options === undefined) throw new Error('Missing collector options');
    expect(options.snapshot().session).toBe('idle');
    last(fakes.made.diagnostics).snapshot.mockReturnValue({
      version: 'test',
      build: 'test',
      session: 'ended',
      connection: 'unavailable',
      connectionId: 'unavailable',
      paused: 'unavailable',
      pauseReasons: 'unavailable',
      events: [],
    });
    h.controller.isActive = true;
    expect(options.snapshot().session).toBe('active');
    h.controller.isSuspended = true;
    expect(options.snapshot().session).toBe('suspended');
    h.controller.isSuspended = false;
    h.controller.isActive = false;
    expect(options.snapshot().session).toBe('ended');
    expect(h.controller.pause).not.toHaveBeenCalled();
    expect(h.controller.resume).not.toHaveBeenCalled();
  });

  it('exposes existing legacy audio observations without a preview', async () => {
    const h = activated();
    await h.api.ready;
    await h.panel.wiring.copyDiagnostics();
    const options = vi.mocked(collectDiagnostics).mock.calls.at(-1)?.[0];
    if (options?.audio === undefined) throw new Error('Missing audio collector');
    expect(await options.audio()).toMatchObject({
      provider: 'kokoro',
      output: 'default',
      routeAvailable: true,
      lastPlayback: 'unknown',
    });
    fakes.settings.set('speech.provider', 'elevenlabs');
    const output = last(fakes.made.outputs);
    output.choice.mockReturnValue({ kind: 'native', backend: 'pipewire', name: 'private' });
    output.ready.mockReturnValue(false);
    const speech = last(fakes.made.speech);
    speech.options.output.status(1, 'speaking');
    speech.audioEvent.mockReturnValueOnce('ended');
    h.panel.wiring.speech.event({ id: 1, pageId: 7, event: 'ended' });
    const audio = await options.audio();
    expect(audio).toMatchObject({ output: 'override', routeAvailable: 'unknown', lastPlayback: 'ended' });
    expect(JSON.stringify(audio)).not.toContain('private');
    expect(speech.preview).not.toHaveBeenCalled();
  });

  it('reports runtime readiness as unknown until the existing check finishes', async () => {
    const runtime = Promise.withResolvers<boolean>();
    vi.mocked(speechRuntimeAvailable).mockReturnValueOnce(runtime.promise);
    const h = activated();
    await h.api.ready;
    await h.panel.wiring.copyDiagnostics();
    const options = vi.mocked(collectDiagnostics).mock.calls.at(-1)?.[0];
    if (options?.audio === undefined) throw new Error('Missing audio collector');
    expect(await options.audio()).toMatchObject({ runtimeReady: 'unknown' });
    runtime.resolve(true);
    await runtime.promise;
    expect(await options.audio()).toMatchObject({ runtimeReady: true });
  });

  it('leaves local audio unavailable while placement is pending', async () => {
    const choice = Promise.withResolvers<'legacy'>();
    fakes.placementChoice = choice.promise;
    const h = activated();
    await h.panel.wiring.copyDiagnostics();
    const options = vi.mocked(collectDiagnostics).mock.calls.at(-1)?.[0];
    if (options?.audio === undefined) throw new Error('Missing audio collector');
    expect(await options.audio()).toBeUndefined();
    choice.resolve('legacy');
    await h.api.ready;
  });

  it('prepares legacy speech after ownership and on settings changes', async () => {
    fakes.settings.set('speech.enabled', true);
    const h = activated();
    await h.api.ready;
    const speech = last(fakes.made.speech);
    expect(speech.prepare).toHaveBeenCalledOnce();
    expect(speech.options.settings()).toMatchObject({ enabled: true, provider: 'kokoro' });
    changed('unrelated');
    expect(speech.prepare).toHaveBeenCalledOnce();
    fakes.settings.set('speech.provider', 'elevenlabs');
    changed('speech', 'speech.provider');
    expect(speech.options.settings().provider).toBe('elevenlabs');
    expect(speech.prepare).toHaveBeenCalledTimes(2);
    fakes.settings.set('speech.enabled', false);
    changed('speech', 'speech.enabled');
    expect(speech.options.settings().enabled).toBe(false);
    expect(speech.prepare).toHaveBeenCalledTimes(3);
    fakes.settings.set('speech.computeMode', 'gpu');
    changed('speech', 'speech.computeMode');
    expect(speech.computeState().requestedMode).toBe('gpu');
    expect(speech.prepare).toHaveBeenCalledTimes(4);
  });

  it('wires local speech with safe defaults and stops it when disabled', () => {
    const h = activated();
    const speech = fakes.made.speech.at(-1);
    if (!speech) throw new Error('Missing speech service');
    expect(h.controller.narration).toBeDefined();
    expect(speech.options.settings()).toEqual({
      contextEnabled: false,
      enabled: false,
      provider: 'kokoro',
      voice: 'af_heart',
      speed: 1,
      elevenLabsVoice: '',
      elevenLabsSpeed: 1,
      listeningSpeed: 1,
    });
    expect(speech.options.localDesktop).toBe(true);
    fakes.settings.set('speech.enabled', true);
    changed('speech', 'speech.enabled');
    fakes.settings.set('speech.voice', 'bf_emma');
    fakes.settings.set('speech.speed', 1.25);
    expect(speech.options.settings()).toEqual({
      contextEnabled: false,
      enabled: true,
      provider: 'kokoro',
      voice: 'bf_emma',
      speed: 1.25,
      elevenLabsVoice: '',
      elevenLabsSpeed: 1,
      listeningSpeed: 1,
    });
    fakes.settings.set('speech.voice', 'invalid');
    fakes.settings.set('speech.speed', 9);
    expect(speech.options.settings()).toEqual({
      contextEnabled: false,
      enabled: true,
      provider: 'kokoro',
      voice: 'invalid',
      speed: 9,
      elevenLabsVoice: '',
      elevenLabsSpeed: 1,
      listeningSpeed: 1,
    });
    fakes.settings.set('speech.enabled', false);
    changed('speech', 'speech.enabled');
    expect(speech.cancel).toHaveBeenCalledOnce();
  });

  it('routes settings, setup, page events and audio through the speech wiring', async () => {
    const h = activated();
    const speech = fakes.made.speech.at(-1);
    if (speech === undefined) throw new Error('Missing speech');
    const wiring = h.panel.wiring.speech;
    fakes.settings.set('speech.enabled', true);
    wiring.settings.set({ enabled: false, provider: 'kokoro', voice: 'bf_emma', speed: 1.25, elevenLabsVoice: '', elevenLabsSpeed: 1 });
    expect(speech.cancel).toHaveBeenCalledOnce();
    await vi.waitFor(() => {
      expect(fakes.updated).toContainEqual(['speech.speed', 1.25, 1]);
    });
    expect(fakes.updated).toEqual(
      expect.arrayContaining([
        ['speech.enabled', false, 1],
        ['speech.voice', 'bf_emma', 1],
        ['speech.speed', 1.25, 1],
      ]),
    );
    wiring.settings.set({ enabled: true, provider: 'kokoro', voice: 'af_heart', speed: 1, elevenLabsVoice: '', elevenLabsSpeed: 1 });
    expect(speech.cancel).toHaveBeenCalledOnce();
    expect(await wiring.modelStatus()).toMatchObject({ download: 'missing' });
    expect(await wiring.installed()).toBe(false);
    vi.mocked(installedSpeechModel).mockResolvedValueOnce('/verified/model');
    expect(await wiring.installed()).toBe(true);
    await wiring.setup();
    expect(setupSpeech).toHaveBeenCalled();
    await wiring.preview();
    wiring.stop();
    wiring.event({ id: 1, pageId: 7, event: 'started' });
    wiring.pageClosed(7);
    expect(speech.preview).toHaveBeenCalledOnce();
    expect(speech.cancel).toHaveBeenCalledTimes(2);
    expect(speech.audioEvent).toHaveBeenCalledWith({ id: 1, pageId: 7, event: 'started' });
    expect(speech.pageClosed).toHaveBeenCalledWith(7);
    expect(speech.options.output.play(1, new Uint8Array([1]), 10)).toBe(7);
    speech.options.output.control(1, 7, 'stop');
    expect(h.panel.controlSpeech).toHaveBeenCalledWith(1, 7, 'stop');
    changed('speech');
    expect(h.panel.showSpeechSettings).toHaveBeenCalled();
  });

  it('keeps setup unavailable when this package has no speech runtime', async () => {
    vi.mocked(speechRuntimeAvailable).mockResolvedValue(false);
    const h = activated();
    await Promise.resolve();
    expect(h.panel.wiring.speech.supported()).toBe(false);
    expect(h.panel.refreshSpeechSupport.mock.calls).toEqual([[]]);
  });

  it('reports an installed model as setup, not host capability', async () => {
    const h = activated();
    const diagnostics = last(fakes.made.diagnostics);
    vi.mocked(installedSpeechModel).mockResolvedValueOnce('/verified/model');
    expect(await h.panel.wiring.speech.installed()).toBe(true);
    expect(diagnostics.record.mock.calls).toContainEqual([{ kind: 'speech', event: 'setup', provider: 'kokoro', phase: 'ready' }]);
  });

  it('enables speech controls once the packaged runtime is available', async () => {
    vi.mocked(speechRuntimeAvailable).mockResolvedValue(true);
    const h = activated();
    expect(h.panel.wiring.speech.supported()).toBe(false);
    await Promise.resolve();
    expect(h.panel.wiring.speech.supported()).toBe(true);
    expect(h.panel.refreshSpeechSupport.mock.calls).toEqual([[]]);
  });

  it('disables local speech when the host platform report fails', () => {
    vi.mocked(localSpeechPlatform).mockReturnValueOnce({ supported: false, reason: 'libc_report_failed' });
    const h = activated();
    expect(h.panel.wiring.speech.supported()).toBe(false);
  });

  it('NoSecret: uses the native masked prompt and does not put a key in settings or logs', async () => {
    const h = activated();
    vi.mocked(vscode.window.showInputBox).mockResolvedValueOnce('test-secret');
    await h.panel.wiring.speech.keySet();
    expect(vi.mocked(vscode.window.showInputBox).mock.calls.at(-1)?.[0]).toMatchObject({ password: true });
    expect(h.context.secrets.store.mock.calls).toEqual([['aiPair.elevenLabs.apiKey', 'test-secret']]);
    expect(JSON.stringify(fakes.updated)).not.toContain('test-secret');
    expect(JSON.stringify(fakes.logged)).not.toContain('test-secret');
    expect(JSON.stringify(h.panel.history)).not.toContain('test-secret');
  });

  it('cancels active speech when provider or credentials change and keeps settings separate', async () => {
    const h = activated();
    const speech = last(fakes.made.speech);
    const wiring = h.panel.wiring.speech;
    expect(wiring.cloudSupported()).toBe(true);
    expect(wiring.validCloudVoice('missing')).toBe(false);
    wiring.loadVoices(true);
    wiring.settings.set({
      enabled: true,
      provider: 'elevenlabs',
      voice: 'bf_emma',
      speed: 1.25,
      elevenLabsVoice: 'voice1',
      elevenLabsSpeed: 1.2,
    });
    expect(speech.cancel.mock.calls).toHaveLength(1);
    await vi.waitFor(() => {
      expect(fakes.updated).toContainEqual(['speech.elevenLabsVoice', 'voice1', 1]);
    });
    expect(fakes.updated).toContainEqual(['speech.provider', 'elevenlabs', 1]);
    expect(fakes.updated).toContainEqual(['speech.elevenLabsVoice', 'voice1', 1]);
    fire('secrets', { key: 'unrelated' });
    expect(speech.invalidateCloud.mock.calls).toEqual([]);
    fire('secrets', { key: 'aiPair.elevenLabs.apiKey' });
    expect(speech.invalidateCloud.mock.calls).toEqual([[]]);
    await wiring.keyRemove();
    expect(h.context.secrets.delete.mock.calls).toEqual([['aiPair.elevenLabs.apiKey']]);
    changed('speech', 'speech.provider');
    expect(speech.cancel.mock.calls).toHaveLength(1);
  });

  it('reports key command failures without revealing errors', async () => {
    const h = activated();
    h.context.secrets.store.mockRejectedValueOnce(new Error('private'));
    vi.mocked(vscode.window.showInputBox).mockResolvedValueOnce('test-secret');
    await command('aiPair.setElevenLabsKey');
    expect(fakes.errors).toContain('Could not save the ElevenLabs API key.');
    h.context.secrets.delete.mockRejectedValueOnce(new Error('private'));
    await command('aiPair.removeElevenLabsKey');
    expect(fakes.errors).toContain('Could not remove the ElevenLabs API key.');
    expect(JSON.stringify(fakes.errors)).not.toContain('private');
  });

  it('ProviderAligned: uses a selected provider immediately while its global setting is still being saved', () => {
    const h = activated();
    fakes.delaySettings = true;
    h.panel.wiring.speech.settings.set({
      enabled: false,
      provider: 'elevenlabs',
      voice: 'af_heart',
      speed: 1,
      elevenLabsVoice: '',
      elevenLabsSpeed: 1,
    });
    expect(h.panel.wiring.speech.settings.get().provider).toBe('elevenlabs');
    fakes.delaySettings = false;
  });

  it('restores only a newly selected catalog voice after the key reset is saved', async () => {
    fakes.settings.set('speech.elevenLabsVoice', 'old');
    const h = activated();
    await h.api.ready;
    const catalog = last(fakes.made.catalogs);
    fire('secrets', { key: 'aiPair.elevenLabs.apiKey' });
    await vi.waitFor(() => {
      expect(fakes.settings.get('speech.elevenLabsVoice')).toBe('');
    });
    catalog.contains.mockReturnValue(true);
    h.panel.wiring.speech.settings.set({
      enabled: false,
      provider: 'elevenlabs',
      voice: 'af_heart',
      speed: 1,
      elevenLabsVoice: 'new-account-voice',
      elevenLabsSpeed: 1,
    });
    await vi.waitFor(() => {
      expect(fakes.settings.get('speech.elevenLabsVoice')).toBe('new-account-voice');
    });
    await vi.waitFor(() => {
      expect(h.panel.showSpeechSettings.mock.lastCall?.[0].elevenLabsVoice).toBe('new-account-voice');
    });
    expect(h.panel.wiring.speech.settings.get().elevenLabsVoice).toBe('new-account-voice');
  });

  it('records only sanitized catalog completion facts and ignores reset as a success', () => {
    const h = activated();
    const catalog = last(fakes.made.catalogs);
    const diagnostics = last(fakes.made.diagnostics);
    h.panel.wiring.speech.loadVoices(false);
    catalog.publish({ voices: [], more: false, loading: false, error: false, reset: true });
    expect(diagnostics.record.mock.calls).not.toContainEqual([
      { kind: 'speech', event: 'catalog', provider: 'elevenlabs', phase: 'ready', reason: 'no_voice' },
    ]);
    h.panel.wiring.speech.loadVoices(false);
    catalog.publish({ voices: [], more: false, loading: false, error: true, errorKind: 'auth' });
    expect(diagnostics.record.mock.calls).toContainEqual([
      { kind: 'speech', event: 'catalog', provider: 'elevenlabs', phase: 'failed', reason: 'auth' },
    ]);
    h.panel.wiring.speech.loadVoices(false);
    catalog.publish({ voices: [], more: false, loading: false, error: false });
    expect(diagnostics.record.mock.calls).toContainEqual([
      { kind: 'speech', event: 'catalog', provider: 'elevenlabs', phase: 'ready', reason: 'no_voice' },
    ]);
  });

  it('records loaded catalogs and unknown errors only after an actual request', () => {
    const h = activated();
    const catalog = last(fakes.made.catalogs);
    const diagnostics = last(fakes.made.diagnostics);
    catalog.publish({ voices: [], more: false, loading: false, error: false });
    h.panel.wiring.speech.loadVoices(false);
    catalog.publish({ voices: [{ id: 'opaque', name: 'Voice' }], more: false, loading: false, error: false });
    expect(diagnostics.record.mock.calls).toContainEqual([{ kind: 'speech', event: 'catalog', provider: 'elevenlabs', phase: 'ready' }]);
    h.panel.wiring.speech.loadVoices(false);
    catalog.publish({ voices: [], more: false, loading: false, error: true });
    expect(diagnostics.record.mock.calls).toContainEqual([
      { kind: 'speech', event: 'catalog', provider: 'elevenlabs', phase: 'failed', reason: 'unknown' },
    ]);
    expect(JSON.stringify(diagnostics.record.mock.calls)).not.toContain('opaque');
  });

  it('KeyClearsVoice: clears an old account voice even while a settings save is pending', async () => {
    const h = activated();
    await h.api.ready;
    const gate = Promise.withResolvers<void>();
    fakes.providerGate = gate.promise;
    h.panel.wiring.speech.settings.set({
      enabled: false,
      provider: 'elevenlabs',
      voice: 'af_heart',
      speed: 1,
      elevenLabsVoice: 'old-account-voice',
      elevenLabsSpeed: 1,
    });
    fire('secrets', { key: 'aiPair.elevenLabs.apiKey' });
    expect(h.panel.wiring.speech.settings.get().elevenLabsVoice).toBe('');
    gate.resolve();
    await vi.waitFor(() => {
      expect(fakes.settings.get('speech.elevenLabsVoice')).toBe('');
    });
    expect(h.panel.wiring.speech.settings.get().elevenLabsVoice).toBe('');
  });

  it('KeyClearsVoice: keeps the old account voice unavailable when a key-reset write fails', async () => {
    fakes.settings.set('speech.elevenLabsVoice', 'old-account-voice');
    const h = activated();
    await h.api.ready;
    const gate = Promise.withResolvers<void>();
    fakes.providerGate = gate.promise;
    fire('secrets', { key: 'aiPair.elevenLabs.apiKey' });
    expect(h.panel.wiring.speech.settings.get().elevenLabsVoice).toBe('');
    gate.reject(new Error('private'));
    await vi.waitFor(() => {
      expect(fakes.errors).toContain('Could not save speech settings.');
    });
    expect(h.panel.wiring.speech.settings.get().elevenLabsVoice).toBe('');
  });

  it('ProviderAligned: does not cancel a preview on delayed settings echoes or unchanged disabled state', async () => {
    const h = activated();
    const speech = last(fakes.made.speech);
    const gate = Promise.withResolvers<void>();
    fakes.providerGate = gate.promise;
    h.panel.wiring.speech.settings.set({
      enabled: false,
      provider: 'elevenlabs',
      voice: 'af_heart',
      speed: 1,
      elevenLabsVoice: '',
      elevenLabsSpeed: 1,
    });
    expect(speech.cancel.mock.calls).toHaveLength(1);
    changed('speech', 'speech.provider', 'speech.enabled');
    expect(speech.cancel.mock.calls).toHaveLength(1);
    gate.resolve();
    await vi.waitFor(() => {
      expect(fakes.settings.get('speech.provider')).toBe('elevenlabs');
    });
    changed('speech', 'speech.enabled');
    expect(speech.cancel.mock.calls).toHaveLength(1);
  });

  it('LatestHonored, Settlement: keeps the latest choice when an older global write settles', async () => {
    const h = activated();
    const gate = Promise.withResolvers<void>();
    fakes.providerGate = gate.promise;
    const base = { enabled: false, voice: 'af_heart', speed: 1, elevenLabsVoice: '', elevenLabsSpeed: 1 };
    h.panel.wiring.speech.settings.set({ ...base, provider: 'elevenlabs' });
    h.panel.wiring.speech.settings.set({ ...base, provider: 'kokoro' });
    changed('speech', 'speech.provider');
    expect(h.panel.wiring.speech.settings.get().provider).toBe('kokoro');
    gate.resolve();
    await vi.waitFor(() => {
      expect(fakes.settings.get('speech.provider')).toBe('kokoro');
    });
    expect(h.panel.wiring.speech.settings.get().provider).toBe('kokoro');
  });

  it('LatestHonored: does not roll back a newer provider when an older write fails', async () => {
    const h = activated();
    const gate = Promise.withResolvers<void>();
    fakes.providerGate = gate.promise;
    const base = { enabled: false, voice: 'af_heart', speed: 1, elevenLabsVoice: '', elevenLabsSpeed: 1 };
    h.panel.wiring.speech.settings.set({ ...base, provider: 'elevenlabs' });
    h.panel.wiring.speech.settings.set({ ...base, provider: 'kokoro' });
    gate.reject(new Error('old failure'));
    await vi.waitFor(() => {
      expect(fakes.settings.get('speech.provider')).toBe('kokoro');
    });
    expect(h.panel.wiring.speech.settings.get().provider).toBe('kokoro');
    expect(fakes.errors).not.toContain('Could not save speech settings.');
  });

  it('Settlement: rolls back the latest provider and reports a failed settings write', async () => {
    const h = activated();
    const gate = Promise.withResolvers<void>();
    fakes.providerGate = gate.promise;
    h.panel.wiring.speech.settings.set({
      enabled: false,
      provider: 'elevenlabs',
      voice: 'af_heart',
      speed: 1,
      elevenLabsVoice: '',
      elevenLabsSpeed: 1,
    });
    expect(h.panel.wiring.speech.settings.get().provider).toBe('elevenlabs');
    gate.reject(new Error('private settings failure'));
    await vi.waitFor(() => {
      expect(fakes.errors).toContain('Could not save speech settings.');
    });
    expect(h.panel.wiring.speech.settings.get().provider).toBe('kokoro');
    expect(JSON.stringify(fakes.errors)).not.toContain('private');
  });

  it('rolls back a failed speech setting for a remote text owner without preparing speech', async () => {
    fakes.remoteName = 'ssh-remote';
    const h = activated();
    await h.api.ready;
    const speech = last(fakes.made.speech);
    const gate = Promise.withResolvers<void>();
    fakes.providerGate = gate.promise;
    h.panel.wiring.speech.settings.set({
      enabled: false,
      provider: 'elevenlabs',
      voice: 'af_heart',
      speed: 1,
      elevenLabsVoice: '',
      elevenLabsSpeed: 1,
    });
    gate.reject(new Error('save failed'));
    await vi.waitFor(() => {
      expect(fakes.errors).toContain('Could not save speech settings.');
    });
    expect(h.panel.wiring.speech.settings.get().provider).toBe('kokoro');
    expect(speech.cancel).toHaveBeenCalled();
    expect(speech.prepare).not.toHaveBeenCalled();
  });

  it('cancels on a genuine external provider change after pending writes settle', () => {
    const h = activated();
    const speech = last(fakes.made.speech);
    fakes.settings.set('speech.provider', 'elevenlabs');
    changed('speech', 'speech.provider');
    expect(speech.cancel.mock.calls).toHaveLength(1);
    expect(h.panel.showSpeechSettings.mock.lastCall?.[0].provider).toBe('elevenlabs');
  });

  it('TypeOK: ignores workspace attempts to select the cloud provider', () => {
    fakes.workspaceProvider = 'elevenlabs';
    activated();
    expect(fakes.made.speech.at(-1)?.options.settings().provider).toBe('kokoro');
    fakes.workspaceProvider = undefined;
  });

  it('does not enable local speech on a remote extension host', () => {
    fakes.remoteName = 'ssh-remote';
    activated();
    expect(fakes.made.speech.at(-1)?.options.localDesktop).toBe(false);
    fakes.remoteName = undefined;
  });

  it('reads, saves and applies automatic terminal visibility and routes a reveal by ID', () => {
    const h = activated();
    expect(h.editor.showAutomatically()).toBe(false);
    expect(h.panel.terminalSettings.get()).toBe(false);
    fakes.settings.set('showTerminalsAutomatically', true);
    expect(h.editor.showAutomatically()).toBe(true);
    expect(h.panel.terminalSettings.get()).toBe(true);
    changed('showTerminalsAutomatically');
    expect(h.panel.showTerminalPreference).toHaveBeenCalledWith(true);
    h.panel.terminalSettings.set(false);
    expect(fakes.updated).toContainEqual(['showTerminalsAutomatically', false, 1]);
    expect(h.panel.showTerminal(42)).toBe(true);
    expect(h.editor.showTerminal).toHaveBeenCalledWith(42);
    fakes.settings.set('showTerminalsAutomatically', 'false');
    expect(h.editor.showAutomatically()).toBe(false);
    expect(h.panel.terminalSettings.get()).toBe(false);
  });

  it('traces the controller at Info, and the panel and the bridge at the Trace level, or at Info with the setting', () => {
    const h = activated();
    h.controller.trace?.('one');
    h.panel.trace('two');
    fakes.settings.set('trace', true);
    h.bridge.options.trace('three');
    expect(fakes.logged).toEqual([
      ['info', 'one'],
      ['trace', 'two'],
      ['info', 'three'],
    ]);
  });

  it('applies each setting as it changes, and only those that changed', () => {
    const h = activated();
    vi.clearAllMocks();
    fakes.settings.set('speed', 2);
    fakes.settings.set('readingSpeed', 3);
    fakes.settings.set('timing', { glideMs: 1 });
    fakes.settings.set('agentName', 'Pal');
    fakes.settings.set('confirmCommands', false);
    changed('speed', 'readingSpeed', 'timing', 'agentName', 'confirmCommands');
    expect(h.controller.setSpeed).toHaveBeenCalledWith(2);
    expect(h.panel.showSpeed).toHaveBeenCalledWith(2);
    expect(h.controller.setReadingSpeed).toHaveBeenCalledWith(3);
    expect(h.panel.showReadingSpeed).toHaveBeenCalledWith(3);
    expect(h.controller.setTiming).toHaveBeenCalledWith({ glideMs: 1 });
    expect(h.editor.setAgentName).toHaveBeenCalledWith('Pal');
    expect(h.controller.setConfirmCommands).toHaveBeenCalledWith(false);
    vi.clearAllMocks();
    changed('trace');
    expect(h.controller.setSpeed).not.toHaveBeenCalled();
    expect(h.controller.setReadingSpeed).not.toHaveBeenCalled();
    expect(h.controller.setTiming).not.toHaveBeenCalled();
    expect(h.editor.setAgentName).not.toHaveBeenCalled();
    expect(h.controller.setConfirmCommands).not.toHaveBeenCalled();
  });

  it('tells the bridge when the window is focused, and when the folders change', () => {
    const h = activated();
    fire('window', { focused: false });
    expect(h.bridge.focused).not.toHaveBeenCalled();
    fire('window', { focused: true });
    expect(h.bridge.focused).toHaveBeenCalledOnce();
    fire('folders', {});
    expect(h.bridge.writeDiscovery).toHaveBeenCalledOnce();
  });

  it('says once that the discovery file could not be written, and that the server could not start', async () => {
    fakes.made.starting = Promise.reject(new Error('EACCES'));
    const h = activated();
    h.bridge.options.failed(new Error('read-only'));
    h.bridge.options.failed(new Error('read-only'));
    await expect(h.api.ready).rejects.toThrow('EACCES');
    await Promise.resolve();
    expect(fakes.errors).toEqual([
      "AI Pair couldn't write its discovery file, so agents won't find this window: Error: read-only",
      "AI Pair couldn't start its local server: Error: EACCES",
    ]);
  });

  it('disposes the bridge, disconnects the controller, and saves, as the window goes', () => {
    const h = activated();
    for (const disposable of h.context.subscriptions) {
      void disposable.dispose();
    }
    expect(h.bridge.dispose).toHaveBeenCalledOnce();
    expect(h.controller.disconnect).toHaveBeenCalledOnce();
  });
});

describe('the session across a reload', () => {
  it('revives a saved session, with its history when the history is panel events', () => {
    vi.mocked(isSavedSession).mockReturnValue(true);
    const stored = new Map<string, unknown>([
      ['aiPair.session', { saved: true }],
      ['aiPair.history', [{ type: 'say' }]],
    ]);
    const h = activated(context(stored));
    expect(h.panel.restoreHistory).toHaveBeenCalledWith([{ type: 'say' }]);
    expect(h.controller.revive).toHaveBeenCalledWith({ saved: true });
    for (const history of [[{ text: 'no type' }], 'not a list']) {
      stored.set('aiPair.history', history);
      expect(activated(context(stored)).panel.restoreHistory).toHaveBeenLastCalledWith([]);
    }
  });

  it('saves the session and its history a while after each change, and nothing once the session is gone', () => {
    vi.useFakeTimers();
    const stored = new Map<string, unknown>();
    const h = activated(context(stored));
    expect(h.controller.revive).not.toHaveBeenCalled();
    h.controller.saved = { session: 1 };
    h.controller.onChange?.();
    h.panel.onPost?.();
    vi.advanceTimersByTime(200);
    expect(stored.get('aiPair.session')).toEqual({ session: 1 });
    expect(stored.get('aiPair.history')).toEqual(['history']);
    vi.mocked(isSavedSession).mockReturnValue(true);
    expect(h.api.saved()).toEqual({ session: 1 });
    vi.mocked(isSavedSession).mockReturnValue(false);
    expect(h.api.saved()).toBeUndefined();
    h.controller.saved = undefined;
    h.controller.onChange?.();
    vi.advanceTimersByTime(200);
    expect(stored.get('aiPair.history')).toBeUndefined();
    expect(h.api.history()).toEqual(['history']);
  });

  it("setTimings: sets the extension's delays and tells the page its own", () => {
    const h = activated();
    h.api.setTimings({ saveMs: 1 });
    expect(vi.mocked(setTimings)).toHaveBeenCalledWith({ saveMs: 1 });
    expect(h.panel.showTimings).toHaveBeenCalledOnce();
  });

  it('panelMessage: hands the panel the message as its page would post it', () => {
    const h = activated();
    h.api.panelMessage({ type: 'pause' });
    expect(h.panel.receiveFromPage).toHaveBeenCalledWith({ type: 'pause' });
  });
});

describe('the commands', () => {
  it('pauses or resumes, interrupts, takes or hands back the turn, and ends the session', () => {
    const h = activated();
    h.controller.isActive = true;
    command('aiPair.togglePause');
    expect(h.controller.pause).toHaveBeenCalledOnce();
    h.controller.isPaused = true;
    command('aiPair.togglePause');
    expect(h.controller.resume).toHaveBeenCalledOnce();
    command('aiPair.interrupt');
    expect(h.controller.userInterrupt).toHaveBeenCalledOnce();
    command('aiPair.toggleTurn');
    expect(h.controller.takeTurn).toHaveBeenCalledOnce();
    h.controller.turn = 'programmer';
    command('aiPair.toggleTurn');
    expect(h.controller.handBack).toHaveBeenCalledOnce();
    command('aiPair.endSession');
    expect(h.controller.endSession).toHaveBeenCalledOnce();
    command('aiPair.focusReply');
    command('aiPair.askAboutSelection');
    expect(h.panel.focusReply).toHaveBeenCalledTimes(2);
  });

  it('guards shortcuts without a session and mirrors the hand button during a session', () => {
    const h = activated();
    command('aiPair.togglePause');
    command('aiPair.toggleAttention');
    command('aiPair.focusReply');
    expect(h.controller.pause).not.toHaveBeenCalled();
    expect(h.controller.requestAttention).not.toHaveBeenCalled();
    expect(h.panel.focusReply).not.toHaveBeenCalled();
    h.controller.isActive = true;
    command('aiPair.toggleAttention');
    expect(h.controller.requestAttention).toHaveBeenCalledOnce();
    h.controller.isAttentionGranted = true;
    command('aiPair.toggleAttention');
    expect(h.controller.requestAttention).toHaveBeenCalledOnce();
    expect(h.panel.focusReply).toHaveBeenCalledOnce();
  });

  it('opens VS Code keyboard shortcuts filtered to Pair', async () => {
    activated();
    await command('aiPair.configureShortcuts');
    expect(fakes.commandCalls).toContainEqual(['workbench.action.openGlobalKeybindings', '@ext:mattyv.ai-pair']);
  });

  it('plays the demo in the folder, or says to open one, and plays it through the Api', async () => {
    const h = activated();
    command('aiPair.playDemo');
    expect(playDemo).toHaveBeenCalledWith(h.controller, '/project');
    await h.api.playDemo();
    expect(playDemo).toHaveBeenCalledTimes(2);
    for (const none of [[], undefined]) {
      fakes.folders = none;
      command('aiPair.playDemo');
    }
    expect(fakes.errors).toEqual([
      'Open a folder first: the demo creates files in ai-pair-demo/.',
      'Open a folder first: the demo creates files in ai-pair-demo/.',
    ]);
    expect(playDemo).toHaveBeenCalledTimes(2);
  });

  it('ReaskedProp: sets the agent up, and offers the panel the start again', async () => {
    const h = activated();
    await command('aiPair.setUpAgent');
    expect(setUpAgent).toHaveBeenCalledWith('/ext/launcher');
    expect(h.panel.askStart).toHaveBeenCalledOnce();
  });

  it('offers Set Up Agent once, the first time, and sets the agent up when it is taken', async () => {
    fakes.answer = 'Set Up Agent';
    const first = context(new Map(), /* offered= */ false);
    activated(first);
    await vi.waitFor(() => {
      expect(setUpAgent).toHaveBeenCalledOnce();
    });
    expect(fakes.infos).toEqual(['AI Pair is installed. Connect it to your agent?']);
    expect(first.globalState.get('aiPair.offeredSetup')).toBe(true);
    fakes.answer = undefined;
    activated(context(new Map(), /* offered= */ false));
    await Promise.resolve();
    expect(setUpAgent).toHaveBeenCalledOnce();
  });
});

describe('the calibration', () => {
  it("starts with the setting's passage, the built-in one when it has no text, and says when one is under way", () => {
    const h = activated();
    const passages: Array<[unknown, unknown]> = [
      [undefined, { title: 'Built in', text: 'Built-in words.' }],
      ['not an object', { title: 'Built in', text: 'Built-in words.' }],
      [{ text: '  ' }, { title: 'Built in', text: 'Built-in words.' }],
      [
        { title: 5, text: 'Words.' },
        { title: 'Your passage', text: 'Words.' },
      ],
      [
        { title: 'Mine', text: 'Words.', notice: 'From me.' },
        { title: 'Mine', text: 'Words.', notice: 'From me.' },
      ],
    ];
    for (const [setting, passage] of passages) {
      fakes.settings.set('calibrationPassage', setting);
      command('aiPair.calibrate');
      expect(h.calibration.arm).toHaveBeenLastCalledWith(passage);
    }
    expect(builtInPassage).toHaveBeenCalledWith('/ext');
    expect(h.panel.focusReply).toHaveBeenCalledTimes(passages.length);
    fakes.made.arms = false;
    command('aiPair.calibrate');
    expect(fakes.infos).toEqual(['AI Pair: a calibration is already under way in the Pair panel.']);
  });

  it("takes an agent's passage through the bridge and keeps it as the setting, unless one is under way", () => {
    const h = activated();
    const passage = { title: 'Agent', text: 'Words.' };
    expect(h.bridge.options.calibrate(passage)).toBe(true);
    expect(fakes.updated).toEqual([['calibrationPassage', passage, 1]]);
    fakes.made.arms = false;
    expect(h.bridge.options.calibrate(passage)).toBe(false);
    expect(fakes.updated).toHaveLength(1);
  });

  it('pauses and resumes the controller, shows its views in the panel, and stores the rate it measured', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(42);
    fakes.settings.set('timing', { glideMs: 1, reading: { minMs: 9 } });
    const h = activated();
    const { host } = h.calibration;
    expect(host.now()).toBe(42);
    host.pause();
    expect(h.controller.pause).toHaveBeenCalledWith('calibrate');
    host.resume();
    expect(h.controller.resume).toHaveBeenCalledWith('calibrate');
    host.show('a view');
    expect(h.panel.showCalibration).toHaveBeenCalledWith('a view');
    await host.store(50);
    expect(fakes.updated).toEqual([['timing', { glideMs: 1, reading: { minMs: 9, msPerChar: 50 } }, 1]]);
    expect(h.controller.setTiming).toHaveBeenLastCalledWith({ glideMs: 1, reading: { minMs: 9, msPerChar: 50 } });
    for (const timing of [undefined, { reading: 'fast' }]) {
      fakes.settings.set('timing', timing);
      await host.store(60);
      // A setting that isn't an object, or whose `reading` isn't, is started afresh.
      expect(fakes.updated.at(-1)?.[1]).toEqual({ reading: { msPerChar: 60 } });
    }
  });
});

describe('deactivate', () => {
  it('returns after the active service has retired', async () => {
    activated();
    await expect(deactivate()).resolves.toBeUndefined();
  });
});

it('passes a host-only key reader to the cloud client', async () => {
  const given = context();
  given.secrets.get.mockResolvedValue('synthetic-key');
  activated(given);
  expect(await last(fakes.made.cloudClients).readKey()).toBe('synthetic-key');
});

it('reports unavailable key status on a failed read and after successful commands', async () => {
  const given = context();
  given.secrets.get.mockRejectedValueOnce(new Error('private'));
  const h = activated(given);
  h.panel.wiring.speech.keyRefresh();
  await vi.waitFor(() => {
    expect(h.panel.showSpeechKeyStatus).toHaveBeenCalledWith(false);
  });
  vi.mocked(vscode.window.showInputBox).mockResolvedValueOnce('synthetic-key');
  await command('aiPair.setElevenLabsKey');
  await command('aiPair.removeElevenLabsKey');
  expect(given.secrets.store).toHaveBeenCalledOnce();
  expect(given.secrets.delete).toHaveBeenCalledOnce();
  expect(JSON.stringify(fakes.logged)).not.toContain('synthetic-key');
});

it('ignores a stale failed key-status read after a newer successful read', async () => {
  const given = context();
  const stale = Promise.withResolvers<string | undefined>();
  given.secrets.get.mockReturnValueOnce(stale.promise).mockResolvedValueOnce('synthetic-key');
  const h = activated(given);
  h.panel.wiring.speech.keyRefresh();
  h.panel.wiring.speech.keyRefresh();
  await vi.waitFor(() => {
    expect(h.panel.showSpeechKeyStatus).toHaveBeenCalledWith(true);
  });
  stale.reject(new Error('private'));
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(h.panel.showSpeechKeyStatus).not.toHaveBeenCalledWith(false);
});

it('records bounded local worker readiness and failure facts', () => {
  activated();
  const output = last(fakes.made.speech).options.output;
  output.localDiagnostic?.('ready');
  output.localDiagnostic?.('failed', 'worker_native');
  const calls = last(fakes.made.diagnostics).record.mock.calls;
  expect(calls).toContainEqual([{ kind: 'speech', event: 'runtime', provider: 'kokoro', phase: 'ready' }]);
  expect(calls).toContainEqual([{ kind: 'speech', event: 'runtime', provider: 'kokoro', phase: 'failed', reason: 'worker_native' }]);
});

it('wires output preference actions to local state without starting speech', async () => {
  const h = activated();
  const output = last(fakes.made.outputs);
  const speech = last(fakes.made.speech);
  expect(h.panel.wiring.speech.outputView()).toEqual({ supported: false, devices: [], selected: { kind: 'default' } });
  expect(h.panel.wiring.speech.outputReady()).toBe(true);
  h.panel.wiring.speech.outputRefresh();
  h.panel.wiring.speech.outputSelect({ kind: 'default' });
  expect(output.refresh).toHaveBeenCalledOnce();
  expect(output.choose).toHaveBeenCalledWith({ kind: 'default' });
  expect(speech.preview).not.toHaveBeenCalled();
  await output.wiring.write({ kind: 'default' });
  expect(h.context.globalState.get('speechOutput')).toEqual({ kind: 'default' });
  output.wiring.stop();
  expect(speech.cancel).toHaveBeenCalled();
  const state = { supported: false, devices: [], selected: { kind: 'default' as const } };
  output.wiring.changed(state);
  expect(h.panel.showSpeechOutputCatalog).toHaveBeenCalledWith(state);
  expect(await output.wiring.discover()).toEqual({ supported: false, devices: [], reason: 'unsupported' });
});

it('routes speech through the output router and invalidates it before a preference change', () => {
  const h = activated();
  const router = last(fakes.made.routers);
  const prefs = last(fakes.made.outputs);
  const speech = last(fakes.made.speech);
  expect(speech.options.output).toBe(router);
  expect(router.options.choice()).toEqual({ kind: 'default' });
  expect(router.options.currentPage()).toBe(7);
  router.options.audioEvent({ id: 2, pageId: 7, event: 'started' });
  expect(speech.audioEvent).toHaveBeenCalledWith({ id: 2, pageId: 7, event: 'started' });
  speech.audioEvent.mockReturnValueOnce('ended');
  router.options.audioEvent({ id: 2, pageId: 7, event: 'ended' });
  expect(router.browserRetired).toHaveBeenCalledWith(2, 7);
  h.panel.wiring.speech.outputRetired(3, 7);
  expect(router.browserRetired).toHaveBeenCalledWith(3, 7);
  h.panel.wiring.speech.pageClosed(7);
  expect(router.pageClosed).not.toHaveBeenCalled();
  h.panel.wiring.speech.outputPageRetired(7);
  expect(router.pageClosed).toHaveBeenCalledWith(7);
  prefs.wiring.stop();
  expect(speech.cancel).toHaveBeenCalledOnce();
  expect(router.invalidate).toHaveBeenCalledOnce();
  expect(h.panel.wiring.speech.outputReady()).toBe(true);
});

it('never discovers native outputs on a remote host', async () => {
  fakes.remoteName = 'ssh-remote';
  activated();
  const prefs = last(fakes.made.outputs);
  expect(await prefs.wiring.discover()).toEqual({ supported: false, devices: [], reason: 'unsupported' });
  fakes.remoteName = undefined;
});

it('activates the installed companion before preparing and logs both timings', async () => {
  fakes.companionInstalled = true;
  activated();
  await fakes.placementOptions?.activate?.();
  expect(fakes.commandCalls.some(([name]) => name === 'aiPair.localAudio.activate')).toBe(true);
  await expect(fakes.placementOptions?.prepare()).rejects.toThrow('missing command');
  expect(fakes.logged.some(([, line]) => line.startsWith('Local Audio activation completed in '))).toBe(true);
  expect(fakes.logged.some(([, line]) => line.startsWith('Local Audio prepare command completed in '))).toBe(true);
});

it('copies diagnostics from a command when the panel is unavailable', async () => {
  fakes.companionInstalled = true;
  const h = activated();
  await h.api.ready;
  const copy = fakes.commands.get('aiPair.copyDiagnostics');
  expect(copy).toBeDefined();
  await copy?.();
  expect(
    DIAGNOSTIC_SNAPSHOT_SCHEMA.safeParse(JSON.parse(vi.mocked(vscode.env.clipboard).writeText.mock.calls.at(-1)?.[0] ?? '')).success,
  ).toBe(true);
});

it('propagates clipboard failure to the panel so it cannot report success', async () => {
  const h = activated();
  vi.mocked(vscode.env.clipboard).writeText.mockRejectedValueOnce(new Error('private'));
  await expect(h.panel.wiring.copyDiagnostics()).rejects.toThrow('private');
});

it('reports a clipboard failure from the diagnostics command', async () => {
  activated();
  vi.mocked(vscode.env.clipboard).writeText.mockRejectedValueOnce(new Error('private'));
  await fakes.commands.get('aiPair.copyDiagnostics')?.();
  expect(fakes.errors).toContain('AI Pair could not copy diagnostics to the clipboard.');
});

it('blocks an installed incompatible companion without registering a fallback provider', async () => {
  fakes.companionInstalled = true;
  const h = activated();
  await h.api.ready;
  expect(fakes.placementOptions?.companionInstalled).toBe(true);
  await expect(fakes.placementOptions?.prepare()).rejects.toThrow('missing command');
  expect(fakes.providerRegistered).not.toHaveBeenCalled();
  expect(h.api.speechPageReady()).toBe(false);
  expect(fakes.infos).toContain('AI Pair and AI Pair Local Audio could not connect. Update both extensions and reload the window.');
  await h.api.previewSpeech();
  expect(fakes.commandCalls.some(([name]) => name === 'aiPair.localAudio.preview')).toBe(false);
});

it('offers diagnostics and output from the connection warning', async () => {
  fakes.companionInstalled = true;
  fakes.answer = 'Copy diagnostics';
  const h = activated();
  await h.api.ready;
  await vi.waitFor(() => {
    expect(vi.mocked(vscode.env.clipboard).writeText.mock.calls.length).toBeGreaterThan(0);
  });
  fakes.answer = 'Show output';
  const next = activated();
  await next.api.ready;
  await vi.waitFor(() => {
    expect(fakes.showOutput).toHaveBeenCalled();
  });
});

it('reports a sanitized companion preparation failure in the warning and output', async () => {
  fakes.companionInstalled = true;
  const choice = Promise.withResolvers<import('../src/panel_placement').PanelOwner>();
  fakes.placementChoice = choice.promise;
  const h = activated();
  fakes.placementOptions?.failure?.('timeout');
  choice.resolve('incompatible');
  await h.api.ready;
  expect(fakes.infos).toContain(
    'AI Pair and AI Pair Local Audio could not connect. The Local Audio extension did not respond in time. See the AI Pair output for details.',
  );
  fakes.companionInstalled = false;
  fakes.placementOptions?.failure?.('invalid_response');
});

it('selects the local companion without registering a workspace panel provider', async () => {
  fakes.companionAvailable = true;
  const h = activated();
  await h.api.ready;
  expect(fakes.providerRegistered).not.toHaveBeenCalled();
  expect(fakes.commands.has('aiPair.localAudio.workspace')).toBe(true);
  await h.api.previewSpeech();
  expect(fakes.commandCalls.some(([name]) => name === 'aiPair.localAudio.preview')).toBe(true);
  expect(h.api.speechPageReady()).toBe(true);
  expect(h.api.speechStatus()).toBeUndefined();
  await h.panel.wiring.copyDiagnostics();
  expect(vi.mocked(collectDiagnostics).mock.calls.at(-1)?.[0].companion).toBe(true);
});

it('maps companion diagnostics commands to the collector', async () => {
  fakes.companionAvailable = true;
  const h = activated();
  await h.api.ready;
  await h.panel.wiring.copyDiagnostics();
  const options = vi.mocked(collectDiagnostics).mock.calls.at(-1)?.[0];
  if (options === undefined) throw new Error('Missing collector options');
  await options.command('speech');
  await options.command('gpu');
  await options.command('audio');
  expect(fakes.commandCalls.map(([name]) => name)).toEqual(
    expect.arrayContaining(['aiPair.localAudio.diagnostics', 'aiPair.localAudio.gpuDiagnostics', 'aiPair.localAudio.audioDiagnostics']),
  );
});

it('holds narration and secret changes while placement is pending, then selects legacy', async () => {
  const choice = Promise.withResolvers<'legacy'>();
  fakes.placementChoice = choice.promise;
  const h = activated();
  const ready = h.controller.narration.ready?.();
  const pending = h.controller.narration.speak('pending');
  const pendingCue = h.controller.narration.attentionCue?.();
  h.controller.narration.pause();
  h.controller.narration.resume();
  h.controller.narration.cancel();
  fire('secrets', { key: 'aiPair.elevenLabs.apiKey' });
  expect(fakes.providerRegistered).not.toHaveBeenCalled();
  expect(command('aiPair.localAudio.workspace', { example: true })).toBe(false);
  choice.resolve('legacy');
  await h.api.ready;
  await pending;
  await pendingCue;
  expect(await ready).toBe(false);
  const speech = last(fakes.made.speech);
  expect(speech.speak).not.toHaveBeenCalledWith('pending');
  expect(speech.attentionCue).not.toHaveBeenCalled();
  expect(await h.controller.narration.ready?.()).toBe(false);
  expect(speechReady).toHaveBeenCalledTimes(2);
  const facts = vi.mocked(speechReady).mock.lastCall?.[0];
  if (facts === undefined) throw new Error('No readiness facts');
  expect(facts.settings().enabled).toBe(false);
  expect(facts.desktop()).toBe(true);
  expect(typeof facts.local()).toBe('boolean');
  expect(facts.output()).toBe(true);
  await expect(facts.model()).resolves.toBe(false);
  await expect(facts.key('elevenlabs')).resolves.toBe(false);
  await h.controller.narration.speak('legacy');
  await h.controller.narration.attentionCue?.();
  expect(speech.attentionCue).toHaveBeenCalledOnce();
  h.controller.narration.pause();
  h.controller.narration.resume();
  h.controller.narration.cancel();
  expect(speech.speak).toHaveBeenCalledWith('legacy', undefined);
  expect(speech.pause).toHaveBeenCalled();
  expect(speech.resume).toHaveBeenCalled();
  expect(speech.cancel).toHaveBeenCalled();
  expect(fakes.providerRegistered).toHaveBeenCalledOnce();
});

it('dispatches a cue queued while the owner is being selected', async () => {
  const choice = Promise.withResolvers<'legacy'>();
  fakes.placementChoice = choice.promise;
  const h = activated();
  const service = last(fakes.made.speech);
  const cue = h.controller.narration.attentionCue?.();
  expect(service.attentionCue).not.toHaveBeenCalled();
  choice.resolve('legacy');
  await cue;
  expect(service.attentionCue).toHaveBeenCalledOnce();
});

it('forwards attention cues to the selected companion owner', async () => {
  fakes.companionAvailable = true;
  const h = activated();
  await h.api.ready;
  const session = fakes.session;
  if (session === undefined) throw new Error('No session');
  const cue = h.controller.narration.attentionCue;
  expect(cue).toBeDefined();
  await cue?.();
  expect(session.narration.attentionCue).toHaveBeenCalledOnce();
});

it('rejects stale retirement admission and reports a current refusal', async () => {
  fakes.companionAvailable = true;
  const h = activated();
  await h.api.ready;
  const session = fakes.session;
  if (session === undefined) throw new Error('No session');
  const gate = Promise.withResolvers<boolean>();
  session.narration.waitForRetirement.mockReturnValueOnce(gate.promise).mockResolvedValueOnce(false);
  const stale = h.controller.narration.waitForRetirement?.(new AbortController().signal);
  await vi.waitFor(() => {
    expect(session.narration.waitForRetirement).toHaveBeenCalled();
  });
  h.controller.narration.cancel();
  gate.resolve(true);
  expect(await stale).toBe(false);
  expect(await h.controller.narration.waitForRetirement?.(new AbortController().signal)).toBe(false);
  expect(fakes.infos).toContain('Speech is still finishing. This message will be shown without audio.');
});

it('rejects an already aborted admission and allows an enabled legacy owner', async () => {
  fakes.settings.set('speech.enabled', true);
  const h = activated();
  await h.api.ready;
  const abort = new AbortController();
  abort.abort();
  expect(await h.controller.narration.waitForRetirement?.(abort.signal)).toBe(false);
  expect(await h.controller.narration.waitForRetirement?.(new AbortController().signal)).toBe(true);
});

it('skips retirement admission for disabled legacy speech', async () => {
  const h = activated();
  await h.api.ready;
  expect(await h.controller.narration.waitForRetirement?.(new AbortController().signal)).toBe(false);
});

it('routes companion controls, keys, frame acknowledgements and connection notices locally', async () => {
  fakes.companionAvailable = true;
  const h = activated();
  await h.api.ready;
  fire('secrets', { key: 'aiPair.elevenLabs.apiKey' });
  const session = fakes.session;
  const options = fakes.workspaceOptions;
  if (session === undefined || options === undefined) throw new Error('No session');
  expect(await h.controller.narration.ready?.()).toBe(true);
  expect(fakes.commandCalls).toContainEqual(['aiPair.localAudio.ready', 'test-epoch']);
  session.pageReady.mockReturnValue(false);
  expect(await h.controller.narration.ready?.()).toBe(false);
  session.pageReady.mockReturnValue(true);
  await h.controller.narration.speak('hello');
  h.controller.narration.pause();
  h.controller.narration.resume();
  h.controller.narration.cancel();
  expect(session.narration.speak).toHaveBeenCalledWith('hello', undefined);
  expect(session.narration.pause).toHaveBeenCalledOnce();
  expect(session.narration.resume).toHaveBeenCalledOnce();
  expect(session.narration.cancel).toHaveBeenCalledOnce();
  expect(command('aiPair.localAudio.workspace', { example: true })).toBe(true);
  expect(session.accept).toHaveBeenCalledWith({ example: true });
  await command('aiPair.setElevenLabsKey');
  await command('aiPair.removeElevenLabsKey');
  expect(fakes.commandCalls.map(([name]) => name)).toContain('aiPair.localAudio.keySet');
  expect(fakes.commandCalls.map(([name]) => name)).toContain('aiPair.localAudio.keyRemove');
  const frame = {
    version: LOCAL_AUDIO_VERSION as typeof LOCAL_AUDIO_VERSION,
    connectionEpoch: 'test-epoch',
    sequence: 1,
    type: 'heartbeat' as const,
  };
  await expect(options.send(frame)).resolves.toBeUndefined();
  fakes.frameAccepted = false;
  await expect(options.send(frame)).rejects.toThrow('not accepted');
  options.lost();
  options.unavailable?.();
  expect(fakes.infos.some((message) => message.includes('lost its local audio'))).toBe(true);
  expect(fakes.infos.some((message) => message.includes('too large'))).toBe(true);
});

it('exposes fixed prepare and commit commands and merges only valid local diagnostics', async () => {
  fakes.companionAvailable = true;
  const h = activated();
  await h.api.ready;
  const placement = fakes.placementOptions;
  if (placement === undefined) throw new Error('No placement');
  const prepared = { version: LOCAL_AUDIO_VERSION as typeof LOCAL_AUDIO_VERSION, epoch: 'test-epoch', token: 'token' };
  await expect(placement.prepare()).resolves.toEqual(prepared);
  await expect(placement.commit(prepared)).resolves.toBe(true);
  await h.panel.wiring.copyDiagnostics();
  expect(vi.mocked(collectDiagnostics).mock.calls.at(-1)?.[0].companion).toBe(true);
});

it('remote text routes preview and key actions to local installation, including the chosen install action', async () => {
  fakes.remoteName = 'ssh-remote';
  fakes.answer = 'Install VSIX...';
  const h = activated();
  await h.api.ready;
  await h.api.previewSpeech();
  await command('aiPair.setElevenLabsKey');
  await command('aiPair.removeElevenLabsKey');
  expect(h.api.speechPageReady()).toBe(false);
  expect(fakes.providerRegistered).toHaveBeenCalledOnce();
  expect(fakes.commandCalls.some(([name]) => name === 'workbench.extensions.action.installVSIX')).toBe(true);
});

it('does not register a provider when placement resolves after shutdown', async () => {
  const choice = Promise.withResolvers<'legacy'>();
  fakes.placementChoice = choice.promise;
  const h = activated();
  for (const disposable of h.context.subscriptions) disposable.dispose();
  choice.resolve('legacy');
  await h.api.ready;
  expect(fakes.providerRegistered).not.toHaveBeenCalled();
  expect(() => fakes.placementOptions?.beforeCommit?.()).toThrow('Window is closing');
});

it('keeps companion command failures private and does not change panel ownership', async () => {
  fakes.companionAvailable = true;
  const h = activated();
  await h.api.ready;
  const placement = fakes.placementOptions;
  if (placement === undefined) throw new Error('No placement');
  const prepared = { version: LOCAL_AUDIO_VERSION as typeof LOCAL_AUDIO_VERSION, epoch: 'test-epoch', token: 'token' };
  fakes.failedCommands.add('aiPair.localAudio.prepare');
  fakes.failedCommands.add('aiPair.localAudio.commit');
  fakes.failedCommands.add('aiPair.localAudio.keySet');
  fakes.failedCommands.add('aiPair.localAudio.keyRemove');
  await expect(placement.prepare()).rejects.toThrow();
  await expect(placement.commit(prepared)).rejects.toThrow();
  await command('aiPair.setElevenLabsKey');
  await command('aiPair.removeElevenLabsKey');
  expect(fakes.errors).toContain('Could not save the ElevenLabs API key.');
  expect(fakes.errors).toContain('Could not remove the ElevenLabs API key.');
  expect(fakes.providerRegistered).not.toHaveBeenCalled();
  expect(fakes.errors.join(' ')).not.toContain('private');
});

it('does not refresh workspace credentials when a pending secret change resolves to companion', async () => {
  const choice = Promise.withResolvers<'companion'>();
  fakes.placementChoice = choice.promise;
  fakes.companionAvailable = true;
  const h = activated();
  fire('secrets', { key: 'aiPair.elevenLabs.apiKey' });
  fakes.placementOptions?.beforeCommit?.();
  choice.resolve('companion');
  await h.api.ready;
  expect(h.context.secrets.get).not.toHaveBeenCalled();
  expect(fakes.providerRegistered).not.toHaveBeenCalled();
});

it('defaults invalid listening speed and persists it without changing synthesis speed', async () => {
  const h = activated();
  const speech = fakes.made.speech.at(-1);
  if (!speech) throw new Error('Missing speech service');
  const settings = h.panel.wiring.speech.settings;
  expect(settings.get()).toMatchObject({ listeningSpeed: 1, speed: 1, elevenLabsSpeed: 1 });
  fakes.settings.set('speech.listeningSpeed', 9);
  expect(settings.get()).toMatchObject({ listeningSpeed: 1 });
  fakes.settings.set('speech.listeningSpeed', 1.1);
  expect(settings.get()).toMatchObject({ listeningSpeed: 1.1 });
  settings.set({ ...settings.get(), listeningSpeed: 1.1 });
  expect(speech.cancel).not.toHaveBeenCalled();
  await vi.waitFor(() => {
    expect(fakes.updated).toContainEqual(['speech.listeningSpeed', 1.1, 1]);
  });
});

it('constructs the legacy listening-speed worker from the fixed extension path', () => {
  tempoPaths.length = 0;
  activated();
  expect(tempoPaths).toEqual(['/ext/dist/speech/tempo_worker.mjs']);
});

it('persists compute mode and keeps an unavailable GPU check fail-closed', async () => {
  const h = activated();
  const compute = h.panel.wiring.speech;
  expect(compute.computeState().requestedMode).toBe('cpu');
  const service = last(fakes.made.speech);
  expect(service.options.computeMode()).toBe('cpu');
  service.setComputeState({ requestedMode: 'cpu', actualBackend: 'cpu', gpuCheck: { phase: 'unavailable', reason: 'runtime_missing' } });
  expect(compute.computeState().actualBackend).toBe('cpu');
  expect(compute.computeState().gpuCheck).toEqual({ phase: 'unavailable', reason: 'runtime_missing' });
  compute.computeMode('gpu');
  expect(compute.computeState().requestedMode).toBe('gpu');
  await vi.waitFor(() => {
    expect(fakes.settings.get('speech.computeMode')).toBe('gpu');
  });
  compute.checkGpuSetup();
  await vi.waitFor(() => {
    expect(compute.computeState().gpuCheck).toEqual({ phase: 'unavailable', reason: 'runtime_missing' });
  });
  expect(h.panel.showSpeechComputeState).toHaveBeenCalled();
});

it('records cloud narration failure diagnostics', () => {
  activated();
  last(fakes.made.speech).options.cloudDiagnostic?.('auth');
  expect(last(fakes.made.diagnostics).record).toHaveBeenCalledWith({
    kind: 'speech',
    event: 'narration',
    provider: 'elevenlabs',
    phase: 'failed',
    reason: 'auth',
  });
});

it('preserves the latest compute choice through writes and rolls back a failed latest choice', async () => {
  const h = activated();
  const gate = Promise.withResolvers<void>();
  fakes.computeGate = gate.promise;
  h.panel.wiring.speech.computeMode('auto');
  h.panel.wiring.speech.computeMode('gpu');
  changed('speech');
  expect(h.panel.wiring.speech.computeState().requestedMode).toBe('gpu');
  gate.resolve();
  await vi.waitFor(() => {
    expect(fakes.settings.get('speech.computeMode')).toBe('gpu');
  });
  const failing = Promise.withResolvers<void>();
  fakes.computeGate = failing.promise;
  h.panel.wiring.speech.computeMode('cpu');
  failing.reject(new Error('private'));
  await vi.waitFor(() => {
    expect(fakes.errors).toContain('Could not save speech compute mode.');
  });
  expect(h.panel.wiring.speech.computeState().requestedMode).toBe('gpu');
  fakes.settings.set('speech.computeMode', 'auto');
  changed('speech');
  expect(h.panel.wiring.speech.computeState().requestedMode).toBe('auto');
});

it('ignores an older failed compute save and normalizes an invalid saved choice', async () => {
  const h = activated();
  const stale = Promise.withResolvers<void>();
  fakes.computeGate = stale.promise;
  h.panel.wiring.speech.computeMode('auto');
  h.panel.wiring.speech.computeMode('gpu');
  stale.reject(new Error('private'));
  await vi.waitFor(() => {
    expect(fakes.settings.get('speech.computeMode')).toBe('gpu');
  });
  expect(fakes.errors).not.toContain('Could not save speech compute mode.');
  fakes.settings.set('speech.computeMode', 'invalid');
  const failed = Promise.withResolvers<void>();
  fakes.computeGate = failed.promise;
  h.panel.wiring.speech.computeMode('auto');
  failed.reject(new Error('private'));
  await vi.waitFor(() => {
    expect(fakes.errors).toContain('Could not save speech compute mode.');
  });
  expect(h.panel.wiring.speech.computeState().requestedMode).toBe('cpu');
});

it('refreshes a restored native route when the legacy host owns speech', async () => {
  const given = context();
  await given.globalState.update('speechOutput', { kind: 'native', backend: 'coreaudio', name: 'headset' });
  const h = activated(given);
  await h.api.ready;
  expect(fakes.made.outputs.at(-1)?.refresh).toHaveBeenCalledOnce();
});

it('does not refresh the legacy route when the companion owns speech', async () => {
  fakes.companionAvailable = true;
  const given = context();
  await given.globalState.update('speechOutput', { kind: 'native', backend: 'coreaudio', name: 'headset' });
  const h = activated(given);
  await h.api.ready;
  expect(fakes.made.outputs.at(-1)?.refresh).not.toHaveBeenCalled();
});

it('reports cached legacy voice readiness before Settings opens', async () => {
  fakes.settings.set('speech.enabled', true);
  const runtime = Promise.withResolvers<boolean>();
  vi.mocked(speechRuntimeAvailable).mockReturnValueOnce(runtime.promise);
  const h = activated();
  await h.api.ready;
  expect(h.panel.wiring.speech.readiness?.()).toMatchObject({
    enabled: true,
    provider: 'kokoro',
    runtimeReady: 'unknown',
    modelReady: 'unknown',
  });
  runtime.resolve(true);
  await runtime.promise;
  expect(h.panel.wiring.speech.readiness?.().runtimeReady).toBe(true);
  expect(h.panel.showSpeechReadiness).toHaveBeenCalled();
});

it('keeps the latest cached model result when an older check settles late', async () => {
  const old = Promise.withResolvers<string | undefined>();
  vi.mocked(installedSpeechModel).mockReturnValueOnce(old.promise).mockResolvedValueOnce('/new');
  const h = activated();
  await h.api.ready;
  const first = h.panel.wiring.speech.installed();
  expect(await h.panel.wiring.speech.installed()).toBe(true);
  old.resolve(undefined);
  await first;
  expect(h.panel.wiring.speech.readiness?.().modelReady).toBe(true);
});

it('does not publish a late model or runtime result after shutdown', async () => {
  const runtime = Promise.withResolvers<boolean>();
  const model = Promise.withResolvers<string | undefined>();
  vi.mocked(speechRuntimeAvailable).mockReturnValueOnce(runtime.promise);
  vi.mocked(installedSpeechModel).mockReturnValueOnce(model.promise);
  const h = activated();
  await h.api.ready;
  const pending = h.panel.wiring.speech.installed();
  for (const disposable of h.context.subscriptions) disposable.dispose();
  h.panel.showSpeechReadiness.mockClear();
  runtime.resolve(true);
  model.resolve('/new');
  await pending;
  await runtime.promise;
  expect(h.panel.showSpeechReadiness).not.toHaveBeenCalled();
  expect(h.panel.wiring.speech.readiness?.().modelReady).toBe('unknown');
  expect(h.panel.wiring.speech.readiness?.().runtimeReady).toBe('unknown');
});

it('leaves a restored route unknown until device discovery completes', async () => {
  const given = context();
  await given.globalState.update('speechOutput', { kind: 'native', backend: 'coreaudio', name: 'headset' });
  const h = activated(given);
  expect(h.panel.wiring.speech.readiness?.().routeAvailable).toBe('unknown');
  await h.api.ready;
});

it('publishes only the latest discovered route and validates its facts', async () => {
  const old = Promise.withResolvers<Awaited<ReturnType<typeof discoverOutputs>>>();
  const current = Promise.withResolvers<Awaited<ReturnType<typeof discoverOutputs>>>();
  vi.mocked(discoverOutputs).mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
  const h = activated();
  await h.api.ready;
  const output = last(fakes.made.outputs);
  output.choice.mockReturnValue({ kind: 'native', backend: 'pipewire', name: 'headset' });
  const first = output.wiring.discover();
  const second = output.wiring.discover();
  current.resolve({ supported: true, devices: [] });
  await second;
  expect(AUDIO_DIAGNOSTICS_SCHEMA.parse(h.panel.wiring.speech.readiness?.()).routeAvailable).toBe(true);
  old.resolve({ supported: false, devices: [] });
  await first;
  expect(h.panel.wiring.speech.readiness?.().routeAvailable).toBe(true);
  const later = Promise.withResolvers<Awaited<ReturnType<typeof discoverOutputs>>>();
  vi.mocked(discoverOutputs).mockReturnValueOnce(later.promise);
  const pending = output.wiring.discover();
  for (const disposable of h.context.subscriptions) disposable.dispose();
  later.resolve({ supported: true, devices: [] });
  await pending;
  expect(h.panel.wiring.speech.readiness?.().routeAvailable).toBe('unknown');
});

it('ignores a superseded model status and a status resolved after shutdown', async () => {
  const old = Promise.withResolvers<Awaited<ReturnType<typeof speechModelStatus>>>();
  const later = Promise.withResolvers<Awaited<ReturnType<typeof speechModelStatus>>>();
  vi.mocked(speechModelStatus).mockReturnValueOnce(old.promise).mockReturnValueOnce(later.promise);
  const h = activated();
  await h.api.ready;
  const first = h.panel.wiring.speech.modelStatus();
  vi.mocked(installedSpeechModel).mockResolvedValueOnce('/new');
  await h.panel.wiring.speech.installed();
  const status = { path: '/model', source: 'https://example.test', revision: 'abc', verified: false, download: 'missing' as const };
  old.resolve(status);
  await first;
  expect(h.panel.wiring.speech.readiness?.().modelReady).toBe(true);
  const pending = h.panel.wiring.speech.modelStatus();
  for (const disposable of h.context.subscriptions) disposable.dispose();
  later.resolve(status);
  await pending;
  expect(h.panel.wiring.speech.readiness?.().modelReady).toBe('unknown');
});

it('reports local audio transport from the selected panel owner', async () => {
  const local = activated();
  await local.api.ready;
  expect(local.panel.showSpeechTransport).toHaveBeenCalledWith(true);
  fakes.remoteName = 'ssh-remote';
  const remote = activated();
  await remote.api.ready;
  expect(remote.panel.showSpeechTransport).toHaveBeenCalledWith(false);
});

it('publishes failed playback and clears it when speech starts again', async () => {
  const h = activated();
  await h.api.ready;
  const output = last(fakes.made.speech).options.output;
  output.status(1, 'unavailable', 'Speech failed');
  expect(h.panel.wiring.speech.readiness?.().lastPlayback).toBe('failed');
  expect(h.panel.showSpeechReadiness).toHaveBeenLastCalledWith(expect.objectContaining({ lastPlayback: 'failed' }));
  changed('speech', 'speech.speed');
  expect(h.panel.wiring.speech.readiness?.().lastPlayback).toBe('failed');
  output.status(2, 'speaking');
  expect(h.panel.wiring.speech.readiness?.().lastPlayback).toBe('unknown');
});

it('publishes an unknown route while a refreshed discovery is pending', async () => {
  const h = activated();
  await h.api.ready;
  const output = last(fakes.made.outputs);
  output.choice.mockReturnValue({ kind: 'native', backend: 'pipewire', name: 'headset' });
  await output.wiring.discover();
  expect(h.panel.wiring.speech.readiness?.().routeAvailable).toBe(true);
  h.panel.showSpeechReadiness.mockClear();
  const pending = Promise.withResolvers<Awaited<ReturnType<typeof discoverOutputs>>>();
  vi.mocked(discoverOutputs).mockReturnValueOnce(pending.promise);
  const refresh = output.wiring.discover();
  expect(h.panel.showSpeechReadiness).toHaveBeenLastCalledWith(expect.objectContaining({ routeAvailable: 'unknown' }));
  pending.resolve({ supported: true, devices: [] });
  await refresh;
});

it('updates settings validity before publishing immediate readiness', async () => {
  const h = activated();
  await h.api.ready;
  h.panel.showSpeechSettings.mockClear();
  h.panel.showSpeechReadiness.mockClear();
  h.panel.wiring.speech.settings.set({
    enabled: true,
    provider: 'kokoro',
    voice: 'af_heart',
    speed: 1,
    elevenLabsVoice: '',
    elevenLabsSpeed: 1,
  });
  expect(h.panel.showSpeechSettings).toHaveBeenCalled();
  expect(h.panel.showSpeechSettings.mock.invocationCallOrder[0]).toBeLessThan(h.panel.showSpeechReadiness.mock.invocationCallOrder[0] ?? 0);
});

it('uses the service manager as the sole compute authority', async () => {
  const h = activated();
  const service = last(fakes.made.speech);
  h.panel.wiring.speech.computeMode('gpu');
  expect(service.selectComputeMode).toHaveBeenCalledWith('gpu');
  expect(h.panel.wiring.speech.computeState()).toEqual(service.computeState());
  h.panel.wiring.speech.checkGpuSetup();
  await vi.waitFor(() => {
    expect(service.checkGpu).toHaveBeenCalledOnce();
  });
});

it('CoreMlCompute: wires the host GPU offer, the CoreML worker and the explicit check into speech (#42)', async () => {
  const check = vi.fn().mockResolvedValue({ phase: 'ready' });
  const createCoreMl = vi.fn();
  vi.mocked(coreMlCompute).mockReturnValueOnce({ gpu: true, speechOptions: { createCoreMl }, check });
  const h = activated();
  const service = last(fakes.made.speech);
  const host = vi.mocked(coreMlCompute).mock.calls.at(-1)?.[0];
  if (host === undefined) throw new Error('No CoreML host');
  expect(host).toMatchObject({ supported: true, platform: process.platform, arch: process.arch, runtimeDirectory: '/ext/dist/speech' });
  expect(host.installedModel).toBe(installedSpeechModel);
  expect(host.storageDirectory).toBe('/storage');
  expect(service.options.createCoreMl).toBe(createCoreMl);
  expect(h.panel.wiring.speech.gpuSupported()).toBe(true);
  h.panel.wiring.speech.checkGpuSetup();
  await vi.waitFor(() => {
    expect(check).toHaveBeenCalledOnce();
  });
});

it('awaits lifecycle retirement during deactivation', async () => {
  const h = activated();
  const service = last(fakes.made.speech);
  const stopped = Promise.withResolvers<void>();
  service.dispose.mockReturnValueOnce(stopped.promise);
  const completed = vi.fn();
  const deactivated = deactivate().then(completed);
  await Promise.resolve();
  expect(service.dispose).toHaveBeenCalledOnce();
  expect(completed).not.toHaveBeenCalled();
  stopped.resolve();
  await deactivated;
  expect(completed).toHaveBeenCalledOnce();
  for (const disposable of h.context.subscriptions) disposable.dispose();
  expect(service.dispose).toHaveBeenCalledOnce();
});

it('initializes the lifecycle from each saved compute mode', () => {
  fakes.settings.set('speech.computeMode', 'auto');
  activated();
  expect(last(fakes.made.speech).computeState().requestedMode).toBe('auto');
  fakes.settings.set('speech.computeMode', 'gpu');
  activated();
  expect(last(fakes.made.speech).computeState().requestedMode).toBe('gpu');
});

it('suppresses late compute notifications after shutdown', async () => {
  const h = activated();
  const service = last(fakes.made.speech);
  await deactivate();
  h.panel.showSpeechComputeState.mockClear();
  service.setComputeState({ requestedMode: 'cpu', actualBackend: 'none', gpuCheck: { phase: 'idle' } });
  expect(h.panel.showSpeechComputeState).not.toHaveBeenCalled();
});

it('waits for the previous speech service to retire before activating a replacement', async () => {
  activated();
  const old = last(fakes.made.speech);
  const retired = Promise.withResolvers<void>();
  old.dispose.mockReturnValueOnce(retired.promise);
  fakes.providerRegistered.mockClear();
  const next = activated();
  let ready = false;
  void next.api.ready.then(() => {
    ready = true;
  });
  await Promise.resolve();
  expect(old.dispose).toHaveBeenCalledOnce();
  expect(ready).toBe(false);
  expect(fakes.providerRegistered).not.toHaveBeenCalled();
  const nextSpeech = last(fakes.made.speech);
  const narration = next.controller.narration;
  const pendingSpeech = narration.speak('first request');
  expect(nextSpeech.speak).not.toHaveBeenCalled();
  retired.resolve();
  await next.api.ready;
  await pendingSpeech;
  expect(nextSpeech.speak).toHaveBeenCalledWith('first request', undefined);
  expect(fakes.providerRegistered).toHaveBeenCalled();
});

it('keeps the oldest retirement barrier across repeated replacement', async () => {
  activated();
  const first = last(fakes.made.speech);
  const retired = Promise.withResolvers<void>();
  first.dispose.mockReturnValueOnce(retired.promise);
  activated();
  const third = activated();
  let ready = false;
  void third.api.ready.then(() => {
    ready = true;
  });
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
  expect(ready).toBe(false);
  retired.resolve();
  await third.api.ready;
  expect(ready).toBe(true);
});

it('does not dispatch narration after shutdown during placement', async () => {
  const choice = Promise.withResolvers<'legacy'>();
  fakes.placementChoice = choice.promise;
  const h = activated();
  const service = last(fakes.made.speech);
  const queued = h.controller.narration.speak('pending');
  const queuedCue = h.controller.narration.attentionCue?.();
  const ready = h.controller.narration.ready?.();
  await deactivate();
  choice.resolve('legacy');
  await queued;
  await queuedCue;
  expect(service.attentionCue).not.toHaveBeenCalled();
  expect(await ready).toBe(false);
  expect(service.speak).not.toHaveBeenCalled();
});

it('does not start placement for a replacement already retired while waiting', async () => {
  const first = activated();
  await first.api.ready;
  const old = last(fakes.made.speech);
  const retired = Promise.withResolvers<void>();
  old.dispose.mockReturnValueOnce(retired.promise);
  fakes.placementChoose.mockClear();
  const second = activated();
  const third = activated();
  retired.resolve();
  await Promise.all([second.api.ready, third.api.ready]);
  expect(fakes.placementChoose).toHaveBeenCalledOnce();
});

it('creates the workspace session only after companion commit acknowledgement', async () => {
  const commit = Promise.withResolvers<unknown>();
  fakes.companionAvailable = true;
  fakes.placementCommit = commit.promise;
  const h = activated();
  await vi.waitFor(() => {
    expect(fakes.placementChoose).toHaveBeenCalled();
  });
  expect(fakes.session).toBeUndefined();
  commit.resolve(true);
  await h.api.ready;
  expect(fakes.session).toBeDefined();
});

it('does not create a workspace session after the window closes during commit', async () => {
  const commit = Promise.withResolvers<unknown>();
  fakes.companionAvailable = true;
  fakes.placementCommit = commit.promise;
  const h = activated();
  await vi.waitFor(() => {
    expect(fakes.placementChoose).toHaveBeenCalled();
  });
  for (const disposable of h.context.subscriptions) disposable.dispose();
  commit.resolve(true);
  await h.api.ready;
  expect(fakes.session).toBeUndefined();
  expect(fakes.providerRegistered).not.toHaveBeenCalled();
});

it('reports a failed commit without falling back or creating a session', async () => {
  const commit = Promise.withResolvers<unknown>();
  fakes.companionAvailable = true;
  fakes.placementCommit = commit.promise;
  const h = activated();
  await vi.waitFor(() => {
    expect(fakes.placementChoose).toHaveBeenCalled();
  });
  commit.resolve(false);
  await h.api.ready;
  expect(fakes.session).toBeUndefined();
  expect(fakes.providerRegistered).not.toHaveBeenCalled();
  expect(fakes.infos).toContain('AI Pair could not complete its local audio connection. Reload the window to reconnect.');
});

it('suppresses failed commit notifications after shutdown', async () => {
  const commit = Promise.withResolvers<unknown>();
  fakes.companionAvailable = true;
  fakes.placementCommit = commit.promise;
  const h = activated();
  await vi.waitFor(() => {
    expect(fakes.placementChoose).toHaveBeenCalled();
  });
  for (const disposable of h.context.subscriptions) disposable.dispose();
  fakes.infos.length = 0;
  commit.resolve(false);
  await h.api.ready;
  expect(fakes.infos).toEqual([]);
});

it('restores OpenRouter preferences and clears the selected pair when its credential changes', async () => {
  fakes.settings.set('speech.provider', 'openrouter');
  fakes.settings.set('speech.openRouterModel', 'model');
  fakes.settings.set('speech.openRouterVoice', 'voice');
  fakes.settings.set('speech.openRouterZdr', true);
  fakes.settings.set('speech.openRouterFormat', 'pcm');
  const h = activated();
  const wiring = h.panel.wiring.speech;
  expect(wiring.settings.get()).toMatchObject({
    provider: 'openrouter',
    openRouterModel: 'model',
    openRouterVoice: 'voice',
    openRouterZdr: true,
    openRouterFormat: 'pcm',
  });
  vi.mocked(vscode.window.showInputBox).mockResolvedValueOnce('secret');
  await wiring.openRouterKeySet();
  expect(h.context.secrets.store).toHaveBeenCalledWith('aiPair.openRouter.apiKey', 'secret');
  expect(wiring.settings.get()).toMatchObject({ openRouterModel: '', openRouterVoice: '' });
  await wiring.openRouterKeyRemove();
  expect(h.context.secrets.delete).toHaveBeenCalledWith('aiPair.openRouter.apiKey');
  fire('secrets', { key: 'aiPair.openRouter.apiKey' });
  await vi.waitFor(() => {
    expect(h.panel.showOpenRouterKeyStatus).toHaveBeenCalled();
  });
  wiring.openRouterKeyRefresh();
  expect(wiring.validOpenRouterVoice('model', 'voice')).toBe(false);
  expect(h.api).toBeDefined();
});

it('cancels legacy work when external OpenRouter settings change', async () => {
  fakes.settings.set('speech.provider', 'openrouter');
  fakes.settings.set('speech.openRouterModel', 'model');
  fakes.settings.set('speech.openRouterVoice', 'voice');
  const h = activated();
  await h.api.ready;
  const service = last(fakes.made.speech);
  fakes.settings.set('speech.openRouterZdr', true);
  changed('speech', 'speech.openRouterZdr');
  expect(service.cancel).toHaveBeenCalled();
  expect(h.panel.showOpenRouterCatalog).toHaveBeenCalledWith({ state: 'idle', verified: false, models: [] });
});

it('routes OpenRouter catalog, key failure, readiness and sanitized diagnostics', async () => {
  fakes.settings.set('speech.provider', 'openrouter');
  const h = activated();
  await h.api.ready;
  const wiring = h.panel.wiring.speech;
  expect(wiring.settings.get()).toMatchObject({ openRouterModel: '', openRouterVoice: '', openRouterZdr: false });
  h.context.secrets.get.mockRejectedValueOnce(new Error('private'));
  wiring.openRouterKeyRefresh();
  await vi.waitFor(() => {
    expect(h.panel.showOpenRouterKeyStatus).toHaveBeenCalledWith(false);
  });
  wiring.loadOpenRouterModels();
  await vi.waitFor(() => {
    expect(h.panel.showOpenRouterCatalog).toHaveBeenCalledWith(expect.objectContaining({ state: 'error' }));
  });
  const service = last(fakes.made.speech);
  service.options.openRouterDiagnostic?.('auth');
  expect(service.options.openRouterAllowed?.('model', 'voice')).toBe(true);
  expect(last(fakes.made.diagnostics).record).toHaveBeenCalledWith({
    kind: 'speech',
    event: 'narration',
    provider: 'openrouter',
    phase: 'failed',
    reason: 'auth',
  });
  await h.controller.narration.ready?.();
  const facts = vi.mocked(speechReady).mock.lastCall?.[0];
  if (facts === undefined) throw new Error('No readiness facts');
  await facts.key('openrouter');
  expect(facts.openRouterAllowed?.('model', 'voice')).toBe(true);
});

it('invalidates catalogs on policy changes, rejects stale key checks and reports current OpenRouter facts', async () => {
  fakes.settings.set('speech.provider', 'openrouter');
  const h = activated();
  await h.api.ready;
  const wiring = h.panel.wiring.speech;
  const pending = Promise.withResolvers<string | undefined>();
  h.context.secrets.get.mockReturnValueOnce(pending.promise);
  wiring.openRouterKeyRefresh();
  wiring.openRouterKeyRefresh();
  pending.reject(new Error('private'));
  await Promise.resolve();
  await Promise.resolve();
  wiring.settings.set({ enabled: true, provider: 'openrouter', voice: 'af_heart', speed: 1, elevenLabsVoice: '', elevenLabsSpeed: 1 });
  expect(wiring.readiness?.().voiceConfigured).toBe(false);
  wiring.settings.set({ ...wiring.settings.get(), openRouterZdr: true });
  expect(h.panel.showOpenRouterCatalog).toHaveBeenCalledWith({ state: 'idle', verified: false, models: [] });
  await vi.waitFor(() => {
    expect(fakes.updated).toContainEqual(['speech.openRouterZdr', true, 1]);
  });
  await h.panel.wiring.copyDiagnostics();
  const options = vi.mocked(collectDiagnostics).mock.lastCall?.[0];
  if (options === undefined) throw new Error('No diagnostics');
  await options.audio?.();
  fakes.settings.set('speech.openRouterModel', 'new-model');
  changed('speech', 'speech.openRouterModel');
});

it('retires both credential prompts and catalog requests when the legacy host closes', async () => {
  const h = activated();
  await h.api.ready;
  const credentials = fakes.made.credentials.slice(-2);
  const catalog = last(fakes.made.catalogs);
  for (const disposable of h.context.subscriptions) disposable.dispose();
  await deactivate();
  expect(credentials).toHaveLength(2);
  for (const credential of credentials) expect(credential.supersede).toHaveBeenCalled();
  expect(catalog.invalidate).toHaveBeenCalled();
  const previous = h.panel.showSpeechCatalog.mock.calls.length;
  catalog.publish({ voices: [], more: false, loading: false, error: false });
  expect(h.panel.showSpeechCatalog).toHaveBeenCalledTimes(previous);
});

function isOpenRouterAudioDecoder(value: unknown): value is import('../src/speech_types').OpenRouterAudioDecoder {
  return typeof value === 'object' && value !== null && 'admit' in value && typeof value.admit === 'function';
}

it('routes OpenRouter decoder admission through the legacy panel', async () => {
  const models = vi.spyOn(OpenRouterClient.prototype, 'models').mockImplementation(async function (
    this: object,
    zdr: boolean,
    signal: AbortSignal,
  ) {
    void zdr;
    void signal;
    const decoder: unknown = Reflect.get(this, 'decoder');
    if (!isOpenRouterAudioDecoder(decoder)) throw new Error('Missing decoder');
    await expect(decoder.admit(42, new AbortController().signal)).rejects.toThrow('Decoder unavailable');
    return [];
  });
  const h = activated();
  await h.api.ready;
  h.panel.wiring.speech.loadOpenRouterModels();
  await vi.waitFor(() => {
    expect(models).toHaveBeenCalledOnce();
  });
  models.mockRestore();
});

it('gives the OpenRouter client a callback that captures the current session cost', () => {
  const dispatch = vi.fn<() => ((cost: number | undefined) => void) | undefined>();
  costFake.capture.mockReturnValueOnce(dispatch);
  activated();
  const capture = costFake.captures.at(-1);
  if (capture === undefined) throw new Error('No cost capture callback');
  expect(capture()).toBe(dispatch);
  expect(costFake.capture).toHaveBeenCalledOnce();
});

it('notifies the speech owner when a current OpenRouter catalog arrives', async () => {
  const models = vi.spyOn(OpenRouterClient.prototype, 'models').mockResolvedValueOnce([]);
  const h = activated();
  const service = last(fakes.made.speech);
  h.panel.wiring.speech.loadOpenRouterModels();
  await vi.waitFor(() => {
    expect(service.openRouterCatalogChanged).toHaveBeenCalledOnce();
  });
  models.mockRestore();
});

it('defers OpenRouter secret notifications until legacy ownership is established', async () => {
  const choice = Promise.withResolvers<'legacy'>();
  fakes.placementChoice = choice.promise;
  const h = activated();
  const credential = last(fakes.made.credentials);
  fire('secrets', { key: 'aiPair.openRouter.apiKey' });
  expect(credential.invalidate).not.toHaveBeenCalled();
  choice.resolve('legacy');
  await h.api.ready;
  await vi.waitFor(() => {
    expect(credential.invalidate).toHaveBeenCalledOnce();
  });
});

it('ignores OpenRouter secret changes after legacy shutdown starts', async () => {
  const h = activated();
  await h.api.ready;
  const credential = last(fakes.made.credentials);
  await deactivate();
  fire('secrets', { key: 'aiPair.openRouter.apiKey' });
  expect(credential.invalidate).not.toHaveBeenCalled();
});

it('applies pending and external context changes immediately and forwards session identity', () => {
  const h = activated();
  const speech = last(fakes.made.speech);
  const seen: boolean[] = [];
  speech.configureNarrationContext.mockImplementation(() => {
    seen.push(h.panel.wiring.speech.settings.get().contextEnabled === true);
  });
  const initial = h.panel.wiring.speech.settings.get();
  h.panel.wiring.speech.settings.set({ ...initial, contextEnabled: true });
  h.panel.wiring.speech.settings.set({ ...initial, contextEnabled: false });
  expect(seen).toEqual([true, false]);
  h.panel.wiring.speech.narrationSession?.(9, true);
  expect(speech.setNarrationSession).toHaveBeenCalledWith(9, true);
  changed('speech');
  expect(seen).toEqual([true, false, false]);
});

it('handles context disposal rejection and reports it to deactivate', async () => {
  const h = activated();
  const service = last(fakes.made.speech);
  service.dispose.mockRejectedValueOnce(new Error('retirement failed'));
  for (const disposable of h.context.subscriptions) disposable.dispose();
  await expect(deactivate()).rejects.toThrow('retirement failed');
});
