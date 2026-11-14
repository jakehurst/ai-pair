# Decisions

This file records material product and engineering choices and their limits.
Issue discussions and working notes hold the detailed evidence and history.

## Working method

-   Use test-driven development: write meaningful failing tests, implement the
    change, and run the relevant checks.
-   GPT-6.1 Terra agents write code and tests; GPT-6 Astra agents review them.
    Resolve findings and verify the resulting changes before reporting completion.

## CI tool downloads

-   Download pinned shfmt from its direct upstream release first, then the
    corresponding GitHub asset API. Verify the same pinned SHA-256 for either
    source and remove failed output. This tolerates an API 403 but cannot make
    either upstream service available; bounded failures still fail CI.
-   The shell coverage run refreshed actual shell measurements. Its unrelated
    test-row marker changes were normalized out of this change.

## CI scheduling

-   Run at most two independent TLC configurations by default, with one TLC
    worker each and a 2 GiB Java heap in CI. `TLC_JOBS` permits one through
    eight. Collect every result
    before aggregating coverage and cancel and reap children on interruption.
    This bounds default resource use; the slowest single configuration and
    external runner capacity still limit the speedup. Cancellation hard-kills
    the direct TLC processes and waits for them, discarding their scratch state;
    custom `TLC` wrappers must `exec` the checker so descendants are not orphaned.
-   Build VSIX packages for main pushes, pull requests and manual dispatches,
    not both a branch push and its pull request. Separate concurrency groups
    by workflow, event and PR or ref; manual runs use unique run IDs.

## Speech continuity and delivery

-   Context is opt-in and session-local: retain at most three completed agent
    utterances and 500 Unicode code points. Exclude previews, interrupted or
    failed speech, and text that was never spoken. Ordinary cancellation and
    suspension preserve completed history; ending or replacing the session
    clears it. Configuration changes invalidate old completions.
-   Only OpenRouter ElevenLabs v4 receives previous text and delivery cues;
    v3, v3 conversational, and v4 turbo receive cues only. Other models use
    ordinary speech. This limits provider disclosure and avoids claiming
    support for unverified context behavior. Previous text requires OpenRouter
    Zero Data Retention; when it is off, supported cues and ordinary speech
    remain available.

## Speech backend handoff

-   Retire the previous local worker and wait for its matching exit before
    starting a different backend. The waiting utterance has a startup deadline;
    cancellation or timeout invalidates it. A planned retirement is not a
    worker failure. Model setup readiness does not establish live worker or
    playback readiness, and GPU hardware still requires its own verification.

## Guided demo and diagnostics

-   Ship one canonical skill for each workflow, embedded in MCP prompts and
    included as physical files in the extension. Skill installation is manual.
-   Invite a real programmer edit in the scratch file and comment on the
    observed report as navigator. The edit is optional; the agent waits for the
    programmer and does not take back their turn or end without permission.
-   Demonstrate the hand request during overlapping narration and typing; the
    panel supplies the cached acknowledgement. After the programmer agrees to
    end, clean up only verified, unchanged demo-owned files and an empty demo
    directory through Pair. If the programmer holds the turn, offer a handback
    for cleanup or retaining the files; `run` cannot execute on their turn.
    Preserve uncertain or user-retained work. A lost session leaves the files
    in place; the skill cannot guarantee cleanup.
-   Run diagnostics on a bounded temporary connection, independent of session
    ownership. Return only schema-validated metadata and fixed errors; audio
    readiness cannot establish that the programmer heard playback. A preview
    requires explicit consent and uses the existing provider and settings.

## Interrupted typing edits

-   If an in-flight typing edit is rejected after interruption, report only
    the untyped remainder and restore the cursor and selection through the
    programmer's changes. A rejection without interruption remains a failure.
    Line identities are conservatively forgotten after a rejected edit, so
    earlier line references may need to be read again.

## Cloud speech failure reporting

-   Report only fixed ElevenLabs failure categories for ordinary narration and
    previews, including on the local companion. User-facing messages do not
    assume that an authorization response proves the key is invalid. These
    categories do not identify the root cause within a provider response; no
    request text, credentials, response body or URL is recorded. A canceled
    request ends silently, and no automatic retry incurs another request.
-   Keep the audio and ownership protocol version unchanged for the optional
    narration diagnostic event. An older workspace may reject a newer
    companion's diagnostic report; its existing workspace report remains
    available. Update both extensions for complete diagnostics. Preserve the
    strict report schema rather than accepting unknown fields.

## Session batch IDs

-   Number batches from one within each fresh session; resuming a saved or
    suspended session retains its next number. History belongs to its session,
    and pending playback is guarded by session identity. A crash before the
    asynchronous save can still reuse an ID within a resumed session.

## Session ending

-   Keep the Pair session open at a natural pause or when a task is done. The
    agent sends its summary through a Pair `say` action, then calls `listen`;
    it calls `end` only when the programmer explicitly asks to end the Pair
    session. This is agent guidance, not a runtime restriction on the `end`
    tool. A one-shot agent's final answer can end that agent process; client
    shutdown then closes the relay's stdin. Losing the editor connection
    suspends Pair without proving that either process exited.

## Conversation panel

-   Offer newest-first and oldest-first chat order, retaining newest-first as the
    default. Keep the preference in VS Code settings and expose it in the panel.
-   Show messages in their event order, including a reply immediately after the
    message it follows. History text uses the theme foreground for readability.
-   Keep the Settings dialog inside the panel at narrow widths, with padding
    around its contents and space for its close button.
-   Identify an actual playback pause in text and theme-aware color; keep
    confirmation, programmer turn, suspended, idle, and natural reading states
    distinguishable. Show active typing as Playing, while a natural reading
    pause remains a reading state. A pause stays visible while any pause reason
    remains.
-   Make the reading ring keyboard accessible: click to finish its current
    countdown, or hold to pause only that countdown until release. Bind gestures
    to their original message; preserve explicit pauses, session suspension,
    command confirmations, and the programmer's turn.
-   Place one Settings gear in the toolbar, available in idle and active states.
    Explain Your move on hover or keyboard focus only while the agent listens.

## Code playback

-   Keep Typing as the default and put the mode in its own toolbar dropdown,
    mirrored in Settings, as requested. Save the choice separately from speed;
    apply changes at the next
    typing action so an in-progress action keeps its mode.
-   Show and highlight each inserted group for a reading pause. Use the existing
    reading control for finishing or holding that pause, and the existing pace
    and reading-speed settings to scale it. Limit both Lines and Blocks to 240
    Unicode code points, and Blocks to four logical lines. Prefer line and
    whitespace boundaries; preserve atomic edits, including an indivisible edit
    that exceeds a bound. Follow the highlighted group while it is read.

## Spoken narration

-   Share one output choice between Kokoro and ElevenLabs. System default keeps
    the existing VS Code webview path. An explicit local Linux override uses a
    verified PipeWire player because VS Code's webview blocks speaker selection.
-   Stage a pinned Linux x64 libstdc++ beside ONNX Runtime's binding. Its
    `$ORIGIN` search path then supplies a library compatible with the older
    Snap base without changing VS Code's environment or worker lifecycle.
    Do not request microphone permission or change the workbench iframe policy.
-   Discover local PipeWire sinks with bounded `pw-dump` calls, without requiring
    the PulseAudio compatibility tools. Refuse an explicit `PIPEWIRE_REMOTE`
    because its locality is not established. Discover outputs on refresh and
    before each explicit native speech unit. Keep a missing saved choice
    visible, and reject an unavailable native route before synthesis. Store
    stable native names locally without Settings Sync; exclude names and device
    identifiers from diagnostics. Selection stops current speech immediately.
-   Snapshot the route for each unit. Keep process ownership until close, reject
    stale callbacks, and stop rather than fall back when the chosen output
    disappears. Native pause stops the client; already-buffered audio can finish
    briefly. Stop and parent-death cleanup must also work while paused.
-   Have the agent proactively select useful, bounded narration for speech; do
    not read every message. Playback remains off by default and follows the
    programmer's provider and speech setting. Keep text visible when disabled
    or unavailable, and do not replay speech from history.
-   Use independent voice speed and run speech and reading timers concurrently;
    completion waits for both. The reading control changes only the timer.
-   Run locally on supported Linux x64 glibc desktop hosts. An explicit setup
    downloads the pinned model; unsupported hosts retain text-only operation.
    CPU synthesis in a VM can be slow, and audio quality depends on the host.
-   Keep one audio unit at a time and invalidate it on reply, interruption or
    page replacement. Do not persist generated audio or a separate speech
    transcript; visible text follows normal session history behavior.
-   Ship an AI Pair-owned bridge in the VSIX; explicit speech setup downloads
    and verifies a pinned phonemizer executable and license alongside the
    model. The embedded eSpeak NG revision in that upstream executable is not
    identified by its published package. This delivery choice does not establish
    corresponding source provenance or certify license compliance.
-   Keep Kokoro as the default. Offer ElevenLabs only through an explicit,
    application-scoped provider choice with a cloud and account-credit notice.
    Saving a key does not enable speech, change providers or play a preview.
    Never switch providers automatically after a failure.
-   Store the ElevenLabs API key only in VS Code SecretStorage, entered through
    a native masked prompt. The panel, preferences, session history and
    diagnostics receive no key. Removing or replacing it cancels cloud work and
    invalidates the voice catalog.
-   Fetch account voices instead of hard-coding a default voice or promising
    free eligibility. Preview checks whether the chosen voice works for that
    account. Free plans have credit and voice-access limits; a new account may
    have no usable API voices.
-   Send the exact selected text to the fixed ElevenLabs HTTPS API with
    Multilingual v2 and 24 kHz PCM output. Keep cloud voice speeds at 0.75, 1
    and 1.2, independently of code pace and reading speed. Preserve local voice
    settings. No extra LLM, transcript context or project data is sent.
-   Bound each cloud synthesis to 20 seconds and 40 seconds of audio; append the
    same 600 ms thinking interval used locally. Use no automatic retry or audio
    backlog. Cancellation stops local playback and aborts the request; it
    cannot promise cancellation of remote work or a credit refund. Cloud errors
    resolve only the speech gate and leave written narration available.
-   Keep initial cloud support on local desktop extension hosts. It does not
    require Kokoro's Linux runtime; remote and web hosts remain unavailable.
-   Investigate optional Kokoro GPU acceleration separately from the ElevenLabs
    integration. The user's target is Ubuntu with AMD Radeon or integrated AMD
    graphics; its exact GPU model is not yet known. The shipped engine explicitly
    selects CPU. Standard ONNX Runtime Node binaries do not provide AMD GPU
    acceleration, so a GPU setting must not claim support before a compatible
    runtime and end-to-end hardware test exist. Keep CPU available and show the
    actual execution device. See the
    [Node runtime support matrix](https://onnxruntime.ai/docs/get-started/with-javascript/node.html)
    and [AMD execution provider](https://onnxruntime.ai/docs/execution-providers/MIGraphX-ExecutionProvider.html).

## Session diagnostics

-   Report speech configuration and last observed playback through fixed,
    validated fields. Companion key presence, runtime and model readiness and
    output availability remain unknown until observed; collection starts no
    audio, network request, installation or device probe. A ready playback path
    does not establish that the user heard audio.
-   Read the controller's current session state for diagnostics, including an
    idle fresh window. Preserve a recorded ended state only while the controller
    has neither an active nor a suspended session.

-   Record bounded speech capability, button dispatch and result events even
    without a pairing session. Keep failure reasons in a fixed allowlist;
    exclude API keys, narration, audio, voice identifiers and raw provider
    responses. Empty catalogs and blocked actions must have visible feedback.
-   Use the current in-memory speech choice immediately, while configuration
    persistence completes asynchronously. Older write completions and settings
    callbacks must not restore an earlier selection. Report persistence errors
    rather than silently accepting a different provider for the next action.
-   Keep a bounded, in-memory history of allowlisted lifecycle metadata for
    connection, requests, pause reasons, and commands. Exclude chat, source,
    paths, command text, output, and tokens. An explicit Settings action or an
    authenticated diagnostics request collects the same bounded snapshot; the
    latter does not take session ownership. Report clipboard failure. Values
    not yet observed remain unavailable, and timestamps and identifiers are
    still diagnostic metadata.
-   A fresh session replaces an old suspended display; unrelated late status
    events cannot clear an actual suspension. Explain how to reconnect in the
    same project, without claiming why a connection ended.

## Command terminals

-   Keep Pair command terminals hidden by default, with an opt-in setting and
    explicit reveal for each started command. A closed or reused terminal is
    reported unavailable rather than opening an unrelated terminal. Preserve
    command approval and captured output independently of visibility.
-   Reuse only eligible Pair-owned terminals. At session end, clean up only
    owned terminals whose shells have exited; preserve live shells, including
    those with possible background descendants. Reveal the terminal if shell
    integration is unavailable. Hidden terminals are not restored when the
    workspace is reopened; users can reveal a terminal when they need it visible.

## Editing safety

-   Require each editing batch to name its target file before its first edit.
    After a reported interrupted, discarded, or failed batch, retain the stronger
    existing requirement to anchor the cursor with both file and line.
-   Provide an explicit operation to create an indented line between matching
    adjacent delimiters in Python and JSON, and a separate operation to move
    past a closing delimiter. Reject ambiguous contexts, including complex
    formatted-string prefixes; agents can use literal typing when needed.
-   Reject a line-end move that crosses multiple adjacent closing brackets at
    preflight unless it explicitly opts in. Exact spots and the single-close
    move remain available; this narrow check is not a language parser.
-   Surface available VS Code error diagnostics as advisory information after
    edits. Language providers may be absent, late, or stale; diagnostics are not
    a parser guarantee and cannot reliably identify valid but unintended Python
    tuples. Do not reject a batch merely because diagnostics are present.
-   Check Python syntax with the system `python3`, isolated from the workspace's
    imports and startup files. Its version can differ from the project's Python;
    when it is missing or fails, report that the check was unavailable.
-   Normalize CRLF input in `type` and `type_fast` before planning chunks and
    tracking cursor positions or interrupted remainders; preserve standalone
    carriage returns. Reject a cursor marker inside a CRLF pair rather than
    splitting the line ending. Literal typing remains literal otherwise.
-   Insert runs of three or more identical quotes in one edit. Pylance can
    otherwise react to a partially entered triple quote by adding unwanted
    closing quotes. Keep the user's editor and extension settings unchanged.
-   Guide agents to the explicit structural newline and single-close move when
    appropriate. The observed line-ending defect does not establish the cause
    of the earlier bracket incident.
-   Recover after a closed formatted string containing quoted expression text
    with a bounded lexical scan. Continue refusing incomplete, mismatched, and
    unsupported nested formatted expressions; this is not a Python parser.
-   Use explicit action validation and error reporting so malformed input cannot
    silently become a different edit.

## Local verification and installation

-   Keep remote workspace editing separate from local audio. An optional UI
    companion owns the panel, speech settings, credentials and device access;
    the workspace extension retains the controller, editor and command execution.
    Exchange bounded, versioned messages through fixed VS Code commands. Keep
    separate monotonic sequence numbers for each direction and invalidate old
    connection, job and page identities on reconnect.
-   Select the panel owner once per window using a prepare/commit handshake.
    Preparation cannot register a provider. After committing to the companion,
    a lost acknowledgement cannot cause a second legacy provider to register.
    Without a companion, retain the existing local experience; remote speech
    remains unavailable rather than playing on the workspace machine.
-   Reserve and validate a concrete local endpoint before synthesis, including
    resolving System default for that narration unit. Recheck and open that
    endpoint at playback; do not substitute another device. Removal after a
    provider request can still consume provider credits even if playback fails.
-   Share the adapter lifecycle across PipeWire, CoreAudio and WASAPI. Retain
    physical ownership until cleanup or process exit is confirmed, including
    cancellation during admission and while paused. Handle local interruption
    before forwarding its workspace action; an expired connection lease stops
    speech locally without waiting for the remote host.
-   Package native helpers in CI for macOS Intel/Apple Silicon and Windows
    x64/ARM64, preserving the existing Linux PipeWire path. Cross-compilation
    proves build compatibility; it does not establish device routing or audible
    playback. Cross-platform output support does not expand the supported
    Kokoro synthesis runtime automatically.
-   After local audio placement is verified, evaluate one-sentence lookahead
    within an admitted narration unit, separate synthesis and pitch-preserving
    playback speed, and a common warm-worker protocol. Preserve selected text,
    independent reading pace and the speech on/off setting. Avoid speculative
    synthesis of future cloud narration and dropping explanations to catch up.

-   Normalize Archi 1.5.1 exports deterministically for repository formatting and
    ASCII checks. Preserve Unicode values with context-specific JSON,
    JavaScript, CSS and HTML escapes. This formats generated exports; it is not
    a general HTML sanitizer. Verify generator replay, idempotence, embedded
    script semantics and browser rendering before publishing Pages.
-   Preserve the bundled libstdc++ runtime and its original legal notice byte
    for byte. Exclude only that exact binary from the ASCII text check; permit
    only U+FEFF and U+00A9 in its exact copyright-notice path. Neighboring
    source and vendor files remain subject to the normal ASCII checks. The
    runtime-staging test also verifies the library's pinned SHA-256.
-   Pin the verified TLA+ release asset by immutable asset ID and SHA-256,
    and fail on HTTP errors. A future deletion must fail rather than execute
    different bytes. Updating the pin requires verified upstream provenance.
-   Build and verify the local extension before installing it for use. A local
    installation is distinct from publishing a release. This workspace runs in a
    VM: installing there does not install into the user's host VS Code. The host
    installs the verified VSIX separately. For local development, place it in the
    shared repository folder so the host can install it directly.
-   Build a downloadable VSIX in GitHub Actions for branch pushes, pull requests,
    and manual runs. The artifact identifies its version and checked-out commit;
    installing it on the Ubuntu host is a separate manual step. This workflow does
    not publish to a marketplace or create a release.
-   Show the version compiled into the running extension bundle and a
    content-derived SHA-256 build ID for the extension and web assets in the
    Settings dialog, keeping the main panel uncluttered. The build ID changes
    with the built content; it is not a manually incremented number.
-   The VM's previously installed extension was version 0.1.0; its installed
    extension bundle lacked the current post-interruption anchor guard. This does
    not establish the host's version or what caused any particular editing incident.

## Deferred replies, 2026-11-08

-   Keep immediate replies as the default. The optional action-boundary reply
    waits for the current action to finish before stopping later work and
    delivering the message. Stop, edits, turn changes and session end remain
    immediate and preserve queued replies. A long-running or blocked action can
    therefore delay a deferred reply until it ends or the programmer stops it.

## Model status, 2026-11-08

-   Show the model's fixed local path, upstream revision and source in speech
    settings. Verify every pinned asset with the installer's existing size and
    SHA-256 checks before labeling it verified. A directory may exist but fail
    verification; an inaccessible directory has unknown download status. The
    result describes the last check and does not promise later file integrity.

## Speech follow-up implementation, 2026-11-08

-   Implement the authorized speech improvements in order: bounded Kokoro
    sentence pipelining, independent pitch-preserving listening speed, then a
    common warm local-synthesis worker protocol. Preserve the existing reading
    countdown, code pace, speech switch and one admitted narration unit. Keep
    ElevenLabs on one request per unit in the first increment.
-   Treat optional music ducking as a separate local-host feature. Its planned
    settings include an enable switch and attenuation level. Restore affected
    streams on speech pause, completion, cancellation and failure, without
    overwriting a concurrent user volume change. Capability and crash-recovery
    behavior require platform-specific verification before claiming support.
-   Keep the reviewed cross-platform audio checkpoint separate from these new
    features. Its legacy editor scenarios pass, but 31 integration coverage
    thresholds remain below their floors. This is an outstanding merge gate;
    development installers do not establish release readiness.

-   Separate experimental listening speed from each provider's synthesis speed.
    Snapshot the listening rate per narration; setting changes apply to the
    next unit. Rate 1.0 preserves the waveform bytes. Apply local PCM processing
    in a dedicated worker before the one fixed final thinking tail, using the
    actual resulting duration for output bounds. No extra cloud request is
    needed. Offline corpus metrics complement, but do not replace, listening
    validation.

## Speech increments 2 and 3 and the ducking decision, 2026-11-08

-   Implement listening speed as a local overlap-add stretch with
    correlation-aligned frames, a final frame anchored at the exact output end,
    and a re-placement around an isolated transient in any source gap the
    aligned frames skip. Inputs under 3,072 samples (about 128 ms) are returned
    unchanged: they are within one analysis window of every target length, and
    real parts are whole sentences. Exact lengths and no sample loss at the
    anchor are tested with impulse sweeps; this is not a claim of speech
    quality. The offered rates (0.75, 1.25, 1.5) stay labeled experimental until
    people have listened to both voices. The transform runs in a one-shot worker
    that is terminated after each result; cancellation is that termination, so
    no cooperative cancellation callback exists in the DSP.
-   A narration whose listening rate is not 1 is refused with the usual "still
    finishing" message while the previous transform worker has not exited.
    Units at rate 1 are not delayed by a retiring transform worker.
-   Move the local Kokoro worker lifecycle into one client over a strict,
    versioned protocol (init, ready with capabilities, synthesize, result,
    failure, shutdown) that carries epoch, unit and part. The worker still runs
    in a Node worker thread; the protocol is transport neutral but no second
    transport or engine was added. Behavior changes: a malformed or oversized
    worker result now retires the worker (the shipped engine cannot produce one,
    so it means the worker is not the shipped code), and a host synthesis error
    shows one fixed message instead of free worker text. A retired worker holds
    its slot until its actual exit event; if the platform never reports exit, new
    narrations are refused until the window reloads, where the old code reopened
    when termination settled. This follows the approved model, which assumes a
    fair exit.
-   Do not ship music ducking in this release. A private PipeWire study
    (loopback virtual sink, unique sink name, playback following the default
    sink, ducking by the loopback's own volume) kept stream volume, mute and
    balance exactly, multiplied independently with user volume (0.3 x 0.216 for
    a 60 percent Pulse volume), failed open when the helper was killed and
    ignored explicitly routed streams. It also showed what is not acceptable
    yet: moving a stream makes WirePlumber persist a routing target in the
    user's state, a crash leaves stale entries (inert only with unique names),
    the user's own concurrent move can be overridden in a window of
    milliseconds with no atomic compare-and-move, audible glitches on move
    were not measured, the follow-up subscribe loop was never built, and stock
    distribution configuration, real hardware, Pulse-only servers, macOS and
    Windows are untested or have no mechanism. Narration must never depend on
    ducking, so the feature stays deferred rather than shipping a setting that
    may change the user's routing. Evidence summary:
    `blueprints/ideas/local-music-ducking.md`.
-   Delegated implementation used Claude Code (`claude -p`): Sonnet workers with
    exclusive file ownership wrote code and tests, Fable reviewed the models and
    sources before they were committed. Reviewer approvals are recorded in the
    commit history and PR; they are not proofs of listening quality.
-   Verify the warm worker with the real Kokoro model, not only fakes. A run of
    the real client, worker bundle and cached model (no audio device) showed a
    455-581 ms cold load, about 2 s per sentence part, a warm second unit with
    another voice on the same worker, refusal of an overlapping request, a
    canceled inference that kept the worker owned for its remaining 2 s before
    the worker was reused, and a retired worker that held its slot until its
    exit event. It also found a defect the mocked tests could not: the pinned
    phonemizer bridge reads `workerData.modelPath`, which the refactor had
    dropped. The client now hands the checked model directory to the transport,
    and a test pins the Node worker's `workerData`. Real-speech tempo output
    had exactly the expected lengths at 0.75, 1.25 and 1.5, kept the sample
    peak at 0.75 and 1.25 but lost about 19 percent of it at 1.5, and moved a
    pitch estimate at one position from 140 to 170 Hz at 1.5 where the content
    at that position also differs; this is an automated sanity check, not
    listening validation, and it is one more reason the control stays labeled
    experimental.
-   Known limitation, older than this change: Node cannot load
    onnxruntime's native addon in a second worker thread of the same process
    after the first worker exited (`ERR_DLOPEN_FAILED`, reported as the
    `worker_native` category). After a worker is retired by a failure or a
    watchdog timeout, local narration therefore cannot load a replacement until
    the VS Code window is reloaded. Cancellation alone does not retire the
    worker, so ordinary use is unaffected. A replacement that survives an exit
    needs the engine in a separate process, which is deliberately not part of
    this release.

## Local Kokoro support detection, 2026-11-08

-   A user on the Ubuntu host reported working ElevenLabs but repeated local
    Kokoro `unsupported` diagnostics on 0.20.0. This isolates a support gate; it
    does not yet establish the exact host condition. The earlier detector used
    only Node's system report and classified missing evidence as unsupported.
-   Retain Linux x64 and host-placement checks. If the report is unavailable,
    accept only bounded positive GNU libc evidence from this process's mappings;
    a system getconf command could describe a different runtime. Keep musl,
    unknown, failed or incomplete evidence blocked. Copy only fixed failure
    categories, not reports, mappings, paths or environment values.
-   Model-presence diagnostics describe setup, separately from executable
    platform/runtime capability. A model cached by the workspace extension does
    not establish support on the local companion.
-   Centralize synchronous diagnostic exception isolation in one shared helper
    while preserving dynamic callback lookup and the original receiver. This
    retains the existing fault boundary and removes duplicated catch
    implementations; it does not permit observer errors to change operation
    outcomes. Exercise the actual bundled boundary through a real Controller
    consumer, and keep its model and independent unit tests.

## Batch file admission, 2026-11-08

-   The controller rejects an editing batch that names its file only after its
    first edit, before rehearsal or playback. Remove the player's duplicate
    late-name guard and its bookkeeping because accepted production batches
    cannot reach it. Keep the player guard against naming a second file and the
    public controller rejection. Direct calls to the internal player are not a
    substitute for controller admission.
-   The `BatchFile` model retains the file-before-edit invariant and its existing
    negative controls. The verified unreachable branch removal leaves its
    reachable state count unchanged; the native integration case still checks
    the public late-name rejection.

## Release integration boundaries, 2026-11-08

-   Verify session restoration with installed main and companion extensions in
    two normal VS Code launches sharing one disposable profile and workspace.
    Extension-test mode uses in-memory storage, so it cannot establish restart
    persistence. Require both stage results and a real workspace database.
-   Keep rare failure tests at named public editor or VS Code boundaries, with
    the real bundled controller, playback, terminal and reports around them.
    Restore descriptors, verify the failed outcome, and verify healthy recovery.
    These are controlled fault injections, not reproduced operating-system faults.
-   Isolate application and shared storage for native tests. Linux synthetic-key
    tests also use the basic password backend, send no cloud request, and remove
    the synthetic key unconditionally. The inspected runtime routes AI Pair
    secrets to application storage; its shared-secret allowlist is unrelated.
-   The restart harness bounds the launcher wait and requires the actual Code
    binary. Its timeout watchdog does not promise descendant cleanup for
    arbitrary CLI wrappers. Normal successful runs close their own windows.

-   Catalog integration tests intercept the fixed ElevenLabs voices endpoint
    before activation and return controlled provider responses. They exercise
    the real client, catalog and settings without sending the synthetic key
    to the network; they do not establish live account voice availability.

## CI ONNX Runtime installation, 2026-11-08

-   Set `ONNXRUNTIME_NODE_INSTALL_CUDA=skip` in the CI and VSIX workflows.
    Speech selects the CPU execution provider, which is packaged with the npm
    dependency; skipping the unused CUDA download avoids an external GPU
    artifact dependency during CI. This setting applies to CI only and does
    not change developer installations or ONNX Runtime versions.

## CI resilience and model selection, 2026-11-08

-   Use current GitHub-maintained Node 24 action releases and retry transient
    download failures, retaining the pinned release asset IDs and SHA-256
    verification. Exhausted retries and checksum mismatches still fail CI.
-   Keep the specs job present on every run. Only a pull request whose nonempty
    diff contains exclusively recognized test files or the explicitly named VS
    Code integration harness files skips TLC; source, model,
    workflow and unknown changes, an unavailable base, and push events run
    every model. Disabling rename detection checks both paths of a move.

## Batch identity on session recovery, 2026-11-08

Save the next batch ID with the session so a normal saved-session reload keeps
allocating beyond IDs already reported. When `nextBatchId` is missing or
invalid, use one above the largest unreported finished batch ID. Older
snapshots cannot recover IDs that have already left that list. Workspace
storage is asynchronous,
so a crash before its latest write can still reuse an ID. This change does not
replay interrupted work and does not address terminal command IDs (issue #11).

## Speech reminders, 2026-11-08

-   Treat one concise selected narration per batch as the usual shape, while
    preserving the one-selection and 45-word limits and the programmer's
    control of speech. After three accepted batches without a selection, a
    step report may remind the agent once and restart the count.
-   Gate the reminder on current local settings, provider prerequisites and
    output readiness. The companion answers an epoch-bound readiness query;
    no text, key or audio crosses it and no provider request is made. A local
    check cannot guarantee that a provider or audio device will succeed later.

-   Try TLC's official named release URL before the pinned asset API URL, after
    repeated API 504 responses. Both must match the same pinned SHA-256; the
    named release can change, so a mismatch falls back and never runs TLC.

## Reply timing preference

Reply timing is a persistent Settings choice, defaulting to immediate interruption.
The alternative waits for the current action boundary, which can delay a reply
during a long command. Stop remains immediate. The workspace and local companion
share the existing panel protocol and workspace configuration for this choice.

## Explicit session working directories

An explicit `start.cwd` is authoritative: it must name an existing absolute
directory inside an open editor workspace, or start fails before contacting the
editor. The relay searches client roots and its own working directory only when
`cwd` is omitted. This avoids silently applying relative edits and commands in
an unintended folder. A directory outside all open workspaces must be opened in
an editor before it can be used; this does not add external workspace support.

## Editor diagnostic snapshots

-   Report VS Code's snapshot-freshness caveat once per session, while retaining
    each file's diagnostic findings and specific check failures in every batch.
    VS Code does not confirm that a snapshot reflects the latest edit, even when
    it contains a diagnostic. A restarted or reloaded session may repeat the
    caveat.

## Relay and editor runtime identity

A new relay checks the selected window's extension version and the SHA-256 of
its shipped relay against the version and actual relay bundle running in the
MCP process before opening a connection. Missing or different identities fail
closed with update, reload, and reconnect guidance. Successful starts report
these identities and the editor build. Hashes identify local builds; they do not
attest to trust. Relays already running from older releases cannot perform this
check and may need to be restarted after every window is updated.

Archi revision 18 retains revision 17's runtime identity boundary and adds
the companion status and compatibility change. Its source passed Archi 1.5.1
validation; the regenerated standalone HTML opened in Chromium without page
errors and displayed its diagrams.

The packaged MCP harness is a test fixture: it has no production callers and
exercises an installed VSIX through the SDK. Keep it under the VS Code test
tree and typecheck it with the rest of that tree.

The current editor always provides runtime identity to its bridge. The only
production constructor supplies it, so the bridge requires it instead of
offering an unreachable omission. The discovery schema still accepts legacy
records without identity so a new relay can reject them with recovery guidance.

## Selective upstream PR 17 adoption, 2026-11-08

Adopt prompt completed-command delivery and honest working, ready and approval
status first, preserving queue depth and selected-speech policy. The acceptance
criteria are recorded in [the PR 17 acceptance document](docs/upstream-17-acceptance.md).
Existing working-directory, runtime-identity and recovery safety verification
must finish before feature integration.

Defer concurrent explanation/edit beats. The current player serializes `say`
and edits on a single tracked Timeline sleeper. Replacing a sleeper leaves
pause, hold, skip and interruption unable to control both waits; already-armed
old timers can continue, while replaced held waits can remain unresolved.
Supporting concurrent reading, speech and edits safely requires independently
owned completion and cancellation gates, including line/block reading and
existing deferred-reply boundaries. Human comfort also requires a later user
trial. Deeper queuing is deferred pending evidence that it removes meaningful
idle gaps beyond the current preparation/playback overlap.

## Command-result delivery

-   Wake a pending listen or an empty step when a completed batch contains a
    command result, even with later work queued. Completed typing and narration
    remain quiet; discarded steps and end calls still wait for the queue to
    drain. Interruption settlement takes precedence. This preserves the current
    action protocol, queue depth, and speech pacing.
-   Trial cherry-pick of BedirT's MIT-licensed `2e1f488` onto `6c075e2`
    conflicted in all 29 touched paths. Its beat protocol changes action and
    report shapes and its work-ahead setting changes pacing. Adapt the focused
    readiness rule instead of importing those incompatible changes. The trial
    does not establish compatibility for the rest of the stacked series.

## Ready status and companion compatibility

-   Show accepted batches that have not started as ready. Decrement the count
    when a queued batch starts, and clear it on discard or session end. The
    count does not include the playing batch. Keep command confirmation and
    the active state visible.
-   Version the private workspace-to-companion transport at 2 for the added
    status field; the public MCP protocol is unchanged. New workspace and
    companion versions reject mismatched preparation before attachment and
    ask the user to update both and reload. An older workspace may still
    select its existing legacy fallback after the new companion rejects it;
    new code cannot change that already-installed behavior. Saved panel state
    without the count is accepted and interpreted as zero.

## Local GPU controls and companion compatibility

Keep the GPU mode, setup check, and compute status in the local speech host.
The companion handles actions locally; its generic sender filters unsupported
updates, so neither action nor status becomes a workspace-to-companion frame.
Protocol version 2 therefore remains unchanged. An older companion does not
offer the new controls. The public MCP protocol is unchanged. The companion
panel routing test verifies that these controls stay local. GPU readiness still
requires a fresh verified launch capability and a working GPU inference worker.

## Separate GPU model and runtime

Keep the CPU q8 model and cache unchanged. GPU setup uses a separately pinned
FP32 model from the same upstream revision, requiring an additional download of
325,532,232 bytes. The q8 GPU candidate failed on a second input length; the
FP32 candidate passed the reviewed varied-input software test. GPU setup
copies and re-verifies the shared tokenizer and phonemizer assets into its own
cache before atomic installation. This evidence does not establish physical GPU
compatibility, which remains pending. The GPU child uses separately bundled
Node 22.23.4 on Linux x64, subject to the exact runtime manifest and trusted
loader verification gates. The GPU bundle
requires glibc 2.28 or newer; it does not install a driver.

The experimental GPU path requires a trusted, root-owned Vulkan loader and
Radeon driver. The capability carries the driver's canonical path, digest,
device and inode; positive checks must verify the mapped identity before
readiness and audio. The no-adapter negative control verifies the loader without
requiring the Radeon driver. The exact loader preload is confined to the child.
Root-owned native dependencies remain a trust assumption, and these checks do
not sandbox native code. The guarded path is enabled for an experimental host
trial after review; physical AMD validation remains required before describing
GPU support as a
validated release. Fresh proof has its own bounded deadline, separate from the
worker startup deadline.

## GPU process IPC encoding

Use JSON IPC for GPU proof and synthesis children so the extension host and
the separately bundled Node runtime do not depend on matching V8 serialization
versions. Encode WAV bytes as canonical base64 and enforce the existing WAV
size and response schema bounds before handing data to the client. The wire
format adds base64 overhead; it does not replace loader, driver, or model proof.

## GPU model operation placement

Route the pinned model's `ups.1/ConvTranspose` operation to CPU in both the
model proof and inference sessions. A same-input isolated test on the tested
Linux AMD system reproduced substantial WebGPU error at that operation. A
profiled original-model test placed that operation on CPU while retaining GPU
execution elsewhere; its raw waveform closely matched the CPU reference.
Strict negative and tiny graph proofs still forbid CPU fallback. This evidence
does not establish subjective audio quality or compatibility on other hardware.

## Speech settings presentation

Keep voice and listening controls prominent, and place synthesis tuning and
model provenance in native disclosures. Show model and GPU setup outcomes and
the reported backend outside the disclosure; setup readiness does not establish
that GPU is active. This changes presentation only: model pins, setup flow and
architecture remain unchanged.

## Restore selected speech output on startup

Refresh a persisted native output selection when its speech host starts, so
narration can use an available device without opening Settings. The legacy
host does this only when it owns speech. The default output keeps its existing
startup path. A missing device remains selected and unavailable until discovery
finds it; no fallback device is chosen. This addresses the saved-output case,
not every possible cause of a restart failure.

## Local Audio activation and preparation deadlines

The workspace extension invokes a private no-op readiness command on an
installed Local Audio extension with a
separate ten-second deadline before starting the 1.5-second prepare command
deadline. The command crosses VS Code extension hosts, unlike direct `Extension.activate()`
which cannot activate a foreign extension. Cold extension loading and cross-host
activation otherwise consume
the prepare budget. A late activation cannot begin preparation after the
deadline; a late prepare cannot commit. Timings are logged without session data
to distinguish activation from command latency. The ten-second bound permits
slower startup but cannot guarantee activation on every machine; the reported
timeout has not yet been reproduced on the affected host.

When attachment fails, a Command Palette action and warning actions expose the
same bounded diagnostics and output without registering a second provider. An
older incompatible companion may have different registration behavior, so an
unconditional fallback panel cannot safely establish sole ownership.

## Voice readiness in the toolbar

Project the local host's existing, sanitized readiness facts into a toolbar
button. Unknown facts stay unchecked, private transport loss and recorded
playback failure stay unavailable, and explicit GPU requires setup proof or an
admitted GPU worker. CPU fallback in Auto does not depend on GPU setup. Voice
and synthesis settings are checked separately from the cached diagnostic facts.
The button opens speech settings; its label describes checks, not a guarantee of
sound, network access, cloud credits, or future worker availability. The update
uses the existing local panel channel and introduces no new process or device
probe, so the architecture model and exports are unchanged.

## One owner for local speech lifecycle

`SpeechLifecycle` owns desired compute mode, generation-scoped health, unit
leases, worker lifetime and the shared GPU setup/proof slot. `SpeechService`
retains text segmentation, provider requests and playback orchestration. Hosts
persist preferences and project snapshots; they do not keep competing backend
busy flags. The former `SpeechCompute` controller is removed.

Canceling an operation aborts its proof, but releasing ownership requires the
actual child close or worker reaping. A successor request waits and continues
without a second user request. An unkillable process retains its physical lease;
we do not claim cleanup by merely returning an error. Read-only CPU discovery
checks cancellation between operations and rejects stale results.

A mode change starts a new generation with unchecked GPU health, rather than
inheriting a previous failure or claiming readiness. Refusing a setup check
while speech owns the worker is transient feedback and does not overwrite
verified health. Snapshot traces check resource ownership, stale callbacks,
health reset, and that disposed means resources have been reaped.

Normal deactivation and replacement wait for the predecessor's retirement.
Readiness, preparation, positive commit acknowledgement and workspace-session
creation are ordered so first narration cannot be sent before attachment.
Restart restores settings, never live worker or proof handles. Abrupt operating
system termination is outside this graceful-shutdown guarantee.

Solitary coverage, finite models, composed worker/host/router traces and real
child abort tests provide different evidence. Fake synthesis and output do not
prove AMD hardware compatibility or audibility. Physical CPU/GPU switching and
restart remain a separate host validation step; published readiness describes
cached checks and must not be presented as proof of sound.

## Prepare enabled local speech before pairing

`SpeechLifecycle` owns the desired warm-worker policy as well as narration
leases. Both speech host paths request preparation when enabled Kokoro settings
are loaded or changed; the legacy host does so only when it owns speech. The
manager serializes preparation with existing proof and worker retirement,
releases the warmup unit lease after admission and keeps the idle worker for
first narration. Disabled speech and a cloud provider do not request a local
worker. A mode change prepares the successor after the old resource is reaped.

Preparation performs model initialization without synthesis, playback, automatic
model downloads or cloud requests. Existing worker-load and GPU-proof deadlines
apply; CPU model lookup has no additional deadline. Successful explicit model
setup can retry a failed preparation. A failed worker does not enter an
unbounded automatic restart loop.

The toolbar projects the manager's phase: starting is orange and pulses, with
a static orange indicator for reduced motion. Readiness requires actual worker
ready evidence for Kokoro, together with the existing settings and output checks.
An unknown output route remains unchecked after model startup. Readiness does
not establish audibility; it is available before the first pairing session.

## Canonical architecture principles

Keep the repository's architecture principles in
[`.archi/MANIFESTO.md`](.archi/MANIFESTO.md), the default manifesto location
read by Archi-Techture. Agent entry points link to that single source. Adapt
the installed Archi 1.5.1 example to the repository's ownership, lifecycle and
verification requirements; do not attribute that shipped example to a personal
manifesto. The principles are review obligations, with automated enforcement
identified honestly. This documentation change adds no runtime boundary and
does not require architecture source or export regeneration.

## Native test scope and production coverage

Native fixtures exercise the modules loaded by the extension. A test can obtain
a core constructor from a live public API object, with a type-only import for
its signature. This avoids bundling a second implementation into the test and
claiming coverage of the production bundle.

VS Code resolves its API by the importing module's extension path. Place native
test bundles inside the extension's `dist-test` directory when they patch that
API. An entry outside the extension receives a separate default API object.
Alternatively, resolve the API from the actual extension entry. Assert that
each injected boundary runs, and restore overrides and owned resources.

Focused coverage measurements retain each generated bundle's own source map.
Merge source-level results only after remapping each bundle independently.
Generated offsets can differ even when original source content matches. The
complete native runner remains the final coverage gate; its floors stay intact.

## Adapt upstream panel layout without changing pairing policy

Issue #47 adopts the toolbar wrapping and anchored popup-menu layout from
BedirT's MIT-licensed upstream PR #19, commit
`25373cbef3d51a167440691c0680a2377e25a193`. A no-commit cherry-pick
against `30828e9` in a disposable worktree produced 19 conflicting paths.
The upstream monolithic `panelHtml.ts` has been replaced here by separate
HTML, webview TypeScript and CSS files, with additional voice, settings and
playback controls. The trial was discarded without changing the main checkout.

Reuse the existing narrow-toolbar wrapping and adapt the compatible popup
layout into those files instead of importing
the PR's learning modes, program approvals or parent feature stack. Keep
the current pace controls and command approval policy. A menu must remain
usable inside a narrow or short viewport, and opening another menu must
close its predecessor. Viewport resize must not strand an open menu.

This changes presentation within the existing webview boundary. It introduces
no runtime component or ownership boundary that requires Archi model exports.
The original MIT license remains applicable; the upstream commit records the
source of the adapted layout.

## OpenRouter speech eligibility and policy

Issue #49 adds OpenRouter within the existing speech service cloud slot and
output route. Kokoro worker ownership remains with `SpeechLifecycle`. The
provider owns bounded HTTPS requests; credentials remain in the local host's
SecretStorage. Provider, key, model, voice and policy changes invalidate
predecessor work rather than creating a second speech lifecycle.

Discover eligible models with the authenticated `models/user` endpoint, which
applies the supplied key's provider preferences, privacy settings and
guardrails. Never substitute the public catalog after an authenticated error.
The ZDR filter intersects that list with the public catalog's ZDR-capable
models and sends `provider.zdr: true` on synthesis. Turning it off omits the
request override and cannot weaken account guardrails. The account endpoint
has no documented ZDR query parameter.

OpenRouter's ZDR routing policy can permit Safety Retention when account
settings allow it. Label the control ZDR and explain this qualification; do not
claim the toggle independently guarantees strict zero retention. Corporate
restrictions must be attached to the actual API key. No management key or
full account-policy introspection is required.

Catalog eligibility evidence belongs to the catalog owner, independently of
request phase. A refresh or error retains known denial; an identity change
invalidates it. UI, readiness and synthesis admission consume that evidence,
and asynchronous admission rechecks it before network effects. A denial
cancels pending speech so late credential reads cannot start requests.

Load bounded model IDs and advertised voices from the authenticated speech
catalog instead of maintaining a three-model allowlist. Include account-listed
models without advertised voices and omit `voice` when the programmer chooses
the provider default. The catalog does not document each model's response
format, so discovery does not prove playback compatibility. Let the programmer
select PCM or MP3 for the selected model; never guess, retry another format
after a paid request, or silently select another model. A locally owned browser
decoder converts bounded PCM or MP3 responses to the existing 24-kHz mono WAV
contract before the selected output route plays them. Reserve a request-specific
decoder lease before the paid POST. Retire it on every error, cancellation, or
actual document destruction; a confirmed new webview boot invalidates a stale
lease and aborts provider work that has not yet posted. Allocate replacement
document identity before the handshake, but activate it only after its token is
acknowledged. Repeated current or pending tokens are idempotent, so stale-token
recovery cannot retire a live decoder. A running browser decode retains its
physical slot until it settles or its owning document is destroyed.

This covers models that accept the standard text input, chosen `response_format`
and optional voice fields. It does not infer provider-specific parameters or
guarantee that every account-listed model accepts every format or voice. Browser
audio decoding can bound bytes before work starts but cannot guarantee a strict
memory cap before the browser decoder allocates. Each browser document decodes
an embedded short MP3 self-test before admitting a provider request; a failed
self-test blocks the request before it can spend credits. Existing listening
speed applies after normalization; no provider-specific synthesis speed is
assumed. The self-test is an original 418-byte, 50-ms 440-Hz synthetic tone,
encoded locally with the installed libmp3lame 3.100 and independently decoded
with mpg123. Neither library is a runtime dependency.

The browser decoder imports its message schema through the protocol package's
`./speech_decode` leaf export. The aggregate protocol entry point also exports
Node-only workspace and wire helpers; importing it into the webview pulled
`node:path` and `node:os` into the browser bundle and broke production
packaging. Keep browser-facing imports on explicit browser-safe subpaths.

Sources: [OpenRouter TTS](https://openrouter.ai/docs/guides/overview/multimodal/tts),
[account-filtered models](https://openrouter.ai/docs/api/api-reference/models/list-models-filtered-by-user-provider-preferences-privacy-settings-and-guardrails),
and [ZDR policy](https://openrouter.ai/docs/guides/features/zdr).

Show OpenRouter's advertised input (`pricing.prompt`) and output
(`pricing.completion`) rates in the dynamic model choices. Preserve their exact
catalog strings and label them as rates per billing unit. The API does not
identify that unit, and TTS models may bill per character, token, or generated
audio time; do not infer a universal unit or use these rates as an exact cost
estimate. Missing or malformed pricing must not make an otherwise eligible
model unusable.

The Pair panel shows an OpenRouter speech subtotal for the current Pair session
using provider-reported generation `total_cost`, rather than guessing billing
units from catalog rates. A request enters the local ledger at POST dispatch;
the generation ID is captured from the response before decoding, so failures
after provider synthesis still count. Lookup runs independently of playback,
uses the credential sampled for that POST, and retries a bounded number of
not-yet-published results. Missing identifiers, invalid or unavailable results,
and restored hosts with unknown prior usage mark the subtotal incomplete.
Preview requests do not count. A new Pair session resets the ledger; suspend,
resume, view recreation and session end retain it. IDs, keys, narration and
charges are not added to logs or diagnostics. The subtotal is an in-memory
provider-reported figure, not an invoice or a total for other providers.

Start generation-cost lookup after the speech response settles. Retry only
the idempotent usage GET, with five attempts and 1, 2, 4 and 8-second delays;
each attempt is bounded to five seconds. The provider publishes no timing
guarantee, so exhausted lookups remain incomplete. Show fixed reasons on the
subtotal's tooltip; retain earlier unknown costs after restore instead of
claiming a complete total. This fixes a reproduced local timing race, without
establishing the cause of a specific account's missing costs.

Offer an explicit Require command approval control. It re-enables command
confirmation and clears both session-wide and remembered exact-command
permissions. The controller owns grants, and saved state reflects revocation.
An already-running command continues; later commands require a new decision.
The current controller enforces confirmation before the preference write
settles, and the player checks the current policy after saving files. A failed
preference write is shown to the programmer; confirmation remains enabled for
the current window, but its persistence across restart is not guaranteed.

## Scripted MCP flow regression gate

Use a scripted MCP client with the real relay, editor WebSocket, controller
and player to verify selected combined flow and recovery scenarios. Control
external effects and bound each operation with a seed and trace on failure.
Deliberately held effects establish that deadlines detect blocked work and
that releasing or canceling the hold permits recovery. Keep legitimate
approval, pause and listening waits distinct from unexplained stalls.
The fixed eight seeds cover two programmer-event orders. This is bounded
regression evidence, not exhaustive state-space or real-model validation.
Keep the separate real-editor and packaged integration gates; details are in
[the flow gate guide](docs/flow-regression-gate.md).

The session speech subtotal appears beside the voice control in four-decimal
form, with an asterisk for incomplete accounting. Its focusable tooltip and
accessible label retain the six-decimal amount, pending state and fixed reasons.
Positive costs below the compact precision use a less-than value rather than
appearing free; the ledger and its precision are unchanged.

## Per-action speech pacing

A `say` may set `speech_mode` to `continue` to let later actions proceed after
its normal reading pause while the voice plays. The default `wait` preserves
the existing gate. A later `say` waits for the preceding speech; the Player
keeps only one logical speech and the output owner retains physical ownership.
An interrupted or ended session cancels outstanding voice, so questions and
closing remarks should use `wait`. A remote owner that has not retired within
three seconds prevents another speech and reports text-only fallback; a late
matching acknowledgement can release the slot. A disabled legacy owner skips
admission; a disabled but unresponsive companion can still incur this bounded
retirement delay because its setting is owned by the companion. This bounds
the delay without claiming cancellation proves physical retirement.

The agent guide explains when to use each speech ordering mode and separates
voice completion from a human response. The bundled `/ai-pair-demo` demonstrates
`continue` narration alongside useful
editing and a `wait` question followed by listening. It uses the programmer's
existing speech setting and does not infer audibility from readiness. The
scripted demo remains separate; this instruction change does not alter session
ownership or the runtime architecture.

## Spoken narration rejection counts

Spoken narration errors report both whitespace-delimited word and Unicode code
point counts for string inputs. This helps agents shorten rejected text without
echoing potentially sensitive narration. Non-string inputs have no counts, and
the existing eligibility rules and display-only fallback remain unchanged.

## Portable teaching narration

Deliver brief teaching guidance through the existing MCP pairing guide rather
than changing a user's Claude or Codex configuration. Claude offers an
Explanatory output style; Codex supports reusable skills, but no shared
harness control was verified. The programmer successfully tried Anthropic's
explanatory approach in chat before requesting this integration.

The guide uses original, concise instructions informed by that assessment;
no upstream plugin code or hook is imported. Connections to earlier work must
be supported by conversation or verified session history. Similar repository
code is not evidence of shared experience, and completed narration is not
proof of learning. Teaching adapts to the programmer's request without forced
exercises, extra model calls, or a new learner-history store. Existing speech
limits and pacing apply. This instruction-only change does not alter runtime
ownership or the architecture model; live session quality remains a human
assessment rather than a unit-test claim.

## Attention cue cache

The local `SpeechService` owns a single in-memory, context-free waveform for
the fixed attention cue. It reuses existing synthesis, tempo and output leases,
and reserves the selected output afresh for every playback. Only a completed
playback populates the cache. Synthesis-affecting settings and credential changes
invalidate it eagerly; the next request synthesizes lazily. It never enters the
session narration context. This saves repeat provider requests while retaining
text-only operation if speech is unavailable. The cache is not persisted.

## Explicit cursor navigation

The toolbar can focus the editor at the agent's actual cursor without changing
turn or playback. It uses the editor's authoritative cursor rather than the
current follow target, which may be a pointed or narrated range. With no cursor
it does nothing. Cursor identity is checked after asynchronous preparation; a
navigation already accepted by VS Code cannot be recalled.

Remote attention cues use the existing narration job lease and a versioned,
text-free command. A terminal acknowledgement requires observed output or a
failure; cancellation retains the lease until output retirement is confirmed.

## Raising a hand during playback

The controller owns a transient attention state: none, requested, or granted.
A request waits at the next action boundary, or the next completed code-reading
chunk, and lets the current speech unit drain before granting the floor. The
hold stops further playback but does not pause the voice being drained. A second
click cancels a pending request; a reply or Resume releases a granted hold.
Ordinary pause reasons remain separate, so the fixed attention cue cannot
bypass them. Stopping, disconnecting, or replacing the session invalidates the
request. A continued speech unit remains owned by the player after its batch
ends and must drain before an idle request is granted.

Audio playback is optional and failures leave the text and floor available. Attention
is not restored as live state after reload; the controller publishes a fresh
snapshot after restoration. The bounded model abstracts the audio owner's
physical retirement, settings, and cue cache; those require separate checks.

## Cursor reveal follows the current agent position

The cursor button opens an existing document and centers the latest agent cursor,
including a file or offset change while VS Code is opening it. A newer request
supersedes an older request; a stale completion or failure has no further
effect. Navigation never creates a missing file, and reports an open failure.
VS Code can already have accepted a show before a request is superseded, so
that focus change cannot be retracted. Reveal leaves turn and playback alone.

## Required narration cue forwarding

`NarrationPort.attentionCue` is required on every narration adapter. The
narration port itself remains optional when audio is absent, and each owner
still honors disabled or unavailable speech. Making the method optional let
the production extension omit it while the independently tested service and
remote implementations appeared correct. The activation regression invokes
the actual adapter supplied to its controller, and the required type makes a
future omission a compile error. Cue forwarding uses the existing owner-ready,
cancellation-generation and shutdown gates; it adds no lifecycle owner.

The architecture source and export retain their existing controller, local
speech-service and output boundaries. This correction restores the documented
connection rather than changing that architecture. Unit adapter tests and
composed transport/output tests are separate evidence; they do not establish
hardware audibility or one complete activation-to-hardware run.

## Navigator observations and programmer messages

Observe workspace documents plus the current Pair cursor file outside the
workspace. This lets a named temporary example participate in pairing without
monitoring unrelated outside documents. Retire that outside mirror when the
Pair cursor changes or clears. Other previously read outside files are not a
persistent watch list. The editor supplies the native programmer caret; it
does not move the agent cursor or own navigator readiness.

The controller owns typing-pause generations and report acknowledgement.
An idle timeout can report edits without consuming a later typing-pause wake.
Navigator listens use a ten-second default idle limit, bounded by a smaller
configured maximum; the agent-turn default remains 45 seconds. Reports state
why the call returned and how long it waited. Numbered edit diffs are separate
from the agent cursor excerpt, so edits beyond that excerpt remain visible.

Keep immediate programmer messages canceling queued navigator `say` and
`point` actions. A reply is new intent and can make older observations stale;
retaining them can delay or contradict the response. Give one observation per
batch and listen before continuing a review. The explicit deferred-message
option retains its existing separate semantics. No new commentary queue owner
is introduced.

The relay accepts the documented delivery cue enum independently of speech
settings. Its response describes cues as advisory and conditional on enabled
context and model support. It cannot confirm actual provider application:
that acknowledgement is absent from the current narration boundary. This fix
does not add provider or cost plumbing. The matching 0.36.1 relay already
publishes `speech_mode` in actual MCP `tools/list`; the new conformance test
checks both fields and real calls rather than client presentation.

## Navigator commentary preference

Keep one saved Quiet / Helpful / Coach preference for navigator text and voice.
Helpful is the default. Quiet omits routine first-pause reassurance; Coach adds
useful explanations and connections to available, verified conversation
history. Explicit programmer requests override the saved preference for the
session. This is guidance to the agent, not an exact comment quota. Audio
remains independently enabled or muted.

The workspace extension owns persistence alongside other general preferences;
the local companion forwards intent and renders the owner's current snapshot.
The controller projects the current preference into reports after asynchronous
cursor lookup. Restoring canceled activity evidence cannot restore an old
preference. Changing the mode wakes a pending `listen` with a settings-only
report; if none is waiting, retain the latest notice for the next `listen`.
This replaces the initial deferred-until-another-event policy at the user's
request. Same-value assignments do not wake. Preserve edit evidence, turn
ownership, pauses, queued actions and current narration. A settings response
does not claim that playing batches have completed or acknowledge a typing
pause. Session-scoped notice identity makes canceled reports retryable without
restoring old configuration or consuming a newer change. No unsolicited MCP
push reaches a model that is still computing.

Delivery is at least once. Pending changes coalesce to the latest mode before
a notice commits. A change after commitment but before final projection can
produce the latest policy followed by another notice with that same policy.
Allow this narrow duplicate rather than add finalization state that could
acknowledge a successor session's update. No old preference is restored.

## Navigator follow-up: sightings, handback and net-zero activity

Count only full, visible new-side and context lines in navigator diffs as
line sightings. Bind them to the snapshot's line identities. Deleted lines,
hunk headers without content and omitted content confer no new sighting.
Replay cannot bind an old diff to successor text. Keep the existing line-shift
staleness and exact substring checks: a still-present prefix can be pointed
at while typing continues on the same line, without fuzzy matching.
Before granting sightings, compare the event's after-text to the current
tracked text without mutating the tracker. A pending historical edit can be
reported after an agent edit; it confers no new sighting if the texts differ.
Use `read` for those historical reports rather than replace live identities.

A plain no-message handback preserves eligible queued navigator observations.
A message or attached selection still introduces new intent and cancels stale
advice. Taking the turn and hand requests retain interruption behavior. Core
turn state is authoritative; browser and companion do not infer a handback
from potentially stale displayed state. Plain takeover and handback preserve
manual Pause until explicit Resume. Draft-empty events release only the draft
pause through its existing owner. Message/selection handback retains its
cancel-before-resume behavior. This replaces the old blanket turn auto-resume,
avoiding a paused-audio blip without pending-intent state or a turn replica.
For a no-message takeover, cancellation can wait for the workspace round trip.
Existing narration owners retain physical retirement responsibility; successor
speech cannot bypass it.
Refresh retained talk-only rehearsal state against real programmer edits and
the new driver turn, so the next driver batch uses current text and identities.

Separate edit authorship from actual interruption. Net-zero navigator edits
should not produce empty change reports or a typing-pause wake. Preserve the
later pause acknowledgement when a timeout already reported meaningful work;
an undo after such a report is itself a reportable reversal. Keep generation
checks when restoring canceled reports and consider all edited files.

## Command status and multi-line completion tracking

Keep physical execution identity, terminal reuse and bounded output in
PairTerminals. Player owns its current and unobserved-background command
metadata; this is logical report state, not another physical busy flag.
Controller projects those facts with its confirmation state. Late completion
callbacks capture the originating session: suspended same-session work can be
reported after resume, while ended or replaced sessions ignore it. Completion
news is noninterrupting, replayable, and wakes listen/empty-step without
pretending another batch finished. Use original run IDs for correlation.
Persist an immutable session UUID and stamp every production report with its
origin. Wire version 6 requires it. Reject missing or mismatched origins before
any restore mutation, including closed-session resurrection. This protects all
replayed facts, not just late command events, after JSON serialization. Legacy
saved sessions receive a fresh ID; current saved sessions keep theirs on revive.

A timeout is absence of observed completion. An exact VS Code execution end
supplies exit status; terminal closure supplies only a closed/unknown result.
The final output tail comes from the terminal owner's existing bounded reader
after bounded drain. Neither event authorizes a foreign execution or assumes
that the original process succeeded.

Native VS Code1.146/Bash tests independently reproduced a heredoc pipeline
writing its output file while its returned execution produced neither read
output nor an end event. A one-line Bash builtin-eval submission returned the
matching end and output, including failure status and same-shell cwd/export
controls. Apply this workaround only to positively identified Bash terminals.
Encode quotes, backslashes, newlines and control characters without command
substitution or temporary scripts. Keep original command text in approval,
reports and history. Eval changes trap/debug/error-context observability;
those diagnostic differences are an explicit limit, not exact equivalence.
Unknown shells keep their existing behavior and honest completion status.
Shell identity can arrive after shell integration: a native first-command probe
observed two unwrapped submissions in 30 fresh Bash terminals. Wait up to 500 ms
for authoritative identity only for multiline input whose shell is unknown;
known shells and single-line input do not wait. Cancellation or terminal closure
stops submission. If identity remains unknown at the deadline, submit the
original input; the wait is best effort, not a guarantee. A repeat probe saw all
30 submissions identified and wrapped. Separately, stock VS Code 1.146 can
associate a wrapped prompt with the wrong execution object at a narrow terminal
width. Pair retains exact identity checks; an isolated candidate upstream fix
passed the reproduction, but is not installed or a stock-host release check.

The new command-exit event is a breaking wire-union extension. Bump the
editor-relay protocol to 6 so older peers reject the connection clearly rather
than failing to parse a live report. Local Audio's panel protocol is unchanged.

## Packaged integration fixture ownership

VS Code attributes a test module's API facade by the extension root containing
that module. Native A/B profiles proved that a packaged test outside the root
never reached its stubbed input handler, while the same fixture inside the
root did. Generate fixture bundles under their corresponding selected
extension, including the audio companion, and clean only mktemp-owned fixture
directories. Keep isolated profiles and test credentials separate from users.

Relocated fixtures cannot derive workspace resources from their new
`__dirname`. Pass the pinned GPU test Node path explicitly from the launcher,
with the old development fallback for direct runs. Source-mapped coverage uses
development bundles; packaged functional probes establish shipped behavior
separately. No speech-provider or approval-policy change is involved.

## Marketplace publishing

Publish AI Pair and AI Pair Local Audio to the VS Code Marketplace from
GitHub Actions with Trusted Publishing, on a pushed version tag (#68). The
publisher `mattyv` trusts `publish.yml` in `mattyv/ai-pair` by name, so no
token is stored; Azure DevOps retires the global tokens that `vsce login`
needs. `main` takes changes only by pull request, so the release script pushes
the tag alone and no longer bumps, builds, or publishes from a workstation.
The workflow requires the tag to match both manifests and to be on `main`,
and repeats the Build VSIX checks before it packages. The Mac-specific builds
are not published. Whether a first publish of a new extension works through
Trusted Publishing is unverified; the fallback is a manual VSIX upload on the
publisher's page.
