// Line identities through edits (specs/LineIdentity.tla's rules, case by case; the exhaustive check is
// lines.exhaustive.test.ts). lines.ts imports only a type, so the test needs no mocks.

import { describe, expect, it } from 'vitest';
import { applyChange, LineIds } from '../src/lines';
import type { Change } from '../src/ports';

/** Returns which line of `text` (from 1) each line is after the change, or 0 for a new one. */
function follow(text: string, { offset, deleteLength, text: insert }: Change): number[] {
  const ids = text.split('\n').map((_, i) => -(i + 1));
  const after = applyChange({ text, ids }, { offset, deleteLength, text: insert });
  expect(after.text).toBe(text.slice(0, offset) + insert + text.slice(offset + deleteLength));
  return after.ids.map((id) => (id < 0 ? -id : 0));
}

describe('line identities', () => {
  it('keeps every line in place for a change within a line', () => {
    expect(follow('a\nb\n', { offset: 1, deleteLength: 0, text: 'x' })).toEqual([1, 2, 3]);
    expect(follow('a\n\nb', { offset: 2, deleteLength: 0, text: 'x' })).toEqual([1, 2, 3]);
  });

  it('keeps a line in place when a line break is typed after it, and moves it down when one is typed before it', () => {
    expect(follow('a\nb\n', { offset: 1, deleteLength: 0, text: '\nx' })).toEqual([1, 0, 2, 3]);
    expect(follow('a\nb\n', { offset: 2, deleteLength: 0, text: 'x\n' })).toEqual([1, 0, 2, 3]);
    expect(follow('a\r\nb\r\n', { offset: 1, deleteLength: 0, text: '\r\nx' })).toEqual([1, 0, 2, 3]);
    expect(follow('a\r\nb\r\n', { offset: 3, deleteLength: 0, text: 'x\r\n' })).toEqual([1, 0, 2, 3]);
  });

  it('keeps the place of a line whose text is all replaced', () => {
    expect(follow('a\nbb\nc', { offset: 2, deleteLength: 2, text: 'x' })).toEqual([1, 2, 3]);
    expect(follow('a\nbb\nc', { offset: 2, deleteLength: 2, text: 'x\ny' })).toEqual([1, 2, 0, 3]);
  });

  it('follows the text of lines joined or deleted', () => {
    // A whole line, with its line break.
    expect(follow('a\nb\nc', { offset: 2, deleteLength: 2, text: '' })).toEqual([1, 3]);
    // The line break before a line, with the line.
    expect(follow('a\nb\nc', { offset: 1, deleteLength: 2, text: '' })).toEqual([1, 3]);
    // Two lines joined: the first one's text is where it was.
    expect(follow('ab\ncd', { offset: 1, deleteLength: 3, text: '' })).toEqual([1]);
    // From a line's start into the next: what's left is the next one's.
    expect(follow('ab\ncd\ne', { offset: 0, deleteLength: 4, text: '' })).toEqual([2, 3]);
  });

  it("OnePerLine: adopts a fork's identities only for a file that reads as it did in the fork (specs/Rehearsal.tla, #151)", () => {
    const editor = LineIds.editor();
    const before = editor.of('a.ts', 'hello\nworld\n');
    const fork = editor.fork();
    fork.of('a.ts', 'hello\nworld\n');
    const typed = { offset: 5, deleteLength: 0, text: 'abc' };
    fork.apply('a.ts', typed);
    editor.apply('a.ts', typed);
    // A formatter rewrites the second line while the batch plays.
    editor.apply('a.ts', { offset: 9, deleteLength: 5, text: 'WORLD' });
    editor.adopt(fork);
    expect(editor.of('a.ts', 'helloabc\nWORLD\n')).toEqual(before);
  });

  it('does not start tracking a file when a change to it is applied', () => {
    const editor = LineIds.editor();
    editor.apply('a.ts', { offset: 0, deleteLength: 0, text: 'x' });
    expect(editor.of('a.ts', 'x\ny')).toHaveLength(2);
  });

  it('refuses a version with fewer identities than its text has lines', () => {
    expect(() => applyChange({ text: 'a\nb', ids: [1] }, { offset: 2, deleteLength: 0, text: '\nx' })).toThrow(
      'Line 2 has no identity: the text has 1 lines.',
    );
  });

  it("forks a fork from the copy's own identities, and reads the editor's again for a file a copy forgets", () => {
    const editor = LineIds.editor();
    const ids = editor.of('a.ts', 'a\nb');
    const fork = editor.fork();
    expect(fork.of('a.ts', 'a\nb')).toEqual(ids);
    fork.apply('a.ts', { offset: 0, deleteLength: 0, text: 'x\n' });
    const forked = fork.of('a.ts', 'x\na\nb');
    expect(forked.slice(1)).toEqual(ids);
    expect(fork.fork().of('a.ts', 'x\na\nb')).toEqual(forked);
    fork.forget('a.ts');
    expect(fork.of('a.ts', 'a\nb')).toEqual(ids);
  });

  it("adopts a fork's identities for a file that reads as it did in the fork", () => {
    const editor = LineIds.editor();
    editor.of('a.ts', 'a');
    const fork = editor.fork();
    fork.of('a.ts', 'a');
    const typed = { offset: 1, deleteLength: 0, text: '\nb' };
    fork.apply('a.ts', typed);
    editor.apply('a.ts', typed);
    const played = fork.of('a.ts', 'a\nb');
    expect(editor.of('a.ts', 'a\nb')).not.toEqual(played);
    editor.adopt(fork);
    expect(editor.of('a.ts', 'a\nb')).toEqual(played);
  });

  it('adopts nothing for a file it has never tracked', () => {
    const editor = LineIds.editor();
    const stranger = LineIds.editor().fork();
    const theirs = stranger.of('b.ts', 'z');
    editor.adopt(stranger);
    expect(editor.of('b.ts', 'z')).not.toEqual(theirs);
  });
});
