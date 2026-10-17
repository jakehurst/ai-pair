// The rehearsal plays a batch in memory, in a copy of the editor (specs/Rehearsal.tla, `Submit`).

import { describe, expect, it } from 'vitest';
import { CURSOR_MARKER, type Action } from '@ai-pair/protocol';
import { LineIds } from '../src/lines';
import type { Scene } from '../src/player';
import { MissingFile } from '../src/ports';
import { rehearse, type Rehearsal } from '../src/rehearsal';
import { FakeEditor, testConfig } from './fake';

const UNREADABLE = 'disk unreadable';

/** Returns the start of a rehearsal: nothing played yet, and the cursor nowhere. */
function start(): Rehearsal {
  const scene: Scene = { turn: 'agent', focus: 'cursor', pointFar: false, allowedCommands: new Set() };
  return { scene, texts: new Map(), lines: LineIds.editor(), edits: new Set() };
}

/** An editor whose `eol` fails for a file it doesn't have, as the real editor's does when it can't open the file. */
class NewFileEditor extends FakeEditor {
  override eol(file: string): Promise<string> {
    return this.files.has(file) ? super.eol(file) : Promise.reject(new MissingFile(file));
  }
}

/** An editor that cannot read any file, for a reason other than the file's absence. */
class UnreadableEditor extends FakeEditor {
  override getText(): Promise<string> {
    return Promise.reject(new Error(UNREADABLE));
  }
}

describe('rehearse', () => {
  it('creates a file the editor lacks in memory only, and keeps its edits when a later action shows it again', async () => {
    const editor = new NewFileEditor();
    const name = 'new.ts';
    const file = editor.resolvePath(name);
    const move: Action = { move: { file: name, line: 1, to: 'line_end' } };
    const { result, after } = await rehearse(editor, testConfig, start(), [move, { type: `a${CURSOR_MARKER}` }, move], () => true);
    expect(result.status).toBe('completed');
    expect(after.texts.get(file)).toBe('a');
    expect(editor.files.has(file)).toBe(false);
  });

  it('fails the batch with the read error, instead of creating the file, when the real editor fails to read it for another reason', async () => {
    const editor = new UnreadableEditor();
    const move: Action = { move: { file: 'a.ts', line: 1, to: 'line_end' } };
    const { result } = await rehearse(editor, testConfig, start(), [move], () => true);
    expect(result).toMatchObject({ status: 'failed', error: { message: UNREADABLE } });
  });
});
