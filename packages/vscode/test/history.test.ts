// @vitest-environment happy-dom
// The panel's history, with the page script running in a DOM. The cases come from specs/Panel.tla (#18).

import { beforeEach, expect, it } from 'vitest';
import type { Element, Window } from 'happy-dom';
import { LABEL_SEPARATOR } from '@ai-pair/core/constants';
import { loadPage, ui } from './page';

// The test environment's globals, typed with happy-dom's types: the project's type check has no DOM library.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const { window } = globalThis as unknown as { window: Window };

/** How far down a test scrolls the history before an entry comes in. */
const SCROLLED = 120;

beforeEach(async () => {
  await loadPage();
});

function send(event: object): void {
  window.dispatchEvent(new window.MessageEvent('message', { data: event }));
}

/** Returns the history's element, which scrolls. */
function historyView(): Element {
  const view = ui('history');
  if (!view) throw new Error('The page has no [data-ui="history"]');
  return view;
}

function history(): string[] {
  return [...historyView().querySelectorAll('.entry')].map((e) => e.textContent ?? '');
}

it('NewestFirst, NoneLost: puts a reply above the agent message it answers', () => {
  send({ type: 'session', active: true });
  send({ type: 'say', text: 'A' });
  send({ type: 'user', text: 'R' });
  send({ type: 'say', text: 'B' });
  expect(history()).toEqual(['R', 'A', 'Session started']);
});

it('NoDuplicates, NewestFirst: files the current message once, before anything added while it was current', () => {
  send({ type: 'session', active: true });
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
  send({ type: 'session', active: true });
  send({ type: 'say', text: 'A' });
  send({ type: 'session', active: true, suspended: true });
  expect(ui('status-text')?.textContent).toBe('Suspended: waiting for the agent');
  send({ type: 'session', active: true, resumed: true });
  expect(history()).toEqual([
    'The agent is back: session resumed',
    'The agent disconnected: the session waits for it',
    'A',
    'Session started',
  ]);
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
  expect(ui('status-text')?.textContent).toBe('Suspended: waiting for the agent');
  expect(history()).toEqual(['The agent disconnected: the session waits for it', 'A', 'Session started']);
});

it('ShownIsState: a revive after a disconnect shows the suspension once (#138)', () => {
  const suspended = { type: 'session', active: true, suspended: true };
  send({ type: 'replay', events: [{ type: 'session', active: true }, suspended] });
  send(suspended);
  expect(history()).toEqual(['The agent disconnected: the session waits for it', 'Session started']);
});

it('YoursInView: your message scrolls the history back to its top (#139)', () => {
  send({ type: 'session', active: true });
  send({ type: 'say', text: 'A' });
  historyView().scrollTop = SCROLLED;
  send({ type: 'user', text: 'R' });
  expect(historyView().scrollTop).toBe(0);
  historyView().scrollTop = SCROLLED;
  send({ type: 'turn', to: 'user', message: 'M' });
  expect(historyView().scrollTop).toBe(0);
});

it('KeepsPlace: entries other than your message leave the history where you scrolled it (#139)', () => {
  send({ type: 'session', active: true });
  send({ type: 'say', text: 'A' });
  historyView().scrollTop = SCROLLED;
  send({ type: 'say', text: 'B' });
  send({ type: 'interrupt' });
  send({ type: 'outside', files: ['a.ts'] });
  expect(historyView().scrollTop).toBe(SCROLLED);
});
