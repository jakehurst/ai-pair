# Changelog

## 0.42.0

-   Play speech on a Linux desktop through PipeWire's default sink from the
    extension host, the same way Macs use the CoreAudio helper. Speech no
    longer waits for a click in the Pair panel. It needs `pw-play`, `pw-dump`
    and `setpriv`; without them, or with no default sink, speech plays in the
    panel as before. Each line checks the default sink when it starts, so a
    sink that disappears sends the next line to the panel (#84).
-   Use the system default route only on a local desktop. Over a remote
    connection the extension host is the remote machine, so its speakers are
    never used (#84).

## 0.41.0

-   Play speech on a Mac through a bundled CoreAudio helper on the system
    default output, from the extension host instead of the Pair panel. Speech
    no longer waits for a click in the panel after a reload, and keeps playing
    while the panel page is rebuilt. If the helper cannot run, speech plays in
    the panel as before (#82).

## 0.40.0

-   Run Kokoro GPU speech on Apple silicon Macs through Core ML, with the CPU
    model and no extra download. The first load takes 15 to 35 seconds and it is
    not faster than the CPU; explicit GPU still never falls back to the CPU
    (#42).
-   Offer GPU and Auto only on a computer with a GPU path. Elsewhere, including
    Intel Macs and Windows, they are disabled and Settings says to choose CPU;
    a saved GPU setting there now says so instead of "Check GPU setup".

## 0.39.2

-   Warn when the old AI Pair (`michalstrba.ai-pair`) is still installed: it
    runs beside this one and leaves the agent's relay on the old version. The
    warning uninstalls it, and says to add speech API keys again, which VS Code
    keeps per extension and cannot carry over.

## 0.39.1

-   Keep the first narration after a window reload instead of dropping it. The
    browser refuses to play sound before a click or keypress in the Pair panel;
    the line now starts on that first gesture, or is given up after the usual
    20 second start timeout (#77).
-   Use Control+Shift shortcut defaults on macOS; keep the existing defaults
    on Windows and Linux.

## 0.39.0

-   Add configurable session shortcuts for pause, the hand control and reply
    focus through VS Code Keyboard Shortcuts and Pair Settings.

## 0.38.3

-   Report command approval and pending completion during MCP waits, including
    background commands and later observed exits with bounded output.
-   Submit multi-line Bash commands as one encoded line to preserve shell
    integration capture for heredoc pipelines. Keep original approval text.
-   Wait briefly for a new terminal's shell identity before submitting a
    multi-line command, while preserving cancellation and unknown-shell fallback.
-   Update the editor-relay wire contract; reconnect Pair after updating.

## 0.38.2

-   Deliver changed navigator commentary preferences immediately through a
    waiting MCP listen, without interrupting speech or consuming edit and
    batch reports. Retain updates for the next listen and canceled retries.

## 0.38.1

-   Recognize visible navigator diff lines under the existing line-staleness
    rules. Preserve queued observations on a plain handback without a message.
-   Suppress net-zero navigator change reports and typing-pause wakes while
    retaining meaningful activity already reported by a timeout.

## 0.38.0

-   Add persistent Quiet, Helpful and Coach navigator commentary preferences.
    Apply changes on the next report in active sessions and synchronize the
    local companion. Keep speech enablement independent.

## 0.37.1

-   Observe programmer edits in the current Pair file outside the workspace,
    including temporary files, without monitoring unrelated outside documents.
-   Report navigator wake reasons, elapsed wait time, edits and the programmer
    cursor. Use a shorter navigator idle limit and retain typing-pause evidence
    across timeout reports.
-   Align published speech fields with validation and clarify delivery cues as
    advisory. Guide requested live commentary without retaining stale queued
    observations after a programmer message.

## 0.37.0

-   Demonstrate the hand control in the guided demo and clean up verified
    temporary files after the programmer agrees to end.

## 0.36.1

-   Forward the fixed interjection voice prompt through the production narration
    adapter, with the same ownership and cancellation checks as speech.
-   Reveal the agent's current cursor while it moves during editor navigation.
-   Move the hand control to the left of Reply; a pending second click cancels
    the interjection request.

## 0.36.0

-   Add a raise-hand control beside Reply to request a pause after the current
    explanation, with a locally cached voice acknowledgement.
-   Add a control beside Pause to reveal the agent cursor in the editor.
-   Connect narration to verified earlier work and support a requested teaching
    style without requiring exercises or changing agent configuration.

## 0.35.0

-   Add optional bounded narration context and model-supported delivery cues.

-   Report word and Unicode character counts when selected spoken narration is
    rejected, so agents can shorten it.

## 0.34.0

-   Show provider-confirmed OpenRouter speech costs as a compact toolbar
    subtotal, with precise amounts and missing-cost explanations on hover or
    keyboard focus. Wait for speech responses to settle before looking up
    costs, and retry unpublished generation records within a bounded window.
-   Add session-wide command approval and a Require command approval control
    that immediately clears remembered grants and re-enables confirmation.
-   Keep listening speed available across speech providers with finer slider
    control. Add an optional command-approval sound and toolbar narration mute.
-   Let agents choose `speech_mode: "continue"` for spoken narration over
    subsequent typing. The default `"wait"` finishes speaking before the next
    action; later spoken messages remain ordered. Ending the session stops
    any outstanding asynchronous speech.
-   Keep Pair open at task completion: guide agents to summarize through Pair
    and listen until the programmer explicitly ends the session.
-   Add a bounded scripted MCP agent regression gate for combined playback,
    approval, interruption and reconnect flows, with reproducible failure traces.

## 0.33.0

-   Discover OpenRouter speech models from the authenticated account, including
    models without an advertised voice. Choose PCM or MP3; a locally owned
    browser decoder normalizes supported responses for the existing speech
    output route. Decoder admission happens before the paid request, and webview
    reloads, failures and cancellation retire the correct request safely.
-   OpenRouter does not publish codec compatibility in its model catalog.
    Listed models may reject the chosen response format, voice or standard text
    input; provider-specific parameters are not inferred.
-   Show OpenRouter's advertised input and output rates in the model choices.
    Billing units vary by model, so the exact catalog rates are shown without
    guessing a unit.

## 0.32.0

-   Add OpenRouter speech with secure credentials, dynamically loaded
    account-filtered model and voice choices, and a ZDR policy filter. This
    version plays only its verified 24 kHz mono PCM contract; some listed
    models may use an unsupported response format.
-   Keep previews and narration on the existing speech output route and
    cancellation path.

## 0.31.0

-   New icon: two speech bubbles as characters, a grey one for you and an
    orange one for the agent, with text-cursor eyes. It stays readable at the
    small sizes VS Code shows it.
-   Publish under the `mattyv` publisher, so the extension's ID is now
    `mattyv.ai-pair` and the companion's `mattyv.ai-pair-local-audio`. The
    repository, homepage, and issue links point at this fork.

## 0.30.0

-   Keep toolbar controls accessible in narrow panels and popup menus inside
    the panel viewport, adapting the layout from upstream PR #19.

## 0.29.0

-   Speak every short message of the agent, in order, instead of at most one
    selected message per batch: with speech enabled you can keep your eyes on
    the code and still hear when the agent needs you. A message over 45 words
    or 280 characters is shown without speech, and the agent can keep a
    message silent with `speak: false`. The scripted demo speaks as well.
    With ElevenLabs, this sends every spoken message to the provider.

## 0.28.0

-   Run local Kokoro speech on macOS, on Apple silicon and Intel Macs, as well
    as on Linux x64. Each Mac architecture has its own VSIX; GPU acceleration
    remains Linux only.
-   Fix narration that failed with "Audio could not play" when it started long
    after the last click: one click or keypress in the panel now enables
    audio for the rest of the session.
-   Fix the voice indicator staying grey ("readiness not checked") when
    narration plays in the panel, the default output: it now turns green once
    the voice is ready.

## 0.27.0

-   Invite an optional programmer edit in the guided demo and provide a useful
    navigator comment based on the observed edit.

## 0.26.0

-   Prepare enabled Kokoro speech before pairing starts, using the speech
    lifecycle manager for startup, switching and shutdown.
-   Show an orange pulsing voice indicator while the local model starts, with
    a static indicator when reduced motion is requested.

## 0.25.2

-   Keep speech setup, CPU/GPU switches and restart recovery coordinated while
    prior proof and workers finish shutting down.

## 0.25.1

-   Switch local speech between CPU and GPU after the previous worker exits,
    and distinguish model setup from live worker readiness.

## 0.25.0

-   Show cached voice readiness beside the toolbar controls, with explanatory
    tooltips and direct access to speech settings.

## 0.24.2

-   Give Local Audio activation its own bounded startup interval and record
    activation and prepare timings for connection diagnosis.

-   Make diagnostics and the output log accessible when the Pair panel cannot
    connect to Local Audio.

## 0.24.1

-   Restore a saved speech output device on startup without opening Settings,
    while preserving missing-device reporting and shutdown safety.

-   Clarify speech model and compute settings, with technical details collapsed.

## 0.24.0

-   Add real-session demo and read-only diagnostic MCP prompts, including
    privacy-preserving speech and audio status.

## 0.23.2

-   Preserve the untyped remainder when a programmer edit interrupts typing
    and the editor rejects the in-flight edit.

-   Correct distorted GPU voice output by routing one affected model operation
    through the CPU while keeping the remaining GPU checks and computation.

## 0.23.1

-   Fix GPU worker communication when VS Code and its bundled worker use
    different Node and V8 versions.

## 0.23.0

-   Add experimental local Kokoro GPU setup with a separate pinned model,
    physical-device checks, and a guarded isolated inference worker. CPU
    remains the default. Physical AMD hardware validation is pending.

## 0.22.1

-   Show a more specific, safe reason when ElevenLabs narration fails and
    include its failure category in copied speech diagnostics.

## 0.22.0

-   Deliver completed command output to a waiting agent promptly, including
    while later work is queued.
-   Show queued work and waiting, approval, and playback states in the panel.
-   Require compatible private connection versions for AI Pair and Local
    Audio. Update both extensions and reload if they cannot connect.

## 0.21.3

-   Reject a relay whose version or packaged runtime differs from the running
    editor, with guidance to restart pairing.
-   Restart batch numbering for a fresh session while preserving it on resume.

## 0.21.2

-   Route pairing requests only to the VS Code workspace matching their working
    directory, and report a mismatch instead of selecting another workspace.
-   Report the VS Code diagnostic snapshot caveat once per session while still
    reporting each diagnostic and any specific check failures.

## 0.21.1

-   Move reply timing into Settings as a persistent choice, with immediate
    interruption as the default.

## 0.21.0

-   Show the local Kokoro model's download and verification status, local
    path, and pinned source in speech settings.
-   Offer **Finish current action before sending** for replies, preserving
    immediate interruption for Stop and editor changes.
-   Encourage concise selected speech and remind the agent after three batches
    without it when speech is enabled and available.
-   Preserve the next batch ID across saved-session recovery to avoid reusing
    already reported IDs after a normal reload.

## 0.20.1

-   Verify local Kokoro platform support using bounded evidence from the running
    process when Node's system report is unavailable. Keep unsupported or
    unverified hosts blocked, with a more specific diagnostic reason.

## 0.20.0

-   Pipeline local Kokoro narration as bounded sentence parts while retaining
    one displayed message, reading clock and concrete output route. Hold unit
    completion until the final playback process retires. ElevenLabs retains
    one synthesis request per narration.
-   Add an experimental **Listening speed** (0.75 to 1.5, default 1) that changes
    narration tempo without changing pitch, independently of the provider voice
    speed, the reading pace and the code pace. It is sampled once per narration,
    applies to the next narration or preview, needs no extra cloud request, and
    leaves the audio byte for byte unchanged at 1. Listening quality at other
    rates has not been validated by people.
-   Run local Kokoro behind a versioned warm-worker protocol and one client:
    the model stays loaded between narrations, stale or late worker responses
    are rejected, a canceled narration is never replayed, and a replacement
    worker starts only after the previous one has exited.

## 0.19.0

-   Use the optional AI Pair Local Audio companion to keep the Pair panel,
    speech, credentials and output selection on the local client, including in
    remote workspaces. Install the companion locally and reload the window.
-   Support local output selection through PipeWire, CoreAudio and WASAPI where
    the packaged platform helper and selected device are available. Kokoro
    synthesis remains limited to supported Linux x64 systems.

## 0.18.2

- Fix local Kokoro speech startup in Snap installations with an older C runtime.

## 0.18.1

- Discover Linux PipeWire outputs without requiring PulseAudio tools.

## 0.18.0

-   Choose a speech output independently of voice provider: keep System default,
    or select an available local PipeWire output on Linux. Refresh outputs in
    Settings to list devices. The choice is stored locally and is not synced.
-   A missing or unavailable override reports an error instead of silently
    playing through another output. Preview uses the chosen route for Kokoro
    and ElevenLabs.

## 0.17.1

-   Identify local speech startup failures with fixed diagnostic categories for
    worker modules, native loading, permissions, model loading and timeouts.
-   Keep generated architecture and Pages output reproducible and compatible
    with repository formatting and ASCII checks.

## 0.17.0

-   Speech diagnostics now include bounded button, capability and request
    outcomes, including safe catalog error categories, even without a pairing
    session. They exclude keys, narration, audio and raw provider responses.
-   Apply speech provider choices immediately while saving preferences, so a
    following voice-load or preview action cannot use the previous provider.
-   Replace stale catalog errors with clear loading, empty-result or success
    feedback, and explain blocked speech actions visibly in Settings.

## 0.16.0

-   Choose optional ElevenLabs cloud narration alongside local Kokoro. Configure
    an API key through a secure native prompt, choose an account voice, and
    preview it in Settings. Selected narration and previews use account credits;
    voice availability depends on the account.
-   Both providers use the existing reading, pause and stop controls. Kokoro
    remains the default, and automatic speech remains off by default.

## 0.15.0

-   Settings has clearer sections and the code display choice has its own
    toolbar dropdown, with the same choice in Settings.
-   Optional local Kokoro speech reads agent-selected narration. It is off by
    default and offers voice and speed controls plus an explicit setup download
    and preview on supported local Linux x64 desktop hosts.

## 0.14.1

-   Allow a structural newline in safe code after a closed Python f-string
    containing a quoted expression.

## 0.14.0

-   Choose Typing, Lines, or Blocks in the existing playback speed menu. The
    choice applies to the next typing action and is saved across reloads.
-   Line and block playback highlights each inserted group and pauses for
    reading; the reading ring can finish or hold that pause.

## 0.13.0

-   Copy a bounded diagnostic snapshot from Pair Settings when troubleshooting a
    session. It contains status and timing metadata, not chat, code, command
    text, paths, or output, and is copied only when requested.
-   A new session now clears an earlier session's suspended status; the
    suspended status offers recovery guidance.
-   Clarify that replying to a listening agent is optional.

## 0.12.0

-   Pair command terminals stay quiet by default. Use **Show terminal** on a
    command or enable **Show terminals automatically** in Pair Settings.
-   Reuse eligible Pair-owned terminals and clean up exited shells after a
    session; live shells and terminals used for other work remain protected.
-   Clarify that structural newline indentation is relative to the current line.

## 0.11.0

-   Click the reading ring to finish the current countdown, or hold it to pause
    just that countdown until release. Space provides the same keyboard behavior;
    other playback pauses remain in effect.
-   The Settings gear is in the toolbar, and the Your move status explains how
    to reply when focused or hovered.
-   A line-end move across multiple adjacent closing brackets is rejected during
    preflight unless explicitly allowed; exact spots and `next_close` remain
    available.
-   Triple-quote runs are inserted together to prevent extra closing quotes
    from Pylance, without changing user settings.
-   The relay and extension now use protocol version 5; reload VS Code and
    restart the agent together after updating.

## 0.10.1

-   The running version and build ID now appear in the Settings dialog, which
    stays usable at narrow panel widths.
-   Playback uses clearer Paused and Playing status text and theme-aware colors,
    while preserving distinct prompts, turn, suspended, idle, and reading states.
-   Typing handles CRLF input consistently across document line endings, cursor
    placement, and interrupted remainders. A cursor marker inside a CRLF pair
    is rejected; standalone carriage returns are preserved.
-   Agent guidance now describes the structural newline and single-close move.

## 0.10.0

-   The Pair panel shows the running version and a content-derived build ID
    (a SHA-256 prefix) to identify the bundle currently loaded.

-   Editing batches name their file before the first edit. The new `next_close`
    move steps over one bracket, and a `line_end` that crosses multiple closes
    includes an advisory.
-   An optional structural newline splits adjacent bracket pairs in Python and
    JSON code while preserving indentation. Diagnostics are advisory.
-   The relay and extension now use protocol version 4; reload VS Code and
    restart the agent together after updating.

## 0.9.0

-   Choose oldest first in the Pair panel's Settings to put new messages and the
    reply box at the bottom. The default remains newest first. The setting is
    saved and can also be changed in VS Code settings.
-   Agent messages in the history use the theme text color for easier reading.
-   A filed agent message appears once in the conversation, in time order with
    replies; its code link stays with it.

## 0.8.1

-   The TLA+ specs and the code agree again, after an audit of every spec
    against the code and checks across specs (#200). Comments, README rows,
    and test titles that #199's renames left behind name the code as it is.
    Thirteen specs model a path the code takes that they missed: the session
    ending or the socket closing while calls wait (`Serialize.tla`), an edit
    VS Code refuses and `create`'s save (`EditorAdapter.tla`), a window that
    refuses the relay's hello (`Discovery.tla`), focusing an open document
    (`Outside.tla`), `show` returning early for a file already in view
    (`FollowMode.tla`), the programmer's turn in follow mode (`Scroll.tla`),
    the selection a `delete` needs (`BatchFile.tla`), a selection where a
    reload's change starts (`Reload.tla`), one pending edit event a file
    (`EditEvents.tla`), two asks in flight for the Start button
    (`Start.tla`), a second sleep while one is pending (`Timeline.tla`), news
    during the listen grace (`ListenGrace.tla`), and closing an ended session
    (`Resume.tla`).
-   The relay's search for project guides stops only at the workspace
    folder, which always holds the working directory; the check for the
    file system's root, which no run reached, is removed.
-   After an interrupt, the agent's next batch waits until the batch the
    interrupt left playing has ended (#219). Before, a report while that batch
    still played cleared the interrupt, so the next batch was planned from
    where the playing batch was planned, without the programmer's edit, and a
    line the agent had just read could be refused. A step discarded meanwhile
    now reports once the playing batch ends, instead of at once.
-   Once the agent's harness goes away, the relay tries no other window after
    the one it was connecting to fails (#220).

## 0.8.0

-   The programmer is `programmer` on the wire, never `user`: the turn
    (`turn`, and the `turn` event's `to`) and the Pause button's pause reason,
    in reports, the panel's messages, and `PROTOCOL.md`, as the edit event's
    `by` already said (#197).
-   The TLA+ specs mean one thing by each word across modules, with the shared
    vocabulary in `specs/PairDefs.tla`; `specs/CHANGES.md` lists every rename
    (#197).

## 0.7.9

-   The TLA+ specs, their README and COVERAGE tables, and the spec comments in
    the code follow the code again, after an audit of every spec before the
    code freeze (#192): `Panel.tla` models the `session` event that repeats a
    suspension (`RepeatSession`), `Timeline.tla` has the calibration's pause
    reason, `Start.tla` numbers the Start button's questions, so only the
    latest one's answer reaches the page, as in the code (`LatestAnswer`), and
    reads the CLI when it asks, and the comments in `Start.tla`, `Anchor.tla`, `Serialize.tla`,
    `FollowMode.tla`, `EditEvents.tla`, `Outside.tla`, and `Calibration.tla`
    name the code as it is. The documents name `setup.test.ts` and the test
    titles as they are, and every function added since the specs last changed.
    Nine actions that had no comment in the code have one.
-   Three bugs the audit found, each modeled first, so TLC shows the bug, then
    fixed in the spec and the code: a reply the reading speed calibration
    takes left playback paused until the Resume button (#191, `Draft.tla`,
    `ClearOnTaken`); a step refused as `unanchored` dropped a rejection
    `restore` held, which now reaches the agent first (#193, `Anchor.tla`,
    `DropsHeld`); and "Your move" stayed on through a `read`, and after a step
    refused at once, until the listen grace ran out, where now every call ends
    the grace (#194, `ListenGrace.tla`, `EndOnAnyCall`).
-   The `unanchored` rejection, the `step` tool's description, the guide, and
    the protocol say a failed batch also leaves the cursor where it stopped,
    as an interrupted or discarded one does (#192). Three presence checks in
    `calibration.ts` and `typing.ts` test outright, as the style rules ask.

## 0.7.8

-   Every delay of the extension's own is in one place, with a set for real
    use and a set a test can wait out (#176, #186): the controller's timeouts
    (`setTimeouts`, `TEST_TIMEOUTS`), the extension's delays (`timings.ts`,
    `Api.setTimings`, which also tells the panel's page its tooltip delays),
    and the relay's (`AI_PAIR_TIMINGS=test` in its environment).
-   Code no run reaches is gone: the relay's own catch around serving (Node
    exits the same way), a dev version for an unbuilt relay (the build
    defines it, and so does vitest), the demo's unused `select` target, two
    fallbacks for a line past the end of a file, and the panel's empty
    `default`. Set Up Agent takes a host, as the starter does.

## 0.7.7

-   The editor and the panel take the controller, the calibration, and the
    starter when they are made, instead of as members activation sets later,
    so nothing checks for a member that is always there (#176). Guards no run
    could reach are gone with them: a line past a file's end spans its end; a
    change to a document outside the workspace is left alone where it is seen;
    a scroll starts from the view's top line it was measured at; a run's row
    writes its outcome into the span it was made with; and the tooltip is
    placed on the element it is shown for.

## 0.7.6

-   A tooltip no longer shows after the pointer has left its button: moving
    off it before the tooltip appeared, onto anything without one, now
    cancels it.
-   The rest of the unit tests are solitary (#176): `extension`, `editor`,
    `panel`, `demo`, the panel's page script (on a fixture page, which
    `panel_html.test.ts` keeps equal to the real one), and the scripts, each
    at 100 percent by itself. Tests across files are `demo.e2e.test.ts` and
    `css.e2e.test.ts`.
-   Code no real run reaches is gone: `select` and `point` take a span typed
    as `text`, or `from` and `through`; a rehearsal hands back the action it
    failed at; a call keeps its own session; the calibration is the bridge's
    required `calibrate` option; and the report's cursor comes from the
    cursor's file. What the agent sees of the tools is unchanged.
-   The integration run plays the player's, the controller's, and the
    extension's paths: every refusal, every way a run ends, a failed save, an
    interrupt in each pause, the programmer's input without a session, the
    commands, and the settings. Core's files are at 100 percent there, but
    for two fallbacks the types force.

## 0.7.5

-   The Copilot server provider is gone (#182): the extension no longer
    offers the pair server to VS Code's own chat agent. A Copilot user sets
    it up with Set Up Agent's **Another agent**.
-   The unit tests are solitary (#176, in part): each tests one source file,
    with what it imports mocked, and covers it 100 percent by itself. Core's
    tests are all solitary, with `session.e2e.test.ts` for the properties
    that hold only where the controller and the player meet; in the vscode
    package, so are the tests of `passage`, `output`, `outside`, `view`,
    `calibration`, `panel_html`, `outside_watch`, `terminal`, `agents`, and
    `setup`. Tests that need several real files are `*.e2e.test.ts`.
-   No test leaves files behind: `agents.test.ts` and `setup.test.ts` use an
    in-memory disk, `coverage_report.e2e.test.ts` removes its fixtures, and
    `integration.sh` removes its temporary folder when it ends.
-   The integration run covers Set Up Agent: its picker closed, Another
    agent's configuration copied, and Claude Code and Codex picked. Code runs
    with the agents' configuration folders in the run's own folder and only
    the system's programs on its PATH, so the run changes no real
    configuration.
-   Code no run reaches is gone: two fallbacks in the controller's report of
    edits (an edit event now carries its own texts), and a check in the
    terminal's wait for a signal that can't have fired yet. Nothing changes
    for anyone using the extension.

## 0.7.4

-   Code no real run of the extension and relay reaches is gone (#180).
    `wire.ts` takes a frame as the one Buffer `ws` hands over, not an
    ArrayBuffer or an array of Buffers, since nothing sets `binaryType`.
    `bridge.ts` drops checks for a report whose parts aren't arrays, a
    server address that isn't a port, a server not made yet, and a thrown
    value that isn't an Error. `link.ts` drops the try/catch around a send
    on an open socket, the abort listener's check for an answered call,
    `handBack`'s check for a value that isn't an object, and `workspace()`'s
    fallback for a real path that moved between two reads: `findWindows`
    gives the root it matched. Nothing changes for anyone using the
    extension.
-   `bridge.ts`, `link.ts`, and `wire.ts` are at 100 percent in both the
    unit and the integration run, on macOS and Linux. The integration run
    drives the bridge over raw sockets, and the relay against fake windows:
    a dead pid, a junk file, a refused port, a rejected hello, a slow
    welcome, a cancel, and a shutdown mid-call. `bridge.test.ts` is
    solitary, and `bridge.discovery.test.ts` is folded into it and the
    integration run.

## 0.7.3

-   The relay now exits when its harness ends its stdin (#163): it closes its
    MCP server, then its link to the editor, which closes its socket and
    opens no other; a call after that is refused with "The relay is shutting
    down." `specs/Wire.tla` models it with `Shutdown` and
    `CloseAfterShutdown`, and `ExitsAfterShutdown` checks it.
-   A `move` whose `at` is not a text, such as `{ move: { at: 5 } }`, is now
    refused by name: "`at` is a text, with the cursor marker where your
    cursor goes." It used to throw a TypeError. `specs/ActionValidation.tla`
    checks that no place makes `moveProblem` or `spanProblem` throw.
-   The protocol's types are zod schemas in `@ai-pair/protocol`, and both ends
    parse whole frames with them: a frame whose fields have the wrong types
    is not a message, as one that isn't JSON already was. The editor drops
    it; the relay drops it after the welcome, and before it fails to
    connect. The relay checks discovery files, reports, and file contents
    the same way.
-   Every relay source file is at 100 percent from its own unit test, and
    each test is solitary: it tests one source file and mocks the rest. The
    unit tests run isolated, each file with its own module cache, so a
    file's mocks always apply; a run takes about a second longer.
    `units.test.ts` and `render.fields.test.ts` are split into the test files
    of the sources they test.
-   The integration run gains three cases: every malformed action the
    checks refuse, sent over a relay link, is refused by name in the editor,
    and a frame that is not a message is dropped; a pause holds a `say` until
    the resume, and an interrupt during a move's `show` cuts the batch; and a
    relay skips a window that answers its hello with something that is not a
    message, and starts without `AI_PAIR_HOME`. `timeline.ts`, the
    protocol's `index.ts`, and `wire.ts` are at 100 percent of lines in it.

## 0.7.2

-   The unit tests now cover every line, branch, and function of
    `packages/core/src` and `packages/protocol/src` (#162); the thresholds in
    `coverage_thresholds.json` are 100 for each of those files. `core`'s
    `index.ts` and `paths.ts` only re-export, so they leave the unit run.
    New tests cover the bridge's WebSocket conversation, the player's refused
    actions and interrupts, the controller's no-session guards, trace, and
    restored reports, the rehearsal, the timeline's pause path, and the
    protocol's frames. Branches no sequence of calls could reach are gone,
    with no change for any state that can occur: a second check where the
    first had already run, an `?? undefined`, a lookup of an event that always
    exists, a `default` after every kind of call, and a queued batch typed as
    maybe lacking its rehearsal. `Player` takes a `PlayerEditor`, an
    `EditorPort` without the three methods only the controller calls.
-   A `move`, `select`, or `point` whose place is not an object, such as
    `{ move: 5 }` or `{ move: [] }`, is now refused by name in
    `fieldsProblem`, with the fields the place takes. The player used to
    refuse it only by accident, with a TypeError, in a check that the unit
    work removed as redundant; the relay's schema already refused it.
    `packages/relay/test/validation.test.ts` gains the cases.
    The extension otherwise works the same.

## 0.7.1

-   Every action of every TLA+ spec now fires in a config CI checks (#169).
    `specs/Discovery_InPlace.cfg` models the write in place that #72 removed,
    so `Focus` and `FinishWrite` fire there; `specs/check.sh --coverage` and
    `scripts/coverage_report.ts` sum an action's fires over a spec's configs
    (`Spec.cfg` and `Spec_<Model>.cfg`), telling the disjuncts of an inline
    `Next` apart by their location, and name only an action that fired in
    none. The extension works the same.

## 0.7.0

-   Every coverage run now fails when a file drops below its measured
    coverage, held in `coverage_thresholds.json` at the root (#161): vitest
    holds each file's unit numbers, `scripts/coverage_report.ts --check` the
    integration, Swift, shell, and CSS columns, and `specs/check.sh --coverage`
    fails on an action that never fired unless the spec's section of
    `specs/README.md` says it never fires. CI keeps COVERAGE.md and the reports
    as artifacts on a failed run too. The extension works the same.

## 0.6.11

-   Every TypeScript file now follows Google's TypeScript Style Guide, not
    only the scripts, and CI checks all of it with oxlint and Prettier (#133).
    Three source files are renamed to snake_case (`outside_watch.ts`,
    `panel_messages.ts`, `panel_html.ts`). The code targets ES2025. The
    extension works the same.
-   The extension says what it needs in its manifest, as VS Code asks: it
    stays off in Restricted Mode and in a virtual workspace, since the agent
    edits files and runs commands; each setting has its scope; the session
    commands (pause, interrupt, turn, end, reply) are in the Command Palette
    only during a session; the Marketplace listing has its categories and
    keywords.

## 0.6.10

-   The repository's scripts are TypeScript now, to Google's TypeScript Style
    Guide, and CI checks them against it with oxlint and Prettier (#134).
    `npm run lint:web` runs Stylelint itself, with its config in
    `scripts/stylelint.config.ts`. The extension works the same.

## 0.6.9

-   When the agent has made no call for a listen's timeout (45 seconds), the
    panel says *Agent isn't listening*, so you can tell it has stopped,
    instead of seeing *Agent is thinking* (#149).
-   When playback is paused, every report says so and why (you pressed
    Pause, you're typing a reply, you're looking at another file, or a
    calibration), so the agent knows its batches are waiting (#149).
-   A very long edit, over 200 lines of diff, reaches the agent as the line
    ranges it changed, and the agent reads the file, so a report stays small
    enough for it to read (#149).
-   The **AI Pair** output logs each session's interactions at the Info level:
    statuses, batches, pauses and their reasons, interrupts, edits, and each
    report with its size, so a log shows where a session went wrong (#149).

## 0.6.8

-   Fixed: `npm run test:integration` failed at once when run from a terminal
    inside VS Code that sets `ELECTRON_RUN_AS_NODE`, such as Claude Code's. The
    script now unsets it before starting VS Code (#152).

## 0.6.7

-   The `Rehearsal` spec now covers a batch that is already playing when a
    change by someone else interrupts the queue, such as a formatter on save:
    the batch plays on and may complete, and `adopt` keeps its line identities
    off the changed text (#151). A new test checks that `adopt` does. The specs
    and their README say each property in words, not by its ID in #19. The
    extension works the same.

## 0.6.6

-   The `Serialize` spec says when a step returns as the code does: once its
    batch is done, or plays next, so a step returns as soon as the one before
    it has (#150). TLC checks the new `ReadyAtHead` invariant. The extension
    works the same.

## 0.6.5

-   Fixed: when the agent's connection closed while its `start` was still
    running, a different agent whose session had ended could keep control of
    the new, suspended session and drive it. The suspended session now has no
    owner until an agent starts again. Found by the `Bridge` spec's model
    checking (#148).
-   The TLA+ specs follow the TLA+ style guide in `specs/`, and CI checks the
    rules a script can check (`npm run lint:tla`). Every spec now has a type
    invariant, a property that says something must happen, a mutation that
    proves each property can fail, and a test named for each property it
    proves. Every test writes the agent's cursor marker by name.

## 0.6.4

-   The repository's Markdown, this changelog and the Marketplace README
    included, follows Google's Markdown style guide, and CI checks it with
    markdownlint (`npm run lint:md`). The README gains a title and headings over
    its animations; the words are unchanged.

## 0.6.3

-   The Pair panel's page and stylesheet follow Google's HTML/CSS Style Guide,
    and the page is valid HTML5. CI checks both (`npm run lint:web`). The panel
    looks and works the same.

## 0.6.2

-   The repository's shell scripts follow Google's Shell Style Guide, and CI
    checks them with ShellCheck, shfmt, and the guide's shebang, file name, and
    length rules (`npm run lint:sh`). `npm run test:integration` now runs its
    script with `bash`. Nothing changes in the extension.

## 0.6.1

-   The Swift script that draws the icon, `scripts/icon.swift`, follows Google's
    Swift Style Guide, and CI checks it with swift-format and a
    warnings-as-errors type check on macOS (`npm run lint:swift`,
    `npm run typecheck:swift`). The icon it draws is unchanged.

## 0.6.0

-   The editor's scroll to follow the agent now takes its time from the playback
    speed, like typing and pauses: at 1.0x it is half a second for a short jump,
    10 ms more for each line, up to 1.5 s, and the speed divides that. Before,
    it was half a second at any speed and any distance. `aiPair.timing` sets the
    three numbers: `glideMs`, `glidePerLineMs`, and `glideMaxMs`. With
    `editor.smoothScrolling` on, VS Code still animates the scroll at its own
    pace.

## 0.5.1

-   After a window reload, a session in progress shows as suspended in the Pair
    panel, with the divider and the status "Suspended: waiting for the agent".
    Before, it looked live, and messages sent then seemed to go nowhere. When
    the reload cuts off the agent mid-call, it is told to call `start` again to
    resume the session, not to start a new one.

## 0.5.0

-   Sending a message in the Pair panel scrolls the history back to its top, so
    your message is in view even when you had scrolled down to read older
    entries. Entries from the agent still leave the history where you scrolled
    it.

## 0.4.4

-   A command's output, as the agent sees it, no longer runs a tool's progress
    lines together. Prettier's file list and npm's spinner, which redraw one
    line in place, now show only what the line ends with.
-   The panel's styles load from a stylesheet of their own, so the panel no
    longer allows inline styles.

## 0.4.3

-   The status no longer flashes "Agent is thinking" every 45 seconds while the
    agent is only waiting for you. It stays "Your move" between the agent's
    waits, and changes as soon as you do something or the agent starts working.

## 0.4.2

-   Sending a reply no longer moves the editor: a file you closed stays closed,
    and the tab you switched to stays in front, with the selection you made. The
    agent's next edit still shows its file, and **Resume** still brings you back
    to the agent's cursor.

## 0.4.1

-   The panel and the editor show plain ASCII where they showed symbols: the
    speed menus read `1.0x`, the agent's cursor label reads `Claude - running`,
    line ranges read `12-20`, a file changed outside the editor is badged `*`,
    and a command's outcome reads `exit 0`, `exit 1`, `stopped`, or `skipped`,
    without a symbol in front.
-   The Pair view has an icon, shown when it's moved into a container of its
    own.

## 0.4.0

-   **Start a session** now starts Claude Code's CLI in a hidden terminal with
    the request already sent, so the Pair panel stays in front and you never
    press Enter in Claude Code. The terminal closes when the session ends. It
    needs the `claude` CLI on your PATH or in `~/.local/bin`, and a folder open.
-   Start a session no longer changes Claude Code's preferred location to
    `panel`.
-   After you click **Start a session**, the panel says a session is starting
    until the agent starts it, or until Claude Code exits without one.

## 0.3.0

-   **Start a session** in the Pair panel's idle view opens a Claude Code tab
    with the request typed in, when the Claude Code extension is installed and
    set up for the pair server: one click and Enter, without leaving the editor.

## 0.2.0

-   A reading menu sets the pause after each message on its own, from 0.4x to
    3.0x; the pause grows with the message's length, with no cap.
-   **AI Pair: Calibrate Reading Speed** times you on a passage and sets the
    pause after each message to your own pace. The agent can supply another
    passage with its `calibrate` tool.
-   A reply after you looked away no longer reopens a file the agent pointed at
    earlier; the view comes back to the agent's cursor instead.

## 0.1.0

The first release.

-   Your coding agent gets its own cursor in the editor, types at a human pace,
    and explains what it's doing in the **Pair** panel.
-   Reply, interrupt, or edit the code at any moment, and the agent's next move
    takes it into account. Select some code to ask about it.
-   **My turn** lets you write a part yourself while the agent navigates.
-   The agent's commands play in an *AI Pair* terminal, after you allow them.
-   The speed menu sets the pace, from 0.4x to 3.0x.
-   **AI Pair: Set Up Agent** connects Claude Code, Codex, OpenCode, Gemini CLI
    and Cursor. GitHub Copilot needs no setup.
-   **AI Pair: Play Demo Session** shows what it's like without an agent.
