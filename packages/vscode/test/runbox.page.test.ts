// @vitest-environment happy-dom
// The panel's run box (specs/RunBox.tla): shown while a command waits for a decision or runs, and cleared by
// every phase that ends the run and by the session ending.

import { beforeEach, expect, it } from 'vitest';
import type { Window } from 'happy-dom';
import { loadPage, ui } from './page';

// The test environment's globals, typed with happy-dom's types: the project's type check has no DOM library.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const { window } = globalThis as unknown as { window: Window };

beforeEach(async () => {
  await loadPage();
});

function send(event: object): void {
  window.dispatchEvent(new window.MessageEvent('message', { data: event }));
}

function shown(): boolean {
  return ui('run')?.classList.contains('on') ?? false;
}
function confirming(): boolean {
  return ui('run')?.classList.contains('confirm') ?? false;
}
function run(phase: string): void {
  send({ type: 'run', id: 1, command: 'npm test', phase });
}

it('BoxMatches: shows the box while a command waits for a decision, and while it runs', () => {
  send({ type: 'session', active: true });
  expect(shown()).toBe(false);
  run('confirm');
  expect(shown() && confirming()).toBe(true);
  run('running');
  expect(shown() && !confirming()).toBe(true);
});

it.each(['done', 'background', 'declined'])('Clears: a %s phase clears the box', (phase) => {
  send({ type: 'session', active: true });
  run('running');
  run(phase);
  expect(shown()).toBe(false);
});

it('Clears: the session ending clears the box', () => {
  send({ type: 'session', active: true });
  run('confirm');
  send({ type: 'session', active: false, reason: 'user' });
  expect(shown()).toBe(false);
});
