// The extension warns about the old michalstrba AI Pair beside it and uninstalls it from the warning (#78).
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { Api } from '../src/extension';
import { OLD_EXTENSION_ID, OLD_EXTENSION_UNINSTALL, OLD_EXTENSION_WARNING } from '../src/old_extension';
import { clickNotificationButton, expectNotification } from './integration_notification';

const ATTEMPTS = 100;
const INTERVAL_MS = 100;

/** Reports whether VS Code has removed the extension's folder or marked it obsolete. */
function uninstalled(folder: string): boolean {
  if (!fs.existsSync(folder)) return true;
  const obsolete = path.join(path.dirname(folder), '.obsolete');
  return fs.existsSync(obsolete) && fs.readFileSync(obsolete, 'utf8').includes(path.basename(folder));
}

/** Shows the warning for an installed old AI Pair, then uninstalls it from the warning's button. */
export async function run(): Promise<void> {
  const old = vscode.extensions.getExtension(OLD_EXTENSION_ID);
  const main = vscode.extensions.getExtension<Api>('mattyv.ai-pair');
  assert.ok(old && main, 'the old AI Pair fixture and this extension must be installed');
  const api = await main.activate();
  await api.ready;
  await expectNotification(OLD_EXTENSION_WARNING);
  await clickNotificationButton(OLD_EXTENSION_UNINSTALL);
  for (let attempt = 0; attempt < ATTEMPTS && !uninstalled(old.extensionPath); attempt++) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, INTERVAL_MS);
    });
  }
  assert.ok(uninstalled(old.extensionPath), 'the warning button did not uninstall the old AI Pair');
  api.controller.endSession();
  console.log('the old AI Pair was reported and uninstalled from the warning');
}
