// The diffs edit events report. diff.ts computes with the `diff` library, which is pure, and imports only a type of
// ours, so the test needs no mocks.

import { describe, expect, it } from 'vitest';
import { boundedDiff, lineChanges, MAX_DIFF_LINES } from '../src/diff';

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
