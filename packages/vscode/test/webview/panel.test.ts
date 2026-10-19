// @vitest-environment happy-dom
// The narration panel's page script, webview/panel.ts, on the page panel_html.ts writes (test/fixtures/panel.html).
// Solitary (#176): the script imports only types and constants, so the page is all it runs on; its postMessage is
// acquireVsCodeApi's fake, and the extension's messages are window 'message' events the test dispatches. The cases
// come from specs/Panel.tla, PanelScroll.tla, RunBox.tla, Start.tla, and the panel's issues.

import { ok } from 'node:assert/strict';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock, type MockInstance } from 'vitest';
import type { Element, HTMLElement, Window } from 'happy-dom';
import { ELLIPSIS, LABEL_SEPARATOR, RANGE_DASH, RIGHT_ARROW, SPEED_SUFFIX } from '@ai-pair/core/constants';
import type { ToPanel } from '../../src/panel_messages';
import { loadPage, ui } from '../page';

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

beforeEach(async () => {
  targets = [window, document, document.documentElement].map((target) => ({ target, spy: vi.spyOn(target, 'addEventListener') }));
  post = vi.fn<(message: { type: string }) => void>();
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

/** Starts a session with every kind of link: the intro's commands, a file and a URL in messages, code references. */
function withEveryLink(): void {
  start();
  send({ type: 'selection', ref: { file: 'src/a.ts', line: 3, endLine: 4 } });
  send({ type: 'point', file: 'src/a.ts', line: 2 });
  send({ type: 'say', text: 'See `src/a.ts` and https://example.com/docs' });
  send({ type: 'user', text: 'ok', ref: { file: 'src/a.ts', line: 5, endLine: 5 } });
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
    send({ type: 'user', text: 'R' });
    send({ type: 'say', text: 'B' });
    expect(history()).toEqual(['R', 'A', 'Session started']);
  });

  it('NoDuplicates, NewestFirst: files the current message once, before anything added while it was current', () => {
    start();
    send({ type: 'say', text: 'A' });
    send({ type: 'user', text: 'R' });
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
    send({ type: 'user', text: 'R' });
    expect(element('history').scrollTop).toBe(0);
    element('history').scrollTop = SCROLLED;
    send({ type: 'turn', to: 'user', message: 'M' });
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
    send({ type: 'user', text: 'one line', ref: { file: 'src/a.ts', line: 5, endLine: 5 } });
    send({ type: 'user', text: 'a range', ref: { file: 'src/a.ts', line: 3, endLine: 4 } });
    expect(history().slice(0, 2)).toEqual([`a rangesrc/a.ts:3${RANGE_DASH}4`, 'one linesrc/a.ts:5']);
    const ref = element('history').querySelector('.you a.ref');
    ok(ref);
    click(ref);
    expect(posted().at(-1)).toEqual({ type: 'open', file: 'src/a.ts', line: 3 });
  });

  it('files a change of turn, with the message and code that came with it, and sets the placeholder to match', () => {
    start();
    send({ type: 'turn', to: 'user', message: 'M' });
    expect(replyBox().placeholder).toBe(`Ask the agent${ELLIPSIS}`);
    send({ type: 'turn', to: 'agent', ref: { file: 'b.ts', line: 1, endLine: 1 } });
    expect(replyBox().placeholder).toBe(`Reply to the agent${ELLIPSIS}`);
    send({ type: 'turn', to: 'user' });
    expect(history()).toEqual(['You took the turn', 'b.ts:1', 'You handed the turn back', 'M', 'You took the turn', 'Session started']);
  });

  it('says how the session ended, in the history and in the idle view, with its summary', () => {
    start();
    send({ type: 'session', active: false, reason: 'user', summary: 'Fixed `src/a.ts`.' });
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
    ['typing', '', 'Agent is typing'],
    ['read', 'read', 'Read this'],
    ['running', '', 'Running a command'],
    ['thinking', 'dim', 'Agent is thinking'],
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

  it('shows a pause and a change of turn on the buttons, their labels, and their tooltips', () => {
    start();
    send({ type: 'state', state: 'paused', turn: 'user', paused: true });
    expect(document.body.classList.contains('paused')).toBe(true);
    expect(document.body.classList.contains('user-turn')).toBe(true);
    expect(element('pause').classList.contains('on')).toBe(true);
    expect(element('pause').getAttribute('aria-label')).toBe('Resume');
    expect(element('pause').dataset.tip).toBe('Resume (Space)');
    expect(text('turn-label')).toBe('Hand back');
    expect(element('turn').getAttribute('aria-label')).toBe('Hand back');
    expect(element('turn').dataset.tip).toBe('Hand the turn back to the agent, with your reply if you typed one');
    send({ type: 'state', state: 'typing', turn: 'agent', paused: false });
    expect(document.body.classList.contains('paused')).toBe(false);
    expect(document.body.classList.contains('user-turn')).toBe(false);
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
      send({ type: 'session', active: false, reason: 'user' });
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
    send({ type: 'session', active: false, reason: 'user' });
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
    send({ type: 'session', active: false, reason: 'user' });
    expect(boxShown()).toBe(false);
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
    click(element('run-skip'));
    expect(posted().slice(-3)).toEqual([
      { type: 'runDecision', id: 1, run: true, remember: false },
      { type: 'runDecision', id: 1, run: true, remember: true },
      { type: 'runDecision', id: 1, run: false, remember: false },
    ]);
    runPhase('declined');
    click(element('run-go'));
    expect(posted().at(-1)?.type).toBe('runDecision');
    expect(posted().filter((m) => m.type === 'runDecision')).toHaveLength(3);
  });

  it.each([
    ['declined', undefined, 'skipped', []],
    ['background', undefined, 'still running', []],
    ['done', undefined, 'done', []],
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
    expect(element('history').querySelector('.run[data-run="1"] .outcome')?.textContent).toBe('ended');
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

  it('takes the turn bare, and hands it back with the reply and the selection', () => {
    click(element('turn'));
    send({ type: 'state', state: 'navigator', turn: 'user', paused: false });
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
    send({ type: 'state', state: 'navigator', turn: 'user', paused: false });
    press(element('end'), ' ');
    send({ type: 'session', active: false, reason: 'user' });
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
    expect(element(m.menu).querySelector('[aria-checked="true"]')?.textContent).toBe(`1.5${SPEED_SUFFIX}`);
    send({ type: m.type, value: 2 });
    expect(text(m.button)).toBe(`${m.prefix}2.0${SPEED_SUFFIX}`);
    send({ type: m.type, value: 1.25 });
    expect(text(m.button)).toBe(`${m.prefix}1.25${SPEED_SUFFIX}`);
    expect(element(m.menu).querySelector('[aria-checked="true"]')).toBeNull();
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
    send({ type: 'session', active: false, reason: 'user' });
    expect(element(m.menu).hidden).toBe(true);
  });
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
    send({ type: 'session', active: false, reason: 'user' });
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

  it('RunsAreClicks: posts start when the button is clicked', () => {
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

  it('Settles: hides the starting note once the agent has exited, with no session', () => {
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
      send({ type: 'session', active: false, reason: 'user' });
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
