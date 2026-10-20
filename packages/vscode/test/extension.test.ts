// The extension's wiring on its own (#176): what activate makes, the commands and settings it registers, and the
// Api it hands the integration test. Solitary: vscode, node:os, core's Bridge and Controller, and every module of
// the extension it builds on are fakes, so a test says what each answers and sees what activate asked of it.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isSavedSession } from '@ai-pair/core';
import { playDemo } from '../src/demo';
import { activate, deactivate } from '../src/extension';
import { setTimings } from '../src/timings';
import { watchOutside } from '../src/outside_watch';
import { settingSpeed } from '../src/panel_html';
import { builtInPassage } from '../src/passage';
import { claudeStarter, setUpAgent, writeLauncher } from '../src/setup';

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

  /** What was made, and what the fakes answer. */
  const made = {
    controllers: [] as Array<InstanceType<typeof FakeController>>,
    bridges: [] as Array<InstanceType<typeof FakeBridge>>,
    editors: [] as Array<InstanceType<typeof FakeEditor>>,
    panels: [] as Array<InstanceType<typeof FakePanel>>,
    calibrations: [] as Array<InstanceType<typeof FakeCalibration>>,
    starting: Promise.resolve(),
    arms: true,
  };

  /** Core's Controller, faked: what activate sets, and the calls its commands make. */
  class FakeController {
    trace?: (line: string) => void;
    onChange?: () => void;
    isPaused = false;
    turn: string | undefined = undefined;
    saved: unknown = undefined;
    readonly setSpeed = vi.fn();
    readonly setReadingSpeed = vi.fn();
    readonly setTiming = vi.fn();
    readonly setConfirmCommands = vi.fn();
    readonly pause = vi.fn();
    readonly resume = vi.fn();
    readonly userInterrupt = vi.fn();
    readonly takeTurn = vi.fn();
    readonly handBack = vi.fn();
    readonly endSession = vi.fn();
    readonly disconnect = vi.fn();
    readonly revive = vi.fn();

    constructor(
      readonly editor: unknown,
      readonly panel: unknown,
    ) {
      made.controllers.push(this);
    }
  }

  /** Core's Bridge, faked: its options, and whether its server starts. */
  class FakeBridge {
    readonly file = '/discovery/1.json';
    readonly start = vi.fn(() => made.starting);
    readonly dispose = vi.fn();
    readonly focused = vi.fn();
    readonly writeDiscovery = vi.fn();

    constructor(
      readonly controller: unknown,
      readonly options: {
        workspaceFolders: () => string[];
        trace: (line: string) => void;
        failed: (error: unknown) => void;
        calibrate: (passage: unknown) => boolean;
      },
    ) {
      made.bridges.push(this);
    }
  }

  /** The editor, faked: what activate gives and sets it. */
  class FakeEditor {
    onSelection?: (ref: unknown) => void;
    readonly setAgentName = vi.fn();
    readonly programmerSelection = vi.fn(() => 'selection');
    readonly selectionRef = vi.fn(() => 'ref');
    readonly resolvePath = vi.fn((file: string) => `/project/${file}`);
    readonly dispose = vi.fn();

    constructor(
      readonly root: string,
      readonly agentName: string,
      readonly controller: () => unknown,
    ) {
      made.editors.push(this);
    }
  }

  /** The panel, faked: what activate gives and sets it, and what it shows. */
  class FakePanel {
    static readonly viewId = 'aiPair.panel';
    onPost?: () => void;
    readonly history = ['history'];
    readonly showSelection = vi.fn();
    readonly showSpeed = vi.fn();
    readonly showReadingSpeed = vi.fn();
    readonly showCalibration = vi.fn();
    readonly showTimings = vi.fn();
    readonly restoreHistory = vi.fn();
    readonly focusReply = vi.fn();
    readonly askStart = vi.fn();

    constructor(
      readonly resolvePath: (file: string) => string,
      readonly speed: { get: () => number; set: (value: number) => void },
      readonly readingSpeed: { get: () => number; set: (value: number) => void },
      readonly selection: { current: () => unknown; ref: () => unknown },
      readonly trace: (line: string) => void,
      readonly extensionUri: unknown,
      readonly wiring: { controller: () => unknown; calibration: () => unknown; starter: unknown },
    ) {
      made.panels.push(this);
    }
  }

  /** The calibration, faked: its host's hooks, and whether it takes a passage. */
  class FakeCalibration {
    readonly arm = vi.fn(() => made.arms);

    constructor(
      readonly host: {
        now: () => number;
        pause: () => void;
        resume: () => void;
        store: (msPerChar: number) => Promise<void>;
        show: (view: unknown) => void;
      },
      readonly passage: unknown,
    ) {
      made.calibrations.push(this);
    }
  }

  return {
    listeners,
    event,
    FakeController,
    FakeBridge,
    FakeEditor,
    FakePanel,
    FakeCalibration,
    made,
    /** The workspace's folders; none until a test says. */
    folders: undefined as Array<{ uri: { fsPath: string } }> | undefined,
    /** The `aiPair` settings, by name. */
    settings: new Map<string, unknown>(),
    updated: [] as Array<[string, unknown, unknown]>,
    commands: new Map<string, () => unknown>(),
    errors: [] as string[],
    infos: [] as string[],
    /** The button the programmer picks on the next information message. */
    answer: undefined as string | undefined,
    logged: [] as Array<[string, string]>,
  };
});

vi.mock('vscode', () => ({
  ConfigurationTarget: { Global: 1 },
  workspace: {
    get workspaceFolders() {
      return fakes.folders;
    },
    getConfiguration: () => ({
      get: (key: string, fallback?: unknown) => (fakes.settings.has(key) ? fakes.settings.get(key) : fallback),
      update: (key: string, value: unknown, target: unknown) => {
        fakes.updated.push([key, value, target]);
        fakes.settings.set(key, value);
        return Promise.resolve();
      },
    }),
    onDidChangeConfiguration: fakes.event('configuration'),
    onDidChangeWorkspaceFolders: fakes.event('folders'),
  },
  window: {
    createOutputChannel: () => ({
      info: (line: string) => fakes.logged.push(['info', line]),
      trace: (line: string) => fakes.logged.push(['trace', line]),
      dispose: () => {},
    }),
    showErrorMessage: (message: string) => {
      fakes.errors.push(message);
      return Promise.resolve(undefined);
    },
    showInformationMessage: (message: string) => {
      fakes.infos.push(message);
      return Promise.resolve(fakes.answer);
    },
    onDidChangeWindowState: fakes.event('window'),
    registerWebviewViewProvider: () => ({ dispose: () => {} }),
  },
  commands: {
    registerCommand: (name: string, run: () => unknown) => {
      fakes.commands.set(name, run);
      return { dispose: () => {} };
    },
  },
}));
vi.mock('node:os', () => ({ homedir: () => '/home' }));
vi.mock('@ai-pair/core', () => ({
  Bridge: fakes.FakeBridge,
  Controller: fakes.FakeController,
  isSavedSession: vi.fn(() => false),
}));
vi.mock('@ai-pair/protocol', () => ({ discoveryDir: () => '/discovery' }));
vi.mock('../src/demo', () => ({ playDemo: vi.fn(() => Promise.resolve()) }));
vi.mock('../src/editor', () => ({ VsCodeEditor: fakes.FakeEditor }));
vi.mock('../src/outside_watch', () => ({ watchOutside: vi.fn(() => ({ outside: 'outside', disposable: { dispose: () => {} } })) }));
vi.mock('../src/panel', () => ({ NarrationPanel: fakes.FakePanel }));
vi.mock('../src/panel_html', () => ({ settingSpeed: vi.fn((value: unknown) => (typeof value === 'number' ? value : 1)) }));
vi.mock('../src/setup', () => ({
  claudeStarter: vi.fn(() => ({ dispose: () => {} })),
  setUpAgent: vi.fn(() => Promise.resolve()),
  writeLauncher: vi.fn(() => '/ext/launcher'),
}));
vi.mock('../src/calibration', () => ({ Calibration: fakes.FakeCalibration }));
vi.mock('../src/timings', () => ({ timings: { saveMs: 200 }, setTimings: vi.fn() }));
vi.mock('../src/passage', () => ({ builtInPassage: vi.fn(() => ({ title: 'Built in', text: 'Built-in words.' })) }));

/** The extension's context, faked: its storage, and what it is asked to dispose. */
function context(stored: Map<string, unknown> = new Map(), offered = true) {
  const global = new Map<string, unknown>([['aiPair.offeredSetup', offered]]);
  return {
    subscriptions: [] as Array<{ dispose: () => unknown }>,
    extensionPath: '/ext',
    extensionUri: { fsPath: '/ext' },
    workspaceState: {
      get: (key: string) => stored.get(key),
      update: (key: string, value: unknown) => {
        stored.set(key, value);
        return Promise.resolve();
      },
    },
    globalState: {
      get: (key: string) => global.get(key),
      update: (key: string, value: unknown) => {
        global.set(key, value);
        return Promise.resolve();
      },
    },
  };
}

/** Returns the one made last. */
function last<T>(list: T[]): T {
  const made = list.at(-1);
  if (made === undefined) throw new Error('Not made.');
  return made;
}

/** Activates the extension with `given`, and returns its Api and what it made. */
function activated(given = context()) {
  // The fake stands in for VS Code's ExtensionContext.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const api = activate(given as unknown as Parameters<typeof activate>[0]);
  return {
    api,
    context: given,
    controller: last(fakes.made.controllers),
    bridge: last(fakes.made.bridges),
    editor: last(fakes.made.editors),
    panel: last(fakes.made.panels),
    calibration: last(fakes.made.calibrations),
  };
}

/** Runs the command registered as `name`. */
function command(name: string): unknown {
  const run = fakes.commands.get(name);
  if (run === undefined) throw new Error(`No command ${name}.`);
  return run();
}

/** Fires event `name` with `value`. */
function fire(name: string, value: unknown): void {
  for (const listener of fakes.listeners.get(name) ?? []) {
    listener(value);
  }
}

/** Fires a settings change that affects the settings named. */
function changed(...names: string[]): void {
  fire('configuration', { affectsConfiguration: (section: string) => names.some((name) => section === `aiPair.${name}`) });
}

beforeEach(() => {
  fakes.folders = [{ uri: { fsPath: '/project' } }];
  fakes.made.starting = Promise.resolve();
  fakes.made.arms = true;
  fakes.answer = undefined;
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  fakes.listeners.clear();
  fakes.settings.clear();
  fakes.commands.clear();
  for (const list of [fakes.made.controllers, fakes.made.bridges, fakes.made.editors, fakes.made.panels, fakes.made.calibrations]) {
    list.length = 0;
  }
  fakes.updated.length = 0;
  fakes.errors.length = 0;
  fakes.infos.length = 0;
  fakes.logged.length = 0;
});

describe('activate', () => {
  it('builds the editor in the first folder, or the home folder with none, and wires the controller to it', () => {
    const h = activated();
    expect(h.editor.root).toBe('/project');
    expect(h.editor.agentName).toBe('Agent');
    expect(h.editor.controller()).toBe(h.controller);
    expect(h.panel.extensionUri).toEqual({ fsPath: '/ext' });
    expect(h.panel.wiring.controller()).toBe(h.controller);
    expect(h.panel.wiring.calibration()).toBe(h.calibration);
    expect(h.panel.wiring.starter).toBe(vi.mocked(claudeStarter).mock.results[0]?.value);
    expect(h.api).toMatchObject({
      controller: h.controller,
      editor: h.editor,
      bridge: h.bridge,
      outside: 'outside',
      launcher: '/ext/launcher',
    });
    expect(writeLauncher).toHaveBeenCalledWith('/ext');
    expect(claudeStarter).toHaveBeenCalledWith('/ext/launcher');
    expect(watchOutside).toHaveBeenCalledWith(h.controller, h.editor, h.panel);
    expect(h.bridge.options.workspaceFolders()).toEqual(['/project']);
    fakes.folders = undefined;
    expect(activated().editor.root).toBe('/home');
    expect(activated().bridge.options.workspaceFolders()).toEqual([]);
  });

  it('gives the controller and the panel the speeds from the settings, and stores the ones the panel sets', () => {
    fakes.settings.set('speed', 2);
    fakes.settings.set('readingSpeed', 3);
    fakes.settings.set('timing', { glideMs: 1 });
    fakes.settings.set('confirmCommands', false);
    const h = activated();
    expect(h.controller.setSpeed).toHaveBeenCalledWith(2);
    expect(h.controller.setReadingSpeed).toHaveBeenCalledWith(3);
    expect(h.controller.setTiming).toHaveBeenCalledWith({ glideMs: 1 });
    expect(h.controller.setConfirmCommands).toHaveBeenCalledWith(false);
    expect(settingSpeed).toHaveBeenCalledWith(2);
    h.panel.speed.set(4);
    h.panel.readingSpeed.set(0.5);
    expect(fakes.updated).toEqual([
      ['speed', 4, 1],
      ['readingSpeed', 0.5, 1],
    ]);
    expect(h.panel.resolvePath('a.ts')).toBe('/project/a.ts');
    expect(h.panel.selection.current()).toBe('selection');
    expect(h.panel.selection.ref()).toBe('ref');
    h.editor.onSelection?.('a ref');
    expect(h.panel.showSelection).toHaveBeenCalledWith('a ref');
  });

  it('traces the controller at Info, and the panel and the bridge at the Trace level, or at Info with the setting', () => {
    const h = activated();
    h.controller.trace?.('one');
    h.panel.trace('two');
    fakes.settings.set('trace', true);
    h.bridge.options.trace('three');
    expect(fakes.logged).toEqual([
      ['info', 'one'],
      ['trace', 'two'],
      ['info', 'three'],
    ]);
  });

  it('applies each setting as it changes, and only those that changed', () => {
    const h = activated();
    vi.clearAllMocks();
    fakes.settings.set('speed', 2);
    fakes.settings.set('readingSpeed', 3);
    fakes.settings.set('timing', { glideMs: 1 });
    fakes.settings.set('agentName', 'Pal');
    fakes.settings.set('confirmCommands', false);
    changed('speed', 'readingSpeed', 'timing', 'agentName', 'confirmCommands');
    expect(h.controller.setSpeed).toHaveBeenCalledWith(2);
    expect(h.panel.showSpeed).toHaveBeenCalledWith(2);
    expect(h.controller.setReadingSpeed).toHaveBeenCalledWith(3);
    expect(h.panel.showReadingSpeed).toHaveBeenCalledWith(3);
    expect(h.controller.setTiming).toHaveBeenCalledWith({ glideMs: 1 });
    expect(h.editor.setAgentName).toHaveBeenCalledWith('Pal');
    expect(h.controller.setConfirmCommands).toHaveBeenCalledWith(false);
    vi.clearAllMocks();
    changed('trace');
    expect(h.controller.setSpeed).not.toHaveBeenCalled();
    expect(h.controller.setReadingSpeed).not.toHaveBeenCalled();
    expect(h.controller.setTiming).not.toHaveBeenCalled();
    expect(h.editor.setAgentName).not.toHaveBeenCalled();
    expect(h.controller.setConfirmCommands).not.toHaveBeenCalled();
  });

  it('tells the bridge when the window is focused, and when the folders change', () => {
    const h = activated();
    fire('window', { focused: false });
    expect(h.bridge.focused).not.toHaveBeenCalled();
    fire('window', { focused: true });
    expect(h.bridge.focused).toHaveBeenCalledOnce();
    fire('folders', {});
    expect(h.bridge.writeDiscovery).toHaveBeenCalledOnce();
  });

  it('says once that the discovery file could not be written, and that the server could not start', async () => {
    fakes.made.starting = Promise.reject(new Error('EACCES'));
    const h = activated();
    h.bridge.options.failed(new Error('read-only'));
    h.bridge.options.failed(new Error('read-only'));
    await expect(h.api.ready).rejects.toThrow('EACCES');
    await Promise.resolve();
    expect(fakes.errors).toEqual([
      "AI Pair couldn't write its discovery file, so agents won't find this window: Error: read-only",
      "AI Pair couldn't start its local server: Error: EACCES",
    ]);
  });

  it('disposes the bridge, disconnects the controller, and saves, as the window goes', () => {
    const h = activated();
    for (const disposable of h.context.subscriptions) {
      void disposable.dispose();
    }
    expect(h.bridge.dispose).toHaveBeenCalledOnce();
    expect(h.controller.disconnect).toHaveBeenCalledOnce();
  });
});

describe('the session across a reload', () => {
  it('revives a saved session, with its history when the history is panel events', () => {
    vi.mocked(isSavedSession).mockReturnValue(true);
    const stored = new Map<string, unknown>([
      ['aiPair.session', { saved: true }],
      ['aiPair.history', [{ type: 'say' }]],
    ]);
    const h = activated(context(stored));
    expect(h.panel.restoreHistory).toHaveBeenCalledWith([{ type: 'say' }]);
    expect(h.controller.revive).toHaveBeenCalledWith({ saved: true });
    for (const history of [[{ text: 'no type' }], 'not a list']) {
      stored.set('aiPair.history', history);
      expect(activated(context(stored)).panel.restoreHistory).toHaveBeenLastCalledWith([]);
    }
  });

  it('saves the session and its history a while after each change, and nothing once the session is gone', () => {
    vi.useFakeTimers();
    const stored = new Map<string, unknown>();
    const h = activated(context(stored));
    expect(h.controller.revive).not.toHaveBeenCalled();
    h.controller.saved = { session: 1 };
    h.controller.onChange?.();
    h.panel.onPost?.();
    vi.advanceTimersByTime(200);
    expect(stored.get('aiPair.session')).toEqual({ session: 1 });
    expect(stored.get('aiPair.history')).toEqual(['history']);
    vi.mocked(isSavedSession).mockReturnValue(true);
    expect(h.api.saved()).toEqual({ session: 1 });
    vi.mocked(isSavedSession).mockReturnValue(false);
    expect(h.api.saved()).toBeUndefined();
    h.controller.saved = undefined;
    h.controller.onChange?.();
    vi.advanceTimersByTime(200);
    expect(stored.get('aiPair.history')).toBeUndefined();
    expect(h.api.history()).toEqual(['history']);
  });

  it("setTimings: sets the extension's delays and tells the page its own", () => {
    const h = activated();
    h.api.setTimings({ saveMs: 1 });
    expect(vi.mocked(setTimings)).toHaveBeenCalledWith({ saveMs: 1 });
    expect(h.panel.showTimings).toHaveBeenCalledOnce();
  });
});

describe('the commands', () => {
  it('pauses or resumes, interrupts, takes or hands back the turn, and ends the session', () => {
    const h = activated();
    command('aiPair.togglePause');
    expect(h.controller.pause).toHaveBeenCalledOnce();
    h.controller.isPaused = true;
    command('aiPair.togglePause');
    expect(h.controller.resume).toHaveBeenCalledOnce();
    command('aiPair.interrupt');
    expect(h.controller.userInterrupt).toHaveBeenCalledOnce();
    command('aiPair.toggleTurn');
    expect(h.controller.takeTurn).toHaveBeenCalledOnce();
    h.controller.turn = 'programmer';
    command('aiPair.toggleTurn');
    expect(h.controller.handBack).toHaveBeenCalledOnce();
    command('aiPair.endSession');
    expect(h.controller.endSession).toHaveBeenCalledOnce();
    command('aiPair.focusReply');
    command('aiPair.askAboutSelection');
    expect(h.panel.focusReply).toHaveBeenCalledTimes(2);
  });

  it('plays the demo in the folder, or says to open one, and plays it through the Api', async () => {
    const h = activated();
    command('aiPair.playDemo');
    expect(playDemo).toHaveBeenCalledWith(h.controller, '/project');
    await h.api.playDemo();
    expect(playDemo).toHaveBeenCalledTimes(2);
    for (const none of [[], undefined]) {
      fakes.folders = none;
      command('aiPair.playDemo');
    }
    expect(fakes.errors).toEqual([
      'Open a folder first: the demo creates files in ai-pair-demo/.',
      'Open a folder first: the demo creates files in ai-pair-demo/.',
    ]);
    expect(playDemo).toHaveBeenCalledTimes(2);
  });

  it('ReaskedProp: sets the agent up, and offers the panel the start again', async () => {
    const h = activated();
    await command('aiPair.setUpAgent');
    expect(setUpAgent).toHaveBeenCalledWith('/ext/launcher');
    expect(h.panel.askStart).toHaveBeenCalledOnce();
  });

  it('offers Set Up Agent once, the first time, and sets the agent up when it is taken', async () => {
    fakes.answer = 'Set Up Agent';
    const first = context(new Map(), /* offered= */ false);
    activated(first);
    await vi.waitFor(() => {
      expect(setUpAgent).toHaveBeenCalledOnce();
    });
    expect(fakes.infos).toEqual(['AI Pair is installed. Connect it to your agent?']);
    expect(first.globalState.get('aiPair.offeredSetup')).toBe(true);
    fakes.answer = undefined;
    activated(context(new Map(), /* offered= */ false));
    await Promise.resolve();
    expect(setUpAgent).toHaveBeenCalledOnce();
  });
});

describe('the calibration', () => {
  it("starts with the setting's passage, the built-in one when it has no text, and says when one is under way", () => {
    const h = activated();
    const passages: Array<[unknown, unknown]> = [
      [undefined, { title: 'Built in', text: 'Built-in words.' }],
      ['not an object', { title: 'Built in', text: 'Built-in words.' }],
      [{ text: '  ' }, { title: 'Built in', text: 'Built-in words.' }],
      [
        { title: 5, text: 'Words.' },
        { title: 'Your passage', text: 'Words.' },
      ],
      [
        { title: 'Mine', text: 'Words.', notice: 'From me.' },
        { title: 'Mine', text: 'Words.', notice: 'From me.' },
      ],
    ];
    for (const [setting, passage] of passages) {
      fakes.settings.set('calibrationPassage', setting);
      command('aiPair.calibrate');
      expect(h.calibration.arm).toHaveBeenLastCalledWith(passage);
    }
    expect(builtInPassage).toHaveBeenCalledWith('/ext');
    expect(h.panel.focusReply).toHaveBeenCalledTimes(passages.length);
    fakes.made.arms = false;
    command('aiPair.calibrate');
    expect(fakes.infos).toEqual(['AI Pair: a calibration is already under way in the Pair panel.']);
  });

  it("takes an agent's passage through the bridge and keeps it as the setting, unless one is under way", () => {
    const h = activated();
    const passage = { title: 'Agent', text: 'Words.' };
    expect(h.bridge.options.calibrate(passage)).toBe(true);
    expect(fakes.updated).toEqual([['calibrationPassage', passage, 1]]);
    fakes.made.arms = false;
    expect(h.bridge.options.calibrate(passage)).toBe(false);
    expect(fakes.updated).toHaveLength(1);
  });

  it('pauses and resumes the controller, shows its views in the panel, and stores the rate it measured', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(42);
    fakes.settings.set('timing', { glideMs: 1, reading: { minMs: 9 } });
    const h = activated();
    const { host } = h.calibration;
    expect(host.now()).toBe(42);
    host.pause();
    expect(h.controller.pause).toHaveBeenCalledWith('calibrate');
    host.resume();
    expect(h.controller.resume).toHaveBeenCalledWith('calibrate');
    host.show('a view');
    expect(h.panel.showCalibration).toHaveBeenCalledWith('a view');
    await host.store(50);
    expect(fakes.updated).toEqual([['timing', { glideMs: 1, reading: { minMs: 9, msPerChar: 50 } }, 1]]);
    expect(h.controller.setTiming).toHaveBeenLastCalledWith({ glideMs: 1, reading: { minMs: 9, msPerChar: 50 } });
    for (const timing of [undefined, { reading: 'fast' }]) {
      fakes.settings.set('timing', timing);
      await host.store(60);
      // A setting that isn't an object, or whose `reading` isn't, is started afresh.
      expect(fakes.updated.at(-1)?.[1]).toEqual({ reading: { msPerChar: 60 } });
    }
  });
});

describe('deactivate', () => {
  it('does nothing: the context disposes everything', () => {
    expect(() => {
      deactivate();
    }).not.toThrow();
  });
});
