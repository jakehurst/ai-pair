// A `run` command's output and outcome, from terminal.ts, without VS Code (#7). Solitary: core's terminalText is a
// mock, which takes the raw output as its text with the edges trimmed.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { terminalText } from '@ai-pair/core';
import { MAX_OUTPUT, outcomeOf, Tail } from '../src/output';

vi.mock('@ai-pair/core', () => ({ terminalText: vi.fn((raw: string) => raw.trim()) }));

/** Returns a command's output as the terminal keeps it. */
function tail(text: string): Tail {
  const kept = new Tail(MAX_OUTPUT * 4);
  kept.push(text);
  return kept;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('Tail', () => {
  it('keeps the last characters of a stream, and says when it dropped some', () => {
    const kept = new Tail(5);
    kept.push('abc');
    expect([kept.text, kept.dropped]).toEqual(['abc', false]);
    kept.push('defg');
    expect([kept.text, kept.dropped]).toEqual(['cdefg', true]);
  });
});

describe('outcomeOf', () => {
  const ended = Promise.resolve();

  it("gives a finished command's output as text, its shell, and its exit code", () => {
    const outcome = outcomeOf(tail('raw ok\r\n'), { shell: 'zsh', finished: true, exitCode: () => 0, ended });
    expect(outcome).toEqual({ output: 'raw ok', shell: 'zsh', exitCode: 0 });
    expect(vi.mocked(terminalText).mock.calls).toEqual([['raw ok\r\n']]);
  });

  it('gives no exit code for a finished command whose terminal reported none', () => {
    expect(outcomeOf(tail('done'), { shell: undefined, finished: true, exitCode: () => undefined, ended })).toEqual({ output: 'done' });
  });

  it('keeps the last MAX_OUTPUT characters, marked as cut, and marks a tail that dropped some', () => {
    const outcome = outcomeOf(tail('x'.repeat(MAX_OUTPUT + 10)), { shell: undefined, finished: true, exitCode: () => 1, ended });
    expect([outcome.output.length, outcome.truncated, outcome.exitCode]).toEqual([MAX_OUTPUT, true, 1]);
    const dropped = new Tail(3);
    dropped.push('abcd');
    expect(outcomeOf(dropped, { shell: undefined, finished: true, exitCode: () => 0, ended })).toEqual({
      output: 'bcd',
      truncated: true,
      exitCode: 0,
    });
  });

  it('says a command is still running, and reads its exit code once it ends', async () => {
    const exit: { code: number | undefined } = { code: undefined };
    const ends = Promise.withResolvers<void>();
    const running = outcomeOf(tail('serving'), { shell: undefined, finished: false, exitCode: () => exit.code, ended: ends.promise });
    expect(running).toMatchObject({ output: 'serving', running: true });
    expect(running.exitCode).toBeUndefined();
    exit.code = 143;
    ends.resolve();
    expect(await running.exited).toBe(143);
  });
});
