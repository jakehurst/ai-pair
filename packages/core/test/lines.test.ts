// Line identities through edits: specs/LineIdentity.tla's rules case by case, then exhaustively, the properties the
// spec checks on its model over every small text and change, and IdsDistinct from specs/Rehearsal.tla for the
// editor's LineIds and a fork of it. lines.ts imports only a type, so the test needs no mocks.

import { describe, expect, it } from 'vitest';
import { applyChange, LineIds } from '../src/lines';
import type { Change } from '../src/ports';

/** Every case, on CI's slower runners alongside the other test files. */
const EXHAUSTIVE_MS = 30_000;

const CHARS = ['x', '\n', '\r'];

const FILE = 'a.ts';

/** Returns every text of up to `max` characters from `CHARS`. */
function texts(max: number): string[] {
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

/** Returns how many lines `t` has. */
function lineCount(t: string): number {
  return t.split('\n').length;
}

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

it(
  "OnePerLine, Distinct, Untouched, WithinALine, BreakAtEnd, BreakAtStart: gives each line of the result one identity, never one twice, and keeps the untouched lines'",
  () => {
    let cases = 0;
    for (const text of texts(5)) {
      const ids = Array.from({ length: lineCount(text) }, (_, i) => -(i + 1));
      for (let offset = 0; offset <= text.length; offset++) {
        for (let deleteLength = 0; offset + deleteLength <= text.length; deleteLength++) {
          for (const insert of texts(2)) {
            cases++;
            const after = applyChange({ text, ids }, { offset, deleteLength, text: insert });
            const at = `${JSON.stringify(text)} @${offset} -${deleteLength} +${JSON.stringify(insert)}`;
            expect(after.text, at).toBe(text.slice(0, offset) + insert + text.slice(offset + deleteLength));
            expect(after.ids.length, at).toBe(lineCount(after.text));
            expect(new Set(after.ids).size, at).toBe(after.ids.length);
            const startLine = text.slice(0, offset).split('\n').length - 1;
            const endLine = startLine + (text.slice(offset, offset + deleteLength).split('\n').length - 1);
            const shift = insert.split('\n').length - 1 - (endLine - startLine);
            for (let i = 0; i < startLine; i++) {
              expect(after.ids[i], at).toBe(ids[i]);
            }
            for (let i = endLine + 1; i < ids.length; i++) {
              expect(after.ids[i + shift], at).toBe(ids[i]);
            }
            if (startLine === endLine && !insert.includes('\n')) expect(after.ids, at).toEqual(ids);
            // A line break at the end of startLine line with text leaves it in place; at its start, it moves it down.
            if (deleteLength === 0 && insert === '\n') {
              const atEnd = offset > 0 && text[offset - 1] === 'x' && (offset === text.length || text[offset] === '\n');
              const atStart = (offset === 0 || text[offset - 1] === '\n') && text[offset] === 'x';
              if (atEnd) expect(after.ids[startLine], at).toBe(ids[startLine]);
              if (atStart) expect(after.ids[startLine + 1], at).toBe(ids[startLine]);
            }
          }
        }
      }
    }
    expect(cases).toBeGreaterThan(10_000);
  },
  EXHAUSTIVE_MS,
);

it(
  "IdsDistinct: never gives two lines one identity, in the editor's LineIds or a fork of it, through the same change to both",
  () => {
    let cases = 0;
    for (const text of texts(4)) {
      for (let offset = 0; offset <= text.length; offset++) {
        for (let deleteLength = 0; offset + deleteLength <= text.length; deleteLength++) {
          for (const insert of texts(2)) {
            cases++;
            const at = `${JSON.stringify(text)} @${offset} -${deleteLength} +${JSON.stringify(insert)}`;
            const editor = LineIds.editor();
            const before = new Set(editor.of(FILE, text));
            const fork = editor.fork();
            fork.of(FILE, text);
            const change = { offset, deleteLength, text: insert };
            fork.apply(FILE, change);
            editor.apply(FILE, change);
            const after = text.slice(0, offset) + insert + text.slice(offset + deleteLength);
            const editorIds = editor.of(FILE, after);
            const forkIds = fork.of(FILE, after);
            expect(new Set(editorIds).size, at).toBe(editorIds.length);
            expect(new Set(forkIds).size, at).toBe(forkIds.length);
            // The counter is shared, so a line the fork makes is never one of the editor's.
            for (const id of forkIds) {
              if (!before.has(id)) expect(editorIds, at).not.toContain(id);
            }
          }
        }
      }
    }
    expect(cases).toBeGreaterThan(1000);
  },
  EXHAUSTIVE_MS,
);
