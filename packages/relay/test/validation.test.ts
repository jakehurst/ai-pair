// The relay's schema and the player's own checks accept the same actions (ActionValidation in #19):
// every action below goes through both, and they must agree on whether it's malformed.

import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { CURSOR_MARKER, type Action } from '@ai-pair/protocol';
import { setup, until } from '../../core/test/fake';
import { TOOLS } from '../src/tools';

const places = {
  move: [
    { to: 'line_end' },
    { line: 1, to: 'line_end' },
    { line: 1, at: `x${CURSOR_MARKER}` },
    { at: 'x' },
    { at: `${CURSOR_MARKER}${CURSOR_MARKER}` },
    { line: 0, to: 'line_end' },
    { line: 1.5, to: 'line_end' },
    { to: 'start' },
    { at: `x${CURSOR_MARKER}`, to: 'line_end' },
    {},
    { before: 'x' },
    { to: 'line_end', extra: 1 },
    { line: '1', to: 'line_end' },
    { line: 1, at: 5 },
    5,
    'x',
    true,
    [],
    // A JSON `null`, as an agent could send.
    // oxlint-disable-next-line unicorn/no-null
    null,
  ],
  span: [
    { text: 'x' },
    { line: 1, text: 'x' },
    { from: 'x', through: 'y' },
    { from: 'x' },
    { text: '' },
    { text: 'x', from: 'x', through: 'y' },
    {},
    { near_line: 1, text: 'x' },
    { to: 'y', from: 'x' },
    { text: 5 },
    { text: 'x', extra: 1 },
    { line: -1, text: 'x' },
    5,
    'x',
    true,
    [],
    // A JSON `null`, as an agent could send.
    // oxlint-disable-next-line unicorn/no-null
    null,
  ],
  type: [`x${CURSOR_MARKER}`, 'x', `${CURSOR_MARKER}${CURSOR_MARKER}`, 5, [`x${CURSOR_MARKER}`], ''],
};

const actions: unknown[] = [
  ...places.move.map((move) => ({ move })),
  ...places.span.map((select) => ({ select })),
  ...places.span.map((point) => ({ point })),
  ...places.type.map((type) => ({ type })),
  ...places.type.map((text) => ({ type_fast: text })),
  { delete: true },
  { delete: false },
  { delete: 1 },
  { say: 'hi' },
  { say: '' },
  { say: 3 },
  { run: 'true' },
  { run: 'true', wait: 5 },
  { run: 'true', wait: -1 },
  { run: 'true', wait: '5' },
  { run: 3 },
  { say: 'a', extra: 1 },
  { run: 'true', extra: 1 },
  { delete: true, extra: 1 },
  { say: 'a', type: `b${CURSOR_MARKER}` },
  { foo: 1 },
  {},
  'say',
  // A JSON `null`, as an agent could send.
  // oxlint-disable-next-line unicorn/no-null
  null,
];

const schema = z.object(TOOLS.step.inputSchema);

/** Returns whether the player rejects the action as malformed, played after a move that gives it a cursor and a selection. */
async function playerRejects(action: unknown): Promise<string | undefined> {
  vi.useFakeTimers();
  try {
    const { controller } = setup({ 'a.ts': 'xy\nx\n' });
    await controller.start();
    await controller.read('a.ts');
    const prefix: Action[] = [{ move: { file: 'a.ts', line: 1, to: 'line_end' } }, { select: { line: 1, text: 'x' } }];
    // The player is reached from the bridge, which checks only that `actions` is an array: these
    // actions are malformed on purpose.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const report = await until(controller.step([...prefix, action as Action]));
    const r = report.rejected;
    return r && r.index === 3 && r.error.kind === 'invalid_action' ? r.error.message : undefined;
  } finally {
    vi.useRealTimers();
  }
}

describe('action validation', () => {
  for (const action of actions) {
    it(`agrees on ${JSON.stringify(action)}`, async () => {
      const relay = schema.safeParse({ actions: [action] }).success;
      const player = await playerRejects(action);
      expect({ relayAccepts: relay, playerRejects: player !== undefined, player }).toMatchObject({ relayAccepts: player === undefined });
    });
  }
});
