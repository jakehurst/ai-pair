// The narration panel: a webview view in the secondary side bar. See "Narration panel" in DESIGN.md.

import * as vscode from 'vscode';
import type { Controller, PanelEvent, PanelPort, Ref, SharedSelection } from '@ai-pair/core';
import { panelHtml, SPEEDS } from './panel_html';
import { timings } from './timings';
import type { FromPanel, ToPanel } from './panel_messages';
import type { Calibration, CalibrationView } from './calibration';

const MAX_LOG = 400;

/** The commands the panel may run: the ones its intro links to. */
const PANEL_COMMANDS: ReadonlySet<string> = new Set(['aiPair.playDemo', 'aiPair.setUpAgent']);

/** An agent the idle view can start a session with: whether it can right now, and how (#107). */
export interface Starter {
  available(): Promise<boolean>;
  /** Resolves once the agent it ran has exited, or at once if it ran none (#118). */
  start(): Promise<void>;
}

/**
 * What the panel drives: the controller and the calibration, made after the panel and read once a
 * page or the programmer acts, and the starter.
 */
export interface PanelWiring {
  controller: () => Controller;
  /** The reading speed calibration; the programmer's replies go to it while one is under way (#109). */
  calibration: () => Calibration;
  /** Starts a session from the idle view, when an agent that can be started from here is set up (#107). */
  starter: Starter;
}

/** How many files of a name to look for before asking which was meant. */
const MAX_FOUND = 20;

/** The AI Pair view: shows the agent's narration and status, and takes the programmer's replies and controls. */
export class NarrationPanel implements PanelPort, vscode.WebviewViewProvider {
  static readonly viewId = 'aiPair.narration';
  /** Questions asked of the starter so far; an answer to an earlier one is dropped. */
  private asked = 0;
  private view?: vscode.WebviewView;
  /** Everything posted so far, replayed when the view is (re)created. */
  private readonly log: PanelEvent[] = [];
  /** After each post: the window saves the history with a session, for a reload (#25). */
  onPost?: () => void;

  /** Returns everything posted so far, as the window saves it. */
  get history(): readonly PanelEvent[] {
    return this.log;
  }

  /**
   * Asks the starter whether a session can be started from here, and tells the page: for each new
   * page, and again after Set Up Agent (specs/Start.tla, `LoadPage`, and `FlipSetUp` with ReaskOnSetUp).
   * Only the latest question's answer reaches the page, so a page replaced before its answer landed
   * cannot set the button on its successor, and an earlier question's answer cannot override a
   * reask's (`Answer` with DropStale; OwnAnswer, LatestAnswer).
   */
  askStart(): void {
    const asked = ++this.asked;
    void this.wiring.starter.available().then((value) => {
      if (asked === this.asked) this.send({ type: 'canStart', value });
    });
  }

  constructor(
    private readonly resolvePath: (file: string) => string,
    private readonly speed: { get: () => number; set: (value: number) => void },
    private readonly readingSpeed: { get: () => number; set: (value: number) => void },
    private readonly selection: { current: () => SharedSelection | undefined; ref: () => Ref | undefined },
    /** Called with a line for each message from the page, for diagnosing deliveries (#27). */
    private readonly trace: (line: string) => void,
    /** The extension's folder, which holds the page's dist/panel.css and dist/panel.js. */
    private readonly extensionUri: vscode.Uri,
    private readonly wiring: PanelWiring,
  ) {}

  /** Posts to the page, if there is one. */
  private send(message: ToPanel): void {
    void this.view?.webview.postMessage(message);
  }

  /** Shows the programmer's selection, which changed. Not logged: only the current one matters. */
  showSelection(ref: Ref | undefined): void {
    this.send({ type: 'selection', ref });
  }

  /** Shows the speed setting, which changed. Not logged: only the current value matters. */
  showSpeed(value: number): void {
    this.send({ type: 'speed', value });
  }

  showReadingSpeed(value: number): void {
    this.send({ type: 'readingSpeed', value });
  }

  showCalibration(view: CalibrationView): void {
    this.send({ type: 'calibration', view });
  }

  /** Tells the page its delays: with each new page, and when a test changes them. */
  showTimings(): void {
    this.send({ type: 'timings', tipDelayMs: timings.tipDelayMs, tipWarmMs: timings.tipWarmMs });
  }

  // specs/PanelReplay.tla, `Post`: the event onto the log, the oldest cut beyond MAX_LOG.
  post(event: PanelEvent): void {
    this.log.push(event);
    if (this.log.length > MAX_LOG) {
      const cut = this.log.splice(0, this.log.length - MAX_LOG);
      // A view replays its session state from the last `session` event: keep it, or a view created
      // after a long session shows none while one runs (#54).
      const session = cut.findLast((e) => e.type === 'session');
      if (session && !this.log.some((e) => e.type === 'session')) this.log.unshift(session);
    }
    this.send(event);
    if (event.type === 'session') {
      void vscode.commands.executeCommand('setContext', 'aiPair.active', event.active);
      if (event.active) this.reveal();
      if (!event.active) this.wiring.calibration().cancel();
    }
    this.onPost?.();
  }

  /** Restores, after a reload, the history the window saved with its session, for the view to replay (#25). */
  restoreHistory(events: readonly PanelEvent[]): void {
    this.log.splice(0, this.log.length, ...events);
    void vscode.commands.executeCommand('setContext', 'aiPair.active', true);
  }

  focusReply(): void {
    this.reveal(/* preserveFocus= */ false);
    this.send({ type: 'focusReply' });
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    const dist = vscode.Uri.joinPath(this.extensionUri, 'dist');
    view.webview.options = { enableScripts: true, localResourceRoots: [dist] };
    const style = view.webview.asWebviewUri(vscode.Uri.joinPath(dist, 'panel.css')).toString();
    const script = view.webview.asWebviewUri(vscode.Uri.joinPath(dist, 'panel.js')).toString();
    view.webview.html = panelHtml(view.webview.cspSource, style, script);
    // The page posts only FromPanel messages; VS Code types them `any`.
    view.webview.onDidReceiveMessage((m: FromPanel) => {
      this.receive(m);
    });
    view.onDidDispose(() => {
      // specs/Start.tla, `Dispose`: the page goes, its button and note with it.
      if (this.view === view) this.view = undefined;
      // Its draft went with it, and so does the pause the draft asked for (#69): specs/Draft.tla, `Dispose`.
      this.wiring.controller().resume('reply');
      this.wiring.calibration().cancel();
    });
  }

  private reveal(preserveFocus = true): void {
    if (this.view) {
      this.view.show(preserveFocus);
    } else {
      void vscode.commands.executeCommand(`${NarrationPanel.viewId}.focus`);
    }
  }

  private receive(message: FromPanel): void {
    const controller = this.wiring.controller();
    this.trace(
      `panel ${message.type}${message.type === 'reply' ? ` ${JSON.stringify(message.text)}` : message.type === 'draft' ? (message.empty ? ' empty' : ' typed') : ''}`,
    );
    switch (message.type) {
      case 'ready':
        // A new page has an empty draft (#69): specs/Draft.tla, `Ready`.
        controller.resume('reply');
        this.send({ type: 'replay', events: this.log });
        this.showSpeed(this.speed.get());
        this.showReadingSpeed(this.readingSpeed.get());
        this.showSelection(this.selection.ref());
        this.showTimings();
        // The new page asks once whether a session can start: specs/Start.tla, `LoadPage`.
        this.askStart();
        return;
      case 'speed':
        // Only the menu's speeds: the page sends no others (#17).
        if (SPEEDS.includes(message.value)) this.speed.set(message.value);
        return;
      case 'readingSpeed':
        if (SPEEDS.includes(message.value)) this.readingSpeed.set(message.value);
        return;
      case 'reply':
        // Replying means "go on with this", so any pause ends. It moves no view, so the programmer's tab and
        // selection stay as they were (specs/PointFocus.tla, `Reply`, issue 125; specs/Draft.tla,
        // `ResumeAll`).
        if (this.wiring.calibration().reply(message.text)) {
          // The box is empty now, and the page posts no `draft` for it: specs/Draft.tla, `SendToCalibration` (#191).
          controller.resume('reply');
          return;
        }
        controller.resume(undefined, { reveal: false });
        controller.userMessage(message.text, message.attach === true ? this.selection.current() : undefined);
        return;
      case 'draft':
        // Typing a reply pauses playback, the way a pair stops when you start talking (specs/Draft.tla, `Type`, `Clear`).
        if (message.empty) {
          controller.resume('reply');
        } else {
          controller.pause('reply');
        }
        return;
      case 'pause':
        controller.pause();
        return;
      case 'resume':
        // specs/Draft.tla, `ResumeAll`: resume() with no reason ends every pause.
        controller.resume();
        return;
      case 'interrupt':
        controller.userInterrupt();
        return;
      case 'turn':
        controller.resume();
        if (controller.turn === 'user') {
          controller.handBack(message.message, message.attach === true ? this.selection.current() : undefined);
        } else {
          controller.takeTurn();
        }
        return;
      case 'end':
        controller.endSession();
        return;
      case 'runDecision':
        controller.decideRun(message.id, message.run, message.remember);
        return;
      case 'open': {
        const uri = vscode.Uri.file(this.resolvePath(message.file));
        const position = new vscode.Position(Math.max(0, message.line - 1), 0);
        void vscode.window.showTextDocument(uri, { selection: new vscode.Range(position, position) });
        return;
      }
      case 'openFile':
        void this.openByName(message.file);
        return;
      case 'command':
        if (PANEL_COMMANDS.has(message.command)) void vscode.commands.executeCommand(message.command);
        return;
      case 'start':
        // specs/Start.tla, `Click`: one run per click. `Exit`: the agent is done, and the page drops its
        // note (Settles).
        void this.wiring.starter.start().then(() => {
          this.send({ type: 'startEnded' });
        });
        return;
      case 'openChange':
        void this.openChange(message.file);
        return;
      case 'openUrl':
        if (/^https?:\/\//.test(message.url)) void vscode.env.openExternal(vscode.Uri.parse(message.url));
        return;
      // no default
    }
  }

  /** Opens a file changed outside the protocol: its diff against git's index, or the file itself outside git (#15). */
  private async openChange(file: string): Promise<void> {
    const uri = vscode.Uri.file(this.resolvePath(file));
    try {
      await vscode.commands.executeCommand('git.openChange', uri);
    } catch {
      await vscode.commands.executeCommand('vscode.open', uri);
    }
  }

  /** Opens a file the agent named: as a path in the workspace, else the file of that name, asking if there are several. */
  private async openByName(name: string): Promise<void> {
    const direct = vscode.Uri.file(this.resolvePath(name));
    try {
      await vscode.workspace.fs.stat(direct);
      await vscode.window.showTextDocument(direct);
      return;
    } catch {
      // Not a path from the workspace's root: look for it by name.
    }
    const found = await vscode.workspace.findFiles(`**/${name}`, '**/node_modules/**', MAX_FOUND);
    let uri = found[0];
    if (uri === undefined) {
      void vscode.window.showInformationMessage(`AI Pair: couldn't find ${name} in the workspace.`);
      return;
    }
    if (found.length > 1) {
      const picked = await vscode.window.showQuickPick(
        found.map((u) => ({ label: vscode.workspace.asRelativePath(u), uri: u })),
        { placeHolder: `Which ${name}?` },
      );
      if (!picked) return;
      uri = picked.uri;
    }
    await vscode.window.showTextDocument(uri);
  }
}
