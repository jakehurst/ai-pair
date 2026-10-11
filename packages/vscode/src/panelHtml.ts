// The Pair panel's page: its markup. Its styles are webview/panel.css; its script is webview/panel.ts.
// Top to bottom: the band, which holds the header (the status and the controls), the current
// message, and the reply box; then the history, newest first.

import { randomBytes } from "node:crypto"
import { ELLIPSIS, SPEED_SUFFIX } from "@ai-pair/core/constants"

/** Speeds offered in the panel's menu. The `aiPair.speed` setting takes any value in its range. */
export const SPEEDS = [0.4, 0.6, 1, 1.5, 2, 3]

/**
 * The `aiPair.speed` setting as played: clamped to the range it declares (0.25 to 4), or 1 for what
 * isn't a finite number. VS Code only warns about a value out of range in settings.json (#17).
 */
export function settingSpeed(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(4, Math.max(0.25, value)) : 1
}

const svg = (paths: string, cls = "") =>
  `<svg class="i ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`

const ICONS = {
  pause: svg('<path d="M9 5v14M15 5v14"/>', "pause"),
  resume: svg('<path d="M8 5l11 7-11 7z"/>', "resume"),
  stop: svg('<rect x="6" y="6" width="12" height="12" rx="2"/>'),
  swap: svg('<path d="M7 7h11l-3-3M17 17H6l3 3"/>'),
  exit: svg('<path d="M14 4h5v16h-5M10 8l-4 4 4 4M6 12h11"/>'),
  send: svg('<path d="M4 12l16-8-6 16-2.5-6.5z"/>'),
  play: svg('<path d="M8 5l11 7-11 7z"/>'),
}

/** `styleUri` and `scriptUri`: dist/panel.css and dist/panel.js, built from webview/, as the webview loads them. */
export function panelHtml(cspSource: string, styleUri: string, scriptUri: string): string {
  const nonce = randomBytes(16).toString("base64")
  const speeds = SPEEDS.map(
    (s) => `<button role="menuitemradio" aria-checked="false" data-speed="${s}">${s.toFixed(1)}${SPEED_SUFFIX}</button>`,
  ).join("")
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${styleUri}">
</head>
<body>
<div id="app" class="app">
  <section id="band" class="band">
    <div id="main" class="main">
      <div id="head" class="head">
        <div id="status" class="status"><span id="dot" class="dot off"></span><span id="status-text" class="status-text" role="status">No session</span></div>
        <div id="controls" class="controls">
          <button id="pause" class="quiet pause-toggle" aria-label="Pause" data-tip="Pause (Space)" aria-keyshortcuts="Space">${ICONS.pause}${ICONS.resume}</button>
          <button id="interrupt" class="quiet interrupt" aria-label="Interrupt" data-tip="Interrupt">${ICONS.stop}</button>
          <button id="turn" class="quiet" aria-label="My turn" data-tip="Take the turn: you drive, the agent navigates">${ICONS.swap}<span id="turn-label" class="turn-label">My turn</span></button>
          <div id="speed-wrap" class="speed-wrap">
            <button id="speed" class="quiet speed" aria-haspopup="menu" aria-expanded="false" data-tip="Playback speed">1.0${SPEED_SUFFIX}</button>
            <div id="speed-menu" class="speed-menu" role="menu" aria-label="Playback speed" hidden>${speeds}</div>
          </div>
          <div id="reading-wrap" class="speed-wrap">
            <button id="reading-speed" class="quiet speed" aria-haspopup="menu" aria-expanded="false" data-tip="Reading speed: the pause after each message">read 1.0${SPEED_SUFFIX}</button>
            <div id="reading-menu" class="speed-menu" role="menu" aria-label="Reading speed" hidden>${speeds}</div>
          </div>
          <button id="end" class="quiet end" aria-label="End the session" data-tip="End the session">${ICONS.exit}</button>
        </div>
      </div>
      <div id="now" class="now">
        <div id="now-text" class="now-text empty" aria-live="polite"></div>
        <div id="now-ref" class="now-ref"></div>
        <div id="passage" class="passage" hidden><div id="passage-text"></div><div id="passage-notice" class="passage-notice"></div></div>
        <div id="run" class="run-box">
          <div id="run-label" class="run-label"></div>
          <div id="run-cmd" class="run-cmd"></div>
          <div id="run-actions" class="run-actions">
            <button id="run-go" class="primary">${ICONS.play}<span>Run</span></button>
            <button id="run-always" class="soft" data-tip="Run it, and run exactly this command without asking until the session ends">Allow for session</button>
            <button id="run-skip" class="quiet">Skip</button>
          </div>
        </div>
      </div>
      <div id="idle" class="idle">
        <div id="idle-title" class="idle-title">No active session</div>
        <div id="idle-summary" class="idle-summary"></div>
        <button id="start" class="primary start" hidden>${ICONS.play}<span>Start a session</span></button>
        <div id="starting" class="starting" role="status" hidden>Starting a session with Claude Code.</div>
        <div id="idle-text" class="idle-text">Ask your agent to pair with you, or run <a href="#" class="command" data-command="aiPair.playDemo">AI Pair: Play Demo Session</a>. First time? Run <a href="#" class="command" data-command="aiPair.setUpAgent">AI Pair: Set Up Agent</a>.</div>
      </div>
    </div>
    <div id="composer" class="composer">
      <div id="attach" class="attach"><span>With selection</span><span id="attach-ref" class="attach-ref"></span><button id="attach-x" class="quiet" aria-label="Don't send the selection" data-tip="Don't send the selection">x</button></div>
      <div id="compose-row" class="compose-row">
        <textarea id="reply" class="reply" rows="1" aria-label="Reply to the agent" placeholder="Reply to the agent${ELLIPSIS}"></textarea>
        <button id="send" class="quiet" aria-label="Send" data-tip="Send (Enter)">${ICONS.send}</button>
      </div>
    </div>
  </section>
  <section id="history" class="history" aria-label="Earlier, newest first"></section>
</div>
<div id="tip" class="tip" role="tooltip" hidden></div>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`
}
