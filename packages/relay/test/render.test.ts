// How reports read. These check what a report says, not its exact layout, so the wording can keep improving.

import { describe, expect, it } from 'vitest';
import { CURSOR_MARKER, type Report } from '@ai-pair/protocol';
import { ELLIPSIS, RANGE_DASH } from '@ai-pair/core/constants';
import { renderFile, renderReport } from '../src/render';

function report(r: Partial<Report>): Report {
  return { batches: [], events: [], turn: 'agent', ...r };
}

function code(finalNewline: boolean) {
  return { file: 'a.ts', lines: [{ number: 9, text: `}${CURSOR_MARKER}` }], end: { final_newline: finalNewline } };
}

/** Returns code of one line, numbered `n`, in `file`, whose text names the number. */
function fieldCode(file: string, n: number) {
  return { file, lines: [{ number: n, text: `code-${n}` }], end: { final_newline: false } };
}

describe('reports', () => {
  it("shows a batch's code as numbered lines, with the cursor", () => {
    const text = renderReport(
      report({
        batches: [
          {
            id: 5,
            status: 'completed',
            code: { file: 'src/server.ts', lines: [{ number: 12, text: `  const todo = createTodo();${CURSOR_MARKER}` }] },
          },
        ],
        submitted: { id: 6, status: 'playing' },
      }),
      'step',
    );
    expect(text).toMatch(/Batch 5 completed/);
    expect(text).toMatch(/src\/server\.ts/);
    expect(text).toMatch(new RegExp(`12 +  const todo = createTodo\\(\\);${CURSOR_MARKER}`));
    expect(text).toMatch(/Batch 6 is playing/);
  });

  it("says a rejected batch wasn't queued, which action would fail and why, and how the code would read", () => {
    const text = renderReport(
      report({
        rejected: {
          index: 3,
          action: { move: { line: 2, at: `x${CURSOR_MARKER}` } },
          error: { kind: 'ambiguous', message: '2 matches', candidates: [{ line: 1, context: 'x' }] },
          code: { file: 'a.ts', lines: [{ number: 3, text: `y${CURSOR_MARKER}` }] },
        },
      }),
      'step',
    );
    expect(text).toMatch(/rejected/);
    expect(text).toMatch(new RegExp(`action 3 would fail:\\n  \\{"move":\\{"line":2,"at":"x${CURSOR_MARKER}"\\}\\}`));
    expect(text).toMatch(/ambiguous: 2 matches\n  line 1: x/);
    expect(text).toMatch(new RegExp(`a\\.ts:\\n3  y${CURSOR_MARKER}`));
    expect(text).toMatch(/submit the whole batch again/);
  });

  it('says whether the programmer made an edit, or something else did', () => {
    const text = renderReport(
      report({
        events: [
          { kind: 'edit', file: 'a.ts', diff: '@@ -1 +1 @@\n-a\n+b', by: 'programmer' },
          { kind: 'edit', file: 'package.json', diff: '@@ -1 +1 @@\n-{}\n+{ }', by: 'other' },
        ],
      }),
      'listen',
    );
    expect(text).toMatch(/The programmer edited a\.ts:\n@@/);
    expect(text).toMatch(/package\.json was changed, not by the programmer.*:\n@@/);
  });

  it('says where code reaches the end of the file, and when no newline ends it', () => {
    const ending = renderReport(report({ batches: [{ id: 1, status: 'completed', code: code(/* final_newline= */ true) }] }), 'step');
    expect(ending).toMatch(new RegExp(`9  }${CURSOR_MARKER}\\n   \\(end of file\\)$`));
    const missing = renderReport(report({ batches: [{ id: 1, status: 'completed', code: code(/* final_newline= */ false) }] }), 'step');
    expect(missing).toMatch(/\(end of file, with no newline after the last line\)$/);
  });

  it('shows gaps in long code', () => {
    const lines = [1, 2, 58, 59].map((number) => ({ number, text: `line ${number}` }));
    const text = renderReport(report({ batches: [{ id: 1, status: 'completed', code: { file: 'a.ts', lines } }] }), 'step');
    expect(/line 2\n(.*)\n.*line 58/.exec(text)?.[1]?.trim()).toBe(ELLIPSIS);
  });

  it('puts what the programmer did first, and lists unplayed actions ready to resubmit', () => {
    const text = renderReport(
      report({
        events: [{ kind: 'message', text: 'use zod\nplease' }],
        batches: [
          {
            id: 6,
            status: 'interrupted',
            code: { file: 'a.ts', lines: [{ number: 3, text: `  res.sta${CURSOR_MARKER}` }] },
            unplayed: [{ type: `tus(${CURSOR_MARKER})` }],
          },
          { id: 7, status: 'discarded', unplayed: [{ say: 'Next.' }] },
        ],
      }),
      'step',
    );
    expect(text.indexOf('use zod')).toBeLessThan(text.indexOf('Batch 6'));
    expect(text).toMatch(/> please/);
    expect(text).toMatch(/Batch 6 interrupted/);
    expect(text).toContain(JSON.stringify({ type: `tus(${CURSOR_MARKER})` }));
    expect(text).toMatch(/Batch 7 discarded/);
    expect(text).toContain(JSON.stringify({ say: 'Next.' }));
  });

  it('says why a batch failed, with the candidates, and which action failed', () => {
    const text = renderReport(
      report({
        batches: [
          {
            id: 8,
            status: 'failed',
            error: {
              kind: 'ambiguous',
              message: '2 matches for "x"',
              candidates: [
                { line: 12, context: 'x = 1' },
                { line: 31, context: 'x = 2' },
              ],
            },
            unplayed: [{ move: { line: 2, at: `x${CURSOR_MARKER}` } }],
          },
        ],
      }),
      'step',
    );
    expect(text).toMatch(/ambiguous: 2 matches/);
    expect(text).toMatch(/line 12: x = 1/);
    expect(text).toMatch(/line 31: x = 2/);
    expect(text).toMatch(/the one that failed/);
  });

  it("shows a command's outcome and output", () => {
    const text = renderReport(
      report({
        batches: [
          {
            id: 9,
            status: 'failed',
            error: { kind: 'command_failed', message: 'The command exited with 1.' },
            runs: [{ command: 'npm test', exit_code: 1, output: '1 failed', shell: 'zsh' }],
          },
        ],
      }),
      'step',
    );
    expect(text).toMatch(/npm test/);
    expect(text).toMatch(/zsh/);
    expect(text).toMatch(/exited with 1/);
    expect(text).toMatch(/```\n1 failed\n```/);
  });

  it('tells the agent what to do when nothing happened in time', () => {
    expect(renderReport(report({ waiting: true }), 'listen')).toMatch(/Call `listen` again/);
    expect(renderReport(report({ waiting: true }), 'step')).toMatch(/Carry on/);
  });

  it("says when it's the programmer's turn, and when the session ends", () => {
    expect(renderReport(report({ turn: 'programmer', events: [{ kind: 'turn', to: 'programmer' }] }), 'listen')).toMatch(
      /programmer's turn/,
    );
    expect(renderReport(report({ events: [{ kind: 'end' }] }), 'listen')).toMatch(/ended the session/);
    expect(renderReport(report({}), 'end')).toMatch(/ended/);
  });
});

describe('files', () => {
  it('shows numbered lines, and whether the buffer has unsaved changes', () => {
    const text = renderFile({ file: 'a.ts', dirty: true, lines: [{ number: 1, text: 'hi' }] });
    expect(text).toMatch(/a\.ts/);
    expect(text).toMatch(/unsaved/);
    expect(text).toMatch(/1 +hi/);
  });

  it("says where the file ends, and when no newline ends it, even when it's empty", () => {
    const lines = [{ number: 1, text: 'hi' }];
    expect(renderFile({ file: 'a.ts', dirty: false, lines, end: { final_newline: true } })).toMatch(/1  hi\n   \(end of file\)$/);
    expect(renderFile({ file: 'a.ts', dirty: false, lines, end: { final_newline: false } })).toMatch(/no newline after the last line/);
    expect(renderFile({ file: 'a.ts', dirty: false, lines: [], end: { final_newline: true } })).toBe('a.ts:\n   (end of file)');
    expect(renderFile({ file: 'a.ts', dirty: false, lines: [] })).toMatch(/no lines in this range/);
  });
});

describe('saving', () => {
  it("says which files a batch couldn't save, and that the disk has the old file", () => {
    const text = renderReport(
      report({ batches: [{ id: 3, status: 'completed', unsaved: [{ file: 'a.ts', error: 'the file on disk is newer' }] }] }),
      'step',
    );
    expect(text).toMatch(/Couldn't save a\.ts \(the file on disk is newer\)/);
    expect(text).toMatch(/file on disk doesn't/);
  });
});

describe('edits with no net change', () => {
  it('says who edited the file and changed it back (specs/EditEvents.tla)', () => {
    const undone: Report = {
      batches: [],
      events: [
        { kind: 'edit', file: 'a.ts', diff: '', by: 'programmer' },
        { kind: 'edit', file: 'b.ts', diff: '', by: 'other' },
      ],
      turn: 'agent',
    };
    expect(renderReport(undone, 'listen')).toBe(
      'The programmer edited a.ts, then changed it back: no net change.\n\nA tool, a formatter, or something on disk edited b.ts, then changed it back: no net change.',
    );
  });

  it('says playback is paused, and why, before saying nothing has happened (#149)', () => {
    const text = renderReport(report({ waiting: true, paused: ['away', 'reply'] }), 'listen');
    expect(text).toMatch(/Playback is paused: the programmer is looking at another file.*; the programmer is typing a reply\./);
    expect(text.indexOf('Playback is paused')).toBeLessThan(text.indexOf('Nothing has happened yet'));
  });

  it("gives a long edit's line ranges and says to read the file, instead of the whole diff (#149)", () => {
    const text = renderReport(
      report({ events: [{ kind: 'edit', file: 'a.ts', diff: '@@ -1,0 +1,300 @@', by: 'other', omitted: 300 }] }),
      'listen',
    );
    expect(text).toMatch(/a\.ts in these places, too much to show \(300 lines of diff left out\)\. `read` the file/);
    expect(text).toMatch(/@@ -1,0 \+1,300 @@/);
  });
});

describe('the variants each part can take', () => {
  it('renders a selection over several lines, and one that was not cut off', () => {
    const selection = { file: 'a.ts', from: { line: 3, column: 1 }, to: { line: 4, column: 2 }, text: 'one\ntwo' };
    const text = renderReport(report({ events: [{ kind: 'message', text: 'hi', selection }] }), 'listen');
    expect(text).toContain(`a.ts lines 3${RANGE_DASH}4`);
    expect(text).not.toMatch(/cut off/);
  });

  it('says a run is still running, or that its exit code is unknown, and fences output that has backticks', () => {
    const run = { command: 'npm test', output: 'a ``` b' };
    const running = renderReport(report({ batches: [{ id: 1, status: 'completed', runs: [{ ...run, running: true }] }] }), 'step');
    expect(running).toMatch(/still running in its terminal/);
    expect(running).toContain('````\na ``` b\n````');
    const unknown = renderReport(report({ batches: [{ id: 1, status: 'completed', runs: [run] }] }), 'step');
    expect(unknown).toMatch(/exit code unknown/);
  });

  it("names a tool for another's long edit, and shows a turn handed back without a message, with a selection", () => {
    const selection = { file: 'a.ts', from: { line: 1, column: 1 }, to: { line: 1, column: 2 }, text: 'x' };
    const events: Report['events'] = [
      { kind: 'edit', file: 'a.ts', diff: '@@ -1 +1 @@', by: 'other', omitted: 5 },
      { kind: 'turn', to: 'agent', selection },
    ];
    const text = renderReport(report({ events }), 'listen');
    expect(text).toMatch(/A tool, a formatter, or something on disk changed a\.ts in these places/);
    expect(text).toContain('handed the turn back to you.\nAbout the code they had selected, a.ts line 1:');
  });

  it("names the programmer for their own long edit, and shows a rejected batch's error without code it has none of", () => {
    const edit = { kind: 'edit', file: 'a.ts', diff: '@@ -1,900 +1,900 @@', by: 'programmer', omitted: 1800 } as const;
    expect(renderReport(report({ events: [edit] }), 'listen')).toMatch(/^The programmer changed a\.ts in these places, too much to show/);
    const rejected = { index: 1, action: { say: 'x' }, error: { kind: 'no_line', message: 'No line 9.' } } as const;
    const text = renderReport(report({ rejected }), 'step');
    expect(text).toContain('no_line: No line 9.\nNothing of it was queued.');
  });

  it('says there is nothing to report when nothing happened', () => {
    expect(renderReport(report({}), 'step')).toBe('Nothing to report.');
  });

  it('opens a start by saying the session started or resumed, a calibration by saying it is under way, and a repeat as one', () => {
    expect(renderReport(report({}), 'start')).toMatch(/^The session has started\./);
    expect(renderReport(report({ resumed: true }), 'start')).toMatch(/^The session has resumed: /);
    expect(renderReport(report({}), 'calibrate')).toMatch(/^The calibration is under way in the Pair panel/);
    expect(renderReport(report({ repeated: true }), 'listen')).toMatch(/^Part of this report may repeat an earlier one/);
  });
});

describe('every field', () => {
  // Every field of a Report appears in its rendered text (Render in #19): each field below holds a value of its own,
  // and the text must contain each one.
  it('renders every field of a report', () => {
    const full: Report = {
      batches: [
        {
          id: 101,
          status: 'failed',
          code: fieldCode('batch.ts', 11),
          error: { kind: 'not_found', message: 'error-message-1', candidates: [{ line: 12, context: 'candidate-1' }] },
          unplayed: [{ say: 'unplayed-1' }],
          runs: [{ command: 'command-1', exit_code: 13, output: 'output-1', truncated: true, shell: 'shell-1' }],
          unsaved: [{ file: 'unsaved.ts', error: 'unsaved-error-1' }],
        },
        { id: 102, status: 'interrupted', runs: [{ command: 'command-2', output: '', running: true }] },
      ],
      submitted: { id: 103, status: 'queued' },
      rejected: {
        index: 4,
        action: { say: 'rejected-action' },
        error: { kind: 'no_line', message: 'rejected-message' },
        code: fieldCode('rejected.ts', 14),
      },
      events: [
        {
          kind: 'message',
          text: 'message-1',
          selection: { file: 'sel.ts', from: { line: 15, column: 1 }, to: { line: 15, column: 3 }, text: 'excerpt-1', truncated: true },
        },
        { kind: 'edit', file: 'edited.ts', diff: 'diff-1', by: 'programmer' },
        { kind: 'edit', file: 'other.ts', diff: 'diff-2', by: 'other' },
        { kind: 'interrupt' },
        { kind: 'turn', to: 'agent', message: 'handback-1' },
      ],
      turn: 'programmer',
      cursor: fieldCode('cursor.ts', 16),
      waiting: true,
    };
    const text = renderReport(full, 'listen');
    for (const value of [
      'Batch 101 failed',
      'batch.ts',
      'code-11',
      'not_found',
      'error-message-1',
      'line 12: candidate-1',
      'unplayed-1',
      'command-1',
      'exited with 13',
      'output-1',
      'its end',
      'shell-1',
      'unsaved.ts',
      'unsaved-error-1',
      'Batch 102 interrupted',
      'command-2',
      'still running',
      'Batch 103 is queued',
      'action 4',
      'rejected-action',
      'no_line',
      'rejected-message',
      'rejected.ts',
      'code-14',
      'message-1',
      'sel.ts',
      'line 15',
      'excerpt-1',
      'cut off here',
      'edited.ts',
      'diff-1',
      'The programmer edited',
      'other.ts',
      'diff-2',
      'not by the programmer',
      'pressed Interrupt',
      'handback-1',
      "programmer's turn",
      'cursor.ts',
      'code-16',
      'Call `listen` again',
    ]) {
      expect(text, value).toContain(value);
    }
  });
});
