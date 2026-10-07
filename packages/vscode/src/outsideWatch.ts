// Watching for files changed on disk outside the protocol, during a session, and marking them: a
// badge in the explorer and an entry in the panel's history, until the programmer opens the file
// or its diff (#15, specs/Outside.tla, DESIGN.md "Changes outside the protocol").

import * as vscode from "vscode"
import type { Controller, PanelPort } from "@ai-pair/core"
import type { VsCodeEditor } from "./editor"
import { OutsideChanges, watched } from "./outside"

export function watchOutside(
  controller: Controller,
  editor: VsCodeEditor,
  panel: PanelPort,
): { outside: OutsideChanges; disposable: vscode.Disposable } {
  const redrawn = new vscode.EventEmitter<vscode.Uri[]>()
  const outside = new OutsideChanges(
    read,
    (files) => panel.post({ type: "outside", files: files.map((f) => editor.displayPath(f)) }),
    (files) => redrawn.fire(files.map((f) => vscode.Uri.file(f))),
  )
  // What the editor writes itself, and what VS Code saves, are known; the watcher reports them too.
  editor.wrote = (file, text) => outside.saved(file, text)
  const onDisk = (uri: vscode.Uri) => {
    if (uri.scheme === "file" && controller.isActive && watched(uri.fsPath, folders())) outside.reported(uri.fsPath)
  }
  // Opening a marked file, or its diff (whose editor is the file's), is seeing it.
  const opened = async (editorShown: vscode.TextEditor | undefined) => {
    const file = editorShown?.document.uri
    if (file?.scheme !== "file" || !outside.isMarked(file.fsPath)) return
    const text = await read(file.fsPath)
    if (text !== undefined) outside.seen(file.fsPath, text)
  }
  const watcher = vscode.workspace.createFileSystemWatcher("**/*")
  const disposable = vscode.Disposable.from(
    watcher,
    watcher.onDidChange(onDisk),
    watcher.onDidCreate(onDisk),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.uri.scheme === "file") outside.saved(doc.uri.fsPath, doc.getText())
    }),
    vscode.window.onDidChangeActiveTextEditor((e) => void opened(e)),
    vscode.window.registerFileDecorationProvider({
      onDidChangeFileDecorations: redrawn.event,
      provideFileDecoration: (uri) =>
        uri.scheme === "file" && outside.isMarked(uri.fsPath)
          ? new vscode.FileDecoration("●", "Changed outside the editor", new vscode.ThemeColor("editorWarning.foreground"))
          : undefined,
    }),
    redrawn,
  )
  return { outside, disposable }
}

function folders(): string[] {
  return (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath)
}

/** A file's text on disk, or undefined if it's gone or can't be read. */
async function read(file: string): Promise<string | undefined> {
  try {
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.file(file)))
  } catch {
    return undefined
  }
}
