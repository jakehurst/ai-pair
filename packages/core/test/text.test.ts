// text.ts's offsets, lines, and terminal text. text.ts imports nothing, so the test needs no mocks.

import { describe, expect, it } from 'vitest';
import { fileLines, isLineStart, lineEnd, lineSpan, lineText, position, terminalText } from '../src/text';

// Terminal output as VS Code's shell integration reports it: OSC 633 marks, and ANSI colors.
const COMMAND_OUTPUT_START = '\u001B]633;C\u0007';
const COMMAND_FINISHED_OK = '\u001B]633;D;0\u0007';
const GREEN = '\u001B[32m';
const RESET_COLOR = '\u001B[0m';
// Line redraws, as Prettier and npm write them.
const ERASE_LINE = '\u001B[2K';
const ERASE_TO_LINE_END = '\u001B[0K';
const CURSOR_TO_COLUMN_1 = '\u001B[1G';

describe('terminal text', () => {
  it('drops colors and shell integration sequences, and resolves progress overwrites', () => {
    const raw = `${COMMAND_OUTPUT_START}${GREEN}ok${RESET_COLOR} 4 passed\r\n 10%\r 50%\r100%\r\n${COMMAND_FINISHED_OK}`;
    expect(terminalText(raw)).toBe('ok 4 passed\n100%');
  });

  it('resolves a line redrawn by moving the cursor to column 1', () => {
    const prettier = `Checking formatting...\r\na.ts${ERASE_LINE}${CURSOR_TO_COLUMN_1}b.ts${ERASE_LINE}${CURSOR_TO_COLUMN_1}All matched files use Prettier code style!\r\n`;
    const npmSpinner = `/${CURSOR_TO_COLUMN_1}${ERASE_TO_LINE_END}`;
    expect(terminalText(prettier + npmSpinner)).toBe('Checking formatting...\nAll matched files use Prettier code style!');
  });
});

describe('line offsets', () => {
  const text = 'a\nb';

  it('ends a line past the last at the end of the text', () => {
    expect(lineEnd(text, 5)).toBe(text.length);
  });

  it('spans a line from its start through its newline, or the end of the text, and a line past the last at the end', () => {
    expect(lineSpan(text, 1)).toEqual({ start: 0, end: 1 });
    expect(lineSpan(text, 2)).toEqual({ start: 2, end: 3 });
    expect(lineSpan(text, 3)).toEqual({ start: 3, end: 3 });
    expect(lineSpan('a\n', 2)).toEqual({ start: 2, end: 2 });
    expect(lineSpan('a\r\nb', 1)).toEqual({ start: 0, end: 2 });
  });

  it("gives a line's text, either line ending, and none past the end", () => {
    expect(lineText('a\r\nb', 1)).toBe('a');
    expect(lineText('a\r\nb', 2)).toBe('b');
    expect(lineText(text, 3)).toBe('');
  });

  it('ends a line before its newline, and before the carriage return of one', () => {
    expect(lineEnd(text, 1)).toBe(1);
    expect(lineEnd('a\r\nb', 1)).toBe(1);
    expect(lineEnd('\r\nb', 1)).toBe(0);
  });

  it('tells where a line starts', () => {
    expect(isLineStart(text, 0)).toBe(true);
    expect(isLineStart(text, 1)).toBe(false);
    expect(isLineStart(text, 2)).toBe(true);
  });
});

describe('position', () => {
  it('counts lines and columns from 1, an offset at a newline on the line it ends', () => {
    expect(position('ab\ncd', 0)).toEqual({ line: 1, column: 1 });
    expect(position('ab\ncd', 2)).toEqual({ line: 1, column: 3 });
    expect(position('ab\ncd', 3)).toEqual({ line: 2, column: 1 });
    expect(position('ab\ncd', 5)).toEqual({ line: 2, column: 3 });
  });
});

describe('fileLines', () => {
  it('ends the last line with a final newline, splits on either ending, and gives an empty file no lines', () => {
    expect(fileLines('a\nb\n')).toEqual({ lines: ['a', 'b'], finalNewline: true });
    expect(fileLines('a\r\nb')).toEqual({ lines: ['a', 'b'], finalNewline: false });
    expect(fileLines('')).toEqual({ lines: [], finalNewline: true });
  });
});
