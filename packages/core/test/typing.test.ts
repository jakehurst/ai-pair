// How typing is paced, and how long a message takes to read. typing.ts imports only types, so the test needs no mocks.

import { describe, expect, it } from 'vitest';
import { planTyping, readingTime } from '../src/typing';

describe('typing', () => {
  const cadence = { charMs: 100, jitter: 0, wordStartMs: 50, punctuationMs: 30, openBracketMs: 20, newlineMs: 250 };
  function delays(text: string, atLineStart = false): Array<[string, number]> {
    return planTyping(text, cadence, atLineStart, Math.random).map((c) => [c.text, c.delay]);
  }

  it('pauses as words start, and after punctuation and opening brackets', () => {
    expect(delays('ab c(d, e')).toEqual([
      ['a', 100],
      ['b', 100],
      [' ', 100],
      ['c', 150],
      ['(', 100],
      ['d', 170],
      [',', 100],
      [' ', 130],
      ['e', 150],
    ]);
  });

  it('inserts a newline together with the following indentation, then pauses', () => {
    expect(delays('x\n  y')).toEqual([
      ['x', 100],
      ['\n  ', 100],
      ['y', 400],
    ]);
  });

  it('inserts leading indentation at once at the start of a line', () => {
    expect(delays('  x', true).map(([t]) => t)).toEqual(['  ', 'x']);
    expect(delays('  x').map(([t]) => t)).toEqual([' ', ' ', 'x']);
  });

  it('starts a line with no indentation, and a newline with none after it, with the text itself', () => {
    expect(delays('x', true).map(([t]) => t)).toEqual(['x']);
    expect(delays('x\ny').map(([t]) => t)).toEqual(['x', '\n', 'y']);
  });

  it('scales every delay for type_fast', () => {
    expect(planTyping('a b', cadence, /* atLineStart= */ false, Math.random, /* scale= */ 0.5).map((c) => c.delay)).toEqual([50, 50, 75]);
  });

  it('scales reading time with the character count, above a floor', () => {
    const reading = { msPerChar: 10, minMs: 10 };
    expect(readingTime('', reading)).toBe(10);
    expect(readingTime('Hi.', reading)).toBe(30);
    expect(readingTime(Array.from({ length: 100 }, () => 'word').join(' '), reading)).toBe(4990);
    expect(readingTime('word\n\n  word', reading)).toBe(90);
  });
});
