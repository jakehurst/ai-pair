// The narration panel: a webview view in the secondary side bar. See "Narration panel" in DESIGN.md.

import * as vscode from "vscode"
import type { Controller, PanelEvent, PanelPort, Ref, SharedSelection } from "@ai-pair/core"
import { panelHtml, SPEEDS } from "./panelHtml"
import type { FromPanel, ToPanel } from "./panelMessages"

const MAX_LOG = 400

/** The commands the panel may run: the ones its intro links to. */
const PANEL_COMMANDS: ReadonlySet<string> = new Set(["aiPair.playDemo", "aiPair.setUpAgent"])

export class NarrationPanel implements PanelPort, vscode.WebviewViewProvider {
  static readonly viewId = "aiPair.narration"
  controller?: Controller
  private view?: vscode.WebviewView
  /** Everything posted so far, replayed when the view is (re)created. */
  private readonly log: PanelEvent[] = []

  constructor(
    private readonly resolvePath: (file: string) => string,
    private readonly speed: { get: () => number; set: (value: number) => void },
    private readonly selection: { current: () => SharedSelection | undefined; ref: () => Ref | undefined },
    /** Called with a line for each message from the page, for diagnosing deliveries (#27). */
    private readonly trace?: (line: string) => void,
    /** Where dist/panel.js, the page's script, is: the extension's folder. */
    private readonly extensionUri?: vscode.Uri,
  ) {}

  /** Posts to the page, if there is one. */
  private send(message: ToPanel): void {
    void this.view?.webview.postMessage(message)
  }

  /** The programmer's selection changed. Not logged: only the current one matters. */
  showSelection(ref: Ref | undefined): void {
    this.send({ type: "selection", ref })
  }

  /** The speed setting changed. Not logged: only the current value matters. */
  showSpeed(value: number): void {
    this.send({ type: "speed", value })
  }

  post(event: PanelEvent): void {
    this.log.push(event)
    if (this.log.length > MAX_LOG) {
      const cut = this.log.splice(0, this.log.length - MAX_LOG)
      // A view replays its session state from the last `session` event: keep it, or a view created
      // after a long session shows none while one runs (#54).
      const session = cut.findLast((e) => e.type === "session")
      if (session && !this.log.some((e) => e.type === "session")) this.log.unshift(session)
    }
    this.send(event)
    if (event.type === "session") {
      void vscode.commands.executeCommand("setContext", "aiPair.active", event.active)
      if (event.active) this.reveal()
    }
  }

  focusReply(): void {
    this.reveal(false)
    this.send({ type: "focusReply" })
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view
    const dist = this.extensionUri && vscode.Uri.joinPath(this.extensionUri, "dist")
    view.webview.options = { enableScripts: true, localResourceRoots: dist ? [dist] : [] }
    const script = dist ? view.webview.asWebviewUri(vscode.Uri.joinPath(dist, "panel.js")).toString() : ""
    view.webview.html = panelHtml(view.webview.cspSource, script)
    view.webview.onDidReceiveMessage((m: FromPanel) => this.receive(m))
    view.onDidDispose(() => {
      if (this.view === view) this.view = undefined
      // Its draft went with it, and so does the pause the draft asked for (#69).
      this.controller?.resume("reply")
    })
  }

  private reveal(preserveFocus = true): void {
    if (this.view) this.view.show(preserveFocus)
    else void vscode.commands.executeCommand(`${NarrationPanel.viewId}.focus`)
  }

  private receive(m: FromPanel): void {
    const c = this.controller
    this.trace?.(
      `panel ${m.type}${m.type === "reply" ? ` ${JSON.stringify(m.text)}` : m.type === "draft" ? (m.empty ? " empty" : " typed") : ""}`,
    )
    switch (m.type) {
      case "ready":
        // A new page has an empty draft (#69).
        c?.resume("reply")
        this.send({ type: "replay", events: this.log })
        this.showSpeed(this.speed.get())
        this.showSelection(this.selection.ref())
        return
      case "speed":
        // Only the menu's speeds: the page sends no others (#17).
        if (SPEEDS.includes(m.value)) this.speed.set(m.value)
        return
      case "reply":
        // Replying means "go on with this", so any pause ends.
        c?.resume()
        c?.userMessage(m.text, m.attach ? this.selection.current() : undefined)
        return
      case "draft":
        // Typing a reply pauses playback, the way a pair stops when you start talking.
        if (m.empty) c?.resume("reply")
        else c?.pause("reply")
        return
      case "pause":
        c?.pause()
        return
      case "resume":
        c?.resume()
        return
      case "interrupt":
        c?.userInterrupt()
        return
      case "turn":
        c?.resume()
        if (c?.turn === "user") c.handBack(m.message, m.attach ? this.selection.current() : undefined)
        else c?.takeTurn()
        return
      case "end":
        c?.endSession()
        return
      case "runDecision":
        c?.decideRun(m.id, m.run, m.remember)
        return
      case "open": {
        const uri = vscode.Uri.file(this.resolvePath(m.file))
        const position = new vscode.Position(Math.max(0, m.line - 1), 0)
        void vscode.window.showTextDocument(uri, { selection: new vscode.Range(position, position) })
        return
      }
      case "openFile":
        void this.openByName(m.file)
        return
      case "command":
        if (PANEL_COMMANDS.has(m.command)) void vscode.commands.executeCommand(m.command)
        return
      case "openUrl":
        if (/^https?:\/\//.test(m.url)) void vscode.env.openExternal(vscode.Uri.parse(m.url))
        return
    }
  }

  /** Opens a file the agent named: as a path in the workspace, else the file of that name, asking if there are several. */
  private async openByName(name: string): Promise<void> {
    const direct = vscode.Uri.file(this.resolvePath(name))
    try {
      await vscode.workspace.fs.stat(direct)
      await vscode.window.showTextDocument(direct)
      return
    } catch {
      // Not a path from the workspace's root: look for it by name.
    }
    const found = await vscode.workspace.findFiles(`**/${name}`, "**/node_modules/**", 20)
    if (found.length === 0) {
      void vscode.window.showInformationMessage(`AI Pair: couldn't find ${name} in the workspace.`)
      return
    }
    let uri = found[0]!
    if (found.length > 1) {
      const picked = await vscode.window.showQuickPick(
        found.map((u) => ({ label: vscode.workspace.asRelativePath(u), uri: u })),
        { placeHolder: `Which ${name}?` },
      )
      if (!picked) return
      uri = picked.uri
    }
    await vscode.window.showTextDocument(uri)
  }
}
