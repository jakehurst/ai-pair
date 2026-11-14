import { speechContextCapabilities } from '../speech_context_capabilities';
import { voiceIndicator } from '../voice_indicator';
import type { AudioDiagnostics } from '@ai-pair/protocol';
import type { SpeechComputeState } from '../speech_compute_types';
import { SPEECH_LISTENING_RATES } from '../speech_tempo';
// The narration panel's page script, bundled for the webview as dist/panel.js (#6). The markup and
// styles are in panel_html.ts; the messages in panel_messages.ts.

import type { AgentState, CodePlayback, PanelEvent, Ref } from '@ai-pair/core';
import type { ChatOrder, FromPanel, SpeechState, ToPanel } from '../panel_messages';
import { SpeechAudio, decodeWav } from './speech_audio';
import { ApprovalSound } from './approval_sound';
import { localSpeechDecoder } from './speech_decode';
import { formatOpenRouterPricing } from '../speech_pricing';
import { ELEVENLABS_SPEEDS, SPEECH_SPEEDS, SPEECH_VOICES, type OpenRouterModel, type SpeechVoice } from '../speech_types';
import type { CalibrationView } from '../calibration';
import type { OutputChoice } from '../speech_output_types';
import type { SessionSpeechCostView } from '../session_speech_cost';
import { ELLIPSIS, LABEL_SEPARATOR, RANGE_DASH, RIGHT_ARROW, SPEED_SUFFIX } from '@ai-pair/core/constants';

declare function acquireVsCodeApi(): { postMessage(message: FromPanel): void };

const vscode = acquireVsCodeApi();

// A code span that names a file, like `game.ts` or `src/game.ts`, becomes a link that opens it.
const FILE =
  /^[\w@.~-]*(\/[\w@.~-]+)*\.(ts|tsx|js|jsx|mjs|cjs|json|jsonc|md|css|scss|less|html|vue|svelte|py|rs|go|java|kt|swift|c|h|cc|cpp|hpp|cs|rb|php|lua|sh|zsh|toml|yaml|yml|xml|sql|txt|lock|env)$/;
const URL_PATTERN = /\bhttps?:\/\/[^\s<>"'`]*[^\s<>"'`.,;:!?)\]]/g;

const STATUS: Record<AgentState, [string, string]> = {
  typing: ['', 'Playing: typing'],
  read: ['read', 'Read this'],
  running: ['', 'Running a command'],
  thinking: ['dim', 'Waiting for agent'],
  absent: ['dim', "Agent isn't listening"],
  paused: ['dim', 'Paused'],
  listening: ['ring', 'Your move'],
  navigator: ['ring', 'Your turn'],
};

const ENDED = { agent: 'The agent ended the session', programmer: 'You ended the session', disconnected: 'The agent disconnected' };

// Tooltips: an element's data-tip shows under it after a moment's hover, or at once while one is
// showing or just was, the way VS Code's own hovers do; and on keyboard focus. A click hides it.
const TIP_DELAY_MS = 500;
const TIP_WARM_MS = 300;
/** The delays in force: the shipped ones until the extension says otherwise (`timings`). */
let tipDelayMs = TIP_DELAY_MS;
let tipWarmMs = TIP_WARM_MS;
const TIP_GAP = 4;
const TIP_MARGIN = 6;

/** A press held this long pauses only the reading countdown. */
const READING_HOLD_MS = 400;

/** The tallest the reply box grows, in pixels, before it scrolls. */
const REPLY_MAX_HEIGHT = 120;
/** A shell's exit code after Ctrl+C, and after SIGTERM. */
const EXIT_INTERRUPTED = 130;
const EXIT_TERMINATED = 143;
/** A speed shown with one decimal is a whole number of tenths. */
const TENTHS = 10;
/** How close a menu speed must be to the setting to count as chosen. */
const SPEED_TOLERANCE = 0.01;
/** Display small speech charges without rounding a positive amount to zero. */
const COST_DECIMALS = 6;
const COMPACT_COST_DECIMALS = 4;
const MIN_COMPACT_COST = 0.0001;
const MIN_DISPLAYABLE_COST = 0.000001;

type RunPhase = Extract<PanelEvent, { type: 'run' }>['phase'];

/** Returns the page's element marked `data-ui="name"`, as the element it is. */
function $<T extends HTMLElement>(name: string, type: abstract new () => T): T {
  const el = document.querySelector(`[data-ui="${name}"]`);
  if (!(el instanceof type)) throw new Error(`The panel has no ${type.name} [data-ui="${name}"]`);
  return el;
}

const ui = {
  band: $('band', HTMLElement),
  settings: $('settings', HTMLButtonElement),
  voiceStatus: $('voice-status', HTMLButtonElement),
  settingsDialog: $('settings-dialog', HTMLDialogElement),
  settingsClose: $('settings-close', HTMLButtonElement),
  configureShortcuts: $('configure-shortcuts', HTMLButtonElement),
  chatOrder: $('chat-order', HTMLSelectElement),
  navigatorCommentary: $('navigator-commentary', HTMLSelectElement),
  settingsCodePlayback: $('settings-code-playback', HTMLSelectElement),
  copyDiagnostics: $('copy-diagnostics', HTMLButtonElement),
  speechEnabled: $('speech-enabled', HTMLInputElement),
  speechProvider: $('speech-provider', HTMLSelectElement),
  speechOutput: $('speech-output', HTMLSelectElement),
  speechOutputRefresh: $('speech-output-refresh', HTMLButtonElement),
  speechOutputStatus: $('speech-output-status', HTMLElement),
  speechLocal: $('speech-local', HTMLElement),
  speechLocalModel: $('speech-local-model', HTMLElement),
  speechCloud: $('speech-cloud', HTMLElement),
  openRouter: $('openrouter', HTMLElement),
  openRouterKeyStatus: $('openrouter-key-status', HTMLElement),
  openRouterKeySet: $('openrouter-key-set', HTMLButtonElement),
  openRouterKeyRemove: $('openrouter-key-remove', HTMLButtonElement),
  openRouterLoad: $('openrouter-load', HTMLButtonElement),
  openRouterModel: $('openrouter-model', HTMLSelectElement),
  openRouterVoice: $('openrouter-voice', HTMLSelectElement),
  openRouterFormat: $('openrouter-format', HTMLSelectElement),
  speechContext: $('speech-context', HTMLSelectElement),
  speechContextCapability: $('speech-context-capability', HTMLElement),
  openRouterZdr: $('openrouter-zdr', HTMLButtonElement),
  openRouterStatus: $('openrouter-status', HTMLElement),
  speechKeyStatus: $('speech-key-status', HTMLElement),
  speechKeySet: $('speech-key-set', HTMLButtonElement),
  speechKeyRemove: $('speech-key-remove', HTMLButtonElement),
  speechCloudVoice: $('speech-cloud-voice', HTMLSelectElement),
  speechCloudSpeed: $('speech-cloud-speed', HTMLSelectElement),
  speechVoicesLoad: $('speech-voices-load', HTMLButtonElement),
  speechVoicesMore: $('speech-voices-more', HTMLButtonElement),
  speechVoice: $('speech-voice', HTMLSelectElement),
  speechSpeed: $('speech-speed', HTMLSelectElement),
  speechListeningSpeed: $('speech-listening-speed', HTMLInputElement),
  speechListeningSpeedValue: $('speech-listening-speed-value', HTMLElement),
  speechSetup: $('speech-setup', HTMLButtonElement),
  speechSetupPrimary: $('speech-setup-primary', HTMLElement),
  speechSetupSecondary: $('speech-setup-secondary', HTMLElement),
  speechCompute: $('speech-compute', HTMLSelectElement),
  gpuStatus: $('gpu-status', HTMLElement),
  gpuDetails: $('gpu-details', HTMLElement),
  gpuCheck: $('gpu-check', HTMLButtonElement),
  speechModelStatus: $('speech-model-status', HTMLElement),
  speechModelDetails: $('speech-model-details', HTMLElement),
  speechPreview: $('speech-preview', HTMLButtonElement),
  speechStop: $('speech-stop', HTMLButtonElement),
  speechSettingsStatus: $('speech-settings-status', HTMLElement),
  speechLive: $('speech-live', HTMLElement),
  speechLiveStatus: $('speech-live-status', HTMLElement),
  speechStopLive: $('speech-stop-live', HTMLButtonElement),
  speechCost: $('speech-cost', HTMLElement),
  showTerminals: $('show-terminals', HTMLInputElement),
  commandApprovalSound: $('command-approval-sound', HTMLInputElement),
  commandApprovalsStatus: $('command-approvals-status', HTMLElement),
  revokeCommandApprovals: $('revoke-command-approvals', HTMLButtonElement),
  showTerminal: $('show-terminal', HTMLButtonElement),
  dot: $('dot', HTMLElement),
  skipReading: $('skip-reading', HTMLButtonElement),
  status: $('status-text', HTMLElement),
  pause: $('pause', HTMLButtonElement),
  revealCursor: $('reveal-cursor', HTMLButtonElement),
  attention: $('attention', HTMLButtonElement),
  interrupt: $('interrupt', HTMLButtonElement),
  turn: $('turn', HTMLButtonElement),
  turnLabel: $('turn-label', HTMLElement),
  speed: $('speed', HTMLButtonElement),
  speedMenu: $('speed-menu', HTMLElement),
  codeMode: $('code-mode', HTMLButtonElement),
  codeModeMenu: $('code-mode-menu', HTMLElement),
  readingSpeed: $('reading-speed', HTMLButtonElement),
  readingMenu: $('reading-menu', HTMLElement),
  passage: $('passage', HTMLElement),
  passageText: $('passage-text', HTMLElement),
  passageNotice: $('passage-notice', HTMLElement),
  end: $('end', HTMLButtonElement),
  now: $('now-text', HTMLElement),
  ref: $('now-ref', HTMLElement),
  idleTitle: $('idle-title', HTMLElement),
  idleSummary: $('idle-summary', HTMLElement),
  idleText: $('idle-text', HTMLElement),
  start: $('start', HTMLButtonElement),
  starting: $('starting', HTMLElement),
  reply: $('reply', HTMLTextAreaElement),
  replyBehavior: $('reply-behavior', HTMLSelectElement),
  send: $('send', HTMLButtonElement),
  attach: $('attach', HTMLElement),
  attachRef: $('attach-ref', HTMLElement),
  attachX: $('attach-x', HTMLButtonElement),
  run: $('run', HTMLElement),
  runLabel: $('run-label', HTMLElement),
  runCmd: $('run-cmd', HTMLElement),
  runGo: $('run-go', HTMLButtonElement),
  runAlways: $('run-always', HTMLButtonElement),
  runAll: $('run-all', HTMLButtonElement),
  runSkip: $('run-skip', HTMLButtonElement),
  history: $('history', HTMLElement),
  tip: $('tip', HTMLElement),
};

let chatOrder: ChatOrder = 'newestFirst';
let voiceFacts: AudioDiagnostics | undefined;
let voiceCompute: SpeechComputeState | undefined;
let voiceTransport = false;
let voiceSettingsValid: boolean | undefined;
let speechPage = 0;
let speechId = 0;
let speechCanceled = false;
let speechState: SpeechState = 'idle';
let speechEnabled = false;
let speechProvider: 'kokoro' | 'elevenlabs' | 'openrouter' = 'kokoro';
let openRouterModel = '';
let openRouterVoice = '';
let openRouterZdr = false;
let openRouterFormat: 'pcm' | 'mp3' = 'mp3';
let openRouterHasKey = false;
let openRouterCatalogVerified = false;
let openRouterModels: OpenRouterModel[] = [];
let cloudVoice = '';
let cloudSpeed = 1;
let cloudSupported = false;
let cloudHasKey = false;
let cloudLoading = false;
let speechSupported = false;
let player: HTMLAudioElement | undefined;
/**
 * Returns the one audio element every clip plays through. A browser that wants
 * a user gesture unlocks an element, not the page, so narration that starts
 * long after a click plays only through an element a gesture already played
 * (#39).
 */
function sharedPlayer(): HTMLAudioElement {
  player ??= new Audio();
  return player;
}
/** Unlocks the shared player during a gesture, unless a clip is playing. */
function unlockPlayer(): void {
  const audio = sharedPlayer();
  if (!audio.paused) return;
  audio.play().catch(() => {
    // An empty or retired source rejects; the gesture has unlocked it anyway.
  });
  audio.pause();
}
const approvalSound = new ApprovalSound();
function unlockAudio(): void {
  unlockPlayer();
  if (ui.commandApprovalSound.checked) approvalSound.unlock();
}
document.addEventListener('pointerdown', unlockAudio, /* useCapture= */ true);
document.addEventListener('keydown', unlockAudio, /* useCapture= */ true);
window.addEventListener('unload', () => {
  approvalSound.dispose();
});
const speechAudio = new SpeechAudio(
  (base64) => {
    const bytes = decodeWav(base64);
    const url = URL.createObjectURL(new Blob([Uint8Array.from(bytes).buffer], { type: 'audio/wav' }));
    try {
      const audio = sharedPlayer();
      // Aborting drops this clip's listeners, so a retired clip's late error
      // cannot fail the next one; a new source also discards queued events.
      const listeners = new AbortController();
      audio.src = url;
      return {
        audio: {
          play: () => audio.play(),
          pause: () => {
            audio.pause();
          },
          addEventListener: (type, listener) => {
            audio.addEventListener(type, listener, { signal: listeners.signal });
          },
        },
        revoke: () => {
          listeners.abort();
          URL.revokeObjectURL(url);
        },
      };
    } catch (error) {
      URL.revokeObjectURL(url);
      throw error;
    }
  },
  (event) => {
    vscode.postMessage({ type: 'speechEvent', ...event });
  },
);

let followingLatest = true;
let historyHeight = 0;
let historyScrollHeight = 0;
let active = false;
let calibrating = false;
let turn = 'agent';
let paused = false;
let speechPaused = false;
let attention: 'none' | 'requested' | 'granted' = 'none';
let replaying = false;
/** The session's agent is gone, and the session waits for it to come back (#25). */
let suspended = false;
let ready = 0;
/** The agent's state, as the extension last reported it. */
let state: AgentState | undefined = undefined;
/** The programmer's selection, offered with the reply. */
let selection: Ref | undefined = undefined;
/** The programmer dismissed the selection, so it isn't offered until it changes. */
let selectionDismissed = false;
/** The command shown in the run box. */
let runId: number | undefined = undefined;
/** The run box waits for the programmer's decision on its command. */
let runConfirming = false;
/** Confirmations already shown in this Pair session, including replayed ones. */
const shownApprovals = new Set<number>();
/** Text of the current message. */
let current: string | undefined = undefined;
/** Whether the current message is in the history already. */
let filed = false;
/** The reading pause under way: its length, and how much of it has elapsed, as of `last`. */
let reading: { ms: number; elapsed: number; last: number; held: boolean; id?: number } | undefined = undefined;
/** A link to the code the agent just pointed at, shown with the message about it. */
let pointed: HTMLAnchorElement | undefined = undefined;
/** A physical pointer or Space gesture is bound to the ID it started on. */
let readingGesture:
  { id: number; timer: ReturnType<typeof setTimeout>; held: boolean; kind: 'pointer' | 'keyboard'; pointerId?: number } | undefined;
let readingClick: { id: number; suppress: boolean } | undefined;
let draftEmpty = true;
let tipTarget: HTMLElement | undefined = undefined;
let tipTimer: ReturnType<typeof setTimeout> | undefined;
/** The element a hover waits to show the tip of, while `tipTimer` runs. */
let tipPending: HTMLElement | undefined;
let tipWarmUntil = 0;

// ---- Messages as HTML ------------------------------------------------------

function esc(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function codeSpan(code: string): string {
  return FILE.test(code) && !code.startsWith('.') ? `<a href="#" class="file" data-file="${code}">${code}</a>` : `<code>${code}</code>`;
}

function rich(s: string): string {
  return esc(s)
    .split(/(`[^`]+`)/)
    .map((part, i) =>
      i % 2 === 1 ? codeSpan(part.slice(1, -1)) : part.replace(URL_PATTERN, (u) => `<a href="#" class="url" data-url="${u}">${u}</a>`),
    )
    .join('');
}

// ---- The history -----------------------------------------------------------

function entry(cls: string, html?: string): HTMLElement {
  const el = document.createElement('div');
  el.className = `entry ${cls}`;
  if (html !== undefined) el.innerHTML = html;
  return el;
}

/** Inserts an entry at the newest edge of the history. */
function insertHistory(el: HTMLElement): void {
  if (chatOrder === 'newestFirst') {
    ui.history.prepend(el);
  } else {
    const atEnd = ui.history.scrollHeight - ui.history.clientHeight - ui.history.scrollTop <= 1;
    ui.history.append(el);
    if (atEnd) ui.history.scrollTop = ui.history.scrollHeight;
  }
}

/** Files the current message once before the next entry (specs/Panel.tla, `WithMessageFiled`). */
function fileCurrent(): void {
  if (current !== undefined && !filed) {
    const message = entry('agent', rich(current));
    message.append(...ui.ref.childNodes);
    insertHistory(message);
    ui.now.textContent = '';
  }
  filed = true;
}

function add(el: HTMLElement): HTMLElement {
  // The current message came before this entry, so it is filed first
  // (specs/Panel.tla, `AddEntry`; specs/PanelScroll.tla, `AddEntry`).
  fileCurrent();
  insertHistory(el);
  return el;
}

function addDivider(text: string): void {
  add(entry('divider')).textContent = text;
}

/** Makes a link to code; it has an href, so it takes focus and Enter (#16). */
function codeLink(text: string, file: string, line: number): HTMLAnchorElement {
  const a = document.createElement('a');
  a.href = '#';
  a.className = 'ref';
  a.textContent = text;
  a.addEventListener('click', () => {
    vscode.postMessage({ type: 'open', file, line });
  });
  return a;
}

function refLink(ref: Ref): HTMLAnchorElement {
  return codeLink(`${ref.file}:${ref.line}${ref.endLine > ref.line ? `${RANGE_DASH}${ref.endLine}` : ''}`, ref.file, ref.line);
}

/** Adds the files changed on disk outside the protocol, each a link to its diff (#15). */
function addOutside(files: string[]): void {
  const el = entry('outside');
  el.append(files.length === 1 ? '' : `${files.length} files changed outside the editor: `);
  files.forEach((file, i) => {
    if (i > 0) el.append(', ');
    const a = document.createElement('a');
    a.href = '#';
    a.className = 'change';
    a.textContent = file;
    a.addEventListener('click', () => {
      vscode.postMessage({ type: 'openChange', file });
    });
    el.append(a);
  });
  if (files.length === 1) el.append(' changed outside the editor');
  add(el);
}

function addYou(text: string | undefined, ref: Ref | undefined): void {
  const el = entry('you', text === undefined ? '' : rich(text));
  if (ref) el.append(refLink(ref));
  add(el);
  // specs/PanelScroll.tla, `AddYours`: reveal the programmer's message at the newest edge.
  ui.history.scrollTop = chatOrder === 'newestFirst' ? 0 : ui.history.scrollHeight;
}

/** Writes how a run went into `outcome`, the span of its row `el`. */
function setOutcome(el: Element, outcome: Element, phase: RunPhase, exitCode: number | undefined): void {
  outcome.className = 'outcome';
  el.classList.toggle('skipped', phase === 'declined');
  if (phase === 'declined') {
    outcome.textContent = 'skipped';
  } else if (phase === 'background') {
    outcome.textContent = 'still running';
  } else if (exitCode === undefined) {
    outcome.textContent = 'status unknown';
  } else if (exitCode === 0) {
    outcome.classList.add('ok');
    outcome.textContent = 'exit 0';
  } else if (exitCode === EXIT_INTERRUPTED || exitCode === EXIT_TERMINATED) {
    // Interrupted (Ctrl+C) or terminated, like a server being restarted: not a failure.
    outcome.textContent = 'stopped';
  } else {
    outcome.classList.add('fail');
    outcome.textContent = `exit ${exitCode}`;
  }
}

function addRun(id: number, command: string, phase: RunPhase, exitCode: number | undefined): void {
  const el = entry('run');
  el.dataset.run = String(id);
  const cmd = document.createElement('span');
  cmd.className = 'cmd';
  cmd.textContent = command;
  cmd.dataset.tip = command;
  const outcome = document.createElement('span');
  el.append(cmd, outcome);
  if (phase !== 'declined') {
    const show = document.createElement('button');
    show.type = 'button';
    show.className = 'quiet';
    show.dataset.showTerminal = String(id);
    show.textContent = 'Show terminal';
    el.append(show);
  }
  setOutcome(el, outcome, phase, exitCode);
  add(el);
}

// ---- The band --------------------------------------------------------------

function attaching(): boolean {
  return active && selection !== undefined && !selectionDismissed;
}

function syncAttach(): void {
  ui.attach.classList.toggle('on', attaching());
  if (attaching() && selection) ui.attachRef.replaceChildren(refLink(selection));
}

// Fades something new in the band in, restarting the fade if it's still going.
function arrive(el: HTMLElement): void {
  if (replaying) return;
  el.classList.remove('arrive');
  void el.offsetWidth;
  el.classList.add('arrive');
}

// specs/Panel.tla, `Say`.
function setNow(text: string): void {
  fileCurrent();
  current = text;
  filed = false;
  ui.now.classList.remove('empty');
  ui.now.innerHTML = rich(text);
  // The agent points first, then says what's there.
  ui.ref.replaceChildren(...(pointed ? [pointed] : []));
  pointed = undefined;
  arrive(ui.now);
}

// The reading speed calibration (#109): its instructions in the band, the passage under them.
function showCalibration(view: CalibrationView): void {
  calibrating = view.phase === 'armed' || view.phase === 'reading';
  document.body.classList.toggle('calibrating', calibrating);
  ui.reply.disabled = !active && !calibrating;
  ui.passage.hidden = view.phase !== 'reading';
  switch (view.phase) {
    case 'armed':
      setNow(
        `Reading speed calibration. When you type go, the passage appears: ${view.title}. Read it at the pace at which you read and understand it, and the moment you finish, type x.`,
      );
      return;
    case 'reading':
      ui.passageText.textContent = view.text;
      ui.passageNotice.textContent = view.notice ?? '';
      setNow(`${view.title}. Type x the moment you finish.`);
      return;
    case 'done':
      setNow(
        `Measured ${Math.round(view.msPerChar)} ms per character, about ${view.wordsPerMinute} words a minute. Saved to your settings: every message now gets its own time at that pace.`,
      );
      return;
    case 'idle':
      setNow('Calibration canceled; the reading speed is unchanged.');
      return;
    default:
  }
}

function syncReading(): void {
  ui.dot.classList.toggle('reading', reading !== undefined && active && !suspended);
  ui.skipReading.disabled =
    reading?.id === undefined || !active || suspended || paused || turn !== 'agent' || state !== 'read' || runConfirming;
}

/** Changes the live status only when its text changes, avoiding repeated announcements. */
function statusText(text: string): void {
  if (active && !suspended && ready > 0) text += `${LABEL_SEPARATOR}${ready} ready`;
  if (ui.status.textContent !== text) ui.status.textContent = text;
}

function hideTip(): void {
  clearTimeout(tipTimer);
  tipPending = undefined;
  if (!tipTarget) return;
  tipTarget.removeAttribute('aria-describedby');
  tipTarget = undefined;
  ui.tip.hidden = true;
  tipWarmUntil = performance.now() + tipWarmMs;
}

// Under the element, centered on it, inside the panel; above it if there's no room below.
function placeTip(target: HTMLElement): void {
  const r = target.getBoundingClientRect();
  const w = ui.tip.offsetWidth;
  const h = ui.tip.offsetHeight;
  const left = Math.max(TIP_MARGIN, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - TIP_MARGIN));
  const top = r.bottom + TIP_GAP + h <= innerHeight - TIP_MARGIN ? r.bottom + TIP_GAP : r.top - TIP_GAP - h;
  ui.tip.style.left = `${left}px`;
  ui.tip.style.top = `${Math.max(TIP_MARGIN, top)}px`;
}

function setTip(el: HTMLElement, text: string): void {
  el.dataset.tip = text;
  if (el === tipTarget) {
    ui.tip.textContent = text;
    placeTip(el);
  }
}

function syncStatus(): void {
  const showPause = active && !suspended && paused;
  const explainListening = active && !suspended && !paused && !runConfirming && turn === 'agent' && state === 'listening';
  if (explainListening || (active && suspended)) {
    setTip(
      ui.status,
      suspended
        ? 'Ask your agent to start pairing again in the same project, or end this session.'
        : 'The agent is listening for your reply. You can reply, ask a question, or say continue; it may continue after waiting.',
    );
    ui.status.tabIndex = 0;
  } else {
    if (tipTarget === ui.status || tipPending === ui.status) hideTip();
    delete ui.status.dataset.tip;
    ui.status.removeAttribute('tabindex');
  }
  const playing = active && !suspended && !paused && !runConfirming && turn === 'agent' && (state === 'typing' || state === 'running');
  ui.status.classList.toggle('is-paused', showPause);
  ui.status.classList.toggle('is-playing', playing);
  if (!active) {
    ui.dot.className = 'dot off';
    syncReading();
    statusText('No session');
    return;
  }
  if (suspended) {
    ui.dot.className = 'dot off';
    syncReading();
    statusText('Suspended: waiting for the agent');
    return;
  }
  if (showPause) {
    ui.dot.className = 'dot paused-indicator';
    syncReading();
    statusText(
      runConfirming ? `Paused${LABEL_SEPARATOR}Needs you` : turn === 'programmer' ? `Paused${LABEL_SEPARATOR}Your turn` : 'Paused',
    );
    return;
  }
  if (!runConfirming && turn === 'agent' && speechState === 'speaking' && reading === undefined) {
    ui.dot.className = 'dot';
    syncReading();
    statusText('Speaking');
    return;
  }
  const [cls, text] = runConfirming ? ['read', 'Needs you'] : state ? STATUS[state] : ['', 'Session started'];
  ui.dot.className = `dot ${cls}`;
  syncReading();
  statusText(text);
}

// ---- Tooltips --------------------------------------------------------------

/** Silences locally before an interruption can cross the webview boundary. */
function stopSpeechLocally(): void {
  speechCanceled = true;
  speechAudio.stop();
  if (speechState !== 'idle') {
    speechState = 'idle';
    ui.speechLive.hidden = true;
    ui.speechSettingsStatus.textContent = 'Speech stopped.';
    syncStatus();
  }
}

function tick(now: number, countdown: NonNullable<typeof reading>): void {
  if (reading !== countdown) return;
  if (!paused && !countdown.held) countdown.elapsed += now - countdown.last;
  countdown.last = now;
  const f = Math.min(1, countdown.elapsed / countdown.ms);
  ui.dot.style.setProperty('--progress', String(f));
  if (f >= 1) {
    reading = undefined;
    syncStatus();
    return;
  }
  requestAnimationFrame((time) => {
    tick(time, countdown);
  });
}

// The reading pause fills a ring around the status dot.
function startReading(ms: number, id?: number): void {
  if (replaying) return;
  const countdown = { ms, elapsed: 0, last: performance.now(), held: false, id };
  reading = countdown;
  ui.dot.style.setProperty('--progress', '0');
  syncReading();
  requestAnimationFrame((time) => {
    tick(time, countdown);
  });
}

function showTip(el: HTMLElement): void {
  clearTimeout(tipTimer);
  tipPending = undefined;
  if (
    (el === ui.speed && ui.speedMenu.hidden === false) ||
    (el === ui.readingSpeed && ui.readingMenu.hidden === false) ||
    (el === ui.codeMode && ui.codeModeMenu.hidden === false)
  ) {
    return;
  }
  tipTarget = el;
  ui.tip.textContent = el.dataset.tip ?? '';
  ui.tip.hidden = false;
  el.setAttribute('aria-describedby', 'tip');
  placeTip(el);
}

function hoverTip(el: HTMLElement | undefined): void {
  // The same element again, shown or waited for: a move between its children. Anything else ends the wait.
  if (el === (tipTarget ?? tipPending)) return;
  const warm = tipTarget !== undefined || performance.now() < tipWarmUntil;
  hideTip();
  if (!el) return;
  if (warm) {
    showTip(el);
  } else {
    tipPending = el;
    tipTimer = setTimeout(() => {
      showTip(el);
    }, tipDelayMs);
  }
}

// The element went away or moved, when the panel changed under it.
function syncTip(): void {
  if (!tipTarget) return;
  if (tipTarget.getClientRects().length === 0) {
    hideTip();
  } else {
    placeTip(tipTarget);
  }
}

/** Returns the element an event happened on, if it is one. */
function elementOf(e: Event): HTMLElement | undefined {
  return e.target instanceof HTMLElement ? e.target : undefined;
}

// ---- The session's state ---------------------------------------------------

function setState(e: Extract<PanelEvent, { type: 'state' }>): void {
  // specs/CodePlayback.tla, `Finish` and `Interrupt`: no countdown survives playback.
  if (e.state !== 'read' && !e.paused) reading = undefined;
  state = e.state;
  ready = e.ready ?? 0;
  turn = e.turn;
  paused = e.paused;
  speechPaused = e.speechPaused ?? e.paused;
  document.body.classList.toggle('paused', paused);
  document.body.classList.toggle('programmer-turn', turn === 'programmer');
  ui.pause.classList.toggle('on', paused);
  ui.pause.setAttribute('aria-label', paused ? 'Resume' : 'Pause');
  setTip(ui.pause, paused ? 'Resume (Space)' : 'Pause (Space)');
  ui.turnLabel.textContent = turn === 'programmer' ? 'Hand back' : 'My turn';
  ui.turn.setAttribute('aria-label', ui.turnLabel.textContent);
  setTip(
    ui.turn,
    turn === 'programmer'
      ? 'Hand the turn back to the agent, with your reply if you typed one'
      : 'Take the turn: you drive, the agent navigates',
  );
  syncStatus();
  syncTip();
}

/** Clears the run box. */
function clearRun(): void {
  runId = undefined;
  runConfirming = false;
  ui.run.classList.remove('on', 'confirm');
  ui.run.removeAttribute('role');
}

/** Keeps the active mode in the pace control's accessible name and menu. */
function setCodePlayback(value: CodePlayback): void {
  // specs/PlaybackPreference.tla, `Choose` and `Reload`.
  ui.settingsCodePlayback.value = value;
  for (const item of ui.codeModeMenu.querySelectorAll<HTMLButtonElement>('button[data-code-playback]')) {
    item.setAttribute('aria-checked', String(item.dataset.codePlayback === value));
  }
  const label = value === 'typing' ? 'Typing' : value === 'lines' ? 'Lines' : 'Blocks';
  ui.codeMode.textContent = label;
  ui.codeMode.setAttribute('aria-label', `Code display: ${label}`);
}

/** Keeps menus inside the viewport while retaining their trigger as the anchor. */
function placeMenu(button: HTMLButtonElement, menu: HTMLElement, keepFocusVisible = false): void {
  const margin = 6;
  menu.style.maxHeight = `${Math.max(0, window.innerHeight - margin * 2)}px`;
  const anchor = button.getBoundingClientRect();
  const bounds = menu.getBoundingClientRect();
  const left = Math.max(margin, Math.min(anchor.right - bounds.width, window.innerWidth - margin - bounds.width));
  const below = anchor.bottom;
  const top = below + bounds.height <= window.innerHeight - margin ? below : anchor.top - bounds.height;
  menu.style.left = `${left}px`;
  menu.style.top = `${Math.max(margin, Math.min(top, window.innerHeight - margin - bounds.height))}px`;
  const focused = document.activeElement;
  if (keepFocusVisible && focused instanceof HTMLElement && menu.contains(focused)) {
    const item = focused.getBoundingClientRect();
    const visible = menu.getBoundingClientRect();
    if (item.bottom > visible.bottom) menu.scrollTop += item.bottom - visible.bottom;
    if (item.top < visible.top) menu.scrollTop -= visible.top - item.top;
  }
}

const menuClosers: Array<() => void> = [];

/** Wires a speed menu to its button, and returns what closes it. */
function speedMenu(button: HTMLButtonElement, menu: HTMLElement, type: 'speed' | 'readingSpeed' | 'codePlayback'): () => void {
  function close(): void {
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    button.classList.remove('on');
  }
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = menu.hidden === true;
    // specs/PanelMenus.tla, `Open` and `Close`.
    if (open) {
      for (const closeMenu of menuClosers) closeMenu();
    }
    menu.hidden = !open;
    if (open) placeMenu(button, menu);
    button.setAttribute('aria-expanded', String(open));
    button.classList.toggle('on', open);
    if (open) {
      const selected = menu.querySelector<HTMLElement>('[aria-checked="true"]') ?? menu.querySelectorAll<HTMLElement>('button').item(0);
      selected.focus({ preventScroll: true });
      menu.scrollTop = selected.offsetTop - menu.clientHeight / 2 + selected.offsetHeight / 2;
    }
  });
  for (const b of menu.querySelectorAll('button')) {
    b.addEventListener('click', () => {
      close();
      button.focus();
      const mode = b.dataset.codePlayback;
      if (mode === 'typing' || mode === 'lines' || mode === 'blocks') {
        setCodePlayback(mode);
        vscode.postMessage({ type: 'codePlayback', value: mode });
        return;
      }
      if (type !== 'codePlayback') vscode.postMessage({ type, value: Number(b.dataset.speed) });
    });
  }
  document.addEventListener('click', (e) => {
    if (menu.hidden === false && !(e.target instanceof Node && menu.contains(e.target))) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menu.hidden === false) {
      close();
      button.focus();
    }
  });
  menuClosers.push(close);
  return close;
}
const closeSpeedMenu = speedMenu(ui.speed, ui.speedMenu, 'speed');
const closeCodeModeMenu = speedMenu(ui.codeMode, ui.codeModeMenu, 'codePlayback');
const closeReadingMenu = speedMenu(ui.readingSpeed, ui.readingMenu, 'readingSpeed');

/** Repositions an open menu after the viewport or its anchor moves. */
function repositionMenus(keepFocusVisible = false): void {
  if (ui.speedMenu.hidden === false) placeMenu(ui.speed, ui.speedMenu, keepFocusVisible);
  if (ui.codeModeMenu.hidden === false) placeMenu(ui.codeMode, ui.codeModeMenu, keepFocusVisible);
  if (ui.readingMenu.hidden === false) placeMenu(ui.readingSpeed, ui.readingMenu, keepFocusVisible);
}
window.addEventListener('resize', () => {
  repositionMenus(true);
});
document.addEventListener(
  'scroll',
  () => {
    repositionMenus();
  },
  /* useCapture= */ true,
);

function setActive(on: boolean): void {
  active = on;
  document.body.classList.toggle('active', on);
  ui.reply.disabled = !on && !calibrating;
  ui.attention.disabled = !on;
  if (!on) {
    ready = 0;
    suspended = false;
    reading = undefined;
    // specs/RunBox.tla, `EndSession`: the session ending clears the box.
    clearRun();
    closeSpeedMenu();
    closeCodeModeMenu();
    closeReadingMenu();
  }
  syncStatus();
  syncAttach();
  syncTip();
}

// One decimal, so the menu's speeds line up; a setting with more keeps them.
function showSpeed(button: HTMLButtonElement, menu: HTMLElement, name: string, prefix: string, value: number): void {
  const label = `${Number.isInteger(value * TENTHS) ? value.toFixed(1) : String(value)}${SPEED_SUFFIX}`;
  button.textContent = prefix + label;
  button.setAttribute('aria-label', `${name}: ${label}`);
  for (const b of menu.querySelectorAll<HTMLButtonElement>('button[data-speed]')) {
    b.setAttribute('aria-checked', String(Math.abs(Number(b.dataset.speed) - value) < SPEED_TOLERANCE));
  }
}

/** Applies the order while preserving the view (Panel.tla and PanelScroll.tla, `SwitchOrder`). */
function setChatOrder(value: ChatOrder): void {
  ui.chatOrder.value = value;
  if (value === chatOrder) return;
  const atLatest =
    chatOrder === 'newestFirst' ? ui.history.scrollTop <= 1 : ui.history.scrollHeight - ui.history.clientHeight - ui.history.scrollTop <= 1;
  followingLatest = atLatest;
  const entries = [...ui.history.children];
  const top = ui.history.getBoundingClientRect().top;
  const anchor = entries.find((element) => element.getBoundingClientRect().bottom > top);
  const before = anchor === undefined ? 0 : anchor.getBoundingClientRect().top - top;
  chatOrder = value;
  ui.history.classList.add('reordering');
  document.body.classList.toggle('oldest-first', value === 'oldestFirst');
  ui.history.replaceChildren(...entries.toReversed());
  if (value === 'oldestFirst') {
    ui.band.before(ui.history);
  } else {
    ui.band.after(ui.history);
  }
  ui.history.setAttribute('aria-label', value === 'oldestFirst' ? 'Earlier, oldest first' : 'Earlier, newest first');
  if (atLatest) {
    ui.history.scrollTop = value === 'oldestFirst' ? ui.history.scrollHeight : 0;
  } else if (anchor !== undefined) {
    ui.history.scrollTop += anchor.getBoundingClientRect().top - ui.history.getBoundingClientRect().top - before;
  }
  requestAnimationFrame(() => {
    ui.history.classList.remove('reordering');
  });
}

// A growing composer or a resized panel must keep the newest edge in view only
// while the reader was already following it.
ui.history.addEventListener('scroll', () => {
  // A resize can emit scroll before ResizeObserver; retain the prior follow state.
  if (ui.history.clientHeight !== historyHeight) return;
  followingLatest = ui.history.scrollHeight - ui.history.clientHeight - ui.history.scrollTop <= 1;
  historyScrollHeight = ui.history.scrollHeight;
});
const historyResize = new ResizeObserver(() => {
  repositionMenus(true);
  historyHeight = ui.history.clientHeight;
  historyScrollHeight = ui.history.scrollHeight;
  if (chatOrder === 'oldestFirst' && followingLatest) ui.history.scrollTop = ui.history.scrollHeight;
});
historyResize.observe(ui.band);
historyResize.observe(ui.history);

// specs/Panel.tla, `OpenSettings` and `CloseSettings`.
/** Starts a timed gesture, capturing the countdown ID before it can change. */
function beginReadingGesture(kind: 'pointer' | 'keyboard', pointerId?: number): void {
  if (readingGesture !== undefined || ui.skipReading.disabled || reading?.id === undefined) return;
  readingClick = undefined;
  const id = reading.id;
  const gesture = {
    id,
    kind,
    pointerId,
    held: false,
    timer: setTimeout(() => {
      if (readingGesture !== gesture || reading?.id !== id || ui.skipReading.disabled) return;
      const now = performance.now();
      reading.elapsed += now - reading.last;
      reading.last = now;
      reading.held = true;
      gesture.held = true;
      vscode.postMessage({ type: 'holdReading', id, held: true });
    }, READING_HOLD_MS),
  };
  readingGesture = gesture;
}

/** Releases a timed gesture without affecting an independent playback pause. */
function endReadingGesture(cancelled: boolean): void {
  const gesture = readingGesture;
  if (gesture === undefined) return;
  clearTimeout(gesture.timer);
  if (gesture.held) {
    if (reading?.id === gesture.id) {
      reading.held = false;
      reading.last = performance.now();
    }
    vscode.postMessage({ type: 'holdReading', id: gesture.id, held: false });
  }
  const click = { id: gesture.id, suppress: cancelled || gesture.held };
  readingClick = click;
  readingGesture = undefined;
  // Native clicks follow release in the same task. Do not let a missing click
  // suppress an unrelated later assistive activation.
  setTimeout(() => {
    if (readingClick === click) readingClick = undefined;
  }, 0);
}

ui.skipReading.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  beginReadingGesture('pointer', event.pointerId);
  if (readingGesture?.kind === 'pointer') {
    try {
      ui.skipReading.setPointerCapture(event.pointerId);
    } catch {
      // A synthetic event or a lost pointer cannot be captured; window events still release it.
    }
  }
});
globalThis.addEventListener('pointerup', (event) => {
  if (readingGesture?.kind === 'pointer' && readingGesture.pointerId === event.pointerId) endReadingGesture(false);
});
globalThis.addEventListener('pointercancel', (event) => {
  if (readingGesture?.kind === 'pointer' && readingGesture.pointerId === event.pointerId) endReadingGesture(true);
});
ui.skipReading.addEventListener('lostpointercapture', (event) => {
  if (readingGesture?.kind === 'pointer' && readingGesture.pointerId === event.pointerId) endReadingGesture(true);
});
ui.skipReading.addEventListener('keydown', (event) => {
  if (event.key === ' ' && !event.repeat) beginReadingGesture('keyboard');
});
globalThis.addEventListener('keyup', (event) => {
  if (event.key === ' ' && readingGesture?.kind === 'keyboard') endReadingGesture(false);
});
window.addEventListener('blur', () => {
  endReadingGesture(true);
});
window.addEventListener('pagehide', () => {
  endReadingGesture(true);
  stopSpeechLocally();
  if (speechPage > 0) vscode.postMessage({ type: 'speechPageHidden', pageId: speechPage });
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    endReadingGesture(true);
    stopSpeechLocally();
    if (speechPage > 0) vscode.postMessage({ type: 'speechPageHidden', pageId: speechPage });
  } else if (speechPage > 0) {
    vscode.postMessage({ type: 'speechPageVisible', pageId: speechPage });
  }
});
ui.skipReading.addEventListener('click', () => {
  const click = readingClick;
  readingClick = undefined;
  const id = click?.id ?? readingGesture?.id ?? reading?.id;
  if (click?.suppress === true || readingGesture?.held === true || ui.skipReading.disabled || id === undefined || reading?.id !== id) {
    return;
  }
  vscode.postMessage({ type: 'skipReading', id });
  reading = undefined;
  syncReading();
});

// specs/DiagnosticsCopy.tla, `Click`: only an explicit request copies diagnostics.
ui.copyDiagnostics.addEventListener('click', () => {
  vscode.postMessage({ type: 'copyDiagnostics' });
});

/** Updates the accessible status from the latest validated host facts. */
function syncVoiceStatus(): void {
  const indicator = voiceIndicator(voiceFacts, voiceCompute, voiceTransport, voiceSettingsValid);
  const labels = {
    off: 'Automatic narration: off',
    checking: 'Voice: readiness not checked',
    starting: 'Voice: model starting',
    ready: 'Voice: ready (checks passed)',
    unavailable: 'Voice: unavailable',
  };
  ui.voiceStatus.dataset.state = indicator;
  ui.voiceStatus.setAttribute('aria-pressed', String(speechEnabled));
  ui.voiceStatus.setAttribute('aria-description', labels[indicator]);
  ui.voiceStatus.dataset.tip = `${speechEnabled ? 'Mute narration' : 'Enable narration'} (${labels[indicator]})`;
  if (tipTarget === ui.voiceStatus) showTip(ui.voiceStatus);
}

// specs/Panel.tla, `OpenSettings` and `CloseSettings`.
let focusReplyAfterSettings = false;
function focusReplyBox(): void {
  if (ui.settingsDialog.open) {
    focusReplyAfterSettings = true;
    ui.settingsDialog.close();
  } else {
    ui.reply.focus();
  }
}
ui.settings.addEventListener('click', () => {
  ui.settingsDialog.showModal();
  ui.chatOrder.focus();
});
ui.settingsClose.addEventListener('click', () => {
  ui.settingsDialog.close();
});
ui.configureShortcuts.addEventListener('click', () => {
  vscode.postMessage({ type: 'command', command: 'aiPair.configureShortcuts' });
});
ui.settingsDialog.addEventListener('close', () => {
  if (focusReplyAfterSettings) {
    focusReplyAfterSettings = false;
    ui.reply.focus();
  } else ui.settings.focus();
});
function isSpeechVoice(value: string): value is SpeechVoice {
  return SPEECH_VOICES.some((voice) => voice === value);
}

/** Shows the selected listening speed while the user moves the slider. */
function showListeningSpeed(): void {
  const label = `${Number(ui.speechListeningSpeed.value).toFixed(2)}x`;
  ui.speechListeningSpeedValue.textContent = label;
  ui.speechListeningSpeed.setAttribute('aria-valuetext', label);
}

function saveSpeechSettings(): void {
  const voice = ui.speechVoice.value;
  const speed = Number(ui.speechSpeed.value);
  const listeningSpeed = Number(ui.speechListeningSpeed.value);
  if (
    !isSpeechVoice(voice) ||
    !SPEECH_SPEEDS.some((option) => option === speed) ||
    !SPEECH_LISTENING_RATES.some((option) => option === listeningSpeed)
  ) {
    return;
  }
  if (speechEnabled && !ui.speechEnabled.checked) stopSpeechLocally();
  speechEnabled = ui.speechEnabled.checked;
  voiceFacts = undefined;
  syncVoiceStatus();
  vscode.postMessage({
    type: 'speechSettings',
    value: {
      enabled: speechEnabled,
      contextEnabled: ui.speechContext.value === 'on',
      voice,
      speed,
      listeningSpeed,
      provider: speechProvider,
      elevenLabsVoice: cloudVoice,
      elevenLabsSpeed: cloudSpeed,
      ...(speechProvider === 'openrouter' || openRouterModel !== '' || openRouterVoice !== '' || openRouterZdr
        ? { openRouterModel, openRouterVoice, openRouterZdr, openRouterFormat }
        : {}),
    },
  });
}
function selectCloudVoice(): void {
  const select = ui.speechCloudVoice;
  if (cloudVoice !== '' && !Array.from(select.options).some((option) => option.value === cloudVoice)) {
    const saved = document.createElement('option');
    saved.value = cloudVoice;
    saved.textContent = 'Saved voice (load voices to change)';
    select.append(saved);
  }
  select.value = cloudVoice;
}
/** Maps only the host's allowlisted category to fixed account guidance. */
function catalogFailure(reason: string | undefined): string {
  switch (reason) {
    case 'no_key':
      return 'Add an ElevenLabs API key to load voices.';
    case 'auth':
      return 'ElevenLabs rejected the key or voice access. Check your key permissions.';
    case 'rate':
      return 'ElevenLabs rate limit or quota reached. Try again later.';
    case 'network':
      return 'Could not connect to ElevenLabs. Check your network.';
    case 'timeout':
      return 'Loading account voices timed out. Try again.';
    case 'invalid':
      return 'ElevenLabs returned an unsupported voice list.';
    case 'canceled':
      return 'Loading account voices was canceled.';
    default:
      return 'Could not load account voices.';
  }
}
let outputReady = true;
function syncSpeechProvider(): void {
  const capabilities = speechContextCapabilities(speechProvider, openRouterModel);
  ui.speechContextCapability.textContent =
    capabilities.previousText && !openRouterZdr
      ? 'Previous context requires Zero Data Retention. Delivery cues and ordinary narration remain available.'
      : capabilities.previousText
        ? 'Previous context and delivery cues supported.'
        : capabilities.tags
          ? 'Delivery cues only; previous context is not supported.'
          : 'Unsupported by this model; ordinary speech only.';
  const cloud = speechProvider === 'elevenlabs';
  ui.speechLocal.hidden = speechProvider !== 'kokoro';
  ui.speechLocalModel.hidden = speechProvider !== 'kokoro';
  ui.openRouter.hidden = speechProvider !== 'openrouter';
  ui.openRouterKeySet.disabled = !cloudSupported;
  ui.openRouterKeyRemove.disabled = !cloudSupported || !openRouterHasKey;
  ui.openRouterLoad.disabled = !cloudSupported || !openRouterHasKey;
  ui.openRouterZdr.setAttribute('aria-pressed', String(openRouterZdr));
  ui.openRouterZdr.textContent = `ZDR filter: ${openRouterZdr ? 'On' : 'Off'}`;
  ui.speechCloud.hidden = !cloud;
  ui.speechProvider.value = speechProvider;
  ui.speechKeySet.disabled = !cloudSupported;
  ui.speechKeyRemove.disabled = !cloudSupported || !cloudHasKey;
  ui.speechVoicesLoad.disabled = !cloudSupported || !cloudHasKey || cloudLoading;
  ui.speechVoicesMore.disabled = !cloudSupported || !cloudHasKey || cloudLoading;
  ui.speechPreview.disabled =
    !outputReady ||
    (cloud
      ? !cloudSupported || !cloudHasKey || cloudVoice === ''
      : speechProvider === 'openrouter'
        ? !cloudSupported ||
          !openRouterHasKey ||
          openRouterModel === '' ||
          (openRouterCatalogVerified &&
            !openRouterModels.some(
              (model) =>
                model.id === openRouterModel && (openRouterVoice === '' || model.voices.some((voice) => voice.id === openRouterVoice)),
            ))
        : !speechSupported);
}

let outputChoices: OutputChoice[] = [{ kind: 'default' }];
ui.speechOutput.addEventListener('change', () => {
  if (ui.speechOutput.value === '') return;
  const choice = outputChoices[Number(ui.speechOutput.value)];
  if (choice === undefined) return;
  vscode.postMessage({ type: 'speechOutputSelect', choice });
});
ui.speechOutputRefresh.addEventListener('click', () => {
  vscode.postMessage({ type: 'speechOutputRefresh' });
});
ui.speechProvider.addEventListener('change', () => {
  const selected = ui.speechProvider.value;
  if (selected !== 'kokoro' && selected !== 'elevenlabs' && selected !== 'openrouter') return;
  if (selected !== speechProvider) stopSpeechLocally();
  if (!ELEVENLABS_SPEEDS.some((speed) => speed === cloudSpeed)) {
    cloudSpeed = 1;
    ui.speechCloudSpeed.value = '1';
  }
  if (!isSpeechVoice(ui.speechVoice.value)) ui.speechVoice.value = 'af_heart';
  if (!SPEECH_SPEEDS.some((speed) => speed === Number(ui.speechSpeed.value))) ui.speechSpeed.value = '1';
  speechProvider = selected;
  syncSpeechProvider();
  saveSpeechSettings();
});
/** Renders only voices advertised by the selected compatible model. */
function renderOpenRouterVoices(): void {
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Use provider default (if supported)';
  ui.openRouterVoice.replaceChildren(placeholder);
  for (const voice of openRouterModels.find((model) => model.id === openRouterModel)?.voices ?? []) {
    const option = document.createElement('option');
    option.value = voice.id;
    option.textContent = voice.name;
    ui.openRouterVoice.append(option);
  }
  if (
    !openRouterCatalogVerified &&
    openRouterVoice !== '' &&
    !Array.from(ui.openRouterVoice.options).some((option) => option.value === openRouterVoice)
  ) {
    const saved = document.createElement('option');
    saved.value = openRouterVoice;
    saved.textContent = 'Saved voice (load models to change)';
    ui.openRouterVoice.append(saved);
  }
  ui.openRouterVoice.value = openRouterVoice;
}
ui.openRouterKeySet.addEventListener('click', () => {
  vscode.postMessage({ type: 'openRouterKeySet' });
});
ui.openRouterKeyRemove.addEventListener('click', () => {
  vscode.postMessage({ type: 'openRouterKeyRemove' });
});
ui.openRouterLoad.addEventListener('click', () => {
  vscode.postMessage({ type: 'openRouterModelsLoad' });
});
ui.openRouterModel.addEventListener('change', () => {
  openRouterModel = ui.openRouterModel.value;
  openRouterVoice = '';
  renderOpenRouterVoices();
  syncSpeechProvider();
  saveSpeechSettings();
});
ui.openRouterVoice.addEventListener('change', () => {
  openRouterVoice = ui.openRouterVoice.value;
  syncSpeechProvider();
  saveSpeechSettings();
});
ui.openRouterFormat.addEventListener('change', () => {
  const value = ui.openRouterFormat.value;
  if (value !== 'pcm' && value !== 'mp3') return;
  openRouterFormat = value;
  saveSpeechSettings();
});
ui.openRouterZdr.addEventListener('click', () => {
  openRouterZdr = !openRouterZdr;
  openRouterModels = [];
  openRouterCatalogVerified = false;
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Choose a model';
  ui.openRouterModel.replaceChildren(placeholder);
  if (openRouterModel !== '') {
    const saved = document.createElement('option');
    saved.value = openRouterModel;
    saved.textContent = 'Saved model (load models to change)';
    ui.openRouterModel.append(saved);
  }
  ui.openRouterModel.value = openRouterModel;
  renderOpenRouterVoices();
  syncSpeechProvider();
  saveSpeechSettings();
  if (cloudSupported && openRouterHasKey) {
    ui.openRouterStatus.textContent = 'Updating the model filter...';
    vscode.postMessage({ type: 'openRouterModelsLoad' });
  } else {
    ui.openRouterStatus.textContent = cloudSupported
      ? 'Add an OpenRouter API key to load compatible models.'
      : 'OpenRouter is unavailable on this host.';
  }
});
ui.speechCloudVoice.addEventListener('change', () => {
  cloudVoice = ui.speechCloudVoice.value;
  syncSpeechProvider();
  saveSpeechSettings();
});
ui.speechCloudSpeed.addEventListener('change', () => {
  const value = Number(ui.speechCloudSpeed.value);
  if (!ELEVENLABS_SPEEDS.some((speed) => speed === value)) return;
  cloudSpeed = value;
  saveSpeechSettings();
});
ui.speechKeySet.addEventListener('click', () => {
  vscode.postMessage({ type: 'speechKeySet' });
});
ui.speechKeyRemove.addEventListener('click', () => {
  vscode.postMessage({ type: 'speechKeyRemove' });
});
ui.speechVoicesLoad.addEventListener('click', () => {
  vscode.postMessage({ type: 'speechVoicesLoad' });
});
ui.speechVoicesMore.addEventListener('click', () => {
  vscode.postMessage({ type: 'speechVoicesMore' });
});
ui.speechEnabled.addEventListener('change', saveSpeechSettings);
ui.speechContext.addEventListener('change', saveSpeechSettings);
ui.voiceStatus.addEventListener('click', () => {
  ui.speechEnabled.checked = !speechEnabled;
  saveSpeechSettings();
});
ui.speechVoice.addEventListener('change', saveSpeechSettings);
ui.speechSpeed.addEventListener('change', saveSpeechSettings);
ui.speechListeningSpeed.addEventListener('input', showListeningSpeed);
ui.speechListeningSpeed.addEventListener('change', () => {
  showListeningSpeed();
  saveSpeechSettings();
});
ui.revokeCommandApprovals.addEventListener('click', () => {
  vscode.postMessage({ type: 'revokeCommandApprovals' });
});

ui.commandApprovalSound.addEventListener('change', () => {
  if (ui.commandApprovalSound.checked) approvalSound.unlock();
  vscode.postMessage({ type: 'commandApprovalSound', value: ui.commandApprovalSound.checked });
});
ui.speechCompute.addEventListener('change', () => {
  const value = ui.speechCompute.value;
  if (value === 'cpu' || value === 'auto' || value === 'gpu') vscode.postMessage({ type: 'speechComputeMode', value });
});
ui.gpuCheck.addEventListener('click', () => {
  vscode.postMessage({ type: 'checkGpuSetup' });
});
ui.speechSetup.addEventListener('click', () => {
  vscode.postMessage({ type: 'speechSetup' });
});
ui.speechPreview.addEventListener('click', () => {
  vscode.postMessage({ type: 'speechPreview' });
});
function stopSpeech(): void {
  stopSpeechLocally();
  vscode.postMessage({ type: 'speechStop' });
}
ui.speechStop.addEventListener('click', stopSpeech);
ui.speechStopLive.addEventListener('click', stopSpeech);

// specs/TerminalPanel.tla, `SetAuto`.
ui.showTerminals.addEventListener('change', () => {
  vscode.postMessage({ type: 'showTerminals', value: ui.showTerminals.checked });
});
ui.showTerminal.addEventListener('click', () => {
  if (runId !== undefined && !runConfirming) vscode.postMessage({ type: 'showTerminal', id: runId });
});

ui.settingsCodePlayback.addEventListener('change', () => {
  const mode = ui.settingsCodePlayback.value;
  if (mode === 'typing' || mode === 'lines' || mode === 'blocks') {
    setCodePlayback(mode);
    vscode.postMessage({ type: 'codePlayback', value: mode });
  }
});

ui.replyBehavior.addEventListener('change', () => {
  const value = ui.replyBehavior.value === 'finishAction' ? 'finishAction' : 'interrupt';
  vscode.postMessage({ type: 'replyBehavior', value });
});

ui.navigatorCommentary.addEventListener('change', () => {
  const value = ui.navigatorCommentary.value;
  if (value === 'quiet' || value === 'helpful' || value === 'coach') vscode.postMessage({ type: 'navigatorCommentary', value });
});

ui.chatOrder.addEventListener('change', () => {
  const value = ui.chatOrder.value === 'oldestFirst' ? 'oldestFirst' : 'newestFirst';
  setChatOrder(value);
  vscode.postMessage({ type: 'chatOrder', value });
});

const COST_REASON_TEXT = {
  'restored': 'Earlier costs are unknown because this session was restored.',
  'missing-generation-id': 'OpenRouter did not return a generation ID.',
  'generation-not-published': 'OpenRouter has not published the generation cost within the lookup window.',
  'generation-lookup-failed': 'The OpenRouter generation cost lookup failed.',
};

/** Renders the provider-confirmed subtotal and any unresolved charges. */
function showSpeechCost(value: SessionSpeechCostView): void {
  ui.speechCost.hidden = !value.seen;
  if (!value.seen) {
    if (tipTarget === ui.speechCost || tipPending === ui.speechCost) hideTip();
    ui.speechCost.dataset.tip = '';
    ui.speechCost.setAttribute('aria-label', '');
    return;
  }
  let detail: string;
  if (value.total === 0 && value.pending > 0) {
    detail = `calculating${ELLIPSIS}${value.partial ? ' (some costs unavailable)' : ''}`;
  } else if (value.total === 0 && value.partial) {
    detail = 'cost unavailable';
  } else {
    const amount = value.total > 0 && value.total < MIN_DISPLAYABLE_COST ? '<$0.000001' : `$${value.total.toFixed(COST_DECIMALS)}`;
    const costState =
      value.pending > 0 ? (value.partial ? ' (updating; incomplete)' : ' (updating)') : value.partial ? ' (incomplete)' : '';
    detail = `${amount}${costState}`;
  }
  const reasons = value.reasons?.map((reason) => COST_REASON_TEXT[reason]).join(' ') ?? '';
  const explanation = `OpenRouter speech this session: ${detail}${reasons === '' ? '' : ` ${reasons}`}`;
  ui.speechCost.dataset.tip = explanation;
  ui.speechCost.setAttribute('aria-label', explanation);
  let compact: string;
  if (value.total === 0 && value.pending > 0) {
    compact = `calculating${ELLIPSIS}`;
  } else if (value.total === 0 && value.partial) {
    compact = 'unavailable';
  } else {
    compact = value.total > 0 && value.total < MIN_COMPACT_COST ? '<$0.0001' : `$${value.total.toFixed(COMPACT_COST_DECIMALS)}`;
  }
  ui.speechCost.textContent = `${compact}${value.partial ? '*' : ''}`;
  if (tipTarget === ui.speechCost) showTip(ui.speechCost);
}

function handle(message: ToPanel): void {
  switch (message.type) {
    case 'speechCost':
      showSpeechCost(message.value);
      return;
    case 'speechReadiness':
      voiceFacts = message.value;
      syncVoiceStatus();
      return;
    case 'speechTransport':
      voiceTransport = message.available;
      syncVoiceStatus();
      return;
    case 'speechPage':
      voiceFacts = undefined;
      voiceCompute = undefined;
      voiceTransport = false;
      voiceSettingsValid = undefined;
      syncVoiceStatus();
      speechPage = message.pageId;
      speechId = 0;
      speechCanceled = false;
      speechAudio.page(message.pageId);
      return;
    case 'speechComputeState': {
      voiceCompute = message.value;
      syncVoiceStatus();
      const { requestedMode, actualBackend, gpuCheck } = message.value;
      const reasons = {
        busy: 'GPU speech is still finishing. Try again shortly.',
        unsupported: 'GPU speech is unsupported on this host.',
        runtime_missing: 'GPU runtime is missing.',
        untrusted_driver: 'GPU driver could not be trusted.',
        no_hardware: 'No compatible GPU was found.',
        inconclusive: 'GPU availability could not be confirmed.',
        model_missing: 'GPU model is missing.',
        probe_failed: 'GPU check failed.',
        timeout: 'GPU check timed out.',
      };
      ui.speechCompute.value = requestedMode;
      ui.gpuCheck.disabled = gpuCheck.phase === 'checking';
      ui.gpuCheck.textContent = gpuCheck.phase === 'ready' ? 'Recheck GPU setup' : 'Set up GPU';
      const status =
        gpuCheck.phase === 'unavailable'
          ? reasons[gpuCheck.reason]
          : gpuCheck.phase === 'ready'
            ? 'GPU setup is ready.'
            : gpuCheck.phase === 'checking'
              ? 'Checking GPU setup...'
              : 'GPU setup has not been checked.';
      const progress = gpuCheck.phase === 'checking' ? gpuCheck.progress : undefined;
      let detail = '';
      if (progress?.stage === 'download' && progress.current !== undefined) {
        const downloadedBytes = Number.isFinite(progress.current) ? Math.max(0, progress.current) : 0;
        const total = progress.total !== undefined && Number.isFinite(progress.total) ? Math.max(0, progress.total) : 0;
        const downloaded = total > 0 ? Math.min(downloadedBytes, total) : downloadedBytes;
        const bytesPerMb = 1_000_000;
        const percentage = 100;
        detail = ` download: ${(downloaded / bytesPerMb).toFixed(1)} MB`;
        if (total > 0) detail += ` of ${(total / bytesPerMb).toFixed(1)} MB (${Math.round((downloaded / total) * percentage)}%)`;
        detail += '.';
      } else if (progress !== undefined) {
        const counts =
          progress.current === undefined
            ? ''
            : progress.total === undefined
              ? `: ${progress.current}`
              : `: ${progress.current} of ${progress.total}`;
        detail = ` ${progress.stage}${counts}.`;
      }
      ui.gpuStatus.textContent = `${status}${detail} ${actualBackend === 'none' ? 'No backend reported yet.' : `Using ${actualBackend.toUpperCase()}.`}`;
      ui.gpuDetails.textContent = `Requested: ${requestedMode.toUpperCase()}. Actual backend: ${actualBackend.toUpperCase()}.`;
      return;
    }
    case 'speechSupport':
      speechSupported = message.supported;
      ui.speechSetup.disabled = !message.supported;
      syncSpeechProvider();
      if (!message.supported) ui.speechSettingsStatus.textContent = 'Local speech is unavailable in this build or on this host.';
      return;
    case 'speechSettings':
      voiceSettingsValid =
        message.value.provider === 'kokoro'
          ? SPEECH_VOICES.some((voice) => voice === message.value.voice) && SPEECH_SPEEDS.some((speed) => speed === message.value.speed)
          : message.value.provider === 'openrouter'
            ? (message.value.openRouterModel ?? '') !== ''
            : message.value.elevenLabsVoice.trim() !== '' && ELEVENLABS_SPEEDS.some((speed) => speed === message.value.elevenLabsSpeed);
      voiceFacts = {
        enabled: message.value.enabled,
        provider: message.value.provider,
        keyConfigured: 'unknown',
        voiceConfigured: true,
        output: 'unknown',
        routeAvailable: 'unknown',
        runtimeReady: 'unknown',
        modelReady: 'unknown',
        lastPlayback: 'unknown',
      };
      if (speechEnabled && !message.value.enabled) stopSpeechLocally();
      speechEnabled = message.value.enabled;
      speechProvider = message.value.provider;
      cloudVoice = message.value.elevenLabsVoice;
      cloudSpeed = message.value.elevenLabsSpeed;
      openRouterModel = message.value.openRouterModel ?? '';
      openRouterVoice = message.value.openRouterVoice ?? '';
      openRouterZdr = message.value.openRouterZdr ?? false;
      openRouterFormat = message.value.openRouterFormat === 'pcm' ? 'pcm' : 'mp3';
      if (
        !openRouterCatalogVerified &&
        openRouterModel !== '' &&
        !Array.from(ui.openRouterModel.options).some((option) => option.value === openRouterModel)
      ) {
        const saved = document.createElement('option');
        saved.value = openRouterModel;
        saved.textContent = 'Saved model (load models to change)';
        ui.openRouterModel.append(saved);
      }
      ui.openRouterModel.value = openRouterModel;
      ui.openRouterFormat.value = openRouterFormat;
      renderOpenRouterVoices();
      ui.speechCloudSpeed.value = String(cloudSpeed);
      selectCloudVoice();
      syncSpeechProvider();
      ui.speechEnabled.checked = message.value.enabled;
      ui.speechContext.value = message.value.contextEnabled === true ? 'on' : 'off';
      ui.voiceStatus.disabled = false;
      syncVoiceStatus();
      ui.speechVoice.value = message.value.voice;
      ui.speechSpeed.value = String(message.value.speed);
      ui.speechListeningSpeed.value = String(message.value.listeningSpeed ?? 1);
      showListeningSpeed();
      return;
    case 'speechCloudSupport':
      cloudSupported = message.supported;
      syncSpeechProvider();
      return;
    case 'speechOutputCatalog': {
      const select = ui.speechOutput;
      const first = document.createElement('option');
      first.value = '0';
      first.textContent = 'System default';
      select.replaceChildren(first);
      outputChoices = [{ kind: 'default' }];
      let selected = message.value.selected.kind === 'default' ? '0' : '';
      let available = selected === '0';
      for (const device of message.value.devices) {
        const option = document.createElement('option');
        outputChoices.push(device.choice);
        option.value = String(outputChoices.length - 1);
        option.textContent = device.label;
        option.disabled = !message.value.supported || !device.available;
        if (
          message.value.selected.kind === 'native' &&
          message.value.selected.backend === device.choice.backend &&
          message.value.selected.name === device.choice.name
        ) {
          selected = option.value;
          available = message.value.supported && device.available;
        }
        select.append(option);
      }
      if (selected === '') {
        const missing = document.createElement('option');
        missing.value = 'missing';
        missing.textContent = 'Saved output unavailable';
        missing.disabled = true;
        select.append(missing);
        selected = missing.value;
      }
      select.value = selected;
      outputReady = available;
      syncSpeechProvider();
      ui.speechOutputStatus.textContent =
        message.value.error === 'save_failed'
          ? 'Could not save the output choice.'
          : message.value.supported
            ? available
              ? ''
              : 'Selected output is unavailable. Refresh outputs or choose System default.'
            : message.value.reason === undefined
              ? 'Select Refresh outputs to list available devices.'
              : 'Output selection is unavailable on this host; System default remains available.';
      return;
    }
    case 'openRouterKeyStatus':
      openRouterHasKey = message.hasKey;
      ui.openRouterKeyStatus.textContent = message.hasKey ? 'API key saved.' : 'No API key saved.';
      syncSpeechProvider();
      return;
    case 'openRouterCatalog': {
      openRouterModels = message.value.models;
      openRouterCatalogVerified = message.value.verified;
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = 'Choose a model';
      ui.openRouterModel.replaceChildren(placeholder);
      for (const model of openRouterModels) {
        const option = document.createElement('option');
        option.value = model.id;
        option.textContent = `${model.name}: ${formatOpenRouterPricing(model.pricing)}`;
        ui.openRouterModel.append(option);
      }
      if (
        !openRouterCatalogVerified &&
        openRouterModel !== '' &&
        !Array.from(ui.openRouterModel.options).some((option) => option.value === openRouterModel)
      ) {
        const saved = document.createElement('option');
        saved.value = openRouterModel;
        saved.textContent = 'Saved model (load models to change)';
        ui.openRouterModel.append(saved);
      }
      ui.openRouterModel.value = openRouterModel;
      renderOpenRouterVoices();
      ui.openRouterStatus.textContent =
        message.value.state === 'loading'
          ? 'Loading account speech models...'
          : message.value.state === 'error'
            ? (message.value.message ?? 'Could not load account speech models.')
            : message.value.state === 'ready'
              ? openRouterModels.length === 0
                ? 'No eligible speech models with advertised voices are available for this account and filter.'
                : 'Account speech models loaded. Some may use an audio format this version cannot play.'
              : 'Load speech models and advertised voices from your account. Some models may use an audio format this version cannot play.';
      syncSpeechProvider();
      return;
    }
    case 'speechKeyStatus':
      cloudHasKey = message.hasKey;
      ui.speechKeyStatus.textContent = message.hasKey ? 'API key saved.' : 'No API key saved.';
      syncSpeechProvider();
      return;
    case 'speechCatalog': {
      const select = ui.speechCloudVoice;
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = 'Choose a voice';
      select.replaceChildren(placeholder);
      for (const voice of message.value.voices) {
        const option = document.createElement('option');
        option.value = voice.id;
        option.textContent = voice.name;
        select.append(option);
      }
      selectCloudVoice();
      ui.speechVoicesMore.hidden = !message.value.more;
      const wasLoading = cloudLoading;
      cloudLoading = message.value.loading;
      if (message.value.reset === true) ui.speechSettingsStatus.textContent = '';
      else if (cloudLoading) ui.speechSettingsStatus.textContent = 'Loading account voices...';
      else if (message.value.error) ui.speechSettingsStatus.textContent = catalogFailure(message.value.errorKind);
      else if (message.value.voices.length > 0) ui.speechSettingsStatus.textContent = 'Account voices loaded.';
      else if (wasLoading) {
        ui.speechSettingsStatus.textContent = message.value.more
          ? 'No voices on this page. Select Load more.'
          : 'No account voices are available. Check your ElevenLabs account.';
      } else ui.speechSettingsStatus.textContent = '';
      syncSpeechProvider();
      return;
    }
    case 'speechModelStatus':
      ui.speechModelStatus.textContent = `${message.value.download === 'missing' ? 'Not downloaded' : message.value.download === 'unknown' ? 'Download status unknown' : message.value.verified ? 'Downloaded and verified' : 'Local model is not verified; the path exists'}.`;
      ui.speechModelDetails.textContent = `Local path: ${message.value.path}. Pinned source: ${message.value.source} (revision ${message.value.revision}).`;
      (message.value.download === 'installed' && message.value.verified ? ui.speechSetupSecondary : ui.speechSetupPrimary).append(
        ui.speechSetup,
      );
      ui.speechSetup.textContent =
        message.value.download === 'installed' && message.value.verified ? 'Recheck Kokoro model' : 'Download Kokoro model';
      return;
    case 'speechModelStatusUnavailable':
      ui.speechModelStatus.textContent = 'Local model status is unknown.';
      ui.speechModelDetails.textContent = 'Model details are unavailable.';
      ui.speechSetupPrimary.append(ui.speechSetup);
      ui.speechSetup.textContent = 'Download Kokoro model';
      return;
    case 'speechSetupState':
      ui.speechSetup.disabled = message.pending || !speechSupported;
      syncSpeechProvider();
      if (message.pending) ui.speechPreview.disabled = true;
      ui.speechSettingsStatus.textContent = message.message;
      return;
    case 'speechAudio':
      if (message.pageId === speechPage && message.id === speechId && !speechCanceled) {
        speechAudio.audio(message.id, message.pageId, message.wavBase64, speechPaused);
      }
      return;
    case 'speechControl':
      if (message.action === 'stop') {
        if (speechAudio.retire(message.id, message.pageId)) {
          vscode.postMessage({ type: 'speechRetired', id: message.id, pageId: message.pageId });
        }
      } else {
        speechAudio.control(message.id, message.pageId, message.action);
      }
      return;
    case 'speechStatus': {
      if (
        message.pageId !== speechPage ||
        message.id < speechId ||
        (message.id === speechId && speechCanceled && message.state !== 'idle')
      ) {
        return;
      }
      if (message.id > speechId) {
        speechId = message.id;
        speechCanceled = false;
      }
      if (message.state === 'preparing') speechAudio.begin(message.id, message.pageId);
      speechState = message.state;
      if (message.state === 'idle') speechAudio.stop();
      const labels: Record<SpeechState, string> = {
        preparing: 'Preparing speech',
        speaking: 'Speaking',
        paused: 'Speech paused',
        unavailable: message.message ?? 'Speech unavailable',
        idle: '',
      };
      ui.speechLiveStatus.textContent = labels[message.state];
      ui.speechSettingsStatus.textContent = labels[message.state];
      ui.speechLive.hidden = message.state === 'idle';
      ui.speechStopLive.hidden = message.state === 'idle' || message.state === 'unavailable';
      syncStatus();
      return;
    }
    case 'showTerminals':
      ui.showTerminals.checked = message.value;
      return;
    case 'commandApprovals':
      ui.commandApprovalsStatus.textContent = !message.confirmationRequired
        ? 'Command confirmation is off: all commands are automatically approved.'
        : message.all
          ? `All commands are automatically approved for this session (${message.count} remembered).`
          : message.count > 0
            ? `${message.count} command(s) automatically approved for this session.`
            : 'No session command grants.';
      ui.revokeCommandApprovals.disabled = message.confirmationRequired && !message.all && message.count === 0;
      return;
    case 'commandApprovalSound':
      ui.commandApprovalSound.checked = message.value;
      return;
    case 'replyBehavior':
      ui.replyBehavior.value = message.value;
      return;
    case 'navigatorCommentary':
      ui.navigatorCommentary.value = message.value;
      break;
    case 'chatOrder':
      setChatOrder(message.value);
      return;
    case 'replay':
      replaying = true;
      for (const ev of message.events) {
        handle(ev);
      }
      replaying = false;
      return;
    case 'canStart':
      // specs/Start.tla, `AnswerCheck`: the button shows exactly what the extension answered.
      ui.start.hidden = !message.value;
      return;
    case 'startEnded':
      // specs/Start.tla, `AgentExits`: the agent is done, session or not (NoteGoes).
      ui.starting.hidden = true;
      return;
    case 'session':
      // specs/Panel.tla, `ChangeSession`: the band is filed and a divider is added.
      if (message.active) {
        // specs/Start.tla, `StartSession`: a session clears the note (NoteUntilSession).
        ui.starting.hidden = true;
        if (message.suspended || message.resumed) {
          // The same session: its agent gone, or back (#25).
          fileCurrent();
          current = undefined;
          const was = suspended;
          suspended = message.suspended === true;
          if (suspended) reading = undefined;
          // A revive repeats the suspension a disconnect already showed (#138): specs/Panel.tla, `RepeatSession`,
          // with no divider; else `ChangeSession`.
          if (was !== suspended) {
            addDivider(suspended ? 'The agent disconnected: the session waits for it' : 'The agent is back: session resumed');
          }
          setActive(true);
          return;
        }
        // specs/Resume.tla, `Start`: a new session replaces any old suspension.
        shownApprovals.clear();
        clearRun();
        suspended = false;
        fileCurrent();
        current = undefined;
        state = undefined;
        ready = 0;
        ui.now.classList.add('empty');
        ui.now.textContent = `Waiting for the agent${ELLIPSIS}`;
        ui.ref.innerHTML = '';
        pointed = undefined;
        addDivider(
          `Session started${message.task === undefined ? '' : `: ${message.task}`}${message.rules === undefined ? '' : `${LABEL_SEPARATOR}rules from ${message.rules.join(', ')}`}`,
        );
        setActive(true);
      } else {
        fileCurrent();
        current = undefined;
        addDivider(ENDED[message.reason]);
        ui.idleTitle.textContent = message.reason === 'disconnected' ? 'The agent disconnected' : 'Session ended';
        ui.idleSummary.innerHTML = message.summary === undefined ? '' : rich(message.summary);
        ui.idleText.textContent = 'Ask your agent to pair again.';
        // specs/Start.tla, `EndSession`: the idle view, and its button, are back.
        setActive(false);
      }
      return;
    case 'say':
      setNow(message.text);
      return;
    case 'reading':
      startReading(message.ms, message.id);
      return;
    case 'state':
      setState(message);
      return;
    case 'programmer':
      addYou(message.text, message.ref);
      return;
    case 'interrupt':
      addDivider('You interrupted');
      return;
    case 'outside':
      addOutside(message.files);
      return;
    case 'turn':
      addDivider(message.to === 'programmer' ? 'You took the turn' : 'You handed the turn back');
      if (message.message !== undefined || message.ref !== undefined) addYou(message.message, message.ref);
      ui.reply.placeholder = message.to === 'programmer' ? `Ask the agent${ELLIPSIS}` : `Reply to the agent${ELLIPSIS}`;
      return;
    case 'point':
      pointed = codeLink(`${RIGHT_ARROW} ${message.file}:${message.line}`, message.file, message.line);
      return;
    case 'run': {
      // specs/RunBox.tla, Show: confirm and running show the box; a phase that ends the run clears it.
      if (message.phase === 'confirm' || message.phase === 'running') {
        // specs/CommandCue.tla, Handle: replay and repeated IDs never sound.
        if (message.phase === 'confirm') {
          const first = !shownApprovals.has(message.id);
          shownApprovals.add(message.id);
          if (first && !replaying && ui.commandApprovalSound.checked) approvalSound.play();
        }
        runId = message.id;
        runConfirming = message.phase === 'confirm';
        ui.showTerminal.hidden = runConfirming;
        ui.run.classList.add('on');
        ui.run.classList.toggle('confirm', runConfirming);
        // A command waiting for the programmer's decision is announced at once (#16).
        if (runConfirming) {
          ui.run.setAttribute('role', 'alert');
        } else {
          ui.run.removeAttribute('role');
        }
        ui.runLabel.textContent = runConfirming ? 'Allow this command in the terminal?' : `Running in the terminal${ELLIPSIS}`;
        ui.runCmd.textContent = message.command;
        syncStatus();
        if (runConfirming) arrive(ui.run);
        return;
      }
      if (message.phase === 'exited') {
        // A command left running has ended: its row says how.
        const row = ui.history.querySelector(`.run[data-run="${message.id}"]`);
        const outcome = row?.querySelector('.outcome');
        if (row && outcome) setOutcome(row, outcome, message.phase, message.exitCode);
        return;
      }
      if (runId === message.id) {
        clearRun();
        syncStatus();
      }
      addRun(message.id, message.command, message.phase, message.exitCode);
      return;
    }
    case 'selection':
      selection = message.ref;
      selectionDismissed = false;
      syncAttach();
      return;
    case 'attention': {
      attention = message.state;
      const label = attention === 'none' ? 'Raise hand' : attention === 'requested' ? 'Lower hand' : 'Focus reply';
      ui.attention.setAttribute('aria-label', label);
      ui.attention.setAttribute('aria-pressed', String(attention !== 'none'));
      ui.attention.classList.toggle('on', attention !== 'none');
      setTip(ui.attention, label);
      if (attention === 'granted' && !replaying) focusReplyBox();
      return;
    }
    case 'focusReply':
      focusReplyBox();
      return;
    case 'speed':
      showSpeed(ui.speed, ui.speedMenu, 'Playback speed', '', message.value);
      return;
    case 'codePlayback':
      setCodePlayback(message.value);
      return;
    case 'readingSpeed':
      showSpeed(ui.readingSpeed, ui.readingMenu, 'Reading speed', 'read ', message.value);
      return;
    case 'calibration':
      showCalibration(message.view);
      return;
    case 'timings':
      tipDelayMs = message.tipDelayMs;
      tipWarmMs = message.tipWarmMs;
      return;
    default:
      throw new Error(`Unknown panel message: ${JSON.stringify(message satisfies never)}`);
  }
}

// ---- The reply box ---------------------------------------------------------

// specs/Draft.tla, `TypeDraft` and `Clear`: posts `draft` when the box's emptiness changes.
function syncDraft(): void {
  const empty = ui.reply.value.trim() === '';
  ui.reply.style.height = 'auto';
  ui.reply.style.height = `${Math.min(ui.reply.scrollHeight, REPLY_MAX_HEIGHT)}px`;
  if (empty !== draftEmpty) {
    draftEmpty = empty;
    vscode.postMessage({ type: 'draft', empty });
  }
}

function takeDraft(): string {
  const text = ui.reply.value.trim();
  ui.reply.value = '';
  draftEmpty = true;
  syncDraft();
  return text;
}

function takeAttach(): boolean {
  const on = attaching();
  if (on) {
    selectionDismissed = true;
    syncAttach();
  }
  return on;
}

function sendReply(): void {
  const text = takeDraft();
  if (text) {
    const defer = ui.replyBehavior.value === 'finishAction';
    if (!defer) stopSpeechLocally();
    vscode.postMessage({ type: 'reply', text, attach: takeAttach(), ...(defer ? { defer: true } : {}) });
  }
}

function decide(run: boolean, scope: 'once' | 'command' | 'all'): void {
  if (runId !== undefined) vscode.postMessage({ type: 'runDecision', id: runId, run, scope });
}

// ---- Wiring ----------------------------------------------------------------

// Preserve a followed edge across a resize whose observer has not run yet,
// while still noticing a reader scroll before its scroll event is delivered.
function followsHistory(): boolean {
  const { scrollHeight, clientHeight, scrollTop } = ui.history;
  return scrollHeight - clientHeight - scrollTop <= 1 || (followingLatest && historyScrollHeight - historyHeight - scrollTop <= 1);
}

const handleDecode = localSpeechDecoder((message) => {
  vscode.postMessage(message);
}, crypto.randomUUID());
window.addEventListener('message', (m: MessageEvent) => {
  if (handleDecode(m.data)) return;
  // The extension posts only ToPanel messages.
  const follow = chatOrder === 'oldestFirst' && followsHistory();
  if (chatOrder === 'oldestFirst') followingLatest = follow;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  handle(m.data as ToPanel);
  if (follow && chatOrder === 'oldestFirst') {
    ui.history.scrollTop = ui.history.scrollHeight;
    historyScrollHeight = ui.history.scrollHeight;
    historyHeight = ui.history.clientHeight;
  }
});

ui.reply.addEventListener('input', () => {
  const follow = chatOrder === 'oldestFirst' && followsHistory();
  if (chatOrder === 'oldestFirst') followingLatest = follow;
  syncDraft();
  if (follow) {
    ui.history.scrollTop = ui.history.scrollHeight;
    historyScrollHeight = ui.history.scrollHeight;
    historyHeight = ui.history.clientHeight;
  }
});
ui.reply.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    sendReply();
  } else if (e.key === 'Escape') {
    ui.reply.blur();
  }
});
ui.send.addEventListener('click', sendReply);
ui.attention.addEventListener('click', () => {
  if (attention === 'granted') ui.reply.focus();
  else vscode.postMessage({ type: 'attention' });
});
ui.revealCursor.addEventListener('click', () => {
  vscode.postMessage({ type: 'revealCursor' });
});

ui.pause.addEventListener('click', () => {
  vscode.postMessage({ type: paused ? 'resume' : 'pause' });
});
ui.interrupt.addEventListener('click', () => {
  stopSpeechLocally();
  vscode.postMessage({ type: 'interrupt' });
});
ui.turn.addEventListener('click', () => {
  const handingBack = turn === 'programmer';
  const message = handingBack ? takeDraft() : '';
  const attach = handingBack && takeAttach();
  if (message !== '' || attach) stopSpeechLocally();
  vscode.postMessage({ type: 'turn', ...(message ? { message } : {}), ...(attach ? { attach } : {}) });
});
ui.attachX.addEventListener('click', () => {
  selectionDismissed = true;
  syncAttach();
});
ui.runGo.addEventListener('click', () => {
  decide(/* run= */ true, 'once');
});
ui.runAlways.addEventListener('click', () => {
  decide(/* run= */ true, 'command');
});
ui.runAll.addEventListener('click', () => {
  decide(/* run= */ true, 'all');
});
ui.runSkip.addEventListener('click', () => {
  decide(/* run= */ false, 'once');
});
ui.end.addEventListener('click', () => {
  stopSpeechLocally();
  vscode.postMessage({ type: 'end' });
});

// From any element under the pointer: over a button's icon, it's an SVG one.
document.addEventListener('pointerover', (e) => {
  hoverTip(e.target instanceof Element ? (e.target.closest<HTMLElement>('[data-tip]') ?? undefined) : undefined);
});
document.documentElement.addEventListener('pointerleave', () => {
  hoverTip(undefined);
});
document.addEventListener('pointerdown', hideTip, /* useCapture= */ true);
document.addEventListener('focusin', (e) => {
  const el = elementOf(e);
  if (el?.matches('[data-tip]:focus-visible') === true) showTip(el);
});
document.addEventListener('focusout', (e) => {
  if (e.target === tipTarget) hideTip();
});
document.addEventListener(
  'keydown',
  (e) => {
    if (e.key === 'Escape') hideTip();
  },
  /* useCapture= */ true,
);
document.addEventListener('scroll', hideTip, /* useCapture= */ true);
window.addEventListener('blur', hideTip);

// Space pauses and resumes, anywhere in the panel but the reply box. It doesn't press the focused
// button, which after a click could be End; Enter still does.
document.addEventListener('keydown', (e) => {
  if (e.key !== ' ' || e.ctrlKey || e.metaKey || e.altKey || !active) return;
  const target = e.target;
  if (
    e.target === ui.reply ||
    e.target === ui.skipReading ||
    e.target === ui.settings ||
    (target instanceof Node && [ui.speedMenu, ui.readingMenu, ui.codeModeMenu].some((menu) => menu.contains(target))) ||
    (e.target instanceof Node && ui.settingsDialog.contains(e.target))
  ) {
    return;
  }
  e.preventDefault();
  if (e.repeat || turn === 'programmer') return;
  vscode.postMessage({ type: paused ? 'resume' : 'pause' });
});

// File names in messages open the file, URLs open in the browser, and the intro's commands run.
// Links have an href, so they take focus and Enter (#16); it isn't followed.
document.addEventListener('click', (e) => {
  const target = e.target instanceof Element ? e.target : undefined;
  if (target?.closest('a[href]')) e.preventDefault();
  // specs/TerminalPanel.tla, `Show`: request this historical command's terminal.
  const reveal = target?.closest<HTMLElement>('button[data-show-terminal]');
  if (reveal?.dataset.showTerminal !== undefined) vscode.postMessage({ type: 'showTerminal', id: Number(reveal.dataset.showTerminal) });
  const a = target?.closest<HTMLElement>('a.file, a.url, a.command');
  if (a?.dataset.file !== undefined) vscode.postMessage({ type: 'openFile', file: a.dataset.file });
  if (a?.dataset.url !== undefined) vscode.postMessage({ type: 'openUrl', url: a.dataset.url });
  if (a?.dataset.command !== undefined) vscode.postMessage({ type: 'command', command: a.dataset.command });
});

// Start a session: Claude Code's CLI starts with the prompt in a hidden terminal (#107, #115).
ui.start.addEventListener('click', () => {
  // specs/Start.tla, `Click`: the note shows at once (AcknowledgedProp).
  ui.starting.hidden = false;
  vscode.postMessage({ type: 'start' });
});

vscode.postMessage({ type: 'ready' });
