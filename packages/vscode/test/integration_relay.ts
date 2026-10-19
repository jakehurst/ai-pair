// The relay's rendering in a real run, for test/integration.ts: every part of a report and of a file as the agent
// reads it, through the MCP client a harness uses (#176). Each case is one a real agent or programmer can bring
// about; the run reaches it so the code that renders it stays.

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as vscode from 'vscode';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { CURSOR_MARKER } from '@ai-pair/protocol';
import { TEST_TIMEOUTS, type SharedSelection } from '@ai-pair/core';
import { MAX_DIFF_LINES } from '../../core/src/diff';
import { MAX_GUIDE } from '../../relay/src/guide';
import { MAX_ANSWERED } from '../../relay/src/server';
import { MAX_OUTPUT } from '../src/output';
import type { Api } from '../src/extension';
import { mark } from './integration_clock';

/** The text of the file the cases act in: `alpha` twice on line 1, `gamma` on line 2 only. */
const RENDERED = 'alpha beta alpha\ngamma\ndelta\n';

/** Past a call's `maxBlockMs`, after which it comes back saying nothing happened. */
const BLOCK_MS = TEST_TIMEOUTS.maxBlockMs;
/** Short of a timer, so it has not fired. */
const SLACK_MS = 300;

/** How long a run left in the background keeps running, in seconds, and how long the agent waits for it. */
const BACKGROUND_S = 3;
const BACKGROUND_WAIT_S = 1;

/** A run long enough that an empty step times out on it, in seconds, and the wait that outlasts it. */
const LONG_RUN_S = Math.ceil(BLOCK_MS / 1000) + 2;
const LONG_RUN_WAIT_S = LONG_RUN_S + 5;

/** More output than a run reports, counting the slack the terminal keeps while reading. */
const FLOOD_BYTES = MAX_OUTPUT * 5;

/** The speed of a batch that must still be playing when the programmer acts, and how far into it they act. */
const SPEED_SLOW = 4;
const INTO_BATCH_MS = 400;
const LONG_TYPE = 'x'.repeat(200);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Returns the text parts of a tool's result, joined. */
function textOf(result: Awaited<ReturnType<Client['callTool']>>): string {
  // The relay answers with text parts only.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return (result.content as Array<{ text: string }>).map((part) => part.text).join('\n\n');
}

/** Applies an edit as the programmer's: a workspace edit, which VS Code attributes to no one. */
async function programmerEdit(build: (edit: vscode.WorkspaceEdit) => void): Promise<void> {
  const edit = new vscode.WorkspaceEdit();
  build(edit);
  assert.ok(await vscode.workspace.applyEdit(edit), 'the edit was not applied');
}

/** Plays the relay's paths: see the file comment. `env` is the harness's environment for the relay. */
export async function relayPaths(api: Api, root: string, env: Record<string, string>): Promise<void> {
  const controller = api.controller;
  controller.setSpeed(20);
  controller.setConfirmCommands(false);
  function file(name: string): string {
    return path.join(root, name);
  }

  // A harness that lists its roots, started from `/`: the roots say where the project is (server.ts, `roots`).
  const agent = new Client({ name: 'integration', version: '0' }, { capabilities: { roots: {} } });
  agent.setRequestHandler(ListRootsRequestSchema, () => ({ roots: [{ uri: pathToFileURL(root).href, name: 'project' }] }));
  await agent.connect(new StdioClientTransport({ command: api.launcher, cwd: '/', env }));
  mark('relay: connected');
  /** The last step's report, which may already carry the batch it submitted, when that finished within the call. */
  let lastStep: string | undefined;
  async function tool(name: string, args: Record<string, unknown> = {}): Promise<string> {
    const result = await agent.callTool({ name, arguments: args });
    const text = textOf(result);
    assert.ok(result.isError !== true, `${name} failed: ${text}`);
    if (name === 'step') lastStep = text;
    return text;
  }
  /** Returns the first report, the last step's or a later empty step's, in which a batch has finished. */
  async function finished(): Promise<string> {
    for (;;) {
      const text = lastStep ?? (await tool('step', { actions: [] }));
      lastStep = undefined;
      assert.notEqual(text, 'Nothing to report.', 'no batch is queued to finish');
      if (/Batch \d+ (completed|failed|interrupted|discarded)/.test(text)) return text;
    }
  }

  // The start prompt, with a task and without.
  const prompted = await agent.getPrompt({ name: 'start', arguments: { task: 'render it all' } });
  assert.match(JSON.stringify(prompted.messages), /The task: render it all/);
  assert.match(JSON.stringify((await agent.getPrompt({ name: 'start' })).messages), /Ask me what we're working on/);
  mark('relay: prompts');

  // The guides: the user's, longer than the agent is shown, is cut with a note; a project guide that is a folder,
  // and one that is empty, are left out (guide.ts, `readGuides`).
  const home = process.env.AI_PAIR_HOME;
  assert.ok(home !== undefined, 'AI_PAIR_HOME is not set');
  fs.mkdirSync(home, { recursive: true });
  const longGuide = `Long guide.\n${'x'.repeat(MAX_GUIDE)}\n`;
  fs.writeFileSync(path.join(home, 'GUIDE.md'), longGuide);
  fs.mkdirSync(file('deep/.ai-pair/GUIDE.md'), { recursive: true });
  fs.mkdirSync(file('.ai-pair'), { recursive: true });
  fs.writeFileSync(file('.ai-pair/GUIDE.md'), ' \n');
  const started = await tool('start', { task: 'render', cwd: file('deep') });
  mark('relay: started in deep');
  assert.match(
    started,
    new RegExp(`Long guide\\.[\\s\\S]*\\[Cut: the file goes on for ${longGuide.length - MAX_GUIDE} more characters\\.\\]`),
  );
  assert.doesNotMatch(started, /deep/);
  await tool('end');
  fs.rmSync(file('deep'), { recursive: true });
  fs.rmSync(path.join(home, 'GUIDE.md'));
  // From here on, paths are the workspace's: the roots' folder.
  await tool('start', { task: 'render' });
  mark('relay: guides, started in the root');

  // A file with unsaved changes, and a range with no lines in it (render.ts, `renderFile`).
  fs.writeFileSync(file('render.txt'), RENDERED);
  const doc = await vscode.workspace.openTextDocument(file('render.txt'));
  await programmerEdit((edit) => {
    edit.insert(doc.uri, new vscode.Position(2, 0), 'd');
  });
  assert.match(
    await tool('read', { file: 'render.txt' }),
    /^render\.txt \(with unsaved changes in the editor\):\n1  alpha beta alpha\n2  gamma\n3  ddelta\n   \(end of file\)$/,
  );
  assert.ok(await doc.save());
  await programmerEdit((edit) => {
    edit.delete(doc.uri, new vscode.Range(2, 0, 2, 1));
  });
  assert.ok(await doc.save());
  assert.equal(await tool('read', { file: 'render.txt', from_line: 3, to_line: 2 }), 'render.txt: no lines in this range.');
  mark('relay: reads');
  // Both edits were the programmer's, and merged into one, they change nothing (render.ts, `renderEvent`).
  assert.match(await tool('step', { actions: [] }), /The programmer edited render\.txt, then changed it back: no net change\./);

  // Runs: output with backticks of its own gets a longer fence; none says so; a flood shows its end; one left running
  // says so; a failing one stops the batch with the rest not played (render.ts, `renderRun` and `renderBatch`).
  await tool('step', { actions: [{ run: "echo 'a```b'" }] });
  assert.match(await finished(), /Ran `echo 'a```b'`( in \w+)?: exited with 0\. Output:\n````\na```b\n````/);
  mark('relay: a run with a fence');
  await tool('step', { actions: [{ run: 'true' }] });
  assert.match(await finished(), /Ran `true`( in \w+)?: exited with 0, no output\./);
  mark('relay: a run with no output');
  await tool('step', { actions: [{ run: `yes | head -c ${FLOOD_BYTES}` }] });
  const flooded = await finished();
  // The tail is cut where the limit falls, which may be mid-line.
  assert.match(flooded, /exited with 0\. Output, its end:\n```\n\n?(y\n)+```/);
  assert.ok(flooded.length < FLOOD_BYTES, `the output was not cut: ${flooded.length}`);
  mark('relay: a flood');
  await tool('step', { actions: [{ run: `sleep ${BACKGROUND_S}`, wait: BACKGROUND_WAIT_S }] });
  assert.match(await finished(), /Ran `sleep 3`( in \w+)?: still running in its terminal, no output\./);
  await sleep(BACKGROUND_S * 1000);
  mark('relay: a run left running');
  await tool('step', { actions: [{ run: 'false' }, { say: 'Not said.' }] });
  const failedRun = await finished();
  assert.match(failedRun, /Batch \d+ failed\.\nRan `false`( in \w+)?: exited with 1, no output\.\ncommand_failed: /);
  assert.match(failedRun, /Not played:\n {2}\{"say":"Not said\."\}/);
  // A spot not on its line, and one twice on it: the rehearsal refuses the batch, with where the spot is
  // (render.ts, `renderRejected` and `renderError`).
  const notFound = await tool('step', {
    actions: [{ move: { file: 'render.txt', line: 1, at: `gam${CURSOR_MARKER}ma` } }, { say: 'Not said.' }],
  });
  assert.match(
    notFound,
    /Your batch was rejected: its action 1 would fail:[\s\S]*not_found: The spot isn't on line 1: line 1 reads "alpha beta alpha"\. It's on these lines:\n {2}line 2: gamma/,
  );
  const ambiguous = await tool('step', { actions: [{ move: { file: 'render.txt', line: 1, at: `alph${CURSOR_MARKER}a` } }] });
  assert.match(ambiguous, /ambiguous: "alpha" occurs 2 times on line 1/);
  mark('relay: runs and refusals');

  // A batch rejected past an edit says what the code would read by then (render.ts, `renderRejected`).
  const rejected = await agent.callTool({
    name: 'step',
    arguments: {
      actions: [
        { move: { file: 'render.txt', line: 2, to: 'line_end' } },
        { type: ` epsilon${CURSOR_MARKER}` },
        { move: { file: 'render.txt', line: 99, to: 'line_end' } },
      ],
    },
  });
  assert.match(
    textOf(rejected),
    /Your batch was rejected: its action 3 would fail:[\s\S]*no_line: [\s\S]*The code would read then, in render\.txt:\n[\s\S]*2  gamma epsilon/,
  );

  // What the programmer does, as the agent reads it: a message with the code they had selected, cut off; an edit
  // too big to show; an interrupt; the turn taken and handed back, with and without a
  // message (render.ts, `renderEvent` and `renderExcerpt`).
  const selection: SharedSelection = {
    file: file('render.txt'),
    from: { line: 1, column: 1 },
    to: { line: 2, column: 3 },
    text: 'alpha beta alpha\nga',
    truncated: true,
  };
  controller.userMessage('What is this?', selection);
  const said = await tool('listen');
  assert.match(
    said,
    /The programmer said:\n> What is this\?\nAbout the code they had selected, .*render\.txt lines 1.2:\n1  alpha beta alpha\n2  ga\n\(cut off here; `read` the rest\)/,
  );
  await programmerEdit((edit) => {
    edit.insert(doc.uri, new vscode.Position(3, 0), 'z\n'.repeat(MAX_DIFF_LINES));
  });
  const changed = await tool('listen');
  // The diff's context lines count among those left out, and the hunk's bounds take them in.
  assert.match(
    changed,
    /The programmer changed render\.txt in these places, too much to show \(\d+ lines of diff left out\)\. `read` the file for its text:\n@@ -\d+,\d+ \+\d+,\d+ @@/,
  );
  await programmerEdit((edit) => {
    edit.delete(doc.uri, new vscode.Range(3, 0, 3 + MAX_DIFF_LINES, 0));
  });
  assert.ok(await doc.save());
  await tool('listen');
  controller.setSpeed(SPEED_SLOW);
  await tool('step', {
    actions: [{ move: { file: 'render.txt', line: 1, to: 'line_end' } }, { type: `${LONG_TYPE}${CURSOR_MARKER}` }],
  });
  await sleep(INTO_BATCH_MS);
  controller.userInterrupt();
  assert.match(await finished(), /The programmer pressed Interrupt\.\n\nBatch \d+ interrupted/);
  controller.setSpeed(20);
  controller.takeTurn();
  const taken = await tool('listen');
  assert.match(taken, /The programmer took the turn\.[\s\S]*It's the programmer's turn: you're the navigator\./);
  controller.handBack('Your go.', { file: selection.file, from: selection.from, to: { line: 1, column: 6 }, text: 'alpha' });
  assert.match(
    await tool('listen'),
    /The programmer handed the turn back to you:\n> Your go\.\nAbout the code they had selected, .*render\.txt line 1:\n1  alpha/,
  );
  controller.takeTurn();
  await tool('listen');
  controller.handBack();
  assert.match(await tool('listen'), /The programmer handed the turn back to you\./);
  mark('relay: events');

  // Pauses, by their reasons: the programmer's, looking away, and a calibration (render.ts, `PAUSE_REASONS`).
  controller.pause();
  assert.match(
    await tool('step', { actions: [] }),
    /Playback is paused: the programmer pressed Pause\. Your batches wait until the programmer resumes\./,
  );
  controller.resume();
  fs.writeFileSync(file('elsewhere.txt'), 'other\n');
  controller.setSpeed(SPEED_SLOW);
  await tool('step', {
    actions: [{ move: { file: 'render.txt', line: 3, to: 'line_end' } }, { type: `${LONG_TYPE}${CURSOR_MARKER}` }],
  });
  await sleep(INTO_BATCH_MS);
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file('elsewhere.txt')));
  await sleep(INTO_BATCH_MS);
  assert.match(
    await tool('step', { actions: [] }),
    /Playback is paused: the programmer is looking at another file, or scrolled away from your cursor\./,
  );
  controller.setSpeed(20);
  controller.resume();
  await finished();
  fs.writeFileSync(file('passage.txt'), 'A passage to read at an even pace.\n');
  assert.match(
    await tool('calibrate', { title: 'The passage', file: 'passage.txt', notice: 'Made up here.' }),
    /^The calibration is under way in the Pair panel/,
  );
  assert.match(await tool('step', { actions: [] }), /Playback is paused: the programmer is calibrating their reading speed\./);
  controller.endSession();
  assert.match(await tool('listen'), /The programmer ended the session\. This is the final report: stop using the pair tools\./);
  mark('relay: pauses and the calibration');

  // Nothing happening in a call's time: a listen says to call again, a step that nothing finished says to carry on.
  await tool('start', { task: 'waiting' });
  const idle = Date.now();
  assert.match(await tool('listen'), /Nothing has happened yet\. Call `listen` again\./);
  assert.ok(Date.now() - idle >= BLOCK_MS - SLACK_MS, 'the listen came back early');
  await tool('step', { actions: [{ run: `sleep ${LONG_RUN_S}`, wait: LONG_RUN_WAIT_S }] });
  assert.match(await tool('step', { actions: [] }), /Nothing has finished yet\. Carry on as usual\./);
  await finished();
  // More answers than the relay keeps for a cancel that comes late (server.ts, `MAX_ANSWERED`).
  for (let i = 0; i <= MAX_ANSWERED; i++) {
    await tool('step', { actions: [] });
  }
  await tool('end', { summary: 'Rendered.' });
  await agent.close();
  controller.setConfirmCommands(true);
  fs.rmSync(file('elsewhere.txt'));
  fs.rmSync(file('passage.txt'));
  mark('the relay rendered every part of a report and a file');
}
