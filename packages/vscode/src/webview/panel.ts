// The narration panel's page script, bundled for the webview as dist/panel.js (#6). The markup and
// styles are in panelHtml.ts; the messages in panelMessages.ts.

import type { AgentState, PanelEvent, Ref } from "@ai-pair/core"
import type { FromPanel, ToPanel } from "../panelMessages"

declare function acquireVsCodeApi(): { postMessage(message: FromPanel): void }

const vscode = acquireVsCodeApi()

/** The page's element with `id`, as the element it is. */
function $<T extends HTMLElement>(id: string, type: abstract new () => T): T {
  const el = document.getElementById(id)
  if (!(el instanceof type)) throw new Error(`The panel has no ${type.name} #${id}`)
  return el
}

const ui = {
  band: $("band", HTMLElement),
  dot: $("dot", HTMLElement),
  status: $("status-text", HTMLElement),
  pause: $("pause", HTMLButtonElement),
  interrupt: $("interrupt", HTMLButtonElement),
  turn: $("turn", HTMLButtonElement),
  turnLabel: $("turn-label", HTMLElement),
  speed: $("speed", HTMLButtonElement),
  speedMenu: $("speed-menu", HTMLElement),
  end: $("end", HTMLButtonElement),
  now: $("now-text", HTMLElement),
  ref: $("now-ref", HTMLElement),
  idleTitle: $("idle-title", HTMLElement),
  idleSummary: $("idle-summary", HTMLElement),
  idleText: $("idle-text", HTMLElement),
  reply: $("reply", HTMLTextAreaElement),
  send: $("send", HTMLButtonElement),
  attach: $("attach", HTMLElement),
  attachRef: $("attach-ref", HTMLElement),
  attachX: $("attach-x", HTMLButtonElement),
  run: $("run", HTMLElement),
  runLabel: $("run-label", HTMLElement),
  runCmd: $("run-cmd", HTMLElement),
  runGo: $("run-go", HTMLButtonElement),
  runAlways: $("run-always", HTMLButtonElement),
  runSkip: $("run-skip", HTMLButtonElement),
  history: $("history", HTMLElement),
  tip: $("tip", HTMLElement),
}

let active = false
let turn = "agent"
let paused = false
let replaying = false
/** The agent's state, as the extension last reported it. */
let state: AgentState | null = null
/** The programmer's selection, offered with the reply. */
let selection: Ref | null = null
let selectionDismissed = false
/** The command shown in the run box. */
let runId: number | null = null
let runConfirming = false
/** Text of the current message. */
let current: string | null = null
/** Whether the current message is in the history already. */
let filed = false
let reading: { ms: number; elapsed: number; last: number } | null = null
/** A link to the code the agent just pointed at, shown with the message about it. */
let pointed: HTMLAnchorElement | null = null

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c)
// A code span that names a file, like `game.ts` or `src/game.ts`, becomes a link that opens it.
const FILE =
  /^[\w@.~-]*(\/[\w@.~-]+)*\.(ts|tsx|js|jsx|mjs|cjs|json|jsonc|md|css|scss|less|html|vue|svelte|py|rs|go|java|kt|swift|c|h|cc|cpp|hpp|cs|rb|php|lua|sh|zsh|toml|yaml|yml|xml|sql|txt|lock|env)$/
const URL_PATTERN = /\bhttps?:\/\/[^\s<>"'`]*[^\s<>"'`.,;:!?)\]]/g
const codeSpan = (code: string) =>
  FILE.test(code) && !code.startsWith(".") ? '<a href="#" class="file" data-file="' + code + '">' + code + "</a>" : "<code>" + code + "</code>"
const rich = (s: string) =>
  esc(s)
    .split(/(`[^`]+`)/)
    .map((part, i) =>
      i % 2 === 1 ? codeSpan(part.slice(1, -1)) : part.replace(URL_PATTERN, (u) => '<a href="#" class="url" data-url="' + u + '">' + u + "</a>"),
    )
    .join("")

function add(el: HTMLElement): HTMLElement {
  // Newest first: the current message came before this entry, so it goes in first.
  fileCurrent()
  ui.history.prepend(el)
  return el
}

/** Puts the current message into the history, once: when the next entry comes, or when it is replaced. */
function fileCurrent(): void {
  if (current !== null && !filed) ui.history.prepend(entry("agent", rich(current)))
  filed = true
}

function entry(cls: string, html?: string): HTMLElement {
  const el = document.createElement("div")
  el.className = "entry " + cls
  if (html !== undefined) el.innerHTML = html
  return el
}

function addDivider(text: string): void {
  add(entry("divider")).textContent = text
}

/** A link to code; it has an href, so it takes focus and Enter (#16). */
function codeLink(text: string, file: string, line: number): HTMLAnchorElement {
  const a = document.createElement("a")
  a.href = "#"
  a.className = "ref"
  a.textContent = text
  a.addEventListener("click", () => vscode.postMessage({ type: "open", file, line }))
  return a
}

function refLink(ref: Ref): HTMLAnchorElement {
  return codeLink(ref.file + ":" + ref.line + (ref.endLine > ref.line ? "–" + ref.endLine : ""), ref.file, ref.line)
}

function addYou(text: string | undefined, ref: Ref | undefined): void {
  const el = entry("you", text ? rich(text) : "")
  if (ref) el.append(refLink(ref))
  add(el)
}

type RunPhase = Extract<PanelEvent, { type: "run" }>["phase"]

function addRun(id: number, command: string, phase: RunPhase, exitCode: number | undefined): void {
  const el = entry("run")
  el.dataset.run = String(id)
  const cmd = document.createElement("span")
  cmd.className = "cmd"
  cmd.textContent = command
  cmd.dataset.tip = command
  const outcome = document.createElement("span")
  el.append(cmd, outcome)
  setOutcome(el, phase, exitCode)
  add(el)
}

function setOutcome(el: Element, phase: RunPhase, exitCode: number | undefined): void {
  const outcome = el.querySelector(".outcome") ?? el.lastElementChild
  if (!outcome) return
  outcome.className = "outcome"
  el.classList.toggle("skipped", phase === "declined")
  if (phase === "declined") outcome.textContent = "⊘ skipped"
  else if (phase === "background") outcome.textContent = "still running"
  else if (exitCode === undefined) outcome.textContent = phase === "exited" ? "ended" : "done"
  else if (exitCode === 0) {
    outcome.classList.add("ok")
    outcome.textContent = "✓ exit 0"
  }
  // Interrupted (Ctrl+C) or terminated, like a server being restarted: not a failure.
  else if (exitCode === 130 || exitCode === 143) outcome.textContent = "■ stopped"
  else {
    outcome.classList.add("fail")
    outcome.textContent = "✕ exit " + exitCode
  }
}

const attaching = () => active && selection !== null && !selectionDismissed
function syncAttach(): void {
  ui.attach.classList.toggle("on", attaching())
  if (attaching() && selection) ui.attachRef.replaceChildren(refLink(selection))
}

// Fades something new in the band in, restarting the fade if it's still going.
function arrive(el: HTMLElement): void {
  if (replaying) return
  el.classList.remove("arrive")
  void el.offsetWidth
  el.classList.add("arrive")
}

function setNow(text: string): void {
  fileCurrent()
  current = text
  filed = false
  ui.now.className = ""
  ui.now.innerHTML = rich(text)
  // The agent points first, then says what's there.
  ui.ref.replaceChildren(...(pointed ? [pointed] : []))
  pointed = null
  arrive(ui.now)
}

// The reading pause fills a ring around the status dot.
function startReading(ms: number): void {
  if (replaying) return
  reading = { ms, elapsed: 0, last: performance.now() }
  ui.dot.style.setProperty("--progress", "0")
  syncReading()
  requestAnimationFrame(tick)
}

function tick(t: number): void {
  if (!reading) return
  if (!paused) reading.elapsed += t - reading.last
  reading.last = t
  const f = Math.min(1, reading.elapsed / reading.ms)
  ui.dot.style.setProperty("--progress", String(f))
  if (f >= 1) {
    reading = null
    syncReading()
    return
  }
  requestAnimationFrame(tick)
}

function syncReading(): void {
  ui.dot.classList.toggle("reading", reading !== null)
}

const STATUS: Record<AgentState, [string, string]> = {
  typing: ["", "Agent is typing"],
  read: ["read", "Read this"],
  running: ["", "Running a command"],
  thinking: ["dim", "Agent is thinking"],
  paused: ["dim", "Paused"],
  listening: ["ring", "Your move"],
  navigator: ["ring", "Your turn"],
}

function syncStatus(): void {
  if (!active) {
    ui.dot.className = "dot off"
    ui.status.textContent = "No session"
    return
  }
  const [cls, text] = runConfirming ? ["read", "Needs you"] : state ? STATUS[state] : ["", "Session started"]
  ui.dot.className = "dot " + cls
  syncReading()
  ui.status.textContent = text
}

function setState(e: Extract<PanelEvent, { type: "state" }>): void {
  state = e.state
  turn = e.turn
  paused = e.paused
  document.body.classList.toggle("paused", paused)
  document.body.classList.toggle("user-turn", turn === "user")
  ui.pause.classList.toggle("on", paused)
  ui.pause.setAttribute("aria-label", paused ? "Resume" : "Pause")
  setTip(ui.pause, paused ? "Resume (Space)" : "Pause (Space)")
  ui.turnLabel.textContent = turn === "user" ? "Hand back" : "My turn"
  ui.turn.setAttribute("aria-label", ui.turnLabel.textContent)
  setTip(ui.turn, turn === "user" ? "Hand the turn back to the agent, with your reply if you typed one" : "Take the turn: you drive, the agent navigates")
  syncStatus()
  syncTip()
}

/** The run box shows nothing. */
function clearRun(): void {
  runId = null
  runConfirming = false
  ui.run.className = ""
  ui.run.removeAttribute("role")
}

function setActive(on: boolean): void {
  active = on
  document.body.classList.toggle("active", on)
  ui.reply.disabled = !on
  if (!on) {
    reading = null
    clearRun()
    closeSpeedMenu()
  }
  syncStatus()
  syncAttach()
  syncTip()
}

const ENDED = { agent: "The agent ended the session", user: "You ended the session", disconnected: "The agent disconnected" }

function handle(e: ToPanel): void {
  switch (e.type) {
    case "replay":
      replaying = true
      for (const ev of e.events) handle(ev)
      replaying = false
      return
    case "session":
      if (e.active) {
        fileCurrent()
        current = null
        state = null
        ui.now.className = "empty"
        ui.now.textContent = "Waiting for the agent…"
        ui.ref.innerHTML = ""
        pointed = null
        addDivider("Session started" + (e.task ? ": " + e.task : ""))
        setActive(true)
      } else {
        fileCurrent()
        current = null
        addDivider(ENDED[e.reason])
        ui.idleTitle.textContent = e.reason === "disconnected" ? "The agent disconnected" : "Session ended"
        ui.idleSummary.innerHTML = e.summary ? rich(e.summary) : ""
        ui.idleText.textContent = "Ask your agent to pair again."
        setActive(false)
      }
      return
    case "say":
      setNow(e.text)
      return
    case "reading":
      startReading(e.ms)
      return
    case "state":
      setState(e)
      return
    case "user":
      addYou(e.text, e.ref)
      return
    case "interrupt":
      addDivider("You interrupted")
      return
    case "turn":
      addDivider(e.to === "user" ? "You took the turn" : "You handed the turn back")
      if (e.message || e.ref) addYou(e.message, e.ref)
      ui.reply.placeholder = e.to === "user" ? "Ask the agent…" : "Reply to the agent…"
      return
    case "point":
      pointed = codeLink("→ " + e.file + ":" + e.line, e.file, e.line)
      return
    case "run": {
      if (e.phase === "confirm" || e.phase === "running") {
        runId = e.id
        runConfirming = e.phase === "confirm"
        ui.run.className = "on" + (runConfirming ? " confirm" : "")
        // A command waiting for the programmer's decision is announced at once (#16).
        if (runConfirming) ui.run.setAttribute("role", "alert")
        else ui.run.removeAttribute("role")
        ui.runLabel.textContent = runConfirming ? "Allow this command in the terminal?" : "Running in the terminal…"
        ui.runCmd.textContent = e.command
        syncStatus()
        if (runConfirming) arrive(ui.run)
        return
      }
      if (e.phase === "exited") {
        // A command left running has ended: its row says how.
        const row = ui.history.querySelector('.run[data-run="' + e.id + '"]')
        if (row) setOutcome(row, e.phase, e.exitCode)
        return
      }
      if (runId === e.id) {
        clearRun()
        syncStatus()
      }
      addRun(e.id, e.command, e.phase, e.exitCode)
      return
    }
    case "selection":
      selection = e.ref ?? null
      selectionDismissed = false
      syncAttach()
      return
    case "focusReply":
      ui.reply.focus()
      return
    case "speed": {
      // One decimal, so the menu's speeds line up; a setting with more keeps them.
      const label = (Number.isInteger(e.value * 10) ? e.value.toFixed(1) : String(e.value)) + "×"
      ui.speed.textContent = label
      ui.speed.setAttribute("aria-label", "Playback speed: " + label)
      for (const b of ui.speedMenu.querySelectorAll("button")) {
        b.setAttribute("aria-checked", String(Math.abs(Number(b.dataset.speed) - e.value) < 0.01))
      }
      return
    }
    default:
      throw new Error(`Unknown panel message: ${JSON.stringify(e satisfies never)}`)
  }
}

// The extension posts only ToPanel messages.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
window.addEventListener("message", (m: MessageEvent) => handle(m.data as ToPanel))

let draftEmpty = true
function syncDraft(): void {
  const empty = ui.reply.value.trim() === ""
  ui.reply.style.height = "auto"
  ui.reply.style.height = Math.min(ui.reply.scrollHeight, 120) + "px"
  if (empty !== draftEmpty) {
    draftEmpty = empty
    vscode.postMessage({ type: "draft", empty })
  }
}
function takeDraft(): string {
  const text = ui.reply.value.trim()
  ui.reply.value = ""
  draftEmpty = true
  syncDraft()
  return text
}
function takeAttach(): boolean {
  const on = attaching()
  if (on) {
    selectionDismissed = true
    syncAttach()
  }
  return on
}
function sendReply(): void {
  const text = takeDraft()
  if (text) vscode.postMessage({ type: "reply", text, attach: takeAttach() })
}

ui.reply.addEventListener("input", syncDraft)
ui.reply.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    sendReply()
  } else if (e.key === "Escape") {
    ui.reply.blur()
  }
})
ui.send.addEventListener("click", sendReply)
ui.pause.addEventListener("click", () => vscode.postMessage({ type: paused ? "resume" : "pause" }))
ui.interrupt.addEventListener("click", () => vscode.postMessage({ type: "interrupt" }))
ui.turn.addEventListener("click", () => {
  const handingBack = turn === "user"
  const message = handingBack ? takeDraft() : ""
  const attach = handingBack && takeAttach()
  vscode.postMessage({ type: "turn", ...(message ? { message } : {}), ...(attach ? { attach } : {}) })
})
ui.attachX.addEventListener("click", () => {
  selectionDismissed = true
  syncAttach()
})
const decide = (run: boolean, remember: boolean) => {
  if (runId !== null) vscode.postMessage({ type: "runDecision", id: runId, run, remember })
}
ui.runGo.addEventListener("click", () => decide(true, false))
ui.runAlways.addEventListener("click", () => decide(true, true))
ui.runSkip.addEventListener("click", () => decide(false, false))
ui.end.addEventListener("click", () => vscode.postMessage({ type: "end" }))

function closeSpeedMenu(): void {
  ui.speedMenu.hidden = true
  ui.speed.setAttribute("aria-expanded", "false")
  ui.speed.classList.remove("on")
}
ui.speed.addEventListener("click", (e) => {
  e.stopPropagation()
  const open = ui.speedMenu.hidden === true
  ui.speedMenu.hidden = !open
  ui.speed.setAttribute("aria-expanded", String(open))
  ui.speed.classList.toggle("on", open)
  if (open) ui.speedMenu.querySelector<HTMLElement>('[aria-checked="true"]')?.focus()
})
for (const b of ui.speedMenu.querySelectorAll("button")) {
  b.addEventListener("click", () => {
    closeSpeedMenu()
    ui.speed.focus()
    vscode.postMessage({ type: "speed", value: Number(b.dataset.speed) })
  })
}
document.addEventListener("click", (e) => {
  if (!ui.speedMenu.hidden && !(e.target instanceof Node && ui.speedMenu.contains(e.target))) closeSpeedMenu()
})
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !ui.speedMenu.hidden) {
    closeSpeedMenu()
    ui.speed.focus()
  }
})

// Tooltips: an element's data-tip shows under it after a moment's hover, or at once while one is
// showing or just was, the way VS Code's own hovers do; and on keyboard focus. A click hides it.
const TIP_DELAY_MS = 500
const TIP_WARM_MS = 300
const TIP_GAP = 4
const TIP_MARGIN = 6
let tipTarget: HTMLElement | null = null
let tipTimer: ReturnType<typeof setTimeout> | undefined
let tipWarmUntil = 0

function setTip(el: HTMLElement, text: string): void {
  el.dataset.tip = text
  if (el === tipTarget) {
    ui.tip.textContent = text
    placeTip()
  }
}

function showTip(el: HTMLElement): void {
  clearTimeout(tipTimer)
  if (el === ui.speed && !ui.speedMenu.hidden) return
  tipTarget = el
  ui.tip.textContent = el.dataset.tip ?? ""
  ui.tip.hidden = false
  el.setAttribute("aria-describedby", "tip")
  placeTip()
}

// Under the element, centered on it, inside the panel; above it if there's no room below.
function placeTip(): void {
  if (!tipTarget) return
  const r = tipTarget.getBoundingClientRect()
  const w = ui.tip.offsetWidth
  const h = ui.tip.offsetHeight
  const left = Math.max(TIP_MARGIN, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - TIP_MARGIN))
  const top = r.bottom + TIP_GAP + h <= innerHeight - TIP_MARGIN ? r.bottom + TIP_GAP : r.top - TIP_GAP - h
  ui.tip.style.left = left + "px"
  ui.tip.style.top = Math.max(TIP_MARGIN, top) + "px"
}

function hideTip(): void {
  clearTimeout(tipTimer)
  if (!tipTarget) return
  tipTarget.removeAttribute("aria-describedby")
  tipTarget = null
  ui.tip.hidden = true
  tipWarmUntil = performance.now() + TIP_WARM_MS
}

function hoverTip(el: HTMLElement | null): void {
  if (el === tipTarget) return
  const warm = tipTarget !== null || performance.now() < tipWarmUntil
  hideTip()
  if (!el) return
  if (warm) showTip(el)
  else tipTimer = setTimeout(() => showTip(el), TIP_DELAY_MS)
}

// The element went away or moved, when the panel changed under it.
function syncTip(): void {
  if (!tipTarget) return
  if (tipTarget.getClientRects().length === 0) hideTip()
  else placeTip()
}

/** The element an event happened on, if it is one. */
const elementOf = (e: Event) => (e.target instanceof HTMLElement ? e.target : null)

// From any element under the pointer: over a button's icon, it's an SVG one.
document.addEventListener("pointerover", (e) => hoverTip(e.target instanceof Element ? e.target.closest<HTMLElement>("[data-tip]") : null))
document.documentElement.addEventListener("pointerleave", () => hoverTip(null))
document.addEventListener("pointerdown", hideTip, true)
document.addEventListener("focusin", (e) => {
  const el = elementOf(e)
  if (el?.matches("[data-tip]:focus-visible")) showTip(el)
})
document.addEventListener("focusout", (e) => {
  if (e.target === tipTarget) hideTip()
})
document.addEventListener(
  "keydown",
  (e) => {
    if (e.key === "Escape") hideTip()
  },
  true,
)
document.addEventListener("scroll", hideTip, true)
window.addEventListener("blur", hideTip)

// Space pauses and resumes, anywhere in the panel but the reply box. It doesn't press the focused
// button, which after a click could be End; Enter still does.
document.addEventListener("keydown", (e) => {
  if (e.key !== " " || e.ctrlKey || e.metaKey || e.altKey || !active) return
  if (e.target === ui.reply) return
  e.preventDefault()
  if (e.repeat || turn === "user") return
  vscode.postMessage({ type: paused ? "resume" : "pause" })
})

// File names in messages open the file, URLs open in the browser, and the intro's commands run.
// Links have an href, so they take focus and Enter (#16); it isn't followed.
document.addEventListener("click", (e) => {
  const target = e.target instanceof Element ? e.target : null
  if (target?.closest("a[href]")) e.preventDefault()
  const a = target?.closest<HTMLElement>("a.file, a.url, a.command")
  if (a?.dataset.file) vscode.postMessage({ type: "openFile", file: a.dataset.file })
  if (a?.dataset.url) vscode.postMessage({ type: "openUrl", url: a.dataset.url })
  if (a?.dataset.command) vscode.postMessage({ type: "command", command: a.dataset.command })
})

vscode.postMessage({ type: "ready" })
