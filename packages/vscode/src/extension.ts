import * as os from "node:os"
import * as vscode from "vscode"
import { Bridge, Controller } from "@ai-pair/core"
import { discoveryDir } from "@ai-pair/protocol"
import { playDemo } from "./demo"
import { VsCodeEditor } from "./editor"
import { NarrationPanel } from "./panel"
import { registerServerProvider, setUpAgent, writeLauncher } from "./setup"

/** Returned from `activate`, for integration tests. */
export type Api = {
  controller: Controller
  editor: VsCodeEditor
  bridge: Bridge
  playDemo: () => Promise<void>
  launcher: string
  ready: Promise<void>
}

const config = () => vscode.workspace.getConfiguration("aiPair")

export function activate(context: vscode.ExtensionContext): Api {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir()

  const editor = new VsCodeEditor(root, config().get("agentName", "Agent"))
  const speed = {
    get: () => config().get("speed", 1),
    set: (value: number) => void config().update("speed", value, vscode.ConfigurationTarget.Global),
  }
  // Frames and panel messages at the Trace level, which VS Code hides unless it is set (#27).
  const log = vscode.window.createOutputChannel("AI Pair", { log: true })
  const trace = (line: string) => log.trace(line)
  const panel = new NarrationPanel(
    (file) => editor.resolvePath(file),
    speed,
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
  controller.setTiming(config().get("timing", {}))
  controller.setConfirmCommands(config().get("confirmCommands", true))

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
  )
  if (!context.globalState.get("aiPair.offeredSetup")) {
    void context.globalState.update("aiPair.offeredSetup", true)
    void vscode.window
      .showInformationMessage("AI Pair is installed. Connect it to your agent?", "Set Up Agent")
      .then((answer) => answer && setUpAgent(launcher))
  }

  return { controller, editor, bridge, playDemo: () => playDemo(controller, root), launcher, ready }
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
