import * as os from "node:os"
import * as vscode from "vscode"
import { Bridge, Controller, type PanelEvent, type SavedSession } from "@ai-pair/core"
import { discoveryDir } from "@ai-pair/protocol"
import { playDemo } from "./demo"
import { VsCodeEditor } from "./editor"
import type { OutsideChanges } from "./outside"
import { watchOutside } from "./outsideWatch"
import { NarrationPanel } from "./panel"
import { settingSpeed } from "./panelHtml"
import { registerServerProvider, setUpAgent, writeLauncher } from "./setup"

/** Returned from `activate`, for integration tests. */
export type Api = {
  controller: Controller
  editor: VsCodeEditor
  bridge: Bridge
  outside: OutsideChanges
  playDemo: () => Promise<void>
  launcher: string
  ready: Promise<void>
  /** The session as the workspace's storage holds it. */
  saved: () => SavedSession | undefined
}

const config = () => vscode.workspace.getConfiguration("aiPair")

/** Where a session and its panel history wait across a reload, in the workspace's storage (#25). */
const SAVED_SESSION = "aiPair.session"
const SAVED_HISTORY = "aiPair.history"
/** How long after a change the session is saved: changes come a keystroke at a time. */
const SAVE_MS = 200

export function activate(context: vscode.ExtensionContext): Api {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir()

  const editor = new VsCodeEditor(root, config().get("agentName", "Agent"))
  const speed = {
    get: () => settingSpeed(config().get<unknown>("speed", 1)),
    set: (value: number) => void config().update("speed", value, vscode.ConfigurationTarget.Global),
  }
  const readingSpeed = {
    get: () => settingSpeed(config().get<unknown>("readingSpeed", 1)),
    set: (value: number) => void config().update("readingSpeed", value, vscode.ConfigurationTarget.Global),
  }
  // Frames and panel messages at the Trace level, which VS Code hides unless it is set, and resets
  // when the extension is reinstalled; with `aiPair.trace`, at Info, which it shows (#27).
  const log = vscode.window.createOutputChannel("AI Pair", { log: true })
  const trace = (line: string) => (config().get("trace", false) ? log.info(line) : log.trace(line))
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
  )
  const controller = new Controller(editor, panel)
  editor.controller = controller
  editor.onSelection = (ref) => panel.showSelection(ref)
  panel.controller = controller
  controller.setSpeed(speed.get())
  controller.setReadingSpeed(readingSpeed.get())
  controller.setTiming(config().get("timing", {}))
  controller.setConfirmCommands(config().get("confirmCommands", true))
  const { outside, disposable: outsideWatch } = watchOutside(controller, editor, panel)
  // A session survives a reload in the workspace's storage, suspended until its agent's `start` (#25,
  // specs/Resume.tla): saved shortly after each change, and once more as the window goes.
  const saved = context.workspaceState.get<SavedSession>(SAVED_SESSION)
  if (saved) {
    panel.restoreHistory(context.workspaceState.get<PanelEvent[]>(SAVED_HISTORY) ?? [])
    controller.revive(saved)
  }
  let saving: ReturnType<typeof setTimeout> | undefined
  const save = () => {
    clearTimeout(saving)
    const session = controller.saved
    void context.workspaceState.update(SAVED_SESSION, session)
    void context.workspaceState.update(SAVED_HISTORY, session ? panel.history : undefined)
  }
  controller.onChange = panel.onPost = () => {
    clearTimeout(saving)
    saving = setTimeout(save, SAVE_MS)
  }

  const bridge = new Bridge(controller, {
    dir: discoveryDir(),
    workspaceFolders: () => (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath),
    trace,
    // Once: it would fail again on every focus.
    failed: once(
      (e) =>
        void vscode.window.showErrorMessage(`AI Pair couldn't write its discovery file, so agents won't find this window: ${String(e)}`),
    ),
  })
  const ready = bridge.start()
  ready.catch((e: unknown) => void vscode.window.showErrorMessage(`AI Pair couldn't start its local server: ${String(e)}`))
  const launcher = writeLauncher(context.extensionPath)
  registerServerProvider(context)

  context.subscriptions.push(
    log,
    outsideWatch,
    { dispose: () => bridge.dispose() },
    vscode.window.onDidChangeWindowState((state) => {
      if (state.focused) bridge.focused()
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => bridge.writeDiscovery()),
    vscode.commands.registerCommand("aiPair.setUpAgent", () => setUpAgent(launcher)),
    editor,
    vscode.window.registerWebviewViewProvider(NarrationPanel.viewId, panel, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("aiPair.speed")) {
        controller.setSpeed(speed.get())
        panel.showSpeed(speed.get())
      }
      if (e.affectsConfiguration("aiPair.readingSpeed")) {
        controller.setReadingSpeed(readingSpeed.get())
        panel.showReadingSpeed(readingSpeed.get())
      }
      if (e.affectsConfiguration("aiPair.timing")) controller.setTiming(config().get("timing", {}))
      if (e.affectsConfiguration("aiPair.agentName")) editor.setAgentName(config().get("agentName", "Agent"))
      if (e.affectsConfiguration("aiPair.confirmCommands")) {
        controller.setConfirmCommands(config().get("confirmCommands", true))
      }
    }),
    vscode.commands.registerCommand("aiPair.playDemo", () => {
      if (!vscode.workspace.workspaceFolders?.length) {
        void vscode.window.showErrorMessage("Open a folder first: the demo creates files in ai-pair-demo/.")
        return
      }
      void playDemo(controller, root)
    }),
    vscode.commands.registerCommand("aiPair.togglePause", () => {
      if (controller.isPaused) controller.resume()
      else controller.pause()
    }),
    vscode.commands.registerCommand("aiPair.interrupt", () => controller.userInterrupt()),
    vscode.commands.registerCommand("aiPair.toggleTurn", () => {
      if (controller.turn === "user") controller.handBack()
      else controller.takeTurn()
    }),
    vscode.commands.registerCommand("aiPair.endSession", () => controller.endSession()),
    vscode.commands.registerCommand("aiPair.focusReply", () => panel.focusReply()),
    vscode.commands.registerCommand("aiPair.askAboutSelection", () => panel.focusReply()),
    { dispose: () => controller.disconnect() },
    { dispose: save },
  )
  if (!context.globalState.get("aiPair.offeredSetup")) {
    void context.globalState.update("aiPair.offeredSetup", true)
    void vscode.window
      .showInformationMessage("AI Pair is installed. Connect it to your agent?", "Set Up Agent")
      .then((answer) => answer && setUpAgent(launcher))
  }

  return {
    controller,
    editor,
    bridge,
    outside,
    playDemo: () => playDemo(controller, root),
    launcher,
    ready,
    saved: () => context.workspaceState.get<SavedSession>(SAVED_SESSION),
  }
}

export function deactivate(): void {}

/** `f`, run the first time only. */
function once<T>(f: (arg: T) => void): (arg: T) => void {
  let done = false
  return (arg) => {
    if (done) return
    done = true
    f(arg)
  }
}
