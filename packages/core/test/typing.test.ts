// How typing is paced, and how long a message takes to read; and planTyping over every small text, the properties
// specs/Typing.tla checks on its model. typing.ts imports only types, so the test needs no mocks.

import { describe, expect, it } from 'vitest';
import { planTyping, readingTime } from '../src/typing';

/** A typing pace with no jitter, so each pause is the same every run. */
const CADENCE = { charMs: 100, jitter: 0, wordStartMs: 50, punctuationMs: 30, openBracketMs: 20, newlineMs: 250 };

/** Every case, on CI's slower runners alongside the other test files. */
const EXHAUSTIVE_MS = 30_000;

const CHARS = ['x', ' ', '\t', '\n', '('];

/** Returns each chunk planTyping makes of `text` at CADENCE, with its delay. */
function delays(text: string, atLineStart = false): Array<[string, number]> {
  return planTyping(text, CADENCE, atLineStart, Math.random).map((c) => [c.text, c.delay]);
}

describe('typing', () => {
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
    expect(planTyping('a b', CADENCE, /* atLineStart= */ false, Math.random, /* scale= */ 0.5).map((c) => c.delay)).toEqual([50, 50, 75]);
  });

  it('scales reading time with the character count, above a floor', () => {
    const reading = { msPerChar: 10, minMs: 10 };
    expect(readingTime('', reading)).toBe(10);
    expect(readingTime('Hi.', reading)).toBe(30);
    expect(readingTime(Array.from({ length: 100 }, () => 'word').join(' '), reading)).toBe(4990);
    expect(readingTime('word\n\n  word', reading)).toBe(90);
  });
});

it(
  'ConcatenatesToText, ChunksAreUnits: splits text into chunks that concatenate to it, each one character or a line break with its indentation',
  () => {
    let texts = [''];
    for (let n = 1; n <= 5; n++) {
      texts = [...texts, ...texts.filter((t) => t.length === n - 1).flatMap((t) => CHARS.map((c) => t + c))];
    }
    for (const text of texts) {
      for (const atLineStart of [false, true]) {
        const chunks = planTyping(text, CADENCE, atLineStart, () => 0.5);
        const at = `${JSON.stringify(text)} at line start: ${atLineStart}`;
        expect(chunks.map((c) => c.text).join(''), at).toBe(text);
        chunks.forEach((c, i) => {
          const unit = c.text.length === 1 && c.text !== '\n';
          const lineBreak = /^\n[ \t]*$/.test(c.text);
          const leading = i === 0 && atLineStart && /^[ \t]+$/.test(c.text);
          expect(unit || lineBreak || leading, `${at}: chunk ${i} ${JSON.stringify(c.text)}`).toBe(true);
          expect(c.delay, at).toBeGreaterThanOrEqual(0);
        });
      }
    }
  },
  EXHAUSTIVE_MS,
);
