import * as os from 'node:os';
import * as vscode from 'vscode';
import { Bridge, Controller, isSavedSession, type PanelEvent, type SavedSession } from '@ai-pair/core';
import { discoveryDir } from '@ai-pair/protocol';
import { playDemo } from './demo';
import { VsCodeEditor } from './editor';
import type { OutsideChanges } from './outside';
import { watchOutside } from './outside_watch';
import { NarrationPanel } from './panel';
import { settingSpeed } from './panel_html';
import { claudeStarter, registerServerProvider, setUpAgent, writeLauncher } from './setup';
import { Calibration } from './calibration';
import { builtInPassage, type Passage } from './passage';

/** Where a session waits across a reload, in the workspace's storage (#25). */
const SAVED_SESSION = 'aiPair.session';
/** Where the session's panel history waits across a reload, next to the session. */
const SAVED_HISTORY = 'aiPair.history';
/** How long after a change the session is saved: changes come a keystroke at a time. */
const SAVE_MS = 200;
/** Whether Set Up Agent was offered once, in the global state. */
const OFFERED_SETUP = 'aiPair.offeredSetup';
/** The settings under `aiPair`, as `config().get` and `update` name them. */
const SPEED = 'speed';
const READING_SPEED = 'readingSpeed';
const TIMING = 'timing';
const AGENT_NAME = 'agentName';
const CONFIRM_COMMANDS = 'confirmCommands';
const CALIBRATION_PASSAGE = 'calibrationPassage';

/** Returned from `activate`, for integration tests. */
export interface Api {
  controller: Controller;
  editor: VsCodeEditor;
  bridge: Bridge;
  outside: OutsideChanges;
  playDemo: () => Promise<void>;
  launcher: string;
  ready: Promise<void>;
  /** The session as the workspace's storage holds it. */
  saved: () => SavedSession | undefined;
}

function config(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration('aiPair');
}

/** Returns whether `v` is an object, as a setting or stored value is read: JSON nobody has checked. */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Returns `v` if it is a string, else `undefined`. */
function stringOf(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

/** Returns whether `v` is a list of panel events, by their `type`; the storage is the window's own, so the check is shallow. */
function isPanelEvents(v: unknown): v is PanelEvent[] {
  return Array.isArray(v) && v.every((e: unknown) => isRecord(e) && typeof e.type === 'string');
}

/** Wraps `f` so that it runs the first time only. */
function once<T>(f: (arg: T) => void): (arg: T) => void {
  let done = false;
  return (arg) => {
    if (done) return;
    done = true;
    f(arg);
  };
}

/** Starts the extension: the controller, the editor, the panel, the bridge, and the commands; returns the API the integration test drives. */
export function activate(context: vscode.ExtensionContext): Api {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir();

  const editor = new VsCodeEditor(root, config().get(AGENT_NAME, 'Agent'));
  const speed = {
    get: () => settingSpeed(config().get<unknown>(SPEED, 1)),
    set: (value: number) => {
      void config().update(SPEED, value, vscode.ConfigurationTarget.Global);
    },
  };
  const readingSpeed = {
    get: () => settingSpeed(config().get<unknown>(READING_SPEED, 1)),
    set: (value: number) => {
      void config().update(READING_SPEED, value, vscode.ConfigurationTarget.Global);
    },
  };
  // Frames and panel messages at the Trace level, which VS Code hides unless it is set, and resets
  // when the extension is reinstalled; with `aiPair.trace`, at Info, which it shows (#27).
  const log = vscode.window.createOutputChannel('AI Pair', { log: true });
  function trace(line: string): void {
    if (config().get('trace', false)) {
      log.info(line);
    } else {
      log.trace(line);
    }
  }
  const panel = new NarrationPanel(
    (file) => editor.resolvePath(file),
    speed,
    readingSpeed,
    {
      current: () => editor.programmerSelection(),
      ref: () => editor.selectionRef(),
    },
    trace,
    context.extensionUri,
  );
  const controller = new Controller(editor, panel);
  controller.trace = (line) => {
    log.info(line);
  };
  editor.controller = controller;
  editor.onSelection = (ref) => {
    panel.showSelection(ref);
  };
  panel.controller = controller;
  controller.setSpeed(speed.get());
  controller.setReadingSpeed(readingSpeed.get());
  controller.setTiming(config().get(TIMING));
  controller.setConfirmCommands(config().get(CONFIRM_COMMANDS, true));
  // The passage the programmer or the agent chose, from the settings, or the built-in one (#109).
  function passage(): Passage {
    const chosen: unknown = config().get(CALIBRATION_PASSAGE);
    const text = isRecord(chosen) ? stringOf(chosen.text) : undefined;
    if (text === undefined || text.trim() === '') return builtInPassage(context.extensionPath);
    const notice = isRecord(chosen) ? stringOf(chosen.notice) : undefined;
    return {
      title: (isRecord(chosen) ? stringOf(chosen.title) : undefined) ?? 'Your passage',
      text,
      ...(notice === undefined ? {} : { notice }),
    };
  }
  const calibration = new Calibration(
    {
      now: () => Date.now(),
      pause: () => {
        controller.pause('calibrate');
      },
      resume: () => {
        controller.resume('calibrate');
      },
      // The pause ends only once the player reads the new rate: AwaitStore in specs/Calibration.tla, and
      // setTiming below is `ApplyRate`.
      store: async (msPerChar) => {
        const timing: unknown = config().get(TIMING);
        const kept = isRecord(timing) ? timing : {};
        const reading = isRecord(kept.reading) ? kept.reading : {};
        await config().update(TIMING, { ...kept, reading: { ...reading, msPerChar } }, vscode.ConfigurationTarget.Global);
        controller.setTiming(config().get(TIMING));
      },
      show: (view) => {
        panel.showCalibration(view);
      },
    },
    passage(),
  );
  panel.calibration = calibration;
  controller.onCalibrate = (chosen) => {
    if (!calibration.arm(chosen)) return false;
    void config().update(CALIBRATION_PASSAGE, chosen, vscode.ConfigurationTarget.Global);
    return true;
  };
  const { outside, disposable: outsideWatch } = watchOutside(controller, editor, panel);
  // A session survives a reload in the workspace's storage, suspended until its agent's `start` (#25,
  // specs/Resume.tla, `Reload`): saved shortly after each change, and once more as the window goes (`Save`).
  const stored: unknown = context.workspaceState.get(SAVED_SESSION);
  const saved = isSavedSession(stored) ? stored : undefined;
  if (saved) {
    const history: unknown = context.workspaceState.get(SAVED_HISTORY);
    panel.restoreHistory(isPanelEvents(history) ? history : []);
    controller.revive(saved);
  }
  let saving: ReturnType<typeof setTimeout> | undefined;
  function save(): void {
    clearTimeout(saving);
    const session = controller.saved;
    void context.workspaceState.update(SAVED_SESSION, session);
    void context.workspaceState.update(SAVED_HISTORY, session ? panel.history : undefined);
  }
  controller.onChange = panel.onPost = () => {
    clearTimeout(saving);
    saving = setTimeout(save, SAVE_MS);
  };

  const bridge = new Bridge(controller, {
    dir: discoveryDir(),
    workspaceFolders: () => (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath),
    trace,
    // Once: it would fail again on every focus.
    failed: once((e) => {
      void vscode.window.showErrorMessage(`AI Pair couldn't write its discovery file, so agents won't find this window: ${String(e)}`);
    }),
  });
  const ready = bridge.start();
  ready.catch((error: unknown) => {
    void vscode.window.showErrorMessage(`AI Pair couldn't start its local server: ${String(error)}`);
  });
  const launcher = writeLauncher(context.extensionPath);
  const starter = claudeStarter(launcher);
  panel.starter = starter;
  // Set Up Agent may have set Claude Code up: the idle view's button is offered again (specs/Start.tla, `FlipSetUp`).
  function setUp(): Promise<void> {
    return setUpAgent(launcher).then(() => {
      panel.askStart();
    });
  }
  registerServerProvider(context);

  context.subscriptions.push(
    log,
    starter,
    outsideWatch,
    {
      dispose: () => {
        bridge.dispose();
      },
    },
    vscode.window.onDidChangeWindowState((state) => {
      if (state.focused) bridge.focused();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      bridge.writeDiscovery();
    }),
    vscode.commands.registerCommand('aiPair.setUpAgent', setUp),
    editor,
    vscode.window.registerWebviewViewProvider(NarrationPanel.viewId, panel, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('aiPair.speed')) {
        controller.setSpeed(speed.get());
        panel.showSpeed(speed.get());
      }
      if (e.affectsConfiguration('aiPair.readingSpeed')) {
        controller.setReadingSpeed(readingSpeed.get());
        panel.showReadingSpeed(readingSpeed.get());
      }
      if (e.affectsConfiguration('aiPair.timing')) controller.setTiming(config().get(TIMING));
      if (e.affectsConfiguration('aiPair.agentName')) editor.setAgentName(config().get(AGENT_NAME, 'Agent'));
      if (e.affectsConfiguration('aiPair.confirmCommands')) {
        controller.setConfirmCommands(config().get(CONFIRM_COMMANDS, true));
      }
    }),
    vscode.commands.registerCommand('aiPair.playDemo', () => {
      if ((vscode.workspace.workspaceFolders?.length ?? 0) === 0) {
        void vscode.window.showErrorMessage('Open a folder first: the demo creates files in ai-pair-demo/.');
        return;
      }
      void playDemo(controller, root);
    }),
    vscode.commands.registerCommand('aiPair.togglePause', () => {
      if (controller.isPaused) {
        controller.resume();
      } else {
        controller.pause();
      }
    }),
    vscode.commands.registerCommand('aiPair.interrupt', () => {
      controller.userInterrupt();
    }),
    vscode.commands.registerCommand('aiPair.toggleTurn', () => {
      if (controller.turn === 'user') {
        controller.handBack();
      } else {
        controller.takeTurn();
      }
    }),
    vscode.commands.registerCommand('aiPair.endSession', () => {
      controller.endSession();
    }),
    vscode.commands.registerCommand('aiPair.focusReply', () => {
      panel.focusReply();
    }),
    vscode.commands.registerCommand('aiPair.askAboutSelection', () => {
      panel.focusReply();
    }),
    vscode.commands.registerCommand('aiPair.calibrate', () => {
      if (calibration.arm(passage())) {
        panel.focusReply();
      } else {
        void vscode.window.showInformationMessage('AI Pair: a calibration is already under way in the Pair panel.');
      }
    }),
    {
      dispose: () => {
        controller.disconnect();
      },
    },
    { dispose: save },
  );
  if (context.globalState.get<unknown>(OFFERED_SETUP) !== true) {
    void context.globalState.update(OFFERED_SETUP, true);
    void vscode.window.showInformationMessage('AI Pair is installed. Connect it to your agent?', 'Set Up Agent').then((answer) => {
      if (answer) void setUp();
    });
  }

  return {
    controller,
    editor,
    bridge,
    outside,
    playDemo: () => playDemo(controller, root),
    launcher,
    ready,
    saved: () => {
      const kept: unknown = context.workspaceState.get(SAVED_SESSION);
      return isSavedSession(kept) ? kept : undefined;
    },
  };
}

/** Does nothing: every resource is disposed through the context. */
export function deactivate(): void {}
