// The arithmetic behind follow mode and own-edit matching in editor.ts, without VS Code, so it can
// be tested on its own (#7). Lines count from 0, as VS Code's do.

import type { Change } from '@ai-pair/core';

/** A run of visible lines, `start` through `end`: a visible range, by its lines. */
export interface Lines {
  start: number;
  end: number;
}

/**
 * Returns where `line` is in the view: how many visible lines are above it, negative above the view,
 * and as many as there are visible lines, or more, below it. Folded lines don't count.
 */
export function row(ranges: readonly Lines[], line: number): number {
  const first = ranges[0];
  const last = ranges.at(-1);
  if (first === undefined || last === undefined) throw new Error('row needs at least one visible range.');
  if (line < first.start) return line - first.start;
  let above = 0;
  for (const r of ranges) {
    if (line <= r.end) return above + Math.max(0, line - r.start);
    above += r.end - r.start + 1;
  }
  return above + line - last.end - 1;
}

/** The share of the view at its top and bottom that is not comfortable to read at. */
// oxlint-disable-next-line eslint/no-magic-numbers -- a share of the view, written as the fraction it is
const EDGE = 1 / 4;
/** Where a landing puts the target line: this far down the view. */
// oxlint-disable-next-line eslint/no-magic-numbers -- a share of the view, written as the fraction it is
const LANDING = 1 / 3;
/** The glide's ease-out: a higher power settles sooner. */
const EASE = 3;

/** Returns whether a target `at` rows down a view of `height` is out of its top and bottom quarters. */
export function comfortable(at: number, height: number): boolean {
  return at >= height * EDGE && at < height * (1 - EDGE);
}

/**
 * Returns the top line of the view that has `line` a third of the way down, as far as the editor can
 * scroll: to the last line at the top, if it scrolls beyond the end, else to the last line at the bottom.
 */
export function landing(line: number, height: number, lineCount: number, beyondEnd: boolean): number {
  const last = lineCount - 1;
  const max = beyondEnd ? last : Math.max(0, last + 1 - height);
  return Math.max(0, Math.min(max, line - Math.floor(height * LANDING)));
}

/**
 * Returns the editor's view: its top line, how many lines it shows, whether it reaches the document's
 * end, and how many lines its viewport fits, if known. At the end the visible ranges stop at the last
 * line, short of the viewport's bottom, so there the height is `known`, the one last seen; elsewhere
 * it's what shows, to be remembered as `known` from then on.
 */
export function viewport(
  ranges: readonly Lines[],
  lineCount: number,
  known: number | undefined,
): { top: number; rows: number; atEnd: boolean; height?: number } | undefined {
  const first = ranges[0];
  const last = ranges.at(-1);
  if (first === undefined || last === undefined) return undefined;
  const rows = ranges.reduce((n, r) => n + r.end - r.start + 1, 0);
  const atEnd = last.end >= lineCount - 1;
  const height = !atEnd ? rows : known === undefined ? undefined : Math.max(rows, known);
  return { top: first.start, rows, atEnd, height };
}

/** Returns the top line `t` of the way through a glide from `from` to `to`, easing out. */
export function glideTop(from: number, to: number, t: number): number {
  return Math.round(from + (to - from) * (1 - (1 - t) ** EASE));
}

/** Returns whether a document's changes are exactly our oldest pending edit to it: one change, the same one. */
export function isOwnEdit(changes: readonly Change[], own: Change | undefined): boolean {
  const change = changes[0];
  return (
    own !== undefined &&
    change !== undefined &&
    changes.length === 1 &&
    change.offset === own.offset &&
    change.deleteLength === own.deleteLength &&
    change.text === own.text
  );
}
