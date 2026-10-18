// The narration panel's page script, bundled for the webview as dist/panel.js (#6). The markup and
// styles are in panel_html.ts; the messages in panel_messages.ts.

import type { AgentState, PanelEvent, Ref } from '@ai-pair/core';
import type { FromPanel, ToPanel } from '../panel_messages';
import type { CalibrationView } from '../calibration';
import { ELLIPSIS, LABEL_SEPARATOR, RANGE_DASH, RIGHT_ARROW, SPEED_SUFFIX } from '@ai-pair/core/constants';

declare function acquireVsCodeApi(): { postMessage(message: FromPanel): void };

const vscode = acquireVsCodeApi();

// A code span that names a file, like `game.ts` or `src/game.ts`, becomes a link that opens it.
const FILE =
  /^[\w@.~-]*(\/[\w@.~-]+)*\.(ts|tsx|js|jsx|mjs|cjs|json|jsonc|md|css|scss|less|html|vue|svelte|py|rs|go|java|kt|swift|c|h|cc|cpp|hpp|cs|rb|php|lua|sh|zsh|toml|yaml|yml|xml|sql|txt|lock|env)$/;
const URL_PATTERN = /\bhttps?:\/\/[^\s<>"'`]*[^\s<>"'`.,;:!?)\]]/g;

const STATUS: Record<AgentState, [string, string]> = {
  typing: ['', 'Agent is typing'],
  read: ['read', 'Read this'],
  running: ['', 'Running a command'],
  thinking: ['dim', 'Agent is thinking'],
  absent: ['dim', "Agent isn't listening"],
  paused: ['dim', 'Paused'],
  listening: ['ring', 'Your move'],
  navigator: ['ring', 'Your turn'],
};

const ENDED = { agent: 'The agent ended the session', user: 'You ended the session', disconnected: 'The agent disconnected' };

// Tooltips: an element's data-tip shows under it after a moment's hover, or at once while one is
// showing or just was, the way VS Code's own hovers do; and on keyboard focus. A click hides it.
const TIP_DELAY_MS = 500;
const TIP_WARM_MS = 300;
/** The delays in force: the shipped ones until the extension says otherwise (`timings`). */
let tipDelayMs = TIP_DELAY_MS;
let tipWarmMs = TIP_WARM_MS;
const TIP_GAP = 4;
const TIP_MARGIN = 6;

/** The tallest the reply box grows, in pixels, before it scrolls. */
const REPLY_MAX_HEIGHT = 120;
/** A shell's exit code after Ctrl+C, and after SIGTERM. */
const EXIT_INTERRUPTED = 130;
const EXIT_TERMINATED = 143;
/** A speed shown with one decimal is a whole number of tenths. */
const TENTHS = 10;
/** How close a menu speed must be to the setting to count as chosen. */
const SPEED_TOLERANCE = 0.01;

type RunPhase = Extract<PanelEvent, { type: 'run' }>['phase'];

/** Returns the page's element marked `data-ui="name"`, as the element it is. */
function $<T extends HTMLElement>(name: string, type: abstract new () => T): T {
  const el = document.querySelector(`[data-ui="${name}"]`);
  if (!(el instanceof type)) throw new Error(`The panel has no ${type.name} [data-ui="${name}"]`);
  return el;
}

const ui = {
  band: $('band', HTMLElement),
  dot: $('dot', HTMLElement),
  status: $('status-text', HTMLElement),
  pause: $('pause', HTMLButtonElement),
  interrupt: $('interrupt', HTMLButtonElement),
  turn: $('turn', HTMLButtonElement),
  turnLabel: $('turn-label', HTMLElement),
  speed: $('speed', HTMLButtonElement),
  speedMenu: $('speed-menu', HTMLElement),
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
  send: $('send', HTMLButtonElement),
  attach: $('attach', HTMLElement),
  attachRef: $('attach-ref', HTMLElement),
  attachX: $('attach-x', HTMLButtonElement),
  run: $('run', HTMLElement),
  runLabel: $('run-label', HTMLElement),
  runCmd: $('run-cmd', HTMLElement),
  runGo: $('run-go', HTMLButtonElement),
  runAlways: $('run-always', HTMLButtonElement),
  runSkip: $('run-skip', HTMLButtonElement),
  history: $('history', HTMLElement),
  tip: $('tip', HTMLElement),
};

let active = false;
let calibrating = false;
let turn = 'agent';
let paused = false;
let replaying = false;
/** The session's agent is gone, and the session waits for it to come back (#25). */
let suspended = false;
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
/** Text of the current message. */
let current: string | undefined = undefined;
/** Whether the current message is in the history already. */
let filed = false;
/** The reading pause under way: its length, and how much of it has elapsed, as of `last`. */
let reading: { ms: number; elapsed: number; last: number } | undefined = undefined;
/** A link to the code the agent just pointed at, shown with the message about it. */
let pointed: HTMLAnchorElement | undefined = undefined;
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

/**
 * Puts the current message into the history, once: when the next entry comes, or when it is replaced
 * (specs/Panel.tla, `Flushed`).
 */
function fileCurrent(): void {
  if (current !== undefined && !filed) ui.history.prepend(entry('agent', rich(current)));
  filed = true;
}

function add(el: HTMLElement): HTMLElement {
  // Newest first: the current message came before this entry, so it goes in first
  // (specs/Panel.tla, `AddEntry`).
  fileCurrent();
  ui.history.prepend(el);
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
  // specs/PanelScroll.tla, `AddYours`: the programmer's message scrolls the history to its top (#139).
  ui.history.scrollTop = 0;
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
    outcome.textContent = phase === 'exited' ? 'ended' : 'done';
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
  ui.dot.classList.toggle('reading', reading !== undefined);
}

function tick(now: number): void {
  if (!reading) return;
  if (!paused) reading.elapsed += now - reading.last;
  reading.last = now;
  const f = Math.min(1, reading.elapsed / reading.ms);
  ui.dot.style.setProperty('--progress', String(f));
  if (f >= 1) {
    reading = undefined;
    syncReading();
    return;
  }
  requestAnimationFrame(tick);
}

// The reading pause fills a ring around the status dot.
function startReading(ms: number): void {
  if (replaying) return;
  reading = { ms, elapsed: 0, last: performance.now() };
  ui.dot.style.setProperty('--progress', '0');
  syncReading();
  requestAnimationFrame(tick);
}

function syncStatus(): void {
  if (!active) {
    ui.dot.className = 'dot off';
    ui.status.textContent = 'No session';
    return;
  }
  if (suspended) {
    ui.dot.className = 'dot off';
    ui.status.textContent = 'Suspended: waiting for the agent';
    return;
  }
  const [cls, text] = runConfirming ? ['read', 'Needs you'] : state ? STATUS[state] : ['', 'Session started'];
  ui.dot.className = `dot ${cls}`;
  syncReading();
  ui.status.textContent = text;
}

// ---- Tooltips --------------------------------------------------------------

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

function showTip(el: HTMLElement): void {
  clearTimeout(tipTimer);
  tipPending = undefined;
  if ((el === ui.speed && ui.speedMenu.hidden === false) || (el === ui.readingSpeed && ui.readingMenu.hidden === false)) return;
  tipTarget = el;
  ui.tip.textContent = el.dataset.tip ?? '';
  ui.tip.hidden = false;
  el.setAttribute('aria-describedby', 'tip');
  placeTip(el);
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
  state = e.state;
  turn = e.turn;
  paused = e.paused;
  document.body.classList.toggle('paused', paused);
  document.body.classList.toggle('user-turn', turn === 'user');
  ui.pause.classList.toggle('on', paused);
  ui.pause.setAttribute('aria-label', paused ? 'Resume' : 'Pause');
  setTip(ui.pause, paused ? 'Resume (Space)' : 'Pause (Space)');
  ui.turnLabel.textContent = turn === 'user' ? 'Hand back' : 'My turn';
  ui.turn.setAttribute('aria-label', ui.turnLabel.textContent);
  setTip(
    ui.turn,
    turn === 'user' ? 'Hand the turn back to the agent, with your reply if you typed one' : 'Take the turn: you drive, the agent navigates',
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

/** Wires a speed menu to its button, and returns what closes it. */
function speedMenu(button: HTMLButtonElement, menu: HTMLElement, type: 'speed' | 'readingSpeed'): () => void {
  function close(): void {
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    button.classList.remove('on');
  }
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = menu.hidden === true;
    menu.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    button.classList.toggle('on', open);
    if (open) menu.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
  });
  for (const b of menu.querySelectorAll('button')) {
    b.addEventListener('click', () => {
      close();
      button.focus();
      vscode.postMessage({ type, value: Number(b.dataset.speed) });
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
  return close;
}
const closeSpeedMenu = speedMenu(ui.speed, ui.speedMenu, 'speed');
const closeReadingMenu = speedMenu(ui.readingSpeed, ui.readingMenu, 'readingSpeed');

function setActive(on: boolean): void {
  active = on;
  document.body.classList.toggle('active', on);
  ui.reply.disabled = !on && !calibrating;
  if (!on) {
    suspended = false;
    reading = undefined;
    // specs/RunBox.tla, `EndSession`: the session ending clears the box.
    clearRun();
    closeSpeedMenu();
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
  for (const b of menu.querySelectorAll('button')) {
    b.setAttribute('aria-checked', String(Math.abs(Number(b.dataset.speed) - value) < SPEED_TOLERANCE));
  }
}

function handle(message: ToPanel): void {
  switch (message.type) {
    case 'replay':
      replaying = true;
      for (const ev of message.events) {
        handle(ev);
      }
      replaying = false;
      return;
    case 'canStart':
      // specs/Start.tla, `Answer`: the button shows exactly what the extension answered.
      ui.start.hidden = !message.value;
      return;
    case 'startEnded':
      // specs/Start.tla, `Exit`: the agent is done, session or not (Settles).
      ui.starting.hidden = true;
      return;
    case 'session':
      // specs/Panel.tla, `ChangeSession`: the band is filed, and a divider goes on top.
      if (message.active) {
        // specs/Start.tla, `StartSession`: a session clears the note (NoteUntilSession).
        ui.starting.hidden = true;
        if (message.suspended || message.resumed) {
          // The same session: its agent gone, or back (#25).
          fileCurrent();
          current = undefined;
          const was = suspended;
          suspended = message.suspended === true;
          // A revive repeats the suspension a disconnect already showed (#138).
          if (was !== suspended) {
            addDivider(suspended ? 'The agent disconnected: the session waits for it' : 'The agent is back: session resumed');
          }
          setActive(true);
          return;
        }
        fileCurrent();
        current = undefined;
        state = undefined;
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
      startReading(message.ms);
      return;
    case 'state':
      setState(message);
      return;
    case 'user':
      addYou(message.text, message.ref);
      return;
    case 'interrupt':
      addDivider('You interrupted');
      return;
    case 'outside':
      addOutside(message.files);
      return;
    case 'turn':
      addDivider(message.to === 'user' ? 'You took the turn' : 'You handed the turn back');
      if (message.message !== undefined || message.ref !== undefined) addYou(message.message, message.ref);
      ui.reply.placeholder = message.to === 'user' ? `Ask the agent${ELLIPSIS}` : `Reply to the agent${ELLIPSIS}`;
      return;
    case 'point':
      pointed = codeLink(`${RIGHT_ARROW} ${message.file}:${message.line}`, message.file, message.line);
      return;
    case 'run': {
      // specs/RunBox.tla, Show: confirm and running show the box; a phase that ends the run clears it.
      if (message.phase === 'confirm' || message.phase === 'running') {
        runId = message.id;
        runConfirming = message.phase === 'confirm';
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
    case 'focusReply':
      ui.reply.focus();
      return;
    case 'speed':
      showSpeed(ui.speed, ui.speedMenu, 'Playback speed', '', message.value);
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

// specs/Draft.tla, `Type` and `Clear`: posts `draft` when the box's emptiness changes.
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
  if (text) vscode.postMessage({ type: 'reply', text, attach: takeAttach() });
}

function decide(run: boolean, remember: boolean): void {
  if (runId !== undefined) vscode.postMessage({ type: 'runDecision', id: runId, run, remember });
}

// ---- Wiring ----------------------------------------------------------------

window.addEventListener('message', (m: MessageEvent) => {
  // The extension posts only ToPanel messages.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  handle(m.data as ToPanel);
});

ui.reply.addEventListener('input', syncDraft);
ui.reply.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    sendReply();
  } else if (e.key === 'Escape') {
    ui.reply.blur();
  }
});
ui.send.addEventListener('click', sendReply);
ui.pause.addEventListener('click', () => {
  vscode.postMessage({ type: paused ? 'resume' : 'pause' });
});
ui.interrupt.addEventListener('click', () => {
  vscode.postMessage({ type: 'interrupt' });
});
ui.turn.addEventListener('click', () => {
  const handingBack = turn === 'user';
  const message = handingBack ? takeDraft() : '';
  const attach = handingBack && takeAttach();
  vscode.postMessage({ type: 'turn', ...(message ? { message } : {}), ...(attach ? { attach } : {}) });
});
ui.attachX.addEventListener('click', () => {
  selectionDismissed = true;
  syncAttach();
});
ui.runGo.addEventListener('click', () => {
  decide(/* run= */ true, /* remember= */ false);
});
ui.runAlways.addEventListener('click', () => {
  decide(/* run= */ true, /* remember= */ true);
});
ui.runSkip.addEventListener('click', () => {
  decide(/* run= */ false, /* remember= */ false);
});
ui.end.addEventListener('click', () => {
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
  if (e.target === ui.reply) return;
  e.preventDefault();
  if (e.repeat || turn === 'user') return;
  vscode.postMessage({ type: paused ? 'resume' : 'pause' });
});

// File names in messages open the file, URLs open in the browser, and the intro's commands run.
// Links have an href, so they take focus and Enter (#16); it isn't followed.
document.addEventListener('click', (e) => {
  const target = e.target instanceof Element ? e.target : undefined;
  if (target?.closest('a[href]')) e.preventDefault();
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
