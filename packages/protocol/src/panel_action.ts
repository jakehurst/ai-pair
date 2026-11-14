import { z } from 'zod';
import { NAVIGATOR_COMMENTARY_SCHEMA } from './schemas';

/** Largest text carried by one cross-host panel action. */
const MAX_PANEL_TEXT = 65_536;
/** Largest file or URL field carried by one cross-host panel action. */
const MAX_PANEL_REFERENCE = 4096;
/** Largest configured playback speed. */
const MAX_PANEL_SPEED = 4;

const text = z.string().max(MAX_PANEL_TEXT);
const reference = z.string().min(1).max(MAX_PANEL_REFERENCE);
const id = z.int().positive();
const speed = z.number().positive().max(MAX_PANEL_SPEED);

/** Validates the fixed workspace-action subset of webview messages. */
export const localPanelAction = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('ready') }),
  z.strictObject({ type: z.literal('pageClosed') }),
  z.strictObject({ type: z.literal('copyDiagnostics') }),
  z.strictObject({ type: z.literal('reply'), text, attach: z.boolean().optional(), defer: z.boolean().optional() }),
  z.strictObject({ type: z.literal('draft'), empty: z.boolean() }),
  z.strictObject({ type: z.literal('attention') }),
  z.strictObject({ type: z.literal('pause') }),
  z.strictObject({ type: z.literal('revealCursor') }),
  z.strictObject({ type: z.literal('resume') }),
  z.strictObject({ type: z.literal('interrupt') }),
  z.strictObject({ type: z.literal('turn'), message: text.optional(), attach: z.boolean().optional() }),
  z.strictObject({ type: z.literal('end') }),
  z.strictObject({ type: z.literal('holdReading'), id, held: z.boolean() }),
  z.strictObject({ type: z.literal('skipReading'), id }),
  z.strictObject({ type: z.literal('open'), file: reference, line: id }),
  z.strictObject({ type: z.literal('openFile'), file: reference }),
  z.strictObject({ type: z.literal('openChange'), file: reference }),
  z.strictObject({ type: z.literal('openUrl'), url: reference }),
  z.strictObject({ type: z.literal('command'), command: z.enum(['aiPair.playDemo', 'aiPair.setUpAgent', 'aiPair.configureShortcuts']) }),
  z.strictObject({ type: z.literal('start') }),
  z.strictObject({ type: z.literal('replyBehavior'), value: z.enum(['interrupt', 'finishAction']) }),
  z.strictObject({ type: z.literal('navigatorCommentary'), value: NAVIGATOR_COMMENTARY_SCHEMA }),
  z.strictObject({ type: z.literal('chatOrder'), value: z.enum(['newestFirst', 'oldestFirst']) }),
  z.strictObject({ type: z.literal('showTerminals'), value: z.boolean() }),
  z.strictObject({ type: z.literal('commandApprovalSound'), value: z.boolean() }),
  z.strictObject({ type: z.literal('revokeCommandApprovals') }),
  z.strictObject({ type: z.literal('showTerminal'), id }),
  z.strictObject({ type: z.literal('speed'), value: speed }),
  z.strictObject({ type: z.literal('readingSpeed'), value: speed }),
  z.strictObject({ type: z.literal('codePlayback'), value: z.enum(['typing', 'lines', 'blocks']) }),
  z.strictObject({
    type: z.literal('runDecision'),
    id,
    run: z.boolean(),
    scope: z.enum(['once', 'command', 'all']).optional(),
    remember: z.boolean().optional(),
  }),
]);

/** A validated webview action that may be forwarded to the workspace extension. */
export type LocalPanelAction = z.infer<typeof localPanelAction>;
