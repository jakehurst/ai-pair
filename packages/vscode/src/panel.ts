import type { SpeechModelStatus } from './speech_setup';
import type { SpeechComputeMode, SpeechComputeState } from './speech_compute_types';
// The narration panel: a webview view in the secondary side bar. See "Narration panel" in DESIGN.md.

import * as vscode from 'vscode';
import type { CodePlayback, Controller, PanelEvent, PanelPort, Ref, SharedSelection } from '@ai-pair/core';
import {
  AUDIO_DIAGNOSTICS_SCHEMA,
  NAVIGATOR_COMMENTARY_SCHEMA,
  type NavigatorCommentary,
  speechDecodeFromPage,
  localPanelAction,
  localPanelUpdate,
  type AudioDiagnostics,
  type LocalPanelAction,
} from '@ai-pair/protocol';
import { panelHtml, SPEEDS } from './panel_html';
import { timings } from './timings';
import type { ChatOrder, FromPanel, SpeechAction, SpeechEvent, SpeechState, ToPanel } from './panel_messages';
import { ELEVENLABS_SPEEDS, SPEECH_SPEEDS, SPEECH_VOICES, type SpeechSettings, type OpenRouterAudioDecodeLease } from './speech_types';
import { SPEECH_LISTENING_RATES } from './speech_tempo';
import type { CatalogView } from './speech_catalog';
import type { OpenRouterCatalogView } from './speech_openrouter_catalog';
import type { OutputPreferenceView } from './speech_output_preferences';
import type { SpeechDiagnosticEvent } from './diagnostics';
import type { Calibration, CalibrationView } from './calibration';
import { SpeechDecodeBridge } from './speech_decode_bridge';
import type { DecodeDocument } from './speech_decode_lifecycle';
import type { SessionSpeechCost, SessionSpeechCostView } from './session_speech_cost';

const MAX_LOG = 400;
const DECODE_PROBE_TIMEOUT_MS = 5000;
const DECODE_TIMEOUT_MS = 30_000;

/** The commands the panel may run from its intro and settings. */
const PANEL_COMMANDS: ReadonlySet<string> = new Set(['aiPair.playDemo', 'aiPair.setUpAgent', 'aiPair.configureShortcuts']);

/** Page messages handled exclusively by the local speech service. */
const LOCAL_SPEECH_MESSAGES: ReadonlySet<string> = new Set([
  'speechEvent',
  'speechRetired',
  'speechPageHidden',
  'speechPageVisible',
  'speechOutputRefresh',
  'speechOutputSelect',
  'speechSettings',
  'speechComputeMode',
  'checkGpuSetup',
  'openRouterKeySet',
  'openRouterKeyRemove',
  'openRouterModelsLoad',
  'speechKeySet',
  'speechKeyRemove',
  'speechVoicesLoad',
  'speechVoicesMore',
  'speechStop',
  'speechPreview',
  'speechSetup',
]);

/** An agent the idle view can start a session with: whether it can right now, and how (#107). */
export interface Starter {
  available(): Promise<boolean>;
  /** Resolves once the agent it ran has exited, or at once if it ran none (#118). */
  start(): Promise<void>;
}

/**
 * What the panel drives: the controller and the calibration, made after the panel and read once a
 * page or the programmer acts, and the starter.
 */
export interface PanelWiring {
  controller: () => Controller;
  /** The reading speed calibration; the programmer's replies go to it while one is under way (#109). */
  calibration: () => Calibration;
  /** Starts a session from the idle view, when an agent that can be started from here is set up (#107). */
  starter: Starter;
  /** Copies the sanitized diagnostics snapshot on explicit request. */
  copyDiagnostics: () => Promise<void>;
  requireCommandApproval: () => Promise<void>;
  speech: {
    sessionCost?: Pick<SessionSpeechCost, 'start' | 'restore' | 'end' | 'view'>;
    narrationSession?: (id: number, ongoing: boolean) => void;
    readiness?: () => AudioDiagnostics;
    computeState: () => SpeechComputeState;
    computeMode: (value: SpeechComputeMode) => void;
    checkGpuSetup: () => void;
    outputView: () => OutputPreferenceView;
    outputReady: () => boolean;
    outputRetired: (id: number, pageId: number) => void;
    outputPageRetired: (pageId: number) => void;
    outputRefresh: () => void;
    outputSelect: (choice: unknown) => void;
    diagnostic: (event: SpeechDiagnosticEvent) => void;
    settings: { get: () => SpeechSettings; set: (value: SpeechSettings) => void };
    supported: () => boolean;
    installed: () => Promise<boolean>;
    modelStatus: () => Promise<SpeechModelStatus>;
    setup: () => Promise<void>;
    preview: () => Promise<void>;
    stop: () => void;
    event: (value: { id: number; pageId: number; event: SpeechEvent }) => void;
    pageClosed: (pageId: number) => void;
    cloudSupported: () => boolean;
    keySet: () => Promise<void>;
    keyRemove: () => Promise<void>;
    keyRefresh: () => void;
    loadVoices: (more: boolean) => void;
    validCloudVoice: (id: string) => boolean;
    openRouterKeySet: () => Promise<void>;
    openRouterKeyRemove: () => Promise<void>;
    openRouterKeyRefresh: () => void;
    loadOpenRouterModels: () => void;
    validOpenRouterVoice: (modelId: string, voiceId: string) => boolean;
  };
}

/** Workspace action forwarding for a UI-local companion panel. */
export interface CompanionPanelRouting {
  forward: (action: LocalPanelAction, pageId: number) => void;
  closed: (pageId: number) => void;
}

/** How many files of a name to look for before asking which was meant. */
const MAX_FOUND = 20;

/** The AI Pair view: shows the agent's narration and status, and takes the programmer's replies and controls. */
export class NarrationPanel implements PanelPort, vscode.WebviewViewProvider {
  static readonly viewId = 'aiPair.narration';
  /** Questions asked of the starter so far; an answer to an earlier one is dropped. */
  private asked = 0;
  private view?: vscode.WebviewView;
  private remote?: { pageId: number; send: (message: ToPanel) => void };
  private companion?: CompanionPanelRouting;
  private speechPageId = 0;
  private speechPageReady = false;
  private replyPageReady = false;
  private replyFocusPending = false;
  private decodeToken?: string;
  private readonly speechDecoder = new SpeechDecodeBridge({
    post: (message) =>
      this.decodeToken === undefined || this.view === undefined
        ? Promise.resolve(false)
        : Promise.resolve(this.view.webview.postMessage({ ...message, token: this.decodeToken })),
    page: () => (this.decodeToken === undefined ? undefined : this.speechReadyPageId()),
    probeTimeoutMs: DECODE_PROBE_TIMEOUT_MS,
    decodeTimeoutMs: DECODE_TIMEOUT_MS,
  });
  private speechSetupCheck = 0;
  private speechTransportAvailable = true;
  private observedCostSession = false;
  /** Session generation is local to this workspace/companion connection. */
  private workspaceCostGeneration = 0;
  private workspaceCostActive = false;
  private companionCostGeneration?: number;
  /** Everything posted so far, replayed when the view is (re)created. */
  private readonly log: PanelEvent[] = [];
  /** After each post: the window saves the history with a session, for a reload (#25). */
  onPost?: () => void;

  /** Returns everything posted so far, as the window saves it. */
  get history(): readonly PanelEvent[] {
    return this.log;
  }

  /**
   * Asks the starter whether a session can be started from here, and tells the page: for each new
   * page, and again after Set Up Agent (specs/Start.tla, `LoadPage`, and `FlipSetUp` with ReaskOnSetUp).
   * Only the latest question's answer reaches the page, so a page replaced before its answer landed
   * cannot set the button on its successor, and an earlier question's answer cannot override a
   * reask's (`AnswerCheck` with DropStale; OwnAnswer, LatestAnswerProp).
   */
  askStart(): void {
    const asked = ++this.asked;
    void this.wiring.starter.available().then((value) => {
      if (asked === this.asked) this.send({ type: 'canStart', value });
    });
  }

  constructor(
    private readonly resolvePath: (file: string) => string,
    private readonly speed: { get: () => number; set: (value: number) => void },
    private readonly readingSpeed: { get: () => number; set: (value: number) => void },
    private readonly selection: { current: () => SharedSelection | undefined; ref: () => Ref | undefined },
    /** Called with a line for each message from the page, for diagnosing deliveries (#27). */
    private readonly trace: (line: string) => void,
    /** The extension's folder, which holds the page's dist/panel.css and dist/panel.js. */
    private readonly extensionUri: vscode.Uri,
    private readonly wiring: PanelWiring,
    private readonly chatOrder: { get: () => ChatOrder; set: (value: ChatOrder) => void },
    private readonly buildInfo: { version: string; build: string },
    private readonly terminalSettings: { get: () => boolean; set: (value: boolean) => void },
    private readonly showTerminal: (id: number) => boolean,
    private readonly codePlayback: { get: () => CodePlayback; set: (value: CodePlayback) => void },
    private readonly replyBehavior: { get: () => 'interrupt' | 'finishAction'; set: (value: 'interrupt' | 'finishAction') => void },
    private readonly commandApprovalSound: { get: () => boolean; set: (value: boolean) => void },
    private readonly navigatorCommentary: { get: () => NavigatorCommentary; set: (value: NavigatorCommentary) => void },
  ) {}

  /** Posts to the page, if there is one. */
  private send(message: ToPanel): void {
    if (this.remote !== undefined) this.remote.send(message);
    else void this.view?.webview.postMessage(message);
  }

  /** Sends validated cached readiness facts to the current page. */
  showSpeechReadiness(value: AudioDiagnostics): void {
    this.send({ type: 'speechReadiness', value: AUDIO_DIAGNOSTICS_SCHEMA.parse(value) });
  }

  /** Displays the local provider-confirmed session speech subtotal. */
  showSpeechCost(value: SessionSpeechCostView): void {
    if (this.remote === undefined) this.send({ type: 'speechCost', value });
  }

  /** Updates the local cost owner only for actual Pair session transitions. */
  private costSession(event: Extract<PanelEvent, { type: 'session' }>): void {
    this.observedCostSession = true;
    if (!event.active) this.wiring.speech.sessionCost?.end();
    else if (event.suspended === true || event.resumed === true) this.wiring.speech.sessionCost?.restore();
    else this.wiring.speech.sessionCost?.start();
  }

  /** Reports whether the local speech connection remains usable. */
  showSpeechTransport(available: boolean): void {
    this.speechTransportAvailable = available;
    this.send({ type: 'speechTransport', available });
  }

  /** Sends the local compute state to the current page. */
  showSpeechComputeState(value: SpeechComputeState): void {
    this.send({ type: 'speechComputeState', value });
  }

  /** Syncs the persisted terminal preference to the page. */
  showTerminalPreference(value: boolean): void {
    this.send({ type: 'showTerminals', value });
  }

  /** Syncs the command approval cue preference to the current page. */
  showCommandApprovalSound(value: boolean): void {
    this.send({ type: 'commandApprovalSound', value });
  }

  /** Sends audio only to a ready page, never to the history log. */
  playSpeech(id: number, wav: Uint8Array, durationMs: number): number | undefined {
    if (!this.view || !this.speechPageReady) return undefined;
    const pageId = this.speechPageId;
    this.send({ type: 'speechAudio', id, pageId, wavBase64: Buffer.from(wav).toString('base64'), durationMs });
    return pageId;
  }

  controlSpeech(id: number, pageId: number, action: SpeechAction): void {
    if (this.speechPageReady && pageId === this.speechPageId) this.send({ type: 'speechControl', id, pageId, action });
  }

  showSpeechStatus(id: number, state: SpeechState, message?: string): void {
    if (this.speechPageReady) {
      this.send({ type: 'speechStatus', id, pageId: this.speechPageId, state, ...(message === undefined ? {} : { message }) });
    }
  }

  showSpeechKeyStatus(hasKey: boolean): void {
    this.send({ type: 'speechKeyStatus', hasKey });
  }

  showSpeechOutputCatalog(value: OutputPreferenceView): void {
    this.send({ type: 'speechOutputCatalog', value });
  }

  showSpeechCatalog(value: CatalogView): void {
    this.send({ type: 'speechCatalog', value });
  }

  showOpenRouterKeyStatus(hasKey: boolean): void {
    this.send({ type: 'openRouterKeyStatus', hasKey });
  }

  showOpenRouterCatalog(value: OpenRouterCatalogView): void {
    this.send({ type: 'openRouterCatalog', value });
  }

  showSpeechSettings(value: SpeechSettings): void {
    this.send({ type: 'speechSettings', value });
  }

  /** Shows the programmer's selection, which changed. Not logged: only the current one matters. */
  showSelection(ref: Ref | undefined): void {
    this.send({ type: 'selection', ref });
  }

  /** Shows the speed setting, which changed. Not logged: only the current value matters. */
  showSpeed(value: number): void {
    this.send({ type: 'speed', value });
  }

  /** Shows the workspace's current navigator commentary preference. */
  showNavigatorCommentary(value: NavigatorCommentary): void {
    this.send({ type: 'navigatorCommentary', value });
  }

  /** Shows the saved history order, including changes made in VS Code settings. */
  showChatOrder(value: ChatOrder): void {
    this.send({ type: 'chatOrder', value });
  }

  /** Shows the saved reply behavior. */
  showReplyBehavior(value: 'interrupt' | 'finishAction'): void {
    this.send({ type: 'replyBehavior', value });
  }

  /** Shows the selected code playback mode. */
  showCodePlayback(value: CodePlayback): void {
    this.send({ type: 'codePlayback', value });
  }

  showReadingSpeed(value: number): void {
    this.send({ type: 'readingSpeed', value });
  }

  showCalibration(view: CalibrationView): void {
    this.send({ type: 'calibration', view });
  }

  /** Tells the page its delays: with each new page, and when a test changes them. */
  showTimings(): void {
    this.send({ type: 'timings', tipDelayMs: timings.tipDelayMs, tipWarmMs: timings.tipWarmMs });
  }

  /** Sends the session owner's current approval snapshot. */
  showCommandApprovals(): void {
    const approvals = this.wiring.controller().commandApprovals;
    this.send({
      type: 'commandApprovals',
      all: approvals.all,
      count: approvals.commands.length,
      confirmationRequired: approvals.confirmationRequired,
    });
  }

  // specs/PanelReplay.tla, `Post`: the event onto the log, the oldest cut beyond MAX_LOG.
  post(event: PanelEvent): void {
    if (event.type === 'session') {
      const fresh = event.active && event.suspended !== true && event.resumed !== true;
      if (fresh || (event.active && this.workspaceCostGeneration === 0)) this.workspaceCostGeneration++;
      this.workspaceCostActive = event.active;
      if (this.remote === undefined) {
        this.wiring.speech.narrationSession?.(this.workspaceCostGeneration, event.active);
      }
      if (this.remote === undefined) this.costSession(event);
    }
    this.log.push(event);
    if (this.log.length > MAX_LOG) {
      const cut = this.log.splice(0, this.log.length - MAX_LOG);
      // A view replays its session state from the last `session` event: keep it, or a view created
      // after a long session shows none while one runs (#54).
      const session = cut.findLast((e) => e.type === 'session');
      if (session && !this.log.some((e) => e.type === 'session')) this.log.unshift(session);
    }
    // specs/CostReplay.tla, Fresh: identity and session state share one update.
    this.send(
      event.type === 'session' && this.remote !== undefined && this.workspaceCostGeneration > 0
        ? { ...event, costSessionGeneration: this.workspaceCostGeneration }
        : event,
    );
    if (event.type === 'session') {
      void vscode.commands.executeCommand('setContext', 'aiPair.active', event.active);
      if (event.active) this.reveal();
      if (!event.active) {
        this.replyFocusPending = false;
        this.wiring.calibration().cancel();
      }
      this.showCommandApprovals();
    }
    this.onPost?.();
  }

  /** Restores, after a reload, the history the window saved with its session, for the view to replay (#25). */
  restoreHistory(events: readonly PanelEvent[]): void {
    this.log.splice(0, this.log.length, ...events);
    void vscode.commands.executeCommand('setContext', 'aiPair.active', true);
  }

  focusReply(): void {
    this.reveal(/* preserveFocus= */ false);
    if (this.replyPageReady) this.send({ type: 'focusReply' });
    else this.replyFocusPending = true;
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    if (this.speechPageId > 0) {
      this.wiring.speech.pageClosed(this.speechPageId);
      if (this.view !== undefined) this.companion?.closed(this.speechPageId);
    }
    this.view = view;
    this.speechPageId++;
    this.speechPageReady = false;
    this.replyPageReady = false;
    this.decodeToken = undefined;
    const pageId = this.speechPageId;
    let document: DecodeDocument | undefined;
    let documentToken: string | undefined;
    let pending: { token: string; document: DecodeDocument; predecessor?: DecodeDocument } | undefined;
    const dist = vscode.Uri.joinPath(this.extensionUri, 'dist');
    view.webview.options = { enableScripts: true, localResourceRoots: [dist] };
    const style = view.webview.asWebviewUri(vscode.Uri.joinPath(dist, 'panel.css')).toString();
    const script = view.webview.asWebviewUri(vscode.Uri.joinPath(dist, 'panel.js')).toString();
    view.webview.html = panelHtml(view.webview.cspSource, style, script, this.buildInfo.version, this.buildInfo.build);
    // The page posts only FromPanel messages; VS Code types them `any`.
    view.webview.onDidReceiveMessage((m: FromPanel) => {
      const decoded = speechDecodeFromPage.safeParse(m);
      if (this.view !== view) {
        // A predecessor may still retire its own physical decode until its view is disposed.
        if (
          decoded.success &&
          decoded.data.type === 'speechDecodeDone' &&
          decoded.data.token === documentToken &&
          document !== undefined &&
          decoded.data.document.pageId === document.pageId &&
          decoded.data.document.documentGeneration === document.documentGeneration
        ) {
          this.speechDecoder.decoded(document, decoded.data.requestId, decoded.data.value);
        }
        return;
      }
      if (decoded.success) {
        const message = decoded.data;
        if (message.type === 'speechDecodeBoot') {
          if (message.token === documentToken && document !== undefined) {
            pending = { token: message.token, document };
            void view.webview.postMessage({ type: 'speechDecodeChallenge', token: message.token, document });
          } else if (pending?.token === message.token) {
            void view.webview.postMessage({ type: 'speechDecodeChallenge', token: message.token, document: pending.document });
          } else {
            const next = this.speechDecoder.prepare(pageId);
            pending = { token: message.token, document: next, predecessor: document };
            void view.webview.postMessage({ type: 'speechDecodeChallenge', token: message.token, document: next });
          }
        } else if (message.type === 'speechDecodeBootAck') {
          if (
            pending?.token !== message.token ||
            pending.document.pageId !== message.document.pageId ||
            pending.document.documentGeneration !== message.document.documentGeneration
          ) {
            return;
          }
          if (pending.document !== document) this.speechDecoder.activate(pending.document);
          else this.speechDecoder.resume(pending.document);
          if (pending.predecessor !== undefined) this.speechDecoder.destroy(pending.predecessor);
          document = pending.document;
          documentToken = pending.token;
          this.decodeToken = pending.token;
          pending = undefined;
        } else if (
          this.decodeToken === message.token &&
          document !== undefined &&
          document.pageId === message.document.pageId &&
          document.documentGeneration === message.document.documentGeneration
        ) {
          if (message.type === 'speechDecodeReady') this.speechDecoder.ready(document, message.probeId, message.available);
          else this.speechDecoder.decoded(document, message.requestId, message.value);
        }
        return;
      }
      if (typeof m === 'object' && m !== null && 'type' in m && typeof m.type === 'string' && m.type.startsWith('speechDecode')) return;
      this.receive(m, pageId);
    });
    view.onDidDispose(() => {
      if (document !== undefined) this.speechDecoder.destroy(document);
      if (pending !== undefined) this.speechDecoder.destroy(pending.document);
      // specs/OutputReplacement.tla, Dispose: only destruction retires a replaced page.
      this.wiring.speech.outputPageRetired(pageId);
      // specs/Start.tla, `Dispose`: the page goes, its button and note with it.
      if (this.view === view) {
        this.view = undefined;
        this.speechPageReady = false;
        this.replyPageReady = false;
        this.decodeToken = undefined;
        this.wiring.speech.pageClosed(pageId);
        if (this.companion !== undefined) this.companion.closed(pageId);
        else {
          this.wiring.controller().releaseReadingHold();
          // Its draft and its pause went with this view: specs/Draft.tla, `Dispose`.
          this.wiring.controller().resume('reply');
          this.wiring.calibration().cancel();
        }
      }
    });
  }

  /** Routes workspace actions out of a UI-local companion panel. */
  useCompanion(routing: CompanionPanelRouting): void {
    this.companion = routing;
  }

  /** Displays a validated workspace update in the locally owned companion view. */
  showRemoteUpdate(value: unknown): void {
    if (this.companion === undefined || this.view === undefined) return;
    const parsed = localPanelUpdate.safeParse(value);
    if (parsed.success) {
      if (parsed.data.type === 'session' && parsed.data.costSessionGeneration !== undefined) {
        const fresh = parsed.data.active && parsed.data.suspended !== true && parsed.data.resumed !== true;
        this.syncCompanionCost(parsed.data.costSessionGeneration, parsed.data.active, fresh);
      } else if (
        parsed.data.type === 'replay' &&
        parsed.data.costSessionGeneration !== undefined &&
        parsed.data.costSessionActive !== undefined
      ) {
        this.syncCompanionCost(parsed.data.costSessionGeneration, parsed.data.costSessionActive, false);
      } else if (parsed.data.type === 'session' && this.companionCostGeneration === undefined) this.costSession(parsed.data);
      else if (parsed.data.type === 'replay' && this.companionCostGeneration === undefined && !this.observedCostSession) {
        const last = parsed.data.events.findLast((event) => event.type === 'session');
        if (last?.type === 'session' && last.active) {
          this.observedCostSession = true;
          this.wiring.speech.sessionCost?.restore();
        }
      }
      void this.view.webview.postMessage(parsed.data);
    }
  }

  /** Reconciles cost ownership to a workspace session update or replay snapshot. */
  private syncCompanionCost(generation: number, active: boolean, fresh: boolean): void {
    if (this.companionCostGeneration !== undefined && generation < this.companionCostGeneration) return;
    this.wiring.speech.narrationSession?.(generation, active);
    if (this.companionCostGeneration !== generation) {
      // specs/CostReplay.tla, Fresh and Reopen: preserve same-session costs, never another session's.
      if (this.companionCostGeneration !== undefined) this.wiring.speech.sessionCost?.end();
      this.companionCostGeneration = generation;
      this.observedCostSession = true;
      if (fresh) this.wiring.speech.sessionCost?.start();
      else this.wiring.speech.sessionCost?.restore();
    }
    if (!active) this.wiring.speech.sessionCost?.end();
  }

  /** Attaches the locally owned companion page without registering a second provider. */
  attachRemote(pageId: number, send: (message: ToPanel) => void): void {
    this.remote = { pageId, send };
    this.speechPageId = pageId;
    this.replyPageReady = false;
  }

  /** Dispatches a validated action from the currently attached companion page. */
  receiveRemote(pageId: number, message: LocalPanelAction): void {
    if (this.remote?.pageId !== pageId) return;
    if (message.type === 'pageClosed') this.closeRemote(pageId);
    else this.receive(message, pageId);
  }

  /** Retires workspace state belonging to a disposed companion page. */
  closeRemote(pageId: number): void {
    if (this.remote?.pageId !== pageId) return;
    this.remote = undefined;
    this.replyPageReady = false;
    this.wiring.controller().releaseReadingHold();
    this.wiring.controller().resume('reply');
    this.wiring.calibration().cancel();
  }

  /** Whether the current page can receive live speech for integration tests. */
  speechPageIsReady(): boolean {
    return this.speechPageReady;
  }

  /** Returns the current ready page identity for output ownership. */
  speechReadyPageId(): number | undefined {
    return this.speechPageReady ? this.speechPageId : undefined;
  }

  /** Reserves the decoder belonging to this locally owned webview. */
  admitSpeechDecode(id: number, signal: AbortSignal): Promise<OpenRouterAudioDecodeLease> {
    return this.speechDecoder.admit(id, signal);
  }

  /** Refreshes runtime availability for the currently open page only. */
  refreshSpeechSupport(): void {
    if (!this.speechPageReady) return;
    const pageId = this.speechPageId;
    const check = ++this.speechSetupCheck;
    const supported = this.wiring.speech.supported();
    this.wiring.speech.diagnostic({
      kind: 'speech',
      event: 'capability',
      phase: supported ? 'ready' : 'blocked',
      provider: 'kokoro',
      ...(supported ? {} : { reason: 'unsupported' }),
    });
    this.send({ type: 'speechSupport', supported });
    void this.wiring.speech
      .modelStatus()
      .then((value) => {
        if (this.speechPageId === pageId && this.speechSetupCheck === check) this.send({ type: 'speechModelStatus', value });
      })
      .catch(() => {
        if (this.speechPageId === pageId && this.speechSetupCheck === check) this.send({ type: 'speechModelStatusUnavailable' });
      });
    if (supported) {
      void this.wiring.speech.installed().then(
        (installed) => {
          if (this.speechPageId === pageId && this.speechSetupCheck === check) {
            this.wiring.speech.diagnostic({
              kind: 'speech',
              event: 'setup',
              phase: installed ? 'ready' : 'blocked',
              provider: 'kokoro',
              ...(installed ? {} : { reason: 'not_ready' }),
            });
            this.send({
              type: 'speechSetupState',
              pending: false,
              message: installed ? 'Local model is ready.' : 'Local speech is not set up.',
            });
          }
        },
        () => {
          if (this.speechPageId === pageId && this.speechSetupCheck === check) {
            this.wiring.speech.diagnostic({ kind: 'speech', event: 'setup', phase: 'failed', provider: 'kokoro', reason: 'unknown' });
            this.send({ type: 'speechSetupState', pending: false, message: 'Local speech availability is unknown.' });
          }
        },
      );
    }
  }

  private reveal(preserveFocus = true): void {
    if (this.view) {
      this.view.show(preserveFocus);
    } else {
      void vscode.commands.executeCommand(`${NarrationPanel.viewId}.focus`);
    }
  }

  /** Initializes speech controls only in the host that owns the local page. */
  private readySpeech(pageId: number): void {
    this.speechPageReady = true;
    this.send({ type: 'speechPage', pageId });
    this.showSpeechTransport(this.speechTransportAvailable);
    const cost = this.wiring.speech.sessionCost?.view();
    if (cost !== undefined) this.showSpeechCost(cost);
    this.showSpeechSettings(this.wiring.speech.settings.get());
    this.showSpeechComputeState(this.wiring.speech.computeState());
    if (this.wiring.speech.readiness !== undefined) this.showSpeechReadiness(this.wiring.speech.readiness());
    this.showSpeechOutputCatalog(this.wiring.speech.outputView());
    const supported = this.wiring.speech.cloudSupported();
    this.wiring.speech.diagnostic({
      kind: 'speech',
      event: 'capability',
      phase: supported ? 'ready' : 'blocked',
      provider: 'elevenlabs',
      ...(supported ? {} : { reason: 'unsupported' }),
    });
    this.send({ type: 'speechCloudSupport', supported });
    this.wiring.speech.keyRefresh();
    this.wiring.speech.openRouterKeyRefresh();
    this.refreshSpeechSupport();
  }

  /**
   * Handles a message as if the current page had posted it, for the integration test's `Api.panelMessage`:
   * the same handler as the webview's. Tests supply trusted page-shaped messages: this is not a schema
   * validator, and the handler assumes the page supplies correctly typed fields for some message types.
   * Anything that is not an object with a string `type` is dropped, as the page never posts one.
   */
  receiveFromPage(message: unknown): void {
    if (typeof message !== 'object' || message === null || !('type' in message) || typeof message.type !== 'string') return;
    // The webview and this test seam both supply trusted page-shaped messages.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    this.receive(message as FromPanel, this.speechPageId);
  }

  private receive(message: FromPanel, pageId: number): void {
    if (this.companion !== undefined) {
      const action = localPanelAction.safeParse(message);
      if (action.success) {
        if (action.data.type === 'ready') this.readySpeech(pageId);
        this.companion.forward(action.data, pageId);
        return;
      }
      if (typeof message !== 'object' || message === null || !LOCAL_SPEECH_MESSAGES.has(message.type)) return;
    }
    const controller = () => this.wiring.controller();
    this.trace(
      `panel ${message.type}${message.type === 'reply' ? ` ${JSON.stringify(message.text)}` : message.type === 'draft' ? (message.empty ? ' empty' : ' typed') : ''}`,
    );
    switch (message.type) {
      case 'speechEvent':
        if (
          message.pageId === pageId &&
          Number.isSafeInteger(message.id) &&
          message.id > 0 &&
          (message.event === 'started' || message.event === 'ended' || message.event === 'failed')
        ) {
          this.wiring.speech.event({ id: message.id, pageId, event: message.event });
        }
        return;
      case 'speechRetired':
        if (message.pageId === pageId && Number.isSafeInteger(message.id) && message.id > 0) {
          this.wiring.speech.outputRetired(message.id, pageId);
        }
        return;
      case 'speechPageHidden':
        if (message.pageId === pageId) {
          this.speechPageReady = false;
          this.wiring.speech.pageClosed(pageId);
          this.wiring.speech.outputPageRetired(pageId);
        }
        return;
      case 'speechPageVisible':
        if (message.pageId === pageId) this.speechPageReady = true;
        return;
      case 'speechOutputRefresh':
        this.wiring.speech.outputRefresh();
        return;
      case 'speechOutputSelect':
        this.wiring.speech.outputSelect(message.choice);
        return;
      case 'speechComputeMode':
        if (message.value === 'cpu' || message.value === 'auto' || message.value === 'gpu') this.wiring.speech.computeMode(message.value);
        return;
      case 'checkGpuSetup':
        this.wiring.speech.checkGpuSetup();
        return;
      case 'speechSettings':
        if (
          typeof message.value?.enabled === 'boolean' &&
          (message.value.contextEnabled === undefined || typeof message.value.contextEnabled === 'boolean') &&
          SPEECH_VOICES.some((voice) => voice === message.value.voice) &&
          SPEECH_SPEEDS.some((speed) => speed === message.value.speed) &&
          (message.value.listeningSpeed === undefined || SPEECH_LISTENING_RATES.some((rate) => rate === message.value.listeningSpeed)) &&
          (message.value.provider === 'kokoro' || message.value.provider === 'elevenlabs' || message.value.provider === 'openrouter') &&
          (message.value.openRouterZdr === undefined || typeof message.value.openRouterZdr === 'boolean') &&
          (message.value.openRouterFormat === undefined ||
            message.value.openRouterFormat === 'pcm' ||
            message.value.openRouterFormat === 'mp3') &&
          (message.value.openRouterModel === undefined || typeof message.value.openRouterModel === 'string') &&
          (message.value.openRouterVoice === undefined || typeof message.value.openRouterVoice === 'string') &&
          (message.value.provider !== 'openrouter' ||
            message.value.openRouterModel === undefined ||
            message.value.openRouterModel === '' ||
            message.value.openRouterVoice === undefined ||
            message.value.openRouterVoice === '' ||
            this.wiring.speech.validOpenRouterVoice(message.value.openRouterModel, message.value.openRouterVoice) ||
            (message.value.openRouterModel === this.wiring.speech.settings.get().openRouterModel &&
              message.value.openRouterVoice === this.wiring.speech.settings.get().openRouterVoice)) &&
          (message.value.elevenLabsVoice === '' ||
            this.wiring.speech.validCloudVoice(message.value.elevenLabsVoice) ||
            message.value.elevenLabsVoice === this.wiring.speech.settings.get().elevenLabsVoice) &&
          ELEVENLABS_SPEEDS.some((speed) => speed === message.value.elevenLabsSpeed)
        ) {
          this.wiring.speech.settings.set(message.value);
        }
        return;
      case 'openRouterKeySet':
      case 'openRouterKeyRemove':
        if (!this.wiring.speech.cloudSupported()) return;
        void (message.type === 'openRouterKeySet' ? this.wiring.speech.openRouterKeySet() : this.wiring.speech.openRouterKeyRemove()).catch(
          () => {
            this.send({ type: 'speechSetupState', pending: false, message: 'Could not update the API key.' });
          },
        );
        return;
      case 'openRouterModelsLoad':
        if (this.wiring.speech.settings.get().provider === 'openrouter' && this.wiring.speech.cloudSupported()) {
          this.wiring.speech.loadOpenRouterModels();
        }
        return;
      case 'speechKeySet':
      case 'speechKeyRemove':
        if (!this.wiring.speech.cloudSupported()) return;
        void (message.type === 'speechKeySet' ? this.wiring.speech.keySet() : this.wiring.speech.keyRemove()).catch(() => {
          this.send({ type: 'speechSetupState', pending: false, message: 'Could not update the API key.' });
        });
        return;
      case 'speechVoicesLoad':
      case 'speechVoicesMore': {
        const provider = this.wiring.speech.settings.get().provider;
        // specs/DiagnosticsPrivacy.tla, Record: only fixed speech facts are recorded.
        this.wiring.speech.diagnostic({ kind: 'speech', event: 'catalog', phase: 'received', provider });
        if (provider !== 'elevenlabs') {
          this.wiring.speech.diagnostic({ kind: 'speech', event: 'catalog', phase: 'blocked', provider, reason: 'not_ready' });
          this.send({ type: 'speechSetupState', pending: false, message: 'Select ElevenLabs to load voices.' });
        } else if (!this.wiring.speech.cloudSupported()) {
          this.wiring.speech.diagnostic({ kind: 'speech', event: 'catalog', phase: 'blocked', provider, reason: 'unsupported' });
          this.send({ type: 'speechSetupState', pending: false, message: 'ElevenLabs is unsupported on this host.' });
        } else {
          this.wiring.speech.diagnostic({ kind: 'speech', event: 'catalog', phase: 'dispatched', provider });
          this.wiring.speech.loadVoices(message.type === 'speechVoicesMore');
        }
        return;
      }
      case 'speechStop':
        this.wiring.speech.stop();
        return;
      case 'speechPreview': {
        const provider = this.wiring.speech.settings.get().provider;
        this.wiring.speech.diagnostic({ kind: 'speech', event: 'preview', phase: 'received', provider });
        if (!this.wiring.speech.outputReady()) {
          this.wiring.speech.diagnostic({ kind: 'speech', event: 'preview', phase: 'blocked', provider, reason: 'not_ready' });
          this.send({
            type: 'speechSetupState',
            pending: false,
            message: 'The selected speech output is unavailable. Refresh outputs or choose System default.',
          });
          return;
        }
        if (provider === 'kokoro' ? !this.wiring.speech.supported() : !this.wiring.speech.cloudSupported()) {
          this.wiring.speech.diagnostic({ kind: 'speech', event: 'preview', phase: 'blocked', provider, reason: 'unsupported' });
          this.send({
            type: 'speechSetupState',
            pending: false,
            message: provider === 'kokoro' ? 'Local speech is unsupported on this host.' : 'ElevenLabs is unsupported on this host.',
          });
          return;
        }
        this.wiring.speech.diagnostic({ kind: 'speech', event: 'preview', phase: 'dispatched', provider });
        void this.wiring.speech.preview().catch(() => {
          this.wiring.speech.diagnostic({ kind: 'speech', event: 'preview', phase: 'failed', provider, reason: 'unknown' });
          this.send({ type: 'speechSetupState', pending: false, message: 'Voice preview is unavailable.' });
        });
        return;
      }
      case 'speechSetup':
        this.wiring.speech.diagnostic({ kind: 'speech', event: 'setup', phase: 'received', provider: 'kokoro' });
        if (!this.wiring.speech.supported()) {
          this.wiring.speech.diagnostic({ kind: 'speech', event: 'setup', phase: 'blocked', provider: 'kokoro', reason: 'unsupported' });
          this.send({ type: 'speechSetupState', pending: false, message: 'Local speech is unsupported on this host.' });
          return;
        }
        this.wiring.speech.diagnostic({ kind: 'speech', event: 'setup', phase: 'dispatched', provider: 'kokoro' });
        this.speechSetupCheck++;
        this.send({ type: 'speechSetupState', pending: true, message: 'Setting up local speech...' });
        void this.wiring.speech.setup().then(
          () => {
            this.wiring.speech.diagnostic({ kind: 'speech', event: 'setup', phase: 'ready', provider: 'kokoro' });
            this.send({ type: 'speechSetupState', pending: false, message: 'Local model is ready.' });
            this.refreshSpeechSupport();
          },
          () => {
            this.wiring.speech.diagnostic({ kind: 'speech', event: 'setup', phase: 'failed', provider: 'kokoro', reason: 'unknown' });
            this.send({ type: 'speechSetupState', pending: false, message: 'Speech setup did not complete.' });
          },
        );
        return;
      case 'copyDiagnostics':
        // specs/DiagnosticsCopy.tla, `Click`: report both clipboard outcomes.
        void this.wiring.copyDiagnostics().then(
          () => vscode.window.showInformationMessage('AI Pair diagnostics copied.'),
          () => vscode.window.showErrorMessage('Could not copy AI Pair diagnostics.'),
        );
        return;
      case 'ready':
        this.replyPageReady = true;
        if (this.remote === undefined) this.readySpeech(pageId);
        // A new page has an empty draft (#69): specs/Draft.tla, `LoadPage`.
        controller().resume('reply');
        this.showNavigatorCommentary(this.navigatorCommentary.get());
        this.showChatOrder(this.chatOrder.get());
        this.showReplyBehavior(this.replyBehavior.get());
        this.showCommandApprovalSound(this.commandApprovalSound.get());
        this.showCommandApprovals();
        this.send({
          type: 'replay',
          events: this.log,
          ...(this.remote !== undefined && this.workspaceCostGeneration > 0
            ? { costSessionGeneration: this.workspaceCostGeneration, costSessionActive: this.workspaceCostActive }
            : {}),
        });
        this.showTerminalPreference(this.terminalSettings.get());
        this.showSpeed(this.speed.get());
        this.showReadingSpeed(this.readingSpeed.get());
        this.showCodePlayback(this.codePlayback.get());
        this.showSelection(this.selection.ref());
        this.showTimings();
        // The new page asks once whether a session can start: specs/Start.tla, `LoadPage`.
        this.askStart();
        if (this.replyFocusPending) {
          this.replyFocusPending = false;
          this.send({ type: 'focusReply' });
        }
        return;
      case 'replyBehavior':
        if (message.value === 'interrupt' || message.value === 'finishAction') this.replyBehavior.set(message.value);
        return;
      case 'navigatorCommentary': {
        const parsed = NAVIGATOR_COMMENTARY_SCHEMA.safeParse(message.value);
        if (parsed.success) this.navigatorCommentary.set(parsed.data);
        return;
      }
      case 'chatOrder':
        if (message.value === 'newestFirst' || message.value === 'oldestFirst') this.chatOrder.set(message.value);
        return;
      case 'showTerminals':
        // specs/TerminalPanel.tla, `SetAuto`.
        if (typeof message.value === 'boolean') this.terminalSettings.set(message.value);
        return;
      case 'commandApprovalSound':
        if (typeof message.value === 'boolean') this.commandApprovalSound.set(message.value);
        return;
      case 'showTerminal':
        // specs/TerminalPanel.tla, `Show`: unavailable never creates a replacement.
        if (Number.isSafeInteger(message.id) && message.id > 0 && !this.showTerminal(message.id)) {
          void vscode.window.showInformationMessage('That terminal is no longer available.');
        }
        return;
      case 'holdReading':
        if (Number.isSafeInteger(message.id) && message.id > 0 && typeof message.held === 'boolean') {
          controller().holdReading(message.id, message.held);
        }
        return;
      case 'skipReading':
        if (Number.isSafeInteger(message.id) && message.id > 0) controller().finishReading(message.id);
        return;
      case 'speed':
        // Only the menu's speeds: the page sends no others (#17).
        if (SPEEDS.includes(message.value)) this.speed.set(message.value);
        return;
      case 'codePlayback':
        // specs/PlaybackPreference.tla, `Choose`.
        if (message.value === 'typing' || message.value === 'lines' || message.value === 'blocks') this.codePlayback.set(message.value);
        return;
      case 'readingSpeed':
        if (SPEEDS.includes(message.value)) this.readingSpeed.set(message.value);
        return;
      case 'reply':
        // Cancel before resume so an old generation cannot restart.
        if (this.remote === undefined && message.defer !== true) this.wiring.speech.stop();
        // Replying means "go on with this", so any pause ends. It moves no view, so the programmer's tab and
        // selection stay as they were (specs/PointFocus.tla, `SendReply`, issue 125; specs/Draft.tla,
        // `ResumeAll`).
        if (this.wiring.calibration().reply(message.text)) {
          // The box is empty now, and the page posts no `draft` for it: specs/Draft.tla, `SendToCalibration` (#191).
          controller().resume('reply');
          return;
        }
        // The owner sees the held reply before resume releases attention.
        controller().userMessage(message.text, message.attach === true ? this.selection.current() : undefined, message.defer === true);
        controller().resume(undefined, { reveal: false });
        return;
      case 'draft':
        // Typing a reply pauses playback, the way a pair stops when you start talking (specs/Draft.tla, `TypeDraft`, `Clear`).
        if (message.empty) {
          controller().resume('reply');
        } else {
          controller().pause('reply');
        }
        return;
      case 'attention':
        controller().requestAttention();
        break;
      case 'revealCursor':
        controller().revealCursor();
        return;
      case 'pause':
        controller().pause();
        return;
      case 'resume':
        // specs/Draft.tla, `ResumeAll`: resume() with no reason ends every pause.
        controller().resume();
        return;
      case 'interrupt':
        if (this.remote === undefined) this.wiring.speech.stop();
        controller().userInterrupt();
        return;
      case 'turn': {
        const selection = message.attach === true ? this.selection.current() : undefined;
        if (this.remote === undefined && (controller().turn !== 'programmer' || message.message !== undefined || selection !== undefined)) {
          this.wiring.speech.stop();
        }
        if (controller().turn === 'programmer') {
          controller().handBack(message.message, selection);
        } else {
          controller().takeTurn();
        }
        if (message.message !== undefined || selection !== undefined) controller().resume();
        return;
      }
      case 'end':
        if (this.remote === undefined) this.wiring.speech.stop();
        controller().endSession();
        return;
      case 'revokeCommandApprovals':
        controller().setConfirmCommands(true);
        controller().revokeCommandApprovals();
        this.showCommandApprovals();
        void this.wiring.requireCommandApproval().then(
          () => {
            this.showCommandApprovals();
          },
          () => {
            void vscode.window.showErrorMessage('Could not save command approval settings. Confirmation is on for this window.');
            this.showCommandApprovals();
          },
        );
        return;
      case 'runDecision': {
        const scope =
          message.scope === 'command' || message.scope === 'all'
            ? message.scope
            : message.scope === undefined && message.remember === true
              ? 'command'
              : 'once';
        controller().decideRun(message.id, message.run, scope);
        this.showCommandApprovals();
        return;
      }
      case 'open': {
        const uri = vscode.Uri.file(this.resolvePath(message.file));
        const position = new vscode.Position(Math.max(0, message.line - 1), 0);
        void vscode.window.showTextDocument(uri, { selection: new vscode.Range(position, position) });
        return;
      }
      case 'openFile':
        void this.openByName(message.file);
        return;
      case 'command':
        if (PANEL_COMMANDS.has(message.command)) void vscode.commands.executeCommand(message.command);
        return;
      case 'start':
        // specs/Start.tla, `Click`: one run per click. `AgentExits`: the agent is done, and the page drops its
        // note (NoteGoes).
        void this.wiring.starter.start().then(() => {
          this.send({ type: 'startEnded' });
        });
        return;
      case 'openChange':
        void this.openChange(message.file);
        return;
      case 'openUrl':
        if (/^https?:\/\//.test(message.url)) void vscode.env.openExternal(vscode.Uri.parse(message.url));
        return;
      // no default
    }
  }

  /** Opens a file changed outside the protocol: its diff against git's index, or the file itself outside git (#15). */
  private async openChange(file: string): Promise<void> {
    const uri = vscode.Uri.file(this.resolvePath(file));
    try {
      await vscode.commands.executeCommand('git.openChange', uri);
    } catch {
      await vscode.commands.executeCommand('vscode.open', uri);
    }
  }

  /** Opens a file the agent named: as a path in the workspace, else the file of that name, asking if there are several. */
  private async openByName(name: string): Promise<void> {
    const direct = vscode.Uri.file(this.resolvePath(name));
    try {
      await vscode.workspace.fs.stat(direct);
      await vscode.window.showTextDocument(direct);
      return;
    } catch {
      // Not a path from the workspace's root: look for it by name.
    }
    const found = await vscode.workspace.findFiles(`**/${name}`, '**/node_modules/**', MAX_FOUND);
    let uri = found[0];
    if (uri === undefined) {
      void vscode.window.showInformationMessage(`AI Pair: couldn't find ${name} in the workspace.`);
      return;
    }
    if (found.length > 1) {
      const picked = await vscode.window.showQuickPick(
        found.map((u) => ({ label: vscode.workspace.asRelativePath(u), uri: u })),
        { placeHolder: `Which ${name}?` },
      );
      if (!picked) return;
      uri = picked.uri;
    }
    await vscode.window.showTextDocument(uri);
  }
}
