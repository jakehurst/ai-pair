// applyChange over every small text and change: the same properties specs/LineIdentity.tla checks
// on its model, here on the code itself. And IdsDistinct from specs/Rehearsal.tla, for the editor's
// LineIds and a fork of it.

import { expect, it } from 'vitest';
import { applyChange, LineIds } from '../src/lines';

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
