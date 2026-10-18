// A launch with no folder open, and a home folder the launcher can't be written in: the extension activates in the
// home folder, the demo is refused, and agents are told the launcher is missing (#176; extension.ts, `activate`;
// setup.ts, `writeLauncher`). scripts/integration.sh runs this third, with AI_PAIR_HOME set to a file.

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as vscode from 'vscode';
import type { Api } from '../src/extension';

function isApi(v: unknown): v is Api {
  return typeof v === 'object' && v !== null && 'controller' in v && 'launcher' in v;
}

export async function run(): Promise<void> {
  const ext = vscode.extensions.getExtension('michalstrba.ai-pair');
  assert.ok(ext, 'extension not found');
  const exported: unknown = await ext.activate();
  assert.ok(isApi(exported), 'the extension exported something other than its Api');
  const api = exported;
  assert.equal(vscode.workspace.workspaceFolders, undefined, 'a folder is open');
  assert.equal(fs.existsSync(api.launcher), false, 'the launcher was written under a file');
  await vscode.commands.executeCommand('aiPair.playDemo');
  assert.equal(api.controller.isActive, false, 'the demo ran with no folder');
  await api.ready;
  console.log('no folder: the demo was refused, and the launcher reported missing');
}
