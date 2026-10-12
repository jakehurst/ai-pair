// Offset <-> line/column conversions. Lines and columns are 1-based.

/** In `terminalText`, where a line was erased: what came before it on the line is gone. */
const ERASED_LINE = '\u0000';

/** A position in text, by line and column, both from 1. */
export interface Position {
  line: number;
  column: number;
}

/** Returns the line and column of `offset` in `text`. */
export function position(text: string, offset: number): Position {
  let line = 1;
  let lineStart = 0;
  for (let i = text.indexOf('\n'); i !== -1 && i < offset; i = text.indexOf('\n', i + 1)) {
    line++;
    lineStart = i + 1;
  }
  return { line, column: offset - lineStart + 1 };
}

/** Returns the lines of `text`, split on either line ending. */
function splitLines(text: string): string[] {
  return text.split(/\r?\n/);
}

/**
 * Returns a file's lines, as the agent is shown them: a newline at the end ends the last line, and doesn't
 * start an empty one after it. An empty file has no lines.
 */
export function fileLines(text: string): { lines: string[]; finalNewline: boolean } {
  if (text === '') return { lines: [], finalNewline: true };
  const lines = splitLines(text);
  const finalNewline = text.endsWith('\n');
  if (finalNewline) lines.pop();
  return { lines, finalNewline };
}

/**
 * Returns the offsets on a line, as `position` counts them: from its first character through its newline,
 * or the end of the text. None for a line the text doesn't have.
 */
export function lineSpan(text: string, line: number): { start: number; end: number } | undefined {
  if (line < 1) return undefined;
  let start = 0;
  for (let l = 1; l < line; l++) {
    const next = text.indexOf('\n', start);
    if (next === -1) return undefined;
    start = next + 1;
  }
  const newline = text.indexOf('\n', start);
  return { start, end: newline === -1 ? text.length : newline };
}

/** Returns the text of `line` (from 1), or an empty string past the end. */
export function lineText(text: string, line: number): string {
  return splitLines(text)[line - 1] ?? '';
}

/** Returns the offset of the end of a line (before its newline), clamped to the document. */
export function lineEnd(text: string, line: number): number {
  let offset = 0;
  for (let l = 1; l < line; l++) {
    const next = text.indexOf('\n', offset);
    if (next === -1) break;
    offset = next + 1;
  }
  const end = text.indexOf('\n', offset);
  const stop = end === -1 ? text.length : end;
  return stop > offset && text[stop - 1] === '\r' ? stop - 1 : stop;
}

/** Returns whether `offset` is the start of a line. */
export function isLineStart(text: string, offset: number): boolean {
  return offset === 0 || text[offset - 1] === '\n';
}

/** Returns raw terminal output as plain text: no escape sequences, carriage-return overwrites resolved. */
export function terminalText(raw: string): string {
  // Escape sequences start with ESC (\u001b) and some end with BEL (\u0007): matching control characters is the point.
  // oxlint-disable no-control-regex
  const plain = raw
    // ECMA-48: CSI G or 1G moves the cursor to column 1; CSI K or 0K erases from it to the end, CSI 2K the whole line.
    .replaceAll(/\u001B\[1?G\u001B\[0?K|\u001B\[2K/g, ERASED_LINE)
    .replaceAll(/\u001B\[1?G/g, '\r')
    .replaceAll(/\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)/g, '')
    .replaceAll(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')
    .replaceAll(/\u001B[@-Z\\-_]/g, '');
  return plain
    .replaceAll('\r\n', '\n')
    .split('\n')
    .map((line) => {
      const parts = (line.split(ERASED_LINE).at(-1) ?? '').split('\r').filter((p) => p !== '');
      return (parts.at(-1) ?? '').replaceAll(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trimEnd();
      // oxlint-enable no-control-regex
    })
    .join('\n')
    .trim();
}
