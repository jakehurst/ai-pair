// The EditorPort for VS Code on its own (#176): documents, edits, who made a change, the agent cursor's decorations,
// the programmer's selection, and follow mode (specs/EditorAdapter.tla, specs/FollowMode.tla, specs/FileText.tla,
// specs/PointFocus.tla, specs/Scroll.tla). Solitary: the vscode module is a fake whose documents, editors, settings,
// and events the test drives; node:fs, core's MissingFile, samePath, and withinFolder, view.ts's arithmetic, and
// terminal.ts's PairTerminals are mocks; the controller is a typed fake.

import * as fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';
import { MissingFile, samePath, withinFolder, type Controller } from '@ai-pair/core';
import { LABEL_SEPARATOR } from '@ai-pair/core/constants';
import { VsCodeEditor } from '../src/editor';
import { comfortable, glideTop, isOwnEdit, landing, row, viewport } from '../src/view';

/** What the mocked modules share with the tests, made before the `vi.mock` factories run. */
const fakes = vi.hoisted(() => {
  /** Each event's listeners, by the event's name. */
  const listeners = new Map<string, Set<(value: unknown) => void>>();

  /** Returns an event's registration: it adds the listener, and its disposable takes it away. */
  function event(name: string): (listener: (value: unknown) => void) => { dispose: () => void } {
    return (listener) => {
      const set = listeners.get(name) ?? new Set();
      set.add(listener);
      listeners.set(name, set);
      return {
        dispose: () => {
          set.delete(listener);
        },
      };
    };
  }

  /** What the fakes made. */
  const created = {
    types: [] as FakeDecorationType[],
    edits: [] as FakeWorkspaceEdit[],
    terminals: [] as FakeTerminals[],
    /** The documents openTextDocument opened. */
    opened: [] as FakeDocument[],
  };

  /** The files on disk, by path. */
  const onDisk = new Set<string>();

  /** A position in a fake document: an offset is its line, so a test reads lines straight off offsets. */
  interface FakePosition {
    line: number;
    character: number;
  }

  /** A visible range, by its lines. */
  interface FakeLines {
    start: { line: number };
    end: { line: number };
  }

  /** A range as editor.ts makes one: the arguments it was made with. */
  class FakeRange {
    readonly args: unknown[];

    constructor(...args: unknown[]) {
      this.args = args;
    }
  }

  /** A document, faked: its path and scheme, its text, whether it is dirty, and how its save goes. */
  class FakeDocument {
    isDirty = false;
    /** VS Code's EndOfLine: 1 is LF, 2 is CRLF, as the fake module has them. */
    eol = 1;
    lineCount = 1000;
    /** What `getText` gives for a range: the programmer's selection. */
    selected = '';
    readonly uri: { scheme: string; fsPath: string };
    readonly save = vi.fn(() => Promise.resolve(true));

    constructor(
      fsPath: string,
      public text = '',
      scheme = 'file',
    ) {
      this.uri = { scheme, fsPath };
    }

    getText(range?: unknown): string {
      return range === undefined ? this.text : this.selected;
    }

    positionAt(offset: number): FakePosition {
      return { line: offset, character: 0 };
    }
  }

  /** The builder an editor's `edit` hands its callback. */
  interface FakeBuilder {
    replace: (range: FakeRange, text: string) => void;
  }

  /** A text editor, faked: its document, selection, visible ranges, and what it was asked to draw, edit, and reveal. */
  class FakeEditor {
    selection = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 }, isEmpty: true };
    visibleRanges: FakeLines[] = [];
    viewColumn: number | undefined = 1;
    /** Whether VS Code applies an edit. */
    applies = true;
    readonly builder = { replace: vi.fn<(range: FakeRange, text: string) => void>() };
    readonly setDecorations = vi.fn<(type: FakeDecorationType, ranges: FakeRange[]) => void>();
    readonly revealRange = vi.fn<(range: FakeRange, type: number) => void>();
    readonly edit = vi.fn<(build: (builder: FakeBuilder) => void, options: unknown) => Promise<boolean>>((build) => {
      build(this.builder);
      return Promise.resolve(this.applies);
    });

    constructor(readonly document: FakeDocument) {}
  }

  /** A decoration type, faked: the options it was made with, and its disposal. */
  class FakeDecorationType {
    readonly dispose = vi.fn();

    constructor(
      readonly options: {
        before?: { contentText: string; textDecoration: string };
        backgroundColor?: { id: string };
      },
    ) {}
  }

  /** A workspace edit, faked: its replacements. */
  class FakeWorkspaceEdit {
    readonly replace = vi.fn<(uri: unknown, range: FakeRange, text: string) => void>();

    constructor() {
      created.edits.push(this);
    }
  }

  /** The agent's terminals, faked: what `run` answers, and their disposal. */
  class FakeTerminals {
    readonly run = vi.fn((command: string) => Promise.resolve({ output: `ran ${command}` }));
    readonly dispose = vi.fn();

    constructor() {
      created.terminals.push(this);
    }
  }

  return {
    listeners,
    event,
    FakeRange,
    FakeDocument,
    FakeEditor,
    FakeDecorationType,
    FakeWorkspaceEdit,
    FakeTerminals,
    created,
    onDisk,
    /** VS Code's TextEditorRevealType, as the fake module has it. */
    reveal: { InCenter: 2, AtTop: 3 },
    /** VS Code's open documents. */
    documents: [] as FakeDocument[],
    /** VS Code's visible editors, and its active one. */
    visible: [] as FakeEditor[],
    active: undefined as FakeEditor | undefined,
    /** The workspace's folders; none until a test says. */
    folders: undefined as Array<{ uri: { fsPath: string } }> | undefined,
    /** The `editor` settings, by name. */
    settings: new Map<string, unknown>(),
    stat: vi.fn((uri: { fsPath: string }) =>
      onDisk.has(uri.fsPath) ? Promise.resolve({}) : Promise.reject(new Error(`ENOENT: ${uri.fsPath}`)),
    ),
    createDirectory: vi.fn((uri: { fsPath: string }) => Promise.resolve(uri)),
    writeFile: vi.fn((uri: { fsPath: string }, content: Uint8Array) => Promise.resolve({ uri, content })),
    openTextDocument: vi.fn((uri: { fsPath: string }) => {
      const doc = new FakeDocument(uri.fsPath, 'opened');
      created.opened.push(doc);
      return Promise.resolve(doc);
    }),
    applyEdit: vi.fn((edit: FakeWorkspaceEdit) => Promise.resolve(edit.replace.mock.calls.length > 0)),
    showTextDocument: vi.fn<(doc: FakeDocument, options: unknown) => Promise<void>>(() => Promise.resolve()),
  };
});

vi.mock('vscode', () => ({
  Uri: { file: (fsPath: string) => ({ scheme: 'file', fsPath }) },
  Range: fakes.FakeRange,
  ThemeColor: class {
    constructor(readonly id: string) {}
  },
  WorkspaceEdit: fakes.FakeWorkspaceEdit,
  DecorationRangeBehavior: { ClosedClosed: 1 },
  EndOfLine: { LF: 1, CRLF: 2 },
  TextEditorRevealType: fakes.reveal,
  window: {
    createTextEditorDecorationType: (options: InstanceType<typeof fakes.FakeDecorationType>['options']) => {
      const type = new fakes.FakeDecorationType(options);
      fakes.created.types.push(type);
      return type;
    },
    get activeTextEditor() {
      return fakes.active;
    },
    get visibleTextEditors() {
      return fakes.visible;
    },
    showTextDocument: fakes.showTextDocument,
    onDidChangeActiveTextEditor: fakes.event('active'),
    onDidChangeTextEditorVisibleRanges: fakes.event('visibleRanges'),
    onDidChangeVisibleTextEditors: fakes.event('visibleEditors'),
    onDidChangeTextEditorSelection: fakes.event('selection'),
  },
  workspace: {
    get textDocuments() {
      return fakes.documents;
    },
    get workspaceFolders() {
      return fakes.folders;
    },
    getConfiguration: () => ({
      get: (key: string, fallback: unknown) => (fakes.settings.has(key) ? fakes.settings.get(key) : fallback),
    }),
    openTextDocument: fakes.openTextDocument,
    applyEdit: fakes.applyEdit,
    fs: { stat: fakes.stat, createDirectory: fakes.createDirectory, writeFile: fakes.writeFile },
    onDidOpenTextDocument: fakes.event('open'),
    onDidCloseTextDocument: fakes.event('close'),
    onDidChangeTextDocument: fakes.event('change'),
  },
}));
vi.mock('node:fs', () => ({ readFileSync: vi.fn() }));
vi.mock('@ai-pair/core', () => ({
  MissingFile: class extends Error {
    constructor(readonly file: string) {
      super(`${file} is missing`);
    }
  },
  samePath: vi.fn((a: string, b: string) => a === b),
  withinFolder: vi.fn((folder: string, file: string) => (file.startsWith(`${folder}/`) ? file : undefined)),
}));
vi.mock('../src/view', () => ({
  comfortable: vi.fn(() => true),
  glideTop: vi.fn((from: number, to: number, t: number) => Math.round(from + (to - from) * t)),
  isOwnEdit: vi.fn(() => false),
  landing: vi.fn(() => 0),
  row: vi.fn(() => 0),
  viewport: vi.fn(() => undefined),
}));
vi.mock('../src/terminal', () => ({ PairTerminals: fakes.FakeTerminals }));

type FakeEditor = InstanceType<typeof fakes.FakeEditor>;
type FakeDocument = InstanceType<typeof fakes.FakeDocument>;
type FakeDecorationType = InstanceType<typeof fakes.FakeDecorationType>;

const ROOT = '/project';
const FILE = '/project/a.ts';
const OTHER = '/project/b.ts';
const OUTSIDE = '/elsewhere/c.ts';
const AGENT = 'Claude';

/** The keys of the cursor's and the label's decorations, in the order editor.ts makes them. */
const STATES = ['typing', 'read', 'readDim', 'thinking', 'running', 'paused', 'listening', 'navigator'];

/** How many decoration types come before the cursors: the selection's and the point's. */
const CURSORS_FROM = 2;

/** How often the read cursor pulses, as editor.ts has it. */
const PULSE_MS = 450;

/** How long view changes after our own navigation are ours, as editor.ts has it. */
const SELF_NAV_MS = 400;

/** With smooth scrolling, how long the visible ranges stay unchanged once our scroll is over, as editor.ts has it. */
const SCROLL_QUIET_MS = 50;

/** The longest editor.ts waits for its own scroll. */
const SCROLL_MAX_MS = 500;

/** A glide's frame, as editor.ts has it. */
const FRAME_MS = 16;

/** Where a shared selection is cut off, as editor.ts has it. */
const MAX_EXCERPT = 8000;

/** The lines above the target a reveal at the top leaves by default: sticky scroll's five. */
const STICKY_LINES = 5;

/** Fires event `name` with `value`. */
function fire(name: string, value: unknown): void {
  for (const listener of fakes.listeners.get(name) ?? []) {
    listener(value);
  }
}

/** Returns how many listeners event `name` has. */
function listening(name: string): number {
  return fakes.listeners.get(name)?.size ?? 0;
}

/** Makes the editor in ROOT for AGENT, over a mock controller, and returns both. */
function made() {
  const controller = mock<Controller>();
  const editor = new VsCodeEditor(ROOT, AGENT, () => controller);
  return { editor, controller };
}

/** Returns the item at `index`, which must be there. */
function at<T>(list: readonly T[], index: number): T {
  const item = list.at(index);
  if (item === undefined) throw new Error(`Nothing at ${index}.`);
  return item;
}

/** Returns the cursor's decoration type for `key`. */
function cursorType(key: string): FakeDecorationType {
  return at(fakes.created.types, CURSORS_FROM + STATES.indexOf(key));
}

/** Returns the latest label's decoration type for `key`. */
function labelType(key: string): FakeDecorationType {
  return at(fakes.created.types, fakes.created.types.length - STATES.length + STATES.indexOf(key));
}

/** Returns the ranges `editor` last drew with `type`. */
function drawn(editor: FakeEditor, type: FakeDecorationType): unknown[][] | undefined {
  const calls = editor.setDecorations.mock.calls.filter(([drawnType]) => drawnType === type);
  return calls.at(-1)?.[1].map((range) => range.args);
}

/** Returns a position in a fake document: an offset is its line. */
function pos(offset: number): { line: number; character: number } {
  return { line: offset, character: 0 };
}

/** Opens `file` in a visible editor whose view shows lines `top` through `bottom`, and returns the editor. */
function inView(file: string, top = 0, bottom = 39): FakeEditor {
  const doc = new fakes.FakeDocument(file, 'text');
  const editor = new fakes.FakeEditor(doc);
  editor.visibleRanges = [{ start: { line: top }, end: { line: bottom } }];
  fakes.documents.push(doc);
  fakes.visible.push(editor);
  return editor;
}

/** Makes `editor` answer each reveal with a change of its visible ranges, as VS Code does without smooth scrolling. */
function answering(editor: FakeEditor): void {
  editor.revealRange.mockImplementation(() => {
    fire('visibleRanges', { textEditor: editor, visibleRanges: editor.visibleRanges });
  });
}

/** Returns the lines `editor` was asked to reveal, each with how. */
function revealed(editor: FakeEditor): Array<[unknown, number]> {
  return editor.revealRange.mock.calls.map(([range, type]) => [range.args[0], type]);
}

/** Fires a change to `doc`, of `changes`, for `reason` if given. */
function changeOf(doc: FakeDocument, changes: Array<{ rangeOffset: number; rangeLength: number; text: string }>, reason?: number): void {
  fire('change', { document: doc, contentChanges: changes, reason });
}

/** Sets the view of the target's editor: out of view, with the landing `to` and a glide of `glideMs`. */
function outOfView(controller: ReturnType<typeof mock<Controller>>, to: number, glideMs: number): void {
  vi.mocked(viewport).mockReturnValue({ top: 0, rows: 40, atEnd: false, height: 40 });
  vi.mocked(row).mockReturnValue(100);
  vi.mocked(comfortable).mockReturnValue(false);
  vi.mocked(landing).mockReturnValue(to);
  controller.glideMs.mockReturnValue(glideMs);
}

beforeEach(() => {
  vi.useFakeTimers();
  fakes.folders = [{ uri: { fsPath: ROOT } }];
});

afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
  fakes.listeners.clear();
  fakes.settings.clear();
  fakes.onDisk.clear();
  fakes.documents.length = 0;
  fakes.visible.length = 0;
  fakes.active = undefined;
  fakes.created.types.length = 0;
  fakes.created.edits.length = 0;
  fakes.created.terminals.length = 0;
  fakes.created.opened.length = 0;
});

describe('the decorations', () => {
  it('makes a cursor and a label for each state, the label naming the agent and its state, and disposes them all', () => {
    const { editor } = made();
    expect(fakes.created.types).toHaveLength(CURSORS_FROM + 2 * STATES.length);
    expect(at(fakes.created.types, 0).options.backgroundColor).toEqual({ id: 'aiPair.selectionBackground' });
    expect(at(fakes.created.types, 1).options.backgroundColor).toEqual({ id: 'aiPair.pointBackground' });
    expect(cursorType('typing').options.before?.textDecoration).toContain('2px solid var(--vscode-aiPair-cursor);');
    expect(cursorType('read').options.before?.textDecoration).toContain('var(--vscode-aiPair-cursorRead)');
    expect(cursorType('paused').options.before?.textDecoration).toContain('dashed');
    expect(cursorType('thinking').options.before?.textDecoration).toContain('opacity: 0.45;');
    expect(labelType('typing').options.before?.contentText).toBe(AGENT);
    expect(labelType('running').options.before?.contentText).toBe(`${AGENT}${LABEL_SEPARATOR}running`);
    expect(labelType('navigator').options.before?.contentText).toBe(`${AGENT}${LABEL_SEPARATOR}your turn`);
    expect(labelType('read').options.before?.textDecoration).toContain('color: var(--vscode-aiPair-cursorReadForeground);');

    editor.dispose();
    for (const type of fakes.created.types) {
      expect(type.dispose.mock.calls).toHaveLength(1);
    }
    for (const name of ['open', 'close', 'change', 'active', 'visibleRanges', 'visibleEditors', 'selection']) {
      expect(listening(name)).toBe(0);
    }
    expect(at(fakes.created.terminals, 0).dispose.mock.calls).toHaveLength(1);
  });

  it('setAgentName disposes the old labels, makes new ones, and redraws', () => {
    const { editor } = made();
    const view = inView(FILE);
    const old = fakes.created.types.slice(-STATES.length);
    editor.setAgentName('Codex');
    for (const type of old) {
      expect(type.dispose.mock.calls).toHaveLength(1);
    }
    expect(labelType('paused').options.before?.contentText).toBe(`Codex${LABEL_SEPARATOR}paused`);
    expect(drawn(view, labelType('thinking'))).toEqual([]);
  });

  it('draws the cursor, its selection, and the point in the editor showing their file, and nothing elsewhere', () => {
    const { editor } = made();
    const here = inView(FILE);
    const there = inView(OTHER);
    editor.renderCursor({ file: FILE, offset: 5, selection: { start: 2, end: 5 } }, 'typing', 'cursor');
    expect(drawn(here, cursorType('typing'))).toEqual([[pos(5), pos(5)]]);
    expect(drawn(here, labelType('typing'))).toEqual([[pos(5), pos(5)]]);
    expect(drawn(here, cursorType('thinking'))).toEqual([]);
    expect(drawn(here, at(fakes.created.types, 0))).toEqual([[pos(2), pos(5)]]);
    expect(drawn(here, at(fakes.created.types, 1))).toEqual([]);
    expect(drawn(there, cursorType('typing'))).toEqual([]);

    editor.renderPoint({ file: FILE, start: 1, end: 3 });
    expect(drawn(here, at(fakes.created.types, 1))).toEqual([[pos(1), pos(3)]]);
    expect(drawn(there, at(fakes.created.types, 1))).toEqual([]);

    editor.renderCursor({ file: FILE, offset: 6 }, 'typing', 'cursor');
    expect(drawn(here, at(fakes.created.types, 0))).toEqual([]);
    editor.renderCursor(undefined, 'typing', 'cursor');
    expect(drawn(here, cursorType('typing'))).toEqual([]);
  });

  it('pulses the read cursor, dimming it every PULSE_MS, until the state changes', () => {
    const { editor } = made();
    const view = inView(FILE);
    const cursor = { file: FILE, offset: 1 };
    editor.renderCursor(cursor, 'read', 'cursor');
    expect(drawn(view, cursorType('read'))).toEqual([[pos(1), pos(1)]]);
    vi.advanceTimersByTime(PULSE_MS);
    expect(drawn(view, cursorType('readDim'))).toEqual([[pos(1), pos(1)]]);
    expect(drawn(view, cursorType('read'))).toEqual([]);
    vi.advanceTimersByTime(PULSE_MS);
    expect(drawn(view, cursorType('read'))).toEqual([[pos(1), pos(1)]]);

    editor.renderCursor(cursor, 'typing', 'cursor');
    const draws = view.setDecorations.mock.calls.length;
    vi.advanceTimersByTime(2 * PULSE_MS);
    expect(view.setDecorations.mock.calls).toHaveLength(draws);
    expect(drawn(view, cursorType('typing'))).toEqual([[pos(1), pos(1)]]);
  });

  it('stops the pulse on dispose', () => {
    const { editor } = made();
    const view = inView(FILE);
    editor.renderCursor({ file: FILE, offset: 1 }, 'read', 'cursor');
    editor.dispose();
    const draws = view.setDecorations.mock.calls.length;
    vi.advanceTimersByTime(PULSE_MS);
    expect(view.setDecorations.mock.calls).toHaveLength(draws);
  });

  it('measures and redraws the editors when the visible editors change', () => {
    made();
    const view = inView(FILE, 10, 49);
    fire('visibleEditors', [view]);
    expect(vi.mocked(viewport).mock.lastCall).toEqual([[{ start: 10, end: 49 }], 1000, undefined]);
    expect(drawn(view, cursorType('thinking'))).toEqual([]);
  });
});

describe('paths', () => {
  it('resolves a path to the open document of that file, as VS Code spells it, passing over other schemes', () => {
    fakes.documents.push(new fakes.FakeDocument(FILE, '', 'untitled'), new fakes.FakeDocument('/project/A.ts'));
    vi.mocked(samePath).mockImplementation((a, b) => a.toLowerCase() === b.toLowerCase());
    const { editor } = made();
    expect(editor.resolvePath('a.ts')).toBe('/project/A.ts');
    expect(vi.mocked(samePath).mock.calls).toEqual([['/project/A.ts', FILE]]);
  });

  it('resolves a path with no open document by the workspace folder it is in, else as it is', () => {
    const { editor } = made();
    fakes.folders = [{ uri: { fsPath: '/other' } }, { uri: { fsPath: ROOT } }];
    vi.mocked(withinFolder).mockImplementation((folder, file) => (folder === ROOT ? `/Project${file.slice(ROOT.length)}` : undefined));
    expect(editor.resolvePath('src/x.ts')).toBe('/Project/src/x.ts');
    vi.mocked(withinFolder).mockReturnValue(undefined);
    expect(editor.resolvePath('src/x.ts')).toBe('/project/src/x.ts');
    fakes.folders = undefined;
    expect(editor.resolvePath('/elsewhere/x.ts')).toBe('/elsewhere/x.ts');
  });

  it('displays a workspace file by its path in the workspace, and any other by its own', () => {
    const { editor } = made();
    expect(editor.displayPath('/project/src/a.ts')).toBe('src/a.ts');
    expect(editor.displayPath(OUTSIDE)).toBe(OUTSIDE);
  });
});

describe('reading files', () => {
  it('NotStale: takes the text of a document with unsaved changes, whether its file exists or not', async () => {
    const doc = new fakes.FakeDocument(FILE, 'unsaved');
    doc.isDirty = true;
    fakes.documents.push(doc);
    const { editor } = made();
    await expect(editor.getText(FILE)).resolves.toBe('unsaved');
    expect(fakes.stat.mock.calls).toEqual([]);
  });

  it("MissingIsReported: reports a file that isn't on disk as missing, whatever document VS Code kept", async () => {
    fakes.documents.push(new fakes.FakeDocument(FILE, 'kept'));
    const { editor } = made();
    await expect(editor.getText(FILE)).rejects.toThrow(MissingFile);
    await expect(editor.getText(OTHER)).rejects.toMatchObject({ file: OTHER });
  });

  it('takes a file on disk from its document, or from one opened for it', async () => {
    fakes.documents.push(new fakes.FakeDocument(FILE, 'kept'));
    fakes.onDisk.add(FILE).add(OTHER);
    const { editor } = made();
    await expect(editor.getText(FILE)).resolves.toBe('kept');
    expect(fakes.openTextDocument.mock.calls).toEqual([]);
    await expect(editor.getText(OTHER)).resolves.toBe('opened');
    expect(fakes.openTextDocument.mock.calls).toEqual([[{ scheme: 'file', fsPath: OTHER }]]);
  });

  it("gives a document's line ending", async () => {
    const doc = new fakes.FakeDocument(FILE);
    fakes.documents.push(doc);
    fakes.onDisk.add(FILE);
    const { editor } = made();
    await expect(editor.eol(FILE)).resolves.toBe('\n');
    doc.eol = 2;
    await expect(editor.eol(FILE)).resolves.toBe('\r\n');
  });

  it('says whether a file has unsaved changes, with no document as none', async () => {
    const doc = new fakes.FakeDocument(FILE);
    doc.isDirty = true;
    fakes.documents.push(doc);
    const { editor } = made();
    await expect(editor.isDirty(FILE)).resolves.toBe(true);
    await expect(editor.isDirty(OTHER)).resolves.toBe(false);
  });
});

describe('show', () => {
  it('opens a file out of view in the active editor group, as a tab of its own, without taking focus', async () => {
    fakes.onDisk.add(FILE);
    const active = inView(OTHER);
    active.viewColumn = 2;
    fakes.active = active;
    const { editor } = made();
    await editor.show(FILE);
    const doc = at(fakes.created.opened, 0);
    expect(fakes.showTextDocument.mock.calls).toEqual([[doc, { preview: false, preserveFocus: true, viewColumn: 2 }]]);
    fakes.active = undefined;
    await editor.show(FILE);
    expect(fakes.showTextDocument.mock.lastCall?.[1]).toEqual({ preview: false, preserveFocus: true, viewColumn: undefined });
  });

  it('leaves a file already in view as it is', async () => {
    fakes.onDisk.add(FILE);
    inView(FILE);
    const { editor } = made();
    await editor.show(FILE);
    expect(fakes.openTextDocument.mock.calls).toEqual([]);
    expect(fakes.showTextDocument.mock.calls).toEqual([]);
  });

  it('CreatedIsEmpty: creates a missing file empty, with its folder, and says it wrote it', async () => {
    fakes.documents.push(new fakes.FakeDocument(OTHER, ''));
    const { editor } = made();
    await editor.show(OTHER);
    const wrote = vi.fn<(file: string, text: string) => void>();
    editor.wrote = wrote;
    await editor.show('/project/src/new.ts');
    expect(fakes.createDirectory.mock.calls).toEqual([[{ scheme: 'file', fsPath: ROOT }], [{ scheme: 'file', fsPath: '/project/src' }]]);
    expect(wrote.mock.calls).toEqual([['/project/src/new.ts', '']]);
    expect(fakes.writeFile.mock.calls).toEqual([
      [{ scheme: 'file', fsPath: OTHER }, new Uint8Array()],
      [{ scheme: 'file', fsPath: '/project/src/new.ts' }, new Uint8Array()],
    ]);
    expect(fakes.showTextDocument.mock.calls).toHaveLength(2);
  });

  it('CreatedIsEmpty: empties and saves the document VS Code kept for a deleted file', async () => {
    const doc = new fakes.FakeDocument(FILE, 'old');
    fakes.documents.push(doc);
    const { editor } = made();
    await editor.show(FILE);
    expect(at(fakes.created.edits, 0).replace.mock.calls.map(([uri, range, text]) => [uri, range.args, text])).toEqual([
      [doc.uri, [pos(0), pos(3)], ''],
    ]);
    expect(doc.save.mock.calls).toHaveLength(1);
    expect(fakes.writeFile.mock.calls).toEqual([]);
    expect(fakes.showTextDocument.mock.calls).toHaveLength(1);
  });

  it("fails when the document VS Code kept for a deleted file doesn't save", async () => {
    const doc = new fakes.FakeDocument(FILE, 'old');
    doc.save.mockResolvedValue(false);
    fakes.documents.push(doc);
    const { editor } = made();
    await expect(editor.show(FILE)).rejects.toThrow(`Couldn't create ${FILE}.`);
    expect(fakes.showTextDocument.mock.calls).toEqual([]);
  });

  it("KeepsUnsavedProp: leaves a deleted file's document with unsaved changes as it is, and shows it", async () => {
    const doc = new fakes.FakeDocument(FILE, 'unsaved');
    doc.isDirty = true;
    fakes.documents.push(doc);
    const { editor } = made();
    await editor.show(FILE);
    expect(fakes.created.edits).toEqual([]);
    expect(doc.save.mock.calls).toEqual([]);
    expect(fakes.writeFile.mock.calls).toEqual([]);
    expect(fakes.showTextDocument.mock.calls).toHaveLength(1);
  });
});

describe('follow mode: looking away', () => {
  it('NoPauseFromOurOwnShow, MoveEnds: a change of active editor during our show, or SELF_NAV_MS after, pauses nothing; LookAwayPauses: one later pauses', async () => {
    fakes.onDisk.add(OTHER);
    const { editor, controller } = made();
    const there = new fakes.FakeEditor(new fakes.FakeDocument(OTHER));
    editor.renderCursor({ file: FILE, offset: 0 }, 'typing', 'cursor');
    const shown = Promise.withResolvers<void>();
    fakes.showTextDocument.mockReturnValue(shown.promise);
    const showing = editor.show(OTHER);
    await vi.advanceTimersByTimeAsync(0);
    fire('active', there);
    await vi.advanceTimersByTimeAsync(10 * SELF_NAV_MS);
    fire('active', there);
    shown.resolve();
    await showing;
    await vi.advanceTimersByTimeAsync(SELF_NAV_MS - 1);
    fire('active', there);
    expect(controller.pause.mock.calls).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    fire('active', there);
    expect(controller.pause.mock.calls).toEqual([['away']]);
    editor.renderCursor({ file: OTHER, offset: 0 }, 'typing', 'cursor');
    fire('active', there);
    expect(controller.pause.mock.calls).toEqual([['away']]);
  });

  it('LookAwayPauses: follows the point when the focus is on it, and the cursor when there is no point', () => {
    const { editor, controller } = made();
    const here = new fakes.FakeEditor(new fakes.FakeDocument(FILE));
    const there = new fakes.FakeEditor(new fakes.FakeDocument(OTHER));
    editor.renderCursor({ file: FILE, offset: 0 }, 'typing', 'point');
    fire('active', there);
    expect(controller.pause.mock.calls).toEqual([['away']]);
    editor.renderPoint({ file: OTHER, start: 0, end: 1 });
    fire('active', there);
    fire('active', here);
    expect(controller.pause.mock.calls).toEqual([['away'], ['away']]);
  });

  it("CloseTab: pauses nothing with no editor active, no target, or a state that doesn't follow", () => {
    const { editor, controller } = made();
    const there = new fakes.FakeEditor(new fakes.FakeDocument(OTHER, '', 'output'));
    fire('active', there);
    editor.renderCursor({ file: FILE, offset: 0 }, 'running', 'cursor');
    fire('active', there);
    editor.renderCursor({ file: FILE, offset: 0 }, 'typing', 'cursor');
    fire('active', undefined);
    expect(controller.pause.mock.calls).toEqual([]);
    fire('active', there);
    expect(controller.pause.mock.calls).toEqual([['away']]);
  });

  it('pauses as away when the programmer scrolls the target out of view, measuring the view each time', () => {
    const { editor, controller } = made();
    const view = inView(FILE);
    editor.renderCursor({ file: FILE, offset: 50 }, 'typing', 'cursor');
    const ranges = [
      { start: { line: 0 }, end: { line: 10 } },
      { start: { line: 60 }, end: { line: 70 } },
    ];
    fire('visibleRanges', { textEditor: view, visibleRanges: ranges });
    expect(controller.pause.mock.calls).toEqual([['away']]);
    fire('visibleRanges', { textEditor: view, visibleRanges: [{ start: { line: 40 }, end: { line: 60 } }] });
    expect(controller.pause.mock.calls).toEqual([['away']]);
    expect(vi.mocked(viewport).mock.calls).toHaveLength(2);
  });

  it("pauses nothing for a scroll elsewhere, during our own navigation, with no target, or a state that doesn't follow", async () => {
    const { editor, controller } = made();
    const view = inView(FILE);
    const other = inView(OTHER);
    const away = { textEditor: view, visibleRanges: [{ start: { line: 0 }, end: { line: 1 } }] };
    fire('visibleRanges', away);
    editor.renderCursor({ file: FILE, offset: 50 }, 'running', 'cursor');
    fire('visibleRanges', away);
    editor.renderCursor({ file: FILE, offset: 50 }, 'typing', 'cursor');
    fire('visibleRanges', { textEditor: other, visibleRanges: away.visibleRanges });
    fakes.onDisk.add(FILE);
    fakes.visible.length = 0;
    await editor.show(FILE);
    fire('visibleRanges', away);
    expect(controller.pause.mock.calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(SELF_NAV_MS);
    fire('visibleRanges', away);
    expect(controller.pause.mock.calls).toEqual([['away']]);
  });
});

describe("the programmer's selection", () => {
  it('shares the selection in a workspace file by its lines, and its text cut off at MAX_EXCERPT', () => {
    const { editor } = made();
    const view = inView(FILE);
    view.selection = { start: { line: 2, character: 4 }, end: { line: 5, character: 0 }, isEmpty: false };
    view.document.selected = 'abc';
    const onSelection = vi.fn<(ref: unknown) => void>();
    editor.onSelection = onSelection;
    fire('selection', { textEditor: view });
    expect(onSelection.mock.calls).toEqual([[{ file: 'a.ts', line: 3, endLine: 6 }]]);
    expect(editor.programmerSelection()).toEqual({ file: FILE, from: { line: 3, column: 5 }, to: { line: 6, column: 1 }, text: 'abc' });

    view.document.selected = 'x'.repeat(MAX_EXCERPT + 1);
    expect(editor.programmerSelection()).toEqual({
      file: FILE,
      from: { line: 3, column: 5 },
      to: { line: 6, column: 1 },
      text: 'x'.repeat(MAX_EXCERPT),
      truncated: true,
    });
  });

  it('tells onSelection only when the selected lines change, and from the editor made active', () => {
    const { editor } = made();
    const view = inView(FILE);
    const onSelection = vi.fn<(ref: unknown) => void>();
    editor.onSelection = onSelection;
    fire('selection', { textEditor: view });
    expect(onSelection.mock.calls).toEqual([]);
    view.selection = { start: { line: 1, character: 0 }, end: { line: 1, character: 3 }, isEmpty: false };
    fire('selection', { textEditor: view });
    fire('selection', { textEditor: view });
    expect(onSelection.mock.calls).toEqual([[{ file: 'a.ts', line: 2, endLine: 2 }]]);
    fire('selection', { textEditor: new fakes.FakeEditor(new fakes.FakeDocument('output', '', 'output')) });
    expect(onSelection.mock.calls).toHaveLength(1);
    view.selection = { start: { line: 1, character: 0 }, end: { line: 1, character: 0 }, isEmpty: true };
    fire('active', view);
    expect(onSelection.mock.calls).toEqual([[{ file: 'a.ts', line: 2, endLine: 2 }], [undefined]]);

    editor.onSelection = undefined;
    view.selection = { start: { line: 4, character: 0 }, end: { line: 4, character: 3 }, isEmpty: false };
    expect(() => {
      fire('selection', { textEditor: view });
    }).not.toThrow();
  });

  it('shares nothing with no editor seen, one out of view, another scheme, a file outside the workspace, or nothing selected', () => {
    expect(made().editor.programmerSelection()).toBeUndefined();

    const untitled = new fakes.FakeEditor(new fakes.FakeDocument('Untitled-1', '', 'untitled'));
    untitled.selection = { start: { line: 0, character: 0 }, end: { line: 0, character: 1 }, isEmpty: false };
    fakes.visible.push(untitled);
    fakes.active = untitled;
    const { editor } = made();
    expect(editor.programmerSelection()).toBeUndefined();
    expect(editor.selectionRef()).toBeUndefined();

    const outside = inView(OUTSIDE);
    outside.selection = untitled.selection;
    fire('selection', { textEditor: outside });
    expect(editor.programmerSelection()).toBeUndefined();

    const hidden = new fakes.FakeEditor(new fakes.FakeDocument(FILE));
    hidden.selection = untitled.selection;
    fire('selection', { textEditor: hidden });
    expect(editor.programmerSelection()).toBeUndefined();

    fire('selection', { textEditor: inView(FILE) });
    expect(editor.programmerSelection()).toBeUndefined();
  });
});

describe('who made a change', () => {
  it("RightAuthor, ChangesHandled: reports a keystroke as the programmer's, its changes from the highest offset down", () => {
    const doc = new fakes.FakeDocument(FILE, 'abc');
    fakes.documents.push(doc);
    const { controller } = made();
    doc.isDirty = true;
    doc.text = 'aXbcY';
    changeOf(doc, [
      { rangeOffset: 1, rangeLength: 0, text: 'X' },
      { rangeOffset: 3, rangeLength: 0, text: 'Y' },
    ]);
    expect(controller.userEdit.mock.calls).toEqual([
      [
        FILE,
        'abc',
        'aXbcY',
        [
          { offset: 3, deleteLength: 0, text: 'Y' },
          { offset: 1, deleteLength: 0, text: 'X' },
        ],
      ],
    ]);
    expect(controller.otherEdit.mock.calls).toEqual([]);
  });

  it("RightAuthor: reports a reload from disk, read without its BOM, as others'", () => {
    const doc = new fakes.FakeDocument(FILE, 'old');
    fakes.documents.push(doc);
    const { controller } = made();
    doc.text = 'new';
    vi.mocked(fs.readFileSync).mockReturnValue('\uFEFFnew');
    changeOf(doc, [{ rangeOffset: 0, rangeLength: 3, text: 'new' }]);
    expect(controller.otherEdit.mock.calls).toEqual([[FILE, 'old', 'new', [{ offset: 0, deleteLength: 3, text: 'new' }]]]);
    expect(vi.mocked(fs.readFileSync).mock.calls).toEqual([[FILE, 'utf8']]);
    expect(controller.userEdit.mock.calls).toEqual([]);
  });

  it("RightAuthor: counts as the programmer's a clean change that isn't what's on disk, an unreadable file, and an undo", () => {
    const doc = new fakes.FakeDocument(FILE, 'old');
    fakes.documents.push(doc);
    const { controller } = made();
    doc.text = 'new';
    vi.mocked(fs.readFileSync).mockReturnValue('other');
    changeOf(doc, [{ rangeOffset: 0, rangeLength: 3, text: 'new' }]);
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('ENOENT');
    });
    changeOf(doc, [{ rangeOffset: 0, rangeLength: 3, text: 'new' }]);
    changeOf(doc, [{ rangeOffset: 0, rangeLength: 3, text: 'new' }], /* reason= */ 1);
    expect(controller.userEdit.mock.calls).toHaveLength(3);
    expect(vi.mocked(fs.readFileSync).mock.calls).toHaveLength(2);
  });

  it("RightAuthor, ChangesHandled: reports changes while we save as others', and after it as the programmer's", async () => {
    const doc = new fakes.FakeDocument(FILE, 'a');
    fakes.documents.push(doc);
    fakes.onDisk.add(FILE);
    const { editor, controller } = made();
    doc.isDirty = true;
    doc.save.mockImplementation(() => {
      doc.text = 'b';
      changeOf(doc, [{ rangeOffset: 0, rangeLength: 1, text: 'b' }]);
      return Promise.resolve(true);
    });
    await editor.save(FILE);
    expect(fakes.stat.mock.calls).toEqual([[doc.uri]]);
    expect(controller.otherEdit.mock.calls).toEqual([[FILE, 'a', 'b', [{ offset: 0, deleteLength: 1, text: 'b' }]]]);
    doc.text = 'c';
    changeOf(doc, [{ rangeOffset: 0, rangeLength: 1, text: 'c' }]);
    expect(controller.userEdit.mock.calls).toEqual([[FILE, 'b', 'c', [{ offset: 0, deleteLength: 1, text: 'c' }]]]);
  });

  it("fails a save the editor didn't make, and saves nothing with no document or no unsaved changes", async () => {
    fakes.onDisk.add(FILE);
    const doc = new fakes.FakeDocument(FILE, 'a');
    fakes.documents.push(doc);
    const { editor } = made();
    await editor.save(FILE);
    await editor.save(OTHER);
    expect(fakes.stat.mock.calls).toEqual([]);
    doc.isDirty = true;
    doc.save.mockResolvedValue(false);
    await expect(editor.save(FILE)).rejects.toThrow("the editor didn't save it; the file on disk may have changed");
  });

  it("ignores other schemes, no changes, files outside the workspace, and a document it hasn't opened until it has", () => {
    const untitled = new fakes.FakeDocument('Untitled-1', 'a', 'untitled');
    const outside = new fakes.FakeDocument(OUTSIDE, 'a');
    fakes.documents.push(untitled, outside);
    const { controller } = made();
    const unopened = new fakes.FakeDocument(FILE, 'a');
    unopened.isDirty = true;
    outside.isDirty = true;
    untitled.isDirty = true;
    const keystroke = [{ rangeOffset: 0, rangeLength: 0, text: 'x' }];
    changeOf(untitled, keystroke);
    changeOf(outside, keystroke);
    changeOf(unopened, []);
    changeOf(unopened, keystroke);
    changeOf(unopened, keystroke);
    expect(controller.userEdit.mock.calls).toEqual([]);
    fire('open', unopened);
    fire('open', untitled);
    fire('open', outside);
    changeOf(unopened, keystroke);
    expect(controller.userEdit.mock.calls).toHaveLength(1);

    fire('close', unopened);
    changeOf(unopened, keystroke);
    expect(controller.userEdit.mock.calls).toHaveLength(1);
    fire('open', unopened);
    changeOf(unopened, keystroke);
    changeOf(outside, keystroke);
    changeOf(untitled, keystroke);
    expect(controller.userEdit.mock.calls).toHaveLength(2);
  });
});

describe('edit', () => {
  it('RightAuthor: edits a file in view through its editor, with its undo stops, and takes its change event for its own', async () => {
    const view = inView(FILE);
    const { editor, controller } = made();
    view.document.isDirty = true;
    const options = { undoStopBefore: false, undoStopAfter: true };
    view.edit.mockImplementation((build) => {
      build(view.builder);
      changeOf(view.document, [{ rangeOffset: 2, rangeLength: 3, text: 'xy' }]);
      return Promise.resolve(true);
    });
    vi.mocked(isOwnEdit).mockReturnValueOnce(true);
    await editor.edit(FILE, 2, 3, 'xy', options);
    expect(view.edit.mock.calls[0]?.[1]).toBe(options);
    expect(view.builder.replace.mock.calls.map(([range, text]) => [range.args, text])).toEqual([[[pos(2), pos(5)], 'xy']]);
    expect(vi.mocked(isOwnEdit).mock.calls).toEqual([
      [[{ offset: 2, deleteLength: 3, text: 'xy' }], { offset: 2, deleteLength: 3, text: 'xy' }],
    ]);
    expect(controller.userEdit.mock.calls).toEqual([]);

    changeOf(view.document, [{ rangeOffset: 0, rangeLength: 0, text: 'z' }]);
    expect(vi.mocked(isOwnEdit).mock.lastCall?.[1]).toBeUndefined();
    expect(controller.userEdit.mock.calls).toHaveLength(1);
  });

  it('rejects an edit its editor refuses, and forgets it', async () => {
    const { editor } = made();
    const view = inView(FILE);
    view.applies = false;
    await expect(editor.edit(FILE, 0, 0, 'x', { undoStopBefore: true, undoStopAfter: true })).rejects.toThrow('The edit was rejected.');
    changeOf(view.document, [{ rangeOffset: 0, rangeLength: 0, text: 'x' }]);
    expect(vi.mocked(isOwnEdit).mock.lastCall?.[1]).toBeUndefined();
  });

  it('edits a file out of view as a workspace edit, opening it if VS Code has no document, and rejects one VS Code refuses', async () => {
    const doc = new fakes.FakeDocument(FILE, 'abc');
    fakes.documents.push(doc);
    fakes.onDisk.add(OTHER);
    const { editor } = made();
    const options = { undoStopBefore: true, undoStopAfter: true };
    await editor.edit(FILE, 1, 1, 'z', options);
    await editor.edit(OTHER, 0, 0, 'y', options);
    const opened = at(fakes.created.opened, 0);
    expect(fakes.created.edits.map((edit) => edit.replace.mock.calls.map(([uri, range, text]) => [uri, range.args, text]))).toEqual([
      [[doc.uri, [pos(1), pos(2)], 'z']],
      [[opened.uri, [pos(0), pos(0)], 'y']],
    ]);
    fakes.applyEdit.mockResolvedValue(false);
    await expect(editor.edit(OTHER, 0, 0, 'x', options)).rejects.toThrow('The edit was rejected.');
  });
});

describe('runCommand', () => {
  it("runs a command in the agent's terminals", async () => {
    const { editor } = made();
    const options = { cwd: ROOT, waitMs: 1, signal: new AbortController().signal };
    await expect(editor.runCommand('ls', options)).resolves.toEqual({ output: 'ran ls' });
    expect(at(fakes.created.terminals, 0).run.mock.calls).toEqual([['ls', options]]);
  });
});

describe('follow mode: scrolling', () => {
  it('ComesInView: glides the target to a third of the way down, a frame at a time, leaving room for sticky scroll', async () => {
    const { editor, controller } = made();
    const view = inView(FILE);
    answering(view);
    outOfView(controller, 87, 4 * FRAME_MS);
    editor.renderCursor({ file: FILE, offset: 100 }, 'typing', 'cursor');
    editor.follow();
    await vi.advanceTimersByTimeAsync(4 * FRAME_MS);
    expect(vi.mocked(row).mock.calls[0]).toEqual([[{ start: 0, end: 39 }], 100]);
    expect(vi.mocked(landing).mock.calls[0]).toEqual([100, 40, 1000, true]);
    expect(controller.glideMs.mock.calls).toEqual([[87]]);
    expect(revealed(view)).toEqual([
      [22 + STICKY_LINES, fakes.reveal.AtTop],
      [44 + STICKY_LINES, fakes.reveal.AtTop],
      [65 + STICKY_LINES, fakes.reveal.AtTop],
      [87 + STICKY_LINES, fakes.reveal.AtTop],
    ]);
    expect(listening('visibleRanges')).toBe(1);
  });

  it('waits a frame without revealing when the glide has not moved a line', async () => {
    const { editor, controller } = made();
    const view = inView(FILE);
    answering(view);
    outOfView(controller, 10, 2 * FRAME_MS);
    vi.mocked(glideTop).mockReturnValueOnce(0);
    editor.renderCursor({ file: FILE, offset: 100 }, 'typing', 'cursor');
    editor.follow();
    await vi.advanceTimersByTimeAsync(2 * FRAME_MS);
    expect(revealed(view)).toEqual([[10 + STICKY_LINES, fakes.reveal.AtTop]]);
  });

  it('leaves room for the surrounding lines, and none for sticky scroll when it is off, up to half the view', async () => {
    const { editor, controller } = made();
    const view = inView(FILE);
    answering(view);
    outOfView(controller, 10, FRAME_MS);
    fakes.settings.set('stickyScroll.enabled', false);
    fakes.settings.set('cursorSurroundingLines', 3);
    editor.renderCursor({ file: FILE, offset: 100 }, 'typing', 'cursor');
    editor.follow();
    await vi.advanceTimersByTimeAsync(FRAME_MS);
    vi.mocked(viewport).mockReturnValue({ top: 0, rows: 4, atEnd: false, height: 4 });
    editor.renderCursor({ file: FILE, offset: 101 }, 'typing', 'cursor');
    editor.follow();
    await vi.advanceTimersByTimeAsync(FRAME_MS);
    expect(revealed(view)).toEqual([
      [13, fakes.reveal.AtTop],
      [12, fakes.reveal.AtTop],
    ]);
  });

  it('jumps at once with smooth scrolling, and waits for the scroll to go quiet, or SCROLL_MAX_MS at most', async () => {
    const { editor, controller } = made();
    const view = inView(FILE);
    const other = inView(OTHER);
    outOfView(controller, 87, 4 * FRAME_MS);
    fakes.settings.set('smoothScrolling', true);
    editor.renderCursor({ file: FILE, offset: 100 }, 'typing', 'cursor');
    editor.follow();
    expect(revealed(view)).toEqual([[87 + STICKY_LINES, fakes.reveal.AtTop]]);
    expect(listening('visibleRanges')).toBe(2);
    fire('visibleRanges', { textEditor: other, visibleRanges: other.visibleRanges });
    await vi.advanceTimersByTimeAsync(SCROLL_QUIET_MS - 1);
    fire('visibleRanges', { textEditor: view, visibleRanges: view.visibleRanges });
    await vi.advanceTimersByTimeAsync(SCROLL_QUIET_MS - 1);
    expect(listening('visibleRanges')).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(listening('visibleRanges')).toBe(1);

    editor.follow();
    expect(listening('visibleRanges')).toBe(2);
    for (let waited = 0; waited < SCROLL_MAX_MS - SCROLL_QUIET_MS; waited += SCROLL_QUIET_MS - 1) {
      fire('visibleRanges', { textEditor: view, visibleRanges: view.visibleRanges });
      await vi.advanceTimersByTimeAsync(SCROLL_QUIET_MS - 1);
    }
    expect(listening('visibleRanges')).toBe(2);
    await vi.advanceTimersByTimeAsync(SCROLL_MAX_MS);
    expect(listening('visibleRanges')).toBe(1);
  });

  it("ignores another editor's scroll while waiting for its own, and waits SCROLL_QUIET_MS for one VS Code doesn't report", async () => {
    const { editor, controller } = made();
    fakes.settings.set('smoothScrolling', true);
    const view = inView(FILE);
    const other = inView(OTHER);
    outOfView(controller, 87, 4 * FRAME_MS);
    editor.renderCursor({ file: FILE, offset: 100 }, 'typing', 'cursor');
    editor.follow();
    expect(revealed(view)).toEqual([[87 + STICKY_LINES, fakes.reveal.AtTop]]);
    fire('visibleRanges', { textEditor: other, visibleRanges: other.visibleRanges });
    expect(listening('visibleRanges')).toBe(2);
    await vi.advanceTimersByTimeAsync(SCROLL_QUIET_MS);
    expect(listening('visibleRanges')).toBe(1);
  });

  it('keeps the view as it is with the target comfortable, at its landing, out of view, not measured, or not followed', async () => {
    const { editor, controller } = made();
    const view = inView(FILE);
    answering(view);
    editor.follow();
    editor.renderCursor({ file: FILE, offset: 100 }, 'typing', 'cursor');
    editor.follow();
    outOfView(controller, 87, FRAME_MS);
    vi.mocked(comfortable).mockReturnValueOnce(true);
    editor.follow();
    vi.mocked(landing).mockReturnValueOnce(0);
    editor.follow();
    vi.mocked(viewport).mockReturnValueOnce({ top: 960, rows: 40, atEnd: true, height: undefined });
    editor.follow();
    vi.mocked(viewport).mockReturnValueOnce(undefined);
    editor.follow();
    editor.renderCursor({ file: OTHER, offset: 100 }, 'typing', 'cursor');
    editor.follow();
    editor.renderCursor({ file: FILE, offset: 100 }, 'paused', 'cursor');
    editor.follow();
    await vi.advanceTimersByTimeAsync(SCROLL_MAX_MS);
    expect(revealed(view)).toEqual([]);
  });

  it('measures the viewport at a document end on the way: first to the middle, then gliding from where it was', async () => {
    const { editor, controller } = made();
    const view = inView(FILE, 960, 999);
    outOfView(controller, 970, 2 * FRAME_MS);
    vi.mocked(viewport).mockReturnValue({ top: 960, rows: 40, atEnd: true, height: undefined });
    vi.mocked(row).mockReturnValueOnce(-50).mockReturnValueOnce(25);
    view.revealRange.mockImplementation((...[, type]) => {
      if (type === fakes.reveal.InCenter) view.visibleRanges = [{ start: { line: 965 }, end: { line: 999 } }];
      fire('visibleRanges', { textEditor: view, visibleRanges: view.visibleRanges });
    });
    editor.renderCursor({ file: FILE, offset: 990 }, 'typing', 'cursor');
    editor.follow();
    await vi.advanceTimersByTimeAsync(2 * FRAME_MS);
    expect(revealed(view)).toEqual([
      [990, fakes.reveal.InCenter],
      [960 + STICKY_LINES, fakes.reveal.AtTop],
      [965 + STICKY_LINES, fakes.reveal.AtTop],
      [970 + STICKY_LINES, fakes.reveal.AtTop],
    ]);
    expect(vi.mocked(landing).mock.lastCall).toEqual([990, 50, 1000, true]);
    fire('visibleRanges', { textEditor: view, visibleRanges: view.visibleRanges });
    expect(vi.mocked(viewport).mock.lastCall?.[2]).toBe(50);
  });

  it("glides by the rows in view at a document's end when the editor doesn't scroll beyond it", async () => {
    const { editor, controller } = made();
    const view = inView(FILE, 960, 999);
    answering(view);
    outOfView(controller, 965, FRAME_MS);
    fakes.settings.set('scrollBeyondLastLine', false);
    vi.mocked(viewport).mockReturnValue({ top: 960, rows: 40, atEnd: true, height: undefined });
    vi.mocked(row).mockReturnValue(-5);
    editor.renderCursor({ file: FILE, offset: 955 }, 'typing', 'cursor');
    editor.follow();
    await vi.advanceTimersByTimeAsync(FRAME_MS);
    expect(vi.mocked(landing).mock.lastCall).toEqual([955, 40, 1000, false]);
    expect(revealed(view)).toEqual([[965 + STICKY_LINES, fakes.reveal.AtTop]]);
  });

  it('stops after measuring when the view stays at the top, has no lines, or the target left the file', async () => {
    const { editor, controller } = made();
    const view = inView(FILE, 0, 30);
    outOfView(controller, 10, FRAME_MS);
    vi.mocked(viewport).mockReturnValue({ top: 0, rows: 31, atEnd: true, height: undefined });
    vi.mocked(row).mockReturnValue(-1);
    const answers = [
      () => {
        view.visibleRanges = [];
      },
      () => {
        view.visibleRanges = [{ start: { line: 0 }, end: { line: 30 } }];
      },
      () => {
        view.visibleRanges = [{ start: { line: 5 }, end: { line: 30 } }];
        editor.renderCursor({ file: OTHER, offset: 0 }, 'typing', 'cursor');
      },
      () => {
        view.visibleRanges = [{ start: { line: 5 }, end: { line: 30 } }];
        editor.renderCursor(undefined, 'typing', 'cursor');
      },
    ];
    for (const answer of answers) {
      view.revealRange.mockImplementationOnce(() => {
        answer();
        fire('visibleRanges', { textEditor: view, visibleRanges: view.visibleRanges });
      });
      view.visibleRanges = [{ start: { line: 0 }, end: { line: 30 } }];
      editor.renderCursor({ file: FILE, offset: 20 }, 'typing', 'cursor');
      editor.follow();
      await vi.advanceTimersByTimeAsync(SCROLL_MAX_MS);
    }
    expect(revealed(view)).toEqual([
      [20, fakes.reveal.InCenter],
      [20, fakes.reveal.InCenter],
      [20, fakes.reveal.InCenter],
      [20, fakes.reveal.InCenter],
    ]);
  });

  it('ComesInView: a measure that a command cuts short goes on once the command is done', async () => {
    const { editor, controller } = made();
    const view = inView(FILE, 960, 999);
    outOfView(controller, 970, FRAME_MS);
    vi.mocked(viewport).mockReturnValue({ top: 960, rows: 40, atEnd: true, height: undefined });
    vi.mocked(row).mockReturnValue(-50);
    const cursor = { file: FILE, offset: 990 };
    view.revealRange.mockImplementationOnce(() => {
      view.visibleRanges = [{ start: { line: 965 }, end: { line: 999 } }];
      editor.renderCursor(cursor, 'running', 'cursor');
      fire('visibleRanges', { textEditor: view, visibleRanges: view.visibleRanges });
    });
    answering(view);
    editor.renderCursor(cursor, 'typing', 'cursor');
    editor.follow();
    await vi.advanceTimersByTimeAsync(SCROLL_MAX_MS);
    expect(revealed(view)).toEqual([[990, fakes.reveal.InCenter]]);
    editor.renderCursor(cursor, 'typing', 'cursor');
    await vi.advanceTimersByTimeAsync(SCROLL_MAX_MS);
    expect(revealed(view).at(1)).toEqual([990, fakes.reveal.InCenter]);
  });

  it("ComesInView: a glide a command cuts short goes on once it is done, not while paused, and not on the programmer's turn", async () => {
    const { editor, controller } = made();
    const view = inView(FILE);
    answering(view);
    outOfView(controller, 87, 4 * FRAME_MS);
    const cursor = { file: FILE, offset: 100 };
    editor.renderCursor(cursor, 'typing', 'cursor');
    editor.follow();
    await vi.advanceTimersByTimeAsync(FRAME_MS);
    editor.follow();
    editor.renderCursor(cursor, 'running', 'cursor');
    await vi.advanceTimersByTimeAsync(4 * FRAME_MS);
    expect(revealed(view)).toEqual([[22 + STICKY_LINES, fakes.reveal.AtTop]]);
    editor.renderCursor(cursor, 'paused', 'cursor');
    editor.renderCursor(cursor, 'typing', 'cursor');
    await vi.advanceTimersByTimeAsync(4 * FRAME_MS);
    expect(revealed(view)).toHaveLength(5);

    editor.follow();
    await vi.advanceTimersByTimeAsync(FRAME_MS);
    editor.renderCursor(cursor, 'running', 'cursor');
    await vi.advanceTimersByTimeAsync(FRAME_MS);
    editor.renderCursor(cursor, 'navigator', 'cursor');
    editor.renderCursor(cursor, 'typing', 'cursor');
    await vi.advanceTimersByTimeAsync(4 * FRAME_MS);
    expect(revealed(view)).toHaveLength(6);
  });

  it('ComesInView: catches up after a glide with a target that moved on in its file, and lets go of one that left it', async () => {
    const { editor, controller } = made();
    const view = inView(FILE);
    answering(view);
    outOfView(controller, 87, FRAME_MS);
    editor.renderCursor({ file: FILE, offset: 100 }, 'typing', 'cursor');
    editor.follow();
    editor.renderCursor({ file: FILE, offset: 300 }, 'typing', 'cursor');
    await vi.advanceTimersByTimeAsync(2 * FRAME_MS);
    expect(vi.mocked(row).mock.calls.map(([, line]) => line)).toEqual([100, 300]);
    expect(revealed(view)).toHaveLength(2);

    editor.follow();
    editor.renderCursor({ file: OTHER, offset: 300 }, 'typing', 'cursor');
    await vi.advanceTimersByTimeAsync(FRAME_MS);
    editor.renderCursor({ file: FILE, offset: 300 }, 'typing', 'cursor');
    editor.follow();
    editor.renderCursor(undefined, 'typing', 'cursor');
    await vi.advanceTimersByTimeAsync(FRAME_MS);
    expect(revealed(view)).toHaveLength(4);
    expect(vi.mocked(row).mock.calls).toHaveLength(4);
  });

  it('ComesInView: reveal shows the target and follows it there, and does nothing with no target', async () => {
    fakes.onDisk.add(FILE);
    const { editor, controller } = made();
    editor.reveal();
    expect(fakes.openTextDocument.mock.calls).toEqual([]);
    outOfView(controller, 87, FRAME_MS);
    fakes.showTextDocument.mockImplementation(() => {
      answering(inView(FILE));
      return Promise.resolve();
    });
    editor.renderCursor({ file: FILE, offset: 100 }, 'typing', 'cursor');
    editor.reveal();
    await vi.advanceTimersByTimeAsync(FRAME_MS);
    expect(revealed(at(fakes.visible, 0))).toEqual([[87 + STICKY_LINES, fakes.reveal.AtTop]]);
  });
});
