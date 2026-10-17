// Finding a spot or a span on its line (specs/Places.tla, case by case; the exhaustive check is
// places.exhaustive.test.ts). Solitary: text.ts is a mock that answers for the one text the tests use, so a test sees
// what places.ts makes of the lines it is told about.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CURSOR_MARKER } from '@ai-pair/protocol';
import { resolveSpan, resolveSpot, spanCandidates, spotCandidates } from '../src/places';
import { lineSpan, lineText, position } from '../src/text';

/** The text every test resolves in: three lines, and the empty one after the last newline. */
const TEXT = 'a = 1\nb = 1\nc = 1\n';

/** Each line of TEXT by its number: its text, and its offsets, through its newline, as text.ts gives them. */
const LINES = new Map([
  [1, { text: 'a = 1', start: 0, end: 5 }],
  [2, { text: 'b = 1', start: 6, end: 11 }],
  [3, { text: 'c = 1', start: 12, end: 17 }],
  [4, { text: '', start: 18, end: 18 }],
]);

vi.mock('../src/text', () => ({ lineSpan: vi.fn(), lineText: vi.fn(), position: vi.fn() }));

beforeEach(() => {
  // Each mock answers from LINES, for TEXT only: places.ts must pass on the text it was given.
  vi.mocked(lineSpan).mockImplementation((text, line) => {
    expect(text).toBe(TEXT);
    const found = LINES.get(line);
    return found && { start: found.start, end: found.end };
  });
  vi.mocked(lineText).mockImplementation((text, line) => {
    expect(text).toBe(TEXT);
    return LINES.get(line)?.text ?? '';
  });
  vi.mocked(position).mockImplementation((text, offset) => {
    expect(text).toBe(TEXT);
    const [line, found] = [...LINES].find(([, l]) => offset >= l.start && offset <= l.end) ?? [];
    return { line: line ?? 0, column: found ? offset - found.start + 1 : 0 };
  });
});

afterEach(() => {
  vi.resetAllMocks();
});

describe('resolveSpan', () => {
  it("finds a span's text on its line, and lists where else it is", () => {
    expect(resolveSpan(TEXT, { line: 2, text: 'b = ' })).toEqual({ ok: true, range: { start: 6, end: 10 } });
    // Only on its line: elsewhere, it's listed.
    expect(resolveSpan(TEXT, { line: 2, text: '1' })).toEqual({ ok: true, range: { start: 10, end: 11 } });
    expect(resolveSpan(TEXT, { line: 1, text: 'c = 1' })).toEqual({
      ok: false,
      kind: 'not_found',
      message: 'The text isn\'t on line 1: line 1 reads "a = 1". It\'s on these lines:',
      candidates: [{ line: 3, context: 'c = 1' }],
    });
    expect(resolveSpan(TEXT, { line: 1, text: 'd' })).toEqual({
      ok: false,
      kind: 'not_found',
      message: 'Text not found: "d"; line 1 reads "a = 1"',
    });
    const twice = resolveSpan(TEXT, { line: 1, text: ' ' });
    expect(twice).toMatchObject({ ok: false, kind: 'ambiguous' });
    expect(twice.ok ? '' : twice.message).toMatch(/occurs 2 times on line 1/);
  });

  it('finds nothing on a line the text does not have, and lists where the text is', () => {
    expect(resolveSpan(TEXT, { line: 9, text: 'a' })).toEqual({
      ok: false,
      kind: 'not_found',
      message: 'The text isn\'t on line 9: line 9 reads "". It\'s on these lines:',
      candidates: [{ line: 1, context: 'a = 1' }],
    });
  });

  it("takes a span's text starting on its line, which may go on past it", () => {
    expect(resolveSpan(TEXT, { line: 1, text: '1\nb' })).toEqual({ ok: true, range: { start: 4, end: 7 } });
  });

  it('resolves a range through the first `through` after `from`', () => {
    expect(resolveSpan(TEXT, { line: 2, from: 'b', through: '1' })).toEqual({ ok: true, range: { start: 6, end: 11 } });
    expect(resolveSpan(TEXT, { line: 1, from: 'a', through: 'c = ' })).toEqual({ ok: true, range: { start: 0, end: 16 } });
    expect(resolveSpan(TEXT, { line: 3, from: 'c', through: 'b' })).toEqual({
      ok: false,
      kind: 'not_found',
      message: 'Text not found after `from`: "b"',
    });
  });

  it('ignores the cursor marker in a span, so code can be copied from a report', () => {
    expect(resolveSpan(TEXT, { line: 2, text: `b =${CURSOR_MARKER} 1` })).toEqual({ ok: true, range: { start: 6, end: 11 } });
  });

  it('finds nothing in a span with only `from`, or with neither `from` nor `text`', () => {
    expect(resolveSpan(TEXT, { line: 2, from: 'b' })).toEqual({ ok: false, kind: 'not_found', message: 'Text not found after `from`: ""' });
    expect(resolveSpan(TEXT, { line: 1 })).toEqual({ ok: false, kind: 'not_found', message: 'Text not found: ""; line 1 reads "a = 1"' });
  });
});

describe('resolveSpot', () => {
  it('resolves a spot between two texts that occur together, on its line only', () => {
    expect(resolveSpot(TEXT, { at: `b = ${CURSOR_MARKER}1`, line: 2 })).toEqual({ ok: true, range: { start: 10, end: 10 } });
    expect(resolveSpot(TEXT, { at: `${CURSOR_MARKER}c`, line: 3 })).toEqual({ ok: true, range: { start: 12, end: 12 } });
    expect(resolveSpot(TEXT, { at: ` = ${CURSOR_MARKER}1`, line: 2 })).toEqual({ ok: true, range: { start: 10, end: 10 } });
    expect(resolveSpot(TEXT, { at: `b${CURSOR_MARKER} = `, line: 3 })).toEqual({
      ok: false,
      kind: 'not_found',
      message: 'The spot isn\'t on line 3: line 3 reads "c = 1". It\'s on these lines:',
      candidates: [{ line: 2, context: 'b = 1' }],
    });
    // The line is the one the spot is on, after a `before` that ends with a newline.
    expect(resolveSpot(TEXT, { at: `b = 1\n${CURSOR_MARKER}`, line: 3 })).toEqual({ ok: true, range: { start: 12, end: 12 } });
  });
});

describe('candidates', () => {
  it('lists the lines a spot is on, and the lines a span starts on, without its marker', () => {
    expect(spotCandidates(TEXT, `${CURSOR_MARKER} = 1`)).toEqual([
      { line: 1, context: 'a = 1' },
      { line: 2, context: 'b = 1' },
      { line: 3, context: 'c = 1' },
    ]);
    expect(spanCandidates(TEXT, `b${CURSOR_MARKER} =`)).toEqual([{ line: 2, context: 'b = 1' }]);
  });
});
