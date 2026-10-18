// Finding a spot or a span on its line: specs/Places.tla case by case, then exhaustively, the properties the spec
// checks on its model over every small text; and at scale, a short needle on every line of a long file (#2).
// Solitary: text.ts is a fake, a plain reading of a text's lines, so a test sees what places.ts makes of them.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CURSOR_MARKER } from '@ai-pair/protocol';
import { resolveSpan, resolveSpot, spanCandidates, spotCandidates } from '../src/places';
import { lineSpan, lineText, position } from '../src/text';

/** The text every test resolves in: three lines, and the empty one after the last newline. */
const TEXT = 'a = 1\nb = 1\nc = 1\n';

/** Every exhaustive case, on CI's slower runners alongside the other test files. */
const EXHAUSTIVE_MS = 30_000;

/** The characters the exhaustive cases build their texts from. */
const CHARS = ['x', 'y', '\n'];

/** How many lines the long file has, each a match for the short needles. */
const LONG_LINES = 20_000;

/** The long file. */
const LONG_TEXT = '  foo(bar(baz(1), 2), 3);\n'.repeat(LONG_LINES);

vi.mock('../src/text', () => ({ lineSpan: vi.fn(), lineText: vi.fn(), position: vi.fn() }));

/** Returns each line of `text` with its offsets, its newline left out: text.ts's reading of a text, written plainly. */
function linesOf(text: string): Array<{ text: string; start: number; end: number }> {
  const lines: Array<{ text: string; start: number; end: number }> = [];
  let start = 0;
  for (const line of text.split('\n')) {
    lines.push({ text: line, start, end: start + line.length });
    start += line.length + 1;
  }
  return lines;
}

/** Returns the line (from 1) and column (from 1) of `offset`: the line it is on, its newline being the line's end. */
function fakePosition(text: string, offset: number): { line: number; column: number } {
  const lines = linesOf(text);
  const index = lines.findIndex((line) => offset >= line.start && offset <= line.end);
  const found = lines[index];
  return found === undefined ? { line: 0, column: 0 } : { line: index + 1, column: offset - found.start + 1 };
}

/** Returns every string of up to `max` characters from `CHARS`. */
function strings(max: number): string[] {
  const all = [''];
  for (let n = 1; n <= max; n++) {
    for (const t of all.filter((s) => s.length === n - 1)) {
      for (const c of CHARS) {
        all.push(t + c);
      }
    }
  }
  return all;
}

/** Returns the offsets where `needle` starts in `text`. */
function starts(text: string, needle: string): number[] {
  const out: number[] = [];
  if (needle === '') {
    return out;
  }
  for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + 1)) {
    out.push(i);
  }
  return out;
}

beforeEach(() => {
  vi.mocked(lineSpan).mockImplementation((text, line) => {
    const found = linesOf(text)[line - 1];
    return found === undefined ? { start: text.length, end: text.length } : { start: found.start, end: found.end };
  });
  vi.mocked(lineText).mockImplementation((text, line) => linesOf(text)[line - 1]?.text ?? '');
  vi.mocked(position).mockImplementation(fakePosition);
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

  it('finds nothing after `from` for a `through` that is only the cursor marker', () => {
    expect(resolveSpan(TEXT, { line: 2, from: 'b', through: CURSOR_MARKER })).toEqual({
      ok: false,
      kind: 'not_found',
      message: 'Text not found after `from`: ""',
    });
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

describe('over every small text', () => {
  it(
    'SpotOK, SpotOnlyWhenUnique: resolves a spot only when one match has its marker on the line, and puts it there',
    () => {
      for (const text of strings(5)) {
        for (const before of strings(3)) {
          for (const after of strings(3 - before.length)) {
            const marks = starts(text, before + after).map((s) => s + before.length);
            for (let line = 1; line <= linesOf(text).length; line++) {
              const r = resolveSpot(text, { at: before + CURSOR_MARKER + after, line });
              const here = marks.filter((o) => fakePosition(text, o).line === line);
              const at = `${JSON.stringify(text)} ${JSON.stringify(before + CURSOR_MARKER + after)} line ${line}`;
              expect(r.ok, at).toBe(here.length === 1);
              if (r.ok) {
                expect(r.range.start, at).toBe(here[0]);
                expect(text.slice(r.range.start - before.length, r.range.start + after.length), at).toBe(before + after);
              }
            }
          }
        }
      }
    },
    EXHAUSTIVE_MS,
  );

  it(
    'SpanOK, RangeOK: resolves a span only when its text starts once on the line, and a range to the first `through` after it',
    () => {
      for (const text of strings(5)) {
        for (const find of strings(3)) {
          const found = starts(text, find);
          for (let line = 1; line <= linesOf(text).length + 1; line++) {
            const here = found.filter((o) => fakePosition(text, o).line === line);
            const resolved = resolveSpan(text, { line, text: find });
            const at = `${JSON.stringify(text)} ${JSON.stringify(find)} line ${line}`;
            expect(resolved.ok, at).toBe(here.length === 1);
            if (resolved.ok) {
              const [first] = here;
              if (first === undefined) {
                throw new Error(`No match on the line: ${at}`);
              }
              expect(resolved.range, at).toEqual({ start: first, end: first + find.length });
            }
            for (const through of strings(2)) {
              const range = resolveSpan(text, { line, from: find, through });
              if (!range.ok) {
                continue;
              }
              const [s] = here;
              if (s === undefined) {
                throw new Error(`No match on the line: ${at}`);
              }
              const e = range.range.end - through.length;
              expect(range.range.start, at).toBe(s);
              expect(through === '' ? -1 : text.indexOf(through, s + find.length), `${at} through ${JSON.stringify(through)}`).toBe(e);
            }
          }
        }
      }
    },
    EXHAUSTIVE_MS,
  );
});

describe('at scale', () => {
  it('resolves a span and a spot on the last line of a long file at once, though every line matches (#2)', () => {
    // The fake reads the text plainly; this test measures places.ts's own work, so text.ts answers from a table.
    const lines = linesOf(LONG_TEXT);
    vi.mocked(lineSpan).mockImplementation((_, line) => lines[line - 1] ?? { start: LONG_TEXT.length, end: LONG_TEXT.length });
    vi.mocked(lineText).mockImplementation((_, line) => lines[line - 1]?.text ?? '');
    const lineLength = (lines[0]?.text.length ?? 0) + 1;
    vi.mocked(position).mockImplementation((_, offset) => ({
      line: Math.floor(offset / lineLength) + 1,
      column: (offset % lineLength) + 1,
    }));
    const started = performance.now();
    expect(resolveSpan(LONG_TEXT, { line: LONG_LINES, text: 'foo(' })).toMatchObject({ ok: true });
    expect(resolveSpot(LONG_TEXT, { line: LONG_LINES, at: `3);${CURSOR_MARKER}` })).toMatchObject({ ok: true });
    expect(resolveSpan(LONG_TEXT, { line: LONG_LINES, text: ')' })).toMatchObject({ ok: false, kind: 'ambiguous' });
    // Before #2's fix, one of these took 5.5 s at this size; after it, a few milliseconds.
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
