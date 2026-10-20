// Types of the agent-facing protocol. See PROTOCOL.md.

import type { MoveTarget, SpanFields, ToolErrorCode } from './schemas';

/**
 * Marks the agent cursor: in a report's code, where a spot puts it, and where a `type` leaves it.
 * Spans ignore it, so code can be copied from a report as is.
 */
export const CURSOR_MARKER = '\u{258C}';

/** The keys that name an action. An action object has exactly one of them. */
export const ACTION_KINDS = ['say', 'move', 'select', 'type', 'type_fast', 'delete', 'point', 'run'] as const;

/** The fields a `move` takes. */
const MOVE_FIELDS = ['file', 'line', 'at', 'to'];

/** The fields a `select` or `point` takes. */
const SPAN_FIELDS = ['file', 'line', 'text', 'from', 'through'];

/** An object as it arrived, before its schema checked it: each field of `T` may be there, with any value. */
export type Unchecked<T> = { [K in keyof T]?: unknown };

/** Returns the fields as a comma-separated list of code spans. */
function fieldList(fields: string[]): string {
  return fields.map((f) => `\`${f}\``).join(', ');
}

/** Returns what's wrong with a place's `line`, if anything (specs/ActionValidation.tla, `LineOK`). */
function lineProblem(line: unknown): string | undefined {
  if (line === undefined || (typeof line === 'number' && Number.isInteger(line) && line >= 1)) return undefined;
  return "`line` is a line number, from 1, exactly as your latest `read` or report shows it. Omit it for your cursor's line.";
}

/** Returns how many cursor markers the text has. */
function markerCount(text: string): number {
  return text.split(CURSOR_MARKER).length - 1;
}

/**
 * Returns what's wrong with a spot's `at`, if anything: it needs exactly one cursor marker, and text around it
 * (specs/ActionValidation.tla, `SpotProblem`).
 */
function spotProblem(at: string): string | undefined {
  const markers = markerCount(at);
  if (markers === 0) {
    return `\`at\` marks where your cursor goes with ${CURSOR_MARKER}, e.g. \`at: "import { ${CURSOR_MARKER}type Context"\`.`;
  }
  if (markers > 1) {
    return `\`at\` has ${markers} ${CURSOR_MARKER}, but marks one spot: only where your cursor goes. Text copied from a report may carry the cursor's old ${CURSOR_MARKER}; leave that one out.`;
  }
  if (at === CURSOR_MARKER) return `\`at\` needs text around ${CURSOR_MARKER}, to find the spot by.`;
  return undefined;
}

/** Returns what's wrong with a `move`'s combination of fields, if anything (specs/ActionValidation.tla, `MoveProblem`). */
export function moveProblem(target: Unchecked<MoveTarget>): string | undefined {
  if ('before' in target || 'after' in target) {
    return `A spot is one text, \`at\`: the text around it, with ${CURSOR_MARKER} where your cursor goes, e.g. \`at: "import { ${CURSOR_MARKER}type Context"\`.`;
  }
  const line = lineProblem(target.line);
  if (line !== undefined) return line;
  if (target.to !== undefined && target.to !== 'line_end') return '`to` is `"line_end"`: the end of the line.';
  if (target.at !== undefined && target.to !== undefined) return 'Give one place on the line: `at`, or `to: "line_end"`, not both.';
  if (target.at === undefined && target.to === undefined) return 'Give the place on the line: `at`, or `to: "line_end"`.';
  // specs/ActionValidation.tla, `CheckAtText`: an `at` that isn't a text gets a message; `spotProblem` would throw on it.
  if (target.at !== undefined) {
    return typeof target.at === 'string' ? spotProblem(target.at) : `\`at\` is a text, with ${CURSOR_MARKER} where your cursor goes.`;
  }
  return undefined;
}

/** Returns what's wrong with a `select`'s or `point`'s combination of fields, if anything (specs/ActionValidation.tla, `SpanProblem`). */
export function spanProblem(span: Unchecked<SpanFields>): string | undefined {
  if ('near_line' in span) return 'Give `line`: the line the code starts on, exactly as your latest `read` or report shows it.';
  if ('to' in span) return 'The end of a range is `through`: `from` and `through` are both texts.';
  const line = lineProblem(span.line);
  if (line !== undefined) return line;
  const range = span.from !== undefined || span.through !== undefined;
  if (span.text !== undefined && range) return 'Give `text`, or `from` and `through`, not both.';
  if (range && (typeof span.from !== 'string' || typeof span.through !== 'string')) {
    return 'A range is `from` and `through`, both texts: from the start of `from` through the end of the first `through` after it.';
  }
  if (!range && typeof span.text !== 'string') return 'Give the code: `text`, or `from` and `through`.';
  if (span.text === '' || span.from === '' || span.through === '') return "The code's text can't be empty.";
  return undefined;
}

/** Returns the action keys an object has; more than one means actions were combined by mistake. */
export function actionKinds(value: object): string[] {
  return Object.keys(value).filter((k) => (ACTION_KINDS as readonly string[]).includes(k));
}

/**
 * Returns what's wrong with an action's fields, if anything: the fields the relay's schema allows, a
 * `delete` that is `true`, and a `wait` that is a number. The player checks this too, so an action
 * that skipped the schema is held to it all the same (#45).
 */
export function fieldsProblem(action: object): string | undefined {
  const kind = actionKinds(action)[0];
  if (kind === undefined) return undefined;
  const allowed = kind === 'run' ? ['run', 'wait'] : [kind];
  const extra = Object.keys(action).filter((k) => !allowed.includes(k));
  if (extra.length > 0) return `Unknown field ${fieldList(extra)} in a \`${kind}\` action: it has ${fieldList(allowed)}.`;
  if ('delete' in action && action.delete !== true) return '`delete` is `true`: it deletes the current selection.';
  if ('wait' in action && action.wait !== undefined && typeof action.wait !== 'number') return '`wait` is a number: the seconds to wait.';
  const place: unknown = 'move' in action ? action.move : 'select' in action ? action.select : 'point' in action ? action.point : undefined;
  const fields = kind === 'move' ? MOVE_FIELDS : SPAN_FIELDS;
  if (typeof place === 'object' && place !== null && !Array.isArray(place)) {
    // The place's own check first: it knows what a mistaken field was meant to be.
    const problem = kind === 'move' ? moveProblem(place) : spanProblem(place);
    if (problem !== undefined) return problem;
    const unknown = Object.keys(place).filter((k) => !fields.includes(k));
    if (unknown.length > 0) return `Unknown field ${fieldList(unknown)} in \`${kind}\`: it takes ${fieldList(fields)}.`;
  } else if (kind === 'move' || kind === 'select' || kind === 'point') {
    return `\`${kind}\` is an object: it takes ${fieldList(fields)}.`;
  }
  return undefined;
}

/** Returns what's wrong with the text of a `type`, if anything: it marks where the cursor ends with one `CURSOR_MARKER`. */
export function typeProblem(text: unknown): string | undefined {
  if (Array.isArray(text)) {
    return `The text to type is one text, with ${CURSOR_MARKER} where your cursor ends: \`"f(${CURSOR_MARKER})"\`, or \`"x${CURSOR_MARKER}"\` with nothing after it.`;
  }
  if (typeof text !== 'string') return `Give the text to type, with ${CURSOR_MARKER} where your cursor ends.`;
  const markers = markerCount(text);
  if (markers === 0) {
    return `Mark where your cursor ends with ${CURSOR_MARKER}: \`"f(${CURSOR_MARKER})"\`, or \`"x${CURSOR_MARKER}"\` with nothing after it.`;
  }
  if (markers > 1) {
    return `The text to type has ${markers} ${CURSOR_MARKER}, but marks one place: where your cursor ends. A literal ${CURSOR_MARKER} can't be typed.`;
  }
  return undefined;
}

/** A refused tool call, with its code. */
export class ToolError extends Error {
  constructor(
    readonly code: ToolErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export * from './wire';
export * from './paths';
export * from './schemas';
