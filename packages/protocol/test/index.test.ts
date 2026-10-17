// moveProblem and spanProblem over every place specs/ActionValidation.tla checks: each kind of value the spec
// names gets a concrete one, and every place built from them holds the spec's ASSUMEs on the code.

import { describe, expect, it } from 'vitest';
import { CURSOR_MARKER, moveProblem, spanProblem } from '@ai-pair/protocol';

/** A spot: one marker, with text around it. */
const SPOT = `x${CURSOR_MARKER}`;

/** Code a span can name. */
const CODE = 'x';

/** A `line` of each kind in the spec: left out, a line number, 0, a fraction, a text. */
const LINES = [undefined, 3, 0, 1.5, '3'];

/** An `at` of each kind: left out, a spot, no marker, two markers, the marker alone, a number. */
const ATS = [undefined, SPOT, 'x', `x${CURSOR_MARKER}y${CURSOR_MARKER}`, CURSOR_MARKER, 5];

/** A `to` of each kind: left out, `line_end`, another text. */
const TOS = [undefined, 'line_end', 'end'];

/** A span's `text`, `from`, or `through` of each kind: left out, code, the empty text, a number. */
const CODES = [undefined, CODE, '', 5];

/** Returns the place without the fields it leaves out, as an agent sends it. */
function sent(place: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(place).filter(([, value]) => value !== undefined));
}

/** Returns whether the checks accept the `line`: left out, or a line number from 1 (`LineOK` in the spec). */
function lineOK(line: unknown): boolean {
  return line === undefined || (typeof line === 'number' && Number.isInteger(line) && line >= 1);
}

describe('ActionValidation', () => {
  it('MoveExactly, NeverThrows: gives no problem exactly for a valid move, and a message for every other', () => {
    const moves = LINES.flatMap((line) =>
      ATS.flatMap((at) => TOS.flatMap((to) => [undefined, 'x'].map((before) => ({ line, at, to, before })))),
    );
    for (const { line, at, to, before } of moves) {
      const valid = before === undefined && lineOK(line) && ((at === SPOT && to === undefined) || (at === undefined && to === 'line_end'));
      const place = sent({ line, at, to, before });
      expect({ place, accepted: moveProblem(place) === undefined }).toEqual({ place, accepted: valid });
    }
  });

  it('SpanExactly, NeverThrows: gives no problem exactly for a valid span, and a message for every other', () => {
    const olds = [{}, { near_line: 3 }, { to: 'y' }];
    const spans = LINES.flatMap((line) =>
      CODES.flatMap((text) => CODES.flatMap((from) => CODES.flatMap((through) => olds.map((old) => ({ line, text, from, through, old }))))),
    );
    for (const { line, text, from, through, old } of spans) {
      const code =
        (text === CODE && from === undefined && through === undefined) || (text === undefined && from === CODE && through === CODE);
      const place = sent({ line, text, from, through, ...old });
      const valid = Object.keys(old).length === 0 && lineOK(line) && code;
      expect({ place, accepted: spanProblem(place) === undefined }).toEqual({ place, accepted: valid });
    }
  });
});
