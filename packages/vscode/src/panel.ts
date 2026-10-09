// The narration panel: a webview view in the secondary side bar. See "Narration panel" in DESIGN.md.

import * as vscode from "vscode"
import type { Controller, PanelEvent, PanelPort, Ref, SharedSelection } from "@ai-pair/core"
import { panelHtml, SPEEDS } from "./panelHtml"
import type { FromPanel, ToPanel } from "./panelMessages"
import type { Calibration, CalibrationView } from "./calibration"

const MAX_LOG = 400

/** The commands the panel may run: the ones its intro links to. */
const PANEL_COMMANDS: ReadonlySet<string> = new Set(["aiPair.playDemo", "aiPair.setUpAgent"])

/** An agent the idle view can start a session with: whether it can right now, and how (#107). */
export type Starter = {
  available(): Promise<boolean>
  /** Resolves once the agent it ran has exited, or at once if it ran none (#118). */
  start(): Promise<void>
}

export class NarrationPanel implements PanelPort, vscode.WebviewViewProvider {
  static readonly viewId = "aiPair.narration"
  controller?: Controller
  /** The reading speed calibration; the programmer's replies go to it while one is under way (#109). */
  calibration?: Calibration
  /** Starts a session from the idle view, when an agent that can be started from here is set up (#107). */
  starter?: Starter
  /** Questions asked of the starter so far; an answer to an earlier one is dropped. */
  private asked = 0
  private view?: vscode.WebviewView
  /** Everything posted so far, replayed when the view is (re)created. */
  private readonly log: PanelEvent[] = []
  /** After each post: the window saves the history with a session, for a reload (#25). */
  onPost?: () => void

  /** Everything posted so far, as the window saves it. */
  get history(): readonly PanelEvent[] {
    return this.log
  }

  /**
   * Asks the starter whether a session can be started from here, and tells the page: for each new
   * page, and again after Set Up Agent (specs/Start.tla, Ready and Flip with ReaskOnSetUp). Only the
   * latest question's answer reaches the page, so a page replaced before its answer landed cannot
   * set the button on its successor (DropStale).
   */
  askStart(): void {
    const asked = ++this.asked
    void this.starter?.available().then((value) => {
      if (asked === this.asked) this.send({ type: "canStart", value })
    })
  }

  constructor(
    private readonly resolvePath: (file: string) => string,
    private readonly speed: { get: () => number; set: (value: number) => void },
    private readonly readingSpeed: { get: () => number; set: (value: number) => void },
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

  showReadingSpeed(value: number): void {
    this.send({ type: "readingSpeed", value })
  }

  showCalibration(view: CalibrationView): void {
    this.send({ type: "calibration", view })
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
      if (!event.active) this.calibration?.cancel()
    }
    this.onPost?.()
  }

  /** After a reload: the history the window saved with its session, for the view to replay (#25). */
  restoreHistory(events: readonly PanelEvent[]): void {
    this.log.splice(0, this.log.length, ...events)
    void vscode.commands.executeCommand("setContext", "aiPair.active", true)
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
      this.calibration?.cancel()
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
        this.showReadingSpeed(this.readingSpeed.get())
        this.showSelection(this.selection.ref())
        this.askStart()
        return
      case "speed":
        // Only the menu's speeds: the page sends no others (#17).
        if (SPEEDS.includes(m.value)) this.speed.set(m.value)
        return
      case "readingSpeed":
        if (SPEEDS.includes(m.value)) this.readingSpeed.set(m.value)
        return
      case "reply":
        // Replying means "go on with this", so any pause ends.
        if (this.calibration?.reply(m.text)) return
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
      case "start":
        // specs/Start.tla, Click: one run per click. Exit: the agent is done, and the page drops its note
        // (Settles).
        void this.starter?.start().then(() => this.send({ type: "startEnded" }))
        return
      case "openChange":
        void this.openChange(m.file)
        return
      case "openUrl":
        if (/^https?:\/\//.test(m.url)) void vscode.env.openExternal(vscode.Uri.parse(m.url))
        return
    }
  }

  /** Opens a file changed outside the protocol: its diff against git's index, or the file itself outside git (#15). */
  private async openChange(file: string): Promise<void> {
    const uri = vscode.Uri.file(this.resolvePath(file))
    try {
      await vscode.commands.executeCommand("git.openChange", uri)
    } catch {
      await vscode.commands.executeCommand("vscode.open", uri)
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
