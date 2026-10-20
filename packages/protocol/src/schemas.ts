// The protocol's data as zod schemas, and its types taken from them: a library the editor, the relay,
// and the tests share, so what one sends and another parses cannot drift apart (#163). It imports
// nothing else of ours, so every module of the package can import it.

import { z } from 'zod';

/** Checks a {@link MoveTarget}. */
export const MOVE_TARGET_SCHEMA = z.object({
  file: z.string().optional(),
  /** The line the cursor lands on, from 1. Omitted: the cursor's line. */
  line: z.number().optional(),
  /** A spot on the line: the text around it, with `CURSOR_MARKER` where the cursor goes. */
  at: z.string().optional(),
  /** `line_end`: the end of the line. */
  to: z.literal('line_end').optional(),
});

/** Checks the fields a span may have, before `spanProblem` holds them to a {@link SpanTarget}. */
export const SPAN_TARGET_SCHEMA = z.object({
  file: z.string().optional(),
  /** The line the code starts on, from 1. Omitted: the cursor's line. */
  line: z.number().optional(),
  text: z.string().optional(),
  from: z.string().optional(),
  through: z.string().optional(),
});

/** Checks a {@link SpanTarget}: its `text`, or its `from` and `through`. */
export const SPAN_SCHEMA = z.union([
  SPAN_TARGET_SCHEMA.pick({ file: true, line: true }).extend({ text: z.string() }),
  SPAN_TARGET_SCHEMA.pick({ file: true, line: true }).extend({ from: z.string(), through: z.string() }),
]);

/** Checks an {@link Action}. */
export const ACTION_SCHEMA = z.union([
  z.object({ say: z.string() }),
  z.object({ move: MOVE_TARGET_SCHEMA }),
  z.object({ select: SPAN_SCHEMA }),
  z.object({ type: z.string() }),
  z.object({ type_fast: z.string() }),
  z.object({ delete: z.literal(true) }),
  z.object({ point: SPAN_SCHEMA }),
  z.object({ run: z.string(), wait: z.number().optional() }),
]);

/** Checks a {@link Turn}. */
export const TURN_SCHEMA = z.enum(['agent', 'programmer']);

/** Checks a {@link PauseReason}. */
export const PAUSE_REASON_SCHEMA = z.enum(['programmer', 'reply', 'away', 'calibrate']);

/** Checks a {@link BatchStatus}. */
export const BATCH_STATUS_SCHEMA = z.enum(['completed', 'interrupted', 'failed', 'discarded']);

/** Checks an {@link ErrorKind}. */
export const ERROR_KIND_SCHEMA = z.enum([
  'no_line',
  'not_found',
  'ambiguous',
  'line_not_seen',
  'no_selection',
  'no_cursor',
  'not_your_turn',
  'invalid_action',
  'command_failed',
  'command_declined',
  'save_failed',
  // After a discarded or interrupted batch, the next one did not anchor the cursor with a file and line (#112).
  'unanchored',
]);

/** Checks a {@link Candidate}. */
export const CANDIDATE_SCHEMA = z.object({ line: z.number(), context: z.string() });

/** Checks a {@link RunResult}. */
export const RUN_RESULT_SCHEMA = z.object({
  command: z.string(),
  /** Absent when the command is still running, or its exit code couldn't be observed. */
  exit_code: z.number().optional(),
  output: z.string(),
  truncated: z.literal(true).optional(),
  /** Still running: `wait` elapsed, or playback was interrupted. It keeps running in the terminal. */
  running: z.literal(true).optional(),
  /** The terminal's shell, e.g. `pwsh` or `zsh`, when it's known. */
  shell: z.string().optional(),
});

/** A line of a file, by its number from 1, as a report or a `read` shows it. */
const NUMBERED_LINE_SCHEMA = z.object({ number: z.number(), text: z.string() });

/** Present when the lines reach the end of the file: whether a newline ends its last line. */
const FILE_END_SCHEMA = z.object({ final_newline: z.boolean() });

/** Checks a {@link Code}. */
export const CODE_SCHEMA = z.object({
  file: z.string(),
  lines: z.array(NUMBERED_LINE_SCHEMA),
  end: FILE_END_SCHEMA.optional(),
});

/** Checks a {@link BatchError}. */
export const BATCH_ERROR_SCHEMA = z.object({
  kind: ERROR_KIND_SCHEMA,
  message: z.string(),
  candidates: z.array(CANDIDATE_SCHEMA).optional(),
});

/** Checks a {@link BatchResult}. */
export const BATCH_RESULT_SCHEMA = z.object({
  id: z.number(),
  status: BATCH_STATUS_SCHEMA,
  /** The code the batch produced, as it read when the batch ended; also just the cursor's line after a move. */
  code: CODE_SCHEMA.optional(),
  /** The error of a failed batch, about the first action in `unplayed`. */
  error: BATCH_ERROR_SCHEMA.optional(),
  /**
   * The actions that didn't play, verbatim, ready to resubmit. An interrupted `type` comes first, reduced to
   * what it didn't type; a failed batch's failing action comes first.
   */
  unplayed: z.array(ACTION_SCHEMA).optional(),
  runs: z.array(RUN_RESULT_SCHEMA).optional(),
  /** Files the batch edited that couldn't be saved: the buffer has the edits, the file on disk doesn't. */
  unsaved: z.array(z.object({ file: z.string(), error: z.string() })).optional(),
});

/** Checks a {@link LineColumn}. */
export const LINE_COLUMN_SCHEMA = z.object({ line: z.number(), column: z.number() });

/** Checks an {@link Excerpt}. */
export const EXCERPT_SCHEMA = z.object({
  file: z.string(),
  from: LINE_COLUMN_SCHEMA,
  to: LINE_COLUMN_SCHEMA,
  text: z.string(),
  truncated: z.literal(true).optional(),
});

/** Checks a {@link Passage}. */
export const PASSAGE_SCHEMA = z.object({
  title: z.string(),
  text: z.string(),
  /** Shown with the passage, outside the timed text: a license notice, or where it is from. */
  notice: z.string().optional(),
});

/** Checks an {@link Event}. */
export const EVENT_SCHEMA = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('message'), text: z.string(), selection: EXCERPT_SCHEMA.optional() }),
  z.object({
    kind: z.literal('edit'),
    file: z.string(),
    diff: z.string(),
    /** `other`: not by the programmer, but by a tool, a formatter, or on disk. Only the programmer's interrupt. */
    by: z.enum(['programmer', 'other']),
    /** The diff was too long, so `diff` has only its hunks' headers, and this many lines were left out (#149). */
    omitted: z.number().optional(),
  }),
  z.object({ kind: z.literal('interrupt') }),
  z.object({ kind: z.literal('turn'), to: TURN_SCHEMA, message: z.string().optional(), selection: EXCERPT_SCHEMA.optional() }),
  z.object({ kind: z.literal('end') }),
]);

/** Checks a {@link Report}. */
export const REPORT_SCHEMA = z.object({
  batches: z.array(BATCH_RESULT_SCHEMA),
  /** The batch this `step` submitted, unless it's already finished and in `batches`. */
  submitted: z.object({ id: z.number(), status: z.enum(['queued', 'playing']) }).optional(),
  /**
   * The batch this `step` was given, if it wasn't queued: played in memory, from where the queued
   * batches leave off, its action `index` (from 1) would fail. `code` is how the code would read then.
   */
  rejected: z.object({ index: z.number(), action: ACTION_SCHEMA, error: BATCH_ERROR_SCHEMA, code: CODE_SCHEMA.optional() }).optional(),
  events: z.array(EVENT_SCHEMA),
  turn: TURN_SCHEMA,
  /** The agent cursor's line, when it isn't where the agent last saw it: in this report's code, or an earlier report. */
  cursor: CODE_SCHEMA.optional(),
  waiting: z.literal(true).optional(),
  /** Some of it may repeat a report the agent already saw: a call it canceled came back after its answer (#67). */
  repeated: z.literal(true).optional(),
  /** `start` resumed a session its agent had disconnected from, or the window had reloaded with (#25). */
  resumed: z.literal(true).optional(),
  /** Playback is paused, for these reasons: the agent's batches wait until the programmer resumes (#149). */
  paused: z.array(PAUSE_REASON_SCHEMA).optional(),
});

/** Checks a {@link FileContent}. */
export const FILE_CONTENT_SCHEMA = z.object({
  file: z.string(),
  dirty: z.boolean(),
  /** As in `Code`: a newline at the end of the file ends its last line. An empty file has none. */
  lines: z.array(NUMBERED_LINE_SCHEMA),
  end: FILE_END_SCHEMA.optional(),
});

/** Checks a {@link ToolErrorCode}. */
export const TOOL_ERROR_CODE_SCHEMA = z.enum([
  'no_session',
  'session_active',
  'no_editor',
  'cancelled',
  'invalid_arguments',
  'calibration_busy',
]);

/** Checks a {@link Discovery}. */
export const DISCOVERY_SCHEMA = z.object({
  pid: z.number(),
  workspaceFolders: z.array(z.string()),
  port: z.number(),
  token: z.string(),
  protocolVersion: z.number(),
  /** Epoch milliseconds. */
  lastFocused: z.number(),
});

/** Checks a {@link ToolName}. */
export const TOOL_NAME_SCHEMA = z.enum(['start', 'step', 'listen', 'end', 'read', 'calibrate']);

/** Checks a {@link RelayMessage}. */
export const RELAY_MESSAGE_SCHEMA = z.discriminatedUnion('type', [
  // The bridge judges a hello's token and version itself: anything but its own is rejected, and the socket closed.
  z.object({ type: z.literal('hello'), token: z.unknown(), protocolVersion: z.unknown() }),
  // A tool the bridge doesn't know is answered with `invalid_arguments`; a call with no `args` takes none.
  z.object({ type: z.literal('call'), id: z.number(), tool: z.string(), args: z.record(z.string(), z.unknown()).optional() }),
  z.object({ type: z.literal('cancel'), id: z.number() }),
  /** A report that arrived for a call the agent had already cancelled: deliver it again. */
  z.object({ type: z.literal('return'), report: REPORT_SCHEMA, mayRepeat: z.literal(true).optional() }),
]);

/** Checks an {@link EditorMessage}. */
export const EDITOR_MESSAGE_SCHEMA = z.discriminatedUnion('type', [
  z.object({ type: z.literal('welcome') }),
  z.object({ type: z.literal('rejected'), reason: z.string() }),
  z.object({ type: z.literal('result'), id: z.number(), result: z.unknown() }),
  z.object({
    type: z.literal('error'),
    id: z.number(),
    code: z.union([TOOL_ERROR_CODE_SCHEMA, z.literal('internal')]),
    message: z.string(),
  }),
]);

/**
 * Where a `move` goes: on `line`, exactly, a spot, `at`, or the end of the line. Without `line`,
 * on the cursor's line.
 */
export type MoveTarget = z.infer<typeof MOVE_TARGET_SCHEMA>;

/**
 * The code a `select` or `point` takes: `text`, starting on `line`, exactly, or from `from`,
 * starting on it, through the first `through` after it. Without `line`, on the cursor's line.
 */
export type SpanTarget = z.infer<typeof SPAN_SCHEMA>;

/** The fields a {@link SpanTarget} may have, each optional: a span as it arrives, before it is checked. */
export type SpanFields = z.infer<typeof SPAN_TARGET_SCHEMA>;

/** One thing the agent does in a batch: a word to the programmer, a cursor move, a selection, typing, a command. */
export type Action = z.infer<typeof ACTION_SCHEMA>;

/** Whose turn it is: the agent plays batches, or the programmer has the keyboard. */
export type Turn = z.infer<typeof TURN_SCHEMA>;

/** Why playback is paused: the Pause button, a reply being typed, the programmer looking away, a calibration. */
export type PauseReason = z.infer<typeof PAUSE_REASON_SCHEMA>;

/** How a batch ended: played to the end, cut by the programmer, stopped by an error, or never played. */
export type BatchStatus = z.infer<typeof BATCH_STATUS_SCHEMA>;

/** Why an action failed, as a code the agent can act on. */
export type ErrorKind = z.infer<typeof ERROR_KIND_SCHEMA>;

/** A line that might have been the one meant, offered after text was not found where the agent said. */
export type Candidate = z.infer<typeof CANDIDATE_SCHEMA>;

/** What a `run` action produced: the command, its output, and how it ended. */
export type RunResult = z.infer<typeof RUN_RESULT_SCHEMA>;

/**
 * Lines of a file as they read, with the agent cursor marked. Long code skips lines in the middle. A
 * newline at the end of the file ends its last line: there's no empty line after it, unless the
 * cursor is there.
 */
export type Code = z.infer<typeof CODE_SCHEMA>;

/** The error that stopped a batch, with the lines that might have been meant. */
export type BatchError = z.infer<typeof BATCH_ERROR_SCHEMA>;

/** A finished batch as a report describes it: its status, its code, and what was left unplayed. */
export type BatchResult = z.infer<typeof BATCH_RESULT_SCHEMA>;

/** A position in a file, by line and column, both from 1. */
export type LineColumn = z.infer<typeof LINE_COLUMN_SCHEMA>;

/** Code the programmer had selected when they wrote a message. */
export type Excerpt = z.infer<typeof EXCERPT_SCHEMA>;

/** A passage for the reading speed calibration (#109): the agent's `calibrate` tool, the extension's setting. */
export type Passage = z.infer<typeof PASSAGE_SCHEMA>;

/** Something that happened in the editor since the last report: a message, an edit, an interrupt, a turn, the end. */
export type Event = z.infer<typeof EVENT_SCHEMA>;

/** The editor's answer to a tool call: the batches that finished, the events since the last report, and where the cursor is. */
export type Report = z.infer<typeof REPORT_SCHEMA>;

/** A file as `read` returns it: its lines, whether it has unsaved changes, and how it ends. */
export type FileContent = z.infer<typeof FILE_CONTENT_SCHEMA>;

/** Why a tool call was refused, as a code the agent can act on. */
export type ToolErrorCode = z.infer<typeof TOOL_ERROR_CODE_SCHEMA>;

/** Written by each editor window to `<discoveryDir>/<pid>.json`. */
export type Discovery = z.infer<typeof DISCOVERY_SCHEMA>;

/** The names of the tools an agent can call. */
export type ToolName = z.infer<typeof TOOL_NAME_SCHEMA>;

/** A frame from the relay to the editor: a greeting, a tool call, a cancel, or a report handed back. */
export type RelayMessage = z.infer<typeof RELAY_MESSAGE_SCHEMA>;

/** A frame from the editor to the relay: a welcome, a refusal, or a call's result or error. */
export type EditorMessage = z.infer<typeof EDITOR_MESSAGE_SCHEMA>;
