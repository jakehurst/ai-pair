import { describe, expect, it } from 'vitest';
import { localPanelAction } from '../src/panel_action';

describe('cross-host panel actions', () => {
  it('allows only the panel actions used by the workspace controller', () => {
    for (const action of [
      { type: 'ready' },
      { type: 'pageClosed' },
      { type: 'reply', text: 'Hello.', attach: true },
      { type: 'reply', text: 'Wait.', defer: true },
      { type: 'draft', empty: false },
      { type: 'attention' },
      { type: 'pause' },
      { type: 'revealCursor' },
      { type: 'resume' },
      { type: 'interrupt' },
      { type: 'turn', message: 'Done.' },
      { type: 'end' },
      { type: 'holdReading', id: 1, held: true },
      { type: 'skipReading', id: 1 },
      { type: 'open', file: 'src/example.ts', line: 1 },
      { type: 'openFile', file: 'example.ts' },
      { type: 'openChange', file: 'example.ts' },
      { type: 'openUrl', url: 'https://example.com' },
      { type: 'command', command: 'aiPair.playDemo' },
      { type: 'command', command: 'aiPair.configureShortcuts' },
      { type: 'start' },
      { type: 'copyDiagnostics' },
      { type: 'navigatorCommentary', value: 'quiet' },
      { type: 'navigatorCommentary', value: 'helpful' },
      { type: 'navigatorCommentary', value: 'coach' },
      { type: 'replyBehavior', value: 'interrupt' },
      { type: 'replyBehavior', value: 'finishAction' },
      { type: 'chatOrder', value: 'newestFirst' },
      { type: 'showTerminals', value: true },
      { type: 'commandApprovalSound', value: true },
      { type: 'revokeCommandApprovals' },
      { type: 'commandApprovalSound', value: false },
      { type: 'showTerminal', id: 1 },
      { type: 'speed', value: 1 },
      { type: 'readingSpeed', value: 1 },
      { type: 'codePlayback', value: 'typing' },
      { type: 'runDecision', id: 1, run: true, remember: false },
      { type: 'runDecision', id: 1, run: true, remember: true },
      { type: 'runDecision', id: 1, run: true, scope: 'once' },
      { type: 'runDecision', id: 1, run: true, scope: 'command' },
      { type: 'runDecision', id: 1, run: true, scope: 'all' },
    ]) {
      expect(localPanelAction.safeParse(action).success).toBe(true);
    }
  });

  it('rejects speech settings, arbitrary commands, unknown keys, and oversized text', () => {
    for (const action of [
      { type: 'navigatorCommentary', value: 'invalid' },
      { type: 'navigatorCommentary', value: 'coach', extra: true },
      { type: 'replyBehavior', value: 'invalid' },
      { type: 'replyBehavior', value: 'interrupt', extra: true },
      { type: 'commandApprovalSound', value: 'true' },
      { type: 'attention', extra: true },
      { type: 'speechKeySet' },
      { type: 'command', command: 'arbitrary.exec' },
      { type: 'reply', text: 'Hello', secret: 'key' },
      { type: 'reply', text: 'Hello', defer: 'yes' },
      { type: 'reply', text: 'x'.repeat(65_537) },
      { type: 'open', file: 'file', line: -1 },
      { type: 'showTerminal', id: 0 },
      { type: 'runDecision', id: 1, run: 'yes' },
      { type: 'runDecision', id: 1, run: true, scope: 'forever' },
    ]) {
      expect(localPanelAction.safeParse(action).success).toBe(false);
    }
  });
});
