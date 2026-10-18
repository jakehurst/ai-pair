// A second launch of the window test/integration.ts ran in, with the session it left: activation revives it from the
// workspace's storage, suspended, and an agent's `start` in the same folder resumes it (#176; extension.ts, `activate`;
// specs/Resume.tla, `Reload`). scripts/integration.sh runs this after the first launch, in the same user data folder.

import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Api } from '../src/extension';

function isApi(v: unknown): v is Api {
  return typeof v === 'object' && v !== null && 'controller' in v && 'launcher' in v;
}

/** Returns the text parts of a tool's result, joined. */
function textOf(result: Awaited<ReturnType<Client['callTool']>>): string {
  // The relay answers with text parts only.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return (result.content as Array<{ text: string }>).map((part) => part.text).join('\n\n');
}

export async function run(): Promise<void> {
  const ext = vscode.extensions.getExtension('michalstrba.ai-pair');
  assert.ok(ext, 'extension not found');
  const exported: unknown = await ext.activate();
  assert.ok(isApi(exported), 'the extension exported something other than its Api');
  const api = exported;
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, 'no workspace folder is open');
  const root = folder.uri.fsPath;

  // Revived: the session the first launch left, suspended, with the history its panel had.
  const saved = api.saved();
  assert.ok(saved, 'no session was saved by the first launch');
  assert.ok(
    api.history().some((e) => e.type === 'say' && e.text === 'Kept across the reload.'),
    JSON.stringify(api.history()),
  );
  assert.equal(api.controller.isActive, true, 'the revived session is not active');
  await api.ready;

  // The agent comes back: its start resumes the session, and the report says so.
  const agent = new Client({ name: 'integration-reload', version: '0' });
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value;
  }
  await agent.connect(new StdioClientTransport({ command: api.launcher, cwd: root, env }));
  const resumed = textOf(await agent.callTool({ name: 'start', arguments: { task: 'back', cwd: root } }));
  assert.match(resumed, /^The session has resumed: the programmer's window kept it while you were away/);
  await agent.callTool({ name: 'end', arguments: { summary: 'Done after the reload.' } });
  await agent.close();
  assert.equal(api.controller.isActive, false);
  console.log('reload: the session was revived and resumed');
}
