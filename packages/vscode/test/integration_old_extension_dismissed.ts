// Dismissing the old-AI-Pair warning leaves the old extension installed (#78).
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as vscode from 'vscode';
import type { Api } from '../src/extension';
import { OLD_EXTENSION_ID, OLD_EXTENSION_WARNING } from '../src/old_extension';
import { clickNotificationButton, expectNotification } from './integration_notification';

/** VS Code's accessible name for a notification's close action. */
const CLEAR = 'Clear Notification';
const SETTLE_MS = 1000;

/** Shows the warning for an installed old AI Pair, dismisses it, and checks nothing was uninstalled. */
export async function run(): Promise<void> {
  const old = vscode.extensions.getExtension(OLD_EXTENSION_ID);
  const main = vscode.extensions.getExtension<Api>('mattyv.ai-pair');
  assert.ok(old && main, 'the old AI Pair fixture and this extension must be installed');
  const api = await main.activate();
  await api.ready;
  await expectNotification(OLD_EXTENSION_WARNING);
  await clickNotificationButton(CLEAR);
  await new Promise<void>((resolve) => {
    setTimeout(resolve, SETTLE_MS);
  });
  assert.ok(fs.existsSync(old.extensionPath), 'dismissing the warning uninstalled the old AI Pair');
  api.controller.endSession();
  console.log('dismissing the old AI Pair warning left it installed');
}
