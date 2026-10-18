// The Pair panel's page in the real window, for test/integration.ts, driven over the Chrome DevTools Protocol on the
// port scripts/integration.sh opens (#176). The page's own script handles each click and each keystroke, so what
// reaches the extension is what a programmer's would: every message the page can post, and the calibration.

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { WebSocket } from 'ws';
import { CURSOR_MARKER, type Report } from '@ai-pair/protocol';
import type { Api } from '../src/extension';
import { mark } from './integration_clock';

/** How long to look for the page once the view is shown, and how often. */
const FIND_MS = 15_000;
const POLL_MS = 250;

/** Past the panel's reply to the page, and the page's to the extension. */
const SETTLE_MS = 500;

/** The menu speeds the page's buttons pick. */
const MENU_SPEED = 3;
const MENU_READING_SPEED = 0.5;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** A DevTools target, as `/json/list` describes it. */
interface Target {
  type: string;
  url: string;
  webSocketDebuggerUrl?: string;
}

function isTargets(v: unknown): v is Target[] {
  return Array.isArray(v) && v.every((t: unknown) => isRecord(t) && typeof t.type === 'string' && typeof t.url === 'string');
}

/** A DevTools session on one target: its commands, and the JavaScript contexts it reports. */
class Devtools {
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  readonly contexts: number[] = [];

  private constructor(private readonly socket: WebSocket) {
    socket.on('message', (data) => {
      const text = Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data);
      const message: unknown = JSON.parse(text.toString('utf8'));
      if (!isRecord(message)) return;
      if (typeof message.id === 'number') {
        const waiting = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (isRecord(message.error)) {
          waiting?.reject(new Error(String(message.error.message)));
        } else {
          waiting?.resolve(message.result);
        }
      }
      if (message.method === 'Runtime.executionContextCreated' && isRecord(message.params) && isRecord(message.params.context)) {
        if (typeof message.params.context.id === 'number') this.contexts.push(message.params.context.id);
      }
    });
  }

  static async open(url: string): Promise<Devtools> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    return new Devtools(socket);
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close(): void {
    this.socket.close();
  }
}

/** The panel's page: JavaScript run in it, as a programmer's clicks and keys would. */
class PanelPage {
  private constructor(
    private readonly devtools: Devtools,
    private readonly contextId: number,
  ) {}

  /** Looks through the window's targets and contexts for the one page with the panel's reply box. */
  static async locate(port: number): Promise<PanelPage> {
    const giveUp = Date.now() + FIND_MS;
    for (;;) {
      const listed: unknown = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      assert.ok(isTargets(listed), 'DevTools listed something other than targets');
      for (const target of listed) {
        if (target.webSocketDebuggerUrl === undefined) continue;
        const devtools = await Devtools.open(target.webSocketDebuggerUrl);
        await devtools.send('Runtime.enable');
        for (const contextId of devtools.contexts) {
          const page = new PanelPage(devtools, contextId);
          const found = await page.evaluate('document.querySelector(\'[data-ui="reply"]\') !== null').catch(() => false);
          if (found === true) return page;
        }
        devtools.close();
      }
      assert.ok(Date.now() < giveUp, "the panel's page was not found");
      await sleep(POLL_MS);
    }
  }

  /** Runs `expression` in the page and returns its value. */
  async evaluate(expression: string): Promise<unknown> {
    const result = await this.devtools.send('Runtime.evaluate', {
      expression,
      contextId: this.contextId,
      returnByValue: true,
      awaitPromise: true,
    });
    assert.ok(isRecord(result), 'no result');
    if (isRecord(result.exceptionDetails)) throw new Error(`${expression} threw: ${JSON.stringify(result.exceptionDetails)}`);
    return isRecord(result.result) ? result.result.value : undefined;
  }

  /** Clicks the element `selector` names, which must be there. */
  async click(selector: string): Promise<void> {
    await this.evaluate(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error('no ' + ${JSON.stringify(selector)}); el.click(); })()`,
    );
    await sleep(SETTLE_MS);
  }

  /** Clicks the control marked `data-ui="name"`. */
  clickUi(name: string): Promise<void> {
    return this.click(`[data-ui="${name}"]`);
  }

  /** Types `text` into the reply box, as the programmer's keys leave it. */
  async type(text: string): Promise<void> {
    await this.evaluate(
      `(() => { const r = document.querySelector('[data-ui="reply"]'); r.value = ${JSON.stringify(text)}; r.dispatchEvent(new Event('input', { bubbles: true })); })()`,
    );
    await sleep(SETTLE_MS);
  }

  /** Presses Enter in the reply box. */
  async enter(): Promise<void> {
    await this.evaluate(
      `document.querySelector('[data-ui="reply"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))`,
    );
    await sleep(SETTLE_MS);
  }

  /** Returns the text of the element marked `data-ui="name"`. */
  async text(name: string): Promise<string> {
    return String(await this.evaluate(`document.querySelector('[data-ui="${name}"]').textContent`));
  }

  /** Returns how many elements match `selector`. */
  async count(selector: string): Promise<number> {
    return Number(await this.evaluate(`document.querySelectorAll(${JSON.stringify(selector)}).length`));
  }

  close(): void {
    this.devtools.close();
  }
}

/** Plays the page's paths: see the file comment. */
export async function pagePaths(api: Api, root: string): Promise<void> {
  const controller = api.controller;
  controller.setSpeed(20);
  const port = Number(process.env.AI_PAIR_CDP_PORT);
  assert.ok(Number.isInteger(port) && port > 0, 'AI_PAIR_CDP_PORT is not set');
  function file(name: string): string {
    return path.join(root, name);
  }
  const settings = vscode.workspace.getConfiguration('aiPair');

  // The view shown, its page loads and says it is ready: the panel replays the log and asks whether a session can
  // start (panel.ts, `ready`; specs/Start.tla, `LoadPage`).
  await vscode.commands.executeCommand('aiPair.narration.focus');
  const page = await PanelPage.locate(port);
  await sleep(SETTLE_MS);

  // Idle: the hidden Start button, clicked, starts nothing without a CLI (panel.ts, `start`; setup.ts, `start`);
  // the intro's command link runs its command, whose picker is closed; a command the intro has no link to is not run.
  await page.clickUi('start');
  const settingUp = page.click('a.command[data-command="aiPair.setUpAgent"]');
  await sleep(1000);
  await vscode.commands.executeCommand('quickInput.hide');
  await settingUp;

  // In a session: Pause and Resume, a draft typed and cleared, a reply with the selection attached and the link to it,
  // Interrupt, the turn taken and handed back with a message, and End (panel.ts, `receive`).
  fs.writeFileSync(file('page.txt'), 'one\ntwo\nthree\n');
  const doc = await vscode.workspace.openTextDocument(file('page.txt'));
  await controller.start('page');
  await controller.read('page.txt');
  await page.clickUi('pause');
  assert.equal(controller.isPaused, true, 'Pause did not pause');
  await page.clickUi('pause');
  assert.equal(controller.isPaused, false, 'Resume did not resume');
  await page.type('a draft');
  assert.equal(controller.isPaused, true, 'a draft did not pause');
  await page.type('');
  assert.equal(controller.isPaused, false, 'an empty draft did not resume');
  await vscode.window.showTextDocument(doc, { selection: new vscode.Range(1, 0, 2, 0) });
  await sleep(SETTLE_MS);
  let listening = controller.listen();
  await page.type('About this.');
  await page.enter();
  let report = await listening;
  assert.deepEqual(report.events[0], {
    kind: 'message',
    text: 'About this.',
    selection: { file: file('page.txt'), from: { line: 2, column: 1 }, to: { line: 3, column: 1 }, text: 'two\n' },
  });
  await page.click('a.ref');
  await sleep(SETTLE_MS);
  assert.equal(vscode.window.activeTextEditor?.document.uri.fsPath, file('page.txt'));
  assert.equal(vscode.window.activeTextEditor?.selection.start.line, 1);
  await controller.step([{ move: { file: 'page.txt', line: 1, to: 'line_end' } }, { type: `${'x'.repeat(40)}${CURSOR_MARKER}` }]);
  await sleep(1500);
  await page.clickUi('interrupt');
  report = await controller.step([]);
  assert.equal(report.batches[0]?.status, 'interrupted', JSON.stringify(report));
  listening = controller.listen();
  await page.clickUi('turn');
  report = await listening;
  assert.deepEqual(report.events, [{ kind: 'turn', to: 'user' }]);
  listening = controller.listen();
  await page.type('Your turn.');
  await page.clickUi('turn');
  report = await listening;
  assert.deepEqual(report.events, [{ kind: 'turn', to: 'agent', message: 'Your turn.' }]);
  listening = controller.listen();
  await page.clickUi('end');
  report = await listening;
  assert.deepEqual(report.events, [{ kind: 'end' }]);

  // A run awaiting the programmer's decision: skipped, run, and run with the command remembered (panel.ts,
  // `runDecision`; specs/RunBox.tla).
  controller.setConfirmCommands(true);
  await controller.start('runs');
  async function decided(button: string): Promise<Report> {
    await controller.step([{ run: 'true' }]);
    await sleep(1500);
    await page.clickUi(button);
    let collected = await controller.step([]);
    while (collected.batches.length === 0) {
      collected = await controller.step([]);
    }
    return collected;
  }
  assert.equal((await decided('run-skip')).batches[0]?.status, 'failed');
  assert.equal((await decided('run-go')).batches[0]?.status, 'completed');
  assert.equal((await decided('run-always')).batches[0]?.status, 'completed');
  await controller.step([{ run: 'true' }]);
  let remembered = await controller.step([]);
  while (remembered.batches.length === 0) {
    remembered = await controller.step([]);
  }
  assert.equal(remembered.batches[0]?.status, 'completed', 'the remembered command asked again');
  controller.setConfirmCommands(false);

  // Links in what the agent says: a file by its path, one by its name, one of several of a name, and one not there
  // (panel.ts, `openFile` and `openByName`); a file changed outside the editor (panel.ts, `openChange`).
  fs.mkdirSync(file('a/b'), { recursive: true });
  fs.writeFileSync(file('a/same.txt'), 'a\n');
  fs.writeFileSync(file('a/b/same.txt'), 'b\n');
  fs.writeFileSync(file('a/only.txt'), 'only\n');
  await controller.step([{ say: 'See `page.txt`, `only.txt`, `same.txt`, and `nowhere.txt`.' }]);
  await controller.step([]);
  await page.click('a.file[data-file="page.txt"]');
  assert.equal(vscode.window.activeTextEditor?.document.uri.fsPath, file('page.txt'));
  await page.click('a.file[data-file="only.txt"]');
  await sleep(1000);
  assert.equal(vscode.window.activeTextEditor?.document.uri.fsPath, file('a/only.txt'));
  const picking = page.click('a.file[data-file="same.txt"]');
  await sleep(1500);
  await vscode.commands.executeCommand('quickInput.accept');
  await picking;
  await sleep(1000);
  assert.equal(path.basename(vscode.window.activeTextEditor?.document.uri.fsPath ?? ''), 'same.txt');
  const hiding = page.click('a.file[data-file="same.txt"]');
  await sleep(1500);
  await vscode.commands.executeCommand('quickInput.hide');
  await hiding;
  await page.click('a.file[data-file="nowhere.txt"]');
  fs.writeFileSync(file('page.txt'), 'changed outside\n');
  for (let i = 0; i < 40 && !api.outside.isMarked(file('page.txt')); i++) {
    await sleep(POLL_MS);
  }
  await sleep(2500);
  await page.click('a.change');
  await sleep(1000);
  assert.equal(vscode.window.activeTextEditor?.document.uri.fsPath, file('page.txt'));
  await controller.end();

  // Edits across lines, each way a line keeps or loses its identity (lines.ts, `applyChange`); a document with a path
  // shorter than the workspace's (paths.ts, `withinFolder`); and a scroll where the editor stops at the last line
  // (view.ts, `landing`).
  fs.writeFileSync(file('lines.txt'), 'one\ntwo\nthree\nfour\n');
  const linesDoc = await vscode.workspace.openTextDocument(file('lines.txt'));
  await controller.start('lines');
  await controller.read('lines.txt');
  const edits: Array<[vscode.Range, string]> = [
    [new vscode.Range(0, 1, 1, 2), ''],
    [new vscode.Range(0, 1, 0, 1), '\n'],
    [new vscode.Range(1, 0, 2, 2), 'X'],
    [new vscode.Range(0, 1, 1, 1), 'A\nB'],
  ];
  for (const [range, text] of edits) {
    const edit = new vscode.WorkspaceEdit();
    edit.replace(linesDoc.uri, range, text);
    assert.ok(await vscode.workspace.applyEdit(edit), 'the edit was not applied');
    await sleep(SETTLE_MS);
  }
  const short = path.join('/tmp', `ai-pair-short-${process.pid}.txt`);
  fs.writeFileSync(short, 'short\n');
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(short));
  fs.rmSync(short);
  await vscode.workspace.getConfiguration('editor').update('scrollBeyondLastLine', false, vscode.ConfigurationTarget.Global);
  fs.writeFileSync(file('long.txt'), 'line\n'.repeat(100));
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file('long.txt')));
  await controller.read('long.txt', 90, 95);
  await controller.step([{ move: { file: 'long.txt', line: 92, to: 'line_end' } }, { type: ` end${CURSOR_MARKER}` }]);
  let scrolled = await controller.step([]);
  while (scrolled.batches.length === 0) {
    scrolled = await controller.step([]);
  }
  assert.equal(scrolled.batches[0]?.status, 'completed', JSON.stringify(scrolled));
  await vscode.workspace.getConfiguration('editor').update('scrollBeyondLastLine', undefined, vscode.ConfigurationTarget.Global);
  await controller.end();

  // The speed menus pick a speed, written to the settings (panel.ts, `speed` and `readingSpeed`).
  await page.clickUi('speed');
  await page.click(`[data-ui="speed-menu"] button[data-speed="${MENU_SPEED}"]`);
  await page.clickUi('reading-speed');
  await page.click(`[data-ui="reading-menu"] button[data-speed="${MENU_READING_SPEED}"]`);
  await sleep(SETTLE_MS);
  assert.equal(settings.get('speed'), MENU_SPEED);
  assert.equal(settings.get('readingSpeed'), MENU_READING_SPEED);
  await settings.update('speed', undefined, vscode.ConfigurationTarget.Global);
  await settings.update('readingSpeed', undefined, vscode.ConfigurationTarget.Global);

  // The calibration, in the panel: armed by the command, go shows the passage and starts the clock, x stops it and
  // stores the rate; armed again, any other reply cancels it (calibration.ts; specs/Calibration.tla).
  await vscode.commands.executeCommand('aiPair.calibrate');
  await sleep(SETTLE_MS);
  await page.type('go');
  await page.enter();
  assert.notEqual(await page.text('passage-text'), '', 'the passage did not show');
  await sleep(1000);
  await page.type('x');
  await page.enter();
  for (let i = 0; i < 40 && !(await page.text('now-text')).includes('words a minute'); i++) {
    await sleep(POLL_MS);
  }
  const timing: unknown = settings.get('timing');
  assert.ok(isRecord(timing) && isRecord(timing.reading) && typeof timing.reading.msPerChar === 'number', JSON.stringify(timing));
  await vscode.commands.executeCommand('aiPair.calibrate');
  await sleep(SETTLE_MS);
  await page.type('never mind');
  await page.enter();
  await sleep(SETTLE_MS);
  await vscode.commands.executeCommand('aiPair.calibrate');
  await sleep(SETTLE_MS);
  await page.type('go');
  await page.enter();
  await page.type('stop');
  await page.enter();
  await sleep(SETTLE_MS);
  await settings.update('timing', undefined, vscode.ConfigurationTarget.Global);

  page.close();
  fs.rmSync(file('a'), { recursive: true });
  mark("the page's clicks and keys reached the extension, and the calibration ran in the panel");
}
