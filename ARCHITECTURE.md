# Architecture

The components of the tool, how they find and talk to each other, and how a
pairing session starts and ends. The agent-facing contract is in
[PROTOCOL.md](PROTOCOL.md); the programmer-facing design is in
[DESIGN.md](DESIGN.md).

The diagrams of these components, with a guided tour, are in the interactive
page, [viewable on GitHub Pages][pages] and kept in
[docs/ai-pair.html](docs/ai-pair.html).

[pages]: https://mattyv.github.io/ai-pair/ai-pair.html

Status: describes the 0.35.0 release candidate.

The core `SpeechContext` owns the bounded session-scoped completed narration
buffer and invalidates it when session identity or configuration changes.
The panel supplies accepted identity from its existing replay mechanism. The
local `SpeechService` coordinates playback completion and sends previous text
only to a compatible provider. Delivery
cues travel with narration across the validated local audio boundary.

The source is `.archi/ai-pair.json`. To regenerate the page with
Archi-Techture 1.5.1, set `ARCHI_TO_HTML` to its `out/tools/archi-to-html.js`
path, then run:

```bash
node --input-type=module -e 'import {readFile,writeFile} from "node:fs/promises"; import {normalizeArchitecture as n} from "./scripts/normalize_architecture.ts"; const p=".archi/ai-pair.json"; await writeFile(p,await n(await readFile(p,"utf8"),"json"))'
node "$ARCHI_TO_HTML" --title 'AI Pair architecture' .archi/ai-pair.json \
  -o /tmp/ai-pair-archi-raw.html
node --input-type=module -e 'import {readFile,writeFile} from "node:fs/promises"; import {normalizeArchitecture as n} from "./scripts/normalize_architecture.ts"; await writeFile("docs/ai-pair.html",await n(await readFile("/tmp/ai-pair-archi-raw.html","utf8"),"html"))'
```

The normalizer preserves the diagram data while formatting the export and
representing Unicode with context-appropriate escapes. Validate the bundle
with Archi's `validate-archi.js` and check the regenerated page in a browser.

The GPU local synthesis diagram records the setup, proof and isolated worker
boundaries under construction. On 2026-11-09, Archi 1.5.1 validated the source,
the export was regenerated, and both normalizer test suites passed. An
isolated headless Chromium render showed the GPU diagram with no page errors;
the screenshot was inspected for layout. One supplied AMD system has since
been tested; broader hardware validation remains open.

The guided demo and diagnostics add MCP prompts backed by shipped canonical
skills. Diagnostics uses a bounded temporary connection, independent of the
session owner, to obtain an allowlisted snapshot from the editor and audio
companion. The Archi source passed its 1.5.1 validator on 2026-11-10; its HTML
export was regenerated, the normalizer tests passed, and the overview was
inspected in headless Chromium without page errors.

The speech lifecycle and orderly-restart diagrams were updated on 2026-11-10.
Archi 1.5.1 validated the source, its HTML export was regenerated, and the
normalizer tests passed. The new sequences were inspected in headless
Chromium. The pre-session warmup projection was added to the same source and
regenerated on 2026-11-10; the validator and normalizer tests passed, and the
diagram was inspected in headless Chromium without page errors.

## Components

```text
┌──────────────────┐  stdio (MCP)  ┌────────────┐  WebSocket, 127.0.0.1  ┌─────────────────────────────┐
│  agent harness   │ ────────────▶ │  pair-mcp  │ ─────────────────────▶ │  VS Code extension          │
│  (Claude Code,   │               │  (relay)   │     + auth token       │                             │
│   Codex, ...)    │               └────────────┘                        │   core                      │
└──────────────────┘                                                     │     │                       │
                                                                         │   VS Code adapter           │
                                                                         │     │                       │
                                                                         │   narration panel (webview) │
                                                                         └─────────────────────────────┘
```

-   **`pair-mcp`** is the MCP server the harness launches over stdio. It holds
    the tool schemas, the server instructions, and the `start` prompt, forwards
    every tool call to the extension, and renders the extension's structured
    reports as the text the agent reads. It has no session state of its own.
-   **The core** is an editor-agnostic TypeScript library, running inside the
    extension: sessions, the batch queue, the playback scheduler, place
    resolution, cursor tracking, the event log, and report assembly. It has no
    editor dependencies, so it can be tested against a fake editor. An optional
    deferred reply waits for the player's current action boundary; urgent
    interruptions still stop playback immediately.
-   **The VS Code adapter** is a thin layer over the VS Code API: apply edits
    with undo stops, report document changes, render decorations, scroll, save.
    It identifies its own edits by keeping a queue of pending edits per file
    and matching each change VS Code reports by offset, deleted length, and
    text. An unmatched editor change is classified conservatively; this does
    not establish that a person made it.
-   **Command terminals** are owned by the VS Code adapter. Eligible idle Pair
    terminals can be reused; explicit reveal uses the command ID and reports
    unavailable if its terminal has closed or been reused. Automatic visibility
    is an independent persisted preference.
-   **Code playback** groups the existing atomic edits in the core. For line
    and block modes, the editor adapter highlights each group while the panel
    supplies the existing reading countdown control.
-   **Session diagnostics** keep a bounded allowlisted lifecycle history in
    the VS Code adapter, including speech readiness, button dispatch and fixed
    error categories without requiring a pairing session. The panel requests a
    snapshot explicitly; its clipboard
    export contains no chat, code, paths, command text, output, or tokens.
-   **Spoken narration** is an optional port on the session controller. With the
    local companion installed, the workspace port forwards bounded requests to
    the UI host. One local service owns playback, cancellation and page
    generations for both providers. The same service owns one in-memory,
    context-free attention cue: it reserves the current output route on each
    playback and caches only completed audio. Speech-setting or credential
    changes invalidate it; output-device changes use the new route. The cue is
    excluded from narration context.
    Kokoro uses a local CPU worker after explicit model setup. The optional
    ElevenLabs client sends only spoken narration or an explicit voice preview
    to its fixed HTTPS API. Its API key stays in the local companion's VS Code
    SecretStorage; the panel receives key-presence status and
    bounded voice metadata. Cloud requests have independent deadlines and byte
    limits. Both providers produce bounded WAV audio for a shared output router.
    The companion resolves System default or a selected device to one concrete
    local endpoint before synthesis. Linux uses PipeWire; macOS and Windows use
    bundled CoreAudio and WASAPI helpers. Each physical playback rechecks the
    captured endpoint and never substitutes another. The legacy local path
    without a companion retains webview default audio and the PipeWire override,
    except on a local macOS or Linux desktop. There `SpeechOutputRouter` plays
    the default output from the extension host: through the bundled CoreAudio
    helper on macOS (#82), and through PipeWire's default sink with `pw-play`
    on Linux (#84). The router decides each line's route when it admits the
    line, because a PipeWire default sink can appear or disappear at any time;
    a line already playing keeps its route. Webview audio is the fallback only
    when the macOS helper does not verify against its packaged digest manifest,
    or Linux has no usable PipeWire default sink. Over a remote connection the
    extension host is the remote machine, so this route is never used there.
    The legacy router waits for matching
    browser retirement or actual page disposal, and retains native process
    ownership until close. Page replacement and interruption invalidate the
    active unit. Speech and
    reading complete independently; speech never approves a command or releases
    a reading hold. Every `say` that fits the spoken bounds is spoken unless it
    opts out, one unit at a time in order. After three accepted batches with
    nothing spoken, the
    controller checks current readiness before adding a reminder to a step
    report. The companion readiness query is scoped to the connection epoch and
    returns only a Boolean; it does not synthesize speech or transfer keys,
    narration, or audio. Readiness is a local check, not a promise of future
    playback. History and diagnostics do not retain speech audio.
-   **The narration panel** is a webview. It talks to the extension via
    `postMessage`, with the messages typed in
    [`panel_messages.ts`](packages/vscode/src/panel_messages.ts). Its markup is
    [`panel_html.ts`](packages/vscode/src/panel_html.ts), its styles are
    [`webview/panel.css`](packages/vscode/src/webview/panel.css), built as
    `dist/panel.css`, and its script is
    [`webview/panel.ts`](packages/vscode/src/webview/panel.ts), bundled as
    `dist/panel.js`. The script finds the elements it updates by their `data-ui`
    attribute; the markup has no `id`s.

### Local audio placement

The optional `packages/audio-ui` extension declares `extensionKind: ["ui"]`.
It owns the actual Pair view, local speech configuration, credentials and
output devices. The main extension keeps workspace state and dispatches editor,
file and terminal actions on the workspace host. The `Local audio placement`
diagram shows this boundary, including an isolated SSH placement proof.

The `Companion attachment bootstrap` diagram shows the cross-host sequence.
The workspace first calls `aiPair.localAudio.activate`, which activates the UI
extension through VS Code and returns readiness without creating a token or
session. Activation has a 10-second bound; only a successful response starts
prepare, with its own 1.5-second bound. Prepare validates the private protocol
and epoch without registering a view. The workspace selects the companion
before dispatching commit, and creates its workspace session only after a
successful commit acknowledgement. A missing or
late acknowledgement cannot select another owner or start workspace transport.
Late activation or preparation cannot change the decision. An installed
companion that fails attachment fails closed; a missing companion retains the
legacy local or remote text-only behavior. Deactivation waits for speech
resources to be reaped; a replacement session waits for that retirement.

The hosts exchange versioned allowlisted command frames with separate sequence
numbers per direction. Ordered bounded chunks carry visible panel updates;
keys and audio never enter those frames. A local connection lease stops audio
after a lost workspace connection. Local reply and disposal handling retire
audio before forwarding related workspace actions.

`packages/audio-native` separates logical admission from physical ownership.
Cancellation invalidates pending discovery; playback cannot start after that
cancellation, and a process remains owned through actual close. A saved device
that disappears stays unavailable. Same-graph PipeWire metadata resolves the
Linux default, while the native macOS and Windows helpers enumerate and open
platform endpoint identities. Their manifests contain fixed helper names and
SHA-256 values generated during packaging.

Native build tests, API-level stream tests and physical audibility are distinct
evidence. A runner without an output reports its stream test as skipped. Local
Kokoro runtime support remains Linux x64/glibc; the audio interface does not
claim broader synthesis support.

### Why a relay

Every harness supports stdio MCP servers, and a stdio config is static: "run
this command". If the extension served MCP over HTTP directly, the harness would
need a URL whose port changes with every VS Code window. The relay keeps the
harness config fixed and resolves which editor to talk to at runtime.

### Why the core runs inside the extension

It's simpler, and playback timing stays next to the editor. The core could later
become a separate process with thin editor clients (like a language server with
document sync), which may be needed for Zed. That move wouldn't change the
protocol.

## Discovery and connection

**Each VS Code window registers itself.** On activation, the extension starts a
WebSocket server on a random port bound to `127.0.0.1`, and writes a discovery
file:

```jsonc
// ~/.ai-pair/windows/<pid>.json   (mode 0600)
{
  "pid": 41234,
  "workspaceFolders": ["/Users/me/projects/todo-app"],
  "port": 53817,
  "token": "...",             // random, per window
  "protocolVersion": 6,
  "lastFocused": 1758700000000   // epoch ms, updated when the window gains focus
}
```

The file is removed on deactivation.

**The relay finds its window lazily**, when a session starts, not at launch. The
editor may be opened after the harness. To find the window it:

1.  If `start` supplies a working directory, validates that it is an existing
    absolute directory and selects it alone. Otherwise, gathers the harness's
    MCP roots and the relay's working directory as candidates.
2.  Reads discovery files, drops stale ones (the process is gone), and finds
    the first candidate contained in an open window. An explicit directory
    never falls back to another candidate.
3.  Picks the window whose workspace folder contains it (the longest match). On
    a tie, it picks the most recently focused.
4.  Checks the selected window's extension version and relay digest against
    the running relay. Missing or mismatched identity fails with update and
    reconnect guidance before forwarding a call.
5.  Connects and authenticates with the token and protocol version.

Older relays already running cannot enforce the identity check; restart them
after updating and reloading every window.

If no window matches, `start` fails with a clear message: "Open
`/Users/me/projects/todo-app` in VS Code with the extension installed."

**Relay <-> extension messages** are JSON objects with a `type` field, over the
WebSocket, mirroring the MCP tool calls one to one:

-   `hello { token, protocolVersion }`: the handshake, answered with `welcome`,
    or with `rejected { reason }` for a wrong token or another protocol version.
-   `call { id, tool, args }` -> `result { id, ... }` or `error { id, ... }`.
-   `cancel { id }`: forwarded when the harness cancels a tool call, for example
    when the programmer presses Esc in the harness.
-   `return { report, mayRepeat? }`: a report that arrived for a call the relay
    had already cancelled, handed back to be delivered again (see below).
    `mayRepeat` marks one whose cancel came after the answer, which the agent
    may have seen.

**Cancelling a call doesn't affect the session.** A cancelled `step` has already
queued its batch, and its outcome is reported on the next call. Cancellation
just releases the blocked call, without taking a report.

**Reports survive a race with cancellation.** A cancellation takes a moment to
reach the editor. If the call returns in that moment (say, because the
programmer just wrote a message), the harness has already given up on it and the
report would be lost. So the relay sends such a report back, and the editor puts
its batches and events back to be reported again. The WebSocket is ordered, so
this happens before the agent's next call arrives.

**Paths are relative to the agent's working directory.** The relay sends the
working directory it found with `start`, and the session resolves and reports
paths relative to it, which may be a subfolder of the workspace.

## Sessions

Each editing batch names its file before the first edit. The player refuses a
second named file or an edit at a cursor in another file. Rehearsal runs the
same checks before the batch is queued. An explicit structural newline splits
an adjacent matching pair in Python or JSON code; its conservative lexical
scanner refuses strings, comments, and ambiguous formatted-string expressions.
It is not a Python grammar parser.

After playback the editor reports advisory diagnostics for edited files. VS
Code diagnostics are snapshots with unconfirmed freshness and can be
unavailable. Python files also get a syntax check using system `python3`,
which can differ from the project interpreter.
Warnings report limitations and failures of these checks.

**One MCP connection can host many pairing sessions, one after another.** The
programmer works in the harness as usual, starts pairing when they want to, ends
it, goes back to the harness, and may pair again later.

A **session**:

-   **starts** when the agent calls `start`, typically because the programmer
    asked it to pair, or ran the `start` prompt. The panel opens.
-   **ends** when:
    - the programmer presses End session in the panel, or
    - the agent calls `end` (e.g. the programmer said they're done), or
    - the agent's `start` from another directory replaces a suspended one, or
    - the window closes.
-   **is suspended**, not ended, when the relay disconnects (the harness exited)
    or the window reloads (#25). It keeps its turn, the agent's cursor and
    selection, its directory, and the panel's history, in memory and in the
    workspace's storage, until the programmer ends it, or the agent's `start`
    from the same directory resumes it. Messages the programmer sends meanwhile
    reach the agent when it's back. Nothing plays meanwhile: what was queued is
    discarded, and reported then.
-   **belongs to one window**, and a window has at most one session at a time. A
    `start` while another session is active in that window is rejected.

Outside a session, pair tools other than `start` fail with `no_session`, so an
agent can't accidentally drive the editor when the programmer isn't pairing. The
programmer's edits between sessions aren't tracked. A new session starts fresh,
and the agent should re-read what it needs. So does an agent whose session
resumes: it may be a new conversation, so it has seen no lines, and it reads
them again before it gives a line number.

The panel keeps each session's narration history. Between sessions it shows "No
active session", and how to start one. While a session is suspended, it keeps
its history, and its status says it's waiting for the agent.

## Starting a session

**First-time setup.** The command *AI Pair: Set Up Agent* registers `pair-mcp`
with the harnesses the programmer picks, in each one's user-wide MCP
configuration, so it works in every project. It edits only the `pair` entry,
keeping the rest of the file as it was: JSON and JSONC with `jsonc-parser`,
Codex's TOML as text, table by table (a TOML round trip would drop comments).
For Claude Code it runs `claude mcp add --scope user` when the `claude` command
is there, since Claude Code rewrites `~/.claude.json` constantly. For any other
harness it copies the config snippet to the clipboard. The extension
offers this once, the first time it starts. The harnesses and their files are in
[`agents.ts`](packages/vscode/src/agents.ts).

**Each session.** The programmer asks the agent to pair ("let's pair on adding a
todos API, I'm new to Express"), or runs the server's `start` prompt (in Claude
Code: `/mcp__pair__start`). The agent calls `start`, which returns the [agent
guide](AGENT_GUIDE.md) along with the first report.

**From the panel.** With Claude Code's CLI installed and set up for the pair
server, and a folder open, the idle view offers **Start a session**: it runs
`claude -p "start pairing session" --allowedTools mcp__pair` in the first
workspace folder, as the process of a terminal that is never shown, so the Pair
panel stays in front (#107, #115, `specs/Start.tla`). Print mode sends the
prompt at once, and the agent's turn lasts the whole session, so the CLI exits
when the session ends and its terminal closes with it. Print mode refuses any
tool that would ask for permission, so the pair server's tools are allowed on
the command line; every other tool follows the programmer's own Claude Code
settings. A second start while that terminal is open does nothing. Until the
agent's `start` lands, the idle view says a session is starting; the note also
goes when the CLI exits without starting one, since `start()` resolves when the
terminal closes (#118). The panel asks again after Set Up Agent. Claude Code's
extension is not used: its open command only fills its input box, which needs
Enter pressed there, and it rewrites `claudeCode.preferredLocation` to `panel`.
Other harnesses keep the text asking the programmer to ask their agent.

## Distribution

`pair-mcp` is **bundled inside the extension**, not published separately, so the
relay and the extension can never be out of sync.

The extension's install path changes with every version, so on activation the
extension writes a launcher at a fixed path, `~/.ai-pair/bin/pair-mcp`
(`pair-mcp.cmd` on Windows), pointing at the current version. The launcher runs
the relay with VS Code's own runtime (`ELECTRON_RUN_AS_NODE=1`), so the
programmer doesn't need Node installed.

GitHub Actions checks and packages the extension on Ubuntu, then uploads a VSIX
artifact named with its version and commit. The artifact can be downloaded and
installed on an Ubuntu host. After reloading VS Code, the runtime reports the
bundled version and build identity, allowing the running build to be checked.

## Repository layout

```text
packages/
  protocol/   types of the agent protocol and the relay <-> editor messages
  core/       editor-agnostic session and playback logic, and the WebSocket
              server (bridge) with discovery
  relay/      pair-mcp: stdio MCP <-> WebSocket; tool schemas, instructions,
              the start prompt; bundles AGENT_GUIDE.md at build time
  vscode/     the extension: adapter, panel, launcher, setup; ships the relay
```

TypeScript throughout, npm workspaces, bundled with esbuild. The relay uses the
official MCP TypeScript SDK.

## Out of scope for v1

-   **Permission prompts.** When the harness asks for permission, it notifies
    the programmer itself.
-   **Starting from the editor** (see above).
-   **Multiple agents** in one window.
-   **Zed.**

## Bounded sentence narration

Bounded sentence pipelining is implemented for local Kokoro narration. The Archi
`Sentence narration` diagram records its ownership boundaries.

-   One admitted narration text keeps one reading clock and one concrete output
    lease for all of its parts. Showing the text, the reading pace and command
    approval do not depend on sentence boundaries.
-   `speech_segments.ts` splits the text into at most four parts, each an exact
    slice of the source. The last part takes any remainder, and text that cannot
    be split with certainty stays whole.
-   The warm local client synthesizes one next part while the current part
    plays, so there is at most one inference and one part of lookahead. Each
    physical output retires before the next part starts, and the unit finishes
    only on its final part.
-   Only text already admitted for the unit is synthesized. Future cloud
    narration is never synthesized ahead, and an explanation is never dropped to
    catch up.
-   ElevenLabs keeps one request per unit, and the legacy output path stays one
    waveform.

The pipeline still needs final review and packaged verification before release.

## Local speech lifecycle

`SpeechLifecycle` is the single owner of the requested CPU/GPU mode, generation,
setup or inference proof, worker lease and actual backend. `SpeechService` owns
narration, chunks, tempo and playback and acquires a unit-bound lease from the
manager. Host settings and status project the manager's snapshot; they do not
own a second backend state. The Archi `Warm local synthesis` diagram shows the
ports, and `specs/SpeechLifecycle.tla` models exclusive ownership and progress.

The same manager owns pre-session warmup demand. Enabled Kokoro settings at
host startup request preparation without waiting for MCP `start`; disabled
speech or a cloud provider withdraws that demand. Preparation uses the existing
serialized resource slot and releases its unit lease when the worker is ready,
retaining that worker for narration. It does not synthesize, play audio or
download missing models. The toolbar projects checking/loading as an orange
pulse, with reduced motion respected, and requires actual worker readiness
before reporting local voice ready. Independent output checks still apply.

A mode change invalidates the previous generation and requests abort or worker
retirement. Abort and retirement do not themselves release ownership: GPU proof
settles only after its children close, and a worker lease lasts until the actual
exit event. The current request waits for cleanup, then resolves CPU resources
or requests fresh GPU proof and loads the selected worker. Explicit GPU fails
closed; Auto can fall back only after failed proof has been reaped. The Archi
`Proof cancellation and CPU acquisition` sequence shows this path.

On macOS arm64 the main extension's GPU path is Core ML (#42,
`specs/CoreMlCompute.tla`). `speech_coreml.ts` gives `SpeechService` a
`createCoreMl` factory: the GPU proof is a light check of the runtime and the
installed q8 model, and the launch starts the CPU worker with
`device: 'coreml'`, which builds the Kokoro model with
`executionProviders: ['coreml']`. A session Core ML cannot create fails the
load, so the backend is reported as GPU only by a loaded worker. Core ML
compiles the model on every load (13 to 34 seconds measured), so that worker's
load timeout is 120 seconds. **Set up GPU** loads the model in such a worker
and retires it. The panel offers GPU and Auto only where `gpuSupported()` says
a GPU path exists.

Generation and unit identity fence discovery, progress, ready, result and exit
callbacks. Cancellation, timeout, disposal or a later selection prevents stale
work from starting a replacement, publishing readiness or playing audio.
Deactivation awaits reaping before another host or service can own the slot.
The `Speech orderly restart` sequence shows that boundary and the commit
acknowledgement before workspace session creation. Restart restores preferences,
not workers, proofs, capabilities, pending checks or output reservations.

The worker protocol remains versioned and validated. CPU and GPU clients hold
their worker until exit; failure categories stay fixed and exclude free text.
The model and runtime pins, native trust checks, provider, output admission and
chunk/tempo behavior remain unchanged.

Unit tests and composed fake transports exercise ownership, cancellation and
switching; a real child-process test exercises proof abort and close. Isolated
packaged-host cold starts and reloads restored CPU, GPU and Auto preferences
with speech disabled and device discovery blocked. They check attachment and
cached facts, not GPU synthesis. Physical AMD hardware validation and audible
output for this revision remain open.

## Independent listening speed

The listening-rate control is experimental. It snapshots its rate once per
narration unit. A separate tempo worker processes the tail-free mono PCM with a
transient-aware overlap-add transform, which keeps the pitch. The service then
frames the actual transformed samples and appends the fixed thinking tail once.

-   Rate 1.0 bypasses processing byte for byte. So does an input shorter than
    3072 samples, which stays within one window of every target length.
-   Admitting a unit at a rate other than 1.0 waits until the tempo worker has
    retired, as well as the local synthesis slot.
-   Cancellation keeps the tempo worker's slot until it actually terminates, and
    stale unit or part responses cannot restart audio.
-   The synthesis-speed controls, the reading clock and the code pace stay
    separate from listening speed.

The Archi `Speech tempo` diagram shows the boundaries. Offline metrics do not
establish human listening quality.

## Local runtime support evidence

Kokoro support requires a local Linux x64 host and positive GNU libc evidence.
The shared platform detector checks Node's runtime report first, then reads
bounded mappings of the same running process if the report is unavailable. It
accepts exact GNU libc and loader records, including older versioned names;
musl, deleted, malformed, oversized and inaccessible evidence remains blocked.
The main host retains its remote-workspace guard; the local UI companion checks
its own process. Only fixed reason codes enter diagnostics. Model presence is
reported as setup state, separately from platform capability. This fallback
does not prove compatibility with every glibc layout or native library build.

Synchronous diagnostic observer errors are isolated by one shared core helper.
Callers retain their original receivers and read the current callback for each
event. The helper suppresses thrown observer errors while preserving operation
progress; it does not prevent intentional reentrant side effects.

## Companion status compatibility

Private workspace-to-companion protocol version 2 carries the number of
accepted batches that have not started. A new workspace refuses an installed
incompatible companion before selecting an owner and asks for both extensions
to be updated and reloaded. The new companion rejects older preparation and
shows the same guidance. An already-installed older workspace can still
select its own legacy fallback. The public MCP protocol is unchanged.

GPU compute selection and setup status are local speech controls. The companion
handles actions in its own panel, and the generic sender filters unsupported
updates; neither produces a private transport frame. This leaves version 2
and the public MCP protocol unchanged. An older companion
does not offer the GPU controls. The companion panel routing test verifies the
local boundary.

The voice toolbar button projects existing cached audio facts through the local
panel channel. It adds no process, device probe or component boundary; the
source model and generated export retain the current attachment architecture.

## OpenRouter cloud speech

OpenRouter uses the existing `SpeechService` cloud slot and the same local
output router as ElevenLabs. It does not own a second playback lifecycle.
The local host owns a separate SecretStorage credential, selected model,
voice and ZDR preference. Each admitted narration snapshots those preferences;
changes invalidate stale catalog and synthesis work.

The provider client reads the authenticated account catalog before applying
the optional ZDR intersection. Public discovery never substitutes for account
eligibility. The filter sends OpenRouter's ZDR request policy without claiming
to override account Safety Retention settings. The user selects PCM or MP3;
the provider client reserves local decode capacity before the paid request, and
a local browser decoder normalizes the response to the existing bounded WAV
contract. Each locally owned panel has its own decoder bridge. A boot token
scopes probes and results to one actual webview document; disposal retires that
document, while visibility changes do not. Decoder messages stay local and
bypass companion panel forwarding. Missing credentials, rejected policy,
unsupported formats and malformed output fail within speech; editing and
readable narration remain available. Archi-Techture 1.5.1 validated the updated
source, the HTML export was regenerated and normalized, and the normalizer tests
passed. Headless Chromium rendered the VS Code integration view without page
errors; the decoder boundary and its connections were visually checked.

The local credential host owns a `SessionSpeechCost` ledger and uses the
OpenRouter generation ID to request the provider's reported `total_cost`.
Its request captures the Pair session before admission; a late result cannot
change a later session. The cost lookup is bounded, uses the same credential
snapshot as synthesis, and does not delay playback. The panel displays the
confirmed subtotal with pending or incomplete status. Settings previews do
not count. A restored host cannot reconstruct earlier costs, so it marks the
session partial. The source model and HTML export include the local ledger and
the existing OpenRouter boundary; the model was validated with Archi-Techture
1.5.1 and the HTML regenerated and normalized with the repository script.

Usage lookup starts after the synthesis response settles, so an unfinished
audio stream cannot consume the publication retry window. Five bounded GET
attempts use delays of 1, 2, 4 and 8 seconds; each attempt has a five-second
deadline. This is an eventual-consistency allowance, not a provider timing
guarantee. Fixed cost-reason categories explain missing generation IDs,
unpublished costs, failed lookups and restored-session gaps without exposing
credentials, IDs, narration or provider responses.

Command approval grants remain owned by the controller's session. The panel
renders its authoritative approval snapshot and forwards revocation through
the same companion transport as other controls. Requiring approval clears
both all-command and exact-command grants and enables command confirmation.
It applies to subsequent commands and does not stop a command already running.

Spoken `say` actions default to `speech_mode: "wait"`. An explicit `"continue"`
keeps the normal reading pause but allows following actions to run before the
voice finishes. The session's player holds one logical outstanding-speech
barrier: a later spoken message waits behind it rather than starting a second
voice or building an unbounded speech queue. Questions use wait mode followed
by `listen`; speech completion alone does not imply a programmer reply.

Logical speech completion does not establish physical retirement. The existing
narration port and output owners retain that responsibility. Remote admission
waits for a matching terminal acknowledgement with a separate three-second
retirement bound and abort/disposal cleanup. Unavailable admission leaves the
text visible and reports unavailable speech. Session end and interruption stop
remaining asynchronous speech; they do not add a new session-end drain phase.

## Raise-hand interjection

The controller owns the session-scoped attention request and hold. The player
reaches a safe edit or reading boundary and drains its current logical
speech before granting the floor. The hold blocks subsequent work without
pausing the fixed acknowledgement cue. A separate derived `speechPaused`
projection preserves ordinary audio pauses while the panel shows work held.
The page renders this state; it does not schedule the transition itself.

The local speech service owns one in-memory, context-free acknowledgement
waveform and uses the existing synthesis, tempo, output-admission and retirement
paths. Relevant settings or credential changes invalidate it. A cache miss is
synthesized only on use; a hit selects the current output without another
provider request. Failed or canceled playback cannot populate the cache.

The Archi source includes the `Raise-hand interjection` ownership diagram and
updates the speech-service responsibility. Archi-Techture 1.5.1 validated the
source; its HTML export was regenerated and normalized. Both normalizer suites
passed, and headless Chromium rendered the new diagram without page errors.
Its labels and connections were visually inspected. This establishes diagram
validity and rendering, not hardware audibility.

The production extension forwards the required `attentionCue` narration method
through the same selected-owner, readiness and cancellation-generation checks
as ordinary speech. A missing forwarding method is rejected by the internal
port type. The existing Archi connection and owners remain accurate; this
adapter correction does not add a new boundary or a second state machine.

## Navigator activity reports

The editor adapter mirrors workspace documents and the current Pair cursor
file outside the workspace. Cursor changes or session cleanup retire that
outside-file interest. This fixes temporary-file edits being discarded before
they reached the controller; it does not add a global outside-file watcher.
The native caret is a read-only port fact, separate from the agent cursor.

The controller owns typing-pause evidence, timer identity and acknowledgement.
It snapshots edit facts for a report, leaving later changes for the next call.
An idle timeout does not consume the only opportunity to report a later pause.
The relay renders the return reason, elapsed wait, numbered diffs and programmer
cursor. It does not infer activity from changes to the agent cursor window.

The Archi `Navigator activity reports` view identifies these owners and the
MCP boundary. The source model and generated export change together. Queued
navigator commentary still follows immediate-message cancellation; the guide
adapts the commentary cadence rather than adding a second queue lifecycle.

The navigator diagram source passed the Archi-Techture 1.5.1 validator. Its
HTML export was regenerated and normalized with the repository helper. Both
normalizer test suites passed. Chromium rendered the navigator view without
page errors; owner labels and connections were visually inspected.

## Navigator commentary configuration

The workspace extension owns the saved commentary preference and updates the
controller through its existing configuration boundary. The companion forwards
settings intent over typed panel messages and displays the owner's snapshot.
The preference is not part of local speech readiness or provider settings.

The controller projects the latest preference after asynchronous report work.
The relay renders its advisory policy for startup and navigator reports. Report
restoration replays activity facts, never old configuration. A changed mode
adds a session-scoped notice and wakes a waiting `listen` with a settings-only
response, including during queued speech. If no call is waiting, the next
`listen` returns the notice. Same-value writes do nothing. Ordinary activity
snapshots, batch completion, typing-pause acknowledgement and turn ownership
are untouched. Canceled notices retry only for their matching generation.
The Archi Navigator view separates this path from activity evidence.

The private workspace-to-companion contract is version 7 for the strict
commentary action/update messages and shortcut configuration action. Both
extensions must be updated together;
incompatible peers are rejected rather than silently ignoring the setting.
This does not change the editor-relay protocol version.

Archi-Techture 1.5.1 validated the updated source. Its generated HTML export
was normalized and rendered in Chromium without page errors; preference owner,
activity owner and their connections were visually inspected.

## Navigator follow-up boundaries

The controller records visible diff-line identities at the report snapshot;
replayed historical diffs cannot authorize successor identities. A non-mutating
tracked-text guard also withholds sightings from an older pending edit report
after a newer agent edit; it cannot reset the live line tracker. Edit
interruption provenance is independent of programmer authorship. Navigator
wake admission considers pending meaningful changes and meaningful activity
already reported during the current unacknowledged typing burst, preserving
timeout-before-pause behavior while suppressing unreported type-and-undo noise.

Plain handback preserves eligible talk-only work. Its rehearsal basis follows
programmer edits and the authoritative new turn. Browser, panel and companion
forward no-message turn intent to the workspace instead of eagerly canceling
from replicated turn state. Explicit new direction still cancels. Existing
local/remote narration owners retain retirement; this adds no audio lifecycle.

Plain turn changes preserve manual Pause rather than clear local pause reasons
before the workspace decision arrives. Draft-empty events retain their own
pause semantics. This avoids a paused-audio restart without another pending
intent owner; explicit Resume releases manual Pause. Message/selection handback
retains cancellation before resume.

## Command reporting and shell submission

PairTerminals owns exact VS Code execution identity, terminal reuse and bounded
output. Its completion promise includes the final tail after bounded drain,
known exit code or explicit terminal-closed status. A timeout ends only the
foreground wait; it does not retire or release a live terminal.

Player owns the active command and pending background metadata. Controller
combines this with its confirmation state for report snapshots. The terminal
callback reaches a session-bound completion callback; Controller records it as
noninterrupting command news, with replay on canceled delivery. This preserves
queued playback and prevents predecessor results entering a successor session.
Every report carries the logical session's immutable UUID, persisted on save
and retained on revive. Restore validates this origin before replaying any
facts or resurrecting a closed session, rather than relying on object identity
that would be lost at the JSON wire boundary.

For identified Bash only, terminal submission encodes multi-line original text
as one physical builtin-eval command. It adds no subprocess or temporary-script
owner. Original command text remains at the approval/report boundary. Other
shells retain original submission; the exact-ID completion rule never relaxes.
If shell identity is unknown, multiline submission waits at most 500 ms for
VS Code's terminal state; interruption or closure stops it. An unresolved
identity retains the original submission, without guessing a shell.
The editor-relay wire version is 6 for the new command event. The local audio
contract remains 6 because no new panel message is introduced.

The native integration harness generates each packaged fixture under its
owning extension root, ensuring framework stubs use that extension's VS Code
API facade. Temporary fixture directories are removed on success or failure.
Relocated GPU fixtures receive an explicit workspace Node path. Development
bundles provide source-mapped coverage; packaged probes verify shipped behavior
without claiming source coverage from a production bundle with no source map.

Pair shortcut dispatch stays with VS Code's keybinding service. The workspace
commands delegate to the existing session and attention owners; the panel
retains only a pending focus request until its page is ready. The companion
forwards the Settings action over the existing validated panel boundary.
