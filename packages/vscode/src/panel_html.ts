// The Pair panel's page: its markup. Its styles are webview/panel.css; its script is webview/panel.ts.
// Top to bottom: the band, which holds the header (the status and the controls), the current
// message, and the reply box; then the history, newest first.

import { randomBytes } from 'node:crypto';
import { ELLIPSIS, SPEED_SUFFIX } from '@ai-pair/core/constants';

/** Speeds offered in the panel's menu. The `aiPair.speed` setting takes any value in its range. */
export const SPEEDS: readonly number[] = [0.4, 0.6, 1, 1.5, 2, 3];

/**
 * Returns the `aiPair.speed` setting as played: clamped to the range it declares (0.25 to 4), or 1
 * for what isn't a finite number. VS Code only warns about a value out of range in settings.json (#17).
 */
export function settingSpeed(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(4, Math.max(0.25, value)) : 1;
}

function svg(paths: string, cls = ''): string {
  return `<svg
    class="i ${cls}"
    viewbox="0 0 24 24"
    fill="none"
    stroke="currentcolor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >${paths}</svg>`;
}

const ICONS = {
  pause: svg('<path d="M9 5v14M15 5v14"/>', 'pause'),
  resume: svg('<path d="M8 5l11 7-11 7z"/>', 'resume'),
  stop: svg('<rect x="6" y="6" width="12" height="12" rx="2"/>'),
  swap: svg('<path d="M7 7h11l-3-3M17 17H6l3 3"/>'),
  exit: svg('<path d="M14 4h5v16h-5M10 8l-4 4 4 4M6 12h11"/>'),
  send: svg('<path d="M4 12l16-8-6 16-2.5-6.5z"/>'),
  play: svg('<path d="M8 5l11 7-11 7z"/>'),
};

/** Renders the page. `styleUri` and `scriptUri`: dist/panel.css and dist/panel.js, built from webview/, as the webview loads them. */
export function panelHtml(cspSource: string, styleUri: string, scriptUri: string): string {
  const nonce = randomBytes(16).toString('base64');
  const speeds = SPEEDS.map(
    (s) => `<button type="button" role="menuitemradio" aria-checked="false" data-speed="${s}">${s.toFixed(1)}${SPEED_SUFFIX}</button>`,
  ).join('');
  return /* html */ `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AI Pair</title>
<link rel="stylesheet" href="${styleUri}">
<div class="app">
  <div data-ui="band" class="band">
    <div class="main">
      <div class="head">
        <div class="status">
          <span data-ui="dot" class="dot off"></span>
          <span data-ui="status-text" class="status-text" role="status">No session</span>
        </div>
        <div class="controls">
          <button
            type="button"
            data-ui="pause"
            class="quiet pause-toggle"
            aria-label="Pause"
            data-tip="Pause (Space)"
            aria-keyshortcuts="Space"
          >${ICONS.pause}${ICONS.resume}</button>
          <button
            type="button"
            data-ui="interrupt"
            class="quiet interrupt"
            aria-label="Interrupt"
            data-tip="Interrupt"
          >${ICONS.stop}</button>
          <button
            type="button"
            data-ui="turn"
            class="quiet"
            aria-label="My turn"
            data-tip="Take the turn: you drive, the agent navigates"
          >${ICONS.swap}<span data-ui="turn-label" class="turn-label">My turn</span></button>
          <div class="speed-wrap">
            <button
              type="button"
              data-ui="speed"
              class="quiet speed"
              aria-haspopup="menu"
              aria-expanded="false"
              data-tip="Playback speed"
            >1.0${SPEED_SUFFIX}</button>
            <div data-ui="speed-menu" class="speed-menu" role="menu" aria-label="Playback speed" hidden>${speeds}</div>
          </div>
          <div class="speed-wrap">
            <button
              type="button"
              data-ui="reading-speed"
              class="quiet speed"
              aria-haspopup="menu"
              aria-expanded="false"
              data-tip="Reading speed: the pause after each message"
            >read 1.0${SPEED_SUFFIX}</button>
            <div data-ui="reading-menu" class="speed-menu" role="menu" aria-label="Reading speed" hidden>${speeds}</div>
          </div>
          <button
            type="button"
            data-ui="end"
            class="quiet end"
            aria-label="End the session"
            data-tip="End the session"
          >${ICONS.exit}</button>
        </div>
      </div>
      <div class="now">
        <div data-ui="now-text" class="now-text empty" aria-live="polite"></div>
        <div data-ui="now-ref" class="now-ref"></div>
        <div data-ui="passage" class="passage" hidden>
          <div data-ui="passage-text"></div>
          <div data-ui="passage-notice" class="passage-notice"></div>
        </div>
        <div data-ui="run" class="run-box">
          <div data-ui="run-label" class="run-label"></div>
          <div data-ui="run-cmd" class="run-cmd"></div>
          <div class="run-actions">
            <button type="button" data-ui="run-go" class="primary">${ICONS.play}<span>Run</span></button>
            <button
              type="button"
              data-ui="run-always"
              class="soft"
              data-tip="Run it, and run exactly this command without asking until the session ends"
            >Allow for session</button>
            <button type="button" data-ui="run-skip" class="quiet">Skip</button>
          </div>
        </div>
      </div>
      <div class="idle">
        <div data-ui="idle-title" class="idle-title">No active session</div>
        <div data-ui="idle-summary" class="idle-summary"></div>
        <button type="button" data-ui="start" class="primary start" hidden>${ICONS.play}<span>Start a session</span></button>
        <div data-ui="starting" class="starting" role="status" hidden>Starting a session with Claude Code.</div>
        <div data-ui="idle-text" class="idle-text">
          Ask your agent to pair with you, or run
          <a href="#" class="command" data-command="aiPair.playDemo">AI Pair: Play Demo Session</a>. First time? Run
          <a href="#" class="command" data-command="aiPair.setUpAgent">AI Pair: Set Up Agent</a>.
        </div>
      </div>
    </div>
    <div class="composer">
      <div data-ui="attach" class="attach">
        <span>With selection</span>
        <span data-ui="attach-ref" class="attach-ref"></span>
        <button
          type="button"
          data-ui="attach-x"
          class="quiet"
          aria-label="Don't send the selection"
          data-tip="Don't send the selection"
        >x</button>
      </div>
      <div class="compose-row">
        <textarea
          data-ui="reply"
          class="reply"
          rows="1"
          aria-label="Reply to the agent"
          placeholder="Reply to the agent${ELLIPSIS}"
        ></textarea>
        <button type="button" data-ui="send" class="quiet" aria-label="Send" data-tip="Send (Enter)">${ICONS.send}</button>
      </div>
    </div>
  </div>
  <section data-ui="history" class="history" aria-label="Earlier, newest first"></section>
</div>
<div data-ui="tip" class="tip" role="tooltip" hidden></div>
<script nonce="${nonce}" src="${scriptUri}"></script>`;
}
