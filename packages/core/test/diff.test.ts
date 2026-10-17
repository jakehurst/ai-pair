// The diffs edit events report, and lineChanges case by case and over every small text and change: the changes it
// splits a change into leave the same text, in the order they apply (#65). diff.ts computes with the `diff` library,
// which is pure, and imports only a type of ours, so the test needs no mocks.

import { describe, expect, it } from 'vitest';
import { boundedDiff, lineChanges, MAX_DIFF_LINES } from '../src/diff';
import type { Change } from '../src/ports';

/** Every case, on CI's slower runners alongside the other test files. */
const EXHAUSTIVE_MS = 30_000;

const CHARS = ['a', 'b', '\n'];

/** Returns every text of up to `max` characters from `CHARS`. */
function texts(max: number): string[] {
  const all = [''];
  for (let n = 1, layer = ['']; n <= max; n++) {
    layer = layer.flatMap((t) => CHARS.map((c) => t + c));
    all.push(...layer);
  }
  return all;
}

/** Returns `text` with the change applied. */
function apply(text: string, c: Change): string {
  return text.slice(0, c.offset) + c.text + text.slice(c.offset + c.deleteLength);
}

describe('diffs', () => {
  it("reports a diff over MAX_DIFF_LINES by its hunks' headers, with the count of lines left out (#149)", () => {
    expect(boundedDiff('a.ts', 'a\n', 'b\n')).toEqual({ diff: '@@ -1,1 +1,1 @@\n-a\n+b' });
    const long = Array.from({ length: MAX_DIFF_LINES }, (_, i) => `line ${i}\n`).join('');
    const bounded = boundedDiff('a.ts', '', long);
    expect(bounded.diff).toBe(`@@ -0,0 +1,${MAX_DIFF_LINES} @@`);
    expect(bounded.omitted).toBe(MAX_DIFF_LINES);
  });

  it('reports no diff for a file that did not change', () => {
    expect(boundedDiff('a.ts', 'a\n', 'a\n')).toEqual({ diff: '' });
  });
});

describe('lineChanges', () => {
  it('splits a change at the lines it leaves alone, so they keep their place (#65)', () => {
    // A reload that changed the first and last lines: the middle one is left out of both.
    expect(lineChanges('a\nb\nc\n', [{ offset: 0, deleteLength: 6, text: 'A\nb\nC\n' }])).toEqual([
      { offset: 0, deleteLength: 2, text: 'A\n' },
      { offset: 4, deleteLength: 2, text: 'C\n' },
    ]);
  });

  it('keeps a change of one run whole, with the unchanged lines around it left out, and gives none for no change', () => {
    expect(lineChanges('a\nb\n', [{ offset: 2, deleteLength: 0, text: 'x\n' }])).toEqual([{ offset: 2, deleteLength: 0, text: 'x\n' }]);
    expect(lineChanges('a\nb\n', [{ offset: 0, deleteLength: 4, text: 'A\nb\n' }])).toEqual([{ offset: 0, deleteLength: 2, text: 'A\n' }]);
    expect(lineChanges('a\nb\n', [{ offset: 0, deleteLength: 4, text: 'a\nB\n' }])).toEqual([{ offset: 2, deleteLength: 2, text: 'B\n' }]);
    expect(lineChanges('a\nb\n', [])).toEqual([]);
  });

  it('applies each change to the text the one before it left', () => {
    const changes = [
      { offset: 0, deleteLength: 2, text: '' },
      { offset: 0, deleteLength: 0, text: 'z\n' },
    ];
    expect(lineChanges('a\nb\n', changes)).toEqual(changes);
  });
});

describe('lineChanges, over every small text', () => {
  it(
    'leaves the same text as the change it splits',
    () => {
      const inserts = texts(3);
      let cases = 0;
      for (const before of texts(4)) {
        for (let offset = 0; offset <= before.length; offset++) {
          for (let deleteLength = 0; offset + deleteLength <= before.length; deleteLength++) {
            for (const text of inserts) {
              const change = { offset, deleteLength, text };
              const split = lineChanges(before, [change]);
              expect(split.reduce((result, c) => apply(result, c), before)).toBe(apply(before, change));
              // Each one changes something.
              for (const c of split) {
                expect(c.deleteLength > 0 || c.text !== '').toBe(true);
              }
              cases++;
            }
          }
        }
      }
      expect(cases).toBeGreaterThan(50_000);
    },
    EXHAUSTIVE_MS,
  );

  it('splits a reload into one change per run of changed lines', () => {
    expect(lineChanges('1\n2\n3\n4\n5\n6\n', [{ offset: 2, deleteLength: 8, text: 'X\n3\n4\nY\n' }])).toEqual([
      { offset: 2, deleteLength: 2, text: 'X\n' },
      { offset: 8, deleteLength: 2, text: 'Y\n' },
    ]);
  });

  it('applies several changes in order, each to the result of the one before', () => {
    const before = 'a\nb\nc\n';
    const changes = [
      { offset: 4, deleteLength: 2, text: 'C\n' },
      { offset: 0, deleteLength: 2, text: 'A\n' },
    ];
    expect(lineChanges(before, changes).reduce((result, c) => apply(result, c), before)).toBe(
      changes.reduce((result, c) => apply(result, c), before),
    );
  });
});
