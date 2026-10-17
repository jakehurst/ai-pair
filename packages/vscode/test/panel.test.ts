// The narration panel (specs/PanelReplay.tla, specs/Start.tla, specs/Draft.tla). Solitary: the vscode module and
// panel_html's panelHtml are mocks; the controller, calibration, starter, view, and the panel's other hooks are fakes
// passed in, so a test says what each answers and sees what the panel asked of it.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { mock, type MockProxy } from 'vitest-mock-extended';
import * as vscode from 'vscode';
import type { Controller, PanelEvent, Ref } from '@ai-pair/core';
import { EXCERPT_SCHEMA, type Turn } from '@ai-pair/protocol';
import type { Calibration } from '../src/calibration';
import { NarrationPanel, type Starter } from '../src/panel';
import { panelHtml, SPEEDS } from '../src/panel_html';
import type { FromPanel, ToPanel } from '../src/panel_messages';

/** What the mocked modules share with the tests, made before the `vi.mock` factories run. */
const fakes = vi.hoisted(() => ({
  /** The index of the item the programmer picks from the next quick pick; none, as if Escape. */
  pick: undefined as number | undefined,
  /** workspace.fs.stat: whether a path is in the workspace. */
  stat: vi.fn<(uri: unknown) => Promise<unknown>>(() => Promise.resolve({})),
}));

vi.mock('vscode', () => {
  /** A URI, faked: its scheme and path, and the text toString gives. */
  class FakeUri {
    constructor(
      readonly scheme: string,
      readonly path: string,
    ) {}

    static file(file: string): FakeUri {
      return new FakeUri('file', file);
    }

    static parse(text: string): FakeUri {
      const colon = text.indexOf(':');
      return new FakeUri(text.slice(0, colon), text.slice(colon + 1));
    }

    static joinPath(base: FakeUri, ...parts: string[]): FakeUri {
      return new FakeUri(base.scheme, [base.path, ...parts].join('/'));
    }

    toString(): string {
      return `${this.scheme}:${this.path}`;
    }
  }

  return {
    Uri: FakeUri,
    Position: class {
      constructor(
        readonly line: number,
        readonly character: number,
      ) {}
    },
    Range: class {
      constructor(
        readonly start: unknown,
        readonly end: unknown,
      ) {}
    },
    commands: { executeCommand: vi.fn(() => Promise.resolve()) },
    window: {
      showTextDocument: vi.fn(() => Promise.resolve()),
      showInformationMessage: vi.fn(() => Promise.resolve()),
      showQuickPick: vi.fn((items: unknown[]) => Promise.resolve(fakes.pick === undefined ? undefined : items[fakes.pick])),
    },
    workspace: {
      fs: { stat: fakes.stat },
      findFiles: vi.fn(() => Promise.resolve([])),
      asRelativePath: vi.fn((uri: FakeUri) => `relative${uri.path}`),
    },
    env: { openExternal: vi.fn(() => Promise.resolve(true)) },
  };
});
vi.mock(import('../src/panel_html'), async (importOriginal) => ({
  ...(await importOriginal()),
  panelHtml: vi.fn(() => '<html>'),
}));

/** The workspace's root, which the panel's resolvePath joins a file to. */
const ROOT = '/root';

/** The extension's folder. */
const EXTENSION = '/ext';

/** The webview's content security policy source. */
const CSP = 'csp-source';

/** How many events the panel's log holds, as panel.ts has it. */
const MAX_LOG = 400;

/** How many files of a name the panel looks for, as panel.ts has it. */
const MAX_FOUND = 20;

/** The programmer's selection, as the panel's selection hook gives it. */
const SELECTION = EXCERPT_SCHEMA.parse({ file: 'a.ts', from: { line: 1, column: 0 }, to: { line: 2, column: 0 }, text: 'x' });

/** The programmer's selection as a range, as the panel's selection hook gives it. */
const REF: Ref = { file: 'a.ts', line: 1, endLine: 2 };

/** A panel on fakes, and the parts a test drives or reads. */
interface Harness {
  panel: NarrationPanel;
  controller: MockProxy<Controller>;
  calibration: MockProxy<Calibration>;
  starter: MockProxy<Starter>;
  speed: { get: ReturnType<typeof vi.fn<() => number>>; set: ReturnType<typeof vi.fn<(value: number) => void>> };
  readingSpeed: { get: ReturnType<typeof vi.fn<() => number>>; set: ReturnType<typeof vi.fn<(value: number) => void>> };
  onPost: ReturnType<typeof vi.fn<() => void>>;
  traced: string[];
}

/** A view the panel resolved, faked: what the panel posted to its page, and the page's messages and disposal. */
interface FakeView {
  view: MockProxy<vscode.WebviewView>;
  webview: MockProxy<vscode.Webview>;
  posted: ToPanel[];
  /** Sends the panel a message from the page. */
  send: (message: FromPanel) => void;
  /** Sends the panel what the page sent, typed or not, as VS Code hands it over. */
  receive: (message: unknown) => void;
  dispose: () => void;
}

/** Returns a panel with every collaborator a fake, the controller's turn `turn`. */
function harness(turn: Turn = 'agent'): Harness {
  const traced: string[] = [];
  const speed = { get: vi.fn(() => SPEEDS[1] ?? 0), set: vi.fn<(value: number) => void>() };
  const readingSpeed = { get: vi.fn(() => SPEEDS[2] ?? 0), set: vi.fn<(value: number) => void>() };
  const panel = new NarrationPanel(
    (file) => `${ROOT}/${file}`,
    speed,
    readingSpeed,
    { current: () => SELECTION, ref: () => REF },
    (line) => {
      traced.push(line);
    },
    vscode.Uri.file(EXTENSION),
  );
  const controller = mock<Controller>({ turn });
  const calibration = mock<Calibration>();
  calibration.reply.mockReturnValue(false);
  const starter = mock<Starter>();
  starter.available.mockResolvedValue(true);
  starter.start.mockResolvedValue();
  const onPost = vi.fn<() => void>();
  panel.controller = controller;
  panel.calibration = calibration;
  panel.starter = starter;
  panel.onPost = onPost;
  return { panel, controller, calibration, starter, speed, readingSpeed, onPost, traced };
}

/** Returns a panel with no controller, calibration, starter, trace, extension folder, or onPost. */
function bare(): NarrationPanel {
  return new NarrationPanel(
    (file) => `${ROOT}/${file}`,
    { get: () => 1, set: () => {} },
    { get: () => 1, set: () => {} },
    { current: () => undefined, ref: () => undefined },
  );
}

/** Resolves a fake view into `panel`, and returns it. */
function open(panel: NarrationPanel): FakeView {
  const posted: ToPanel[] = [];
  const webview = mock<vscode.Webview>({ cspSource: CSP });
  webview.asWebviewUri.mockImplementation((uri) => vscode.Uri.parse(`webview:${uri.path}`));
  webview.postMessage.mockImplementation((message: ToPanel) => {
    posted.push(message);
    return Promise.resolve(true);
  });
  const view = mock<vscode.WebviewView>({ webview });
  panel.resolveWebviewView(view);
  const [receive] = webview.onDidReceiveMessage.mock.lastCall ?? [];
  const [dispose] = view.onDidDispose.mock.lastCall ?? [];
  if (receive === undefined || dispose === undefined) {
    throw new Error('The panel did not listen to its view.');
  }
  return {
    view,
    webview,
    posted,
    send: (message) => {
      receive(message);
    },
    receive: (message) => {
      receive(message);
    },
    dispose: () => {
      dispose();
    },
  };
}

/** Returns the empty range at the start of `line`, where the panel opens a file. */
function lineStart(line: number): vscode.Range {
  return new vscode.Range(new vscode.Position(line, 0), new vscode.Position(line, 0));
}

/** Waits until every promise already settled has run its callbacks. */
function flush(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/** Returns the events a view created now is sent when its page says it's ready. */
function replayed(panel: NarrationPanel): PanelEvent[] {
  const view = open(panel);
  view.send({ type: 'ready' });
  const replay = view.posted.find((m) => m.type === 'replay');
  if (replay === undefined) {
    throw new Error('Nothing was replayed.');
  }
  return replay.events;
}

/** Returns the messages of type `type` the view was posted. */
function postedOf(view: FakeView, type: ToPanel['type']): ToPanel[] {
  return view.posted.filter((m) => m.type === type);
}

afterEach(() => {
  fakes.pick = undefined;
  vi.resetAllMocks();
});

describe('resolveWebviewView', () => {
  it("gives the page scripts, the extension's dist folder, and the page from panelHtml with its style and script", () => {
    const view = open(harness().panel);
    expect(view.webview.options).toEqual({ enableScripts: true, localResourceRoots: [vscode.Uri.file('/ext/dist')] });
    expect(vi.mocked(panelHtml).mock.calls).toEqual([[CSP, 'webview:/ext/dist/panel.css', 'webview:/ext/dist/panel.js']]);
    expect(view.webview.html).toBe('<html>');
  });

  it('gives the page no resource folder, style, or script without an extension folder', () => {
    const view = open(bare());
    expect(view.webview.options).toEqual({ enableScripts: true, localResourceRoots: [] });
    expect(vi.mocked(panelHtml).mock.calls).toEqual([[CSP, '', '']]);
  });

  it('Dispose: forgets a disposed view, but not a newer one an older disposal follows', () => {
    const { panel } = harness();
    const older = open(panel);
    const newer = open(panel);
    older.dispose();
    panel.showSpeed(1);
    expect(postedOf(older, 'speed')).toEqual([]);
    expect(postedOf(newer, 'speed')).toEqual([{ type: 'speed', value: 1 }]);
    newer.dispose();
    panel.showSpeed(2);
    expect(postedOf(newer, 'speed')).toHaveLength(1);
  });

  it('DraftPausesProp: a draft in the reply box pauses playback', () => {
    const { panel, controller } = harness();
    open(panel).send({ type: 'draft', empty: false });
    expect(controller.pause.mock.calls).toEqual([['reply']]);
  });

  it("ReplyMeansDraft: ends the draft's pause when the view is disposed with it", () => {
    const { panel, controller, calibration } = harness();
    const view = open(panel);
    view.send({ type: 'draft', empty: false });
    view.dispose();
    expect(controller.resume.mock.calls).toEqual([['reply']]);
    expect(calibration.cancel.mock.calls).toHaveLength(1);
  });

  it("ReplyMeansDraft: ends the draft's pause when the view's page reloads, keeping a pause the programmer asked for", () => {
    const { panel, controller } = harness();
    const view = open(panel);
    view.send({ type: 'draft', empty: false });
    view.send({ type: 'ready' });
    view.send({ type: 'pause' });
    view.send({ type: 'draft', empty: false });
    view.send({ type: 'ready' });
    // Only the draft's pause is ended: resume('reply') leaves the programmer's pause(), which resume() would end.
    expect(controller.pause.mock.calls).toEqual([['reply'], [], ['reply']]);
    expect(controller.resume.mock.calls).toEqual([['reply'], ['reply']]);
  });

  it('disposes of a view with no controller or calibration', () => {
    const view = open(bare());
    expect(() => {
      view.dispose();
    }).not.toThrow();
  });
});

describe('post', () => {
  it('LogsPosts: a posted event is on the log a new view replays', () => {
    const panel = bare();
    panel.post({ type: 'say', text: 'hello' });
    expect(replayed(panel)).toEqual([{ type: 'say', text: 'hello' }]);
  });

  it("ReplayShowsSession and Bounded: keeps the session's start in the log however many events follow it", () => {
    const panel = bare();
    panel.post({ type: 'session', active: true, task: 'long' });
    for (let i = 0; i < 1000; i++) {
      panel.post({ type: 'say', text: `message ${i}` });
    }
    const events = replayed(panel);
    expect(events.filter((e) => e.type === 'session')).toEqual([{ type: 'session', active: true, task: 'long' }]);
    expect(events.at(-1)).toEqual({ type: 'say', text: 'message 999' });
    expect(events).toHaveLength(MAX_LOG + 1);
  });

  it("ReplayShowsSession: replays the session's end when that is the last session event", () => {
    const panel = bare();
    panel.post({ type: 'session', active: true });
    panel.post({ type: 'session', active: false, reason: 'user' });
    for (let i = 0; i < 1000; i++) {
      panel.post({ type: 'say', text: `message ${i}` });
    }
    expect(replayed(panel).filter((e) => e.type === 'session')).toEqual([{ type: 'session', active: false, reason: 'user' }]);
  });

  it('cuts the oldest events beyond MAX_LOG, putting back no session when none was cut or one is still on the log', () => {
    const panel = bare();
    for (let i = 0; i <= MAX_LOG; i++) {
      panel.post({ type: 'say', text: `message ${i}` });
    }
    expect(panel.history).toHaveLength(MAX_LOG);
    expect(panel.history[0]).toEqual({ type: 'say', text: 'message 1' });
    const kept = bare();
    kept.post({ type: 'session', active: true, task: 'first' });
    for (let i = 1; i < MAX_LOG; i++) {
      kept.post({ type: 'say', text: `message ${i}` });
    }
    kept.post({ type: 'session', active: true, task: 'second' });
    expect(kept.history.filter((e) => e.type === 'session')).toEqual([{ type: 'session', active: true, task: 'second' }]);
    expect(kept.history).toHaveLength(MAX_LOG);
  });

  it('sends the event to the view, and calls onPost after it', () => {
    const { panel, onPost } = harness();
    const view = open(panel);
    panel.post({ type: 'say', text: 'hi' });
    expect(view.posted).toEqual([{ type: 'say', text: 'hi' }]);
    expect(onPost.mock.calls).toHaveLength(1);
  });

  it('sets aiPair.active and shows the view, keeping focus, when a session starts', () => {
    const { panel, calibration } = harness();
    const view = open(panel);
    panel.post({ type: 'session', active: true });
    expect(vi.mocked(vscode.commands.executeCommand).mock.calls).toEqual([['setContext', 'aiPair.active', true]]);
    expect(view.view.show.mock.calls).toEqual([[true]]);
    expect(calibration.cancel.mock.calls).toEqual([]);
  });

  it('focuses the view by command when a session starts with no view', () => {
    harness().panel.post({ type: 'session', active: true });
    expect(vi.mocked(vscode.commands.executeCommand).mock.calls).toEqual([
      ['setContext', 'aiPair.active', true],
      ['aiPair.narration.focus'],
    ]);
  });

  it('clears aiPair.active and cancels the calibration when a session ends, with or without one', () => {
    const { panel, calibration } = harness();
    const view = open(panel);
    panel.post({ type: 'session', active: false, reason: 'agent' });
    expect(vi.mocked(vscode.commands.executeCommand).mock.calls).toEqual([['setContext', 'aiPair.active', false]]);
    expect(view.view.show.mock.calls).toEqual([]);
    expect(calibration.cancel.mock.calls).toHaveLength(1);
    expect(() => {
      bare().post({ type: 'session', active: false, reason: 'user' });
    }).not.toThrow();
  });
});

describe('restoreHistory', () => {
  it('puts the saved history on the log for the view to replay, and sets aiPair.active', () => {
    const panel = bare();
    panel.post({ type: 'say', text: 'gone' });
    panel.restoreHistory([{ type: 'say', text: 'saved' }]);
    expect(panel.history).toEqual([{ type: 'say', text: 'saved' }]);
    expect(replayed(panel)).toEqual([{ type: 'say', text: 'saved' }]);
    expect(vi.mocked(vscode.commands.executeCommand).mock.calls).toEqual([['setContext', 'aiPair.active', true]]);
  });
});

describe('show', () => {
  it('sends the selection, speed, reading speed, and calibration to the view', () => {
    const { panel } = harness();
    const view = open(panel);
    panel.showSelection(REF);
    panel.showSpeed(2);
    panel.showReadingSpeed(3);
    panel.showCalibration({ phase: 'idle' });
    expect(view.posted).toEqual([
      { type: 'selection', ref: REF },
      { type: 'speed', value: 2 },
      { type: 'readingSpeed', value: 3 },
      { type: 'calibration', view: { phase: 'idle' } },
    ]);
  });

  it('sends nothing with no view', () => {
    expect(() => {
      bare().showSpeed(1);
    }).not.toThrow();
  });
});

describe('focusReply', () => {
  it('shows the view, taking focus, and tells the page to focus the reply box', () => {
    const { panel } = harness();
    const view = open(panel);
    panel.focusReply();
    expect(view.view.show.mock.calls).toEqual([[false]]);
    expect(view.posted).toEqual([{ type: 'focusReply' }]);
  });

  it('focuses the view by command with no view', () => {
    bare().focusReply();
    expect(vi.mocked(vscode.commands.executeCommand).mock.calls).toEqual([['aiPair.narration.focus']]);
  });
});

describe('askStart', () => {
  it('Offered: tells a new page whether it can start a session', async () => {
    const { panel } = harness();
    const view = open(panel);
    view.send({ type: 'ready' });
    await flush();
    expect(view.posted).toContainEqual({ type: 'canStart', value: true });
  });

  it('ClicksNeedButtonProp: tells the page nothing without a starter, so the button stays hidden', async () => {
    const view = open(bare());
    view.send({ type: 'ready' });
    await flush();
    expect(postedOf(view, 'canStart')).toEqual([]);
  });

  it('ReaskedProp: asks again after Set Up Agent, so the button appears without a reload', async () => {
    const { panel } = harness();
    const view = open(panel);
    view.send({ type: 'ready' });
    await flush();
    panel.askStart();
    await flush();
    expect(postedOf(view, 'canStart')).toHaveLength(2);
  });

  it("OwnAnswer: drops the answer of a page replaced before it landed, so it cannot set its successor's button", async () => {
    const { panel, starter } = harness();
    const first = Promise.withResolvers<boolean>();
    const second = Promise.withResolvers<boolean>();
    starter.available.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const view = open(panel);
    view.send({ type: 'ready' });
    view.send({ type: 'ready' });
    first.resolve(true);
    await flush();
    expect(postedOf(view, 'canStart')).toEqual([]);
    second.resolve(false);
    await flush();
    expect(postedOf(view, 'canStart')).toEqual([{ type: 'canStart', value: false }]);
  });
});

describe('receive', () => {
  it('traces each message from the page, with a reply its text and a draft whether it is empty', () => {
    const { panel, traced } = harness();
    const view = open(panel);
    view.send({ type: 'reply', text: 'hi' });
    view.send({ type: 'draft', empty: true });
    view.send({ type: 'draft', empty: false });
    view.send({ type: 'pause' });
    expect(traced).toEqual(['panel reply "hi"', 'panel draft empty', 'panel draft typed', 'panel pause']);
  });

  it('ready: ends the draft pause, and sends the log, speeds, selection, and whether it can start', async () => {
    const { panel, controller } = harness();
    panel.post({ type: 'say', text: 'hi' });
    const view = open(panel);
    view.send({ type: 'ready' });
    await flush();
    expect(controller.resume.mock.calls).toEqual([['reply']]);
    expect(view.posted).toEqual([
      { type: 'replay', events: [{ type: 'say', text: 'hi' }] },
      { type: 'speed', value: SPEEDS[1] },
      { type: 'readingSpeed', value: SPEEDS[2] },
      { type: 'selection', ref: REF },
      { type: 'canStart', value: true },
    ]);
  });

  it("speed, readingSpeed: sets a speed from the menu, and ignores one that isn't", () => {
    const { panel, speed, readingSpeed } = harness();
    const view = open(panel);
    view.send({ type: 'speed', value: SPEEDS[0] ?? 0 });
    view.send({ type: 'speed', value: 7 });
    view.send({ type: 'readingSpeed', value: SPEEDS[3] ?? 0 });
    view.send({ type: 'readingSpeed', value: 7 });
    expect(speed.set.mock.calls).toEqual([[SPEEDS[0]]]);
    expect(readingSpeed.set.mock.calls).toEqual([[SPEEDS[3]]]);
  });

  it('reply: goes to the calibration when it takes it, and otherwise resumes without revealing and sends it on', () => {
    const { panel, controller, calibration } = harness();
    const view = open(panel);
    calibration.reply.mockReturnValueOnce(true);
    view.send({ type: 'reply', text: 'done' });
    expect(controller.userMessage.mock.calls).toEqual([]);
    view.send({ type: 'reply', text: 'with', attach: true });
    view.send({ type: 'reply', text: 'without' });
    expect(calibration.reply.mock.calls).toEqual([['done'], ['with'], ['without']]);
    expect(controller.resume.mock.calls).toEqual([
      [undefined, { reveal: false }],
      [undefined, { reveal: false }],
    ]);
    expect(controller.userMessage.mock.calls).toEqual([
      ['with', SELECTION],
      ['without', undefined],
    ]);
  });

  it('draft: an empty draft ends the draft pause', () => {
    const { panel, controller } = harness();
    open(panel).send({ type: 'draft', empty: true });
    expect(controller.resume.mock.calls).toEqual([['reply']]);
  });

  it('pause, resume, interrupt, end, runDecision: hands each to the controller', () => {
    const { panel, controller } = harness();
    const view = open(panel);
    view.send({ type: 'pause' });
    view.send({ type: 'resume' });
    view.send({ type: 'interrupt' });
    view.send({ type: 'end' });
    view.send({ type: 'runDecision', id: 3, run: true, remember: false });
    expect(controller.pause.mock.calls).toEqual([[]]);
    expect(controller.resume.mock.calls).toEqual([[]]);
    expect(controller.userInterrupt.mock.calls).toEqual([[]]);
    expect(controller.endSession.mock.calls).toEqual([[]]);
    expect(controller.decideRun.mock.calls).toEqual([[3, true, false]]);
  });

  it("turn: hands the turn back on the programmer's turn, with the selection when attached", () => {
    const { panel, controller } = harness('user');
    const view = open(panel);
    view.send({ type: 'turn', message: 'yours', attach: true });
    view.send({ type: 'turn' });
    expect(controller.resume.mock.calls).toEqual([[], []]);
    expect(controller.handBack.mock.calls).toEqual([
      ['yours', SELECTION],
      [undefined, undefined],
    ]);
    expect(controller.takeTurn.mock.calls).toEqual([]);
  });

  it("turn: takes the turn on the agent's turn", () => {
    const { panel, controller } = harness('agent');
    open(panel).send({ type: 'turn' });
    expect(controller.takeTurn.mock.calls).toEqual([[]]);
    expect(controller.handBack.mock.calls).toEqual([]);
  });

  it('open: opens the file at the line, the first line for line 0', () => {
    const view = open(harness().panel);
    view.send({ type: 'open', file: 'a.ts', line: 5 });
    view.send({ type: 'open', file: 'b.ts', line: 0 });
    expect(vi.mocked(vscode.window.showTextDocument).mock.calls).toEqual([
      [vscode.Uri.file('/root/a.ts'), { selection: lineStart(4) }],
      [vscode.Uri.file('/root/b.ts'), { selection: lineStart(0) }],
    ]);
  });

  it('command: runs a command the intro links to, and no other', () => {
    const view = open(harness().panel);
    view.send({ type: 'command', command: 'aiPair.playDemo' });
    view.send({ type: 'command', command: 'aiPair.setUpAgent' });
    view.send({ type: 'command', command: 'workbench.action.quit' });
    expect(vi.mocked(vscode.commands.executeCommand).mock.calls).toEqual([['aiPair.playDemo'], ['aiPair.setUpAgent']]);
  });

  it('openUrl: opens an http or https link, and no other', () => {
    const view = open(harness().panel);
    view.send({ type: 'openUrl', url: 'https://example.com' });
    view.send({ type: 'openUrl', url: 'http://example.com' });
    view.send({ type: 'openUrl', url: 'file:///etc/passwd' });
    expect(vi.mocked(vscode.env.openExternal).mock.calls).toEqual([
      [vscode.Uri.parse('https://example.com')],
      [vscode.Uri.parse('http://example.com')],
    ]);
  });

  it('openChange: opens the diff against git, or the file itself when git cannot', async () => {
    const view = open(harness().panel);
    vi.mocked(vscode.commands.executeCommand).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('No git.'));
    view.send({ type: 'openChange', file: 'a.ts' });
    await flush();
    view.send({ type: 'openChange', file: 'b.ts' });
    await flush();
    expect(vi.mocked(vscode.commands.executeCommand).mock.calls).toEqual([
      ['git.openChange', vscode.Uri.file('/root/a.ts')],
      ['git.openChange', vscode.Uri.file('/root/b.ts')],
      ['vscode.open', vscode.Uri.file('/root/b.ts')],
    ]);
  });

  it('ignores a message of a type it does not know', () => {
    const { panel, controller } = harness();
    const view = open(panel);
    view.receive({ type: 'unknown' });
    expect(view.posted).toEqual([]);
    expect(controller.resume.mock.calls).toEqual([]);
  });

  it('does nothing for a controller message with no controller, calibration, or trace', async () => {
    const view = open(bare());
    const messages: FromPanel[] = [
      { type: 'reply', text: 'hi' },
      { type: 'draft', empty: true },
      { type: 'draft', empty: false },
      { type: 'pause' },
      { type: 'resume' },
      { type: 'interrupt' },
      { type: 'turn' },
      { type: 'end' },
      { type: 'runDecision', id: 1, run: false },
      { type: 'start' },
    ];
    for (const message of messages) {
      view.send(message);
    }
    await flush();
    expect(view.posted).toEqual([]);
  });
});

describe('start', () => {
  it('RunsAreClicks: runs the starter once per start from the page', () => {
    const { panel, starter } = harness();
    const view = open(panel);
    starter.start.mockReturnValue(new Promise(() => {}));
    view.send({ type: 'start' });
    view.send({ type: 'start' });
    expect(starter.start.mock.calls).toHaveLength(2);
  });

  it('Settles: tells the page once the agent a start ran has exited', async () => {
    const { panel, starter } = harness();
    const exit = Promise.withResolvers<void>();
    starter.start.mockReturnValue(exit.promise);
    const view = open(panel);
    view.send({ type: 'start' });
    await flush();
    expect(view.posted).not.toContainEqual({ type: 'startEnded' });
    exit.resolve();
    await flush();
    expect(view.posted).toContainEqual({ type: 'startEnded' });
  });
});

describe('openFile', () => {
  it('opens a path from the workspace root directly', async () => {
    open(harness().panel).send({ type: 'openFile', file: 'src/a.ts' });
    await flush();
    expect(fakes.stat.mock.calls).toEqual([[vscode.Uri.file('/root/src/a.ts')]]);
    expect(vi.mocked(vscode.window.showTextDocument).mock.calls).toEqual([[vscode.Uri.file('/root/src/a.ts')]]);
    expect(vi.mocked(vscode.workspace.findFiles).mock.calls).toEqual([]);
  });

  it('says so when no file of the name is in the workspace', async () => {
    fakes.stat.mockRejectedValue(new Error('No file.'));
    open(harness().panel).send({ type: 'openFile', file: 'a.ts' });
    await flush();
    expect(vi.mocked(vscode.workspace.findFiles).mock.calls).toEqual([['**/a.ts', '**/node_modules/**', MAX_FOUND]]);
    expect(vi.mocked(vscode.window.showInformationMessage).mock.calls).toEqual([["AI Pair: couldn't find a.ts in the workspace."]]);
    expect(vi.mocked(vscode.window.showTextDocument).mock.calls).toEqual([]);
  });

  it('opens the one file of the name without asking', async () => {
    fakes.stat.mockRejectedValue(new Error('No file.'));
    vi.mocked(vscode.workspace.findFiles).mockResolvedValue([vscode.Uri.file('/root/src/a.ts')]);
    open(harness().panel).send({ type: 'openFile', file: 'a.ts' });
    await flush();
    expect(vi.mocked(vscode.window.showQuickPick).mock.calls).toEqual([]);
    expect(vi.mocked(vscode.window.showTextDocument).mock.calls).toEqual([[vscode.Uri.file('/root/src/a.ts')]]);
  });

  it('asks which of several files of the name was meant, and opens the one picked, or none', async () => {
    const found = [vscode.Uri.file('/root/src/a.ts'), vscode.Uri.file('/root/test/a.ts')];
    fakes.stat.mockRejectedValue(new Error('No file.'));
    vi.mocked(vscode.workspace.findFiles).mockResolvedValue(found);
    const view = open(harness().panel);
    view.send({ type: 'openFile', file: 'a.ts' });
    await flush();
    expect(vi.mocked(vscode.window.showQuickPick).mock.calls).toEqual([
      [
        [
          { label: 'relative/root/src/a.ts', uri: found[0] },
          { label: 'relative/root/test/a.ts', uri: found[1] },
        ],
        { placeHolder: 'Which a.ts?' },
      ],
    ]);
    expect(vi.mocked(vscode.window.showTextDocument).mock.calls).toEqual([]);
    fakes.pick = 1;
    view.send({ type: 'openFile', file: 'a.ts' });
    await flush();
    expect(vi.mocked(vscode.window.showTextDocument).mock.calls).toEqual([[found[1]]]);
  });
});
