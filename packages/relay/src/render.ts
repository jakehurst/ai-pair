// What the agent reads: reports and files as text, with code as numbered lines instead of JSON
// strings full of escapes. See "Reports" in PROTOCOL.md.

import type { BatchError, BatchResult, Code, Event, Excerpt, FileContent, PauseReason, Report, RunResult } from '@ai-pair/protocol';
import { ELLIPSIS, RANGE_DASH } from '@ai-pair/core/constants';

/** What holds playback, for each pause reason, as the agent reads it (#149). */
const PAUSE_REASONS: Record<PauseReason, string> = {
  programmer: 'the programmer pressed Pause',
  reply: 'the programmer is typing a reply',
  away: 'the programmer is looking at another file, or scrolled away from your cursor',
  calibrate: 'the programmer is calibrating their reading speed',
  attention: 'the programmer requested the floor',
};

/** Who made an edit the programmer didn't make. */
const OTHER_EDITOR = 'A tool, a formatter, or something on disk';
/** The shortest code fence Markdown allows; a longer one wraps output that has backticks of its own. */
const MIN_FENCE = 3;
/** Milliseconds in one second. */
const MS_PER_SECOND = 1000;

/** The tools whose result is a report, rendered as one. */
export type ReportingTool = 'start' | 'step' | 'listen' | 'end' | 'calibrate';

function longestRun(text: string, ch: string): number {
  let longest = 0;
  let current = 0;
  for (const c of text) {
    current = c === ch ? current + 1 : 0;
    longest = Math.max(longest, current);
  }
  return longest;
}

function quote(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => `> ${line}`.trimEnd())
    .join('\n');
}

function endNote(end: Code['end']): string | undefined {
  if (!end) return undefined;
  return end.final_newline ? '(end of file)' : '(end of file, with no newline after the last line)';
}

/** Renders numbered lines; a gap in the numbers is shown as `ELLIPSIS`. A `note` goes below them, aligned with the text. */
function renderLines(lines: Code['lines'], note?: string): string {
  const width = String(lines.at(-1)?.number ?? 0).length;
  const out: string[] = [];
  let previous: number | undefined;
  for (const { number, text } of lines) {
    if (previous !== undefined && number > previous + 1) out.push(`${' '.repeat(width)}  ${ELLIPSIS}`);
    out.push(`${String(number).padStart(width)}  ${text}`.trimEnd());
    previous = number;
  }
  if (note !== undefined) out.push(`${' '.repeat(width)}  ${note}`);
  return out.join('\n');
}

/** Renders a report's code, and where it reaches the end of the file, whether the file ends with a newline. */
function renderCode(code: Code): string {
  return renderLines(code.lines, endNote(code.end));
}

function renderExcerpt(x: Excerpt): string {
  const lines = x.text.split(/\r?\n/).map((text, i) => ({ number: x.from.line + i, text }));
  const where = x.from.line === x.to.line ? `line ${x.from.line}` : `lines ${x.from.line}${RANGE_DASH}${x.to.line}`;
  const cut = x.truncated ? '\n(cut off here; `read` the rest)' : '';
  return `About the code they had selected, ${x.file} ${where}:\n${renderLines(lines)}${cut}`;
}

function renderError(error: BatchError): string {
  const candidates = (error.candidates ?? []).map((c) => `\n  line ${c.line}: ${c.context}`).join('');
  return `${error.kind}: ${error.message}${candidates}`;
}

function renderRun(run: RunResult): string {
  const outcome =
    run.closed === true
      ? 'terminal closed; exit status unknown'
      : run.exit_code !== undefined
        ? `exited with ${run.exit_code}`
        : run.running
          ? 'was awaiting completion evidence in its terminal when its wait ended'
          : 'exit code unknown';
  const prefix = run.id === undefined ? '' : `Command ${run.id}: `;
  const shell = run.shell === undefined ? '' : ` in ${run.shell}`;
  if (run.output === '') {
    const hint = run.exit_code === undefined && run.running ? ' It may be waiting for input; check the terminal.' : '';
    return `${prefix}Ran \`${run.command}\`${shell}: ${outcome}, no output.${hint}`;
  }
  const fence = '`'.repeat(Math.max(MIN_FENCE, longestRun(run.output, '`') + 1));
  return `${prefix}Ran \`${run.command}\`${shell}: ${outcome}. Output${run.truncated ? ', its end' : ''}:\n${fence}\n${run.output}\n${fence}`;
}

function renderRejected(r: NonNullable<Report['rejected']>): string {
  const parts = [`Your batch was rejected: its action ${r.index} would fail:`, `  ${JSON.stringify(r.action)}`, renderError(r.error)];
  if (r.code) parts.push(`The code would read then, in ${r.code.file}:\n${renderCode(r.code)}`);
  parts.push('Nothing of it was queued. Fix it and submit the whole batch again.');
  return parts.join('\n');
}

function renderBatch(batch: BatchResult): string {
  const parts = [batch.code ? `Batch ${batch.id} ${batch.status}, in ${batch.code.file}:` : `Batch ${batch.id} ${batch.status}.`];
  if (batch.code) parts.push(renderCode(batch.code));
  for (const warning of batch.warnings ?? []) {
    parts.push(`Advisory: ${warning}`);
  }
  for (const diagnostic of batch.diagnostics ?? []) {
    const end = diagnostic.endLine === diagnostic.line ? '' : `-${diagnostic.endLine}`;
    const source = diagnostic.source === undefined ? '' : ` (${diagnostic.source})`;
    parts.push(`Advisory diagnostic ${diagnostic.file}:${diagnostic.line}${end}${source}: ${diagnostic.message}`);
  }
  for (const run of batch.runs ?? []) {
    parts.push(renderRun(run));
  }
  for (const u of batch.unsaved ?? []) {
    parts.push(
      `Couldn't save ${u.file} (${u.error}): the editor has your edits, the file on disk doesn't, so commands and your file tools see the old file. Ask the programmer to resolve it in the editor, which offers to compare or overwrite.`,
    );
  }
  if (batch.error) parts.push(renderError(batch.error));
  if (batch.unplayed) {
    const label = batch.error && batch.error.kind !== 'command_failed' ? 'Not played, starting with the one that failed:' : 'Not played:';
    parts.push([label, ...batch.unplayed.map((a) => `  ${JSON.stringify(a)}`)].join('\n'));
  }
  return parts.join('\n');
}

function renderEvent(event: Event): string {
  switch (event.kind) {
    case 'message':
      return `The programmer said:\n${quote(event.text)}${event.selection ? `\n${renderExcerpt(event.selection)}` : ''}`;
    case 'edit':
      if (event.diff === '') {
        return event.by === 'other'
          ? `${OTHER_EDITOR} edited ${event.file}, then changed it back: no net change.`
          : `Editor changes left ${event.file} unchanged overall.`;
      }
      if (event.omitted !== undefined) {
        const who = event.by === 'other' ? OTHER_EDITOR : 'Editor activity';
        return `${who} changed ${event.file} in these places, too much to show (${event.omitted} lines of diff left out). \`read\` the file for its text:\n${event.diff}`;
      }
      if (event.by === 'other') {
        return `${event.file} was changed, not by the programmer but by a tool, a formatter, or on disk:\n${event.diff}`;
      }
      return `Editor text changed in ${event.file}:\n${event.diff}`;
    case 'command_exit':
      return renderRun({
        id: event.id,
        command: event.command,
        output: event.output,
        exit_code: event.exit_code,
        truncated: event.truncated,
        closed: event.closed,
      });
    case 'interrupt':
      return 'The programmer pressed Interrupt.';
    case 'turn':
      if (event.to === 'programmer') return 'The programmer took the turn.';
      return `The programmer handed the turn back to you${event.message === undefined ? '.' : `:\n${quote(event.message)}`}${event.selection ? `\n${renderExcerpt(event.selection)}` : ''}`;
    default:
      // The last kind, `end`: a new kind would widen `event.kind` here and fail the `satisfies`.
      event.kind satisfies 'end';
      return 'The programmer ended the session. This is the final report: stop using the pair tools.';
  }
}

/** Renders a file's lines as the agent reads them, with whether the editor has unsaved changes and where the file ends. */
export function renderFile(content: FileContent): string {
  const header = content.dirty ? `${content.file} (with unsaved changes in the editor):` : `${content.file}:`;
  if (content.lines.length === 0 && !content.end) return `${header} no lines in this range.`;
  return `${header}\n${renderLines(content.lines, endNote(content.end))}`;
}

/** Renders a report as the agent reads it: what the programmer did first, then each batch, in sections. */
export function renderReport(report: Report, tool: ReportingTool): string {
  const sections: string[] = [];
  if (tool === 'start') {
    sections.push(
      report.resumed
        ? "The session has resumed: the programmer's window kept it while you were away, with its turn, your cursor, and its history. Read the files you were working in again before you give a line number: the programmer may have edited them meanwhile."
        : 'The session has started.',
    );
  }
  if (tool === 'calibrate') {
    sections.push(
      'The calibration is under way in the Pair panel: playback is held while the programmer reads the passage. Call `listen`; their next message comes once it ends.',
    );
  }
  if (
    report.navigatorCommentary !== undefined &&
    (tool === 'start' || report.turn === 'programmer' || report.navigator !== undefined || report.commentaryChanged !== undefined)
  ) {
    const guidance = {
      quiet: 'Quiet: comment only on important issues or direct answers; skip routine first-pause reassurance unless asked.',
      helpful: 'Helpful: acknowledge the first typing pause once, then offer useful observations at natural pauses.',
      coach:
        'Coach: acknowledge the first typing pause once, then offer useful observations, explanations, and connections to verified prior work.',
    };
    sections.push(
      `Navigator commentary: ${guidance[report.navigatorCommentary]} Follow explicit session requests in every mode; voice is separate.`,
    );
  }
  if (report.commentaryChanged !== undefined) {
    sections.push(
      'The navigator commentary preference changed. This report only updates settings; queued work and speech are unchanged. Continue the current turn and call `listen` again.',
    );
  }
  if (report.repeated) {
    sections.push(
      "Part of this report may repeat an earlier one: a call you canceled had already returned. Skip what you've already seen.",
    );
  }
  for (const e of report.events) {
    sections.push(renderEvent(e));
  }
  for (const b of report.batches) {
    sections.push(renderBatch(b));
  }
  for (const command of report.commands ?? []) {
    sections.push(
      command.phase === 'confirm'
        ? `Command ${command.id} is awaiting the programmer's approval: ${command.command}`
        : `Command ${command.id} is awaiting completion evidence: ${command.command}`,
    );
  }
  if (report.speechReminder) {
    sections.push(
      'Speech is available, and your last batches had nothing it could speak. Keep each `say` within 45 words and 280 characters, and leave `speak` out, so it is spoken.',
    );
  }
  if (report.submitted) sections.push(`Batch ${report.submitted.id} is ${report.submitted.status}.`);
  if (report.rejected) sections.push(renderRejected(report.rejected));
  if (report.cursor) {
    const owner = report.turn === 'programmer' ? "Agent's" : 'Your';
    sections.push(`${owner} cursor, in ${report.cursor.file}:\n${renderCode(report.cursor)}`);
  }
  if (report.paused) {
    const why = report.paused.map((r) => PAUSE_REASONS[r]).join('; ');
    sections.push(`Playback is paused: ${why}. Your batches wait until the programmer resumes.`);
  }
  const ended = report.events.some((e) => e.kind === 'end');
  if (report.navigator) {
    const reasons = {
      typing_pause: 'typing paused',
      idle_timeout: 'the idle timeout elapsed',
      turn_change: 'the turn changed',
      message: 'the programmer sent a message',
      hand_raised: 'the programmer raised a hand',
    };
    const { wakeReason, elapsedMs, programmerCursor } = report.navigator;
    sections.push(`Listen returned because ${reasons[wakeReason]} after ${elapsedMs / MS_PER_SECOND} seconds.`);
    if (programmerCursor) {
      sections.push(`Programmer's cursor: ${programmerCursor.file}, line ${programmerCursor.line}, column ${programmerCursor.column}.`);
    }
    if (!ended) sections.push('Comment if useful, then call `listen` again.');
  } else if (report.waiting && report.commands !== undefined) {
    sections.push(tool === 'listen' ? 'Call `listen` again.' : 'Carry on as usual.');
  } else if (report.waiting) {
    const activity = report.events.length > 0 || report.batches.length > 0;
    sections.push(
      tool === 'listen'
        ? activity
          ? 'Call `listen` again.'
          : 'Nothing has happened yet. Call `listen` again.'
        : activity
          ? 'Carry on as usual.'
          : 'Nothing has finished yet. Carry on as usual.',
    );
  }
  if (tool === 'end' && !ended) {
    sections.push('The session has ended.');
  } else if (report.turn === 'programmer' && !ended) {
    sections.push("It's the programmer's turn: you're the navigator. Only `say` and `point` work, and `listen` follows along.");
  }
  return sections.length > 0 ? sections.join('\n\n') : 'Nothing to report.';
}
