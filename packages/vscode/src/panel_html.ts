// The Pair panel's page: its markup. Its styles are webview/panel.css; its script is webview/panel.ts.
// Top to bottom: the band, which holds the header (the status and the controls), the current
// message, and the reply box; then the history, newest first.

import { randomBytes } from 'node:crypto';
import { ELLIPSIS, SPEED_SUFFIX } from '@ai-pair/core/constants';
import { SPEECH_PREVIEW_TEXT } from './speech_types';

/** The range `aiPair.speed` declares in package.json. */
const MIN_SPEED = 0.25;
const MAX_SPEED = 4;
/** The CSP nonce's length before base64 encoding. */
const NONCE_BYTES = 16;

/** Speeds offered in the panel's menu. The `aiPair.speed` setting takes any value in its range. */
// oxlint-disable-next-line eslint/no-magic-numbers -- the list is the constant
export const SPEEDS: readonly number[] = [0.4, 0.6, 1, 1.5, 2, 3];

/**
 * Returns the `aiPair.speed` setting as played: clamped to the range it declares (0.25 to 4), or 1
 * for what isn't a finite number. VS Code only warns about a value out of range in settings.json (#17).
 */
export function settingSpeed(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(MAX_SPEED, Math.max(MIN_SPEED, value)) : 1;
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
  cursor: svg('<path d="M5 3l12 9-6 1-3 6z"/>'),
  pause: svg('<path d="M9 5v14M15 5v14"/>', 'pause'),
  resume: svg('<path d="M8 5l11 7-11 7z"/>', 'resume'),
  stop: svg('<rect x="6" y="6" width="12" height="12" rx="2"/>'),
  swap: svg('<path d="M7 7h11l-3-3M17 17H6l3 3"/>'),
  exit: svg('<path d="M14 4h5v16h-5M10 8l-4 4 4 4M6 12h11"/>'),
  attention: svg(
    '<path d="M8 11V5a1 1 0 0 1 2 0v5-7a1 1 0 0 1 2 0v7-6a1 1 0 0 1 2 0v6-4' +
      'a1 1 0 0 1 2 0v7c0 4-2 7-6 7-3 0-4-2-6-5l-1-2a1 1 0 0 1 2-1l3 3"/>',
  ),
  send: svg('<path d="M4 12l16-8-6 16-2.5-6.5z"/>'),
  voice: svg('<path d="M4 9v6h4l5 4V5L8 9H4zM17 9a5 5 0 010 6"/>', 'voice-on'),
  voiceMuted: svg('<path d="M4 9v6h4l5 4V5L8 9H4zM3 3l18 18"/>', 'voice-muted'),
  settings: svg(
    '<circle cx="12" cy="12" r="3"/>' +
      '<path d="M10 2h4l.5 2.4 1.9.8 2.1-1.3 1.4 1.4-1.3 2.1.8 1.9L22 10v4l-2.6.5-.8 1.9 ' +
      '1.3 2.1-1.4 1.4-2.1-1.3-1.9.8L14 22h-4l-.5-2.6-1.9-.8-2.1 1.3-1.4-1.4 1.3-2.1 ' +
      '-.8-1.9L2 14v-4l2.6-.5.8-1.9-1.3-2.1 1.4-1.4 2.1 1.3 1.9-.8L10 2z"/>',
  ),
  play: svg('<path d="M8 5l11 7-11 7z"/>'),
};

/** Renders the page. `styleUri` and `scriptUri`: dist/panel.css and dist/panel.js, built from webview/, as the webview loads them. */
export function panelHtml(cspSource: string, styleUri: string, scriptUri: string, version = 'development', build = 'development'): string {
  const safeVersion = version.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const safeBuild = build.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const nonce = randomBytes(NONCE_BYTES).toString('base64');
  const speeds = SPEEDS.map(
    (s) => `<button type="button" role="menuitemradio" aria-checked="false" data-speed="${s}">${s.toFixed(1)}${SPEED_SUFFIX}</button>`,
  ).join('');
  return /* html */ `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; style-src ${cspSource}; media-src blob:; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AI Pair</title>
<link rel="stylesheet" href="${styleUri}">
<div class="app">
  <dialog data-ui="settings-dialog" class="settings-dialog" aria-label="Settings">
    <h1>Settings</h1>
    <section class="settings-section">
      <h2>Conversation</h2>
      <label class="settings-field">When I send a reply
        <select data-ui="reply-behavior">
          <option value="interrupt">Interrupt immediately</option>
          <option value="finishAction">Finish current action first</option>
        </select>
      </label>
      <p>Long commands can delay a reply until they finish. Stop always interrupts immediately.</p>
      <label class="settings-field">Navigator commentary
        <select data-ui="navigator-commentary">
          <option value="quiet">Quiet - important issues</option>
          <option value="helpful" selected>Helpful - useful observations</option>
          <option value="coach">Coach - explanations and connections</option>
        </select>
      </label>
      <p>During your turn, this sets written and spoken commentary on the next returned report; direct requests override it.
        Audio is controlled separately.</p>
      <label class="settings-field">Chat order
        <select data-ui="chat-order">
          <option value="newestFirst">Newest first</option>
          <option value="oldestFirst">Oldest first</option>
        </select>
      </label>
    </section>
    <section class="settings-section">
      <h2>Playback</h2>
      <label class="settings-field">Code display
        <select data-ui="settings-code-playback">
          <option value="typing">Typing</option>
          <option value="lines">Lines</option>
          <option value="blocks">Blocks</option>
        </select>
      </label>
      <p>Changes apply to the next typing action. You can also choose this in the toolbar.</p>
    </section>
    <section class="settings-section">
      <h2>Keyboard shortcuts</h2>
      <p>Defaults: Alt+Q pauses or resumes, Alt+W raises or lowers the hand,
        and Ctrl+Alt+Space focuses reply. Your shortcuts may differ.</p>
      <p>Change shortcuts in VS Code. Your keyboard, system, or terminal may reserve a key.</p>
      <button type="button" data-ui="configure-shortcuts">Configure shortcuts</button>
    </section>
    <section class="settings-section">
      <h2>Commands</h2>
      <label class="settings-check"><input type="checkbox" data-ui="show-terminals"> Show terminals automatically</label>
      <label class="settings-check">
        <input type="checkbox" data-ui="command-approval-sound">
        Play a sound when command approval is needed
      </label>
      <p>The approval sound uses your system default audio output.</p>
      <p data-ui="command-approvals-status">No session command grants.</p>
      <button type="button" data-ui="revoke-command-approvals" disabled>Require command approval</button>
      <p>Turns command confirmation on and clears remembered session grants.</p>
    </section>
    <section class="settings-section">
      <h2>Speech</h2>
      <label class="settings-field">Speech provider
        <select data-ui="speech-provider">
          <option value="kokoro">Kokoro (local)</option>
          <option value="elevenlabs">ElevenLabs (cloud)</option>
          <option value="openrouter">OpenRouter (cloud)</option>
        </select>
      </label>
      <label class="settings-field">Speech output
        <select data-ui="speech-output"><option value="default">System default</option></select>
      </label>
      <p>System default follows VS Code audio routing. Output selection applies only to Pair speech.</p>
      <div class="settings-actions"><button type="button" data-ui="speech-output-refresh" class="soft">Refresh outputs</button></div>
      <p data-ui="speech-output-status" role="status"></p>
      <label class="settings-check"><input type="checkbox" data-ui="speech-enabled"> Speak selected narration automatically</label>
      <label class="settings-field">Speech context and delivery cues
        <select data-ui="speech-context"><option value="off">Off</option><option value="on">On</option></select>
      </label>
      <p data-ui="speech-context-capability"></p>
      <label class="settings-field">Listening speed (experimental)
        <input type="range" data-ui="speech-listening-speed" min="0.75" max="1.5" step="0.05" value="1" aria-valuetext="1.00x">
        <span data-ui="speech-listening-speed-value" aria-hidden="true">1.00x</span>
      </label>
      <div data-ui="speech-local">
      <label class="settings-field">Voice
        <select data-ui="speech-voice">
          <option value="af_heart">Heart</option>
          <option value="am_michael">Michael</option>
          <option value="bf_emma">Emma</option>
          <option value="bm_george">George</option>
        </select>
      </label>
      </div>
      <div data-ui="openrouter" hidden>
        <p>Selected narration and previews are sent to OpenRouter and may use account credits.</p>
        <p data-ui="openrouter-key-status" role="status"></p>
        <div class="settings-actions">
          <button type="button" data-ui="openrouter-key-set" class="soft">Add or replace API key</button>
          <button type="button" data-ui="openrouter-key-remove" class="soft">Remove API key</button>
          <button type="button" data-ui="openrouter-load" class="soft">Load account models</button>
        </div>
        <label class="settings-field">Speech model
          <select data-ui="openrouter-model"><option value="">Choose a model</option></select>
        </label>
        <p>OpenRouter rates are shown per billing unit. Units vary by model; check its pricing page for the unit and final cost.</p>
        <label class="settings-field">Voice
          <select data-ui="openrouter-voice"><option value="">Use provider default (if supported)</option></select>
        </label>
        <label class="settings-field">Response format
          <select data-ui="openrouter-format"><option value="mp3">MP3</option><option value="pcm">PCM</option></select>
        </label>
        <p>Models may accept only one format. If a request fails, select the format listed for that model on OpenRouter.</p>
        <button type="button" data-ui="openrouter-zdr" class="soft zdr-toggle" aria-pressed="false">ZDR filter: Off</button>
        <p>Filters models with ZDR routes and requests OpenRouter's ZDR policy. Your account's Safety Retention settings still apply.</p>
        <p data-ui="openrouter-status" role="status">
          Load speech models and advertised voices from your account. Some models allow a provider-default voice.
        </p>
      </div>
      <div data-ui="speech-cloud" hidden>
        <p>Selected narration and voice previews are sent to ElevenLabs and use your account credits.
          Your normal session history stays in Pair.
          <a href="#" class="url" data-url="https://elevenlabs.io/privacy-policy">Privacy policy</a>.</p>
        <p>Voice availability depends on your account. Use a key with Text to Speech and Voices read access.</p>
        <p data-ui="speech-key-status" role="status"></p>
        <div class="settings-actions">
          <button type="button" data-ui="speech-key-set" class="soft">Add or replace API key</button>
          <button type="button" data-ui="speech-key-remove" class="soft">Remove API key</button>
        </div>
        <label class="settings-field">Account voice
          <select data-ui="speech-cloud-voice"><option value="">Choose a voice</option></select>
        </label>
        <div class="settings-actions">
          <button type="button" data-ui="speech-voices-load" class="soft">Load voices</button>
          <button type="button" data-ui="speech-voices-more" class="soft" hidden>Load more</button>
        </div>
        <details class="speech-details">
          <summary>Synthesis speed</summary>
        <label class="settings-field">Synthesis speed
          <select data-ui="speech-cloud-speed">
            <option value="0.75">0.75x</option><option value="1" selected>1.0x</option>
            <option value="1.2">1.2x</option>
          </select>
        </label>
        </details>
      </div>
      <p>Preview: ${SPEECH_PREVIEW_TEXT}</p>
      <div class="settings-actions">
        <button type="button" data-ui="speech-preview" class="soft" disabled>Preview voice</button>
        <button type="button" data-ui="speech-stop" class="soft">Stop speech</button>
      </div>
      <div data-ui="speech-local-model" class="speech-model">
        <h3>Local model</h3>
        <p data-ui="speech-model-status" role="status">Checking model verification...</p>
        <div data-ui="speech-setup-primary" class="settings-actions">
          <button type="button" data-ui="speech-setup" class="soft" disabled>Download Kokoro model</button>
        </div>
        <label class="settings-field"><span>Kokoro compute <span class="speech-badge">Experimental</span></span>
          <select data-ui="speech-compute">
            <option value="cpu">CPU</option>
            <option value="auto">Auto (use CPU if GPU is unavailable)</option>
            <option value="gpu">GPU</option>
          </select>
        </label>
        <p data-ui="gpu-status" role="status">GPU setup has not been checked. Actual backend: NONE.</p>
        <div class="settings-actions"><button type="button" data-ui="gpu-check" class="soft">Set up GPU</button></div>
        <details data-ui="speech-details" class="speech-details">
          <summary>Technical details and synthesis speed</summary>
        <p data-ui="gpu-model-info">GPU setup requires the CPU model and an additional model (about 326 MB).</p>
          <div data-ui="speech-setup-secondary" class="settings-actions"></div>
      <label class="settings-field">Synthesis speed
        <select data-ui="speech-speed">
          <option value="0.75">0.75x</option>
          <option value="1" selected>1.0x</option>
          <option value="1.25">1.25x</option>
          <option value="1.5">1.5x</option>
        </select>
      </label>
          <p>CPU setup downloads a local voice model of about 94 MB.</p>
          <p data-ui="speech-model-details">Model details are not available yet.</p>
          <p data-ui="gpu-details">Compute details are not available yet.</p>
        </details>
      </div>
      <p data-ui="speech-settings-status" role="status"></p>
    </section>
    <section class="settings-section">
      <h2>Diagnostics</h2>
      <p>Copies version and recent connection, session, and command status; no command text.</p>
      <div class="settings-actions">
        <button type="button" data-ui="copy-diagnostics" class="soft">Copy diagnostics</button>
      </div>
    </section>
    <div class="settings-footer">
      <p class="build-identity">v${safeVersion} - build ${safeBuild}</p>
      <button type="button" data-ui="settings-close" class="primary">Close</button>
    </div>
  </dialog>
  <div data-ui="band" class="band">
    <div class="main">
      <div class="head">
        <div class="status">
          <button
            type="button"
            data-ui="skip-reading"
            class="reading-control"
            aria-label="Finish reading pause"
            data-tip="Click to finish; hold to pause the timer"
            disabled
          >
            <span data-ui="dot" class="dot off"></span>
          </button>
          <span data-ui="status-text" class="status-text" role="status">No session</span>
        </div>
        <div class="controls">
          <div class="session-controls">
          <button
            type="button"
            data-ui="pause"
            class="quiet pause-toggle"
            aria-label="Pause"
            data-tip="Pause (Space)"
            aria-keyshortcuts="Space"
          >${ICONS.pause}${ICONS.resume}</button>
          <button type="button" data-ui="reveal-cursor" class="quiet" aria-label="Reveal agent cursor"
            data-tip="Reveal agent cursor">${ICONS.cursor}</button>
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
              aria-label="Playback speed: 1.0${SPEED_SUFFIX}"
              aria-haspopup="menu"
              aria-expanded="false"
              data-tip="Playback speed"
            >1.0${SPEED_SUFFIX}</button>
            <div data-ui="speed-menu" class="speed-menu" role="menu" aria-label="Playback speed" hidden>${speeds}</div>
          </div>
          <div class="speed-wrap">
            <button
              type="button"
              data-ui="code-mode"
              class="quiet speed"
              aria-label="Code display: Typing"
              aria-haspopup="menu"
              aria-expanded="false"
              data-tip="Code display"
            >Typing</button>
            <div data-ui="code-mode-menu" class="speed-menu" role="menu" aria-label="Code display" hidden>
              <button type="button" role="menuitemradio" aria-checked="true" data-code-playback="typing">Typing</button>
              <button type="button" role="menuitemradio" aria-checked="false" data-code-playback="lines">Lines</button>
              <button type="button" role="menuitemradio" aria-checked="false" data-code-playback="blocks">Blocks</button>
            </div>
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
          </div>
          <button
            type="button"
            data-ui="voice-status"
            class="quiet voice-status"
            data-state="checking"
            aria-label="Automatic narration"
            aria-pressed="false"
            aria-description="Voice: readiness not checked"
            data-tip="Enable narration (Voice: readiness not checked)"
            disabled
          >${ICONS.voice}${ICONS.voiceMuted}<span class="voice-indicator" aria-hidden="true"></span></button>
          <span data-ui="speech-cost" class="speech-cost" role="status" tabindex="0" data-tip="" hidden></span>
          <button
            type="button"
            data-ui="settings"
            class="quiet"
            aria-label="Settings"
            aria-haspopup="dialog"
            data-tip="Settings"
          >${ICONS.settings}</button>
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
        <div data-ui="speech-live" class="speech-live" hidden>
          <span data-ui="speech-live-status" role="status"></span>
          <button type="button" data-ui="speech-stop-live" class="quiet">Stop speech</button>
        </div>
        <div data-ui="passage" class="passage" hidden>
          <div data-ui="passage-text"></div>
          <div data-ui="passage-notice" class="passage-notice"></div>
        </div>
        <div data-ui="run" class="run-box">
          <div data-ui="run-label" class="run-label"></div>
          <div data-ui="run-cmd" class="run-cmd"></div>
          <button type="button" data-ui="show-terminal" class="quiet" hidden>Show terminal</button>
          <div class="run-actions">
            <button type="button" data-ui="run-go" class="primary">${ICONS.play}<span>Run once</span></button>
            <button
              type="button"
              data-ui="run-always"
              class="soft"
              data-tip="Run it, and run exactly this command without asking until the session ends"
            >Allow this command</button>
            <button
              type="button"
              data-ui="run-all"
              class="soft"
              data-tip="Run every command without asking until this Pair session ends"
            >Allow all for session</button>
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
        <button type="button" data-ui="attention" class="quiet" aria-label="Raise hand" data-tip="Raise hand"
          aria-pressed="false" disabled>${ICONS.attention}</button>
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
