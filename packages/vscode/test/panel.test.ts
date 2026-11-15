// The narration panel (specs/PanelReplay.tla, specs/Start.tla, specs/Draft.tla). Solitary: the vscode module and
// panel_html's panelHtml are mocks; the controller, calibration, starter, view, and the panel's other hooks are fakes
// passed in, so a test says what each answers and sees what the panel asked of it.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { mock, type MockProxy } from 'vitest-mock-extended';
import * as vscode from 'vscode';
import type { Controller, PanelEvent, Ref } from '@ai-pair/core';
import { EXCERPT_SCHEMA, speechDecodeToPage, type Turn } from '@ai-pair/protocol';
import type { Calibration } from '../src/calibration';
import { NarrationPanel, type PanelWiring, type Starter } from '../src/panel';
import { panelHtml, SPEEDS } from '../src/panel_html';
import type { FromPanel, ToPanel } from '../src/panel_messages';
import type { SpeechDecodeBridgeOptions } from '../src/speech_decode_bridge';

/** What the mocked modules share with the tests, made before the `vi.mock` factories run. */
const fakes = vi.hoisted(() => ({
  /** The index of the item the programmer picks from the next quick pick; none, as if Escape. */
  pick: undefined as number | undefined,
  /** workspace.fs.stat: whether a path is in the workspace. */
  stat: vi.fn<(uri: unknown) => Promise<unknown>>(() => Promise.resolve({})),
  decodeActivate: vi.fn<(document: { pageId: number; documentGeneration: number }) => void>(),
  decodeResume: vi.fn(),
  decodePrepare: vi.fn<(page: number) => { pageId: number; documentGeneration: number }>(),
  decodeDestroy: vi.fn(),
  decodeReady: vi.fn(),
  decodeDone: vi.fn(),
  decodeAdmit: vi.fn(),
  decodeOptions: vi.fn<(options: SpeechDecodeBridgeOptions) => void>(),
}));

vi.mock('../src/speech_decode_bridge', () => ({
  SpeechDecodeBridge: class {
    constructor(options: SpeechDecodeBridgeOptions) {
      fakes.decodeOptions(options);
    }
    prepare = fakes.decodePrepare;
    activate = fakes.decodeActivate;
    resume = fakes.decodeResume;
    destroy = fakes.decodeDestroy;
    ready = fakes.decodeReady;
    decoded = fakes.decodeDone;
    admit = fakes.decodeAdmit;
  },
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
      showErrorMessage: vi.fn(() => Promise.resolve()),
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
vi.mock('../src/timings', () => ({ timings: { tipDelayMs: 7, tipWarmMs: 8 } }));
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
  controllerAccessor: ReturnType<typeof vi.fn<() => MockProxy<Controller>>>;
  calibration: MockProxy<Calibration>;
  starter: MockProxy<Starter>;
  speed: { get: ReturnType<typeof vi.fn<() => number>>; set: ReturnType<typeof vi.fn<(value: number) => void>> };
  readingSpeed: { get: ReturnType<typeof vi.fn<() => number>>; set: ReturnType<typeof vi.fn<(value: number) => void>> };
  chatOrder: {
    get: ReturnType<typeof vi.fn<() => 'newestFirst' | 'oldestFirst'>>;
    set: ReturnType<typeof vi.fn<(value: 'newestFirst' | 'oldestFirst') => void>>;
  };
  navigatorCommentary: {
    get: ReturnType<typeof vi.fn<() => 'quiet' | 'helpful' | 'coach'>>;
    set: ReturnType<typeof vi.fn<(value: 'quiet' | 'helpful' | 'coach') => void>>;
  };
  replyBehavior: {
    get: ReturnType<typeof vi.fn<() => 'interrupt' | 'finishAction'>>;
    set: ReturnType<typeof vi.fn<(value: 'interrupt' | 'finishAction') => void>>;
  };
  terminalSettings: { get: ReturnType<typeof vi.fn<() => boolean>>; set: ReturnType<typeof vi.fn<(value: boolean) => void>> };
  commandApprovalSound: { get: ReturnType<typeof vi.fn<() => boolean>>; set: ReturnType<typeof vi.fn<(value: boolean) => void>> };
  showTerminal: ReturnType<typeof vi.fn<(id: number) => boolean>>;
  copyDiagnostics: ReturnType<typeof vi.fn<() => Promise<void>>>;
  requireCommandApproval: ReturnType<typeof vi.fn<() => Promise<void>>>;
  codePlayback: {
    get: ReturnType<typeof vi.fn<() => 'typing' | 'lines' | 'blocks'>>;
    set: ReturnType<typeof vi.fn<(value: 'typing' | 'lines' | 'blocks') => void>>;
  };
  speech: {
    settings: {
      get: ReturnType<typeof vi.fn<() => import('../src/speech_types').SpeechSettings>>;
      set: ReturnType<typeof vi.fn>;
    };
    computeState: ReturnType<typeof vi.fn<() => import('../src/speech_compute_types').SpeechComputeState>>;
    computeMode: ReturnType<typeof vi.fn<(value: import('../src/speech_compute_types').SpeechComputeMode) => void>>;
    checkGpuSetup: ReturnType<typeof vi.fn<() => void>>;
    diagnostic: ReturnType<typeof vi.fn<(event: import('../src/diagnostics').SpeechDiagnosticEvent) => void>>;
    outputView: ReturnType<typeof vi.fn>;
    outputReady: ReturnType<typeof vi.fn<() => boolean>>;
    outputRetired: ReturnType<typeof vi.fn>;
    outputPageRetired: ReturnType<typeof vi.fn>;
    outputRefresh: ReturnType<typeof vi.fn>;
    outputSelect: ReturnType<typeof vi.fn>;
    supported: ReturnType<typeof vi.fn<() => boolean>>;
    gpuSupported: ReturnType<typeof vi.fn<() => boolean>>;
    installed: ReturnType<typeof vi.fn<() => Promise<boolean>>>;
    modelStatus: ReturnType<typeof vi.fn<PanelWiring['speech']['modelStatus']>>;
    setup: ReturnType<typeof vi.fn<() => Promise<void>>>;
    preview: ReturnType<typeof vi.fn<() => Promise<void>>>;
    stop: ReturnType<typeof vi.fn<() => void>>;
    event: ReturnType<typeof vi.fn>;
    pageClosed: ReturnType<typeof vi.fn>;
    cloudSupported: ReturnType<typeof vi.fn<() => boolean>>;
    keySet: ReturnType<typeof vi.fn<() => Promise<void>>>;
    keyRemove: ReturnType<typeof vi.fn<() => Promise<void>>>;
    keyRefresh: ReturnType<typeof vi.fn<() => void>>;
    openRouterKeySet: ReturnType<typeof vi.fn<() => Promise<void>>>;
    openRouterKeyRemove: ReturnType<typeof vi.fn<() => Promise<void>>>;
    openRouterKeyRefresh: ReturnType<typeof vi.fn<() => void>>;
    loadOpenRouterModels: ReturnType<typeof vi.fn<() => void>>;
    validOpenRouterVoice: ReturnType<typeof vi.fn<(modelId: string, voiceId: string) => boolean>>;
    loadVoices: ReturnType<typeof vi.fn<(more: boolean) => void>>;
    validCloudVoice: ReturnType<typeof vi.fn<(id: string) => boolean>>;
  };
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
function harness(
  turn: Turn = 'agent',
  buildInfo = { version: '0.10.0', build: 'test-build' },
  readiness?: () => import('@ai-pair/protocol').AudioDiagnostics,
  sessionCost?: PanelWiring['speech']['sessionCost'],
  narrationSession?: PanelWiring['speech']['narrationSession'],
): Harness {
  const traced: string[] = [];
  const speed = { get: vi.fn(() => SPEEDS[1] ?? 0), set: vi.fn<(value: number) => void>() };
  const readingSpeed = { get: vi.fn(() => SPEEDS[2] ?? 0), set: vi.fn<(value: number) => void>() };
  const chatOrder = {
    get: vi.fn<() => 'newestFirst' | 'oldestFirst'>(() => 'newestFirst'),
    set: vi.fn<(value: 'newestFirst' | 'oldestFirst') => void>(),
  };
  const navigatorCommentary = {
    get: vi.fn<() => 'quiet' | 'helpful' | 'coach'>(() => 'helpful'),
    set: vi.fn<(value: 'quiet' | 'helpful' | 'coach') => void>(),
  };
  const replyBehavior = {
    get: vi.fn<() => 'interrupt' | 'finishAction'>(() => 'interrupt'),
    set: vi.fn<(value: 'interrupt' | 'finishAction') => void>(),
  };
  const terminalSettings = { get: vi.fn(() => false), set: vi.fn<(value: boolean) => void>() };
  const commandApprovalSound = { get: vi.fn(() => false), set: vi.fn<(value: boolean) => void>() };
  const showTerminal = vi.fn<(id: number) => boolean>();
  const codePlayback = {
    get: vi.fn<() => 'typing' | 'lines' | 'blocks'>(() => 'typing'),
    set: vi.fn<(value: 'typing' | 'lines' | 'blocks') => void>(),
  };
  const copyDiagnostics = vi.fn<() => Promise<void>>().mockResolvedValue();
  const requireCommandApproval = vi.fn<() => Promise<void>>().mockResolvedValue();
  const speech = {
    ...(readiness === undefined ? {} : { readiness }),
    ...(sessionCost === undefined ? {} : { sessionCost }),
    ...(narrationSession === undefined ? {} : { narrationSession }),
    settings: {
      get: vi.fn<() => import('../src/speech_types').SpeechSettings>(() => ({
        enabled: false,
        provider: 'kokoro',
        voice: 'af_heart',
        speed: 1,
        elevenLabsVoice: '',
        elevenLabsSpeed: 1,
      })),
      set: vi.fn(),
    },
    computeState: vi.fn<() => import('../src/speech_compute_types').SpeechComputeState>(() => ({
      requestedMode: 'cpu',
      actualBackend: 'none',
      gpuCheck: { phase: 'idle' },
    })),
    computeMode: vi.fn<(value: import('../src/speech_compute_types').SpeechComputeMode) => void>(),
    checkGpuSetup: vi.fn<() => void>(),
    diagnostic: vi.fn<(event: import('../src/diagnostics').SpeechDiagnosticEvent) => void>(),
    outputView: vi.fn(() => ({ supported: false, devices: [], selected: { kind: 'default' as const } })),
    outputReady: vi.fn(() => true),
    outputRetired: vi.fn(),
    outputPageRetired: vi.fn(),
    outputRefresh: vi.fn(),
    outputSelect: vi.fn(),
    cloudSupported: vi.fn(() => true),
    keySet: vi.fn<() => Promise<void>>().mockResolvedValue(),
    keyRemove: vi.fn<() => Promise<void>>().mockResolvedValue(),
    keyRefresh: vi.fn<() => void>(),
    openRouterKeySet: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    openRouterKeyRemove: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    openRouterKeyRefresh: vi.fn<() => void>(),
    loadOpenRouterModels: vi.fn<() => void>(),
    validOpenRouterVoice: vi.fn<(modelId: string, voiceId: string) => boolean>(),
    loadVoices: vi.fn<(more: boolean) => void>(),
    validCloudVoice: vi.fn<(id: string) => boolean>(),
    supported: vi.fn(() => true),
    gpuSupported: vi.fn(() => false),
    installed: vi.fn<() => Promise<boolean>>().mockResolvedValue(false),
    modelStatus: vi
      .fn<PanelWiring['speech']['modelStatus']>()
      .mockResolvedValue({ path: '/model', source: 'https://example.test', revision: 'abc', verified: false, download: 'missing' }),
    setup: vi.fn<() => Promise<void>>().mockResolvedValue(),
    preview: vi.fn<() => Promise<void>>().mockResolvedValue(),
    stop: vi.fn<() => void>(),
    event: vi.fn(),
    pageClosed: vi.fn(),
  };
  const controller = mock<Controller>({ turn, commandApprovals: { all: false, commands: [], confirmationRequired: true } });
  const controllerAccessor = vi.fn(() => controller);
  const calibration = mock<Calibration>();
  calibration.reply.mockReturnValue(false);
  const starter = mock<Starter>();
  starter.available.mockResolvedValue(true);
  starter.start.mockResolvedValue();
  const panel = new NarrationPanel(
    (file) => `${ROOT}/${file}`,
    speed,
    readingSpeed,
    { current: () => SELECTION, ref: () => REF },
    (line) => {
      traced.push(line);
    },
    vscode.Uri.file(EXTENSION),
    {
      controller: controllerAccessor,
      calibration: () => calibration,
      starter,
      copyDiagnostics,
      requireCommandApproval,
      speech,
    },
    chatOrder,
    buildInfo,
    terminalSettings,
    showTerminal,
    codePlayback,
    replyBehavior,
    commandApprovalSound,
    navigatorCommentary,
  );
  const onPost = vi.fn<() => void>();
  panel.onPost = onPost;
  return {
    panel,
    controller,
    controllerAccessor,
    requireCommandApproval,
    calibration,
    starter,
    speed,
    readingSpeed,
    chatOrder,
    replyBehavior,
    navigatorCommentary,
    terminalSettings,
    commandApprovalSound,
    showTerminal,
    copyDiagnostics,
    speech,
    codePlayback,
    onPost,
    traced,
  };
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
  it('posts decoder requests only to a booted local view and exposes its admission', async () => {
    const { panel } = harness();
    const options = fakes.decodeOptions.mock.calls[0]?.[0];
    if (options === undefined) throw new Error('Missing decoder options');
    const token = '95334bd8-9c15-4ea2-8988-dcbe2c029708';
    const document = { pageId: 1, documentGeneration: 1 };
    const message = { type: 'speechDecodeProbe' as const, document, probeId: 1 };
    expect(await options.post(message)).toBe(false);
    expect(options.page()).toBeUndefined();
    const view = open(panel);
    fakes.decodePrepare.mockReturnValue(document);
    view.send({ type: 'speechDecodeBoot', token });
    view.send({ type: 'speechDecodeBootAck', token, document: { ...document, documentGeneration: 9 } });
    expect(await options.post(message)).toBe(false);
    view.send({ type: 'speechDecodeBootAck', token, document });
    view.send({ type: 'ready' });
    expect(options.page()).toBe(1);
    expect(await options.post(message)).toBe(true);
    expect(
      view.webview.postMessage.mock.calls.some(([posted]) => {
        const parsed = speechDecodeToPage.safeParse(posted);
        return parsed.success && parsed.data.type === 'speechDecodeProbe' && parsed.data.token === token;
      }),
    ).toBe(true);
    const signal = new AbortController().signal;
    void panel.admitSpeechDecode(42, signal);
    expect(fakes.decodeAdmit).toHaveBeenCalledWith(42, signal);
    view.receive({ type: 'speechDecodeDone', token: 'invalid' });
    view.send({ type: 'speechDecodeBoot', token });
    view.dispose();
    expect(fakes.decodeDestroy).toHaveBeenCalledWith(document);
    expect(await options.post(message)).toBe(false);
  });
  it('reuses a candidate for duplicate boots and the document for a repeated current token', () => {
    const { panel } = harness();
    const view = open(panel);
    const document = { pageId: 1, documentGeneration: 1 };
    const token = '95334bd8-9c15-4ea2-8988-dcbe2c029708';
    fakes.decodePrepare.mockReturnValue(document);
    view.send({ type: 'speechDecodeBoot', token });
    const firstChallenge = view.posted.at(-1);
    view.send({ type: 'speechDecodeBoot', token });
    expect(view.posted.at(-1)).toEqual(firstChallenge);
    expect(fakes.decodePrepare).toHaveBeenCalledOnce();
    view.send({ type: 'speechDecodeBootAck', token, document });
    expect(fakes.decodeActivate).toHaveBeenCalledWith(document);
    view.send({ type: 'speechDecodeBoot', token });
    expect(view.posted.at(-1)).toEqual(firstChallenge);
    expect(fakes.decodePrepare).toHaveBeenCalledOnce();
    view.send({ type: 'speechDecodeBootAck', token, document });
    expect(fakes.decodeActivate).toHaveBeenCalledOnce();
  });

  it('keeps boot, challenge and decoder replies in the local view and retires only the replaced document', () => {
    const { panel } = harness();
    const forward = vi.fn<import('../src/panel').CompanionPanelRouting['forward']>();
    panel.useCompanion({ forward, closed: vi.fn<import('../src/panel').CompanionPanelRouting['closed']>() });
    const view = open(panel);
    const first = { pageId: 1, documentGeneration: 1 };
    const second = { pageId: 1, documentGeneration: 2 };
    const token = '95334bd8-9c15-4ea2-8988-dcbe2c029708';
    const token2 = 'a2b2f953-95f5-4fc8-945c-d6b3b9eb54e3';
    fakes.decodePrepare.mockReturnValueOnce(first).mockReturnValueOnce(second);
    view.send({ type: 'speechDecodeBoot', token });
    expect(speechDecodeToPage.parse(view.posted.at(-1))).toEqual({ type: 'speechDecodeChallenge', token, document: first });
    view.send({ type: 'speechDecodeBootAck', token, document: first });
    view.send({ type: 'speechDecodeReady', token, document: first, probeId: 1, available: true });
    expect(fakes.decodeReady).toHaveBeenCalledWith(first, 1, true);
    view.send({ type: 'speechDecodeBoot', token: token2 });
    view.send({ type: 'speechDecodeBootAck', token: token2, document: second });
    expect(fakes.decodeDestroy).toHaveBeenCalledWith(first);
    view.send({ type: 'speechDecodeDone', token, document: first, requestId: 1 });
    expect(fakes.decodeDone).not.toHaveBeenCalled();
    view.send({ type: 'speechDecodeDone', token: token2, document: second, requestId: 2 });
    expect(fakes.decodeDone).toHaveBeenCalledWith(second, 2, undefined);
    expect(forward).not.toHaveBeenCalled();
    view.dispose();
    expect(fakes.decodeDestroy).toHaveBeenCalledWith(second);
  });

  it('keeps the current decoder on an old-view disposal and on visibility changes', () => {
    const { panel } = harness();
    const token = '95334bd8-9c15-4ea2-8988-dcbe2c029708';
    const token2 = 'a2b2f953-95f5-4fc8-945c-d6b3b9eb54e3';
    const first = { pageId: 1, documentGeneration: 1 };
    const second = { pageId: 2, documentGeneration: 2 };
    fakes.decodePrepare.mockReturnValueOnce(first).mockReturnValueOnce(second);
    const old = open(panel);
    old.send({ type: 'speechDecodeBoot', token });
    old.send({ type: 'speechDecodeBootAck', token, document: first });
    const current = open(panel);
    current.send({ type: 'speechDecodeBoot', token: token2 });
    current.send({ type: 'speechDecodeBootAck', token: token2, document: second });
    current.send({ type: 'speechPageHidden', pageId: 2 });
    current.send({ type: 'speechPageVisible', pageId: 2 });
    expect(fakes.decodeDestroy).not.toHaveBeenCalled();
    old.send({ type: 'speechDecodeDone', token: token2, document: first, requestId: 1 });
    expect(fakes.decodeDone).not.toHaveBeenCalled();
    old.send({ type: 'speechDecodeDone', token, document: first, requestId: 1 });
    expect(fakes.decodeDone).toHaveBeenCalledWith(first, 1, undefined);
    old.dispose();
    expect(fakes.decodeDestroy).toHaveBeenCalledExactlyOnceWith(first);
    current.send({ type: 'speechDecodeReady', token: token2, document: second, probeId: 1, available: true });
    expect(fakes.decodeReady).toHaveBeenCalledWith(second, 1, true);
    current.dispose();
    expect(fakes.decodeDestroy).toHaveBeenLastCalledWith(second);
  });
  it("gives the page scripts, the extension's dist folder, and the page from panelHtml with its style and script", () => {
    const view = open(harness().panel);
    expect(view.webview.options).toEqual({ enableScripts: true, localResourceRoots: [vscode.Uri.file('/ext/dist')] });
    expect(vi.mocked(panelHtml).mock.calls).toEqual([
      [CSP, 'webview:/ext/dist/panel.css', 'webview:/ext/dist/panel.js', '0.10.0', 'test-build'],
    ]);
    expect(view.webview.html).toBe('<html>');
  });

  it('ShowsRunning, ShowsNewAfterReload: each page uses its running bundle identity', () => {
    open(harness('agent', { version: '0.9.0', build: 'old' }).panel);
    open(harness('agent', { version: '0.10.0', build: 'new' }).panel);
    expect(vi.mocked(panelHtml).mock.calls.map((args) => args.slice(3))).toEqual([
      ['0.9.0', 'old'],
      ['0.10.0', 'new'],
    ]);
  });

  it('releases a reading hold only when the current view is disposed', () => {
    const { panel, controller } = harness();
    const old = open(panel);
    const current = open(panel);
    old.dispose();
    expect(controller.releaseReadingHold.mock.calls).toEqual([]);
    current.dispose();
    expect(controller.releaseReadingHold.mock.calls).toEqual([[]]);
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

  it('keeps the new view draft and calibration when an old view is disposed', () => {
    const { panel, controller, calibration } = harness();
    const old = open(panel);
    const current = open(panel);
    current.send({ type: 'draft', empty: false });
    old.dispose();
    expect(controller.resume.mock.calls).toEqual([]);
    expect(calibration.cancel.mock.calls).toEqual([]);
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
});

describe('attention', () => {
  it('forwards a hand press to the controller', () => {
    const { panel, controller } = harness();
    panel.receiveFromPage({ type: 'attention' });
    expect(controller.requestAttention.mock.calls).toHaveLength(1);
  });
});

describe('cursor navigation', () => {
  it('ShowsCursor: forwards the action without changing playback', () => {
    const { panel, controller } = harness();
    panel.receiveFromPage({ type: 'revealCursor' });
    expect(controller.revealCursor.mock.calls).toHaveLength(1);
    expect(controller.pause.mock.calls).toHaveLength(0);
    expect(controller.resume.mock.calls).toHaveLength(0);
  });
});

describe('post', () => {
  it('LogsPosts: a posted event is on the log a new view replays', () => {
    const panel = harness().panel;
    panel.post({ type: 'say', text: 'hello' });
    expect(replayed(panel)).toEqual([{ type: 'say', text: 'hello' }]);
  });

  it("ReplayShowsSession and Bounded: keeps the session's start in the log however many events follow it", () => {
    const panel = harness().panel;
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
    const panel = harness().panel;
    panel.post({ type: 'session', active: true });
    panel.post({ type: 'session', active: false, reason: 'programmer' });
    for (let i = 0; i < 1000; i++) {
      panel.post({ type: 'say', text: `message ${i}` });
    }
    expect(replayed(panel).filter((e) => e.type === 'session')).toEqual([{ type: 'session', active: false, reason: 'programmer' }]);
  });

  it('cuts the oldest events beyond MAX_LOG, putting back no session when none was cut or one is still on the log', () => {
    const panel = harness().panel;
    for (let i = 0; i <= MAX_LOG; i++) {
      panel.post({ type: 'say', text: `message ${i}` });
    }
    expect(panel.history).toHaveLength(MAX_LOG);
    expect(panel.history[0]).toEqual({ type: 'say', text: 'message 1' });
    const kept = harness().panel;
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
  });
});

describe('restoreHistory', () => {
  it('puts the saved history on the log for the view to replay, and sets aiPair.active', () => {
    const panel = harness().panel;
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
      harness().panel.showSpeed(1);
    }).not.toThrow();
  });
});

describe('focusReply', () => {
  it('shows the view, taking focus, and tells the page to focus the reply box', () => {
    const { panel } = harness();
    const view = open(panel);
    view.send({ type: 'ready' });
    view.posted.length = 0;
    panel.focusReply();
    expect(view.view.show.mock.calls).toEqual([[false]]);
    expect(view.posted).toEqual([{ type: 'focusReply' }]);
  });

  it('focuses the view by command with no view', () => {
    harness().panel.focusReply();
    expect(vi.mocked(vscode.commands.executeCommand).mock.calls).toEqual([['aiPair.narration.focus']]);
  });

  it('delivers a reply focus requested before the page is ready', () => {
    const { panel } = harness();
    panel.focusReply();
    const view = open(panel);
    expect(view.posted).not.toContainEqual({ type: 'focusReply' });
    view.send({ type: 'ready' });
    expect(view.posted).toContainEqual({ type: 'focusReply' });
  });

  it('drops a pending reply focus when its session ends', () => {
    const { panel } = harness();
    panel.focusReply();
    panel.post({ type: 'session', active: false, reason: 'programmer' });
    const view = open(panel);
    view.send({ type: 'ready' });
    expect(view.posted).not.toContainEqual({ type: 'focusReply' });
  });

  it('keeps a pending reply focus across page replacement', () => {
    const { panel } = harness();
    panel.focusReply();
    const old = open(panel);
    const current = open(panel);
    old.dispose();
    current.send({ type: 'ready' });
    expect(current.posted).toContainEqual({ type: 'focusReply' });
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

  it("LatestAnswerProp: drops an earlier question's answer that lands after the reask's, on the same page", async () => {
    const { panel, starter } = harness();
    const first = Promise.withResolvers<boolean>();
    const reask = Promise.withResolvers<boolean>();
    starter.available.mockReturnValueOnce(first.promise).mockReturnValueOnce(reask.promise);
    const view = open(panel);
    view.send({ type: 'ready' });
    panel.askStart();
    reask.resolve(true);
    await flush();
    first.resolve(false);
    await flush();
    expect(postedOf(view, 'canStart')).toEqual([{ type: 'canStart', value: true }]);
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

  it('projects and validates navigator commentary', () => {
    const { panel, navigatorCommentary } = harness();
    const view = open(panel);
    view.send({ type: 'ready' });
    expect(view.posted).toContainEqual({ type: 'navigatorCommentary', value: 'helpful' });
    view.send({ type: 'navigatorCommentary', value: 'coach' });
    panel.receiveFromPage({ type: 'navigatorCommentary', value: 'invalid' });
    expect(navigatorCommentary.set.mock.calls).toEqual([['coach']]);
    panel.showNavigatorCommentary('quiet');
    expect(view.posted).toContainEqual({ type: 'navigatorCommentary', value: 'quiet' });
  });

  it('ready: ends the draft pause, and sends the log, speeds, selection, and whether it can start', async () => {
    const { panel, controller } = harness();
    panel.post({ type: 'say', text: 'hi' });
    const view = open(panel);
    view.send({ type: 'ready' });
    await flush();
    expect(controller.resume.mock.calls).toEqual([['reply']]);
    expect(view.posted).toEqual([
      { type: 'speechPage', pageId: 1 },
      { type: 'speechTransport', available: true },
      {
        type: 'speechSettings',
        value: { enabled: false, provider: 'kokoro', voice: 'af_heart', speed: 1, elevenLabsVoice: '', elevenLabsSpeed: 1 },
      },
      { type: 'speechComputeState', value: { requestedMode: 'cpu', actualBackend: 'none', gpuCheck: { phase: 'idle' } } },
      { type: 'speechOutputCatalog', value: { supported: false, devices: [], selected: { kind: 'default' } } },
      { type: 'speechCloudSupport', supported: true },
      { type: 'speechSupport', supported: true, gpu: false },
      { type: 'navigatorCommentary', value: 'helpful' },
      { type: 'chatOrder', value: 'newestFirst' },
      { type: 'replyBehavior', value: 'interrupt' },
      { type: 'commandApprovalSound', value: false },
      { type: 'commandApprovals', all: false, count: 0, confirmationRequired: true },
      { type: 'replay', events: [{ type: 'say', text: 'hi' }] },
      { type: 'showTerminals', value: false },
      { type: 'speed', value: SPEEDS[1] },
      { type: 'readingSpeed', value: SPEEDS[2] },
      { type: 'codePlayback', value: 'typing' },
      { type: 'selection', ref: REF },
      { type: 'timings', tipDelayMs: 7, tipWarmMs: 8 },
      {
        type: 'speechModelStatus',
        value: { path: '/model', source: 'https://example.test', revision: 'abc', verified: false, download: 'missing' },
      },
      { type: 'speechSetupState', pending: false, message: 'Local speech is not set up.' },
      { type: 'canStart', value: true },
    ]);
  });

  it('publishes the owner snapshot and routes revocation from the page', () => {
    const { panel, controller } = harness();
    controller.commandApprovals.all = true;
    controller.commandApprovals.commands.push('npm test');
    const view = open(panel);
    view.send({ type: 'ready' });
    expect(view.posted).toContainEqual({ type: 'commandApprovals', all: true, count: 1, confirmationRequired: true });
    controller.commandApprovals.all = false;
    controller.commandApprovals.commands.length = 0;
    view.send({ type: 'revokeCommandApprovals' });
    expect(controller.setConfirmCommands.mock.calls).toEqual([[true]]);
    expect(controller.revokeCommandApprovals.mock.calls).toEqual([[]]);
    expect(view.posted.at(-1)).toEqual({ type: 'commandApprovals', all: false, count: 0, confirmationRequired: true });
  });

  it('requires confirmation immediately while persistence is pending and reports a failed write', async () => {
    const { panel, controller, requireCommandApproval } = harness();
    const saving = Promise.withResolvers<void>();
    requireCommandApproval.mockReturnValue(saving.promise);
    const view = open(panel);
    view.send({ type: 'revokeCommandApprovals' });
    expect(controller.setConfirmCommands.mock.calls).toEqual([[true]]);
    expect(controller.revokeCommandApprovals.mock.calls).toEqual([[]]);
    expect(requireCommandApproval).toHaveBeenCalledOnce();
    saving.reject(new Error('write failed'));
    await flush();
    expect(vi.mocked(vscode.window.showErrorMessage)).toHaveBeenCalledWith(
      'Could not save command approval settings. Confirmation is on for this window.',
    );
    expect(controller.setConfirmCommands.mock.calls).toEqual([[true]]);
  });

  it('sends the saved order before replay and accepts only valid choices', () => {
    const { panel, chatOrder } = harness();
    chatOrder.get.mockReturnValue('oldestFirst');
    const view = open(panel);
    view.send({ type: 'ready' });
    expect(view.posted.slice(8, 13)).toEqual([
      { type: 'chatOrder', value: 'oldestFirst' },
      { type: 'replyBehavior', value: 'interrupt' },
      { type: 'commandApprovalSound', value: false },
      { type: 'commandApprovals', all: false, count: 0, confirmationRequired: true },
      { type: 'replay', events: [] },
    ]);
    view.send({ type: 'chatOrder', value: 'newestFirst' });
    expect(chatOrder.set).toHaveBeenCalledWith('newestFirst');
    // A webview message crosses a runtime boundary despite its compile-time type.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    view.send({ type: 'chatOrder', value: 'invalid' } as unknown as FromPanel);
    expect(chatOrder.set).toHaveBeenCalledTimes(1);
    panel.showChatOrder('oldestFirst');
    expect(view.posted).toContainEqual({ type: 'chatOrder', value: 'oldestFirst' });
  });

  it('restores and validates the reply behavior', () => {
    const { panel, replyBehavior } = harness();
    replyBehavior.get.mockReturnValue('finishAction');
    const view = open(panel);
    view.send({ type: 'ready' });
    expect(view.posted).toContainEqual({ type: 'replyBehavior', value: 'finishAction' });
    view.send({ type: 'replyBehavior', value: 'interrupt' });
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    view.send({ type: 'replyBehavior', value: 'invalid' } as unknown as FromPanel);
    expect(replyBehavior.set.mock.calls).toEqual([['interrupt']]);
    panel.showReplyBehavior('finishAction');
    expect(view.posted).toContainEqual({ type: 'replyBehavior', value: 'finishAction' });
  });

  it('restores and validates the optional command approval sound', () => {
    const { panel, commandApprovalSound } = harness();
    const view = open(panel);
    view.send({ type: 'ready' });
    expect(view.posted).toContainEqual({ type: 'commandApprovalSound', value: false });
    view.receive({ type: 'commandApprovalSound', value: true });
    view.receive({ type: 'commandApprovalSound', value: 'true' });
    expect(commandApprovalSound.set.mock.calls).toEqual([[true]]);
    panel.showCommandApprovalSound(true);
    expect(view.posted).toContainEqual({ type: 'commandApprovalSound', value: true });
  });

  it('receiveFromPage: handles an object with a string type as the page would, and drops anything else', () => {
    const { panel, controller } = harness();
    panel.receiveFromPage({ type: 'pause' });
    expect(controller.pause.mock.calls).toEqual([[]]);
    for (const other of [undefined, JSON.parse('null') as unknown, 'pause', 7, { kind: 'pause' }, { type: 7 }]) {
      panel.receiveFromPage(other);
    }
    expect(controller.pause.mock.calls).toEqual([[]]);
  });

  it('OnlyOnRequest and RequestedCompletes: copies only when asked and reports either outcome', async () => {
    const { panel, copyDiagnostics } = harness();
    const view = open(panel);
    view.send({ type: 'ready' });
    expect(copyDiagnostics).not.toHaveBeenCalled();
    view.send({ type: 'copyDiagnostics' });
    await flush();
    expect(copyDiagnostics).toHaveBeenCalledTimes(1);
    expect(vi.mocked(vscode.window.showInformationMessage)).toHaveBeenCalledWith('AI Pair diagnostics copied.');
    copyDiagnostics.mockRejectedValueOnce(new Error('clipboard unavailable'));
    view.send({ type: 'copyDiagnostics' });
    await flush();
    expect(vi.mocked(vscode.window.showErrorMessage)).toHaveBeenCalledWith('Could not copy AI Pair diagnostics.');
  });

  it('ChoiceApplied: sends the saved mode and accepts only valid choices', () => {
    const { panel, codePlayback } = harness();
    const view = open(panel);
    view.send({ type: 'ready' });
    expect(view.posted).toContainEqual({ type: 'codePlayback', value: 'typing' });
    view.send({ type: 'codePlayback', value: 'lines' });
    view.send({ type: 'codePlayback', value: 'blocks' });
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    view.send({ type: 'codePlayback', value: 'other' } as unknown as FromPanel);
    expect(codePlayback.set.mock.calls).toEqual([['lines'], ['blocks']]);
  });

  it('forwards only valid reading countdown IDs', () => {
    const { panel, controller } = harness();
    const view = open(panel);
    view.send({ type: 'skipReading', id: 42 });
    view.send({ type: 'skipReading', id: -1 });
    view.send({ type: 'skipReading', id: Number.NaN });
    expect(controller.finishReading.mock.calls).toEqual([[42]]);
  });

  it('validates reading hold requests at the webview boundary', () => {
    const { panel, controller } = harness();
    const view = open(panel);
    view.send({ type: 'holdReading', id: 42, held: true });
    view.send({ type: 'holdReading', id: 42, held: false });
    view.send({ type: 'holdReading', id: -1, held: true });
    view.send({ type: 'holdReading', id: Number.NaN, held: true });
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    view.send({ type: 'holdReading', id: 42, held: 'yes' } as unknown as FromPanel);
    expect(controller.holdReading.mock.calls).toEqual([
      [42, true],
      [42, false],
    ]);
  });

  it('MissingReported and AvailableShown: validates settings and reports a closed terminal', () => {
    const { panel, terminalSettings, showTerminal } = harness();
    const view = open(panel);
    view.send({ type: 'ready' });
    expect(view.posted).toContainEqual({ type: 'showTerminals', value: false });
    view.send({ type: 'showTerminals', value: true });
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    view.send({ type: 'showTerminals', value: 'yes' } as unknown as FromPanel);
    expect(terminalSettings.set.mock.calls).toEqual([[true]]);
    showTerminal.mockReturnValueOnce(true).mockReturnValueOnce(false);
    view.send({ type: 'showTerminal', id: 71 });
    view.send({ type: 'showTerminal', id: 72 });
    view.send({ type: 'showTerminal', id: -1 });
    expect(showTerminal.mock.calls).toEqual([[71], [72]]);
    expect(vi.mocked(vscode.window.showInformationMessage)).toHaveBeenCalledWith('That terminal is no longer available.');
  });

  it('showTimings: tells the page its delays, as a test sets them', () => {
    const { panel } = harness();
    const view = open(panel);
    panel.showTimings();
    expect(view.posted).toEqual([{ type: 'timings', tipDelayMs: 7, tipWarmMs: 8 }]);
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

  it('delivers a held reply before resuming so the owner can release attention safely', () => {
    const { panel, controller } = harness();
    const view = open(panel);
    view.send({ type: 'draft', empty: false });
    view.send({ type: 'reply', text: 'Hello' });
    expect(controller.userMessage.mock.invocationCallOrder[0]).toBeLessThan(controller.resume.mock.invocationCallOrder[0] ?? 0);
    expect(controller.resume.mock.calls).toEqual([[undefined, { reveal: false }]]);
  });

  it("ReplyMeansDraft: a reply the calibration takes ends the draft's pause; any other resumes without revealing and is sent on", () => {
    const { panel, controller, calibration } = harness();
    const view = open(panel);
    calibration.reply.mockReturnValueOnce(true);
    view.send({ type: 'reply', text: 'done' });
    expect(controller.userMessage.mock.calls).toEqual([]);
    view.send({ type: 'reply', text: 'with', attach: true });
    view.send({ type: 'reply', text: 'without' });
    expect(calibration.reply.mock.calls).toEqual([['done'], ['with'], ['without']]);
    expect(controller.resume.mock.calls).toEqual([['reply'], [undefined, { reveal: false }], [undefined, { reveal: false }]]);
    expect(controller.userMessage.mock.calls).toEqual([
      ['with', SELECTION, false],
      ['without', undefined, false],
    ]);
  });

  it('forwards a deferred reply without stopping narration immediately', () => {
    const { panel, controller, speech } = harness();
    open(panel).send({ type: 'reply', text: 'Wait', defer: true });
    expect(speech.stop).not.toHaveBeenCalled();
    expect(controller.userMessage.mock.calls).toContainEqual(['Wait', undefined, true]);
    expect(controller.resume.mock.calls).toContainEqual([undefined, { reveal: false }]);
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
    view.send({ type: 'runDecision', id: 4, run: true, remember: true });
    view.send({ type: 'runDecision', id: 5, run: true, scope: 'all' });
    view.send({ type: 'runDecision', id: 6, run: true, scope: 'command' });
    view.send({ type: 'runDecision', id: 7, run: false, scope: 'once' });
    view.send({ type: 'runDecision', id: 8, run: true, scope: 'once', remember: true });
    view.receive({ type: 'runDecision', id: 9, run: true, scope: 'invalid', remember: true });
    expect(controller.pause.mock.calls).toEqual([[]]);
    expect(controller.resume.mock.calls).toEqual([[]]);
    expect(controller.userInterrupt.mock.calls).toEqual([[]]);
    expect(controller.endSession.mock.calls).toEqual([[]]);
    expect(controller.decideRun.mock.calls).toEqual([
      [3, true, 'once'],
      [4, true, 'command'],
      [5, true, 'all'],
      [6, true, 'command'],
      [7, false, 'once'],
      [8, true, 'once'],
      [9, true, 'once'],
    ]);
  });

  it("turn: hands the turn back on the programmer's turn, with the selection when attached", () => {
    const { panel, controller } = harness('programmer');
    const view = open(panel);
    view.send({ type: 'turn', message: 'yours', attach: true });
    view.send({ type: 'turn' });
    expect(controller.resume.mock.calls).toEqual([[]]);
    expect(controller.handBack.mock.calls).toEqual([
      ['yours', SELECTION],
      [undefined, undefined],
    ]);
    expect(controller.takeTurn.mock.calls).toEqual([]);
  });

  it('preserves local speech on a plain handback and stops it for a message', () => {
    const { panel, speech } = harness('programmer');
    const view = open(panel);
    view.send({ type: 'turn' });
    expect(speech.stop).not.toHaveBeenCalled();
    view.send({ type: 'turn', message: 'Please change it' });
    expect(speech.stop).toHaveBeenCalledOnce();
  });

  it("turn: takes the turn on the agent's turn", () => {
    const { panel, controller, speech } = harness('agent');
    open(panel).send({ type: 'turn' });
    expect(speech.stop.mock.calls).toHaveLength(1);
    expect(controller.resume.mock.calls).toHaveLength(0);
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
    view.send({ type: 'command', command: 'aiPair.configureShortcuts' });
    view.send({ type: 'command', command: 'workbench.action.quit' });
    expect(vi.mocked(vscode.commands.executeCommand).mock.calls).toEqual([
      ['aiPair.playDemo'],
      ['aiPair.setUpAgent'],
      ['aiPair.configureShortcuts'],
    ]);
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
});

describe('start', () => {
  it('StartsAreClicks: runs the starter once per start from the page', () => {
    const { panel, starter } = harness();
    const view = open(panel);
    starter.start.mockReturnValue(new Promise(() => {}));
    view.send({ type: 'start' });
    view.send({ type: 'start' });
    expect(starter.start.mock.calls).toHaveLength(2);
  });

  it('NoteGoes: tells the page once the agent a start ran has exited', async () => {
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

it('sends audio only to the ready current page and never adds it to history', () => {
  const { panel, speech } = harness();
  expect(panel.playSpeech(1, new Uint8Array([1, 2]), 40)).toBeUndefined();
  const first = open(panel);
  first.send({ type: 'ready' });
  expect(panel.playSpeech(1, new Uint8Array([1, 2]), 40)).toBe(1);
  expect(first.posted).toContainEqual({ type: 'speechAudio', id: 1, pageId: 1, wavBase64: 'AQI=', durationMs: 40 });
  expect(panel.history).toEqual([]);
  const second = open(panel);
  second.send({ type: 'ready' });
  first.send({ type: 'speechEvent', id: 1, pageId: 1, event: 'ended' });
  expect(speech.event).not.toHaveBeenCalled();
  expect(panel.playSpeech(2, new Uint8Array([3]), 40)).toBe(2);
  second.send({ type: 'speechEvent', id: 2, pageId: 2, event: 'ended' });
  expect(speech.event).toHaveBeenCalledWith({ id: 2, pageId: 2, event: 'ended' });
  second.dispose();
  expect(speech.pageClosed).toHaveBeenCalledWith(2);
});

it('cancels speech before resuming for a reply', () => {
  const { panel, speech, controller } = harness();
  const view = open(panel);
  view.send({ type: 'reply', text: 'Continue' });
  expect(speech.stop).toHaveBeenCalledOnce();
  expect(speech.stop.mock.invocationCallOrder[0]).toBeLessThan(controller.resume.mock.invocationCallOrder[0] ?? 0);
});

it('does not offer setup or preview on an unsupported host', async () => {
  const { panel, speech } = harness();
  speech.supported.mockReturnValue(false);
  const view = open(panel);
  view.send({ type: 'ready' });
  view.send({ type: 'speechSetup' });
  view.send({ type: 'speechPreview' });
  await flush();
  expect(view.posted).toContainEqual({ type: 'speechSupport', supported: false, gpu: false });
  expect(speech.setup).not.toHaveBeenCalled();
  expect(speech.preview).not.toHaveBeenCalled();
});

it('routes speech controls and status only to the ready current page', () => {
  const { panel } = harness();
  expect(panel.speechPageIsReady()).toBe(false);
  expect(panel.speechReadyPageId()).toBeUndefined();
  panel.refreshSpeechSupport();
  panel.controlSpeech(1, 1, 'pause');
  panel.showSpeechStatus(1, 'preparing');
  const view = open(panel);
  expect(panel.playSpeech(1, new Uint8Array([1]), 1)).toBeUndefined();
  view.send({ type: 'ready' });
  expect(panel.speechPageIsReady()).toBe(true);
  expect(panel.speechReadyPageId()).toBe(1);
  panel.controlSpeech(1, 2, 'pause');
  panel.controlSpeech(1, 1, 'resume');
  panel.showSpeechStatus(1, 'preparing');
  panel.showSpeechStatus(1, 'unavailable', 'unavailable');
  expect(view.posted).toContainEqual({ type: 'speechControl', id: 1, pageId: 1, action: 'resume' });
  expect(view.posted).not.toContainEqual({ type: 'speechControl', id: 1, pageId: 2, action: 'pause' });
  expect(view.posted).toContainEqual({ type: 'speechStatus', id: 1, pageId: 1, state: 'preparing' });
  expect(view.posted).toContainEqual({ type: 'speechStatus', id: 1, pageId: 1, state: 'unavailable', message: 'unavailable' });
  view.send({ type: 'speechPageHidden', pageId: 2 });
  expect(panel.speechPageIsReady()).toBe(true);
  view.send({ type: 'speechPageHidden', pageId: 1 });
  expect(panel.speechPageIsReady()).toBe(false);
  expect(panel.speechReadyPageId()).toBeUndefined();
  view.send({ type: 'speechPageVisible', pageId: 2 });
  expect(panel.speechPageIsReady()).toBe(false);
  view.send({ type: 'speechPageVisible', pageId: 1 });
  expect(panel.speechPageIsReady()).toBe(true);
});

it('validates page events and preferences before forwarding speech controls', () => {
  const { panel, speech } = harness();
  const view = open(panel);
  view.send({ type: 'ready' });
  for (const value of [
    { type: 'speechEvent', id: 0, pageId: 1, event: 'started' },
    { type: 'speechEvent', id: 1.5, pageId: 1, event: 'started' },
    { type: 'speechEvent', id: 1, pageId: 2, event: 'started' },
    { type: 'speechEvent', id: 1, pageId: 1, event: 'unknown' },
    { type: 'speechSettings', value: undefined },
    { type: 'speechSettings', value: { enabled: 'yes', voice: 'af_heart', speed: 1 } },
    {
      type: 'speechSettings',
      value: { enabled: true, provider: 'kokoro', voice: 'invalid', speed: 1, elevenLabsVoice: '', elevenLabsSpeed: 1 },
    },
    {
      type: 'speechSettings',
      value: { enabled: true, provider: 'kokoro', voice: 'af_heart', speed: 9, elevenLabsVoice: '', elevenLabsSpeed: 1 },
    },
    {
      type: 'speechSettings',
      value: { enabled: true, provider: 'kokoro', voice: 'af_heart', speed: 1, listeningSpeed: 9, elevenLabsVoice: '', elevenLabsSpeed: 1 },
    },
    {
      type: 'speechSettings',
      value: {
        enabled: true,
        provider: 'kokoro',
        voice: 'af_heart',
        speed: 1,
        listeningSpeed: 1.03,
        elevenLabsVoice: '',
        elevenLabsSpeed: 1,
      },
    },
  ]) {
    view.receive(value);
  }
  expect(speech.event.mock.calls).toEqual([]);
  expect(speech.settings.set.mock.calls).toEqual([]);
  view.send({
    type: 'speechSettings',
    value: { enabled: true, provider: 'kokoro', voice: 'bf_emma', speed: 1.25, elevenLabsVoice: '', elevenLabsSpeed: 1 },
  });
  view.send({
    type: 'speechSettings',
    value: { enabled: true, provider: 'kokoro', voice: 'bf_emma', speed: 1, listeningSpeed: 0.75, elevenLabsVoice: '', elevenLabsSpeed: 1 },
  });
  view.send({
    type: 'speechSettings',
    value: { enabled: true, provider: 'kokoro', voice: 'bf_emma', speed: 1, listeningSpeed: 1.1, elevenLabsVoice: '', elevenLabsSpeed: 1 },
  });
  view.send({ type: 'speechStop' });
  expect(speech.settings.set.mock.calls).toEqual([
    [{ enabled: true, provider: 'kokoro', voice: 'bf_emma', speed: 1.25, elevenLabsVoice: '', elevenLabsSpeed: 1 }],
    [{ enabled: true, provider: 'kokoro', voice: 'bf_emma', speed: 1, listeningSpeed: 0.75, elevenLabsVoice: '', elevenLabsSpeed: 1 }],
    [{ enabled: true, provider: 'kokoro', voice: 'bf_emma', speed: 1, listeningSpeed: 1.1, elevenLabsVoice: '', elevenLabsSpeed: 1 }],
  ]);
  expect(speech.stop.mock.calls).toEqual([[]]);
});

it('reports setup and preview outcomes and ignores superseded availability checks', async () => {
  const { panel, speech } = harness();
  const pending = Promise.withResolvers<boolean>();
  speech.installed.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(true).mockRejectedValueOnce(new Error('unknown'));
  const view = open(panel);
  view.send({ type: 'ready' });
  panel.refreshSpeechSupport();
  await flush();
  expect(view.posted).toContainEqual({ type: 'speechSetupState', pending: false, message: 'Local model is ready.' });
  pending.reject(new Error('stale'));
  await flush();
  expect(view.posted).not.toContainEqual({ type: 'speechSetupState', pending: false, message: 'Local speech availability is unknown.' });
  panel.refreshSpeechSupport();
  await flush();
  expect(view.posted).toContainEqual({ type: 'speechSetupState', pending: false, message: 'Local speech availability is unknown.' });
  speech.preview.mockRejectedValueOnce(new Error('unavailable'));
  speech.setup.mockResolvedValueOnce().mockRejectedValueOnce(new Error('cancelled'));
  view.send({ type: 'speechPreview' });
  view.send({ type: 'speechSetup' });
  await flush();
  view.send({ type: 'speechSetup' });
  await flush();
  expect(view.posted).toContainEqual({ type: 'speechSetupState', pending: false, message: 'Voice preview is unavailable.' });
  expect(view.posted).toContainEqual({ type: 'speechSetupState', pending: true, message: 'Setting up local speech...' });
  expect(view.posted).toContainEqual({ type: 'speechSetupState', pending: false, message: 'Speech setup did not complete.' });
});

it('ignores a stale model check and reports a failed current check', async () => {
  const { panel, speech } = harness();
  const stale = Promise.withResolvers<Awaited<ReturnType<PanelWiring['speech']['modelStatus']>>>();
  speech.modelStatus.mockReturnValueOnce(stale.promise).mockRejectedValueOnce(new Error('failed'));
  const view = open(panel);
  view.send({ type: 'ready' });
  panel.refreshSpeechSupport();
  await flush();
  expect(view.posted).toContainEqual({ type: 'speechModelStatusUnavailable' });
  stale.resolve({ path: '/stale', source: 'https://example.test', revision: 'old', verified: true, download: 'installed' });
  await flush();
  expect(view.posted.some((message) => message.type === 'speechModelStatus' && message.value.path === '/stale')).toBe(false);
});

it('ignores a rejected superseded model status check', async () => {
  const { panel, speech } = harness();
  const stale = Promise.withResolvers<Awaited<ReturnType<PanelWiring['speech']['modelStatus']>>>();
  speech.modelStatus.mockReturnValueOnce(stale.promise);
  const view = open(panel);
  view.send({ type: 'ready' });
  panel.refreshSpeechSupport();
  await flush();
  stale.reject(new Error('stale'));
  await flush();
  expect(view.posted).not.toContainEqual({ type: 'speechModelStatusUnavailable' });
});

it('NoSecret, TypeOK: forwards only nonsecret key actions and validated cloud selections', async () => {
  const { panel, speech } = harness();
  const view = open(panel);
  view.send({ type: 'ready' });
  view.send({ type: 'speechKeySet' });
  view.send({ type: 'speechKeyRemove' });
  await flush();
  expect(speech.keySet.mock.calls).toEqual([[]]);
  expect(speech.keyRemove.mock.calls).toEqual([[]]);
  panel.showSpeechKeyStatus(true);
  expect(view.posted).toContainEqual({ type: 'speechKeyStatus', hasKey: true });
  const choice = {
    enabled: false,
    provider: 'elevenlabs' as const,
    voice: 'af_heart',
    speed: 1,
    elevenLabsVoice: 'account-voice',
    elevenLabsSpeed: 1,
  };
  view.send({ type: 'speechSettings', value: choice });
  expect(speech.settings.set.mock.calls).toEqual([]);
  speech.validCloudVoice.mockReturnValue(true);
  view.send({ type: 'speechSettings', value: choice });
  expect(speech.settings.set.mock.calls).toEqual([[choice]]);
  expect(JSON.stringify(view.posted)).not.toContain('secret-key');
});

it('requests voice pages only for a selected supported cloud provider', () => {
  const { panel, speech } = harness();
  const view = open(panel);
  view.send({ type: 'speechVoicesLoad' });
  expect(speech.loadVoices.mock.calls).toEqual([]);
  speech.settings.get.mockReturnValue({
    enabled: false,
    provider: 'elevenlabs',
    voice: 'af_heart',
    speed: 1,
    elevenLabsVoice: '',
    elevenLabsSpeed: 1,
  });
  view.send({ type: 'speechVoicesLoad' });
  view.send({ type: 'speechVoicesMore' });
  expect(speech.loadVoices.mock.calls).toEqual([[false], [true]]);
});

it('reports key operation failures and respects unsupported cloud hosts', async () => {
  const { panel, speech } = harness();
  const view = open(panel);
  speech.keySet.mockRejectedValueOnce(new Error('private'));
  view.send({ type: 'speechKeySet' });
  await flush();
  expect(view.posted).toContainEqual({ type: 'speechSetupState', pending: false, message: 'Could not update the API key.' });
  expect(JSON.stringify(view.posted)).not.toContain('private');
  panel.showSpeechCatalog({ voices: [], more: false, loading: false, error: false });
  expect(view.posted).toContainEqual({ type: 'speechCatalog', value: { voices: [], more: false, loading: false, error: false } });
  speech.cloudSupported.mockReturnValue(false);
  speech.settings.get.mockReturnValue({
    enabled: false,
    provider: 'elevenlabs',
    voice: 'af_heart',
    speed: 1,
    elevenLabsVoice: '',
    elevenLabsSpeed: 1,
  });
  view.send({ type: 'speechKeyRemove' });
  view.send({ type: 'speechPreview' });
  view.send({ type: 'speechVoicesLoad' });
  expect(speech.keyRemove.mock.calls).toEqual([]);
  expect(speech.preview.mock.calls).toEqual([]);
  expect(speech.loadVoices.mock.calls).toEqual([]);
});

it('records speech action receipt, dispatch and blocked reasons without private inputs', async () => {
  const { panel, speech } = harness();
  const view = open(panel);
  speech.supported.mockReturnValue(false);
  view.send({ type: 'speechPreview' });
  view.send({ type: 'speechSetup' });
  view.send({ type: 'speechVoicesLoad' });
  expect(speech.diagnostic.mock.calls.map(([event]) => event)).toEqual([
    { kind: 'speech', event: 'preview', phase: 'received', provider: 'kokoro' },
    { kind: 'speech', event: 'preview', phase: 'blocked', provider: 'kokoro', reason: 'unsupported' },
    { kind: 'speech', event: 'setup', phase: 'received', provider: 'kokoro' },
    { kind: 'speech', event: 'setup', phase: 'blocked', provider: 'kokoro', reason: 'unsupported' },
    { kind: 'speech', event: 'catalog', phase: 'received', provider: 'kokoro' },
    { kind: 'speech', event: 'catalog', phase: 'blocked', provider: 'kokoro', reason: 'not_ready' },
  ]);
  expect(view.posted).toContainEqual({ type: 'speechSetupState', pending: false, message: 'Local speech is unsupported on this host.' });
  expect(view.posted).toContainEqual({ type: 'speechSetupState', pending: false, message: 'Select ElevenLabs to load voices.' });
  speech.diagnostic.mockClear();
  speech.supported.mockReturnValue(true);
  view.send({ type: 'speechPreview' });
  view.send({ type: 'speechSetup' });
  await flush();
  expect(speech.diagnostic.mock.calls.map(([event]) => event)).toEqual([
    { kind: 'speech', event: 'preview', phase: 'received', provider: 'kokoro' },
    { kind: 'speech', event: 'preview', phase: 'dispatched', provider: 'kokoro' },
    { kind: 'speech', event: 'setup', phase: 'received', provider: 'kokoro' },
    { kind: 'speech', event: 'setup', phase: 'dispatched', provider: 'kokoro' },
    { kind: 'speech', event: 'setup', phase: 'ready', provider: 'kokoro' },
  ]);
});

it('records capability and local model readiness even before any action', async () => {
  const { panel, speech } = harness();
  const view = open(panel);
  view.send({ type: 'ready' });
  await flush();
  expect(speech.diagnostic).toHaveBeenCalledWith({ kind: 'speech', event: 'capability', phase: 'ready', provider: 'kokoro' });
  expect(speech.diagnostic).toHaveBeenCalledWith({ kind: 'speech', event: 'capability', phase: 'ready', provider: 'elevenlabs' });
  expect(speech.diagnostic).toHaveBeenCalledWith({
    kind: 'speech',
    event: 'setup',
    phase: 'blocked',
    provider: 'kokoro',
    reason: 'not_ready',
  });
});

it('records unsupported cloud capability when the page becomes ready', () => {
  const { panel, speech } = harness();
  speech.cloudSupported.mockReturnValue(false);
  const view = open(panel);
  view.send({ type: 'ready' });
  expect(speech.diagnostic).toHaveBeenCalledWith({
    kind: 'speech',
    event: 'capability',
    phase: 'blocked',
    provider: 'elevenlabs',
    reason: 'unsupported',
  });
});

it('offers output state on page readiness and forwards only explicit refresh and selection', () => {
  const { panel, speech } = harness();
  const view = open(panel);
  view.send({ type: 'ready' });
  expect(view.posted).toContainEqual({
    type: 'speechOutputCatalog',
    value: { supported: false, devices: [], selected: { kind: 'default' } },
  });
  expect(speech.outputRefresh).not.toHaveBeenCalled();
  view.send({ type: 'speechOutputRefresh' });
  view.send({ type: 'speechOutputSelect', choice: { kind: 'default' } });
  expect(speech.outputRefresh).toHaveBeenCalledOnce();
  expect(speech.outputSelect).toHaveBeenCalledWith({ kind: 'default' });
  expect(speech.preview).not.toHaveBeenCalled();
});

it('blocks preview before synthesis when the selected output is unavailable', () => {
  const { panel, speech } = harness();
  const view = open(panel);
  speech.outputReady.mockReturnValue(false);
  view.send({ type: 'speechPreview' });
  expect(speech.preview).not.toHaveBeenCalled();
  expect(speech.diagnostic).toHaveBeenCalledWith({
    kind: 'speech',
    event: 'preview',
    phase: 'blocked',
    provider: 'kokoro',
    reason: 'not_ready',
  });
  expect(view.posted).toContainEqual({
    type: 'speechSetupState',
    pending: false,
    message: 'The selected speech output is unavailable. Refresh outputs or choose System default.',
  });
});

it('accepts retirement acknowledgement only from its own page and valid unit', () => {
  const { panel, speech } = harness();
  const view = open(panel);
  view.send({ type: 'speechRetired', id: 1, pageId: 2 });
  view.send({ type: 'speechRetired', id: 0, pageId: 1 });
  view.send({ type: 'speechRetired', id: 1, pageId: 1 });
  expect(speech.outputRetired.mock.calls).toEqual([[1, 1]]);
});

it('retains replaced browser-page ownership until its actual disposal', () => {
  const { panel, speech } = harness();
  const first = open(panel);
  first.send({ type: 'ready' });
  const second = open(panel);
  second.send({ type: 'ready' });
  expect(speech.pageClosed).toHaveBeenCalledWith(1);
  expect(speech.outputPageRetired).not.toHaveBeenCalled();
  first.dispose();
  expect(speech.outputPageRetired.mock.calls).toEqual([[1]]);
  second.send({ type: 'speechPageHidden', pageId: 1 });
  expect(speech.outputPageRetired.mock.calls).toEqual([[1]]);
  second.send({ type: 'speechPageHidden', pageId: 2 });
  expect(speech.outputPageRetired.mock.calls).toEqual([[1], [2]]);
});

describe('remote panel port', () => {
  it('sends workspace updates to the attached page and handles validated actions without touching remote speech', () => {
    const { panel, controller, speech } = harness();
    const send = vi.fn<(message: ToPanel) => void>();
    panel.attachRemote(1, send);
    panel.receiveRemote(1, { type: 'ready' });
    panel.showSpeechCost({ seen: true, total: 0.2, pending: 0, partial: false });
    expect(send.mock.calls.map(([message]) => message.type)).not.toContain('speechCost');
    expect(speech.keyRefresh).not.toHaveBeenCalled();
    expect(speech.settings.get).not.toHaveBeenCalled();
    panel.post({ type: 'say', text: 'Hello.' });
    expect(send).toHaveBeenCalledWith({ type: 'say', text: 'Hello.' });
    panel.receiveRemote(1, { type: 'reply', text: 'Continue.' });
    for (const scope of ['once', 'command', 'all'] as const) {
      panel.receiveRemote(1, { type: 'runDecision', id: 5, run: true, scope });
      expect(controller.decideRun.mock.calls).toContainEqual([5, true, scope]);
    }
    expect(controller.userMessage.mock.calls.length).toBeGreaterThan(0);
    expect(speech.stop).not.toHaveBeenCalled();
    panel.closeRemote(1);
    expect(controller.releaseReadingHold.mock.calls.length).toBeGreaterThan(0);
    panel.receiveRemote(1, { type: 'pause' });
    expect(controller.pause.mock.calls).toHaveLength(0);
  });
});

it('routes remote interrupt, turn, end and page disposal without stopping remote speech', () => {
  const { panel, controller, speech } = harness('programmer');
  panel.attachRemote(1, vi.fn<(message: ToPanel) => void>());
  panel.closeRemote(2);
  panel.receiveRemote(1, { type: 'interrupt' });
  panel.receiveRemote(1, { type: 'turn' });
  panel.receiveRemote(1, { type: 'end' });
  expect(controller.userInterrupt.mock.calls).toHaveLength(1);
  expect(controller.handBack.mock.calls).toHaveLength(1);
  expect(controller.endSession.mock.calls).toHaveLength(1);
  expect(speech.stop).not.toHaveBeenCalled();
  panel.receiveRemote(1, { type: 'pageClosed' });
  expect(controller.releaseReadingHold.mock.calls).toHaveLength(1);
});

it('forwards shortcut customization from a companion page to the workspace command', () => {
  const companion = harness().panel;
  const forward = vi.fn<import('../src/panel').CompanionPanelRouting['forward']>();
  companion.useCompanion({ forward, closed: vi.fn<import('../src/panel').CompanionPanelRouting['closed']>() });
  const view = open(companion);
  view.send({ type: 'command', command: 'aiPair.configureShortcuts' });
  expect(forward).toHaveBeenCalledWith({ type: 'command', command: 'aiPair.configureShortcuts' }, 1);

  const workspace = harness().panel;
  workspace.attachRemote(1, vi.fn<(message: ToPanel) => void>());
  workspace.receiveRemote(1, { type: 'command', command: 'aiPair.configureShortcuts' });
  expect(vi.mocked(vscode.commands.executeCommand)).toHaveBeenCalledWith('aiPair.configureShortcuts');
});

it('tracks legacy sessions and restores a reloaded session as partial', () => {
  const cost = {
    start: vi.fn(),
    restore: vi.fn(),
    end: vi.fn(),
    view: vi.fn(() => ({ seen: false, total: 0, pending: 0, partial: false })),
  };
  const { panel } = harness('agent', undefined, undefined, cost);
  const view = open(panel);
  view.send({ type: 'ready' });
  expect(view.posted).toContainEqual({ type: 'speechCost', value: cost.view() });
  panel.post({ type: 'session', active: true, task: 'new' });
  panel.post({ type: 'session', active: true, suspended: true });
  panel.post({ type: 'session', active: false, reason: 'programmer' });
  expect(cost.start).toHaveBeenCalledOnce();
  expect(cost.restore).toHaveBeenCalledOnce();
  expect(cost.end).toHaveBeenCalledOnce();
});

describe('companion panel port', () => {
  it('distinguishes the same replayed session from a new session missed while the page was absent', () => {
    const cost = {
      start: vi.fn(),
      restore: vi.fn(),
      end: vi.fn(),
      view: vi.fn(() => ({ seen: true, total: 0.2, pending: 0, partial: false })),
    };
    const { panel } = harness('agent', undefined, undefined, cost);
    panel.useCompanion({
      forward: vi.fn<import('../src/panel').CompanionPanelRouting['forward']>(),
      closed: vi.fn<import('../src/panel').CompanionPanelRouting['closed']>(),
    });
    open(panel);
    panel.showRemoteUpdate({ type: 'session', active: true, costSessionGeneration: 1 });
    expect(cost.start).toHaveBeenCalledOnce();
    panel.showRemoteUpdate({ type: 'replay', events: [], costSessionGeneration: 1, costSessionActive: true });
    expect(cost.restore).not.toHaveBeenCalled();
    expect(cost.end).not.toHaveBeenCalled();
    // The workspace saw another session while this page was absent.
    panel.showRemoteUpdate({ type: 'replay', events: [], costSessionGeneration: 2, costSessionActive: true });
    expect(cost.end).toHaveBeenCalledOnce();
    expect(cost.restore).toHaveBeenCalledOnce();
    panel.showRemoteUpdate({ type: 'replay', events: [], costSessionGeneration: 2, costSessionActive: true });
    expect(cost.restore).toHaveBeenCalledOnce();
    // A late update for the old session must not close the current ledger.
    panel.showRemoteUpdate({ type: 'session', active: false, reason: 'agent', costSessionGeneration: 1 });
    expect(cost.end).toHaveBeenCalledOnce();
    panel.showRemoteUpdate({ type: 'session', active: false, reason: 'agent', costSessionGeneration: 2 });
    expect(cost.end).toHaveBeenCalledTimes(2);
  });

  it('sends the current session generation when the companion page reconnects', () => {
    const { panel } = harness();
    const send = vi.fn<(message: import('../src/panel_messages').ToPanel) => void>();
    panel.post({ type: 'session', active: true, task: 'one' });
    panel.post({ type: 'session', active: false, reason: 'agent' });
    panel.post({ type: 'session', active: true, task: 'two' });
    panel.attachRemote(1, send);
    panel.receiveRemote(1, { type: 'ready' });
    const replay = send.mock.calls.map(([message]) => message).find((message) => message.type === 'replay');
    expect(replay).toMatchObject({
      type: 'replay',
      costSessionGeneration: 2,
      costSessionActive: true,
    });
    if (replay?.type !== 'replay') throw new TypeError('No replay was sent');
    expect(replay.events).toHaveLength(3);
    panel.post({ type: 'session', active: true, task: 'three' });
    expect(send).toHaveBeenCalledWith({ type: 'session', active: true, task: 'three', costSessionGeneration: 3 });
  });

  it('tracks new, resumed and ended sessions from the local companion updates', () => {
    const cost = {
      start: vi.fn(),
      restore: vi.fn(),
      end: vi.fn(),
      view: vi.fn(() => ({ seen: true, total: 0.2, pending: 0, partial: false })),
    };
    const { panel } = harness('agent', undefined, undefined, cost);
    panel.useCompanion({
      forward: vi.fn<import('../src/panel').CompanionPanelRouting['forward']>(),
      closed: vi.fn<import('../src/panel').CompanionPanelRouting['closed']>(),
    });
    const view = open(panel);
    view.send({ type: 'ready' });
    expect(view.posted).toContainEqual({ type: 'speechCost', value: cost.view() });
    panel.showRemoteUpdate({ type: 'session', active: true, task: 'fresh' });
    panel.showRemoteUpdate({ type: 'session', active: true, resumed: true });
    panel.showRemoteUpdate({ type: 'session', active: false, reason: 'agent' });
    panel.showRemoteUpdate({ type: 'replay', events: [{ type: 'session', active: true }] });
    expect(cost.start).toHaveBeenCalledOnce();
    expect(cost.restore).toHaveBeenCalledOnce();
    expect(cost.end).toHaveBeenCalledOnce();
  });

  it('restores a replayed active session without resetting on page recreation', () => {
    const cost = {
      start: vi.fn(),
      restore: vi.fn(),
      end: vi.fn(),
      view: vi.fn(() => ({ seen: true, total: 0.2, pending: 0, partial: true })),
    };
    const { panel } = harness('agent', undefined, undefined, cost);
    panel.useCompanion({
      forward: vi.fn<import('../src/panel').CompanionPanelRouting['forward']>(),
      closed: vi.fn<import('../src/panel').CompanionPanelRouting['closed']>(),
    });
    open(panel);
    panel.showRemoteUpdate({ type: 'replay', events: [] });
    panel.showRemoteUpdate({ type: 'replay', events: [{ type: 'session', active: false, reason: 'agent' }] });
    expect(cost.restore).not.toHaveBeenCalled();
    panel.showRemoteUpdate({ type: 'replay', events: [{ type: 'session', active: true }] });
    panel.showRemoteUpdate({ type: 'replay', events: [{ type: 'session', active: true }] });
    expect(cost.restore).toHaveBeenCalledOnce();
    expect(cost.start).not.toHaveBeenCalled();
  });

  it('keeps speech local and forwards validated workspace actions with the local page identity', () => {
    const { panel, controller, controllerAccessor, speech } = harness();
    const forward = vi.fn<(action: import('@ai-pair/protocol').LocalPanelAction, pageId: number) => void>();
    const closed = vi.fn<(pageId: number) => void>();
    panel.useCompanion({ forward, closed });
    const view = open(panel);
    view.send({ type: 'ready' });
    expect(speech.keyRefresh).toHaveBeenCalledTimes(1);
    expect(forward).toHaveBeenCalledWith({ type: 'ready' }, 1);
    view.send({ type: 'reply', text: 'Continue.' });
    expect(forward).toHaveBeenCalledWith({ type: 'reply', text: 'Continue.' }, 1);
    for (const scope of ['once', 'command', 'all'] as const) {
      view.send({ type: 'runDecision', id: 4, run: true, scope });
      expect(forward).toHaveBeenCalledWith({ type: 'runDecision', id: 4, run: true, scope }, 1);
    }
    expect(controller.userMessage.mock.calls).toHaveLength(0);
    panel.showRemoteUpdate({ type: 'say', text: 'From workspace.' });
    expect(view.posted).toContainEqual({ type: 'say', text: 'From workspace.' });
    panel.showRemoteUpdate({ type: 'speechAudio', wavBase64: 'secret' });
    expect(view.posted).not.toContainEqual({ type: 'speechAudio', wavBase64: 'secret' });
    view.send({ type: 'speechComputeMode', value: 'auto' });
    view.send({ type: 'checkGpuSetup' });
    expect(speech.computeMode).toHaveBeenCalledWith('auto');
    expect(speech.checkGpuSetup).toHaveBeenCalledOnce();
    panel.showSpeechComputeState({
      requestedMode: 'auto',
      actualBackend: 'cpu',
      gpuCheck: { phase: 'unavailable', reason: 'no_hardware' },
    });
    expect(view.posted).toContainEqual({
      type: 'speechComputeState',
      value: { requestedMode: 'auto', actualBackend: 'cpu', gpuCheck: { phase: 'unavailable', reason: 'no_hardware' } },
    });
    view.send({ type: 'speechStop' });
    expect(speech.stop).toHaveBeenCalledTimes(1);
    expect(controllerAccessor).not.toHaveBeenCalled();
    view.receive({ type: 'command', command: 'arbitrary.exec' });
    view.receive({ type: 'reply', text: 'x'.repeat(65_537) });
    expect(controller.userMessage.mock.calls).toHaveLength(0);
    expect(forward).toHaveBeenCalledTimes(5);
    view.dispose();
    expect(closed).toHaveBeenCalledWith(1);
    expect(controller.releaseReadingHold.mock.calls).toHaveLength(0);
  });
  it('retires the old companion page before replacing its view', () => {
    const { panel, speech } = harness();
    const closed = vi.fn<(pageId: number) => void>();
    panel.useCompanion({ forward: vi.fn<(action: import('@ai-pair/protocol').LocalPanelAction, page: number) => void>(), closed });
    const old = open(panel);
    old.send({ type: 'ready' });
    const replacement = open(panel);
    expect(speech.pageClosed).toHaveBeenCalledWith(1);
    expect(closed).toHaveBeenCalledWith(1);
    old.dispose();
    expect(closed).toHaveBeenCalledTimes(1);
    replacement.dispose();
  });
  it('ignores updates without a companion view and does not close a replaced view twice', () => {
    const first = harness();
    first.panel.showRemoteUpdate({ type: 'say', text: 'not shown' });
    const closed = vi.fn<(pageId: number) => void>();
    first.panel.useCompanion({ forward: vi.fn<(action: import('@ai-pair/protocol').LocalPanelAction, page: number) => void>(), closed });
    first.panel.showRemoteUpdate({ type: 'say', text: 'not shown' });
    const view = open(first.panel);
    view.dispose();
    expect(closed).toHaveBeenCalledTimes(1);
    open(first.panel);
    expect(closed).toHaveBeenCalledTimes(1);
  });
});

it('routes GPU setup requests and compute choices to the local service', () => {
  const { panel, speech } = harness();
  const view = open(panel);
  view.send({ type: 'ready' });
  view.send({ type: 'speechComputeMode', value: 'gpu' });
  view.receive({ type: 'speechComputeMode', value: 'invalid' });
  view.send({ type: 'checkGpuSetup' });
  expect(speech.computeMode).toHaveBeenCalledOnce();
  expect(speech.computeMode).toHaveBeenCalledWith('gpu');
  expect(speech.checkGpuSetup).toHaveBeenCalledOnce();
});

it('keeps a lost speech transport unavailable when the page becomes ready again', () => {
  const { panel } = harness();
  const view = open(panel);
  view.send({ type: 'ready' });
  panel.showSpeechTransport(false);
  view.send({ type: 'ready' });
  expect(postedOf(view, 'speechTransport').at(-1)).toEqual({ type: 'speechTransport', available: false });
});

it('publishes validated initial readiness after settings and compute facts', () => {
  const facts = {
    enabled: true,
    provider: 'kokoro',
    keyConfigured: 'unknown',
    voiceConfigured: true,
    output: 'default',
    routeAvailable: true,
    runtimeReady: true,
    modelReady: true,
    lastPlayback: 'unknown',
  } as const;
  const { panel } = harness('agent', undefined, () => facts);
  const view = open(panel);
  view.send({ type: 'ready' });
  const index = view.posted.findIndex((message) => message.type === 'speechReadiness');
  expect(view.posted[index]).toEqual({ type: 'speechReadiness', value: facts });
  expect(view.posted.findIndex((message) => message.type === 'speechSettings')).toBeLessThan(index);
  expect(view.posted.findIndex((message) => message.type === 'speechComputeState')).toBeLessThan(index);
});

it('routes OpenRouter key and catalog actions and validates the selected pair', async () => {
  const { panel, speech } = harness();
  const view = open(panel);
  view.send({ type: 'ready' });
  view.send({ type: 'openRouterKeySet' });
  view.send({ type: 'openRouterKeyRemove' });
  await flush();
  expect(speech.openRouterKeySet).toHaveBeenCalledOnce();
  expect(speech.openRouterKeyRemove).toHaveBeenCalledOnce();
  const choice = {
    enabled: false,
    provider: 'openrouter' as const,
    voice: 'af_heart',
    speed: 1,
    elevenLabsVoice: '',
    elevenLabsSpeed: 1,
    openRouterModel: 'model',
    openRouterVoice: 'voice',
    openRouterZdr: true,
  };
  view.send({ type: 'speechSettings', value: choice });
  expect(speech.settings.set).not.toHaveBeenCalled();
  speech.validOpenRouterVoice.mockReturnValue(true);
  view.send({ type: 'speechSettings', value: choice });
  expect(speech.settings.set).toHaveBeenCalledWith(choice);
  view.send({ type: 'speechSettings', value: { ...choice, openRouterFormat: 'pcm' } });
  view.send({ type: 'speechSettings', value: { ...choice, openRouterFormat: 'mp3' } });
  expect(speech.settings.set).toHaveBeenCalledWith({ ...choice, openRouterFormat: 'pcm' });
  expect(speech.settings.set).toHaveBeenCalledWith({ ...choice, openRouterFormat: 'mp3' });
  speech.settings.set.mockClear();
  view.receive({ type: 'speechSettings', value: { ...choice, openRouterFormat: 'unsupported' } });
  expect(speech.settings.set).not.toHaveBeenCalled();
  panel.showOpenRouterKeyStatus(true);
  panel.showOpenRouterCatalog({ state: 'ready', verified: true, models: [] });
  expect(view.posted).toContainEqual({ type: 'openRouterKeyStatus', hasKey: true });
  expect(view.posted).toContainEqual({ type: 'openRouterCatalog', value: { state: 'ready', verified: true, models: [] } });
});

it('scopes OpenRouter catalog and reports key failure without leaking errors', async () => {
  const { panel, speech } = harness();
  const view = open(panel);
  view.send({ type: 'ready' });
  view.send({ type: 'openRouterModelsLoad' });
  expect(speech.loadOpenRouterModels).not.toHaveBeenCalled();
  const settings = { ...speech.settings.get(), provider: 'openrouter' as const };
  speech.settings.get.mockReturnValue(settings);
  view.send({ type: 'openRouterModelsLoad' });
  expect(speech.loadOpenRouterModels).toHaveBeenCalledOnce();
  speech.cloudSupported.mockReturnValue(false);
  view.send({ type: 'openRouterModelsLoad' });
  view.send({ type: 'openRouterKeySet' });
  expect(speech.loadOpenRouterModels).toHaveBeenCalledOnce();
  expect(speech.openRouterKeySet).not.toHaveBeenCalled();
  speech.cloudSupported.mockReturnValue(true);
  speech.openRouterKeySet.mockRejectedValueOnce(new Error('private'));
  view.send({ type: 'openRouterKeySet' });
  await flush();
  expect(view.posted).toContainEqual({ type: 'speechSetupState', pending: false, message: 'Could not update the API key.' });
  expect(JSON.stringify(view.posted)).not.toContain('private');
  for (const bad of [{ contextEnabled: 'yes' }, { openRouterZdr: 'yes' }, { openRouterModel: 1 }, { openRouterVoice: 1 }]) {
    view.receive({ type: 'speechSettings', value: { ...settings, ...bad } });
  }
  expect(speech.settings.set).not.toHaveBeenCalled();
  const saved = { ...settings, openRouterModel: 'model', openRouterVoice: 'voice' };
  speech.settings.get.mockReturnValue(saved);
  view.send({ type: 'speechSettings', value: saved });
  expect(speech.settings.set).toHaveBeenCalledWith(saved);
});

it('tracks narration session identity independently of cost ownership', () => {
  const narrationSession = vi.fn<(id: number, ongoing: boolean) => void>();
  const { panel } = harness('agent', undefined, undefined, undefined, narrationSession);
  panel.post({ type: 'session', active: true, task: 'one' });
  panel.post({ type: 'session', active: true, suspended: true });
  panel.post({ type: 'session', active: true, resumed: true });
  panel.post({ type: 'session', active: false, reason: 'programmer' });
  panel.post({ type: 'session', active: true, task: 'two' });
  expect(narrationSession.mock.calls).toEqual([
    [1, true],
    [1, true],
    [1, true],
    [1, false],
    [2, true],
  ]);
});

it('reconciles companion narration identity on replay and rejects stale sessions', () => {
  const narrationSession = vi.fn<(id: number, ongoing: boolean) => void>();
  const { panel } = harness('agent', undefined, undefined, undefined, narrationSession);
  panel.useCompanion({
    forward: vi.fn<import('../src/panel').CompanionPanelRouting['forward']>(),
    closed: vi.fn<(page: number) => void>(),
  });
  open(panel);
  panel.showRemoteUpdate({ type: 'session', active: true, costSessionGeneration: 1 });
  panel.showRemoteUpdate({ type: 'replay', events: [], costSessionGeneration: 1, costSessionActive: true });
  panel.showRemoteUpdate({ type: 'replay', events: [], costSessionGeneration: 2, costSessionActive: true });
  panel.showRemoteUpdate({ type: 'session', active: false, reason: 'agent', costSessionGeneration: 1 });
  panel.showRemoteUpdate({ type: 'session', active: false, reason: 'agent', costSessionGeneration: 2 });
  expect(narrationSession.mock.calls).toEqual([
    [1, true],
    [1, true],
    [2, true],
    [2, false],
  ]);
});

it('OfferedOnlyWhereCapable: tells the page GPU is possible only on a supported host with a GPU path (#42)', async () => {
  const { panel, speech } = harness();
  speech.gpuSupported.mockReturnValue(true);
  const view = open(panel);
  view.send({ type: 'ready' });
  await flush();
  expect(view.posted).toContainEqual({ type: 'speechSupport', supported: true, gpu: true });
  speech.supported.mockReturnValue(false);
  panel.refreshSpeechSupport();
  expect(view.posted).toContainEqual({ type: 'speechSupport', supported: false, gpu: false });
});
