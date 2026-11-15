import { randomUUID } from 'node:crypto';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  Bridge,
  Controller,
  isSavedSession,
  type DiagnosticEvent,
  type PanelEvent,
  type SavedSession,
  type NarrationPort,
} from '@ai-pair/core';
import { discoveryDir, LOCAL_AUDIO_VERSION, NAVIGATOR_COMMENTARY_SCHEMA, type NavigatorCommentary } from '@ai-pair/protocol';
import { playDemo } from './demo';
import { VsCodeEditor } from './editor';
import { Diagnostics } from './diagnostics';
import { collectDiagnostics } from './diagnostics_collector';
import { SpeechService, type SpeechAudioEvent, type SpeechOutput } from './speech_service';
import { speechReady } from './speech_readiness';
import { SpeechTempoClient } from './speech_tempo_client';
import { NativeOutputDriver, discoverOutputs } from './speech_native_output';
import { SpeechOutputRouter, type OutputDiscovery } from './speech_output_router';
import { SpeechCredentials } from './speech_credentials';
import { SpeechCatalog } from './speech_catalog';
import { SpeechOutputPreferences } from './speech_output_preferences';
import { ElevenLabsClient } from './speech_elevenlabs';
import { OpenRouterClient } from './speech_openrouter';
import { SessionSpeechCost } from './session_speech_cost';
import { createOpenRouterAudioDecoder } from './speech_decode_bridge';
import { OpenRouterCatalog } from './speech_openrouter_catalog';
import { installedSpeechModel, setupSpeech, speechModelStatus } from './speech_setup';
import { coreMlCompute } from './speech_coreml';
import { speechRuntimeAvailable } from './speech_runtime_status';
import { localSpeechPlatform } from './speech_platform';
import { speechListeningRate, type SpeechSettings } from './speech_types';
import type { SpeechState } from './panel_messages';
import type { OutsideChanges } from './outside';
import { watchOutside } from './outside_watch';
import { NarrationPanel } from './panel';
import { settingSpeed } from './panel_html';
import { claudeStarter, setUpAgent, writeLauncher } from './setup';
import { setTimings, timings, type Timings } from './timings';
import { Calibration } from './calibration';
import { builtInPassage, type Passage } from './passage';
import { PanelPlacement, type PanelOwner, type PanelPrepareFailure } from './panel_placement';
import { WorkspaceSession } from './workspace_session';
import { warnOldExtension } from './old_extension';

/** Values compiled into this running bundle, not the extension currently on disk. */
declare const AI_PAIR_VERSION: string;
declare const AI_PAIR_BUILD_ID: string;
declare const AI_PAIR_RELAY_HASH: string;

/** Where a session waits across a reload, in the workspace's storage (#25). */
const SAVED_SESSION = 'aiPair.session';
/** Where the session's panel history waits across a reload, next to the session. */
const SAVED_HISTORY = 'aiPair.history';
/** Whether Set Up Agent was offered once, in the global state. */
const OFFERED_SETUP = 'aiPair.offeredSetup';
/** The settings under `aiPair`, as `config().get` and `update` name them. */
const SPEED = 'speed';
const READING_SPEED = 'readingSpeed';
const CODE_PLAYBACK = 'codePlayback';
const TIMING = 'timing';
const AGENT_NAME = 'agentName';
const CONFIRM_COMMANDS = 'confirmCommands';
const CALIBRATION_PASSAGE = 'calibrationPassage';
/** Maximum wait for companion preparation before choosing a fallback. */
const COMPANION_PREPARE_TIMEOUT_MS = 1500;
/** Cold extension activation may load the companion bundle before command dispatch. */
const COMPANION_ACTIVATION_TIMEOUT_MS = 10_000;

/** The latest speech state, without narration text or audio bytes. */
export interface SpeechObservation {
  id: number;
  state: SpeechState;
  started: boolean;
  terminal?: 'ended' | 'failed';
  message?: string;
}

/** Returned from `activate`, for integration tests. */
export interface Api {
  controller: Controller;
  editor: VsCodeEditor;
  bridge: Bridge;
  outside: OutsideChanges;
  playDemo: () => Promise<void>;
  /** Runs the Settings preview through the normal speech service. */
  previewSpeech: () => Promise<void>;
  /** Reports whether the Pair webview is ready for live speech. */
  speechPageReady: () => boolean;
  /** Reports the latest state and whether that unit started playback. */
  speechStatus: () => SpeechObservation | undefined;
  launcher: string;
  ready: Promise<void>;
  /** The session as the workspace's storage holds it. */
  saved: () => SavedSession | undefined;
  /** What the panel was posted, as a view replays it. */
  history: () => readonly PanelEvent[];
  /** Sets the extension's own delays (timings.ts), for a test that cannot wait the shipped ones out. */
  setTimings: (overrides: Partial<Timings>) => void;
  /** Hands the panel a message as its page would post it: the webview's own handler, which checks each message. */
  panelMessage: (message: unknown) => void;
}

function config(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration('aiPair');
}

/** Returns whether `v` is an object, as a setting or stored value is read: JSON nobody has checked. */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Returns `v` if it is a string, else `undefined`. */
function stringOf(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

/** Returns whether `v` is a list of panel events, by their `type`; the storage is the window's own, so the check is shallow. */
function isPanelEvents(v: unknown): v is PanelEvent[] {
  return Array.isArray(v) && v.every((e: unknown) => isRecord(e) && typeof e.type === 'string');
}

/** Wraps `f` so that it runs the first time only. */
function once<T>(f: (arg: T) => void): (arg: T) => void {
  let done = false;
  return (arg) => {
    if (done) return;
    done = true;
    f(arg);
  };
}

/** The bundled runtime supports a local Linux x64 glibc or macOS extension host. */
function speechSupported(): boolean {
  if (vscode.env.remoteName !== undefined || vscode.env.uiKind !== vscode.UIKind.Desktop || !localSpeechPlatform().supported) {
    return false;
  }
  return true;
}

/** Offers local companion installation for a remote workspace. */
function showInstallCompanion(): void {
  void vscode.window
    .showInformationMessage(
      'Speech is unavailable in this remote workspace. Install the AI Pair Local Audio VSIX locally and reload the window.',
      'Install VSIX...',
    )
    .then((answer) => {
      if (answer === 'Install VSIX...') void vscode.commands.executeCommand('workbench.extensions.action.installVSIX');
    });
}

/** Waits for the active legacy speech service to retire during deactivation. */
let stopSpeech: (() => Promise<void>) | undefined;

/** Starts the extension: the controller, the editor, the panel, the bridge, and the commands; returns the API the integration test drives. */
export function activate(context: vscode.ExtensionContext): Api {
  const previousRetirement = stopSpeech?.() ?? Promise.resolve();
  void warnOldExtension();
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir();

  // Activation is a cycle: the editor and the panel call the controller, which drives them through
  // their ports, and the panel and the calibration call each other. The two made later are read only
  // from callbacks that run after activation returns.
  let controller: Controller;
  let calibration: Calibration;
  let speech: SpeechService;
  let speechObservation: SpeechObservation | undefined;
  let lastPlayback: import('@ai-pair/protocol').AudioDiagnostics['lastPlayback'] = 'unknown';
  let previewCapture = false;
  let previewSequence = 0;
  let previewId: number | undefined;
  let previewProvider: SpeechSettings['provider'] = 'kokoro';
  let catalogRequestActive = false;
  const localSpeechSupported = speechSupported();
  // specs/CoreMlCompute.tla, Init: the CoreML GPU path exists only on macOS arm64 (#42).
  const coreMl = coreMlCompute({
    supported: localSpeechSupported,
    platform: process.platform,
    arch: process.arch,
    runtimeDirectory: path.join(context.extensionPath, 'dist', 'speech'),
    storageDirectory: context.globalStorageUri.fsPath,
    installedModel: installedSpeechModel,
  });
  let runtimeSpeechSupported = false;
  let runtimeSpeechChecked = false;
  const cloudSupported = vscode.env.remoteName === undefined && vscode.env.uiKind === vscode.UIKind.Desktop;
  let keyStatusEpoch = 0;
  let keyConfigured: boolean | 'unknown' = 'unknown';
  let openRouterKeyConfigured: boolean | 'unknown' = 'unknown';
  let modelReady: boolean | 'unknown' = 'unknown';
  let modelGeneration = 0;
  let cloudVoiceInvalidated = false;
  let panel: NarrationPanel;
  const connectionEpoch = randomUUID();
  let selectedNarration: NarrationPort | undefined;
  let owner: PanelOwner | 'pending' = 'pending';
  let ownerReady: Promise<void>;
  let workspaceSession: WorkspaceSession | undefined;
  let shuttingDown = false;
  const sessionCost = new SessionSpeechCost((value) => {
    if (!shuttingDown) panel.showSpeechCost(value);
  });
  let catalog: SpeechCatalog;
  let openRouterCatalog: OpenRouterCatalog;
  let outputPreferences: SpeechOutputPreferences;
  let outputRouter: SpeechOutputRouter;
  let speechSettings: { get: () => SpeechSettings; set: (value: SpeechSettings) => void };
  let routeKnown = false;
  let routeGeneration = 0;
  function discoverSpeechOutputs(): Promise<OutputDiscovery> {
    return cloudSupported ? discoverOutputs() : Promise.resolve({ supported: false, devices: [], reason: 'unsupported' });
  }
  /** Projects existing local facts without initiating any capability checks. */
  function audioReadiness(): import('@ai-pair/protocol').AudioDiagnostics {
    const settings = speechSettings.get();
    const output = outputPreferences.choice().kind;
    const openRouterModel = settings.openRouterModel ?? '';
    const openRouterVoice = settings.openRouterVoice ?? '';
    return {
      enabled: settings.enabled,
      provider: settings.provider,
      keyConfigured: shuttingDown ? 'unknown' : settings.provider === 'openrouter' ? openRouterKeyConfigured : keyConfigured,
      voiceConfigured:
        settings.provider === 'openrouter'
          ? openRouterModel.trim() !== '' && openRouterCatalog.allows(openRouterModel, openRouterVoice)
          : (settings.provider === 'kokoro' ? settings.voice : settings.elevenLabsVoice).trim() !== '',
      output: output === 'native' ? 'override' : output,
      // The panel page is the default route, and the transport fact says
      // whether it is up; only a native device waits for discovery.
      routeAvailable: shuttingDown ? 'unknown' : output !== 'native' ? true : routeKnown ? outputPreferences.ready() : 'unknown',
      runtimeReady: shuttingDown ? 'unknown' : !localSpeechSupported ? false : runtimeSpeechChecked ? runtimeSpeechSupported : 'unknown',
      modelReady: shuttingDown ? 'unknown' : modelReady,
      lastPlayback,
    };
  }
  /** Publishes current facts only while the legacy host owns the panel. */
  function publishReadiness(): void {
    // specs/VoiceIndicator.tla, Observe: publish one coherent cached snapshot.
    if (!shuttingDown && owner === 'legacy') panel.showSpeechReadiness(audioReadiness());
  }
  async function discoverPreferenceOutputs(): Promise<OutputDiscovery> {
    const generation = ++routeGeneration;
    routeKnown = false;
    publishReadiness();
    const result = await discoverSpeechOutputs();
    if (!shuttingDown && generation === routeGeneration) routeKnown = true;
    return result;
  }
  function handleSpeechEvent(event: SpeechAudioEvent): void {
    const terminal = speech.audioEvent(event);
    if (terminal !== undefined) {
      outputRouter.browserRetired(event.id, event.pageId);
      if (speechObservation?.id === event.id) {
        speechObservation = { ...speechObservation, terminal };
        lastPlayback = terminal;
      }
      publishReadiness();
    }
  }
  let credentials: SpeechCredentials;
  let openRouterCredentials: SpeechCredentials;
  let openRouterKeyEpoch = 0;
  const diagnostics = new Diagnostics({ version: AI_PAIR_VERSION, build: AI_PAIR_BUILD_ID });
  function record(event: DiagnosticEvent): void {
    diagnostics.record(event);
  }
  const editor = new VsCodeEditor(
    root,
    config().get(AGENT_NAME, 'Agent'),
    () => controller,
    () => config().get<unknown>('showTerminalsAutomatically') === true,
    record,
  );
  const speed = {
    get: () => settingSpeed(config().get<unknown>(SPEED, 1)),
    set: (value: number) => {
      void config().update(SPEED, value, vscode.ConfigurationTarget.Global);
    },
  };
  const readingSpeed = {
    get: () => settingSpeed(config().get<unknown>(READING_SPEED, 1)),
    set: (value: number) => {
      void config().update(READING_SPEED, value, vscode.ConfigurationTarget.Global);
    },
  };
  const codePlayback = {
    get: (): import('@ai-pair/core').CodePlayback => {
      const value: unknown = config().get(CODE_PLAYBACK);
      return value === 'lines' || value === 'blocks' ? value : 'typing';
    },
    set: (value: import('@ai-pair/core').CodePlayback) => {
      void config().update(CODE_PLAYBACK, value, vscode.ConfigurationTarget.Global);
    },
  };
  const setupAbort = new AbortController();
  let computeGeneration = 0;
  let computeTail: Promise<void> = Promise.resolve();
  let computePending = false;
  let pendingSpeechSettings: SpeechSettings | undefined;
  let speechSaveGeneration = 0;
  let speechSaveTail: Promise<void> = Promise.resolve();
  function storedSpeechSettings(): SpeechSettings {
    const enabled: unknown = config().get('speech.enabled');
    const rawVoice: unknown = config().get('speech.voice');
    const rawSpeed: unknown = config().get('speech.speed');
    const voice = typeof rawVoice === 'string' ? rawVoice : 'af_heart';
    const speechRate = typeof rawSpeed === 'number' ? rawSpeed : 1;
    const choice = config().inspect<string>('speech.provider')?.globalValue;
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
      voice,
      speed: speechRate,
      provider: choice === 'elevenlabs' || choice === 'openrouter' ? choice : 'kokoro',
      elevenLabsVoice: !cloudVoiceInvalidated && typeof cloudVoice === 'string' ? cloudVoice : '',
      elevenLabsSpeed: typeof cloudSpeed === 'number' ? cloudSpeed : 1,
      ...(typeof openRouterModel === 'string' || typeof openRouterVoice === 'string' || openRouterZdr === true || choice === 'openrouter'
        ? {
            openRouterModel: typeof openRouterModel === 'string' ? openRouterModel : '',
            openRouterVoice: typeof openRouterVoice === 'string' ? openRouterVoice : '',
            openRouterZdr: openRouterZdr === true,
            openRouterFormat: openRouterFormat === 'pcm' ? 'pcm' : 'mp3',
          }
        : {}),
    };
  }
  let lastSpeechProvider = storedSpeechSettings().provider;
  let lastSpeechEnabled = storedSpeechSettings().enabled;
  let lastOpenRouterSettings = storedSpeechSettings();
  speechSettings = {
    get: (): SpeechSettings => pendingSpeechSettings ?? storedSpeechSettings(),
    set: (value: SpeechSettings): void => {
      const prior = speechSettings.get();
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
      // specs/ProviderChoice.tla, Select: use the latest choice before disk writes settle.
      const restoresVoice = cloudVoiceInvalidated && value.elevenLabsVoice !== '' && catalog.contains(value.elevenLabsVoice);
      const generation = ++speechSaveGeneration;
      pendingSpeechSettings = { ...value, listeningSpeed: speechListeningRate(value.listeningSpeed) };
      speech.configureNarrationContext();
      if (owner === 'legacy') speech.prepare();
      lastSpeechProvider = value.provider;
      lastSpeechEnabled = value.enabled;
      lastOpenRouterSettings = value;
      panel.showSpeechSettings(pendingSpeechSettings);
      publishReadiness();
      const saveOperation = speechSaveTail.then(async () => {
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
        for (const [key, setting] of updates) {
          await config().update(key, setting, vscode.ConfigurationTarget.Global);
        }
      });
      speechSaveTail = saveOperation.catch(() => {});
      void saveOperation.then(
        () => {
          // specs/ProviderChoice.tla, Success: an older write cannot replace a newer choice.
          if (generation !== speechSaveGeneration) return;
          pendingSpeechSettings = undefined;
          speech.configureNarrationContext();
          if (restoresVoice) cloudVoiceInvalidated = false;
          panel.showSpeechSettings(storedSpeechSettings());
          publishReadiness();
        },
        () => {
          // specs/ProviderChoice.tla, Failure: only the latest failed write rolls back.
          if (generation !== speechSaveGeneration) return;
          pendingSpeechSettings = undefined;
          speech.configureNarrationContext();
          speech.cancel();
          if (owner === 'legacy') speech.prepare();
          catalog.invalidate();
          const restored = storedSpeechSettings();
          lastSpeechProvider = restored.provider;
          lastSpeechEnabled = restored.enabled;
          lastOpenRouterSettings = restored;
          panel.showSpeechSettings(restored);
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
      keyStatusEpoch++;
      keyConfigured = 'unknown';
      publishReadiness();
      catalog.invalidate();
      speech.invalidateCloud();
      // specs/ProviderChoice.tla, KeyChange: a queued old voice cannot revive.
      cloudVoiceInvalidated = true;
      speechSettings.set({ ...speechSettings.get(), elevenLabsVoice: '' });
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
      speechSettings.set({ ...speechSettings.get(), openRouterModel: '', openRouterVoice: '' });
      publishReadiness();
    },
    'aiPair.openRouter.apiKey',
  );
  const openRouter = new OpenRouterClient(
    () => openRouterCredentials.read(),
    undefined,
    createOpenRouterAudioDecoder(() => panel),
    () => sessionCost.capture(),
  );
  openRouterCatalog = new OpenRouterCatalog(openRouter, (value) => {
    if (!shuttingDown) {
      if (value.state === 'ready') speech.openRouterCatalogChanged();
      panel.showOpenRouterCatalog(value);
      publishReadiness();
    }
  });
  function refreshOpenRouterKey(): void {
    const epoch = ++openRouterKeyEpoch;
    openRouterKeyConfigured = 'unknown';
    publishReadiness();
    void openRouterCredentials.hasKey().then(
      (hasKey) => {
        if (shuttingDown || epoch !== openRouterKeyEpoch) return;
        openRouterKeyConfigured = hasKey;
        panel.showOpenRouterKeyStatus(hasKey);
        publishReadiness();
      },
      () => {
        if (!shuttingDown && epoch === openRouterKeyEpoch) panel.showOpenRouterKeyStatus(false);
      },
    );
  }
  function refreshKey(): void {
    const epoch = ++keyStatusEpoch;
    keyConfigured = 'unknown';
    publishReadiness();
    void credentials.hasKey().then(
      (hasKey) => {
        if (!shuttingDown && epoch === keyStatusEpoch) {
          keyConfigured = hasKey;
          panel.showSpeechKeyStatus(hasKey);
          publishReadiness();
          diagnostics.record({
            kind: 'speech',
            event: 'capability',
            provider: 'elevenlabs',
            phase: cloudSupported && hasKey ? 'ready' : 'blocked',
            ...(!cloudSupported ? { reason: 'unsupported' as const } : !hasKey ? { reason: 'no_key' as const } : {}),
          });
        }
      },
      () => {
        if (!shuttingDown && epoch === keyStatusEpoch) {
          panel.showSpeechKeyStatus(false);
          publishReadiness();
        }
      },
    );
  }
  const replyBehavior = {
    get: () => (config().get<unknown>('replyBehavior') === 'finishAction' ? ('finishAction' as const) : ('interrupt' as const)),
    set: (value: 'interrupt' | 'finishAction') => {
      void config().update('replyBehavior', value, vscode.ConfigurationTarget.Global);
    },
  };
  const navigatorCommentary = {
    get: (): NavigatorCommentary => {
      const parsed = NAVIGATOR_COMMENTARY_SCHEMA.safeParse(config().get<unknown>('navigatorCommentary'));
      return parsed.success ? parsed.data : 'helpful';
    },
    set: (value: NavigatorCommentary) => {
      void config()
        .update('navigatorCommentary', value, vscode.ConfigurationTarget.Global)
        .then(undefined, () => {
          panel.showNavigatorCommentary(navigatorCommentary.get());
          void vscode.window.showErrorMessage('Could not save navigator commentary.');
        });
    },
  };
  const chatOrder = {
    get: () => (config().get<unknown>('chatOrder') === 'oldestFirst' ? ('oldestFirst' as const) : ('newestFirst' as const)),
    set: (value: 'newestFirst' | 'oldestFirst') => {
      void config().update('chatOrder', value, vscode.ConfigurationTarget.Global);
    },
  };
  const terminalSettings = {
    get: () => config().get<unknown>('showTerminalsAutomatically') === true,
    set: (value: boolean) => {
      void config().update('showTerminalsAutomatically', value, vscode.ConfigurationTarget.Global);
    },
  };
  const commandApprovalSound = {
    get: () => config().get<unknown>('commandApprovalSound') === true,
    set: (value: boolean) => {
      void config().update('commandApprovalSound', value, vscode.ConfigurationTarget.Global);
    },
  };
  // Frames and panel messages at the Trace level, which VS Code hides unless it is set, and resets
  // when the extension is reinstalled; with `aiPair.trace`, at Info, which it shows (#27).
  const log = vscode.window.createOutputChannel('AI Pair', { log: true });
  function trace(line: string): void {
    if (config().get('trace', false)) {
      log.info(line);
    } else {
      log.trace(line);
    }
  }
  const launcher = writeLauncher(context.extensionPath);
  const starter = claudeStarter(launcher);
  /** Checks the installed model while ignoring superseded or disposed results. */
  async function checkedModel(): Promise<boolean> {
    const generation = ++modelGeneration;
    modelReady = 'unknown';
    publishReadiness();
    const available = (await installedSpeechModel(context.globalStorageUri.fsPath)) !== undefined;
    if (!shuttingDown && generation === modelGeneration) {
      modelReady = available;
      publishReadiness();
    }
    return available;
  }
  /** Collects the same bounded facts for the clipboard and authenticated agents. */
  function diagnosticSnapshot(): Promise<import('@ai-pair/protocol').DiagnosticSnapshot> {
    return collectDiagnostics({
      snapshot: () => {
        const snapshot = diagnostics.snapshot();
        // specs/DiagnosticsRequest.tla: observe current state without changing the session.
        const session = controller.isSuspended
          ? 'suspended'
          : controller.isActive
            ? 'active'
            : snapshot.session === 'ended'
              ? 'ended'
              : 'idle';
        return { ...snapshot, session };
      },
      companion: owner === 'companion',
      timeoutMs: COMPANION_PREPARE_TIMEOUT_MS,
      command: (name) =>
        vscode.commands.executeCommand(
          name === 'speech'
            ? 'aiPair.localAudio.diagnostics'
            : name === 'gpu'
              ? 'aiPair.localAudio.gpuDiagnostics'
              : 'aiPair.localAudio.audioDiagnostics',
        ),
      audio: async () => {
        if (owner !== 'legacy') return undefined;
        const hasKey = await (speechSettings.get().provider === 'openrouter' ? openRouterCredentials : credentials).hasKey();
        return { ...audioReadiness(), keyConfigured: hasKey };
      },
    });
  }

  /** Copies the bounded diagnostic snapshot. */
  async function copyDiagnostics(): Promise<void> {
    await vscode.env.clipboard.writeText(JSON.stringify(await diagnosticSnapshot()));
  }

  /** Reports clipboard failures when no panel is available to show them. */
  async function copyDiagnosticsFromCommand(): Promise<void> {
    try {
      await copyDiagnostics();
    } catch {
      void vscode.window.showErrorMessage('AI Pair could not copy diagnostics to the clipboard.');
    }
  }

  panel = new NarrationPanel(
    (file) => editor.resolvePath(file),
    speed,
    readingSpeed,
    {
      current: () => editor.programmerSelection(),
      ref: () => editor.selectionRef(),
    },
    trace,
    context.extensionUri,
    {
      controller: () => controller,
      calibration: () => calibration,
      starter,
      copyDiagnostics,
      requireCommandApproval: () => Promise.resolve(config().update(CONFIRM_COMMANDS, true, vscode.ConfigurationTarget.Global)),
      speech: {
        sessionCost,
        narrationSession: (id, ongoing) => {
          speech.setNarrationSession(id, ongoing);
        },
        readiness: audioReadiness,
        computeState: () => speech.computeState(),
        computeMode: (value) => {
          speech.selectComputeMode(value);
          const current = ++computeGeneration;
          computePending = true;
          const computeSave = computeTail.then(() => config().update('speech.computeMode', value, vscode.ConfigurationTarget.Global));
          computeTail = computeSave.catch(() => {});
          void computeSave.then(
            () => {
              if (current === computeGeneration) computePending = false;
            },
            () => {
              if (current !== computeGeneration) return;
              computePending = false;
              const stored: unknown = config().get('speech.computeMode');
              const restored = stored === 'auto' || stored === 'gpu' ? stored : 'cpu';
              speech.selectComputeMode(restored);
              void vscode.window.showErrorMessage('Could not save speech compute mode.');
            },
          );
        },
        checkGpuSetup: () => {
          void speech.checkGpu(coreMl.check, setupAbort.signal);
        },
        outputView: () => outputPreferences.view(),
        outputReady: () => outputPreferences.ready(),
        outputRetired: (id, pageId) => {
          outputRouter.browserRetired(id, pageId);
        },
        outputPageRetired: (pageId) => {
          outputRouter.pageClosed(pageId);
        },
        outputRefresh: () => {
          void outputPreferences.refresh();
        },
        outputSelect: (choice) => {
          void outputPreferences.choose(choice);
        },
        settings: speechSettings,
        diagnostic: (event) => {
          diagnostics.record(event);
        },
        cloudSupported: () => cloudSupported,
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
          void openRouterCatalog.load(speechSettings.get().openRouterZdr === true);
        },
        validOpenRouterVoice: (model, voice) => openRouterCatalog.contains(model, voice),
        loadVoices: (more) => {
          void catalog.load(more);
        },
        validCloudVoice: (id) => catalog.contains(id),
        supported: () => localSpeechSupported && runtimeSpeechSupported,
        gpuSupported: () => coreMl.gpu,
        installed: async () => {
          const available = await checkedModel();
          diagnostics.record({
            kind: 'speech',
            event: 'setup',
            provider: 'kokoro',
            phase: available ? 'ready' : 'blocked',
            ...(available ? {} : { reason: 'not_ready' as const }),
          });
          return available;
        },
        modelStatus: async () => {
          const generation = ++modelGeneration;
          modelReady = 'unknown';
          publishReadiness();
          const status = await speechModelStatus(context.globalStorageUri.fsPath);
          if (!shuttingDown && generation === modelGeneration) {
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
          previewProvider = speechSettings.get().provider;
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
        event: handleSpeechEvent,
        pageClosed: (pageId) => {
          speech.pageClosed(pageId);
          catalog.invalidate();
          openRouterCatalog.invalidate();
        },
      },
    },
    chatOrder,
    { version: AI_PAIR_VERSION, build: AI_PAIR_BUILD_ID },
    terminalSettings,
    (id) => editor.showTerminal(id),
    codePlayback,
    replyBehavior,
    commandApprovalSound,
    navigatorCommentary,
  );
  outputPreferences = new SpeechOutputPreferences({
    initial: context.globalState.get<unknown>('speechOutput'),
    write: async (choice) => {
      await context.globalState.update('speechOutput', choice);
    },
    stop: () => {
      speech.cancel();
      outputRouter.invalidate();
    },
    changed: (value) => {
      panel.showSpeechOutputCatalog(value);
      publishReadiness();
    },
    discover: discoverPreferenceOutputs,
  });
  catalog = new SpeechCatalog(cloud, (value) => {
    if (shuttingDown) return;
    if (value.reset) catalogRequestActive = false;
    else if (value.loading) catalogRequestActive = true;
    else if (catalogRequestActive) {
      catalogRequestActive = false;
      diagnostics.record({
        kind: 'speech',
        event: 'catalog',
        provider: 'elevenlabs',
        phase: value.error ? 'failed' : 'ready',
        ...(value.error ? { reason: value.errorKind ?? 'unknown' } : value.voices.length === 0 ? { reason: 'no_voice' } : {}),
      });
    }
    panel.showSpeechCatalog(value);
  });
  void speechRuntimeAvailable(path.join(context.extensionPath, 'dist', 'speech')).then((available) => {
    if (shuttingDown) return;
    runtimeSpeechSupported = available;
    runtimeSpeechChecked = true;
    diagnostics.record({
      kind: 'speech',
      event: 'capability',
      provider: 'kokoro',
      phase: localSpeechSupported && available ? 'ready' : 'blocked',
      ...(!localSpeechSupported ? { reason: 'unsupported' as const } : !available ? { reason: 'not_ready' as const } : {}),
    });
    panel.refreshSpeechSupport();
    publishReadiness();
  });
  const defaultOutput: SpeechOutput = {
    localDiagnostic: (phase, reason) => {
      diagnostics.record({ kind: 'speech', event: 'runtime', provider: 'kokoro', phase, ...(reason === undefined ? {} : { reason }) });
    },
    play: (id, wav, durationMs) => panel.playSpeech(id, wav, durationMs),
    control: (id, pageId, action) => {
      panel.controlSpeech(id, pageId, action);
    },
    status: (id, state, message) => {
      if (previewCapture) previewId = id;
      if (id === previewId && (state === 'speaking' || state === 'unavailable')) {
        diagnostics.record({
          kind: 'speech',
          event: 'preview',
          provider: previewProvider,
          phase: state === 'speaking' ? 'ready' : 'failed',
          ...(state === 'unavailable' ? { reason: 'unknown' as const } : {}),
        });
      }
      const started = state === 'speaking' || (speechObservation?.id === id && speechObservation.started);
      speechObservation = { id, state, started, ...(message === undefined ? {} : { message }) };
      if (state === 'unavailable') lastPlayback = 'failed';
      else if (state === 'speaking') lastPlayback = 'unknown';
      panel.showSpeechStatus(id, state, message);
      publishReadiness();
    },
  };
  const nativeOutput = new NativeOutputDriver();
  outputRouter = new SpeechOutputRouter({
    driver: nativeOutput,
    discover: discoverSpeechOutputs,
    choice: () => outputPreferences.choice(),
    defaultOutput,
    currentPage: () => panel.speechReadyPageId(),
    audioEvent: handleSpeechEvent,
  });
  speech = new SpeechService({
    openRouterDiagnostic: (reason) => {
      diagnostics.record({ kind: 'speech', event: 'narration', provider: 'openrouter', phase: 'failed', reason });
    },
    cloudDiagnostic: (reason) => {
      diagnostics.record({ kind: 'speech', event: 'narration', provider: 'elevenlabs', phase: 'failed', reason });
    },
    runtimeDirectory: path.join(context.extensionPath, 'dist', 'speech'),
    tempo: new SpeechTempoClient(path.join(context.extensionPath, 'dist', 'speech', 'tempo_worker.mjs')),
    cloud,
    openRouter,
    openRouterAllowed: (model, voice) => openRouterCatalog.allows(model, voice),
    storageDirectory: context.globalStorageUri.fsPath,
    localDesktop: cloudSupported,
    kokoroSupported: localSpeechSupported,
    settings: speechSettings.get,
    computeMode: () => {
      const value: unknown = config().get('speech.computeMode');
      return value === 'gpu' || value === 'auto' ? value : 'cpu';
    },
    computeChanged: (value) => {
      if (!shuttingDown) panel.showSpeechComputeState(value);
    },
    ...coreMl.speechOptions,
    output: outputRouter,
  });
  let speechRetirement: Promise<void> | undefined;
  function retireSpeech(): Promise<void> {
    shuttingDown = true;
    setupAbort.abort();
    if (speechRetirement === undefined) {
      credentials.supersede();
      openRouterCredentials.supersede();
      catalog.invalidate();
      openRouterCatalog.invalidate();
    }
    speechRetirement ??= Promise.all([previousRetirement, speech.dispose()]).then(() => {});
    return speechRetirement;
  }
  stopSpeech = retireSpeech;
  let narrationGeneration = 0;
  const narration: NarrationPort = {
    ready: async () => {
      await ownerReady;
      if (owner === 'companion') {
        const ready: unknown = await vscode.commands.executeCommand('aiPair.localAudio.ready', connectionEpoch);
        return ready === true && owner === 'companion' && workspaceSession?.pageReady() === true;
      }
      if (owner !== 'legacy') return false;
      return speechReady({
        settings: speechSettings.get,
        desktop: () => cloudSupported && owner === 'legacy',
        local: () => localSpeechSupported && runtimeSpeechSupported,
        output: () => panel.speechPageIsReady() && nativeOutput.available() && outputPreferences.ready(),
        model: checkedModel,
        key: (provider) => (provider === 'openrouter' ? openRouterCredentials.hasKey() : credentials.hasKey()),
        openRouterAllowed: (model, voice) => openRouterCatalog.allows(model, voice),
      });
    },
    speak: async (text, delivery) => {
      const generation = narrationGeneration;
      await ownerReady;
      if (!shuttingDown && generation === narrationGeneration) await selectedNarration?.speak(text, delivery);
    },
    attentionCue: async () => {
      const generation = narrationGeneration;
      await ownerReady;
      if (!shuttingDown && generation === narrationGeneration) await selectedNarration?.attentionCue();
    },
    waitForRetirement: async (signal) => {
      const generation = narrationGeneration;
      await ownerReady;
      if (shuttingDown || generation !== narrationGeneration || signal.aborted) return false;
      if (owner === 'legacy' && !speechSettings.get().enabled) return false;
      const selected = selectedNarration;
      const ready = (await selected?.waitForRetirement?.(signal)) ?? true;
      const current = !shuttingDown && generation === narrationGeneration && selected === selectedNarration && !signal.aborted;
      if (!ready && current) void vscode.window.showWarningMessage('Speech is still finishing. This message will be shown without audio.');
      return ready && current;
    },
    pause: () => {
      selectedNarration?.pause();
    },
    resume: () => {
      selectedNarration?.resume();
    },
    cancel: () => {
      narrationGeneration++;
      selectedNarration?.cancel();
    },
  };
  controller = new Controller(editor, panel, undefined, narration);
  controller.onDiagnostic = record;
  controller.trace = (line) => {
    log.info(line);
  };
  editor.onSelection = (ref) => {
    panel.showSelection(ref);
  };
  controller.setSpeed(speed.get());
  controller.setReadingSpeed(readingSpeed.get());
  controller.setCodePlayback(codePlayback.get());
  controller.setNavigatorCommentary(navigatorCommentary.get());
  controller.setTiming(config().get(TIMING));
  controller.setConfirmCommands(config().get(CONFIRM_COMMANDS, true));
  // The passage the programmer or the agent chose, from the settings, or the built-in one (#109).
  function passage(): Passage {
    const chosen: unknown = config().get(CALIBRATION_PASSAGE);
    if (!isRecord(chosen)) return builtInPassage(context.extensionPath);
    const text = stringOf(chosen.text);
    if (text === undefined || text.trim() === '') return builtInPassage(context.extensionPath);
    const notice = stringOf(chosen.notice);
    return {
      title: stringOf(chosen.title) ?? 'Your passage',
      text,
      ...(notice === undefined ? {} : { notice }),
    };
  }
  calibration = new Calibration(
    {
      now: () => Date.now(),
      pause: () => {
        controller.pause('calibrate');
      },
      resume: () => {
        controller.resume('calibrate');
      },
      // The pause ends only once the player reads the new rate: AwaitStore in specs/Calibration.tla, and
      // setTiming below is `ApplyRate`.
      store: async (msPerChar) => {
        const timing: unknown = config().get(TIMING);
        const kept = isRecord(timing) ? timing : {};
        const reading = isRecord(kept.reading) ? kept.reading : {};
        await config().update(TIMING, { ...kept, reading: { ...reading, msPerChar } }, vscode.ConfigurationTarget.Global);
        controller.setTiming(config().get(TIMING));
      },
      show: (view) => {
        panel.showCalibration(view);
      },
    },
    passage(),
  );
  const { outside, disposable: outsideWatch } = watchOutside(controller, editor, panel);
  // A session survives a reload in the workspace's storage, suspended until its agent's `start` (#25,
  // specs/Resume.tla, `ReloadWindow`): saved shortly after each change, and once more as the window goes (`Store`).
  const stored: unknown = context.workspaceState.get(SAVED_SESSION);
  const saved = isSavedSession(stored) ? stored : undefined;
  if (saved) {
    const history: unknown = context.workspaceState.get(SAVED_HISTORY);
    panel.restoreHistory(isPanelEvents(history) ? history : []);
    controller.revive(saved);
  }
  let saving: ReturnType<typeof setTimeout> | undefined;
  function save(): void {
    clearTimeout(saving);
    const session = controller.saved;
    void context.workspaceState.update(SAVED_SESSION, session);
    void context.workspaceState.update(SAVED_HISTORY, session ? panel.history : undefined);
  }
  controller.onChange = panel.onPost = () => {
    clearTimeout(saving);
    saving = setTimeout(save, timings.saveMs);
  };

  const bridge = new Bridge(controller, {
    onDiagnostic: record,
    collectDiagnostics: diagnosticSnapshot,
    runtime: { version: AI_PAIR_VERSION, build: AI_PAIR_BUILD_ID, relayHash: AI_PAIR_RELAY_HASH },
    dir: discoveryDir(),
    workspaceFolders: () => (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath),
    trace,
    // Once: it would fail again on every focus.
    failed: once((e) => {
      void vscode.window.showErrorMessage(`AI Pair couldn't write its discovery file, so agents won't find this window: ${String(e)}`);
    }),
    calibrate: (chosen) => {
      if (!calibration.arm(chosen)) return false;
      void config().update(CALIBRATION_PASSAGE, chosen, vscode.ConfigurationTarget.Global);
      return true;
    },
  });
  const bridgeReady = bridge.start();
  bridgeReady.catch((error: unknown) => {
    void vscode.window.showErrorMessage(`AI Pair couldn't start its local server: ${String(error)}`);
  });
  // Set Up Agent may have set Claude Code up: the idle view's button is offered again (specs/Start.tla, `FlipSetUp`).
  function setUp(): Promise<void> {
    return setUpAgent(launcher).then(() => {
      panel.askStart();
    });
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('aiPair.copyDiagnostics', copyDiagnosticsFromCommand),
    context.secrets.onDidChange((event) => {
      if (event.key === 'aiPair.openRouter.apiKey') {
        function refreshLegacyOpenRouter(): void {
          if (owner !== 'legacy' || shuttingDown) return;
          openRouterCredentials.invalidate();
          refreshOpenRouterKey();
        }
        if (owner === 'pending') void ownerReady.then(refreshLegacyOpenRouter);
        else refreshLegacyOpenRouter();
        return;
      }
      if (event.key !== 'aiPair.elevenLabs.apiKey') return;
      function refreshLegacy(): void {
        if (owner !== 'legacy') return;
        credentials.invalidate();
        refreshKey();
      }
      if (owner === 'pending') void ownerReady.then(refreshLegacy);
      else refreshLegacy();
    }),
    vscode.commands.registerCommand('aiPair.setElevenLabsKey', async () => {
      await ownerReady;
      try {
        if (owner === 'companion') await vscode.commands.executeCommand('aiPair.localAudio.keySet');
        else if (owner === 'legacy') {
          await credentials.set();
          refreshKey();
        } else showInstallCompanion();
      } catch {
        void vscode.window.showErrorMessage('Could not save the ElevenLabs API key.');
      }
    }),
    vscode.commands.registerCommand('aiPair.removeElevenLabsKey', async () => {
      await ownerReady;
      try {
        if (owner === 'companion') await vscode.commands.executeCommand('aiPair.localAudio.keyRemove');
        else if (owner === 'legacy') {
          await credentials.remove();
          refreshKey();
        } else showInstallCompanion();
      } catch {
        void vscode.window.showErrorMessage('Could not remove the ElevenLabs API key.');
      }
    }),
    vscode.commands.registerCommand('aiPair.localAudio.workspace', (value: unknown) => workspaceSession?.accept(value) ?? false),
    log,
    starter,
    outsideWatch,
    {
      dispose: () => {
        bridge.dispose();
      },
    },
    vscode.window.onDidChangeWindowState((state) => {
      if (state.focused) bridge.focused();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      bridge.writeDiscovery();
    }),
    vscode.commands.registerCommand('aiPair.setUpAgent', setUp),
    editor,
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('aiPair.speech')) {
        if (!computePending) {
          const mode: unknown = config().get('speech.computeMode');
          const next = mode === 'auto' || mode === 'gpu' ? mode : 'cpu';
          if (next !== speech.computeState().requestedMode) {
            speech.selectComputeMode(next);
          }
        }
        const current = speechSettings.get();
        speech.configureNarrationContext();
        // specs/ProviderChoice.tla, External: persistence echoes cannot undo a pending choice.
        if (pendingSpeechSettings === undefined) {
          if ((lastSpeechEnabled && !current.enabled) || current.provider !== lastSpeechProvider) speech.cancel();
          if (current.provider !== lastSpeechProvider) {
            credentials.supersede();
            catalog.invalidate();
            openRouterCredentials.supersede();
            openRouterCatalog.invalidate();
          }
          if (
            current.openRouterModel !== lastOpenRouterSettings.openRouterModel ||
            current.openRouterVoice !== lastOpenRouterSettings.openRouterVoice ||
            current.openRouterZdr !== lastOpenRouterSettings.openRouterZdr ||
            current.openRouterFormat !== lastOpenRouterSettings.openRouterFormat
          ) {
            speech.cancel();
            if (current.openRouterZdr !== lastOpenRouterSettings.openRouterZdr) openRouterCatalog.invalidate();
          }
          lastOpenRouterSettings = current;
          lastSpeechProvider = current.provider;
          lastSpeechEnabled = current.enabled;
        }
        if (owner === 'legacy') speech.prepare();
        panel.showSpeechSettings(current);
        publishReadiness();
      }
      if (e.affectsConfiguration('aiPair.replyBehavior')) panel.showReplyBehavior(replyBehavior.get());
      if (e.affectsConfiguration('aiPair.navigatorCommentary')) {
        const value = navigatorCommentary.get();
        controller.setNavigatorCommentary(value);
        panel.showNavigatorCommentary(value);
      }
      if (e.affectsConfiguration('aiPair.chatOrder')) panel.showChatOrder(chatOrder.get());
      if (e.affectsConfiguration('aiPair.showTerminalsAutomatically')) panel.showTerminalPreference(terminalSettings.get());
      if (e.affectsConfiguration('aiPair.commandApprovalSound')) panel.showCommandApprovalSound(commandApprovalSound.get());
      if (e.affectsConfiguration('aiPair.speed')) {
        controller.setSpeed(speed.get());
        panel.showSpeed(speed.get());
      }
      if (e.affectsConfiguration('aiPair.codePlayback')) {
        controller.setCodePlayback(codePlayback.get());
        panel.showCodePlayback(codePlayback.get());
      }
      if (e.affectsConfiguration('aiPair.readingSpeed')) {
        controller.setReadingSpeed(readingSpeed.get());
        panel.showReadingSpeed(readingSpeed.get());
      }
      if (e.affectsConfiguration('aiPair.timing')) controller.setTiming(config().get(TIMING));
      if (e.affectsConfiguration('aiPair.agentName')) editor.setAgentName(config().get(AGENT_NAME, 'Agent'));
      if (e.affectsConfiguration('aiPair.confirmCommands')) {
        controller.setConfirmCommands(config().get(CONFIRM_COMMANDS, true));
        panel.showCommandApprovals();
      }
    }),
    vscode.commands.registerCommand('aiPair.playDemo', () => {
      if ((vscode.workspace.workspaceFolders?.length ?? 0) === 0) {
        void vscode.window.showErrorMessage('Open a folder first: the demo creates files in ai-pair-demo/.');
        return;
      }
      void playDemo(controller, root);
    }),
    vscode.commands.registerCommand('aiPair.togglePause', () => {
      if (!controller.isActive) return;
      if (controller.isPaused) {
        controller.resume();
      } else {
        controller.pause();
      }
    }),
    vscode.commands.registerCommand('aiPair.toggleAttention', () => {
      if (!controller.isActive) return;
      if (controller.isAttentionGranted) panel.focusReply();
      else controller.requestAttention();
    }),
    vscode.commands.registerCommand('aiPair.configureShortcuts', () =>
      vscode.commands.executeCommand('workbench.action.openGlobalKeybindings', '@ext:mattyv.ai-pair'),
    ),
    vscode.commands.registerCommand('aiPair.interrupt', () => {
      controller.userInterrupt();
    }),
    vscode.commands.registerCommand('aiPair.toggleTurn', () => {
      if (controller.turn === 'programmer') {
        controller.handBack();
      } else {
        controller.takeTurn();
      }
    }),
    vscode.commands.registerCommand('aiPair.endSession', () => {
      controller.endSession();
    }),
    vscode.commands.registerCommand('aiPair.focusReply', () => {
      if (!controller.isActive) return;
      panel.focusReply();
    }),
    vscode.commands.registerCommand('aiPair.askAboutSelection', () => {
      panel.focusReply();
    }),
    vscode.commands.registerCommand('aiPair.calibrate', () => {
      if (calibration.arm(passage())) {
        panel.focusReply();
      } else {
        void vscode.window.showInformationMessage('AI Pair: a calibration is already under way in the Pair panel.');
      }
    }),
    {
      dispose: () => {
        controller.disconnect();
      },
    },
    { dispose: save },
    {
      dispose: () => {
        void retireSpeech().catch(() => {});
      },
    },
  );
  let prepareFailure: PanelPrepareFailure | undefined;
  const companion = vscode.extensions.getExtension('mattyv.ai-pair-local-audio');
  const placement = new PanelPlacement({
    epoch: connectionEpoch,
    remote: vscode.env.remoteName !== undefined,
    companionInstalled: companion !== undefined,
    timeoutMs: COMPANION_PREPARE_TIMEOUT_MS,
    activationTimeoutMs: COMPANION_ACTIVATION_TIMEOUT_MS,
    activate:
      companion === undefined
        ? undefined
        : async () => {
            const started = Date.now();
            try {
              return await vscode.commands.executeCommand('aiPair.localAudio.activate');
            } finally {
              log.info(`Local Audio activation completed in ${Date.now() - started} ms`);
            }
          },
    prepare: async () => {
      const started = Date.now();
      try {
        return await vscode.commands.executeCommand('aiPair.localAudio.prepare', { version: LOCAL_AUDIO_VERSION, epoch: connectionEpoch });
      } finally {
        log.info(`Local Audio prepare command completed in ${Date.now() - started} ms`);
      }
    },
    failure: (reason) => {
      prepareFailure = reason;
      if (vscode.extensions.getExtension('mattyv.ai-pair-local-audio') !== undefined) {
        log.info(`Local Audio preparation failed: ${reason}`);
      }
    },
    beforeCommit: () => {
      owner = 'companion';
      if (shuttingDown) throw new Error('Window is closing.');
    },
    afterCommit: () => {
      if (shuttingDown) return;
      workspaceSession = new WorkspaceSession({
        epoch: connectionEpoch,
        panel,
        send: async (frame) => {
          const accepted: unknown = await vscode.commands.executeCommand('aiPair.localAudio.frame', frame);
          if (accepted !== true) throw new Error('Companion frame was not accepted.');
        },
        lost: () => {
          void vscode.window.showWarningMessage('AI Pair lost its local audio connection. Reload the window to reconnect.');
        },
        unavailable: () => {
          void vscode.window.showWarningMessage('A Pair panel update was too large or unavailable; later updates will continue.');
        },
      });
      selectedNarration = workspaceSession.narration;
      context.subscriptions.push(workspaceSession);
    },
    commitFailed: () => {
      if (!shuttingDown) {
        void vscode.window.showWarningMessage('AI Pair could not complete its local audio connection. Reload the window to reconnect.');
      }
    },
    commit: (prepared) => Promise.resolve(vscode.commands.executeCommand('aiPair.localAudio.commit', prepared)),
  });
  // specs/SpeechLifecycle.tla, Reap: replacement ownership waits for prior resource exit.
  ownerReady = previousRetirement
    .then(() => (shuttingDown ? undefined : placement.choose()))
    .then((chosen) => {
      if (chosen === undefined || shuttingDown) return;
      owner = chosen;
      if (chosen === 'companion') return;
      if (chosen === 'incompatible') {
        const detail: Record<PanelPrepareFailure, string> = {
          timeout: 'The Local Audio extension did not respond in time.',
          activation_failure: 'The Local Audio extension could not be started.',
          activation_timeout: 'The Local Audio extension did not start in time.',
          invalid_response: 'The Local Audio extension sent an invalid response.',
          protocol_mismatch: 'The extensions use incompatible protocol versions.',
          epoch_mismatch: 'The Local Audio extension returned an unexpected session.',
        };
        void vscode.window
          .showWarningMessage(
            prepareFailure === undefined
              ? 'AI Pair and AI Pair Local Audio could not connect. Update both extensions and reload the window.'
              : `AI Pair and AI Pair Local Audio could not connect. ${detail[prepareFailure]} See the AI Pair output for details.`,
            'Copy diagnostics',
            'Show output',
          )
          .then((action) => {
            if (action === 'Copy diagnostics') void copyDiagnosticsFromCommand();
            else if (action === 'Show output') log.show();
          });
        return;
      }
      panel.showSpeechTransport(chosen === 'legacy');
      if (chosen === 'legacy') {
        selectedNarration = speech;
        speech.prepare();
        publishReadiness();
        // specs/OutputPreference.tla, Init: restore a saved device without opening Settings.
        if (outputPreferences.choice().kind === 'native') void outputPreferences.refresh();
      }
      context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(NarrationPanel.viewId, panel, {
          webviewOptions: { retainContextWhenHidden: true },
        }),
      );
      if (chosen === 'remote-text') showInstallCompanion();
    });
  const ready = Promise.all([bridgeReady, ownerReady]).then(() => {});
  if (context.globalState.get<unknown>(OFFERED_SETUP) !== true) {
    void context.globalState.update(OFFERED_SETUP, true);
    void vscode.window.showInformationMessage('AI Pair is installed. Connect it to your agent?', 'Set Up Agent').then((answer) => {
      if (answer) void setUp();
    });
  }

  return {
    controller,
    editor,
    bridge,
    outside,
    playDemo: () => playDemo(controller, root),
    previewSpeech: async () => {
      await ownerReady;
      if (owner === 'companion') await vscode.commands.executeCommand('aiPair.localAudio.preview');
      else if (owner === 'legacy') await speech.preview();
      else showInstallCompanion();
    },
    speechPageReady: () =>
      owner === 'companion' ? workspaceSession?.pageReady() === true : owner === 'legacy' && panel.speechPageIsReady(),
    speechStatus: () => (owner !== 'legacy' || speechObservation === undefined ? undefined : { ...speechObservation }),
    launcher,
    ready,
    saved: () => {
      const kept: unknown = context.workspaceState.get(SAVED_SESSION);
      return isSavedSession(kept) ? kept : undefined;
    },
    history: () => panel.history,
    setTimings: (overrides) => {
      setTimings(overrides);
      panel.showTimings();
    },
    panelMessage: (message) => {
      panel.receiveFromPage(message);
    },
  };
}

/** Waits for the speech lifecycle to retire its resources. */
export function deactivate(): Promise<void> {
  return stopSpeech?.() ?? Promise.resolve();
}
