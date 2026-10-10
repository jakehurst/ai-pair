// Runs inside a real VS Code (see scripts/integration.sh): plays the demo and checks the result,
// then that changes the programmer didn't make are reported as not theirs, interrupting only batches
// planned against the text before them, and that a programmer edit interrupts, with an exact report.

import * as assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import { Worker } from "node:worker_threads"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import * as vscode from "vscode"
import { CURSOR_MARKER, discoveryDir, type Report, type ToolName } from "@ai-pair/protocol"
import { LEFT_ARROW } from "@ai-pair/core/constants"
import { EditorLink, findWindows } from "../../relay/src/link"
import type { Api } from "../src/extension"

const EXPECTED_TODOS = `export interface Todo {
  id: number;
  title: string;
  done: boolean;
}

const todos: Todo[] = [];
let nextId = 1;

export function createTodo(title: string): Todo {
  const todo = { id: nextId++, title, done: false };
  todos.push(todo);
  return todo;
}

export function listTodos(): Todo[] {
  return todos;
}
`

const EXPECTED_SERVER = `import express from "express";
import { createTodo, listTodos } from "./todos";

const app = express();
app.use(express.json());

app.post("/todos", (req, res) => {
  const todo = createTodo(req.body.title);
  res.status(201).json(todo);
});

app.get("/todos", (req, res) => {
  res.json(listTodos());
});

app.listen(3000, () => console.log("Listening on http://localhost:3000"));
`

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Inserts text as the programmer would, while the agent may be typing into the same document. VS Code
 * rejects an extension's edit made against a version the document has moved past, which the agent's
 * next keystroke may do at any moment; the programmer typing would simply go through, so try again.
 */
async function insertAsProgrammer(uri: vscode.Uri, position: vscode.Position, text: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const edit = new vscode.WorkspaceEdit()
    edit.insert(uri, position, text)
    if (await vscode.workspace.applyEdit(edit)) return
    await sleep(5)
  }
  assert.fail("VS Code kept rejecting the programmer's edit")
}

/** A `read` of a file that doesn't exist (#89). */
function missing(e: unknown): boolean {
  return e instanceof Error && "code" in e && e.code === "invalid_arguments" && /doesn't exist/.test(e.message)
}

export async function run(): Promise<void> {
  const ext = vscode.extensions.getExtension<Api>("michalstrba.ai-pair")
  assert.ok(ext, "extension not found")
  const api = await ext.activate()
  const root = vscode.workspace.workspaceFolders![0]!.uri.fsPath
  const file = (name: string) => path.join(root, name)
  const buffer = async (name: string) => (await vscode.workspace.openTextDocument(file(name))).getText()
  const disk = async (name: string) => new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.file(file(name))))

  // The demo, sped up. If our own edits were mistaken for the programmer's, it would stop early.
  api.controller.setSpeed(20)
  const started = Date.now()
  await api.playDemo()
  console.log(`demo played in ${Date.now() - started} ms`)
  assert.equal(await buffer("ai-pair-demo/src/todos.ts"), EXPECTED_TODOS)
  assert.equal(await buffer("ai-pair-demo/src/server.ts"), EXPECTED_SERVER)
  assert.equal(await disk("ai-pair-demo/src/server.ts"), EXPECTED_SERVER, "saved after each batch")

  // Changes the programmer didn't make are reported, without interrupting: a tool writing to another file...
  const c = api.controller
  c.setSpeed(1)
  const until = async (done: () => boolean) => {
    for (let i = 0; i < 100 && !done(); i++) await sleep(50)
    assert.ok(done(), "timed out")
  }
  fs.writeFileSync(file("other.txt"), "before\n")
  const other = await vscode.workspace.openTextDocument(file("other.txt"))
  await c.start("other edits")
  await c.step([{ move: { file: "tool.txt", line: 1, to: "line_end" } }, { type_fast: `${"x".repeat(200)}${CURSOR_MARKER}` }])
  const queued = c.step([{ type: `abc${CURSOR_MARKER}` }])
  await sleep(1500)
  fs.writeFileSync(file("other.txt"), "after\n")
  await until(() => other.getText() === "after\n")
  const first = await queued
  assert.deepEqual(
    first.batches.map((b) => b.status),
    ["completed"],
  )
  assert.deepEqual(first.events, [{ kind: "edit", file: "other.txt", diff: "@@ -1,1 +1,1 @@\n-before\n+after", by: "other" }])
  const toolDone = await c.step([])
  assert.deepEqual(
    toolDone.batches.map((b) => b.status),
    ["completed"],
  )

  // ...and a save participant, trimming what the agent typed when its batch is saved: its change isn't
  // the programmer's, and the batch queued behind it, planned against the untrimmed text, is discarded.
  await vscode.workspace.getConfiguration("files").update("trimTrailingWhitespace", true, vscode.ConfigurationTarget.Global)
  await c.step([{ type: `\nend   ${CURSOR_MARKER}` }])
  const trimmed = await c.step([{ type: `!${CURSOR_MARKER}` }])
  const trimDone = await c.step([])
  await vscode.workspace.getConfiguration("files").update("trimTrailingWhitespace", undefined, vscode.ConfigurationTarget.Global)
  assert.deepEqual(
    [...trimmed.batches, ...trimDone.batches].map((b) => b.status),
    ["completed", "discarded"],
  )
  assert.deepEqual(
    [...trimmed.events, ...trimDone.events].map((e) => e.kind === "edit" && `${e.file} ${e.by}`),
    ["tool.txt other"],
  )
  assert.ok((await buffer("tool.txt")).endsWith("abc\nend"))
  await c.end()
  console.log("changes by others are reported as theirs")

  // A keystroke just before the agent saves is the programmer's, even though its change event is
  // handled while the save runs (#40). The test's own edit stands in for the keystroke.
  fs.writeFileSync(file("race.txt"), "a\n")
  const race = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file("race.txt")))
  await c.start("save race")
  await race.edit((b) => b.insert(new vscode.Position(0, 1), "b"))
  await c.listen()
  const keystroke = race.edit((b) => b.insert(new vscode.Position(0, 2), "c"))
  await api.editor.save(file("race.txt"))
  await keystroke
  const raced = await c.listen()
  assert.deepEqual(
    raced.events.map((e) => e.kind === "edit" && `${e.file} ${e.by}`),
    ["race.txt programmer"],
  )
  await c.end()
  console.log("a keystroke just before a save is the programmer's")

  // Our own move to another file doesn't pause playback, however long VS Code takes to show it (#56).
  // With no window after our navigation, only the hold while show() awaits covers it.
  fs.writeFileSync(file("follow-a.txt"), "a\n")
  fs.writeFileSync(file("follow-b.txt"), "b\n")
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file("follow-a.txt")))
  await c.start("follow")
  await c.read("follow-a.txt")
  await c.step([{ move: { file: "follow-a.txt", line: 1, to: "line_end" } }])
  assert.deepEqual(
    (await c.step([])).batches.map((b) => b.status),
    ["completed"],
  )
  await c.read("follow-b.txt")
  api.editor.selfNavMs = 0
  await c.step([{ move: { file: "follow-b.txt", line: 1, to: "line_end" } }, { type: "x\u{258c}" }])
  const moved = await c.step([])
  api.editor.selfNavMs = 400
  assert.equal(c.isPaused, false, "paused by our own move")
  assert.deepEqual(
    moved.batches.map((b) => b.status),
    ["completed"],
  )
  assert.equal(await buffer("follow-b.txt"), "bx\n")
  await c.end()
  console.log("our own move to another file doesn't pause")

  // An action without `file` acts in the file its batch named, not the cursor's (#58).
  fs.writeFileSync(file("named-a.txt"), "a\n")
  fs.writeFileSync(file("named-b.txt"), "b\nsecond\n")
  await c.start("named file")
  await c.read("named-a.txt")
  await c.read("named-b.txt")
  await c.step([{ move: { file: "named-a.txt", line: 1, to: "line_end" } }])
  const twice = await c.step([{ point: { file: "named-b.txt", line: 1, text: "b" } }, { point: { line: 2, text: "second" } }])
  assert.equal(twice.rejected, undefined)
  const pointed = await c.step([])
  assert.deepEqual(
    pointed.batches.map((b) => b.status),
    ["completed"],
  )
  assert.equal(vscode.window.activeTextEditor?.document.uri.fsPath, file("named-b.txt"))
  const outside = await c.step([{ point: { file: "named-b.txt", line: 1, text: "b" } }, { type: "y\u{258c}" }])
  assert.equal(outside.rejected?.error.kind, "invalid_action")
  await c.step([])
  assert.equal(await buffer("named-a.txt"), "a\n")
  assert.equal(await buffer("named-b.txt"), "b\nsecond\n")
  await c.end()
  console.log("an action without file acts in the file its batch named")

  // A report the agent cancelled as it returned is handed back before the agent's next call goes out,
  // so the editor restores it first: the next batch isn't played without it (#59), and once the
  // programmer ends the session, the session still takes it (#60). The relay's own link, against this window.
  const link = new EditorLink(root, discoveryDir())
  // The editor answers these tools with reports.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const relayed = (tool: ToolName, args: Record<string, unknown>, signal?: AbortSignal) => link.call(tool, args, signal) as Promise<Report>
  fs.writeFileSync(file("return.txt"), "a\n")
  await relayed("start", { task: "return", cwd: root })
  await link.call("read", { file: "return.txt" })
  const cancelListen = new AbortController()
  void relayed("listen", {}, cancelListen.signal)
  await sleep(300)
  c.userMessage("stop")
  cancelListen.abort()
  const restored = await relayed("step", { actions: [{ move: { file: "return.txt", line: 1, to: "line_end" } }, { type: "x\u{258c}" }] })
  assert.deepEqual(
    restored.events.map((e) => e.kind),
    ["message"],
  )
  assert.deepEqual(
    restored.batches.map((b) => b.status),
    ["discarded"],
  )
  assert.equal(await buffer("return.txt"), "a\n")

  const cancelLast = new AbortController()
  void relayed("listen", {}, cancelLast.signal)
  await sleep(300)
  c.userMessage("one more thing")
  c.endSession()
  cancelLast.abort()
  const ended = await relayed("listen", {})
  assert.deepEqual(
    ended.events.map((e) => e.kind),
    ["message", "end"],
  )
  link.close()
  // The bridge disconnects the socket's session when it sees the close; let that happen before the next start.
  await sleep(300)
  console.log("a cancelled report is restored before the next call")

  // A file changed on disk, as a git checkout does, comes from VS Code as one change spanning the
  // lines between the changed ones; the agent's selection there stays on its text (#65).
  fs.writeFileSync(file("reload.txt"), "1\n2\n3\n4\n5\n6\n")
  const reloading = await vscode.workspace.openTextDocument(file("reload.txt"))
  await vscode.window.showTextDocument(reloading)
  await c.start("reload")
  await c.read("reload.txt")
  await c.step([{ select: { file: "reload.txt", line: 3, text: "3" } }])
  await c.step([])
  fs.writeFileSync(file("reload.txt"), "1\nX\n3\n4\nY\n6\n")
  await until(() => reloading.getText() === "1\nX\n3\n4\nY\n6\n")
  const reloaded = await c.step([{ point: { file: "reload.txt", line: 4, text: "4" } }, { delete: true }])
  assert.equal(reloaded.rejected, undefined)
  await c.step([])
  assert.equal(await buffer("reload.txt"), "1\nX\n\n4\nY\n6\n")
  await c.end()
  console.log("a file changed on disk keeps the selection on its text")

  // A file that doesn't exist is reported as missing, and a move creates it (#89). One deleted on
  // disk while VS Code holds a document for it, as Claude Code's file tools leave one, isn't read with
  // its old text, and a move creates it empty (#88). Unsaved text for a deleted file is kept.
  await c.start("missing files")
  await assert.rejects(c.read("missing-89.txt"), missing)
  fs.writeFileSync(file("stale-88.txt"), "old\n")
  const stale = await vscode.workspace.openTextDocument(file("stale-88.txt"))
  assert.equal(stale.getText(), "old\n")
  fs.unlinkSync(file("stale-88.txt"))
  await assert.rejects(c.read("stale-88.txt"), missing)
  const recreated = await c.step([{ move: { file: "stale-88.txt", line: 1, to: "line_end" } }, { type: "new\u{258c}" }])
  assert.equal(recreated.rejected, undefined)
  const played = (await c.step([])).batches
  assert.deepEqual(
    played.map((b) => b.status),
    ["completed"],
    JSON.stringify(played),
  )
  assert.equal(await buffer("stale-88.txt"), "new")
  assert.equal(await disk("stale-88.txt"), "new")
  fs.writeFileSync(file("unsaved-88.txt"), "a\n")
  const unsaved = await vscode.workspace.openTextDocument(file("unsaved-88.txt"))
  await insertAsProgrammer(unsaved.uri, new vscode.Position(0, 1), "b")
  fs.unlinkSync(file("unsaved-88.txt"))
  assert.deepEqual((await c.read("unsaved-88.txt")).lines, [{ number: 1, text: "ab" }])
  await unsaved.save()
  await c.end()
  console.log("missing and deleted files read as missing, and are created empty")

  // A file written on disk outside the protocol is marked, during a session, until it's opened; a
  // save and a file the agent created aren't (#15, specs/Outside.tla).
  fs.writeFileSync(file("outside-saved.txt"), "a\n")
  const savedDoc = await vscode.workspace.openTextDocument(file("outside-saved.txt"))
  // The watcher reports that write late; outside a session it isn't marked.
  await sleep(2000)
  await c.start("outside")
  fs.writeFileSync(file("outside-written.txt"), "by another tool\n")
  await until(() => api.outside.isMarked(file("outside-written.txt")))
  await insertAsProgrammer(savedDoc.uri, new vscode.Position(0, 1), "b")
  await savedDoc.save()
  await c.step([{ move: { file: "outside-new.txt", line: 1, to: "line_end" } }, { type: "x\u{258c}" }])
  await c.step([])
  // Past the group's settling, and the watcher's own delay.
  await sleep(2000)
  assert.equal(api.outside.isMarked(file("outside-saved.txt")), false, "a save was marked")
  assert.equal(api.outside.isMarked(file("outside-new.txt")), false, "the agent's new file was marked")
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file("outside-written.txt")))
  await until(() => !api.outside.isMarked(file("outside-written.txt")))
  // One opened as soon as it's written was seen, though its writes weren't decided yet.
  fs.writeFileSync(file("outside-opened.txt"), "seen at once\n")
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file("outside-opened.txt")))
  await sleep(2000)
  assert.equal(api.outside.isMarked(file("outside-opened.txt")), false, "a file seen as soon as it was written was marked")
  await c.end()
  console.log("a file written outside is marked until it's opened; saves and new files aren't")

  // During the programmer's turn, a listen made after they resume typing waits for their next pause
  // (specs/Navigator.tla). The idle time is the default, 3 s.
  fs.writeFileSync(file("navigator.txt"), "abc\n")
  const navigator = await vscode.workspace.openTextDocument(file("navigator.txt"))
  await vscode.window.showTextDocument(navigator)
  await c.start("navigator")
  c.takeTurn()
  await c.listen()
  await insertAsProgrammer(navigator.uri, new vscode.Position(0, 3), "d")
  await sleep(3500)
  await insertAsProgrammer(navigator.uri, new vscode.Position(0, 4), "e")
  const listenedAt = Date.now()
  const afterPause = await c.listen()
  const waited = Date.now() - listenedAt
  assert.ok(waited > 2000, `listen returned ${waited} ms after the programmer typed`)
  assert.deepEqual(
    afterPause.events.map((e) => e.kind === "edit" && e.diff.includes("+abcde")),
    [true],
  )
  await c.end()
  console.log(`a listen during the programmer's typing waited ${waited} ms for their pause`)

  // An edit the programmer undid still comes with the batches it discarded (specs/EditEvents.tla).
  fs.writeFileSync(file("undone.txt"), "abc\n")
  const undone = await vscode.workspace.openTextDocument(file("undone.txt"))
  await vscode.window.showTextDocument(undone)
  await c.start("undone")
  await c.read("undone.txt")
  // The first step returns at once; nothing waits for a report while the programmer types and undoes.
  await c.step([{ move: { file: "undone.txt", line: 1, to: "line_end" } }, { type_fast: `${"x".repeat(100)}\u{258c}` }])
  await sleep(800)
  await insertAsProgrammer(undone.uri, new vscode.Position(0, 0), "#")
  const undo = new vscode.WorkspaceEdit()
  undo.delete(undone.uri, new vscode.Range(0, 0, 0, 1))
  await vscode.workspace.applyEdit(undo)
  const discardedReport = await c.step([])
  assert.ok(
    discardedReport.batches.some((b) => b.status !== "completed"),
    JSON.stringify(discardedReport.batches),
  )
  assert.deepEqual(discardedReport.events, [{ kind: "edit", file: "undone.txt", diff: "", by: "programmer" }])
  await c.end()
  console.log("an edit the programmer undid is reported with the batches it discarded")

  // A scroll a command cut short goes on once the command is done (specs/Scroll.tla). The moves
  // there and back first measure the view, so the last one glides from the top: a glide takes 500 ms,
  // and at speed 20 the command starts some 50 ms into it.
  const ai = vscode.workspace.getConfiguration("aiPair")
  await ai.update("confirmCommands", false, vscode.ConfigurationTarget.Global)
  fs.writeFileSync(file("glide.txt"), Array.from({ length: 300 }, (_, i) => `line ${i + 1}\n`).join(""))
  const glide = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file("glide.txt")))
  c.setSpeed(20)
  await c.start("glide")
  await c.read("glide.txt")
  for (const line of [150, 1]) {
    await c.step([{ move: { file: "glide.txt", line, to: "line_end" } }])
    await c.step([])
    await sleep(800)
  }
  assert.equal(glide.visibleRanges[0]?.start.line, 0)
  await c.step([{ move: { file: "glide.txt", line: 250, to: "line_end" } }, { run: "sleep 1" }])
  const ran = await c.step([])
  assert.deepEqual(
    ran.batches.map((b) => b.status),
    ["completed"],
  )
  await sleep(800)
  const shown = glide.visibleRanges.map((r) => `${r.start.line + 1}-${r.end.line + 1}`)
  assert.ok(
    glide.visibleRanges.some((r) => r.start.line <= 249 && 249 <= r.end.line),
    `line 250 not in view: ${shown.join(", ")}`,
  )
  c.setSpeed(1)
  await c.end()
  await ai.update("confirmCommands", undefined, vscode.ConfigurationTarget.Global)
  console.log(`a scroll a command cut short went on to line 250: ${shown.join(", ")}`)

  // An interrupt while a `run` saves its files stops it, without waiting to ask the programmer.
  fs.writeFileSync(file("asked.txt"), "a\n")
  await c.start("asked")
  await c.read("asked.txt")
  const interrupting = vscode.workspace.onWillSaveTextDocument(() => c.userInterrupt())
  c.setSpeed(20)
  await c.step([{ move: { file: "asked.txt", line: 1, to: "line_end" } }, { type: "b\u{258c}" }, { run: "true" }])
  const asked = await Promise.race([c.listen(), sleep(3000).then(() => undefined)])
  interrupting.dispose()
  assert.ok(asked, "listen is still waiting")
  assert.deepEqual(
    asked.batches.map((b) => b.status),
    ["interrupted"],
  )
  c.setSpeed(1)
  await c.end()
  console.log("an interrupt while a run saves stops it, without asking")

  // A batch interrupted after a type with nothing to type changed nothing, so it's discarded (specs/Actions.tla).
  fs.writeFileSync(file("nothing.txt"), "a\n")
  await c.start("nothing")
  await c.read("nothing.txt")
  await c.step([{ move: { file: "nothing.txt", line: 1, to: "line_end" } }])
  await c.step([])
  const eol = api.editor.eol.bind(api.editor)
  let eols = 0
  api.editor.eol = async (f) => {
    if (++eols === 2) c.userInterrupt()
    return eol(f)
  }
  await c.step([{ type: "\u{258c}" }, { say: "Typed." }])
  const untyped = await c.listen()
  api.editor.eol = eol
  assert.deepEqual(
    untyped.batches.map((b) => b.status),
    ["discarded"],
  )
  await c.end()
  console.log("a batch interrupted after a type with nothing to type is discarded")

  // A line a tool inserts, read while a queued batch edits other files, is accepted (specs/Rehearsal.tla).
  fs.writeFileSync(file("inserted.txt"), "hello\n")
  const inserted = await vscode.workspace.openTextDocument(file("inserted.txt"))
  await vscode.window.showTextDocument(inserted)
  await c.start("inserted")
  await c.read("inserted.txt")
  await c.step([{ say: Array.from({ length: 25 }, (_, i) => `word${i}`).join(" ") }])
  fs.writeFileSync(file("inserted.txt"), "XX\nhello\n")
  await until(() => inserted.getText() === "XX\nhello\n")
  assert.deepEqual(
    (await c.read("inserted.txt")).lines.map((l) => l.text),
    ["XX", "hello"],
  )
  const movedThere = await c.step([{ move: { file: "inserted.txt", line: 1, to: "line_end" } }])
  assert.equal(movedThere.rejected, undefined, JSON.stringify(movedThere.rejected))
  await c.step([])
  await c.end()
  console.log("a line a tool inserted, read while a queued batch edits other files, is accepted")

  // A session the agent disconnects from waits, suspended, saved in the workspace's storage; one
  // brought back from it, as after a reload, resumes on a start from its folder (#25, specs/Resume.tla).
  fs.writeFileSync(file("kept.txt"), "one\ntwo\n")
  await c.start("kept")
  await c.read("kept.txt")
  await c.step([{ move: { file: "kept.txt", line: 2, to: "line_end" } }])
  await c.step([])
  c.disconnect()
  assert.equal(c.isSuspended, true)
  await sleep(500)
  const kept = api.saved()
  assert.ok(kept?.scene.cursor, "the suspended session wasn't saved")
  c.endSession()
  c.revive(kept)
  const revived = await c.start("kept")
  assert.equal(revived.resumed, true)
  assert.match(revived.cursor?.lines.find((l) => l.text.includes("\u{258c}"))?.text ?? "", /two/)
  await c.end()
  console.log("a session saved while suspended resumes, with its cursor")

  // A folder in the workspace whose name starts with two dots is in the workspace (#5).
  fs.mkdirSync(file("..cache"), { recursive: true })
  fs.writeFileSync(file("..cache/x.txt"), "a\n")
  const dotted = await vscode.workspace.openTextDocument(file("..cache/x.txt"))
  await vscode.window.showTextDocument(dotted)
  await c.start("dotted")
  fs.writeFileSync(file("..cache/x.txt"), "b\n")
  await until(() => dotted.getText() === "b\n")
  const dottedReport = await c.listen()
  assert.deepEqual(
    dottedReport.events.map((e) => e.kind === "edit" && e.file),
    ["..cache/x.txt"],
  )
  await c.end()
  console.log("a change in ..cache/ is reported, by its path in the workspace")

  // Finding short text on a line of a long file, where it matches on every line, takes no time (#2).
  fs.writeFileSync(file("long.ts"), "  foo(bar(baz(1), 2), 3);\n".repeat(40_000))
  await c.start("long")
  await c.read("long.ts", 39_999, 40_000)
  const finding = Date.now()
  const found = await c.step([{ point: { file: "long.ts", line: 40_000, text: "foo(" } }])
  const findMs = Date.now() - finding
  assert.equal(found.rejected, undefined)
  assert.ok(findMs < 2000, `the step took ${findMs} ms`)
  await c.end()
  console.log(`a point on line 40,000 was rehearsed in ${findMs} ms`)

  // The panel's page reloading takes its draft with it, and the draft's pause (#69). The test can't
  // type into the page, so it adds the pause the page's `draft` message adds.
  await vscode.commands.executeCommand("aiPair.narration.focus")
  await sleep(1000)
  c.pause("reply")
  await vscode.commands.executeCommand("workbench.action.webview.reloadWebviewAction")
  await until(() => !c.isPaused)
  console.log("a reloaded panel ends its draft's pause")

  // The window's discovery file, rewritten on focus, is never half written for a relay reading it (#72).
  await api.ready
  const stop = new SharedArrayBuffer(4)
  const reader = new Worker(
    `const { parentPort, workerData } = require("node:worker_threads"); const fs = require("node:fs")
    const stop = new Int32Array(workerData.stop); let reads = 0, broken = 0
    while (Atomics.load(stop, 0) === 0) { try { JSON.parse(fs.readFileSync(workerData.file, "utf8")) } catch { broken++ } reads++ }
    parentPort.postMessage({ reads, broken })`,
    { eval: true, workerData: { file: api.bridge.file, stop } },
  )
  const counted = new Promise<{ reads: number; broken: number }>((r) => reader.once("message", r))
  await sleep(100)
  for (let i = 0; i < 2000; i++) api.bridge.focused()
  Atomics.store(new Int32Array(stop), 0, 1)
  const { reads, broken } = await counted
  await reader.terminate()
  assert.ok(reads > 0)
  assert.equal(broken, 0, `${broken} of ${reads} reads didn't parse`)
  assert.ok(findWindows([root], discoveryDir()).windows.some((w) => w.pid === process.pid))
  console.log(`the discovery file is never half written (${reads} reads)`)

  // A programmer edit mid-typing interrupts, and the report shows exactly what was typed.
  const alphabet = "abcdefghijklmnopqrstuvwxyz"
  await c.start("interrupt test")
  await c.step([{ move: { file: "scratch.ts", line: 1, to: "line_end" } }, { type: `${alphabet}${CURSOR_MARKER}` }])
  const pending = c.step([{ type: `!${CURSOR_MARKER}` }])
  // Past the pauses around moving into a new file (~1 s), and into the typing.
  await sleep(1500)
  const doc = await vscode.workspace.openTextDocument(file("scratch.ts"))
  await insertAsProgrammer(doc.uri, new vscode.Position(0, 0), "// mine\n")

  const report = await pending
  const [typing, next] = report.batches
  assert.equal(typing?.status, "interrupted")
  // What's left of the cut `type` comes back first, ready to resubmit.
  const rest = typing.unplayed?.[0]
  const left = rest && "type" in rest ? rest.type.replace(CURSOR_MARKER, "") : ""
  const typed = alphabet.slice(0, alphabet.length - left.length)
  assert.ok(typed.length > 0 && left.length > 0 && alphabet.endsWith(left), `left: ${JSON.stringify(left)}`)
  assert.equal(next?.status, "discarded")
  assert.equal(report.events[0]?.kind, "edit")
  assert.equal(doc.getText(), "// mine\n" + typed)
  assert.deepEqual(typing.code, {
    file: "scratch.ts",
    lines: [
      { number: 1, text: "// mine" },
      { number: 2, text: typed + CURSOR_MARKER },
    ],
    end: { final_newline: false },
  })
  await c.end()
  console.log(`interrupted after typing ${JSON.stringify(typed)}`)

  // An agent connecting the way a harness does: the launcher, over stdio, from the project folder.
  await api.ready
  // Its frames at Info, with `aiPair.trace` (#27): checked in the log once it's done.
  await vscode.workspace.getConfiguration("aiPair").update("trace", true, vscode.ConfigurationTarget.Global)
  const transport = new StdioClientTransport({
    command: api.launcher,
    cwd: root,
    env: Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined)),
  })
  const agent = new Client({ name: "integration", version: "0" })
  await agent.connect(transport)
  const tools = await agent.listTools()
  assert.deepEqual(tools.tools.map((t) => t.name).toSorted(), ["calibrate", "end", "listen", "read", "start", "step"])
  // Every text part of a tool's result, joined.
  const toolAll = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await agent.callTool({ name, arguments: args })
    // The relay answers with text parts only.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return (result.content as { text: string }[]).map((part) => part.text).join("\n\n")
  }
  const tool = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await agent.callTool({ name, arguments: args })
    // The relay answers with text parts only.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const content = result.content as { type: string; text: string }[]
    assert.ok(!result.isError, content[0]?.text ?? "tool error")
    return content[0]!.text
  }
  c.setSpeed(20)
  // The project's guide reaches the agent with the pairing guide (#23).
  fs.mkdirSync(file(".ai-pair"), { recursive: true })
  fs.writeFileSync(file(".ai-pair/GUIDE.md"), "Name every test after the issue it covers.\n")
  const startText = await toolAll("start", { task: "relay test" })
  assert.match(startText, /# Project rules[\s\S]*\.ai-pair\/GUIDE\.md\n\nName every test after the issue it covers\./)
  await tool("step", {
    actions: [
      { say: "Hello from the relay." },
      { move: { file: "relay.txt", line: 1, to: "line_end" } },
      { type: `typed via the relay${CURSOR_MARKER}` },
    ],
  })
  const last = await tool("step", { actions: [] })
  assert.match(last, /Batch \d+ completed/)
  assert.equal(await buffer("relay.txt"), "typed via the relay")
  // A call the agent cancels after taking its answer: the SDK's client still sends the cancel, so
  // the relay hands the report back, and it comes again saying it may repeat (#67).
  const cancelAfter = new AbortController()
  const taken = agent.callTool({ name: "listen", arguments: {} }, undefined, { signal: cancelAfter.signal })
  await sleep(300)
  c.userMessage("seen once")
  // The relay answers with text parts only.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  assert.match(((await taken).content as { text: string }[])[0]!.text, /seen once/)
  cancelAfter.abort()
  const repeated = await tool("listen")
  assert.match(repeated, /seen once/)
  assert.match(repeated, /may repeat/)
  console.log("a report canceled after it was taken comes again, marked")
  await tool("end", { summary: "Bye." })
  // Two rejections cancelled after the agent took them come back, each in a report marked as one
  // that may repeat, and a session the programmer ends stays until both are out (specs/Controller.tla).
  await toolAll("start", { task: "held" })
  const rejectedOnce = async (line: number) => {
    const abort = new AbortController()
    const actions = [{ move: { file: "relay.txt", line, to: "line_end" } }]
    const result = await agent.callTool({ name: "step", arguments: { actions } }, undefined, { signal: abort.signal })
    // The relay answers with text parts only.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    assert.match((result.content as { text: string }[])[0]!.text, /rejected/)
    return abort
  }
  const one = await rejectedOnce(5)
  const two = await rejectedOnce(6)
  one.abort()
  two.abort()
  // The cancels reach the relay, and its returns the editor, before anything else happens.
  await sleep(300)
  c.endSession()
  const backs = [await toolAll("listen"), await toolAll("listen")]
  for (const [i, back] of backs.entries()) {
    assert.match(back, /may repeat/)
    assert.match(back, new RegExp(`"line":${i + 5}`))
  }
  assert.ok((await agent.callTool({ name: "listen", arguments: {} })).isError, "the ended session is still open")
  console.log("rejections handed back after their answers each come again, marked, before an ended session closes")
  await agent.close()
  // The run's log, in the user data folder next to the workspace (scripts/integration.sh).
  const logs = path.join(root, "..", "user", "logs")
  const traced = () =>
    fs
      .readdirSync(logs, { recursive: true, encoding: "utf8" })
      .filter((f) => path.basename(f) === "AI Pair.log")
      .map((f) => fs.readFileSync(path.join(logs, f), "utf8"))
      .join("")
  await until(() => new RegExp(`\\[info\\] socket \\d+ ${LEFT_ARROW} call \\d+ start`).test(traced()))
  await vscode.workspace.getConfiguration("aiPair").update("trace", undefined, vscode.ConfigurationTarget.Global)
  console.log("relay session OK, with the project's guide")
}
