// Watching for files changed on disk outside the protocol, and marking them (#15, specs/Outside.tla). Solitary: the
// vscode module is a fake whose events the test fires, outside.ts's OutsideChanges and watched are mocks, and the
// controller, editor, and panel are typed fakes.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';
import type { Controller, PanelPort } from '@ai-pair/core';
import type { VsCodeEditor } from '../src/editor';
import { OutsideChanges, watched } from '../src/outside';
import { watchOutside } from '../src/outside_watch';

/** What the mocked modules share with the tests, made before the `vi.mock` factories run. */
const fakes = vi.hoisted(() => {
  /** A file's URI, as vscode.Uri.file makes it. */
  class FakeUri {
    readonly scheme: string;
    constructor(
      readonly fsPath: string,
      scheme = 'file',
    ) {
      this.scheme = scheme;
    }
  }

  /** vscode.EventEmitter, faked: it records what it fired. */
  class FakeEmitter {
    readonly fired: unknown[] = [];
    readonly event = 'redrawn event';
    readonly dispose = vi.fn();
    fire(value: unknown): void {
      this.fired.push(value);
    }
  }

  /** outside.ts's OutsideChanges, faked: it keeps what it was made with, and records what it was told. */
  class FakeOutsideChanges {
    readonly saved = vi.fn();
    readonly reported = vi.fn();
    readonly seen = vi.fn();
    readonly isMarked = vi.fn(() => false);
    constructor(
      readonly read: (file: string) => Promise<string | undefined>,
      readonly report: (files: string[]) => void,
      readonly redraw: (files: string[]) => void,
    ) {
      fakes.made.push(this);
    }
  }

  /** vscode.FileDecoration, faked: it keeps what it was made with. */
  class FakeDecoration {
    constructor(
      readonly badge: string,
      readonly tooltip: string,
      readonly color: unknown,
    ) {}
  }

  return {
    FakeUri,
    FakeEmitter,
    FakeDecoration,
    FakeOutsideChanges,
    /** The disk, as vscode.workspace.fs reads it: each file's text by its path. */
    disk: new Map<string, string>(),
    /** The workspace's folders. */
    folders: ['/p'] as string[] | undefined,
    /** Each listener the watch registered, by event name. */
    listeners: new Map<string, (value: unknown) => unknown>(),
    /** The decoration provider the watch registered. */
    provider: undefined as undefined | { onDidChangeFileDecorations: unknown; provideFileDecoration: (uri: unknown) => unknown },
    /** The emitters the watch made. */
    emitters: [] as FakeEmitter[],
    /** What Disposable.from was given. */
    disposed: [] as unknown[],
    /** Each OutsideChanges the watch made. */
    made: [] as FakeOutsideChanges[],
  };
});

/** Records a listener for `name`, and returns its disposable. */
function listen(name: string): (listener: (value: unknown) => unknown) => { name: string } {
  return (listener) => {
    fakes.listeners.set(name, listener);
    return { name };
  };
}

vi.mock('vscode', () => ({
  Uri: { file: (file: string) => new fakes.FakeUri(file) },
  EventEmitter: fakes.FakeEmitter,
  FileDecoration: fakes.FakeDecoration,
  ThemeColor: class {
    constructor(readonly id: string) {}
  },
  Disposable: {
    from: (...parts: unknown[]) => {
      fakes.disposed.push(...parts);
      return { dispose: vi.fn() };
    },
  },
  workspace: {
    get workspaceFolders() {
      return fakes.folders?.map((folder) => ({ uri: { fsPath: folder } }));
    },
    fs: {
      readFile: (uri: { fsPath: string }) => {
        const text = fakes.disk.get(uri.fsPath);
        return text === undefined ? Promise.reject(new Error('ENOENT')) : Promise.resolve(new TextEncoder().encode(text));
      },
    },
    createFileSystemWatcher: (glob: string) => ({
      glob,
      onDidChange: listen('change'),
      onDidCreate: listen('create'),
    }),
    onDidSaveTextDocument: listen('save'),
  },
  window: {
    onDidChangeActiveTextEditor: listen('active'),
    registerFileDecorationProvider: (provider: typeof fakes.provider) => {
      fakes.provider = provider;
      return { name: 'decorations' };
    },
  },
}));
vi.mock('../src/outside', () => ({
  OutsideChanges: vi.fn(fakes.FakeOutsideChanges),
  watched: vi.fn((file: string, folders: string[]) => folders.some((folder) => file.startsWith(`${folder}/`))),
}));

/** The watch, set up on typed fakes, and the parts a test drives. */
interface Watching {
  controller: Controller & { isActive: boolean };
  editor: ReturnType<typeof mock<VsCodeEditor>>;
  panel: ReturnType<typeof mock<PanelPort>>;
  result: ReturnType<typeof watchOutside>;
}

/** Starts the watch, with a session active or not. */
function watching(active = true): Watching {
  const controller = mock<Controller & { isActive: boolean }>();
  controller.isActive = active;
  const editor = mock<VsCodeEditor>();
  editor.displayPath.mockImplementation((file) => file.replace('/p/', ''));
  const panel = mock<PanelPort>();
  return { controller, editor, panel, result: watchOutside(controller, editor, panel) };
}

/** Returns the OutsideChanges the watch made last. */
function changes(): InstanceType<typeof fakes.FakeOutsideChanges> {
  const made = fakes.made.at(-1);
  if (made === undefined) {
    throw new Error('No OutsideChanges was made.');
  }
  return made;
}

/** Fires the listener registered for `name` with `value`. */
async function fire(name: string, value: unknown): Promise<void> {
  await fakes.listeners.get(name)?.(value);
}

afterEach(() => {
  fakes.disk.clear();
  fakes.folders = ['/p'];
  fakes.listeners.clear();
  fakes.provider = undefined;
  fakes.emitters.length = 0;
  fakes.disposed.length = 0;
  fakes.made.length = 0;
  vi.clearAllMocks();
});

describe('watchOutside', () => {
  it('watches every file, and disposes of the watcher, its listeners, the decorations, and the emitter together', () => {
    const { result } = watching();
    expect(result.outside).toBe(changes());
    expect(fakes.disposed).toHaveLength(7);
    expect(fakes.disposed[0]).toMatchObject({ glob: '**/*' });
    expect(fakes.disposed.slice(1, 6)).toEqual([
      { name: 'change' },
      { name: 'create' },
      { name: 'save' },
      { name: 'active' },
      { name: 'decorations' },
    ]);
    expect(fakes.disposed[6]).toBeInstanceOf(fakes.FakeEmitter);
  });

  it('Write: reports a file the watcher saw change or appear, in a session, under a workspace folder, and on disk only', async () => {
    watching();
    await fire('change', new fakes.FakeUri('/p/a.ts'));
    await fire('create', new fakes.FakeUri('/p/b.ts'));
    await fire('change', new fakes.FakeUri('/q/c.ts'));
    await fire('change', new fakes.FakeUri('/p/d.ts', 'git'));
    expect(changes().reported.mock.calls).toEqual([['/p/a.ts'], ['/p/b.ts']]);
    expect(watched).toHaveBeenCalledWith('/q/c.ts', ['/p']);
  });

  it('reports nothing outside a session, or with no workspace folders', async () => {
    watching(/* active= */ false);
    await fire('change', new fakes.FakeUri('/p/a.ts'));
    fakes.folders = undefined;
    watching();
    await fire('change', new fakes.FakeUri('/p/a.ts'));
    expect(fakes.made.map((made) => made.reported.mock.calls)).toEqual([[], []]);
  });

  it('knows what the editor writes, and what VS Code saves to disk, as not written outside', async () => {
    const { editor } = watching();
    editor.wrote?.('/p/a.ts', 'mine');
    await fire('save', { uri: new fakes.FakeUri('/p/b.ts'), getText: () => 'saved' });
    await fire('save', { uri: new fakes.FakeUri('/p/c.ts', 'untitled'), getText: () => 'not on disk' });
    expect(changes().saved.mock.calls).toEqual([
      ['/p/a.ts', 'mine'],
      ['/p/b.ts', 'saved'],
    ]);
  });

  it('OpenDocument: takes a file opened in a watched folder as seen, with its text on disk, and nothing else', async () => {
    watching();
    fakes.disk.set('/p/a.ts', 'on disk');
    await fire('active', { document: { uri: new fakes.FakeUri('/p/a.ts') } });
    await fire('active', { document: { uri: new fakes.FakeUri('/p/gone.ts') } });
    await fire('active', { document: { uri: new fakes.FakeUri('/q/b.ts') } });
    await fire('active', { document: { uri: new fakes.FakeUri('/p/c.ts', 'output') } });
    await fire('active', undefined);
    expect(changes().seen.mock.calls).toEqual([['/p/a.ts', 'on disk']]);
  });

  it('reads a file from disk for the changes, and nothing for one that is gone', async () => {
    watching();
    fakes.disk.set('/p/a.ts', 'text');
    const made = changes();
    expect(await made.read('/p/a.ts')).toBe('text');
    expect(await made.read('/p/gone.ts')).toBeUndefined();
  });

  it('lists files written outside in the panel by the names the agent knows, and redraws their badges', () => {
    const { panel } = watching();
    const made = changes();
    made.report(['/p/a.ts']);
    made.redraw(['/p/a.ts']);
    expect(panel.post.mock.calls).toEqual([[{ type: 'outside', files: ['a.ts'] }]]);
    const emitter = fakes.disposed[6];
    expect(emitter instanceof fakes.FakeEmitter ? emitter.fired : []).toEqual([[new fakes.FakeUri('/p/a.ts')]]);
  });

  it('badges a file marked as written outside, and no other', () => {
    watching();
    expect(fakes.provider?.onDidChangeFileDecorations).toBe('redrawn event');
    changes().isMarked.mockReturnValueOnce(true);
    expect(fakes.provider?.provideFileDecoration(new fakes.FakeUri('/p/a.ts'))).toEqual(
      new fakes.FakeDecoration('*', 'Changed outside the editor', { id: 'editorWarning.foreground' }),
    );
    expect(fakes.provider?.provideFileDecoration(new fakes.FakeUri('/p/b.ts'))).toBeUndefined();
    expect(fakes.provider?.provideFileDecoration(new fakes.FakeUri('/p/c.ts', 'git'))).toBeUndefined();
    expect(OutsideChanges).toHaveBeenCalledOnce();
  });
});
