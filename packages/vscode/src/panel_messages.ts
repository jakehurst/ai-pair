// The messages between the narration panel's page (webview/panel.ts) and the extension (panel.ts).

import type { CodePlayback, PanelEvent, Ref } from '@ai-pair/core';
import type { CalibrationView } from './calibration';
import type { SpeechSettings } from './speech_types';
import type { SpeechComputeMode, SpeechComputeState } from './speech_compute_types';
import type { SpeechModelStatus } from './speech_setup';
import type { CatalogView } from './speech_catalog';
import type { OpenRouterCatalogView } from './speech_openrouter_catalog';
import type { OutputChoice } from './speech_output_types';
import type { AudioDiagnostics, SpeechDecodeFromPage, NavigatorCommentary } from '@ai-pair/protocol';
import type { OutputPreferenceView } from './speech_output_preferences';
import type { SessionSpeechCostView } from './session_speech_cost';

export type SpeechState = 'preparing' | 'speaking' | 'paused' | 'unavailable' | 'idle';
export type SpeechEvent = 'started' | 'ended' | 'failed';
export type SpeechAction = 'pause' | 'resume' | 'stop';

/** The order of the panel history. */
export type ChatOrder = 'newestFirst' | 'oldestFirst';

/** Messages from the page. */
export type FromPanel =
  | SpeechDecodeFromPage
  | { type: 'ready' }
  | { type: 'copyDiagnostics' }
  | { type: 'speechOutputRefresh' }
  | { type: 'speechOutputSelect'; choice: OutputChoice }
  | { type: 'speechSettings'; value: SpeechSettings }
  | { type: 'speechSetup' | 'speechPreview' | 'speechStop' | 'checkGpuSetup' }
  | { type: 'speechComputeMode'; value: SpeechComputeMode }
  | {
      type:
        | 'speechKeySet'
        | 'speechKeyRemove'
        | 'speechVoicesLoad'
        | 'speechVoicesMore'
        | 'openRouterKeySet'
        | 'openRouterKeyRemove'
        | 'openRouterModelsLoad';
    }
  | { type: 'speechPageHidden' | 'speechPageVisible'; pageId: number }
  | { type: 'speechRetired'; id: number; pageId: number }
  | { type: 'speechEvent'; id: number; pageId: number; event: SpeechEvent }
  | { type: 'skipReading'; id: number }
  | { type: 'holdReading'; id: number; held: boolean }
  | { type: 'reply'; text: string; attach?: boolean; defer?: boolean }
  | { type: 'draft'; empty: boolean }
  | { type: 'pause' }
  | { type: 'revealCursor' }
  | { type: 'attention' }
  | { type: 'resume' }
  | { type: 'interrupt' }
  | { type: 'turn'; message?: string; attach?: boolean }
  | { type: 'end' }
  | { type: 'open'; file: string; line: number }
  /** A file named in a message: a path, or just its name. */
  | { type: 'openFile'; file: string }
  | { type: 'openUrl'; url: string }
  /** A file changed outside the protocol: its diff, or the file outside git (#15). */
  | { type: 'openChange'; file: string }
  /** A command the intro offers, like Set Up Agent. */
  | { type: 'command'; command: string }
  /** The Start a session button: Claude Code's CLI starts with the prompt in a hidden terminal (#107, #115). */
  | { type: 'start' }
  | { type: 'replyBehavior'; value: 'interrupt' | 'finishAction' }
  | { type: 'navigatorCommentary'; value: NavigatorCommentary }
  | { type: 'chatOrder'; value: ChatOrder }
  | { type: 'showTerminals'; value: boolean }
  | { type: 'commandApprovalSound'; value: boolean }
  | { type: 'revokeCommandApprovals' }
  | { type: 'showTerminal'; id: number }
  | { type: 'speed'; value: number }
  | { type: 'readingSpeed'; value: number }
  | { type: 'codePlayback'; value: CodePlayback }
  | { type: 'runDecision'; id: number; run: boolean; scope?: 'once' | 'command' | 'all'; remember?: boolean };

/** Messages to the page: the session's events, and the panel's own. */
export type ToPanel =
  | PanelEvent
  /** The log, for a page that just loaded. */
  | { type: 'replay'; events: PanelEvent[]; costSessionGeneration?: number; costSessionActive?: boolean }
  /** The programmer's selection, offered with a reply. */
  | { type: 'selection'; ref: Ref | undefined }
  | { type: 'speechPage'; pageId: number }
  | { type: 'speechReadiness'; value: AudioDiagnostics }
  | { type: 'speechCost'; value: SessionSpeechCostView }
  | { type: 'speechTransport'; available: boolean }
  | { type: 'speechSupport'; supported: boolean; gpu: boolean }
  | { type: 'speechModelStatus'; value: SpeechModelStatus }
  | { type: 'speechModelStatusUnavailable' }
  | { type: 'speechCloudSupport'; supported: boolean }
  | { type: 'speechSettings'; value: SpeechSettings }
  | { type: 'speechComputeState'; value: SpeechComputeState }
  | { type: 'speechOutputCatalog'; value: OutputPreferenceView }
  | { type: 'speechKeyStatus'; hasKey: boolean }
  | { type: 'speechCatalog'; value: CatalogView }
  | { type: 'openRouterKeyStatus'; hasKey: boolean }
  | { type: 'openRouterCatalog'; value: OpenRouterCatalogView }
  | { type: 'speechSetupState'; pending: boolean; message: string }
  | { type: 'speechAudio'; id: number; pageId: number; wavBase64: string; durationMs: number }
  | { type: 'speechControl'; id: number; pageId: number; action: SpeechAction }
  | { type: 'speechStatus'; id: number; pageId: number; state: SpeechState; message?: string }
  | { type: 'focusReply' }
  | { type: 'replyBehavior'; value: 'interrupt' | 'finishAction' }
  | { type: 'navigatorCommentary'; value: NavigatorCommentary }
  | { type: 'chatOrder'; value: ChatOrder }
  | { type: 'showTerminals'; value: boolean }
  | { type: 'commandApprovalSound'; value: boolean }
  | { type: 'commandApprovals'; all: boolean; count: number; confirmationRequired: boolean }
  | { type: 'speed'; value: number }
  | { type: 'readingSpeed'; value: number }
  | { type: 'codePlayback'; value: CodePlayback }
  /** The reading speed calibration's state, for the band (#109). */
  | { type: 'calibration'; view: CalibrationView }
  /** Whether the idle view offers Start a session: Claude Code is set up, its CLI is here, a folder is open (#107). */
  | { type: 'canStart'; value: boolean }
  /** The agent the Start a session button ran has exited, with or without a session: the note goes (#118). */
  | { type: 'startEnded' }
  /** The page's delays (timings.ts), for a test that cannot wait the shipped ones out. */
  | { type: 'timings'; tipDelayMs: number; tipWarmMs: number };
