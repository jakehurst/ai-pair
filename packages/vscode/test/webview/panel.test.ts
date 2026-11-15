// @vitest-environment happy-dom
// The narration panel's page script, webview/panel.ts, on the page panel_html.ts writes (test/fixtures/panel.html).
// Solitary (#176): the script imports only types and constants, so the page is all it runs on; its postMessage is
// acquireVsCodeApi's fake, and the extension's messages are window 'message' events the test dispatches. The cases
// come from specs/Panel.tla, PanelScroll.tla, RunBox.tla, Start.tla, and the panel's issues.

import { ok } from 'node:assert/strict';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock, type MockInstance } from 'vitest';
import type { Element, HTMLElement, Window } from 'happy-dom';
import type { PanelEvent } from '@ai-pair/core';
import { ELLIPSIS, LABEL_SEPARATOR, RANGE_DASH, RIGHT_ARROW, SPEED_SUFFIX } from '@ai-pair/core/constants';
import type { ToPanel } from '../../src/panel_messages';
import { loadPage, ui } from '../page';
import { voiceIndicator } from '../../src/voice_indicator';
import { formatOpenRouterPricing } from '../../src/speech_pricing';

const approvalSound = vi.hoisted(() => ({ play: vi.fn<() => void>(), unlock: vi.fn<() => void>(), dispose: vi.fn<() => void>() }));
vi.mock('../../src/webview/approval_sound', () => ({
  ApprovalSound: class {
    play = approvalSound.play;
    unlock = approvalSound.unlock;
    dispose = approvalSound.dispose;
  },
}));
vi.mock('../../src/voice_indicator', () => ({ voiceIndicator: vi.fn().mockReturnValue('checking') }));
vi.mock('../../src/speech_pricing', () => ({ formatOpenRouterPricing: vi.fn().mockReturnValue('Pricing unavailable') }));
vi.mock('../../src/webview/speech_decode', () => ({
  localSpeechDecoder:
    (sendMessage: (message: { type: string }) => void) =>
    (value: unknown): boolean => {
      if (typeof value === 'object' && value !== null && 'type' in value && value.type === 'mockDecodePost') {
        sendMessage({ type: 'speechDecodeReady' });
        return true;
      }
      return false;
    },
}));

// The test environment's globals, typed with happy-dom's types: the project's type check has no DOM library.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const { window, document } = globalThis as unknown as { window: Window; document: Window['document'] };

// A variable, so the project's type check, which has no DOM library, doesn't follow it, as in page.ts.
const SCRIPT = '../../src/webview/panel';

/** How far down a test scrolls the history before an entry comes in. */
const SCROLLED = 120;

/** How long a hover waits before its tooltip shows, and how long the tooltips stay warm after one hides, as panel.ts has it. */
const TIP_DELAY_MS = 500;
const TIP_WARM_MS = 300;

/** The reading pause a test starts, in milliseconds. */
const READING_MS = 1000;

/** A listener as happy-dom takes it, a function. */
type Listener = Extract<Parameters<Window['addEventListener']>[1], (...args: never[]) => unknown>;

/** Something the script adds listeners to that outlives the page each test loads. */
type Target = Window | Window['document'] | Window['document']['documentElement'];

/** The window, the document, and its root element, each with the spy that records the listeners the script adds. */
let targets: Array<{ target: Target; spy: MockInstance<Target['addEventListener']> }> = [];

let post: Mock<(message: { type: string }) => void>;
let resizeHistory: () => void;

beforeEach(async () => {
  approvalSound.play.mockClear();
  approvalSound.unlock.mockClear();
  approvalSound.dispose.mockClear();
  targets = [window, document, document.documentElement].map((target) => ({ target, spy: vi.spyOn(target, 'addEventListener') }));
  post = vi.fn<(message: { type: string }) => void>();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resizeHistory = callback;
      }
      observe(): void {}
    },
  );
  await loadPage(post);
});

afterEach(() => {
  for (const { target, spy } of targets) {
    for (const [type, listener] of spy.mock.calls) {
      target.removeEventListener(type, listener);
    }
  }
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Dispatches a message from the extension to the page, as the webview does. */
function send(message: ToPanel): void {
  window.dispatchEvent(new window.MessageEvent('message', { data: message }));
}

/** Returns what the page posted to the extension, in order. */
function posted(): Array<{ type: string }> {
  return post.mock.calls.map(([message]) => message);
}

/** Returns the page's element marked `data-ui="name"`, failing the test if there is none. */
function element(name: string): HTMLElement {
  const found = ui(name);
  if (!(found instanceof window.HTMLElement)) {
    throw new TypeError(`The page has no [data-ui="${name}"]`);
  }
  return found;
}

/** Returns the reply box. */
function replyBox(): InstanceType<Window['HTMLTextAreaElement']> {
  const found = ui('reply');
  if (!(found instanceof window.HTMLTextAreaElement)) {
    throw new TypeError('The page has no textarea [data-ui="reply"]');
  }
  return found;
}

/** Returns an element's text. */
function text(name: string): string {
  return element(name).textContent;
}

/** Clicks an element, as the programmer does: the click bubbles and can be canceled. */
function click(target: Element | Window['document']): void {
  target.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
}

/** Presses a key on an element, the event bubbling up to the document. */
function press(target: Element, key: string, init: { shiftKey?: boolean; isComposing?: boolean; repeat?: boolean } = {}): void {
  target.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
}

/** Types into the reply box, firing the input event the script listens for. */
function typeReply(value: string): void {
  const box = replyBox();
  box.value = value;
  box.dispatchEvent(new window.Event('input', { bubbles: true }));
}

/** Returns the history's entries' text, newest first. */
function history(): string[] {
  return [...element('history').querySelectorAll('.entry')].map((e) => e.textContent);
}

/** Starts a session. */
function start(): void {
  send({ type: 'session', active: true });
}

it('explains unavailable costs and clears old explanations for a new session', () => {
  const cost = element('speech-cost');
  const cases = [
    ['restored', 'Earlier costs are unknown because this session was restored.'],
    ['missing-generation-id', 'OpenRouter did not return a generation ID.'],
    ['generation-not-published', 'OpenRouter has not published the generation cost within the lookup window.'],
    ['generation-lookup-failed', 'The OpenRouter generation cost lookup failed.'],
  ] as const;
  for (const [reason, explanation] of cases) {
    send({ type: 'speechCost', value: { seen: true, total: 0, pending: 0, partial: true, reasons: [reason] } });
    expect(cost.dataset.tip).toContain(explanation);
    expect(cost.getAttribute('aria-label')).toContain(explanation);
  }
  send({ type: 'speechCost', value: { seen: false, total: 0, pending: 0, partial: false } });
  expect(cost.dataset.tip).toBe('');
});

it('shows provider-confirmed session speech costs and makes missing costs clear', () => {
  const cost = element('speech-cost');
  expect(cost.hidden).toBe(true);
  send({ type: 'speechCost', value: { seen: true, total: 0, pending: 1, partial: false } });
  expect(cost.hidden).toBe(false);
  expect(cost.textContent).toBe('calculating...');
  send({ type: 'speechCost', value: { seen: true, total: 0.0012, pending: 1, partial: false } });
  expect(cost.textContent).toBe('$0.0012');
  send({ type: 'speechCost', value: { seen: true, total: 0.0012, pending: 1, partial: true } });
  expect(cost.textContent).toBe('$0.0012*');
  expect(cost.dataset.tip).toContain('OpenRouter speech this session: $0.001200 (updating; incomplete)');
  expect(cost.getAttribute('aria-label')).toBe(cost.dataset.tip);
  send({ type: 'speechCost', value: { seen: true, total: 0.0012, pending: 0, partial: true } });
  expect(cost.textContent).toBe('$0.0012*');
  send({ type: 'speechCost', value: { seen: true, total: 0, pending: 0, partial: true } });
  expect(cost.textContent).toBe('unavailable*');
  send({ type: 'speechCost', value: { seen: true, total: 0, pending: 1, partial: true } });
  expect(cost.textContent).toBe('calculating...*');
  send({ type: 'speechCost', value: { seen: true, total: 0, pending: 0, partial: false } });
  expect(cost.textContent).toBe('$0.0000');
  send({ type: 'speechCost', value: { seen: true, total: 0.00000001, pending: 0, partial: false } });
  expect(cost.textContent).toBe('<$0.0001');
  send({ type: 'session', active: false, reason: 'agent' });
  expect(cost.hidden).toBe(false);
  send({ type: 'speechCost', value: { seen: false, total: 0, pending: 0, partial: false } });
  expect(cost.hidden).toBe(true);
});

/** Returns the listeners the script added on a target for an event, to call them directly. */
function listenersFor(target: Target, name: string): Listener[] {
  const calls = targets.find((t) => t.target === target)?.spy.mock.calls ?? [];
  return calls
    .filter(([type]) => type === name)
    .map(([, listener]) => {
      if (typeof listener !== 'function') {
        throw new TypeError(`The script added a ${name} listener that is not a function`);
      }
      return listener;
    });
}

/** Says a message and returns the band's HTML for it. */
function shownAs(message: string): string {
  send({ type: 'say', text: message });
  return element('now-text').innerHTML;
}

/** Returns whether the run box shows. */
function boxShown(): boolean {
  return element('run').classList.contains('on');
}

/** Returns whether the run box waits for a decision. */
function boxConfirming(): boolean {
  return element('run').classList.contains('confirm');
}

/** Sends a phase of command 1, `npm test`. */
function runPhase(phase: Extract<ToPanel, { type: 'run' }>['phase']): void {
  send({ type: 'run', id: 1, command: 'npm test', phase });
}

/** Moves the pointer onto an element, or onto the document itself. */
function hover(target: Element | Window['document']): void {
  target.dispatchEvent(new window.PointerEvent('pointerover', { bubbles: true }));
}

/** Returns the tooltip's text, if it shows. */
function tip(): string | undefined {
  return element('tip').hidden ? undefined : text('tip');
}

it('refreshes and hides an open speech cost tooltip as accounting changes', () => {
  vi.useFakeTimers();
  send({ type: 'speechCost', value: { seen: true, total: 0, pending: 1, partial: false } });
  hover(element('speech-cost'));
  vi.advanceTimersByTime(TIP_DELAY_MS);
  expect(tip()).toContain('calculating');
  send({ type: 'speechCost', value: { seen: true, total: 0.0012, pending: 0, partial: false } });
  expect(tip()).toContain('$0.001200');
  send({ type: 'speechCost', value: { seen: false, total: 0, pending: 0, partial: false } });
  expect(tip()).toBeUndefined();
});

/** Starts a session with every kind of link: the intro's commands, a file and a URL in messages, code references. */
function withEveryLink(): void {
  start();
  send({ type: 'selection', ref: { file: 'src/a.ts', line: 3, endLine: 4 } });
  send({ type: 'point', file: 'src/a.ts', line: 2 });
  send({ type: 'say', text: 'See `src/a.ts` and https://example.com/docs' });
  send({ type: 'programmer', text: 'ok', ref: { file: 'src/a.ts', line: 5, endLine: 5 } });
  send({ type: 'say', text: 'Next.' });
}

/** Returns whether the Start a session button is hidden. */
function startHidden(): boolean {
  return element('start').hidden;
}

/** Returns whether the starting note is hidden. */
function noteHidden(): boolean {
  return element('starting').hidden;
}

describe('command approval controls', () => {
  it('shows current session grants and requests their revocation', () => {
    const status = element('command-approvals-status');
    const button = element('revoke-command-approvals');
    send({ type: 'commandApprovals', all: true, count: 1, confirmationRequired: true });
    expect(status.textContent).toContain('All commands');
    button.click();
    expect(posted()).toContainEqual({ type: 'revokeCommandApprovals' });
    send({ type: 'commandApprovals', all: false, count: 2, confirmationRequired: true });
    expect(status.textContent).toContain('2 command');
    send({ type: 'commandApprovals', all: false, count: 0, confirmationRequired: true });
    expect(status.textContent).toContain('No session');
    send({ type: 'commandApprovals', all: false, count: 0, confirmationRequired: false });
    expect(status.textContent).toContain('confirmation is off');
    expect(button.hasAttribute('disabled')).toBe(false);
    send({ type: 'commandApprovals', all: false, count: 0, confirmationRequired: true });
    expect(button.hasAttribute('disabled')).toBe(true);
  });
});

describe('loading', () => {
  it('posts ready once it has wired the page', () => {
    expect(posted()).toEqual([{ type: 'ready' }]);
  });

  it('throws when the page lacks an element it needs, or has it as another kind', async () => {
    const pause = element('pause');
    const div = document.createElement('div');
    div.dataset.ui = 'pause';
    pause.replaceWith(div);
    vi.resetModules();
    await expect(import(/* @vite-ignore */ SCRIPT)).rejects.toThrow('The panel has no HTMLButtonElement [data-ui="pause"]');
  });
});

describe('messages as HTML', () => {
  beforeEach(() => {
    start();
  });

  it('escapes markup', () => {
    shownAs(`<b>"x" & 'y'</b>`);
    expect(text('now-text')).toBe(`<b>"x" & 'y'</b>`);
    expect(element('now-text').querySelector('b')).toBeNull();
  });

  it('links a code span that names a file, and leaves other code as code', () => {
    expect(shownAs('Open `src/game.ts`.')).toBe('Open <a href="#" class="file" data-file="src/game.ts">src/game.ts</a>.');
    expect(shownAs('Call `update(dt)`.')).toBe('Call <code>update(dt)</code>.');
    expect(shownAs('See `.env`.')).toBe('See <code>.env</code>.');
  });

  it('links a URL, without the punctuation after it', () => {
    expect(shownAs('Docs: https://example.com/a?b=1.')).toBe(
      'Docs: <a href="#" class="url" data-url="https://example.com/a?b=1">https://example.com/a?b=1</a>.',
    );
  });
});

describe('the history (specs/Panel.tla, specs/PanelScroll.tla)', () => {
  it('NewestFirst, NoneLost: puts a reply above the agent message it answers', () => {
    start();
    send({ type: 'say', text: 'A' });
    send({ type: 'programmer', text: 'R' });
    send({ type: 'say', text: 'B' });
    expect(history()).toEqual(['R', 'A', 'Session started']);
  });

  it('NoDuplicates, NewestFirst: files the current message once, before anything added while it was current', () => {
    start();
    send({ type: 'say', text: 'A' });
    send({ type: 'programmer', text: 'R' });
    send({ type: 'interrupt' });
    send({ type: 'session', active: false, reason: 'agent' });
    expect(history()).toEqual(['The agent ended the session', 'You interrupted', 'R', 'A', 'Session started']);
  });

  it("names the project guides the agent was given in the session's divider (#23)", () => {
    send({ type: 'session', active: true, task: 'fix it', rules: ['~/.ai-pair/GUIDE.md', '/p/.ai-pair/GUIDE.md'] });
    expect(history()).toEqual([`Session started: fix it${LABEL_SEPARATOR}rules from ~/.ai-pair/GUIDE.md, /p/.ai-pair/GUIDE.md`]);
  });

  it("keeps a suspended session's history, and says when it waits for the agent and when it's back (#25)", () => {
    start();
    send({ type: 'say', text: 'A' });
    send({ type: 'session', active: true, suspended: true });
    expect(text('status-text')).toBe('Suspended: waiting for the agent');
    expect(element('dot').className).toBe('dot off');
    send({ type: 'session', active: true, resumed: true });
    expect(history()).toEqual([
      'The agent is back: session resumed',
      'The agent disconnected: the session waits for it',
      'A',
      'Session started',
    ]);
    expect(text('status-text')).toBe('Session started');
  });

  it.each([false, true])('ShownIsState: a replacement session clears an old suspension (replay %s)', (replay) => {
    const events: PanelEvent[] = [
      { type: 'session', active: true, task: 'Previous' },
      { type: 'session', active: true, task: 'Previous', suspended: true },
      { type: 'session', active: true, task: 'Replacement' },
      { type: 'state', state: 'typing', turn: 'agent', paused: false },
    ];
    if (replay) send({ type: 'replay', events });
    else for (const event of events) send(event);
    expect(text('status-text')).toContain('Playing');
    expect(text('status-text')).not.toContain('Suspended');
  });

  it('ShownIsState: late state and run events do not clear a real suspension', () => {
    start();
    send({ type: 'session', active: true, suspended: true });
    send({ type: 'state', state: 'typing', turn: 'agent', paused: false });
    send({ type: 'run', id: 40, command: 'test', phase: 'done', exitCode: 0 });
    expect(text('status-text')).toBe('Suspended: waiting for the agent');
  });

  it('ShownIsState: a session revived after a reload shows as suspended (#138)', () => {
    send({
      type: 'replay',
      events: [
        { type: 'session', active: true },
        { type: 'say', text: 'A' },
      ],
    });
    send({ type: 'session', active: true, suspended: true });
    expect(text('status-text')).toBe('Suspended: waiting for the agent');
    expect(history()).toEqual(['The agent disconnected: the session waits for it', 'A', 'Session started']);
  });

  it('ShownIsState: a revive after a disconnect shows the suspension once (#138)', () => {
    const suspended: ToPanel = { type: 'session', active: true, suspended: true };
    send({ type: 'replay', events: [{ type: 'session', active: true }, suspended] });
    send(suspended);
    expect(history()).toEqual(['The agent disconnected: the session waits for it', 'Session started']);
  });

  it('YoursInView: your message scrolls the history back to its top (#139)', () => {
    start();
    send({ type: 'say', text: 'A' });
    element('history').scrollTop = SCROLLED;
    send({ type: 'programmer', text: 'R' });
    expect(element('history').scrollTop).toBe(0);
    element('history').scrollTop = SCROLLED;
    send({ type: 'turn', to: 'programmer', message: 'M' });
    expect(element('history').scrollTop).toBe(0);
  });

  it('KeepsPlace: entries other than your message leave the history where you scrolled it (#139)', () => {
    start();
    send({ type: 'say', text: 'A' });
    element('history').scrollTop = SCROLLED;
    send({ type: 'say', text: 'B' });
    send({ type: 'interrupt' });
    send({ type: 'outside', files: ['a.ts'] });
    expect(element('history').scrollTop).toBe(SCROLLED);
  });

  it('lists files changed outside the editor, each a link to its diff (#15)', () => {
    start();
    send({ type: 'outside', files: ['src/a.ts'] });
    send({ type: 'outside', files: ['b.ts', 'c.ts'] });
    const entries = [...element('history').querySelectorAll('.outside')].map((e) => e.textContent);
    expect(entries).toEqual(['2 files changed outside the editor: b.ts, c.ts', 'src/a.ts changed outside the editor']);
    const link = element('history').querySelector('.outside a[href="#"]');
    ok(link);
    click(link);
    expect(posted().at(-1)).toEqual({ type: 'openChange', file: 'b.ts' });
  });

  it('shows your reply with the code it was about, as a link that opens it, a range with a dash', () => {
    start();
    send({ type: 'programmer', text: 'one line', ref: { file: 'src/a.ts', line: 5, endLine: 5 } });
    send({ type: 'programmer', text: 'a range', ref: { file: 'src/a.ts', line: 3, endLine: 4 } });
    expect(history().slice(0, 2)).toEqual([`a rangesrc/a.ts:3${RANGE_DASH}4`, 'one linesrc/a.ts:5']);
    const ref = element('history').querySelector('.you a.ref');
    ok(ref);
    click(ref);
    expect(posted().at(-1)).toEqual({ type: 'open', file: 'src/a.ts', line: 3 });
  });

  it('files a change of turn, with the message and code that came with it, and sets the placeholder to match', () => {
    start();
    send({ type: 'turn', to: 'programmer', message: 'M' });
    expect(replyBox().placeholder).toBe(`Ask the agent${ELLIPSIS}`);
    send({ type: 'turn', to: 'agent', ref: { file: 'b.ts', line: 1, endLine: 1 } });
    expect(replyBox().placeholder).toBe(`Reply to the agent${ELLIPSIS}`);
    send({ type: 'turn', to: 'programmer' });
    expect(history()).toEqual(['You took the turn', 'b.ts:1', 'You handed the turn back', 'M', 'You took the turn', 'Session started']);
  });

  it('says how the session ended, in the history and in the idle view, with its summary', () => {
    start();
    send({ type: 'session', active: false, reason: 'programmer', summary: 'Fixed `src/a.ts`.' });
    expect(text('idle-title')).toBe('Session ended');
    expect(element('idle-summary').querySelector('a.file')?.textContent).toBe('src/a.ts');
    expect(text('idle-text')).toBe('Ask your agent to pair again.');
    start();
    send({ type: 'session', active: false, reason: 'disconnected' });
    expect(text('idle-title')).toBe('The agent disconnected');
    expect(element('idle-summary').innerHTML).toBe('');
    expect(history().slice(0, 1)).toEqual(['The agent disconnected']);
    expect(history()).toContain('You ended the session');
  });
});

describe('the band', () => {
  it('PausedMatchesReasons: distinguishes actual pause, active playback, natural reading, and turn or confirmation waits', () => {
    start();
    send({ type: 'state', state: 'typing', turn: 'agent', paused: false });
    expect(text('status-text')).toBe('Playing: typing');
    expect(element('status-text').classList.contains('is-playing')).toBe(true);
    runPhase('confirm');
    expect(text('status-text')).toBe('Needs you');
    expect(element('status-text').classList.contains('is-playing')).toBe(false);
    runPhase('running');
    send({ type: 'state', state: 'typing', turn: 'agent', paused: true });
    expect(text('status-text')).toBe('Paused');
    expect(element('status-text').classList.contains('is-paused')).toBe(true);
    expect(element('status-text').classList.contains('is-playing')).toBe(false);
    runPhase('confirm');
    expect(text('status-text')).toBe(`Paused${LABEL_SEPARATOR}Needs you`);
    send({ type: 'state', state: 'navigator', turn: 'programmer', paused: true });
    runPhase('done');
    expect(text('status-text')).toBe(`Paused${LABEL_SEPARATOR}Your turn`);
    send({ type: 'state', state: 'navigator', turn: 'programmer', paused: false });
    expect(text('status-text')).toBe('Your turn');
    send({ type: 'state', state: 'read', turn: 'agent', paused: false });
    expect(text('status-text')).toBe('Read this');
    expect(element('status-text').classList.contains('is-paused')).toBe(false);
    send({ type: 'session', active: true, suspended: true });
    expect(text('status-text')).toBe('Suspended: waiting for the agent');
    expect(element('status-text').classList.contains('is-playing')).toBe(false);
    send({ type: 'session', active: false, reason: 'agent' });
    expect(text('status-text')).toBe('No session');
  });

  it('does not announce the same status again when the status is unchanged', () => {
    start();
    const message = { type: 'state', state: 'typing', turn: 'agent', paused: false } as const;
    send(message);
    const observer = new window.MutationObserver(() => {});
    observer.observe(element('status-text'), { childList: true, characterData: true, subtree: true });
    send(message);
    expect(observer.takeRecords()).toHaveLength(0);
    observer.disconnect();
  });

  it('waits for the agent when a session starts, and says there is no session before and after it', () => {
    expect(text('status-text')).toBe('No session');
    send({ type: 'say', text: 'Earlier' });
    start();
    expect(text('now-text')).toBe(`Waiting for the agent${ELLIPSIS}`);
    expect(element('now-text').classList.contains('empty')).toBe(true);
    expect(text('status-text')).toBe('Session started');
    expect(document.body.classList.contains('active')).toBe(true);
    expect(replyBox().disabled).toBe(false);
    send({ type: 'session', active: false, reason: 'agent' });
    expect(text('status-text')).toBe('No session');
    expect(element('dot').className).toBe('dot off');
    expect(replyBox().disabled).toBe(true);
  });

  it.each([
    ['typing', '', 'Playing: typing'],
    ['read', 'read', 'Read this'],
    ['running', '', 'Running a command'],
    ['thinking', 'dim', 'Waiting for agent'],
    ['absent', 'dim', "Agent isn't listening"],
    ['paused', 'dim', 'Paused'],
    ['listening', 'ring', 'Your move'],
    ['navigator', 'ring', 'Your turn'],
  ] as const)('shows the %s state as the dot and the status', (state, dot, status) => {
    start();
    send({ type: 'state', state, turn: 'agent', paused: false });
    expect([...element('dot').classList]).toEqual(dot === '' ? ['dot'] : ['dot', dot]);
    expect(text('status-text')).toBe(status);
  });

  it('shows the accepted work waiting to play and clears it on the next state', () => {
    start();
    send({ type: 'state', state: 'typing', turn: 'agent', paused: false, ready: 2 });
    expect(text('status-text')).toBe(`Playing: typing${LABEL_SEPARATOR}2 ready`);
    send({ type: 'state', state: 'typing', turn: 'agent', paused: false, ready: 0 });
    expect(text('status-text')).toBe('Playing: typing');
  });

  it('restores the ready count from replay and resets it for a new session', () => {
    send({
      type: 'replay',
      events: [
        { type: 'session', active: true, task: 'Earlier' },
        { type: 'state', state: 'typing', turn: 'agent', paused: false, ready: 1 },
      ],
    });
    expect(text('status-text')).toBe(`Playing: typing${LABEL_SEPARATOR}1 ready`);
    send({ type: 'session', active: false, reason: 'agent' });
    start();
    expect(text('status-text')).toBe('Session started');
  });

  it('keeps approval distinct from ready work and preserves suspension during replay', () => {
    send({
      type: 'replay',
      events: [
        { type: 'session', active: true, task: 'Earlier' },
        { type: 'state', state: 'typing', turn: 'agent', paused: false, ready: 2 },
        { type: 'run', id: 1, command: 'echo hi', phase: 'confirm' },
      ],
    });
    expect(text('status-text')).toBe(`Needs you${LABEL_SEPARATOR}2 ready`);
    send({ type: 'session', active: true, suspended: true });
    expect(text('status-text')).toBe('Suspended: waiting for the agent');
  });

  it('shows a pause and a change of turn on the buttons, their labels, and their tooltips', () => {
    start();
    send({ type: 'state', state: 'paused', turn: 'programmer', paused: true });
    expect(document.body.classList.contains('paused')).toBe(true);
    expect(document.body.classList.contains('programmer-turn')).toBe(true);
    expect(element('pause').classList.contains('on')).toBe(true);
    expect(element('pause').getAttribute('aria-label')).toBe('Resume');
    expect(element('pause').dataset.tip).toBe('Resume (Space)');
    expect(text('turn-label')).toBe('Hand back');
    expect(element('turn').getAttribute('aria-label')).toBe('Hand back');
    expect(element('turn').dataset.tip).toBe('Hand the turn back to the agent, with your reply if you typed one');
    send({ type: 'state', state: 'typing', turn: 'agent', paused: false });
    expect(document.body.classList.contains('paused')).toBe(false);
    expect(document.body.classList.contains('programmer-turn')).toBe(false);
    expect(element('pause').getAttribute('aria-label')).toBe('Pause');
    expect(element('pause').dataset.tip).toBe('Pause (Space)');
    expect(text('turn-label')).toBe('My turn');
    expect(element('turn').dataset.tip).toBe('Take the turn: you drive, the agent navigates');
  });

  it('shows the code the agent pointed at with the message about it, then lets it go', () => {
    start();
    send({ type: 'point', file: 'src/a.ts', line: 2 });
    send({ type: 'say', text: 'Here.' });
    expect(text('now-ref')).toBe(`${RIGHT_ARROW} src/a.ts:2`);
    const link = element('now-ref').querySelector('a.ref');
    ok(link);
    click(link);
    expect(posted().at(-1)).toEqual({ type: 'open', file: 'src/a.ts', line: 2 });
    send({ type: 'say', text: 'Next.' });
    expect(text('now-ref')).toBe('');
  });

  it('fades a new message in, but not one replayed', () => {
    send({
      type: 'replay',
      events: [
        { type: 'session', active: true },
        { type: 'say', text: 'A' },
      ],
    });
    expect(element('now-text').classList.contains('arrive')).toBe(false);
    send({ type: 'say', text: 'B' });
    expect(element('now-text').classList.contains('arrive')).toBe(true);
  });

  it('offers the selection with the reply while a session is on, until it is dismissed or cleared', () => {
    const ref = { file: 'src/a.ts', line: 3, endLine: 4 };
    send({ type: 'selection', ref });
    expect(element('attach').classList.contains('on')).toBe(false);
    start();
    expect(element('attach').classList.contains('on')).toBe(true);
    expect(text('attach-ref')).toBe(`src/a.ts:3${RANGE_DASH}4`);
    click(element('attach-x'));
    expect(element('attach').classList.contains('on')).toBe(false);
    send({ type: 'selection', ref });
    expect(element('attach').classList.contains('on')).toBe(true);
    send({ type: 'selection', ref: undefined });
    expect(element('attach').classList.contains('on')).toBe(false);
  });

  describe('the reading pause', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'performance'] });
      start();
    });

    it('fills the ring around the dot over the pause, holding while paused', () => {
      send({ type: 'reading', ms: READING_MS });
      expect(element('dot').classList.contains('reading')).toBe(true);
      expect(element('dot').style.getPropertyValue('--progress')).toBe('0');
      vi.advanceTimersByTime(READING_MS / 2);
      const half = Number(element('dot').style.getPropertyValue('--progress'));
      expect(half).toBeGreaterThan(0);
      expect(half).toBeLessThan(1);
      send({ type: 'state', state: 'paused', turn: 'agent', paused: true });
      expect(element('dot').classList.contains('reading')).toBe(true);
      vi.advanceTimersByTime(READING_MS);
      expect(Number(element('dot').style.getPropertyValue('--progress'))).toBe(half);
      send({ type: 'state', state: 'read', turn: 'agent', paused: false });
      vi.advanceTimersByTime(READING_MS);
      expect(element('dot').style.getPropertyValue('--progress')).toBe('1');
      expect(element('dot').classList.contains('reading')).toBe(false);
    });

    it('stops filling when the session ends, and does not start one replayed', () => {
      send({ type: 'reading', ms: READING_MS });
      send({ type: 'session', active: false, reason: 'programmer' });
      vi.advanceTimersByTime(READING_MS);
      expect(element('dot').style.getPropertyValue('--progress')).toBe('0');
      send({
        type: 'replay',
        events: [
          { type: 'session', active: true },
          { type: 'reading', ms: READING_MS },
        ],
      });
      expect(element('dot').classList.contains('reading')).toBe(false);
    });
  });
});

describe('the reading speed calibration (#109)', () => {
  it('announces the passage and opens the reply box, with no session', () => {
    send({ type: 'calibration', view: { phase: 'armed', title: 'Sample' } });
    expect(text('now-text')).toContain('Sample');
    expect(text('now-text')).toContain('type go');
    expect(replyBox().disabled).toBe(false);
    expect(document.body.classList.contains('calibrating')).toBe(true);
  });

  it('shows the passage and its notice while reading, then the result', () => {
    send({ type: 'calibration', view: { phase: 'reading', title: 'Sample', text: 'one two', notice: 'free' } });
    expect(element('passage').hidden).toBe(false);
    expect(text('passage-text')).toBe('one two');
    expect(text('passage-notice')).toBe('free');
    send({ type: 'calibration', view: { phase: 'done', msPerChar: 25.4, wordsPerMinute: 533 } });
    expect(element('passage').hidden).toBe(true);
    expect(text('now-text')).toContain('25 ms per character');
    expect(text('now-text')).toContain('533 words');
    expect(replyBox().disabled).toBe(true);
  });

  it('shows a passage without a notice, keeps the reply box open in a session, and says when it is canceled', () => {
    start();
    send({ type: 'calibration', view: { phase: 'reading', title: 'Sample', text: 'one two' } });
    expect(text('passage-notice')).toBe('');
    expect(text('now-text')).toBe('Sample. Type x the moment you finish.');
    send({ type: 'session', active: false, reason: 'programmer' });
    expect(replyBox().disabled).toBe(false);
    send({ type: 'calibration', view: { phase: 'idle' } });
    expect(text('now-text')).toBe('Calibration canceled; the reading speed is unchanged.');
    expect(document.body.classList.contains('calibrating')).toBe(false);
    expect(replyBox().disabled).toBe(true);
  });
});

describe('the run box (specs/RunBox.tla)', () => {
  beforeEach(() => {
    start();
  });

  it('plays an optional cue only for a new live approval prompt', () => {
    const cue = element('command-approval-sound');
    if (!(cue instanceof window.HTMLInputElement)) throw new TypeError('Missing approval sound setting');
    expect(cue.checked).toBe(false);
    runPhase('confirm');
    expect(approvalSound.play).not.toHaveBeenCalled();
    cue.checked = true;
    cue.dispatchEvent(new window.Event('change'));
    expect(posted()).toContainEqual({ type: 'commandApprovalSound', value: true });
    expect(approvalSound.unlock).toHaveBeenCalledOnce();
    send({ type: 'run', id: 1, command: 'npm test', phase: 'running' });
    expect(approvalSound.play).not.toHaveBeenCalled();
    send({ type: 'run', id: 2, command: 'pwd', phase: 'confirm' });
    expect(approvalSound.play).toHaveBeenCalledOnce();
    send({ type: 'run', id: 2, command: 'pwd', phase: 'confirm' });
    send({ type: 'replay', events: [{ type: 'run', id: 3, command: 'ls', phase: 'confirm' }] });
    expect(approvalSound.play).toHaveBeenCalledOnce();
    cue.checked = false;
    cue.dispatchEvent(new window.Event('change'));
    expect(posted()).toContainEqual({ type: 'commandApprovalSound', value: false });
    send({ type: 'commandApprovalSound', value: false });
    expect(cue.checked).toBe(false);
    send({ type: 'run', id: 4, command: 'echo done', phase: 'confirm' });
    expect(approvalSound.play).toHaveBeenCalledOnce();
    send({ type: 'commandApprovalSound', value: true });
    document.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }));
    expect(approvalSound.unlock).toHaveBeenCalledTimes(2);
    send({ type: 'session', active: true, task: 'A new session' });
    send({ type: 'run', id: 2, command: 'pwd', phase: 'confirm' });
    expect(approvalSound.play).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new window.Event('unload'));
    expect(approvalSound.dispose).toHaveBeenCalledOnce();
  });

  it('BoxMatches: shows the box while a command waits for a decision, and while it runs', () => {
    expect(boxShown()).toBe(false);
    runPhase('confirm');
    expect(boxShown() && boxConfirming()).toBe(true);
    expect(text('run-label')).toBe('Allow this command in the terminal?');
    expect(text('run-cmd')).toBe('npm test');
    expect(text('status-text')).toBe('Needs you');
    expect(element('dot').className).toBe('dot read');
    expect(element('run').classList.contains('arrive')).toBe(true);
    runPhase('running');
    expect(boxShown() && !boxConfirming()).toBe(true);
    expect(text('run-label')).toBe(`Running in the terminal${ELLIPSIS}`);
    expect(text('status-text')).toBe('Session started');
  });

  it.each(['done', 'background', 'declined'] as const)('Clears: a %s phase clears the box', (phase) => {
    runPhase('running');
    runPhase(phase);
    expect(boxShown()).toBe(false);
  });

  it('Clears: the session ending clears the box', () => {
    runPhase('confirm');
    send({ type: 'session', active: false, reason: 'programmer' });
    expect(boxShown()).toBe(false);
  });

  it('Clears: a new session removes an old approval without deciding it', () => {
    runPhase('confirm');
    send({ type: 'session', active: true, suspended: true });
    expect(boxShown()).toBe(true);
    send({ type: 'session', active: true, resumed: true });
    expect(boxShown()).toBe(true);
    send({ type: 'session', active: true, task: 'New session' });
    expect(boxShown()).toBe(false);
    click(element('run-go'));
    expect(posted()).not.toContainEqual(expect.objectContaining({ type: 'runDecision' }));
  });

  it("leaves the box alone when another command's run ends", () => {
    runPhase('confirm');
    send({ type: 'run', id: 2, command: 'ls', phase: 'done' });
    expect(boxShown() && boxConfirming()).toBe(true);
  });

  it('does not fade in a command replayed', () => {
    send({ type: 'replay', events: [{ type: 'run', id: 1, command: 'npm test', phase: 'confirm' }] });
    expect(element('run').classList.contains('arrive')).toBe(false);
  });

  it('posts the decision on the command the box shows, and nothing once the box is clear', () => {
    runPhase('confirm');
    click(element('run-go'));
    click(element('run-always'));
    click(element('run-all'));
    click(element('run-skip'));
    expect(posted().slice(-4)).toEqual([
      { type: 'runDecision', id: 1, run: true, scope: 'once' },
      { type: 'runDecision', id: 1, run: true, scope: 'command' },
      { type: 'runDecision', id: 1, run: true, scope: 'all' },
      { type: 'runDecision', id: 1, run: false, scope: 'once' },
    ]);
    runPhase('declined');
    click(element('run-go'));
    expect(posted().at(-1)?.type).toBe('runDecision');
    expect(posted().filter((m) => m.type === 'runDecision')).toHaveLength(4);
  });

  it.each([
    ['declined', undefined, 'skipped', []],
    ['background', undefined, 'still running', []],
    ['done', undefined, 'status unknown', []],
    ['done', 0, 'exit 0', ['ok']],
    ['done', 130, 'stopped', []],
    ['done', 143, 'stopped', []],
    ['done', 1, 'exit 1', ['fail']],
  ] as const)('files a %s run with exit code %s as %s', (phase, exitCode, outcome, classes) => {
    send({ type: 'run', id: 1, command: 'npm test', phase, ...(exitCode === undefined ? {} : { exitCode }) });
    const row = element('history').querySelector('.run[data-run="1"]');
    ok(row);
    expect(row.querySelector('.cmd')?.textContent).toBe('npm test');
    expect(row.querySelector<HTMLElement>('.cmd')?.dataset.tip).toBe('npm test');
    expect(row.classList.contains('skipped')).toBe(phase === 'declined');
    const shownOutcome = row.querySelector('.outcome');
    ok(shownOutcome);
    expect(shownOutcome.textContent).toBe(outcome);
    expect([...shownOutcome.classList].filter((c) => c !== 'outcome')).toEqual(classes);
  });

  it('says how a command left running ended, on its row', () => {
    runPhase('background');
    send({ type: 'run', id: 1, command: 'npm test', phase: 'exited' });
    expect(element('history').querySelector('.run[data-run="1"] .outcome')?.textContent).toBe('status unknown');
    send({ type: 'run', id: 1, command: 'npm test', phase: 'exited', exitCode: 1 });
    expect(element('history').querySelector('.run[data-run="1"] .outcome')?.textContent).toBe('exit 1');
    send({ type: 'run', id: 9, command: 'gone', phase: 'exited', exitCode: 0 });
    expect(element('history').querySelector('.run[data-run="9"]')).toBeNull();
  });
});

describe('the reply box (specs/Draft.tla)', () => {
  beforeEach(() => {
    start();
    post.mockClear();
  });

  it('posts draft when the box goes from empty to not, and back', () => {
    typeReply('h');
    typeReply('hi');
    typeReply('  ');
    expect(posted()).toEqual([
      { type: 'draft', empty: false },
      { type: 'draft', empty: true },
    ]);
    expect(replyBox().style.height).toBe('0px');
  });

  it('sends the reply on Enter, with the selection, and clears the box', () => {
    send({ type: 'selection', ref: { file: 'a.ts', line: 1, endLine: 1 } });
    typeReply(' hello ');
    press(replyBox(), 'Enter');
    expect(posted()).toEqual([
      { type: 'draft', empty: false },
      { type: 'reply', text: 'hello', attach: true },
    ]);
    expect(replyBox().value).toBe('');
    expect(element('attach').classList.contains('on')).toBe(false);
    typeReply('again');
    click(element('send'));
    expect(posted().at(-1)).toEqual({ type: 'reply', text: 'again', attach: false });
  });

  it('sends nothing for an empty box, and keeps Shift+Enter and a composition in the box', () => {
    press(replyBox(), 'Enter');
    typeReply('a');
    press(replyBox(), 'Enter', { shiftKey: true });
    press(replyBox(), 'Enter', { isComposing: true });
    press(replyBox(), 'a');
    expect(posted()).toEqual([{ type: 'draft', empty: false }]);
  });

  it('lets go of the box on Escape, and takes it on focusReply', () => {
    send({ type: 'focusReply' });
    expect(document.activeElement).toBe(replyBox());
    press(replyBox(), 'Escape');
    expect(document.activeElement).not.toBe(replyBox());
  });
});

describe('the controls', () => {
  beforeEach(() => {
    start();
    post.mockClear();
  });

  it('posts pause, resume, interrupt, and end', () => {
    click(element('pause'));
    send({ type: 'state', state: 'paused', turn: 'agent', paused: true });
    click(element('pause'));
    click(element('interrupt'));
    click(element('end'));
    expect(posted()).toEqual([{ type: 'pause' }, { type: 'resume' }, { type: 'interrupt' }, { type: 'end' }]);
  });

  it('ShowsCursor: requests cursor navigation without changing playback', () => {
    click(element('reveal-cursor'));
    expect(posted()).toEqual([{ type: 'revealCursor' }]);
  });

  it('takes the turn bare, and hands it back with the reply and the selection', () => {
    click(element('turn'));
    send({ type: 'state', state: 'navigator', turn: 'programmer', paused: false });
    click(element('turn'));
    send({ type: 'selection', ref: { file: 'a.ts', line: 1, endLine: 1 } });
    typeReply('look');
    click(element('turn'));
    expect(posted().filter((m) => m.type === 'turn')).toEqual([
      { type: 'turn' },
      { type: 'turn' },
      { type: 'turn', message: 'look', attach: true },
    ]);
  });

  it('pauses and resumes on Space anywhere but the reply box, without pressing the focused button', () => {
    press(element('end'), ' ');
    send({ type: 'state', state: 'paused', turn: 'agent', paused: true });
    const spaced = new window.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    element('end').dispatchEvent(spaced);
    expect(spaced.defaultPrevented).toBe(true);
    press(element('end'), ' ', { repeat: true });
    press(replyBox(), ' ');
    for (const modifier of ['ctrlKey', 'metaKey', 'altKey']) {
      element('end').dispatchEvent(new window.KeyboardEvent('keydown', { key: ' ', bubbles: true, [modifier]: true }));
    }
    press(element('end'), 'a');
    send({ type: 'state', state: 'navigator', turn: 'programmer', paused: false });
    press(element('end'), ' ');
    send({ type: 'session', active: false, reason: 'programmer' });
    press(element('end'), ' ');
    expect(posted()).toEqual([{ type: 'pause' }, { type: 'resume' }]);
  });
});

describe('the speed menus', () => {
  /** The two menus: their button, their menu, the message they post, and how their button reads. */
  const menus = [
    { button: 'speed', menu: 'speed-menu', type: 'speed', name: 'Playback speed', prefix: '' },
    { button: 'reading-speed', menu: 'reading-menu', type: 'readingSpeed', name: 'Reading speed', prefix: 'read ' },
  ] as const;

  it.each(menus)('$type: shows the setting on its button, one decimal unless it has more, and checks it in the menu', (m) => {
    send({ type: m.type, value: 1.5 });
    expect(text(m.button)).toBe(`${m.prefix}1.5${SPEED_SUFFIX}`);
    expect(element(m.button).getAttribute('aria-label')).toBe(`${m.name}: 1.5${SPEED_SUFFIX}`);
    expect(element(m.menu).querySelector('[data-speed][aria-checked="true"]')?.textContent).toBe(`1.5${SPEED_SUFFIX}`);
    send({ type: m.type, value: 2 });
    expect(text(m.button)).toBe(`${m.prefix}2.0${SPEED_SUFFIX}`);
    send({ type: m.type, value: 1.25 });
    expect(text(m.button)).toBe(`${m.prefix}1.25${SPEED_SUFFIX}`);
    expect(element(m.menu).querySelector('[data-speed][aria-checked="true"]')).toBeNull();
  });

  it.each(menus)('$type: opens on its button with the setting focused, and posts the speed chosen', (m) => {
    start();
    send({ type: m.type, value: 2 });
    click(element(m.button));
    expect(element(m.menu).hidden).toBe(false);
    expect(element(m.button).getAttribute('aria-expanded')).toBe('true');
    expect(element(m.button).classList.contains('on')).toBe(true);
    expect(document.activeElement?.textContent).toBe(`2.0${SPEED_SUFFIX}`);
    const choice = element(m.menu).querySelector('[data-speed="0.6"]');
    ok(choice);
    click(choice);
    expect(element(m.menu).hidden).toBe(true);
    expect(element(m.button).getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(element(m.button));
    expect(posted().at(-1)).toEqual({ type: m.type, value: 0.6 });
  });

  it.each(menus)('$type: closes on its button, on a click outside it, on Escape, and when the session ends', (m) => {
    start();
    click(element(m.button));
    expect(document.activeElement).not.toBe(element(m.button));
    click(element(m.button));
    expect(element(m.menu).hidden).toBe(true);
    click(element(m.button));
    click(element(m.menu));
    expect(element(m.menu).hidden).toBe(false);
    click(element('now-text'));
    expect(element(m.menu).hidden).toBe(true);
    click(element(m.button));
    press(element('now-text'), 'Escape');
    expect(element(m.menu).hidden).toBe(true);
    expect(document.activeElement).toBe(element(m.button));
    press(element('now-text'), 'Escape');
    click(element(m.button));
    send({ type: 'session', active: false, reason: 'programmer' });
    expect(element(m.menu).hidden).toBe(true);
  });
});

it('TypeOK, OneOpen, RequestedVisible, ClosedWhenNone, ClickShows: opening another menu closes the first and Escape closes the last', () => {
  start();
  click(element('speed'));
  click(element('reading-speed'));
  expect(element('speed-menu').hidden).toBe(true);
  expect(element('speed').getAttribute('aria-expanded')).toBe('false');
  expect(element('reading-menu').hidden).toBe(false);
  click(element('code-mode'));
  expect(element('reading-menu').hidden).toBe(true);
  expect(element('code-mode-menu').hidden).toBe(false);
  press(element('code-mode-menu'), 'Escape');
  expect(element('code-mode-menu').hidden).toBe(true);
  expect(document.activeElement).toBe(element('code-mode'));
});

it('repositions open menus on resize and scroll and keeps the focused item inside', () => {
  start();
  for (const [button, name] of [
    ['speed', 'speed-menu'],
    ['reading-speed', 'reading-menu'],
    ['code-mode', 'code-mode-menu'],
  ] as const) {
    const menu = element(name);
    vi.spyOn(menu, 'getBoundingClientRect').mockReturnValue(new window.DOMRect(10, 20, 80, 40));
    vi.spyOn(element(button), 'getBoundingClientRect').mockReturnValue(new window.DOMRect(20, 800, 30, 20));
    click(element(button));
    const focused = document.activeElement;
    ok(focused instanceof window.HTMLElement);
    const rect = vi.spyOn(focused, 'getBoundingClientRect').mockReturnValue(new window.DOMRect(10, 80, 20, 20));
    window.dispatchEvent(new window.Event('resize'));
    expect(menu.scrollTop).toBeGreaterThan(0);
    rect.mockReturnValue(new window.DOMRect(10, 0, 20, 10));
    const before = menu.scrollTop;
    window.dispatchEvent(new window.Event('resize'));
    expect(menu.scrollTop).toBeLessThan(before);
    document.dispatchEvent(new window.Event('scroll'));
    click(element(button));
  }
});

describe('the tooltips', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    start();
  });

  it('takes its delays from the extension: a shorter one shows the tooltip sooner', () => {
    send({ type: 'timings', tipDelayMs: 50, tipWarmMs: 10 });
    hover(element('interrupt'));
    vi.advanceTimersByTime(50);
    expect(tip()).toBe('Interrupt');
    hover(document);
    vi.advanceTimersByTime(10);
    hover(element('end'));
    expect(tip()).toBeUndefined();
    vi.advanceTimersByTime(50);
    expect(tip()).toBe('End the session');
    send({ type: 'timings', tipDelayMs: TIP_DELAY_MS, tipWarmMs: TIP_WARM_MS });
  });

  it('shows after a moment over an element, under it, and at once over the next while one shows', () => {
    hover(element('interrupt'));
    expect(tip()).toBeUndefined();
    vi.advanceTimersByTime(TIP_DELAY_MS);
    expect(tip()).toBe('Interrupt');
    expect(element('interrupt').getAttribute('aria-describedby')).toBe('tip');
    expect(element('tip').style.top).toBe('6px');
    hover(element('interrupt'));
    hover(element('end').querySelector('svg') ?? element('end'));
    expect(tip()).toBe('End the session');
    expect(element('interrupt').hasAttribute('aria-describedby')).toBe(false);
  });

  it('shows nothing once the pointer leaves for an element without one while it waits, and keeps waiting within the same element', () => {
    hover(element('end'));
    hover(element('now-text'));
    vi.advanceTimersByTime(TIP_DELAY_MS);
    expect(tip()).toBeUndefined();
    hover(element('end'));
    vi.advanceTimersByTime(TIP_DELAY_MS / 2);
    hover(element('end').querySelector('svg') ?? element('end'));
    vi.advanceTimersByTime(TIP_DELAY_MS / 2);
    expect(tip()).toBe('End the session');
  });

  it('stays warm for a moment after it hides, then waits again', () => {
    hover(element('end'));
    vi.advanceTimersByTime(TIP_DELAY_MS);
    hover(element('now-text'));
    expect(tip()).toBeUndefined();
    hover(element('interrupt'));
    expect(tip()).toBe('Interrupt');
    document.documentElement.dispatchEvent(new window.PointerEvent('pointerleave'));
    vi.advanceTimersByTime(TIP_WARM_MS);
    hover(element('end'));
    expect(tip()).toBeUndefined();
    vi.advanceTimersByTime(TIP_DELAY_MS);
    expect(tip()).toBe('End the session');
  });

  it('shows above an element with no room under it', () => {
    const rect = new window.DOMRect(0, window.innerHeight - SCROLLED, SCROLLED, SCROLLED);
    vi.spyOn(element('end'), 'getBoundingClientRect').mockReturnValue(rect);
    hover(element('end'));
    vi.advanceTimersByTime(TIP_DELAY_MS);
    expect(element('tip').style.top).toBe(`${window.innerHeight - SCROLLED - 4}px`);
  });

  it('hides on a click, a scroll, Escape, the panel losing focus, and the pointer leaving', () => {
    const hiders = [
      (): void => {
        element('end').dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true }));
      },
      (): void => {
        element('history').dispatchEvent(new window.Event('scroll'));
      },
      (): void => {
        press(element('end'), 'Escape');
      },
      (): void => {
        window.dispatchEvent(new window.Event('blur'));
      },
      (): void => {
        document.documentElement.dispatchEvent(new window.PointerEvent('pointerleave'));
      },
    ];
    for (const hide of hiders) {
      hover(element('end'));
      vi.advanceTimersByTime(TIP_DELAY_MS);
      expect(tip()).toBe('End the session');
      hide();
      expect(tip()).toBeUndefined();
      vi.advanceTimersByTime(TIP_WARM_MS);
    }
  });

  it('shows on keyboard focus, and hides when the focus goes', () => {
    element('end').focus();
    expect(tip()).toBe('End the session');
    element('send').focus();
    expect(tip()).toBe('Send (Enter)');
    replyBox().focus();
    expect(tip()).toBeUndefined();
    element('end').focus();
    element('end').blur();
    expect(tip()).toBeUndefined();
  });

  it('follows the text of its element when it changes, and hides when the element goes', () => {
    hover(element('pause'));
    vi.advanceTimersByTime(TIP_DELAY_MS);
    send({ type: 'state', state: 'paused', turn: 'agent', paused: true });
    expect(tip()).toBe('Resume (Space)');
    const rects = element('pause').getClientRects();
    rects.splice(0);
    vi.spyOn(element('pause'), 'getClientRects').mockReturnValue(rects);
    send({ type: 'session', active: false, reason: 'programmer' });
    expect(tip()).toBeUndefined();
  });

  it.each([
    ['speed', 'speed-menu'],
    ['reading-speed', 'reading-menu'],
  ])("does not cover %s's open menu", (button, menu) => {
    click(element(button));
    expect(element(menu).hidden).toBe(false);
    hover(element(button));
    vi.advanceTimersByTime(TIP_DELAY_MS);
    expect(tip()).toBeUndefined();
  });
});

describe('links, by keyboard and screen reader (#16)', () => {
  it('makes every link focusable, and none holds another', () => {
    withEveryLink();
    const links = [...document.querySelectorAll('a')];
    expect(links.map((a) => a.className).toSorted()).toEqual(expect.arrayContaining(['command', 'file', 'ref', 'url']));
    for (const a of links) {
      expect(a.getAttribute('href'), a.outerHTML).toBe('#');
      expect(a.querySelector('a'), a.outerHTML).toBeNull();
    }
  });

  it('activates a link without following its href', () => {
    withEveryLink();
    for (const a of document.querySelectorAll('a')) {
      const event = new window.MouseEvent('click', { bubbles: true, cancelable: true });
      a.dispatchEvent(event);
      expect(event.defaultPrevented, a.outerHTML).toBe(true);
    }
    expect(posted()).toEqual(
      expect.arrayContaining([
        { type: 'openFile', file: 'src/a.ts' },
        { type: 'openUrl', url: 'https://example.com/docs' },
        { type: 'command', command: 'aiPair.playDemo' },
        { type: 'command', command: 'aiPair.setUpAgent' },
        { type: 'open', file: 'src/a.ts', line: 5 },
      ]),
    );
  });

  it('leaves a click outside any link alone', () => {
    const event = new window.MouseEvent('click', { bubbles: true, cancelable: true });
    element('now-text').dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(posted()).toEqual([{ type: 'ready' }]);
  });

  it("announces the agent's narration and the state, and a command waiting for a decision at once", () => {
    expect(element('now-text').getAttribute('aria-live')).toBe('polite');
    expect(element('status-text').getAttribute('role')).toBe('status');
    const run = element('run');
    start();
    send({ type: 'run', id: 1, command: 'npm test', phase: 'confirm' });
    expect(run.getAttribute('role')).toBe('alert');
    send({ type: 'run', id: 1, command: 'npm test', phase: 'running' });
    expect(run.getAttribute('role')).toBeNull();
    send({ type: 'run', id: 2, command: 'npm run build', phase: 'confirm' });
    send({ type: 'run', id: 2, command: 'npm run build', phase: 'declined' });
    expect(run.getAttribute('role')).toBeNull();
  });
});

describe('Start a session (specs/Start.tla, #107)', () => {
  it('ClicksNeedButtonProp: hides Start a session until the extension says it can start one', () => {
    expect(startHidden()).toBe(true);
    send({ type: 'canStart', value: true });
    expect(startHidden()).toBe(false);
    send({ type: 'canStart', value: false });
    expect(startHidden()).toBe(true);
  });

  it('StartsAreClicks: posts start when the button is clicked', () => {
    send({ type: 'canStart', value: true });
    click(element('start'));
    expect(posted()).toContainEqual({ type: 'start' });
  });

  it('AcknowledgedProp: shows the starting note at once when the button is clicked', () => {
    send({ type: 'canStart', value: true });
    expect(noteHidden()).toBe(true);
    click(element('start'));
    expect(noteHidden()).toBe(false);
  });

  it('NoteGoes: hides the starting note once the agent has exited, with no session', () => {
    send({ type: 'canStart', value: true });
    click(element('start'));
    send({ type: 'startEnded' });
    expect(noteHidden()).toBe(true);
  });

  it('NoteUntilSession: hides the starting note when a session starts, new or resumed', () => {
    const sessions: ToPanel[] = [
      { type: 'session', active: true },
      { type: 'session', active: true, resumed: true },
    ];
    for (const session of sessions) {
      send({ type: 'session', active: false, reason: 'programmer' });
      send({ type: 'canStart', value: true });
      click(element('start'));
      expect(noteHidden()).toBe(false);
      send(session);
      expect(noteHidden()).toBe(true);
    }
  });
});

// Guards no message the extension sends, and no event a real page fires, can reach: the test reaches each by a
// message outside ToPanel, by an event on a target that is not an element, or by changing the page under the script.
describe('guards', () => {
  it('throws on a message it does not know', () => {
    expect(() => {
      for (const listener of listenersFor(window, 'message')) {
        listener(new window.MessageEvent('message', { data: { type: 'unknown' } }));
      }
    }).toThrow('Unknown panel message: {"type":"unknown"}');
  });

  it('ignores a calibration phase it does not know', () => {
    send({ type: 'say', text: 'Before' });
    for (const listener of listenersFor(window, 'message')) {
      listener(new window.MessageEvent('message', { data: { type: 'calibration', view: { phase: 'unknown' } } }));
    }
    expect(text('now-text')).toBe('Before');
  });

  it('ignores pointer and focus events on the document itself, and takes a click on no node as one outside the menu', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    start();
    click(element('speed'));
    document.dispatchEvent(new window.PointerEvent('pointerover', { bubbles: true }));
    document.dispatchEvent(new window.FocusEvent('focusin', { bubbles: true }));
    vi.advanceTimersByTime(TIP_DELAY_MS);
    expect(element('tip').hidden).toBe(true);
    for (const listener of listenersFor(document, 'click')) {
      listener(new window.MouseEvent('click'));
    }
    expect(element('speed-menu').hidden).toBe(true);
    expect(posted()).toEqual([{ type: 'ready' }]);
    click(element('speed'));
    click(document);
    expect(element('speed-menu').hidden).toBe(true);
  });

  it('shows an empty tooltip for an element that lost its text while the tooltip waited', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    start();
    element('tip').textContent = 'stale';
    element('end').dispatchEvent(new window.PointerEvent('pointerover', { bubbles: true }));
    delete element('end').dataset.tip;
    vi.advanceTimersByTime(TIP_DELAY_MS);
    expect(element('tip').hidden).toBe(false);
    expect(text('tip')).toBe('');
  });
});

describe('chat order', () => {
  it('renders events oldest first and places the current message and reply after history', () => {
    send({ type: 'chatOrder', value: 'oldestFirst' });
    start();
    send({ type: 'say', text: 'First' });
    send({ type: 'say', text: 'Second' });
    expect(history()).toEqual(['Session started', 'First']);
    expect(element('history').getAttribute('aria-label')).toBe('Earlier, oldest first');
    expect(element('history').compareDocumentPosition(element('reply')) & window.Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('reorders existing entries when the setting changes and keeps the current message once', () => {
    start();
    send({ type: 'say', text: 'First' });
    send({ type: 'say', text: 'Second' });
    send({ type: 'chatOrder', value: 'oldestFirst' });
    expect(history()).toEqual(['Session started', 'First']);
    send({ type: 'say', text: 'Third' });
    expect(history()).toEqual(['Session started', 'First', 'Second']);
    send({ type: 'chatOrder', value: 'newestFirst' });
    expect(history()).toEqual(['Second', 'First', 'Session started']);
    expect(element('history').getAttribute('aria-label')).toBe('Earlier, newest first');
  });
});

describe('panel settings', () => {
  it('opens shortcut customization from Pair settings', () => {
    click(element('settings'));
    click(element('configure-shortcuts'));
    expect(posted()).toContainEqual({ type: 'command', command: 'aiPair.configureShortcuts' });
  });

  it('closes settings and focuses reply when focus is requested', () => {
    click(element('settings'));
    expect(element('settings-dialog').hasAttribute('open')).toBe(true);
    send({ type: 'focusReply' });
    expect(element('settings-dialog').hasAttribute('open')).toBe(false);
    expect(document.activeElement).toBe(replyBox());
  });
  it('projects navigator commentary and sends changes', () => {
    const select = element('navigator-commentary');
    if (!(select instanceof window.HTMLSelectElement)) throw new TypeError('Expected a select');
    send({ type: 'navigatorCommentary', value: 'quiet' });
    expect(select.value).toBe('quiet');
    select.value = 'coach';
    select.dispatchEvent(new window.Event('change', { bubbles: true }));
    expect(posted()).toContainEqual({ type: 'navigatorCommentary', value: 'coach' });
    const count = posted().length;
    select.value = 'invalid';
    select.dispatchEvent(new window.Event('change', { bubbles: true }));
    expect(posted()).toHaveLength(count);
  });

  it('opens a named settings dialog, sends a changed order, and restores focus on close', () => {
    const button = element('settings');
    button.focus();
    click(button);
    const dialog = element('settings-dialog');
    expect(dialog.getAttribute('aria-label')).toBe('Settings');
    expect(dialog.hasAttribute('open')).toBe(true);
    const select = element('chat-order');
    expect(document.activeElement).toBe(select);
    if (!(select instanceof window.HTMLSelectElement)) throw new TypeError('Expected a select');
    select.value = 'oldestFirst';
    select.dispatchEvent(new window.Event('change', { bubbles: true }));
    expect(posted()).toContainEqual({ type: 'chatOrder', value: 'oldestFirst' });
    click(element('settings-close'));
    expect(dialog.hasAttribute('open')).toBe(false);
    expect(document.activeElement).toBe(button);
  });
});

describe('visible chronology', () => {
  it.each(['newestFirst', 'oldestFirst'] as const)(
    'VisibleOnce, NoneLost: shows each agent and programmer message once in %s order',
    (order) => {
      send({ type: 'chatOrder', value: order });
      start();
      send({ type: 'say', text: 'Agent A' });
      send({ type: 'programmer', text: 'Programmer B' });
      expect(text('now-text')).not.toContain('Agent A');
      expect(history().filter((value) => value.includes('Agent A'))).toHaveLength(1);
      expect(history().filter((value) => value.includes('Programmer B'))).toHaveLength(1);
      send({ type: 'say', text: 'Agent C' });
      expect(text('now-text')).toBe('Agent C');
      const messages = history().filter((value) => value === 'Agent A' || value === 'Programmer B');
      expect(messages).toEqual(order === 'newestFirst' ? ['Programmer B', 'Agent A'] : ['Agent A', 'Programmer B']);
    },
  );
});

it('keeps a pointed code link with the filed agent message', () => {
  start();
  send({ type: 'point', file: 'src/example.ts', line: 12 });
  send({ type: 'say', text: 'Look here' });
  send({ type: 'programmer', text: 'I see it' });
  const link = element('history').querySelector('.agent a.ref');
  expect(link?.textContent).toBe(`${RIGHT_ARROW} src/example.ts:12`);
  if (link === null) throw new Error('Filed message has no code link');
  click(link);
  expect(posted()).toContainEqual({ type: 'open', file: 'src/example.ts', line: 12 });
});

describe('history position', () => {
  it('follows the newest edge on input and resize but preserves a scrolled-away view', () => {
    const historyElement = element('history');
    Object.defineProperty(historyElement, 'scrollHeight', { configurable: true, value: 500 });
    Object.defineProperty(historyElement, 'clientHeight', { configurable: true, value: 100 });
    resizeHistory();
    send({ type: 'chatOrder', value: 'oldestFirst' });
    historyElement.scrollTop = 400;
    historyElement.dispatchEvent(new window.Event('scroll'));
    typeReply('draft');
    expect(historyElement.scrollTop).toBe(500);
    historyElement.scrollTop = 400;
    resizeHistory();
    expect(historyElement.scrollTop).toBe(500);
    historyElement.scrollTop = 100;
    historyElement.dispatchEvent(new window.Event('scroll'));
    send({ type: 'say', text: 'one' });
    send({ type: 'say', text: 'two' });
    typeReply('other draft');
    resizeHistory();
    expect(historyElement.scrollTop).toBe(100);
    Object.defineProperty(historyElement, 'clientHeight', { configurable: true, value: 90 });
    historyElement.dispatchEvent(new window.Event('scroll'));
    resizeHistory();
    expect(historyElement.scrollTop).toBe(100);
  });

  it.each(['message', 'input'] as const)('KeepsPlace: observes a scroll before a pending resize when handling %s', (change) => {
    const historyElement = element('history');
    Object.defineProperty(historyElement, 'scrollHeight', { configurable: true, value: 500 });
    Object.defineProperty(historyElement, 'clientHeight', { configurable: true, value: 100 });
    resizeHistory();
    send({ type: 'chatOrder', value: 'oldestFirst' });
    historyElement.scrollTop = 400;
    historyElement.dispatchEvent(new window.Event('scroll'));
    // A user scroll can precede delivery of the browser's scroll event.
    historyElement.scrollTop = 40;
    if (change === 'message') send({ type: 'say', text: 'incoming' });
    else typeReply('draft');
    resizeHistory();
    expect(historyElement.scrollTop).toBe(40);
  });

  it.each([500, 900])('FollowsLatest: a message during a pending viewport resize keeps the latest edge (height %i)', (newScrollHeight) => {
    const historyElement = element('history');
    Object.defineProperty(historyElement, 'scrollHeight', { configurable: true, value: 500 });
    Object.defineProperty(historyElement, 'clientHeight', { configurable: true, value: 100 });
    resizeHistory();
    send({ type: 'chatOrder', value: 'oldestFirst' });
    historyElement.scrollTop = 400;
    historyElement.dispatchEvent(new window.Event('scroll'));
    Object.defineProperty(historyElement, 'clientHeight', { configurable: true, value: 90 });
    Object.defineProperty(historyElement, 'scrollHeight', { configurable: true, value: newScrollHeight });
    send({ type: 'say', text: 'incoming' });
    resizeHistory();
    expect(historyElement.scrollTop).toBe(newScrollHeight);
  });

  it('KeepsPlace: observes a new reader scroll after following a resize', () => {
    const historyElement = element('history');
    Object.defineProperty(historyElement, 'scrollHeight', { configurable: true, value: 500 });
    Object.defineProperty(historyElement, 'clientHeight', { configurable: true, value: 100 });
    resizeHistory();
    send({ type: 'chatOrder', value: 'oldestFirst' });
    historyElement.scrollTop = 400;
    historyElement.dispatchEvent(new window.Event('scroll'));
    Object.defineProperty(historyElement, 'clientHeight', { configurable: true, value: 90 });
    send({ type: 'say', text: 'first' });
    // A browser clamps the followed position to the new maximum, 410.
    historyElement.scrollTop = 405;
    send({ type: 'say', text: 'second' });
    resizeHistory();
    expect(historyElement.scrollTop).toBe(405);
  });

  it('preserves a visible entry when switching away from the newest edge', () => {
    vi.useFakeTimers();
    start();
    send({ type: 'say', text: 'First' });
    send({ type: 'say', text: 'Second' });
    const historyElement = element('history');
    Object.defineProperty(historyElement, 'scrollHeight', { configurable: true, value: 500 });
    Object.defineProperty(historyElement, 'clientHeight', { configurable: true, value: 100 });
    historyElement.scrollTop = 120;
    vi.spyOn(historyElement, 'getBoundingClientRect').mockReturnValue(new window.DOMRect(0, 10, 100, 100));
    for (const entry of historyElement.children) {
      vi.spyOn(entry, 'getBoundingClientRect').mockReturnValue(new window.DOMRect(0, 20, 100, 30));
    }
    send({ type: 'chatOrder', value: 'oldestFirst' });
    expect(historyElement.scrollTop).toBe(120);
    send({ type: 'chatOrder', value: 'newestFirst' });
    expect(historyElement.scrollTop).toBe(120);
    vi.runAllTimers();
    expect(historyElement.classList.contains('reordering')).toBe(false);
  });

  it('sends newest first when that option is selected', () => {
    const select = element('chat-order');
    if (!(select instanceof window.HTMLSelectElement)) throw new TypeError('Expected a select');
    select.value = 'newestFirst';
    select.dispatchEvent(new window.Event('change'));
    expect(posted()).toContainEqual({ type: 'chatOrder', value: 'newestFirst' });
  });
});

describe('conversation ordering across replay', () => {
  it.each(['newestFirst', 'oldestFirst'] as const)('keeps prior questions and replies in event order in %s', (order) => {
    send({ type: 'chatOrder', value: order });
    send({
      type: 'replay',
      events: [
        { type: 'session', active: true },
        { type: 'say', text: 'Earlier explanation' },
        { type: 'programmer', text: 'Earlier question' },
        { type: 'say', text: 'Which of the two goes in total_balance?' },
      ],
    });
    send({ type: 'programmer', text: "Where is total_balance? I don't see it." });
    const expected = [
      'Earlier explanation',
      'Earlier question',
      'Which of the two goes in total_balance?',
      "Where is total_balance? I don't see it.",
    ];
    const messages = history().filter((value) => expected.includes(value));
    expect(messages).toEqual(order === 'oldestFirst' ? expected : expected.toReversed());
    expect(text('now-text')).toBe('');
    send({ type: 'say', text: 'So the question again' });
    expect(text('now-text')).toBe('So the question again');
    expect(history().filter((value) => expected.includes(value))).toEqual(order === 'oldestFirst' ? expected : expected.toReversed());
  });
});

it('can switch order when a hidden or empty viewport has no visible anchor', () => {
  const historyElement = element('history');
  historyElement.scrollTop = 50;
  send({ type: 'chatOrder', value: 'oldestFirst' });
  expect(historyElement.getAttribute('aria-label')).toBe('Earlier, oldest first');
});

describe('finish reading control', () => {
  it('offers a named button for the current countdown and posts its ID once', () => {
    start();
    send({ type: 'state', state: 'read', turn: 'agent', paused: false });
    send({ type: 'reading', ms: 5000, id: 42 });
    const control = element('skip-reading');
    expect(control.getAttribute('aria-label')).toBe('Finish reading pause');
    click(control);
    click(control);
    expect(posted().filter((message) => message.type === 'skipReading')).toEqual([{ type: 'skipReading', id: 42 }]);
  });

  it('does not send a skip while paused or on the programmer turn', () => {
    start();
    send({ type: 'reading', ms: 5000, id: 43 });
    send({ type: 'state', state: 'read', turn: 'agent', paused: true });
    click(element('skip-reading'));
    send({ type: 'state', state: 'navigator', turn: 'programmer', paused: false });
    click(element('skip-reading'));
    expect(posted().filter((message) => message.type === 'skipReading')).toEqual([]);
  });
});

it('disables finishing the reading pause on suspension and session end', () => {
  start();
  send({ type: 'state', state: 'read', turn: 'agent', paused: false });
  send({ type: 'reading', ms: 5000, id: 99 });
  send({ type: 'session', active: true, suspended: true });
  click(element('skip-reading'));
  send({ type: 'session', active: false, reason: 'agent' });
  click(element('skip-reading'));
  expect(posted().filter((message) => message.type === 'skipReading')).toEqual([]);
});

it('does not offer a stale countdown after playback has resumed', () => {
  start();
  send({ type: 'state', state: 'read', turn: 'agent', paused: false });
  send({ type: 'reading', ms: 5000, id: 101 });
  send({ type: 'state', state: 'typing', turn: 'agent', paused: false });
  click(element('skip-reading'));
  expect(posted().filter((message) => message.type === 'skipReading')).toEqual([]);
});

it('does not treat old replayed countdowns or a command confirmation as skippable', () => {
  start();
  send({ type: 'state', state: 'read', turn: 'agent', paused: false });
  send({ type: 'reading', ms: 5000 });
  click(element('skip-reading'));
  send({ type: 'reading', ms: 5000, id: 102 });
  send({ type: 'run', id: 1, command: 'npm test', phase: 'confirm' });
  click(element('skip-reading'));
  expect(posted().filter((message) => message.type === 'skipReading')).toEqual([]);
});

it('does not intercept Space on the reading control as a playback pause', () => {
  start();
  send({ type: 'state', state: 'read', turn: 'agent', paused: false });
  send({ type: 'reading', ms: 5000, id: 103 });
  const control = element('skip-reading');
  press(control, ' ');
  expect(posted().filter((message) => message.type === 'pause')).toEqual([]);
});

it('does not let an old animation frame schedule updates for a new countdown', () => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'performance'] });
  start();
  send({ type: 'state', state: 'read', turn: 'agent', paused: false });
  send({ type: 'reading', ms: 5000, id: 201 });
  click(element('skip-reading'));
  send({ type: 'reading', ms: 5000, id: 202 });
  vi.advanceTimersByTime(16);
  expect(vi.getTimerCount()).toBe(1);
});

describe('reading ring long press', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    start();
    send({ type: 'state', state: 'read', turn: 'agent', paused: false });
    send({ type: 'reading', ms: 5000, id: 301 });
  });

  it('LongDoesNotSkip: holds, resumes on release, and suppresses the resulting click', () => {
    const control = element('skip-reading');
    control.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1 }));
    vi.advanceTimersByTime(400);
    expect(posted()).toContainEqual({ type: 'holdReading', id: 301, held: true });
    const progress = element('dot').style.getPropertyValue('--progress');
    vi.advanceTimersByTime(1000);
    expect(element('dot').style.getPropertyValue('--progress')).toBe(progress);
    window.dispatchEvent(new window.PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 1 }));
    click(control);
    expect(posted()).toContainEqual({ type: 'holdReading', id: 301, held: false });
    expect(posted().filter((message) => message.type === 'skipReading')).toEqual([]);
    vi.advanceTimersByTime(100);
    expect(Number(element('dot').style.getPropertyValue('--progress'))).toBeGreaterThan(Number(progress));
  });

  it('releases a hold on focus loss even if playback was separately paused', () => {
    const control = element('skip-reading');
    control.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1 }));
    vi.advanceTimersByTime(400);
    send({ type: 'state', state: 'read', turn: 'agent', paused: true });
    window.dispatchEvent(new window.Event('blur'));
    expect(posted()).toContainEqual({ type: 'holdReading', id: 301, held: false });
    expect(posted().filter((message) => message.type === 'resume')).toEqual([]);
  });

  it('NoNewerSkip: does not let an old press finish a newer countdown', () => {
    const control = element('skip-reading');
    control.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1 }));
    send({ type: 'reading', ms: 5000, id: 302 });
    window.dispatchEvent(new window.PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 1 }));
    click(control);
    expect(posted().filter((message) => message.type === 'skipReading')).toEqual([]);
  });
});

describe('reading hold cleanup and keyboard access', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    start();
    send({ type: 'state', state: 'read', turn: 'agent', paused: false });
    send({ type: 'reading', ms: 5000, id: 501 });
  });

  it.each(['pointercancel', 'lostpointercapture', 'pagehide', 'visibilitychange'] as const)('releases the hold after %s', (event) => {
    const control = element('skip-reading');
    control.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1 }));
    vi.advanceTimersByTime(400);
    if (event === 'pointercancel') {
      window.dispatchEvent(new window.PointerEvent(event, { pointerId: 1 }));
    } else if (event === 'lostpointercapture') {
      control.dispatchEvent(new window.PointerEvent(event, { pointerId: 1 }));
    } else if (event === 'pagehide') {
      window.dispatchEvent(new window.Event(event));
    } else {
      vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
      document.dispatchEvent(new window.Event(event));
    }
    expect(posted()).toContainEqual({ type: 'holdReading', id: 501, held: true });
    expect(posted()).toContainEqual({ type: 'holdReading', id: 501, held: false });
    click(control);
    expect(posted().filter((message) => message.type === 'skipReading')).toEqual([]);
  });

  it('uses Space for a hold and release without also finishing the countdown', () => {
    const control = element('skip-reading');
    control.dispatchEvent(new window.KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    vi.advanceTimersByTime(400);
    window.dispatchEvent(new window.KeyboardEvent('keyup', { key: ' ', bubbles: true }));
    click(control);
    expect(posted()).toContainEqual({ type: 'holdReading', id: 501, held: true });
    expect(posted()).toContainEqual({ type: 'holdReading', id: 501, held: false });
    expect(posted().filter((message) => message.type === 'skipReading')).toEqual([]);
  });

  it('ShortCurrentSkips: finishes once on a short pointer press', () => {
    const control = element('skip-reading');
    control.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1 }));
    vi.advanceTimersByTime(100);
    window.dispatchEvent(new window.PointerEvent('pointerup', { pointerId: 1 }));
    click(control);
    expect(posted().filter((message) => message.type === 'skipReading')).toEqual([{ type: 'skipReading', id: 501 }]);
    expect(posted().filter((message) => message.type === 'holdReading')).toEqual([]);
  });

  it('ignores unrelated input and stale or ineligible hold attempts', () => {
    const control = element('skip-reading');
    send({ type: 'state', state: 'read', turn: 'agent', paused: true });
    control.dispatchEvent(new window.PointerEvent('pointerdown', { button: 0, pointerId: 1 }));
    send({ type: 'state', state: 'read', turn: 'agent', paused: false });
    control.dispatchEvent(new window.PointerEvent('pointerdown', { button: 2, pointerId: 2 }));
    control.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter' }));
    control.dispatchEvent(new window.KeyboardEvent('keydown', { key: ' ', repeat: true }));
    window.dispatchEvent(new window.KeyboardEvent('keyup', { key: 'Enter' }));
    window.dispatchEvent(new window.PointerEvent('pointerup', { pointerId: 2 }));
    window.dispatchEvent(new window.PointerEvent('pointercancel', { pointerId: 2 }));
    control.dispatchEvent(new window.PointerEvent('lostpointercapture', { pointerId: 2 }));
    document.dispatchEvent(new window.Event('visibilitychange'));
    control.dispatchEvent(new window.PointerEvent('pointerdown', { button: 0, pointerId: 1 }));
    control.dispatchEvent(new window.PointerEvent('pointerdown', { button: 0, pointerId: 1 }));
    window.dispatchEvent(new window.PointerEvent('pointerup', { pointerId: 2 }));
    send({ type: 'reading', ms: 5000, id: 502 });
    vi.advanceTimersByTime(400);
    expect(posted().filter((message) => message.type === 'holdReading')).toEqual([]);
    window.dispatchEvent(new window.PointerEvent('pointerup', { pointerId: 1 }));
    vi.advanceTimersByTime(0);
    click(control);
    expect(posted().filter((message) => message.type === 'skipReading')).toEqual([{ type: 'skipReading', id: 502 }]);
  });

  it('releases an old hold without affecting a newer reading', () => {
    const control = element('skip-reading');
    control.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1 }));
    vi.advanceTimersByTime(400);
    send({ type: 'reading', ms: 5000, id: 502 });
    window.dispatchEvent(new window.PointerEvent('pointerup', { pointerId: 1 }));
    click(control);
    expect(posted()).toContainEqual({ type: 'holdReading', id: 501, held: false });
    expect(posted().filter((message) => message.type === 'skipReading')).toEqual([]);
  });
});

describe('Your move guidance', () => {
  it('offers a focusable explanation only while the active agent is listening', () => {
    start();
    send({ type: 'state', state: 'listening', turn: 'agent', paused: false });
    const status = element('status-text');
    expect(status.textContent).toBe('Your move');
    expect(status.getAttribute('tabindex')).toBe('0');
    expect(status.dataset.tip).toBe(
      'The agent is listening for your reply. You can reply, ask a question, or say continue; it may continue after waiting.',
    );
    send({ type: 'state', state: 'listening', turn: 'agent', paused: true });
    expect(status.dataset.tip).toBeUndefined();
    expect(status.hasAttribute('tabindex')).toBe(false);
  });

  it('updates a visible listening hint when the session becomes suspended', () => {
    start();
    send({ type: 'state', state: 'listening', turn: 'agent', paused: false });
    element('status-text').focus();
    expect(tip()).toContain('agent is listening');
    send({ type: 'session', active: true, suspended: true });
    expect(tip()).toContain('same project');
  });

  it('clears a pending or visible explanation on a status change', () => {
    vi.useFakeTimers();
    start();
    send({ type: 'state', state: 'listening', turn: 'agent', paused: false });
    hover(element('status-text'));
    vi.advanceTimersByTime(TIP_DELAY_MS);
    expect(tip()).toContain('agent is listening');
    send({ type: 'state', state: 'thinking', turn: 'agent', paused: false });
    expect(tip()).toBeUndefined();
    expect(element('status-text').dataset.tip).toBeUndefined();
    send({ type: 'state', state: 'listening', turn: 'agent', paused: false });
    hover(element('status-text'));
    send({ type: 'session', active: true, suspended: true });
    vi.advanceTimersByTime(TIP_DELAY_MS);
    expect(tip()).toContain('same project');
  });
});

it('shows the Your move explanation on keyboard focus and removes it on turn change', () => {
  start();
  send({ type: 'state', state: 'listening', turn: 'agent', paused: false });
  const status = element('status-text');
  status.focus();
  expect(tip()).toContain('agent is listening');
  expect(status.getAttribute('aria-describedby')).toBe('tip');
  send({ type: 'state', state: 'navigator', turn: 'programmer', paused: false });
  expect(tip()).toBeUndefined();
  expect(status.hasAttribute('aria-describedby')).toBe(false);
  expect(status.dataset.tip).toBeUndefined();
});

it('AvailableShown: offers the matching terminal for running and filed commands', () => {
  start();
  send({ type: 'run', id: 71, command: 'npm test', phase: 'running' });
  click(element('show-terminal'));
  expect(posted()).toContainEqual({ type: 'showTerminal', id: 71 });
  send({ type: 'run', id: 71, command: 'npm test', phase: 'done', exitCode: 0 });
  const button = element('history').querySelector('[data-show-terminal="71"]');
  ok(button);
  click(button);
  expect(posted().filter((message) => message.type === 'showTerminal')).toEqual([
    { type: 'showTerminal', id: 71 },
    { type: 'showTerminal', id: 71 },
  ]);
});

it('persists the automatic terminal preference and reflects host changes', () => {
  const checkbox = element('show-terminals');
  if (!(checkbox instanceof window.HTMLInputElement)) throw new TypeError('missing checkbox');
  expect(checkbox.checked).toBe(false);
  send({ type: 'showTerminals', value: true });
  expect(checkbox.checked).toBe(true);
  checkbox.checked = false;
  checkbox.dispatchEvent(new window.Event('change', { bubbles: true }));
  expect(posted()).toContainEqual({ type: 'showTerminals', value: false });
});

it('does not offer a terminal for an unapproved or declined command', () => {
  start();
  send({ type: 'run', id: 81, command: 'npm test', phase: 'confirm' });
  expect(element('show-terminal').hidden).toBe(true);
  click(element('show-terminal'));
  expect(posted().filter((message) => message.type === 'showTerminal')).toEqual([]);
  send({ type: 'run', id: 81, command: 'npm test', phase: 'declined' });
  expect(element('history').querySelector('[data-show-terminal="81"]')).toBeNull();
});

it('ChoiceSaved, PaceIndependent: keeps code display and speed independent in either message order', () => {
  start();
  send({ type: 'codePlayback', value: 'blocks' });
  send({ type: 'speed', value: 2 });
  expect(element('code-mode').getAttribute('aria-label')).toBe('Code display: Blocks');
  send({ type: 'codePlayback', value: 'lines' });
  expect(element('code-mode').getAttribute('aria-label')).toBe('Code display: Lines');
  send({ type: 'speed', value: 3 });
  expect(element('code-mode').getAttribute('aria-label')).toBe('Code display: Lines');
});

it('explains how to resume a suspended session and clears the hint on reconnect', () => {
  start();
  send({ type: 'session', active: true, suspended: true });
  expect(element('status-text').dataset.tip).toContain('same project');
  send({ type: 'session', active: true, resumed: true });
  expect(element('status-text').dataset.tip).toBeUndefined();
});

it('OnlyOnRequest: requests diagnostics only when the button is activated', () => {
  expect(posted().filter((message) => message.type === 'copyDiagnostics')).toEqual([]);
  click(element('copy-diagnostics'));
  expect(posted().filter((message) => message.type === 'copyDiagnostics')).toEqual([{ type: 'copyDiagnostics' }]);
});

it('ChoiceApplied: the code display menu updates mode separately from speed', () => {
  start();
  send({ type: 'speed', value: 2 });
  send({ type: 'codePlayback', value: 'typing' });
  click(element('code-mode'));
  const menu = element('code-mode-menu');
  const lines = menu.querySelector('[data-code-playback="lines"]');
  ok(lines);
  click(lines);
  expect(posted().at(-1)).toEqual({ type: 'codePlayback', value: 'lines' });
  expect(lines.getAttribute('aria-checked')).toBe('true');
  expect(element('speed').getAttribute('aria-label')).toBe('Playback speed: 2.0x');
  expect(element('speed-menu').querySelector('[data-speed="2"][aria-checked="true"]')).not.toBeNull();
  send({ type: 'codePlayback', value: 'blocks' });
  expect(menu.querySelector('[data-code-playback="blocks"]')?.getAttribute('aria-checked')).toBe('true');
});

it('clears the code reading ring when playback leaves its reading state', () => {
  start();
  send({ type: 'state', state: 'read', turn: 'agent', paused: false });
  send({ type: 'reading', owner: 'code', ms: 5000, id: 901 });
  expect(element('dot').classList.contains('reading')).toBe(true);
  send({ type: 'state', state: 'typing', turn: 'agent', paused: false });
  expect(element('dot').classList.contains('reading')).toBe(false);
  click(element('skip-reading'));
  expect(posted().filter((message) => message.type === 'skipReading')).toEqual([]);
});

it('keeps a reading ring during a global pause and clears it if playback then leaves reading', () => {
  start();
  send({ type: 'state', state: 'read', turn: 'agent', paused: false });
  send({ type: 'reading', owner: 'code', ms: 5000, id: 902 });
  send({ type: 'state', state: 'paused', turn: 'agent', paused: true });
  expect(element('dot').classList.contains('reading')).toBe(true);
  send({ type: 'state', state: 'typing', turn: 'agent', paused: false });
  expect(element('dot').classList.contains('reading')).toBe(false);
});

it('shows Speaking after the reading ring ends while the voice is still playing', () => {
  vi.useFakeTimers();
  start();
  send({ type: 'speechPage', pageId: 1 });
  send({ type: 'state', state: 'read', turn: 'agent', paused: false });
  send({ type: 'reading', ms: 100, id: 51 });
  send({ type: 'speechStatus', id: 9, pageId: 1, state: 'preparing' });
  send({ type: 'speechStatus', id: 9, pageId: 1, state: 'speaking' });
  vi.advanceTimersByTime(200);
  expect(element('dot').classList.contains('reading')).toBe(false);
  expect(text('status-text')).toBe('Speaking');
});

it('shows the local model status, path and pinned source', () => {
  send({
    type: 'speechModelStatus',
    value: { path: '/storage/model', source: 'https://example.test/model', revision: 'abc', verified: true, download: 'installed' },
  });
  expect(text('speech-model-status')).toContain('verified');
  expect(text('speech-model-details')).toContain('/storage/model');
  expect(text('speech-model-details')).toContain('https://example.test/model');
  expect(text('speech-model-details')).toContain('abc');
});

it('keeps model diagnostics collapsed and labels actions for the reported state', () => {
  send({ type: 'speechSupport', supported: true, gpu: true });
  const details = element('speech-details');
  expect(details.tagName).toBe('DETAILS');
  expect(details.hasAttribute('open')).toBe(false);
  const base = { path: '/model', source: 'https://example.test', revision: 'abc', verified: true };
  send({ type: 'speechModelStatus', value: { ...base, download: 'installed' } });
  expect(text('speech-model-status')).toContain('verified');
  expect(text('speech-model-status')).not.toContain('/model');
  expect(text('speech-model-details')).toContain('/model');
  expect(element('speech-setup').parentElement).toBe(element('speech-setup-secondary'));
  expect(text('speech-setup')).toContain('Recheck');
  click(element('speech-setup'));
  expect(posted()).toContainEqual({ type: 'speechSetup' });
  send({ type: 'speechModelStatus', value: { ...base, download: 'missing', verified: false } });
  expect(element('speech-setup').parentElement).toBe(element('speech-setup-primary'));
  expect(text('speech-setup')).toContain('Download');
  send({ type: 'speechModelStatusUnavailable' });
  expect(text('speech-model-details')).not.toContain('/model');
  expect(element('speech-setup').parentElement).toBe(element('speech-setup-primary'));
  send({ type: 'speechComputeState', value: { requestedMode: 'gpu', actualBackend: 'none', gpuCheck: { phase: 'ready' } } });
  expect(text('gpu-status')).toContain('No backend reported yet');
  expect(text('gpu-details')).toContain('Requested: GPU. Actual backend: NONE');
  expect(text('gpu-check')).toContain('Recheck');
});

it('distinguishes missing, unverified and unknown model status', () => {
  const base = { path: '/model', source: 'https://example.test', revision: 'abc', verified: false };
  send({ type: 'speechModelStatus', value: { ...base, download: 'missing' } });
  expect(text('speech-model-status')).toContain('Not downloaded');
  send({ type: 'speechModelStatus', value: { ...base, download: 'installed' } });
  expect(text('speech-model-status')).toContain('not verified');
  send({ type: 'speechModelStatus', value: { ...base, download: 'unknown' } });
  expect(text('speech-model-status')).toContain('unknown');
  send({ type: 'speechModelStatusUnavailable' });
  expect(text('speech-model-status')).toContain('unknown');
});

it('sends explicit setup, preview, stop and validated speech preferences', () => {
  send({ type: 'speechPage', pageId: 1 });
  send({ type: 'speechSupport', supported: true, gpu: true });
  send({
    type: 'speechSettings',
    value: {
      contextEnabled: false,
      enabled: true,
      provider: 'kokoro',
      voice: 'af_heart',
      speed: 1,
      elevenLabsVoice: '',
      elevenLabsSpeed: 1,
    },
  });
  const voice = element('speech-voice');
  if (!(voice instanceof window.HTMLSelectElement)) throw new TypeError('Missing voice selector');
  voice.value = 'bf_emma';
  voice.dispatchEvent(new window.Event('change', { bubbles: true }));
  expect(posted()).toContainEqual({
    type: 'speechSettings',
    value: {
      contextEnabled: false,
      enabled: true,
      provider: 'kokoro',
      voice: 'bf_emma',
      speed: 1,
      elevenLabsVoice: '',
      elevenLabsSpeed: 1,
      listeningSpeed: 1,
    },
  });
  click(element('speech-setup'));
  click(element('speech-preview'));
  click(element('speech-stop'));
  expect(posted()).toContainEqual({ type: 'speechSetup' });
  expect(posted()).toContainEqual({ type: 'speechPreview' });
  expect(posted()).toContainEqual({ type: 'speechStop' });
});

it('offers sending after the current action', () => {
  start();
  const deferred = element('reply-behavior');
  if (!(deferred instanceof window.HTMLSelectElement)) throw new TypeError('Missing reply behavior setting');
  deferred.value = 'finishAction';
  deferred.dispatchEvent(new window.Event('change'));
  expect(posted()).toContainEqual({ type: 'replyBehavior', value: 'finishAction' });
  typeReply('Wait');
  click(element('send'));
  expect(posted()).toContainEqual({ type: 'reply', text: 'Wait', attach: false, defer: true });
});

it('restores reply timing and applies a change to a drafted reply', () => {
  start();
  send({ type: 'replyBehavior', value: 'finishAction' });
  const choice = element('reply-behavior');
  if (!(choice instanceof window.HTMLSelectElement)) throw new TypeError('Missing reply behavior setting');
  expect(choice.value).toBe('finishAction');
  typeReply('Now');
  choice.value = 'interrupt';
  choice.dispatchEvent(new window.Event('change'));
  click(element('send'));
  expect(posted()).toContainEqual({ type: 'replyBehavior', value: 'interrupt' });
  expect(posted()).toContainEqual({ type: 'reply', text: 'Now', attach: false });
});

it('leaves speech playing for a bare turn even with stale displayed turn', async () => {
  const pause = vi.fn<() => void>();
  const play = vi.fn<() => Promise<void>>().mockResolvedValue();
  class FakeAudio {
    pause = pause;
    play = play;
    addEventListener(): void {}
  }
  vi.stubGlobal('Audio', FakeAudio);
  vi.spyOn(window.URL, 'createObjectURL').mockReturnValue('blob:test');
  vi.spyOn(window.URL, 'revokeObjectURL').mockImplementation(() => {});
  start();
  send({ type: 'speechPage', pageId: 1 });
  send({ type: 'speechStatus', id: 7, pageId: 1, state: 'preparing' });
  send({ type: 'speechAudio', id: 7, pageId: 1, wavBase64: 'AQI=', durationMs: 100 });
  await Promise.resolve();
  expect(play).toHaveBeenCalledOnce();
  pause.mockClear();
  click(element('turn'));
  expect(pause).not.toHaveBeenCalled();
  expect(posted()).toContainEqual({ type: 'turn' });
  send({ type: 'state', state: 'navigator', turn: 'programmer', paused: false });
  typeReply('Change direction');
  click(element('turn'));
  expect(pause).toHaveBeenCalledOnce();
  expect(posted()).toContainEqual({ type: 'turn', message: 'Change direction' });
});

it('silences the current audio synchronously before posting a reply and ignores late audio', async () => {
  const pause = vi.fn<() => void>();
  const play = vi.fn<() => Promise<void>>().mockResolvedValue();
  class FakeAudio {
    pause = pause;
    play = play;
    addEventListener(): void {}
  }
  vi.stubGlobal('Audio', FakeAudio);
  vi.spyOn(window.URL, 'createObjectURL').mockReturnValue('blob:test');
  vi.spyOn(window.URL, 'revokeObjectURL').mockImplementation(() => {});
  start();
  send({ type: 'speechPage', pageId: 1 });
  send({
    type: 'speechSettings',
    value: {
      contextEnabled: false,
      enabled: true,
      provider: 'kokoro',
      voice: 'af_heart',
      speed: 1,
      elevenLabsVoice: '',
      elevenLabsSpeed: 1,
    },
  });
  send({ type: 'speechStatus', id: 7, pageId: 1, state: 'preparing' });
  send({ type: 'speechAudio', id: 7, pageId: 1, wavBase64: 'AQI=', durationMs: 100 });
  await Promise.resolve();
  expect(play).toHaveBeenCalledOnce();
  typeReply('Continue');
  click(element('send'));
  const sentIndex = post.mock.calls.findIndex(([message]) => message.type === 'reply');
  expect(sentIndex).toBeGreaterThanOrEqual(0);
  expect(pause.mock.invocationCallOrder.at(-1)).toBeLessThan(post.mock.invocationCallOrder[sentIndex] ?? 0);
  send({ type: 'speechAudio', id: 7, pageId: 1, wavBase64: 'AQI=', durationMs: 100 });
  expect(play).toHaveBeenCalledOnce();
});

it('unlocks one shared player on a gesture so later narration can start without one (#39)', async () => {
  const play = vi.fn<() => Promise<void>>().mockRejectedValue(new Error('no source'));
  const pause = vi.fn<() => void>();
  const players: FakeAudio[] = [];
  class FakeAudio {
    paused = true;
    src = '';
    play = play;
    pause = pause;
    constructor() {
      players.push(this);
    }
    addEventListener(): void {}
  }
  vi.stubGlobal('Audio', FakeAudio);
  vi.spyOn(window.URL, 'createObjectURL').mockReturnValue('blob:shared');
  vi.spyOn(window.URL, 'revokeObjectURL').mockImplementation(() => {});
  document.dispatchEvent(new window.Event('pointerdown'));
  await Promise.resolve();
  expect(play).toHaveBeenCalledOnce();
  expect(pause).toHaveBeenCalledOnce();
  send({ type: 'speechPage', pageId: 1 });
  send({ type: 'speechStatus', id: 3, pageId: 1, state: 'preparing' });
  send({ type: 'speechAudio', id: 3, pageId: 1, wavBase64: 'AQI=', durationMs: 100 });
  expect(players).toHaveLength(1);
  expect(players[0]?.src).toBe('blob:shared');
  const playing = players[0];
  if (playing !== undefined) playing.paused = false;
  document.dispatchEvent(new window.Event('keydown'));
  expect(play).toHaveBeenCalledTimes(2);
  expect(pause).toHaveBeenCalledOnce();
});

it('BlockedResolves: starts narration the browser refused from the next gesture in the panel (#77)', async () => {
  const blocked = new window.DOMException('needs a gesture', 'NotAllowedError');
  class FakeAudio {
    paused = true;
    src = '';
    play = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(blocked)
      .mockImplementation(() => {
        this.paused = false;
        return Promise.resolve();
      });
    pause = vi.fn<() => void>();
    addEventListener(): void {}
  }
  const players: FakeAudio[] = [];
  vi.stubGlobal(
    'Audio',
    class extends FakeAudio {
      constructor() {
        super();
        players.push(this);
      }
    },
  );
  vi.spyOn(window.URL, 'createObjectURL').mockReturnValue('blob:blocked');
  vi.spyOn(window.URL, 'revokeObjectURL').mockImplementation(() => {});
  send({ type: 'speechPage', pageId: 1 });
  send({ type: 'speechStatus', id: 6, pageId: 1, state: 'preparing' });
  send({ type: 'speechAudio', id: 6, pageId: 1, wavBase64: 'AQI=', durationMs: 100 });
  await Promise.resolve();
  await Promise.resolve();
  expect(posted()).not.toContainEqual({ type: 'speechEvent', id: 6, pageId: 1, event: 'failed' });
  document.dispatchEvent(new window.Event('pointerdown'));
  await Promise.resolve();
  await Promise.resolve();
  expect(posted()).toContainEqual({ type: 'speechEvent', id: 6, pageId: 1, event: 'started' });
  expect(players[0]?.play).toHaveBeenCalledTimes(2);
  expect(players[0]?.pause).not.toHaveBeenCalled();
});

it("drops a retired clip's listeners so its late error cannot fail the next clip", () => {
  const player = new EventTarget();
  class FakeAudio {
    src = '';
    play = vi.fn<() => Promise<void>>().mockResolvedValue();
    pause = vi.fn<() => void>();
    addEventListener(type: string, listener: () => void, options?: { signal?: AbortSignal }): void {
      player.addEventListener(type, listener, options);
    }
  }
  vi.stubGlobal('Audio', FakeAudio);
  vi.spyOn(window.URL, 'createObjectURL').mockReturnValue('blob:retired');
  vi.spyOn(window.URL, 'revokeObjectURL').mockImplementation(() => {});
  send({ type: 'speechPage', pageId: 1 });
  send({ type: 'speechStatus', id: 4, pageId: 1, state: 'preparing' });
  send({ type: 'speechAudio', id: 4, pageId: 1, wavBase64: 'AQI=', durationMs: 100 });
  send({ type: 'speechStatus', id: 5, pageId: 1, state: 'preparing' });
  send({ type: 'speechAudio', id: 5, pageId: 1, wavBase64: 'AQI=', durationMs: 100 });
  player.dispatchEvent(new Event('error'));
  expect(posted()).toContainEqual({ type: 'speechEvent', id: 5, pageId: 1, event: 'failed' });
  expect(posted()).not.toContainEqual({ type: 'speechEvent', id: 4, pageId: 1, event: 'failed' });
});

function unavailableAudio(): never {
  throw new Error('unavailable');
}

it('revokes a generated audio URL when the browser cannot create its player', () => {
  vi.stubGlobal('Audio', unavailableAudio);
  vi.spyOn(window.URL, 'createObjectURL').mockReturnValue('blob:test');
  const revoke = vi.spyOn(window.URL, 'revokeObjectURL').mockImplementation(() => {});
  send({ type: 'speechPage', pageId: 1 });
  send({ type: 'speechStatus', id: 11, pageId: 1, state: 'preparing' });
  send({ type: 'speechAudio', id: 11, pageId: 1, wavBase64: 'AQI=', durationMs: 100 });
  expect(revoke).toHaveBeenCalledWith('blob:test');
  expect(posted()).toContainEqual({ type: 'speechEvent', id: 11, pageId: 1, event: 'failed' });
});

it('does not stop a preview when voice changes while automatic speech is off', async () => {
  const pause = vi.fn<() => void>();
  const play = vi.fn<() => Promise<void>>().mockResolvedValue();
  class FakeAudio {
    pause = pause;
    play = play;
    addEventListener(): void {}
  }
  vi.stubGlobal('Audio', FakeAudio);
  vi.spyOn(window.URL, 'createObjectURL').mockReturnValue('blob:preview');
  vi.spyOn(window.URL, 'revokeObjectURL').mockImplementation(() => {});
  send({ type: 'speechPage', pageId: 1 });
  send({
    type: 'speechSettings',
    value: {
      contextEnabled: false,
      enabled: false,
      provider: 'kokoro',
      voice: 'af_heart',
      speed: 1,
      elevenLabsVoice: '',
      elevenLabsSpeed: 1,
    },
  });
  send({ type: 'speechStatus', id: 1, pageId: 1, state: 'preparing' });
  send({ type: 'speechAudio', id: 1, pageId: 1, wavBase64: 'AQI=', durationMs: 100 });
  await Promise.resolve();
  send({
    type: 'speechSettings',
    value: {
      contextEnabled: false,
      enabled: false,
      provider: 'kokoro',
      voice: 'bf_emma',
      speed: 1.25,
      elevenLabsVoice: '',
      elevenLabsSpeed: 1,
    },
  });
  expect(play).toHaveBeenCalledOnce();
  expect(pause).not.toHaveBeenCalled();
});

it('keeps the Settings playback selector and toolbar radio choice in sync', () => {
  start();
  send({ type: 'codePlayback', value: 'blocks' });
  const selector = element('settings-code-playback');
  if (!(selector instanceof window.HTMLSelectElement)) throw new TypeError('Missing playback selector');
  expect(selector.value).toBe('blocks');
  selector.value = 'lines';
  selector.dispatchEvent(new window.Event('change', { bubbles: true }));
  expect(posted()).toContainEqual({ type: 'codePlayback', value: 'lines' });
  expect(element('code-mode-menu').querySelector('[data-code-playback="lines"]')?.getAttribute('aria-checked')).toBe('true');
  click(element('code-mode'));
  const typing = element('code-mode-menu').querySelector('[data-code-playback="typing"]');
  ok(typing);
  click(typing);
  expect(selector.value).toBe('typing');
});

it('offers code display in a separate toolbar menu and keeps Settings synchronized', () => {
  start();
  send({ type: 'codePlayback', value: 'typing' });
  const mode = element('code-mode');
  expect(mode.getAttribute('aria-label')).toBe('Code display: Typing');
  click(mode);
  const blocks = element('code-mode-menu').querySelector('[data-code-playback="blocks"]');
  ok(blocks);
  click(blocks);
  expect(posted()).toContainEqual({ type: 'codePlayback', value: 'blocks' });
  expect(mode.getAttribute('aria-label')).toBe('Code display: Blocks');
  const selector = element('settings-code-playback');
  if (!(selector instanceof window.HTMLSelectElement)) throw new TypeError('Missing playback selector');
  expect(selector.value).toBe('blocks');
  expect(element('speed').getAttribute('aria-label')).not.toContain('blocks');
});

it('starts a paused unit prepared after the page opens', async () => {
  const play = vi.fn<() => Promise<void>>().mockResolvedValue();
  class FakeAudio {
    play = play;
    pause(): void {}
    addEventListener(): void {}
  }
  vi.stubGlobal('Audio', FakeAudio);
  vi.spyOn(window.URL, 'createObjectURL').mockReturnValue('blob:late');
  vi.spyOn(window.URL, 'revokeObjectURL').mockImplementation(() => {});
  send({ type: 'speechPage', pageId: 1 });
  send({ type: 'speechStatus', pageId: 1, id: 8, state: 'paused' });
  send({ type: 'speechStatus', pageId: 1, id: 8, state: 'preparing' });
  send({ type: 'speechAudio', pageId: 1, id: 8, wavBase64: 'AQI=', durationMs: 100 });
  await Promise.resolve();
  expect(play).toHaveBeenCalledOnce();
});

it('keeps setup disabled on an unsupported host after a setup state update', () => {
  send({ type: 'speechSupport', supported: false, gpu: false });
  send({ type: 'speechSetupState', pending: false, message: 'Unavailable.' });
  expect(element('speech-setup')).toHaveProperty('disabled', true);
});

it('reports page visibility and ignores stale speech status while controlling the current audio', async () => {
  const pause = vi.fn<() => void>();
  const play = vi.fn<() => Promise<void>>().mockResolvedValue();
  class FakeAudio {
    pause = pause;
    play = play;
    addEventListener(): void {}
  }
  vi.stubGlobal('Audio', FakeAudio);
  vi.spyOn(window.URL, 'createObjectURL').mockReturnValue('blob:visible');
  vi.spyOn(window.URL, 'revokeObjectURL').mockImplementation(() => {});
  window.dispatchEvent(new window.Event('pagehide'));
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  document.dispatchEvent(new window.Event('visibilitychange'));
  send({ type: 'speechPage', pageId: 1 });
  send({
    type: 'speechSettings',
    value: {
      contextEnabled: false,
      enabled: true,
      provider: 'kokoro',
      voice: 'af_heart',
      speed: 1,
      elevenLabsVoice: '',
      elevenLabsSpeed: 1,
    },
  });
  send({ type: 'speechStatus', pageId: 1, id: 2, state: 'preparing' });
  send({ type: 'speechAudio', pageId: 1, id: 2, wavBase64: 'AQI=', durationMs: 100 });
  await Promise.resolve();
  send({ type: 'speechControl', pageId: 1, id: 2, action: 'pause' });
  expect(pause).toHaveBeenCalledOnce();
  send({ type: 'speechStatus', pageId: 2, id: 3, state: 'speaking' });
  send({ type: 'speechStatus', pageId: 1, id: 1, state: 'speaking' });
  expect(text('speech-live-status')).toBe('Preparing speech');
  document.dispatchEvent(new window.Event('visibilitychange'));
  expect(posted()).toContainEqual({ type: 'speechPageVisible', pageId: 1 });
  hidden.mockReturnValue(true);
  document.dispatchEvent(new window.Event('visibilitychange'));
  expect(posted()).toContainEqual({ type: 'speechPageHidden', pageId: 1 });
  send({
    type: 'speechSettings',
    value: {
      contextEnabled: false,
      enabled: false,
      provider: 'kokoro',
      voice: 'af_heart',
      speed: 1,
      elevenLabsVoice: '',
      elevenLabsSpeed: 1,
    },
  });
  send({ type: 'speechStatus', pageId: 1, id: 2, state: 'speaking' });
  expect(text('speech-live-status')).not.toBe('Speaking');
  send({ type: 'speechStatus', pageId: 1, id: 2, state: 'idle' });
  expect(element('speech-live').hidden).toBe(true);
  window.dispatchEvent(new window.Event('pagehide'));
  expect(posted()).toContainEqual({ type: 'speechPageHidden', pageId: 1 });
});

it('validates selection controls and stops live speech when disabled', () => {
  const voice = element('speech-voice');
  const speed = element('speech-speed');
  const enabled = element('speech-enabled');
  const mode = element('settings-code-playback');
  if (
    !(voice instanceof window.HTMLSelectElement) ||
    !(speed instanceof window.HTMLSelectElement) ||
    !(enabled instanceof window.HTMLInputElement) ||
    !(mode instanceof window.HTMLSelectElement)
  ) {
    throw new TypeError('Missing settings controls');
  }
  voice.value = '';
  voice.dispatchEvent(new window.Event('change'));
  voice.value = 'af_heart';
  speed.value = '';
  speed.dispatchEvent(new window.Event('change'));
  expect(posted().filter((message) => message.type === 'speechSettings')).toEqual([]);
  speed.value = '1';
  send({
    type: 'speechSettings',
    value: {
      contextEnabled: false,
      enabled: true,
      provider: 'kokoro',
      voice: 'af_heart',
      speed: 1,
      elevenLabsVoice: '',
      elevenLabsSpeed: 1,
    },
  });
  enabled.checked = false;
  enabled.dispatchEvent(new window.Event('change'));
  expect(posted()).toContainEqual({
    type: 'speechSettings',
    value: {
      contextEnabled: false,
      enabled: false,
      provider: 'kokoro',
      voice: 'af_heart',
      speed: 1,
      elevenLabsVoice: '',
      elevenLabsSpeed: 1,
      listeningSpeed: 1,
    },
  });
  mode.value = 'lines';
  mode.dispatchEvent(new window.Event('change'));
  mode.value = 'blocks';
  mode.dispatchEvent(new window.Event('change'));
  mode.value = '';
  mode.dispatchEvent(new window.Event('change'));
  expect(posted()).toContainEqual({ type: 'codePlayback', value: 'lines' });
  expect(posted()).toContainEqual({ type: 'codePlayback', value: 'blocks' });
  const invalid = element('code-mode-menu').querySelector('button');
  if (!(invalid instanceof window.HTMLButtonElement)) throw new TypeError('Missing menu item');
  invalid.dataset.codePlayback = 'invalid';
  click(invalid);
  expect(posted()).not.toContainEqual({ type: 'codePlayback', value: 'invalid' });
});

it('switches providers explicitly and loads cloud voices only when requested', () => {
  const provider = element('speech-provider');
  if (!(provider instanceof window.HTMLSelectElement)) throw new TypeError('Missing provider');
  expect(element('speech-cloud').hidden).toBe(true);
  send({ type: 'speechCloudSupport', supported: true });
  send({ type: 'speechKeyStatus', hasKey: true });
  provider.value = 'elevenlabs';
  provider.dispatchEvent(new window.Event('change'));
  expect(element('speech-local').hidden).toBe(true);
  expect(element('speech-local-model').hidden).toBe(true);
  expect(element('speech-cloud').hidden).toBe(false);
  expect(posted().filter((message) => message.type === 'speechVoicesLoad')).toEqual([]);
  click(element('speech-voices-load'));
  click(element('speech-key-set'));
  expect(posted()).toContainEqual({ type: 'speechVoicesLoad' });
  expect(posted()).toContainEqual({ type: 'speechKeySet' });
});

it('shows the saved account voice after reload without fetching a catalog', () => {
  send({
    type: 'speechSettings',
    value: {
      contextEnabled: false,
      enabled: true,
      provider: 'elevenlabs',
      voice: 'af_heart',
      speed: 1,
      elevenLabsVoice: 'saved-voice',
      elevenLabsSpeed: 1,
    },
  });
  send({ type: 'speechCloudSupport', supported: true });
  send({ type: 'speechKeyStatus', hasKey: true });
  const select = element('speech-cloud-voice');
  if (!(select instanceof window.HTMLSelectElement)) throw new TypeError('Missing voice selector');
  expect(select.value).toBe('saved-voice');
  expect(select.selectedOptions[0]?.textContent).toBe('Saved voice (load voices to change)');
  expect(posted().filter((message) => message.type === 'speechVoicesLoad')).toEqual([]);
});

it('chooses a cloud voice and speed, loads more, and keeps provider errors sanitized', () => {
  send({ type: 'speechCloudSupport', supported: true });
  send({ type: 'speechKeyStatus', hasKey: true });
  send({
    type: 'speechSettings',
    value: {
      contextEnabled: false,
      enabled: true,
      provider: 'elevenlabs',
      voice: 'af_heart',
      speed: 1,
      elevenLabsVoice: '',
      elevenLabsSpeed: 1,
    },
  });
  send({ type: 'speechCatalog', value: { voices: [{ id: 'id1', name: '<b>Voice</b>' }], more: true, loading: false, error: false } });
  const voice = element('speech-cloud-voice');
  const speed = element('speech-cloud-speed');
  if (!(voice instanceof window.HTMLSelectElement) || !(speed instanceof window.HTMLSelectElement)) throw new TypeError('Missing controls');
  expect(voice.options[1]?.textContent).toBe('<b>Voice</b>');
  voice.value = 'id1';
  voice.dispatchEvent(new window.Event('change'));
  speed.value = '0.75';
  speed.dispatchEvent(new window.Event('change'));
  speed.value = '1.2';
  speed.dispatchEvent(new window.Event('change'));
  speed.value = '';
  speed.dispatchEvent(new window.Event('change'));
  expect(posted()).toContainEqual({
    type: 'speechSettings',
    value: {
      contextEnabled: false,
      enabled: true,
      provider: 'elevenlabs',
      voice: 'af_heart',
      speed: 1,
      elevenLabsVoice: 'id1',
      elevenLabsSpeed: 1.2,
      listeningSpeed: 1,
    },
  });
  click(element('speech-voices-more'));
  click(element('speech-key-remove'));
  expect(posted()).toContainEqual({ type: 'speechVoicesMore' });
  expect(posted()).toContainEqual({ type: 'speechKeyRemove' });
  send({ type: 'speechCatalog', value: { voices: [], more: false, loading: false, error: true } });
  expect(text('speech-settings-status')).toBe('Could not load account voices.');
});

it('keeps cloud actions disabled without a key and while setup is pending', () => {
  send({ type: 'speechCloudSupport', supported: true });
  send({ type: 'speechKeyStatus', hasKey: false });
  send({
    type: 'speechSettings',
    value: {
      contextEnabled: false,
      enabled: false,
      provider: 'elevenlabs',
      voice: 'af_heart',
      speed: 1,
      elevenLabsVoice: '',
      elevenLabsSpeed: 1,
    },
  });
  expect(element('speech-key-remove')).toHaveProperty('disabled', true);
  expect(element('speech-voices-load')).toHaveProperty('disabled', true);
  send({ type: 'speechSetupState', pending: true, message: 'Setting up' });
  expect(element('speech-preview')).toHaveProperty('disabled', true);
  const provider = element('speech-provider');
  if (!(provider instanceof window.HTMLSelectElement)) throw new TypeError('Missing provider');
  provider.value = '';
  provider.dispatchEvent(new window.Event('change'));
  provider.value = 'elevenlabs';
  provider.dispatchEvent(new window.Event('change'));
  expect(element('speech-cloud').hidden).toBe(false);
});

it('switches to cloud even when old local voice settings are invalid', () => {
  send({
    type: 'speechSettings',
    value: {
      contextEnabled: false,
      enabled: true,
      provider: 'kokoro',
      voice: 'removed_voice',
      speed: 9,
      elevenLabsVoice: '',
      elevenLabsSpeed: 1,
    },
  });
  send({ type: 'speechCloudSupport', supported: true });
  const provider = element('speech-provider');
  if (!(provider instanceof window.HTMLSelectElement)) throw new TypeError('Missing provider');
  provider.value = 'elevenlabs';
  provider.dispatchEvent(new window.Event('change'));
  expect(posted()).toContainEqual({
    type: 'speechSettings',
    value: {
      contextEnabled: false,
      enabled: true,
      provider: 'elevenlabs',
      voice: 'af_heart',
      speed: 1,
      elevenLabsVoice: '',
      elevenLabsSpeed: 1,
      listeningSpeed: 1,
    },
  });
});

it('switches to cloud with the default rate when a saved cloud rate is invalid', () => {
  send({
    type: 'speechSettings',
    value: {
      contextEnabled: false,
      enabled: false,
      provider: 'kokoro',
      voice: 'af_heart',
      speed: 1,
      elevenLabsVoice: '',
      elevenLabsSpeed: 9,
    },
  });
  const provider = element('speech-provider');
  if (!(provider instanceof window.HTMLSelectElement)) throw new TypeError('Missing provider');
  provider.value = 'elevenlabs';
  provider.dispatchEvent(new window.Event('change'));
  expect(posted()).toContainEqual({
    type: 'speechSettings',
    value: {
      contextEnabled: false,
      enabled: false,
      provider: 'elevenlabs',
      voice: 'af_heart',
      speed: 1,
      elevenLabsVoice: '',
      elevenLabsSpeed: 1,
      listeningSpeed: 1,
    },
  });
});

it('switches back to Kokoro when saved inactive cloud settings are invalid', () => {
  send({
    type: 'speechSettings',
    value: {
      contextEnabled: false,
      enabled: false,
      provider: 'elevenlabs',
      voice: 'af_heart',
      speed: 1,
      elevenLabsVoice: '',
      elevenLabsSpeed: 9,
    },
  });
  const provider = element('speech-provider');
  if (!(provider instanceof window.HTMLSelectElement)) throw new TypeError('Missing provider');
  provider.value = 'kokoro';
  provider.dispatchEvent(new window.Event('change'));
  expect(posted()).toContainEqual({
    type: 'speechSettings',
    value: {
      contextEnabled: false,
      enabled: false,
      provider: 'kokoro',
      voice: 'af_heart',
      speed: 1,
      elevenLabsVoice: '',
      elevenLabsSpeed: 1,
      listeningSpeed: 1,
    },
  });
});

it('replaces stale catalog errors with loading, empty and successful feedback', () => {
  send({ type: 'speechCatalog', value: { voices: [], more: false, loading: false, error: true, errorKind: 'auth' } });
  expect(text('speech-settings-status')).toBe('ElevenLabs rejected the key or voice access. Check your key permissions.');
  send({ type: 'speechCatalog', value: { voices: [], more: false, loading: true, error: false } });
  expect(text('speech-settings-status')).toBe('Loading account voices...');
  send({ type: 'speechCatalog', value: { voices: [], more: false, loading: false, error: false } });
  expect(text('speech-settings-status')).toBe('No account voices are available. Check your ElevenLabs account.');
  send({ type: 'speechCatalog', value: { voices: [{ id: 'voice', name: 'Voice' }], more: false, loading: false, error: false } });
  expect(text('speech-settings-status')).toBe('Account voices loaded.');
});

it.each([
  ['no_key', 'Add an ElevenLabs API key to load voices.'],
  ['rate', 'ElevenLabs rate limit or quota reached. Try again later.'],
  ['network', 'Could not connect to ElevenLabs. Check your network.'],
  ['timeout', 'Loading account voices timed out. Try again.'],
  ['invalid', 'ElevenLabs returned an unsupported voice list.'],
  ['canceled', 'Loading account voices was canceled.'],
  ['unknown', 'Could not load account voices.'],
] as const)('maps %s catalog failures to fixed guidance', (errorKind, message) => {
  send({ type: 'speechCatalog', value: { voices: [], more: false, loading: false, error: true, errorKind } });
  expect(text('speech-settings-status')).toBe(message);
});

it('does not claim an invalidated catalog is empty until a load completes', () => {
  send({ type: 'speechCatalog', value: { voices: [], more: false, loading: false, error: false } });
  expect(text('speech-settings-status')).toBe('');
  send({ type: 'speechCatalog', value: { voices: [], more: false, loading: true, error: false } });
  send({ type: 'speechCatalog', value: { voices: [], more: true, loading: false, error: false } });
  expect(text('speech-settings-status')).toBe('No voices on this page. Select Load more.');
});

it('does not report an empty result when an in-flight catalog is reset', () => {
  send({ type: 'speechCatalog', value: { voices: [], more: false, loading: true, error: false } });
  send({ type: 'speechCatalog', value: { voices: [], more: false, loading: false, error: false, reset: true } });
  expect(text('speech-settings-status')).toBe('');
});

it('shows output choices safely and refreshes only when requested', () => {
  const output = element('speech-output');
  if (!(output instanceof window.HTMLSelectElement)) throw new TypeError('Missing output selector');
  const choice = { kind: 'native' as const, backend: 'pipewire' as const, name: 'headphones' };
  send({
    type: 'speechOutputCatalog',
    value: { supported: true, devices: [{ choice, label: '<b>Headphones</b>', available: true }], selected: { kind: 'default' } },
  });
  expect(output.options[1]?.textContent).toBe('<b>Headphones</b>');
  expect(posted().filter((message) => message.type === 'speechOutputRefresh' || message.type === 'speechPreview')).toEqual([]);
  output.selectedIndex = 1;
  output.dispatchEvent(new window.Event('change'));
  expect(posted()).toContainEqual({ type: 'speechOutputSelect', choice });
  click(element('speech-output-refresh'));
  expect(posted()).toContainEqual({ type: 'speechOutputRefresh' });
});

it('keeps a missing saved output visible and explains unsupported output selection', () => {
  const output = element('speech-output');
  if (!(output instanceof window.HTMLSelectElement)) throw new TypeError('Missing output selector');
  send({
    type: 'speechOutputCatalog',
    value: { supported: false, devices: [], selected: { kind: 'native', backend: 'pipewire', name: 'saved' }, reason: 'unsupported' },
  });
  expect(output.selectedOptions[0]?.textContent).toBe('Saved output unavailable');
  expect(element('speech-output-status').textContent).toContain('unavailable');
  expect(element('speech-preview')).toHaveProperty('disabled', true);
});

it('prompts for an explicit output refresh before availability has been checked', () => {
  send({ type: 'speechOutputCatalog', value: { supported: false, devices: [], selected: { kind: 'default' } } });
  expect(element('speech-output-status').textContent).toBe('Select Refresh outputs to list available devices.');
});

it('renders a known selected output and blocks unavailable devices and malformed changes', () => {
  const output = element('speech-output');
  if (!(output instanceof window.HTMLSelectElement)) throw new TypeError('Missing output selector');
  const choice = { kind: 'native' as const, backend: 'pipewire' as const, name: 'saved' };
  const other = { kind: 'native' as const, backend: 'pipewire' as const, name: 'other' };
  send({ type: 'speechSupport', supported: true, gpu: true });
  send({
    type: 'speechOutputCatalog',
    value: {
      supported: true,
      devices: [
        { choice: other, label: 'Other', available: true },
        { choice, label: 'Saved', available: true },
      ],
      selected: choice,
    },
  });
  expect(output.selectedOptions[0]?.textContent).toBe('Saved');
  expect(element('speech-preview')).toHaveProperty('disabled', false);
  send({
    type: 'speechOutputCatalog',
    value: { supported: true, devices: [{ choice, label: 'Saved', available: false }], selected: choice, error: 'save_failed' },
  });
  expect(output.options[1]?.disabled).toBe(true);
  expect(element('speech-preview')).toHaveProperty('disabled', true);
  expect(element('speech-output-status').textContent).toBe('Could not save the output choice.');
  send({ type: 'speechOutputCatalog', value: { supported: true, devices: [], selected: choice } });
  expect(element('speech-output-status').textContent).toBe('Selected output is unavailable. Refresh outputs or choose System default.');
  output.value = 'invalid';
  output.dispatchEvent(new window.Event('change'));
  const invalid = document.createElement('option');
  invalid.value = '99';
  output.append(invalid);
  output.value = '99';
  output.dispatchEvent(new window.Event('change'));
  expect(posted().filter((message) => message.type === 'speechOutputSelect')).toEqual([]);
  send({
    type: 'speechOutputCatalog',
    value: { supported: false, devices: [{ choice, label: 'Saved', available: true }], selected: choice, reason: 'unavailable' },
  });
  expect(output.options[1]?.disabled).toBe(true);
});

it('acknowledges matching browser audio stop only after the clip is silenced', async () => {
  const pause = vi.fn<() => void>();
  class FakeAudio {
    pause = pause;
    play(): Promise<void> {
      return Promise.resolve();
    }
    addEventListener(): void {}
  }
  vi.stubGlobal('Audio', FakeAudio);
  vi.spyOn(window.URL, 'createObjectURL').mockReturnValue('blob:retire');
  vi.spyOn(window.URL, 'revokeObjectURL').mockImplementation(() => {});
  send({ type: 'speechPage', pageId: 1 });
  send({ type: 'speechStatus', pageId: 1, id: 2, state: 'preparing' });
  send({ type: 'speechAudio', pageId: 1, id: 2, wavBase64: 'AQI=', durationMs: 100 });
  await Promise.resolve();
  send({ type: 'speechControl', pageId: 2, id: 2, action: 'stop' });
  send({ type: 'speechControl', pageId: 1, id: 3, action: 'stop' });
  expect(posted().filter((message) => message.type === 'speechRetired')).toEqual([]);
  send({ type: 'speechControl', pageId: 1, id: 2, action: 'stop' });
  expect(pause).toHaveBeenCalledOnce();
  expect(posted()).toContainEqual({ type: 'speechRetired', id: 2, pageId: 1 });
});

it('saves fine listening speed independently of synthesis speeds and retains it across providers', () => {
  send({
    type: 'speechSettings',
    value: {
      contextEnabled: false,
      enabled: true,
      provider: 'elevenlabs',
      voice: 'af_heart',
      speed: 1.25,
      elevenLabsVoice: 'voice',
      elevenLabsSpeed: 1.2,
      listeningSpeed: 1,
    },
  });
  const speed = element('speech-listening-speed');
  if (!(speed instanceof window.HTMLInputElement)) throw new TypeError('Missing listening speed slider');
  speed.value = '1.1';
  speed.dispatchEvent(new window.Event('input'));
  expect(text('speech-listening-speed-value')).toBe('1.10x');
  speed.dispatchEvent(new window.Event('change'));
  expect(posted()).toContainEqual({
    type: 'speechSettings',
    value: {
      contextEnabled: false,
      enabled: true,
      provider: 'elevenlabs',
      voice: 'af_heart',
      speed: 1.25,
      elevenLabsVoice: 'voice',
      elevenLabsSpeed: 1.2,
      listeningSpeed: 1.1,
    },
  });
  const provider = element('speech-provider');
  if (!(provider instanceof window.HTMLSelectElement)) throw new TypeError('Missing speech provider');
  for (const value of ['kokoro', 'openrouter', 'elevenlabs']) {
    provider.value = value;
    provider.dispatchEvent(new window.Event('change'));
    expect(speed.value).toBe('1.1');
    expect(text('speech-listening-speed-value')).toBe('1.10x');
    const sent: unknown = posted().at(-1);
    expect(sent).toMatchObject({ type: 'speechSettings', value: { provider: value, listeningSpeed: 1.1 } });
  }
});

it('shows the requested and actual Kokoro compute backend and starts an explicit check', () => {
  send({ type: 'speechSupport', supported: true, gpu: true });
  send({
    type: 'speechComputeState',
    value: { requestedMode: 'auto', actualBackend: 'cpu', gpuCheck: { phase: 'unavailable', reason: 'no_hardware' } },
  });
  expect(text('gpu-status')).toContain('CPU');
  expect(text('gpu-status')).toContain('No compatible GPU');
  expect(element('speech-compute')).toHaveProperty('value', 'auto');
  click(element('gpu-check'));
  expect(posted()).toContainEqual({ type: 'checkGpuSetup' });
});

it('renders GPU checks and allows only the supported compute choices', () => {
  send({ type: 'speechSupport', supported: true, gpu: true });
  const select = ui('speech-compute');
  if (!(select instanceof window.HTMLSelectElement)) throw new TypeError('Missing compute select');
  for (const value of ['cpu', 'auto', 'gpu']) {
    select.value = value;
    select.dispatchEvent(new window.Event('change'));
    expect(posted()).toContainEqual({ type: 'speechComputeMode', value });
  }
  select.value = '';
  const beforeInvalid = posted().length;
  select.dispatchEvent(new window.Event('change'));
  expect(posted()).toHaveLength(beforeInvalid);
  send({ type: 'speechComputeState', value: { requestedMode: 'gpu', actualBackend: 'none', gpuCheck: { phase: 'checking' } } });
  expect(text('gpu-status')).toContain('Checking');
  expect(element('gpu-check')).toHaveProperty('disabled', true);
  send({ type: 'speechComputeState', value: { requestedMode: 'gpu', actualBackend: 'gpu', gpuCheck: { phase: 'ready' } } });
  expect(text('gpu-status')).toContain('ready');
  expect(element('gpu-check')).toHaveProperty('disabled', false);
  send({ type: 'speechComputeState', value: { requestedMode: 'cpu', actualBackend: 'none', gpuCheck: { phase: 'idle' } } });
  expect(text('gpu-status')).toContain('not been checked');
});

it('shows a fixed explanation for every GPU check failure and reports setup progress', () => {
  send({ type: 'speechSupport', supported: true, gpu: true });
  const reasons = {
    busy: 'still finishing',
    unsupported: 'unsupported',
    runtime_missing: 'runtime is missing',
    untrusted_driver: 'driver could not be trusted',
    no_hardware: 'No compatible GPU',
    inconclusive: 'could not be confirmed',
    model_missing: 'model is missing',
    probe_failed: 'check failed',
    timeout: 'timed out',
  } as const;
  for (const reason of [
    'busy',
    'unsupported',
    'runtime_missing',
    'untrusted_driver',
    'no_hardware',
    'inconclusive',
    'model_missing',
    'probe_failed',
    'timeout',
  ] as const) {
    const explanation = reasons[reason];
    send({
      type: 'speechComputeState',
      value: { requestedMode: 'auto', actualBackend: 'cpu', gpuCheck: { phase: 'unavailable', reason } },
    });
    expect(text('gpu-status')).toContain(explanation);
  }
  send({
    type: 'speechComputeState',
    value: {
      requestedMode: 'gpu',
      actualBackend: 'none',
      gpuCheck: { phase: 'checking', progress: { stage: 'download', current: 123_456_789, total: 325_532_232 } },
    },
  });
  expect(text('gpu-status')).toContain('download: 123.5 MB of 325.5 MB (38%)');
  send({
    type: 'speechComputeState',
    value: {
      requestedMode: 'gpu',
      actualBackend: 'none',
      gpuCheck: { phase: 'checking', progress: { stage: 'download', current: Number.NaN, total: 0 } },
    },
  });
  expect(text('gpu-status')).toContain('download: 0.0 MB');
  expect(text('gpu-status')).not.toMatch(/NaN|Infinity/);
  send({
    type: 'speechComputeState',
    value: { requestedMode: 'gpu', actualBackend: 'none', gpuCheck: { phase: 'checking', progress: { stage: 'download', current: 1 } } },
  });
  expect(text('gpu-status')).toContain('download: 0.0 MB');
  send({
    type: 'speechComputeState',
    value: { requestedMode: 'gpu', actualBackend: 'none', gpuCheck: { phase: 'checking', progress: { stage: 'verify' } } },
  });
  expect(text('gpu-status')).toContain('verify.');
  send({
    type: 'speechComputeState',
    value: {
      requestedMode: 'gpu',
      actualBackend: 'none',
      gpuCheck: { phase: 'checking', progress: { stage: 'verify', current: 1, total: 2 } },
    },
  });
  expect(text('gpu-status')).toContain('verify: 1 of 2');

  send({
    type: 'speechComputeState',
    value: { requestedMode: 'gpu', actualBackend: 'none', gpuCheck: { phase: 'checking', progress: { stage: 'verify', current: 2 } } },
  });
  expect(text('gpu-status')).toContain('verify: 2');
});

it('updates voice readiness independently of the narration toggle', () => {
  const button = element('voice-status');
  expect(button.getAttribute('aria-label')).toBe('Automatic narration');
  expect(button.getAttribute('aria-description')).toContain('not checked');
  vi.mocked(voiceIndicator).mockReturnValue('ready');
  send({ type: 'speechTransport', available: true });
  send({
    type: 'speechReadiness',
    value: {
      enabled: true,
      provider: 'kokoro',
      keyConfigured: 'unknown',
      voiceConfigured: true,
      output: 'default',
      routeAvailable: true,
      runtimeReady: true,
      modelReady: true,
      lastPlayback: 'unknown',
    },
  });
  send({ type: 'speechComputeState', value: { requestedMode: 'cpu', actualBackend: 'none', gpuCheck: { phase: 'idle' } } });
  expect(button.getAttribute('aria-description')).toContain('ready');
  vi.mocked(voiceIndicator).mockReturnValue('starting');
  send({ type: 'speechTransport', available: true });
  expect(button.dataset.state).toBe('starting');
  expect(button.getAttribute('aria-description')).toBe('Voice: model starting');
  click(element('settings'));
  element('settings-dialog').dispatchEvent(new window.Event('close'));
  expect(document.activeElement).toBe(element('settings'));
});

it('mutes active narration from the toolbar without pausing the session and toggles it back on', async () => {
  const pause = vi.fn<() => void>();
  class FakeAudio {
    pause = pause;
    play(): Promise<void> {
      return Promise.resolve();
    }
    addEventListener(): void {}
  }
  vi.stubGlobal('Audio', FakeAudio);
  vi.spyOn(window.URL, 'createObjectURL').mockReturnValue('blob:toggle');
  vi.spyOn(window.URL, 'revokeObjectURL').mockImplementation(() => {});
  const button = element('voice-status');
  if (!(button instanceof window.HTMLButtonElement)) throw new TypeError('Missing narration toggle');
  expect(button.disabled).toBe(true);
  send({ type: 'speechPage', pageId: 1 });
  send({
    type: 'speechSettings',
    value: {
      contextEnabled: false,
      enabled: true,
      provider: 'kokoro',
      voice: 'af_heart',
      speed: 1,
      elevenLabsVoice: '',
      elevenLabsSpeed: 1,
    },
  });
  expect(button.disabled).toBe(false);
  expect(button.getAttribute('aria-pressed')).toBe('true');
  send({ type: 'speechStatus', pageId: 1, id: 2, state: 'preparing' });
  send({ type: 'speechAudio', pageId: 1, id: 2, wavBase64: 'AQI=', durationMs: 100 });
  await Promise.resolve();
  click(button);
  expect(pause).toHaveBeenCalledOnce();
  expect(button.getAttribute('aria-pressed')).toBe('false');
  expect(element('speech-enabled')).toHaveProperty('checked', false);
  expect(posted()).toContainEqual({
    type: 'speechSettings',
    value: {
      contextEnabled: false,
      enabled: false,
      provider: 'kokoro',
      voice: 'af_heart',
      speed: 1,
      elevenLabsVoice: '',
      elevenLabsSpeed: 1,
      listeningSpeed: 1,
    },
  });
  expect(posted().filter((message) => message.type === 'pause' || message.type === 'interrupt')).toEqual([]);
  click(button);
  expect(button.getAttribute('aria-pressed')).toBe('true');
  expect(element('speech-enabled')).toHaveProperty('checked', true);
  expect(posted().at(-1)).toMatchObject({ type: 'speechSettings', value: { enabled: true } });
});

it('restores the settings button when the dialog closes without a recorded opener', () => {
  element('settings-dialog').dispatchEvent(new window.Event('close'));
  expect(document.activeElement).toBe(element('settings'));
});

it('refreshes an open voice tooltip when readiness changes', () => {
  vi.useFakeTimers();
  hover(element('voice-status'));
  vi.advanceTimersByTime(TIP_DELAY_MS);
  expect(tip()).toBe('Enable narration (Voice: readiness not checked)');
  vi.mocked(voiceIndicator).mockReturnValue('unavailable');
  send({ type: 'speechTransport', available: false });
  expect(tip()).toBe('Enable narration (Voice: unavailable)');
});

it('shows OpenRouter provider-default voice as ready only with current allowed-voice evidence', () => {
  vi.mocked(voiceIndicator).mockImplementation((facts, ...context) =>
    context[2] === true && facts?.voiceConfigured === true ? 'ready' : 'unavailable',
  );
  try {
    send({
      type: 'speechSettings',
      value: {
        contextEnabled: false,
        enabled: true,
        provider: 'openrouter',
        voice: 'af_heart',
        speed: 1,
        elevenLabsVoice: '',
        elevenLabsSpeed: 1,
        openRouterModel: 'model',
        openRouterVoice: '',
      },
    });
    send({ type: 'openRouterCatalog', value: { state: 'ready', verified: true, models: [{ id: 'model', name: 'Model', voices: [] }] } });
    send({ type: 'speechTransport', available: true });
    const facts = {
      enabled: true,
      provider: 'openrouter' as const,
      keyConfigured: true,
      voiceConfigured: true,
      output: 'default' as const,
      routeAvailable: true,
      runtimeReady: true,
      modelReady: true,
      lastPlayback: 'unknown' as const,
    };
    send({ type: 'speechReadiness', value: facts });
    expect(element('voice-status').dataset.state).toBe('ready');
    expect(vi.mocked(voiceIndicator).mock.lastCall?.[3]).toBe(true);
    send({ type: 'speechReadiness', value: { ...facts, voiceConfigured: false } });
    expect(element('voice-status').dataset.state).toBe('unavailable');
  } finally {
    vi.mocked(voiceIndicator).mockReset().mockReturnValue('checking');
  }
});

it('loads OpenRouter models and remembers the selected voice when ZDR changes', () => {
  send({ type: 'speechCloudSupport', supported: true });
  send({ type: 'openRouterKeyStatus', hasKey: true });
  const provider = element('speech-provider');
  const model = element('openrouter-model');
  const voice = element('openrouter-voice');
  if (
    !(provider instanceof window.HTMLSelectElement) ||
    !(model instanceof window.HTMLSelectElement) ||
    !(voice instanceof window.HTMLSelectElement)
  ) {
    throw new TypeError('Missing controls');
  }
  provider.value = 'openrouter';
  provider.dispatchEvent(new window.Event('change'));
  click(element('openrouter-key-set'));
  click(element('openrouter-load'));
  expect(posted()).toContainEqual({ type: 'openRouterKeySet' });
  expect(posted()).toContainEqual({ type: 'openRouterModelsLoad' });
  send({
    type: 'openRouterCatalog',
    value: { state: 'ready', verified: true, models: [{ id: 'model', name: 'Model', voices: [{ id: 'voice', name: 'Voice' }] }] },
  });
  model.value = 'model';
  model.dispatchEvent(new window.Event('change'));
  voice.value = 'voice';
  voice.dispatchEvent(new window.Event('change'));
  expect(posted()).toContainEqual({
    type: 'speechSettings',
    // oxlint-disable-next-line typescript/no-unsafe-assignment -- Vitest's asymmetric matcher validates this value.
    value: expect.objectContaining({ provider: 'openrouter', openRouterModel: 'model', openRouterVoice: 'voice', openRouterZdr: false }),
  });
  click(element('openrouter-zdr'));
  expect(element('openrouter-zdr').getAttribute('aria-pressed')).toBe('true');
  expect(element('openrouter-zdr').textContent).toBe('ZDR filter: On');
  expect(model.value).toBe('model');
  expect(voice.value).toBe('voice');
  expect(posted()).toContainEqual({
    type: 'speechSettings',
    // oxlint-disable-next-line typescript/no-unsafe-assignment -- Vitest's asymmetric matcher validates this value.
    value: expect.objectContaining({ openRouterModel: 'model', openRouterVoice: 'voice', openRouterZdr: true }),
  });
  send({
    type: 'openRouterCatalog',
    value: { state: 'ready', verified: true, models: [{ id: 'model', name: 'Model', voices: [{ id: 'voice', name: 'Voice' }] }] },
  });
  expect(model.value).toBe('model');
  expect(voice.value).toBe('voice');
  click(element('openrouter-zdr'));
  send({ type: 'openRouterCatalog', value: { state: 'ready', verified: true, models: [] } });
  expect(model.value).toBe('');
  expect(element('speech-preview').hasAttribute('disabled')).toBe(true);
});

it('shows the advertised rates for each OpenRouter model and explains that billing units vary', () => {
  vi.mocked(formatOpenRouterPricing)
    .mockReturnValueOnce('$0.000015 input, $0 output per billing unit')
    .mockReturnValueOnce('input rate unavailable, $0.0025 output per billing unit')
    .mockReturnValueOnce('Pricing unavailable');
  const models = [
    { id: 'vendor/characters', name: 'Characters', voices: [], pricing: { prompt: '0.000015', completion: '0' } },
    { id: 'vendor/seconds', name: 'Seconds', voices: [], pricing: { completion: '0.0025' } },
    { id: 'vendor/unknown', name: 'Unknown', voices: [] },
  ];
  send({ type: 'openRouterCatalog', value: { state: 'ready', verified: true, models } });
  const select = element('openrouter-model');
  if (!(select instanceof window.HTMLSelectElement)) throw new TypeError('Missing OpenRouter model selector');
  expect(select.options[1]?.textContent).toBe('Characters: $0.000015 input, $0 output per billing unit');
  expect(select.options[2]?.textContent).toBe('Seconds: input rate unavailable, $0.0025 output per billing unit');
  expect(select.options[3]?.textContent).toBe('Unknown: Pricing unavailable');
  expect(formatOpenRouterPricing).toHaveBeenCalledWith(models[0]?.pricing);
  expect(formatOpenRouterPricing).toHaveBeenCalledWith(models[1]?.pricing);
  expect(formatOpenRouterPricing).toHaveBeenCalledWith(undefined);
  expect(element('openrouter').textContent).toMatch(/units vary by model/i);
  select.value = 'vendor/seconds';
  expect(select.value).toBe('vendor/seconds');
});

it('saves only supported OpenRouter response formats', () => {
  const provider = element('speech-provider');
  const format = element('openrouter-format');
  if (!(provider instanceof window.HTMLSelectElement) || !(format instanceof window.HTMLSelectElement)) {
    throw new TypeError('Missing OpenRouter format controls');
  }
  provider.value = 'openrouter';
  provider.dispatchEvent(new window.Event('change'));
  for (const value of ['pcm', 'mp3'] as const) {
    format.value = value;
    format.dispatchEvent(new window.Event('change'));
    expect(posted()).toContainEqual({
      type: 'speechSettings',
      // oxlint-disable-next-line typescript/no-unsafe-assignment -- Vitest's asymmetric matcher validates this value.
      value: expect.objectContaining({ provider: 'openrouter', openRouterFormat: value }),
    });
  }
  const beforeInvalid = posted().filter((message) => message.type === 'speechSettings').length;
  format.value = '';
  format.dispatchEvent(new window.Event('change'));
  expect(posted().filter((message) => message.type === 'speechSettings')).toHaveLength(beforeInvalid);
});

it('sends decoder frames from the local page handler through the VS Code API', () => {
  window.dispatchEvent(new window.MessageEvent('message', { data: { type: 'mockDecodePost' } }));
  expect(posted()).toContainEqual({ type: 'speechDecodeReady' });
});

it('reports OpenRouter catalog states and restores saved settings', () => {
  send({
    type: 'speechSettings',
    value: {
      contextEnabled: false,
      enabled: true,
      provider: 'openrouter',
      voice: 'af_heart',
      speed: 1,
      elevenLabsVoice: '',
      elevenLabsSpeed: 1,
      openRouterModel: 'm',
      openRouterVoice: 'v',
      openRouterZdr: true,
      openRouterFormat: 'pcm',
    },
  });
  const format = element('openrouter-format');
  if (!(format instanceof window.HTMLSelectElement)) throw new TypeError('Missing format select');
  expect(format.value).toBe('pcm');
  send({ type: 'openRouterKeyStatus', hasKey: false });
  expect(element('openrouter-key-status').textContent).toBe('No API key saved.');
  send({ type: 'openRouterCatalog', value: { state: 'loading', verified: false, models: [] } });
  expect(element('openrouter-status').textContent).toContain('Loading');
  send({ type: 'openRouterCatalog', value: { state: 'error', verified: false, models: [] } });
  expect(element('openrouter-status').textContent).toContain('Could not load');
  send({ type: 'openRouterCatalog', value: { state: 'error', verified: false, models: [], message: 'Unavailable.' } });
  expect(element('openrouter-status').textContent).toBe('Unavailable.');
  send({ type: 'openRouterCatalog', value: { state: 'ready', verified: true, models: [] } });
  expect(element('openrouter-status').textContent).toContain('No eligible speech models');
  send({ type: 'openRouterCatalog', value: { state: 'idle', verified: false, models: [] } });
  expect(element('openrouter-status').textContent).toContain('Load speech models');
  send({ type: 'speechCloudSupport', supported: true });
  send({ type: 'openRouterKeyStatus', hasKey: true });
  click(element('openrouter-key-remove'));
  expect(posted()).toContainEqual({ type: 'openRouterKeyRemove' });
  send({
    type: 'speechSettings',
    value: {
      contextEnabled: false,
      enabled: true,
      provider: 'openrouter',
      voice: 'af_heart',
      speed: 1,
      elevenLabsVoice: '',
      elevenLabsSpeed: 1,
      openRouterModel: 'm',
    },
  });
  send({
    type: 'speechSettings',
    value: {
      contextEnabled: false,
      enabled: true,
      provider: 'openrouter',
      voice: 'af_heart',
      speed: 1,
      elevenLabsVoice: '',
      elevenLabsSpeed: 1,
    },
  });
});

it('marks a remembered OpenRouter selection unavailable when a current catalog excludes it', () => {
  send({ type: 'speechCloudSupport', supported: true });
  send({ type: 'openRouterKeyStatus', hasKey: true });
  send({
    type: 'speechSettings',
    value: {
      contextEnabled: false,
      enabled: true,
      provider: 'openrouter',
      voice: 'af_heart',
      speed: 1,
      elevenLabsVoice: '',
      elevenLabsSpeed: 1,
      openRouterModel: 'saved',
      openRouterVoice: 'voice',
    },
  });
  const model = element('openrouter-model');
  const voice = element('openrouter-voice');
  if (!(model instanceof window.HTMLSelectElement) || !(voice instanceof window.HTMLSelectElement)) throw new TypeError('Missing controls');
  expect(model.selectedOptions[0]?.textContent).toContain('Saved model');
  send({
    type: 'openRouterCatalog',
    value: {
      state: 'ready',
      verified: true,
      models: [{ id: 'other', name: 'Other', voices: [{ id: 'other-voice', name: 'Other voice' }] }],
    },
  });
  expect(model.value).toBe('');
  expect(voice.value).toBe('');
  expect(element('speech-preview').hasAttribute('disabled')).toBe(true);
});

it('retains authoritative exclusion during a refresh and its failure', () => {
  send({ type: 'speechCloudSupport', supported: true });
  send({ type: 'openRouterKeyStatus', hasKey: true });
  send({
    type: 'speechSettings',
    value: {
      contextEnabled: false,
      enabled: true,
      provider: 'openrouter',
      voice: 'af_heart',
      speed: 1,
      elevenLabsVoice: '',
      elevenLabsSpeed: 1,
      openRouterModel: 'saved',
      openRouterVoice: 'voice',
    },
  });
  const model = element('openrouter-model');
  if (!(model instanceof window.HTMLSelectElement)) throw new TypeError('Missing model selector');
  for (const state of ['ready', 'loading', 'error'] as const) {
    send({ type: 'openRouterCatalog', value: { state, verified: true, models: [] } });
    expect(model.options).toHaveLength(1);
    expect(element('speech-preview').hasAttribute('disabled')).toBe(true);
  }
  send({ type: 'openRouterCatalog', value: { state: 'idle', verified: false, models: [] } });
  expect(model.selectedOptions[0]?.textContent).toContain('Saved model');
});

it('saves the ZDR choice before refreshing compatible account models', () => {
  send({ type: 'speechCloudSupport', supported: true });
  send({ type: 'openRouterKeyStatus', hasKey: true });
  send({
    type: 'speechSettings',
    value: {
      contextEnabled: false,
      enabled: false,
      provider: 'openrouter',
      voice: 'af_heart',
      speed: 1,
      elevenLabsVoice: '',
      elevenLabsSpeed: 1,
    },
  });
  send({
    type: 'openRouterCatalog',
    value: { state: 'ready', verified: true, models: [{ id: 'model', name: 'Model', voices: [{ id: 'voice', name: 'Voice' }] }] },
  });
  const prior = posted().length;
  click(element('openrouter-zdr'));
  expect(
    posted()
      .slice(prior)
      .map((message) => message.type),
  ).toEqual(['speechSettings', 'openRouterModelsLoad']);
  expect(element('openrouter-status').textContent).not.toBe('Compatible account models loaded.');
  send({ type: 'openRouterCatalog', value: { state: 'ready', verified: true, models: [] } });
  expect(element('openrouter-status').textContent).toContain('No eligible speech models');
});

it('saves ZDR without requesting a catalog when no key is saved', () => {
  send({ type: 'speechCloudSupport', supported: true });
  send({ type: 'openRouterKeyStatus', hasKey: false });
  send({
    type: 'speechSettings',
    value: {
      contextEnabled: false,
      enabled: false,
      provider: 'openrouter',
      voice: 'af_heart',
      speed: 1,
      elevenLabsVoice: '',
      elevenLabsSpeed: 1,
    },
  });
  const prior = posted().length;
  click(element('openrouter-zdr'));
  expect(
    posted()
      .slice(prior)
      .map((message) => message.type),
  ).toEqual(['speechSettings']);
  expect(element('openrouter-status').textContent).toContain('API key');
});

it('saves ZDR without requesting a catalog when cloud speech is unsupported', () => {
  send({ type: 'speechCloudSupport', supported: false });
  send({ type: 'openRouterKeyStatus', hasKey: true });
  send({
    type: 'speechSettings',
    value: {
      contextEnabled: false,
      enabled: false,
      provider: 'openrouter',
      voice: 'af_heart',
      speed: 1,
      elevenLabsVoice: '',
      elevenLabsSpeed: 1,
    },
  });
  const prior = posted().length;
  click(element('openrouter-zdr'));
  expect(
    posted()
      .slice(prior)
      .map((message) => message.type),
  ).toEqual(['speechSettings']);
  expect(element('openrouter-status').textContent).toContain('unavailable');
});

it('shows model capability and saves context without enabling speech', () => {
  send({
    type: 'speechSettings',
    value: {
      enabled: false,
      contextEnabled: false,
      provider: 'openrouter',
      voice: 'af_heart',
      speed: 1,
      elevenLabsVoice: '',
      elevenLabsSpeed: 1,
      openRouterModel: 'elevenlabs/eleven-v4',
      openRouterVoice: '',
      openRouterZdr: false,
    },
  });
  expect(text('speech-context-capability')).toContain('Previous context requires Zero Data Retention');
  const select = element('speech-context');
  if (!(select instanceof window.HTMLSelectElement)) throw new TypeError('Missing speech context selector');
  select.value = 'on';
  select.dispatchEvent(new window.Event('change'));
  expect(posted().at(-1)).toMatchObject({
    type: 'speechSettings',
    value: { enabled: false, contextEnabled: true, provider: 'openrouter' },
  });
});

it('shows context capabilities for supported and unsupported models', () => {
  const base = {
    enabled: false,
    provider: 'openrouter' as const,
    voice: 'af_heart',
    speed: 1,
    elevenLabsVoice: '',
    elevenLabsSpeed: 1,
    openRouterVoice: '',
    contextEnabled: true,
    openRouterZdr: true,
  };
  send({ type: 'speechSettings', value: { ...base, openRouterModel: 'elevenlabs/eleven-v4' } });
  expect(text('speech-context-capability')).toContain('Previous context and delivery cues');
  expect(element('speech-context')).toHaveProperty('value', 'on');
  send({ type: 'speechSettings', value: { ...base, openRouterModel: 'elevenlabs/eleven-v3' } });
  expect(text('speech-context-capability')).toContain('Delivery cues only');
  send({ type: 'speechSettings', value: { ...base, openRouterModel: 'other/model' } });
  expect(text('speech-context-capability')).toContain('ordinary speech only');
});

it('requests and cancels attention from the hand button using the owner snapshot', () => {
  start();
  const hand = element('attention');
  click(hand);
  expect(post).toHaveBeenLastCalledWith({ type: 'attention' });
  send({ type: 'attention', state: 'requested' });
  expect(hand.getAttribute('aria-label')).toBe('Lower hand');
  expect(hand.classList.contains('on')).toBe(true);
  click(hand);
  expect(post).toHaveBeenLastCalledWith({ type: 'attention' });
  send({ type: 'attention', state: 'granted' });
  expect(hand.getAttribute('aria-label')).toBe('Focus reply');
  expect(document.activeElement).toBe(element('reply'));
  click(hand);
  expect(document.activeElement).toBe(element('reply'));
  send({ type: 'attention', state: 'none' });
  expect(hand.getAttribute('aria-label')).toBe('Raise hand');
  expect(hand.classList.contains('on')).toBe(false);
});

it('plays the cue under the attention hold but respects an independent speech pause', async () => {
  const play = vi.fn<() => Promise<void>>().mockResolvedValue();
  class FakeAudio {
    pause(): void {}
    play = play;
    addEventListener(): void {}
  }
  vi.stubGlobal('Audio', FakeAudio);
  vi.spyOn(window.URL, 'createObjectURL').mockReturnValue('blob:test');
  vi.spyOn(window.URL, 'revokeObjectURL').mockImplementation(() => {});
  start();
  send({ type: 'speechPage', pageId: 1 });
  send({ type: 'state', state: 'paused', turn: 'agent', paused: true, speechPaused: false });
  send({ type: 'speechStatus', id: 1, pageId: 1, state: 'preparing' });
  send({ type: 'speechAudio', id: 1, pageId: 1, wavBase64: 'AQI=', durationMs: 100 });
  await Promise.resolve();
  expect(play).toHaveBeenCalledOnce();
  send({ type: 'speechControl', id: 1, pageId: 1, action: 'stop' });
  send({ type: 'state', state: 'paused', turn: 'agent', paused: true, speechPaused: true });
  send({ type: 'speechStatus', id: 2, pageId: 1, state: 'preparing' });
  send({ type: 'speechAudio', id: 2, pageId: 1, wavBase64: 'AQI=', durationMs: 100 });
  await Promise.resolve();
  expect(play).toHaveBeenCalledOnce();
});

it('disables the hand outside a session and restores its state without focusing on replay', () => {
  const hand = element('attention');
  if (!(hand instanceof window.HTMLButtonElement)) throw new TypeError('Missing hand button');
  expect(hand.disabled).toBe(true);
  send({
    type: 'replay',
    events: [
      { type: 'session', active: true },
      { type: 'attention', state: 'granted' },
    ],
  });
  expect(hand.disabled).toBe(false);
  expect(hand.getAttribute('aria-label')).toBe('Focus reply');
  expect(document.activeElement).not.toBe(element('reply'));
  send({ type: 'attention', state: 'none' });
  send({ type: 'session', active: false, reason: 'agent' });
  expect(hand.disabled).toBe(true);
});

it.each(['requested', 'granted'] as const)('clears a replayed %s hand when the revived owner resets attention', (state) => {
  send({
    type: 'replay',
    events: [
      { type: 'session', active: true },
      { type: 'attention', state },
    ],
  });
  send({ type: 'session', active: true, suspended: true });
  send({ type: 'attention', state: 'none' });
  post.mockClear();
  click(element('attention'));
  expect(posted()).toEqual([{ type: 'attention' }]);
  expect(element('attention').getAttribute('aria-label')).toBe('Raise hand');
});

it('OfferedOnlyWhereCapable: disables GPU and Auto and explains why on a host without a GPU path (#42)', () => {
  send({ type: 'speechSupport', supported: true, gpu: false });
  const select = ui('speech-compute');
  if (!(select instanceof window.HTMLSelectElement)) throw new TypeError('Missing compute select');
  expect([...select.options].map((option) => [option.value, option.disabled])).toEqual([
    ['cpu', false],
    ['auto', true],
    ['gpu', true],
  ]);
  expect(element('gpu-check')).toHaveProperty('hidden', true);
  expect(text('gpu-status')).toBe('GPU speech is unavailable on this computer. Choose CPU.');
  send({ type: 'speechComputeState', value: { requestedMode: 'gpu', actualBackend: 'none', gpuCheck: { phase: 'idle' } } });
  expect(text('gpu-status')).toBe('GPU speech is unavailable on this computer. Choose CPU.');
  send({ type: 'speechSupport', supported: true, gpu: true });
  expect([...select.options].every((option) => !option.disabled)).toBe(true);
  expect(element('gpu-check')).toHaveProperty('hidden', false);
});
