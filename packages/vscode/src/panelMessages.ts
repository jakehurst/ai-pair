// The messages between the narration panel's page (webview/panel.ts) and the extension (panel.ts).

import type { PanelEvent, Ref } from "@ai-pair/core"
import type { CalibrationView } from "./calibration"

/** Messages from the page. */
export type FromPanel =
  | { type: "ready" }
  | { type: "reply"; text: string; attach?: boolean }
  | { type: "draft"; empty: boolean }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "interrupt" }
  | { type: "turn"; message?: string; attach?: boolean }
  | { type: "end" }
  | { type: "open"; file: string; line: number }
  /** A file named in a message: a path, or just its name. */
  | { type: "openFile"; file: string }
  | { type: "openUrl"; url: string }
  /** A file changed outside the protocol: its diff, or the file outside git (#15). */
  | { type: "openChange"; file: string }
  /** A command the intro offers, like Set Up Agent. */
  | { type: "command"; command: string }
  | { type: "speed"; value: number }
  | { type: "readingSpeed"; value: number }
  | { type: "runDecision"; id: number; run: boolean; remember?: boolean }

/** Messages to the page: the session's events, and the panel's own. */
export type ToPanel =
  | PanelEvent
  /** The log, for a page that just loaded. */
  | { type: "replay"; events: PanelEvent[] }
  /** The programmer's selection, offered with a reply. */
  | { type: "selection"; ref: Ref | undefined }
  | { type: "focusReply" }
  | { type: "speed"; value: number }
  | { type: "readingSpeed"; value: number }
  /** The reading speed calibration's state, for the band (#109). */
  | { type: "calibration"; view: CalibrationView }
