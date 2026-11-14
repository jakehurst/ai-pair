// Exercises shortcut commands against the real workspace Controller and panel.
import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import type { Api } from '../src/extension';

/** Checks the command routes with a live session and after it ends. */
export async function shortcutCommandPaths(api: Api): Promise<void> {
  const { controller } = api;
  controller.endSession();
  await vscode.commands.executeCommand('aiPair.togglePause');
  await vscode.commands.executeCommand('aiPair.toggleAttention');
  await vscode.commands.executeCommand('aiPair.focusReply');
  assert.equal(controller.isActive, false);
  assert.equal(controller.isPaused, false);
  await controller.start('shortcut controls');
  try {
    await vscode.commands.executeCommand('aiPair.togglePause');
    assert.equal(controller.isPaused, true);
    await vscode.commands.executeCommand('aiPair.togglePause');
    assert.equal(controller.isPaused, false);
    await vscode.commands.executeCommand('aiPair.toggleAttention');
    for (let i = 0; i < 100 && !controller.isAttentionGranted; i++) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 20);
      });
    }
    assert.equal(controller.isAttentionGranted, true, 'the hand was not granted');
    await vscode.commands.executeCommand('aiPair.toggleAttention');
    assert.equal(controller.isAttentionGranted, true, 'focusing reply released the hand');
    await vscode.commands.executeCommand('aiPair.focusReply');
    assert.equal(controller.isAttentionGranted, true, 'reply focus released the hand');
    controller.resume();
    await controller.end();
    console.log('PairShortcuts: native commands use the active Controller and preserve a granted hand');
  } finally {
    controller.endSession();
  }
}
