import { createPatch, diffLines } from 'diff';
import type { Change } from './ports';

/** A diff longer than this many lines is reported by its hunks' headers alone: the agent reads the file (#149). */
export const MAX_DIFF_LINES = 200;

/** Returns a unified diff of the change, hunks only (the file is named in the event). */
function fileDiff(file: string, before: string, after: string): string {
  const patch = createPatch(file, before, after, /* oldHeader= */ undefined, /* newHeader= */ undefined, { context: 2 });
  const firstHunk = patch.indexOf('\n@@');
  return firstHunk === -1 ? '' : patch.slice(firstHunk + 1).trimEnd();
}

/** Returns `fileDiff`, bounded: over MAX_DIFF_LINES, only its hunks' headers, and how many lines were left out. */
export function boundedDiff(file: string, before: string, after: string): { diff: string; omitted?: number } {
  const diff = fileDiff(file, before, after);
  const lines = diff.split('\n');
  if (lines.length <= MAX_DIFF_LINES) return { diff };
  const headers = lines.filter((line) => line.startsWith('@@'));
  return { diff: headers.join('\n'), omitted: lines.length - headers.length };
}

/**
 * Splits each change into one per run of changed lines, leaving the same text. VS Code reloads a
 * file changed on disk with one change from the first line that differs to the last, so the
 * unchanged lines between them would lose their identities, and positions on them would move (#65).
 * `changes` apply in order, each to the result of the previous, and so do the ones returned. specs/Reload.tla,
 * `Runs`.
 */
export function lineChanges(before: string, changes: Change[]): Change[] {
  const split: Change[] = [];
  let text = before;
  for (const change of changes) {
    const removed = text.slice(change.offset, change.offset + change.deleteLength);
    // Left to right, each at its offset in the text the ones before it leave.
    let at = change.offset;
    let hunk: Change | undefined;
    for (const part of diffLines(removed, change.text)) {
      if (!part.added && !part.removed) {
        if (hunk) split.push(hunk);
        hunk = undefined;
        at += part.value.length;
        continue;
      }
      hunk ??= { offset: at, deleteLength: 0, text: '' };
      if (part.removed) {
        hunk.deleteLength += part.value.length;
      } else {
        hunk.text += part.value;
        at += part.value.length;
      }
    }
    if (hunk) split.push(hunk);
    text = text.slice(0, change.offset) + change.text + text.slice(change.offset + change.deleteLength);
  }
  return split;
}
