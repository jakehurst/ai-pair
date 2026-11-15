# TLA+ specs

Models of the code's state machines, checked with TLC (issue #19). Run them all
with:

```sh
specs/check.sh            # TLC=<command> to use another TLC; default `tlc`
specs/check.sh --coverage # also counts how often each action fired, to coverage/tla/, and fails on one that never did
```

An action that never fires in any of a spec's configs fails
`check.sh --coverage` unless the spec's section below says so, in a sentence
that names the action in backticks and says it never fires (#161); no spec needs
that today. A spec's other configs are `Spec_<Model>.cfg`, each run against
`Spec.tla`, with its own statistics file (#169): `Discovery_InPlace.cfg` is the
one, where `Focus` and `FinishWrite` fire.

[COVERAGE.md](COVERAGE.md) maps every source file, function by function, to the
spec that models it, or says why it has none.

The specs and their configs follow the
[TLA+ style guide](tlaplus-style-guide.md) (#148). `npm run lint:tla`
(`scripts/lint_tla.ts`) checks the rules a script can check, in CI's `check`
job.

CI runs `check.sh` on every push to `main` and every pull request
(`.github/workflows/ci.yml`), with TLA+ tools 1.8.0. `check.sh` runs TLC on
every `.cfg`. `Spec.cfg` models the code as it
is on `main`, and has to pass. Regressions are caught by the unit and
integration tests. A spec's constants that switch a fix on or off still say
which bug each one fixed; the configs that reproduced those bugs were dropped
once the fixes were in.

## Tools

The TLA+ tools are one jar, `tla2tools.jar`, from the
[tlaplus/tlaplus releases](https://github.com/tlaplus/tlaplus/releases). CI and
local runs use 1.8.0, published 2026-10-06 (GitHub marks it a prerelease).
Check a download against the SHA-256 GitHub lists for it:

```sh
gh api repos/tlaplus/tlaplus/releases/tags/v1.8.0 \
  --jq '.assets[] | select(.name == "tla2tools.jar") | .digest'
shasum -a 256 tla2tools.jar
```

| Tool | Command |
|---|---|
| TLC, the model checker | `java -jar tla2tools.jar -tool -config Foo.cfg Foo.tla` |
| SANY, the parser | `java -cp tla2tools.jar tla2sany.SANY Foo.tla` |
| The formatter | `java -cp tla2tools.jar formatter.Main Foo.tla Out.tla` |

On Justine's Mac the jar is `~/.local/lib/tla2tools.jar`, and
`~/.local/bin/tlc` is the `tlc` command `check.sh` runs: a wrapper for
`java -jar ~/.local/lib/tla2tools.jar -tool`. The VS Code TLA+ extension ships
its own copy of the jar in its `tools/` folder.
The formatter's layout differs from the style guide (2-space indent, spaces
inside `<< >>` and `{ }`), so the specs are not run through it.

## Results

| Config | Bounds | Result | Distinct states |
|---|---|---|---|
| `AttentionCache.cfg` | two settings changes, one pending completion and cancellation | holds | 52 |
| `Serialize.cfg` | `NumCalls = 2` calls, each empty or not, the session ending, an interrupt, and the socket closing at any point | holds | 3,646 |
| `Wire.cfg` | `NumSockets = 2` sockets, `NumCalls = 2` calls | holds | 43,426 |
| `StructuralTyping.cfg` | both operations, closed and opaque field categories, selection and one or two closes | holds | 288 |
| `LineEndGuard.cfg` | rehearsal and live suffix danger, with or without acknowledgment | holds | 22 |
| `BuildIdentity.cfg` | two builds, installing and reloading | holds | 4 |
| `PanelMenus.cfg` | three menus, at most two clicks | holds | 12 |
| `Panel.cfg` | `MaxEvents = 5`, both display orders and the settings dialog | holds | 84 |
| `PanelScroll.cfg` | `MaxEvents = 5`, `ScrollOn = "you"`, both display orders | holds | 108 |
| `PanelReplay.cfg` | `MaxLog = 3`, `MaxEvents = 6` | holds | 127 |
| `Controller.cfg` | `NumBatches = 2` batches, `NumEvents = 1` event, `NumQuietEdits = 1` quiet edit, `MaxCancels = 2` | holds | 82,085 |
| `Discovery.cfg` | `NumWindows = 2` windows, one junk file, a write that may fail, a window that may refuse the hello | holds | 782 |
| `Discovery_InPlace.cfg` | the same, `AtomicWrite = FALSE`: the write in place, so `Focus` and `FinishWrite` fire; `FindsRunningProp` left out | holds | 1,106 |
| `EditorAdapter.cfg` | `MaxChanges = 5` changes, an edit refused, `create`'s save | holds | 3,195 |
| `FollowMode.cfg` | one move to another file, the programmer looking away, `HoldWhileShowing = TRUE`, the file in a visible editor or not | holds | 19 |
| `Bridge.cfg` | `NumSockets = 2` sockets | holds | 76 |
| `Draft.cfg` | `MaxPages = 3` pages, `ClearOnTaken = TRUE` | holds | 12 |
| `RunBox.cfg` | one `run`, the session ending at any point | holds | 10 |
| `FileText.cfg` | one file, `MaxChanges = 4` changes | holds | 123 |
| `Outside.cfg` | one file, `MaxWrites = 5` contents | holds | 614 |
| `Navigator.cfg` | `MaxEdits = 3` | holds | 136 |
| `NavigatorFollowup.cfg` | two files, two texts, plain handback and visible lines | holds | 864 |
| `NavigatorCommentary.cfg` | three modes, up to three changes, pending notice and canceled replay | holds | 1,566 |
| `EditEvents.cfg` | one file, 3 texts, `MaxEdits = 4` | holds | 843 |
| `Scroll.cfg` | `NumLines = 8` lines, a view of `ViewHeight = 4`, `MaxMoves = 2`, `MaxFollowSwitches = 2`, `scrollBeyondLastLine` on and off, the programmer's turn | holds | 14,131 |
| `ProjectGuide.cfg` | every tree of depth 2 over two names, any of its guides ignored by git | holds (`ASSUME`s) | |
| `Resume.cfg` | 2 directories, `MaxSessions = 3`, revive and replacement updates enabled | holds | 56 |
| `TerminalPanel.cfg` | two command IDs and automatic visibility | holds | 61 |
| `DiagnosticsCopy.cfg` | explicit request with clipboard success or failure | holds | 3 |
| `DiagnosticsRequest.cfg` | idle, active and suspended sessions; isolated diagnostic requests | holds | 456 |
| `DiagnosticsPrivacy.cfg` | bounded two-event history, copy and allowlisted projection | holds | 22,778 |
| `DiagnosticsPrivacy_Speech.cfg` | speech-only projection without a session | holds | 38 |
| `Timeline.cfg` | `MaxSleeps = 3` sleeps, holds, and a second sleep while one is pending | holds | 864 |
| `PlaybackPreference.cfg` | three modes and two independent pace settings | holds | 36 |
| `DeferredMessage.cfg` | one action, deferred reply and urgent stop | holds | 8 |
| `ModelStatus.cfg` | installed and missing model, verification | holds | 4 |
| `SpeechSetup.cfg` | two files; install, cancellation and rollback outcomes | holds | 42 |
| `SpeechPage.cfg` | two page identities and two narration units | holds | 28 |
| `CoreMlCompute.cfg` | every host capability, model and Core ML outcome, three modes | holds | 82 |
| `CloudNarration.cfg` | two generations, provider and credential epochs | holds | 264 |
| `CloudNarration_Healthy.cfg` | two generations with a healthy key read | holds | 251 |
| `SpeechSettings.cfg` | two credential reads and catalog requests | holds | 50,968 |
| `ProviderChoice.cfg` | two ordered settings writes and credential change | holds | 122 |
| `AudioOutput.cfg` | native jobs, route changes, retirement, and the system-default route (macOS helper, Linux PipeWire) | holds | 11,640 |
| `OutputAdmission.cfg` | overlapping output checks and stale completion | holds | 140 |
| `OutputHandoff.cfg` | worker admission and acknowledged browser retirement | holds | 270 |
| `OutputReplacement.cfg` | view replacement and old-page disposal | holds | 22 |
| `OutputDiscoveryLifecycle.cfg` | discovery completion after disposal | holds | 5 |
| `OutputPreference.cfg` | ordered choice, discovery and failed persistence | holds | 934 |
| `LocalAudioAdmission.cfg` | capability, device snapshot and cloud admission | holds | 624 |
| `LocalAudioOwnership.cfg` | local ownership, directional sequences and lease loss | holds | 3,632 |
| `PanelPlacement.cfg` | bounded activation and prepare, irrevocable commit and fallback | holds | 16 |
| `SentencePipeline.cfg` | two units, three parts, pause, cancel and late callbacks | holds | 2,242 |
| `SpeechTempo.cfg` | two units, two parts, rate changes and stale results | holds | 868 |
| `SpeechTempo_Healthy.cfg` | two fair completed units | holds | 17 |
| `SpeechTempo_Canceled.cfg` | fair retirement after cancellation or timeout | holds | 11 |
| `GpuProcessSlot.cfg` | shared inference and proof child ownership | holds | 5 |
| `SpeechBackendHandoff.cfg` | planned retirement, reaping and canceled request | holds | 8 |
| `GpuSynthesisProcess.cfg` | verified child, stale epochs, loader and retirement | holds | 132 |
| `WarmSynthesisWorker.cfg` | two epochs, two units and parts, stale and late completions, cancel between parts | holds | 440 |
| `WarmSynthesisWorker_Healthy.cfg` | two units reuse one healthy worker | holds | 11 |
| `WarmSynthesisWorker_Cancellation.cfg` | canceled inference returns and is discarded | holds | 440 |
| `WarmSynthesisWorker_Watchdog.cfg` | canceled inference may never return; watchdog retires it | holds | 440 |
| `WarmSynthesisWorker_Retirement.cfg` | fair physical worker exit | holds | 440 |
| `SentencePipeline_Healthy.cfg` | fair healthy synthesis, output and eventual resume | holds | 107 |
| `SentencePipeline_Canceled.cfg` | fair canceled inference and child retirement | holds | 137 |
| `MultipartAudioLease.cfg` | two units, three parts, pause and route loss | holds | 13,716 |
| `MultipartAudioLease_Healthy.cfg` | two completed units under fair child progress | holds | 59 |
| `LocalPanelReplay.cfg` | two chunks, two epochs, bounded text and malformed frames | holds | 138 |
| `LocalPanelReplay_Delivery.cfg` | two fair successful chunks | holds | 3 |
| `PlaybackAnchor.cfg` | three-character insert, cursor marker and all bounded programmer edits | holds | 20 |
| `PlaybackAnchor_Progress.cfg` | the same, with fair completion | holds | 20 |
| `CodePlayback.cfg` | three atomic edits, bounded groups, two pause states and three countdown IDs | holds | 654 |
| `CodePlayback_Progress.cfg` | the same edits with fair progress and no pause or interrupt | holds | 11 |
| `ReadingSkip.cfg` | two countdown IDs, hold, pause, turn and suspension changes | holds | 5,840 |
| `ReadingHold.cfg` | matching hold and release with changing pause state | holds | 444 |
| `Narration.cfg` | default wait, two queued units, two page and session epochs, interruptions and independent gates | holds | 8,684 |
| `SpeechOverlap.cfg`, `SpeechOverlap_Continue.cfg` | two jobs and two sessions; fair gates, with and without terminal fairness | holds | 141 |
| `SpeechWorker.cfg` | two jobs, cancellation, watchdog expiry and worker termination | holds | 19 |
| `ReadingGesture.cfg` | short and long gestures across two countdown IDs | holds | 170 |
| `ListeningHint.cfg` | status and session context | holds | 64 |
| `SettingsAccess.cfg` | idle and active toolbar | holds | 4 |
| `Terminals.cfg` | `NumTerminals = 2` terminals, `MaxRuns = 3`, 2 directories | holds | 3,361 |
| `QuietTerminals.cfg` | quiet default, fallback and guarded cleanup | holds | 9 |
| `QuietTerminals_Visible.cfg` | automatic show, fallback and guarded cleanup | holds | 11 |
| `TerminalReuse.cfg` | shell state, exposure, pending drain and foreign starts | holds | 48 |
| `Turns.cfg` | batches of up to 2 actions, `MaxTurns = 2` turn changes | holds | 1,419 |
| `Reload.cfg` | `NumLines = 5` lines, any of them changed on disk, a selection at a line's start or not | holds | 320 |
| `Rehearsal.cfg` | full configured bounds | not completed for this change | |
| `Rehearsal.cfg` (reduced) | `MaxLines = 2`, `MaxOthers = 1`, `MaxProgrammerEdits = 1`, `MaxBatches = 1`, `MaxQueued = 2` | holds | 11,712 |
| `BatchFile.cfg` | files `sourceFile`, `destinationFile`, and `otherFile`, `MaxActions = 4` actions a batch, `FallBackToNamed = TRUE`, `CursorInNamed = TRUE`, a selection or none | holds | 330 |
| `Diagnostics.cfg` | `MaxBatches = 3`, provider available or not, completed, interrupted, and failed batches | holds | 168 |
| `Actions.cfg` | every batch of up to 2 actions, an interrupt at any await, including a rejected typing edit | holds | 3,115 |
| `Player.cfg` | `MaxEdits = 2` | holds | 26 |
| `LineIdentity.cfg` | texts up to 4 characters, inserts up to 2 | holds (checked as `ASSUME`s) | |
| `Places.cfg` | texts up to 5 characters, needles up to 3 | holds (`ASSUME`s) | |
| `ActionValidation.cfg` | move and span places, including `next_close` and multi-close acknowledgment, `CheckAtText = TRUE` | holds (`ASSUME`s) | |
| `Typing.cfg` | texts up to 7 characters | holds (`ASSUME`s) | |
| `TypingEol.cfg` | up to 5 ordinary, LF, or CRLF input units; LF and CRLF document endings | holds (`ASSUME`s) | |
| `Anchor.cfg` | `MaxBatches = 4`, `Guard = TRUE`, `DropsHeld = FALSE` | holds | 113 |
| `Calibration.cfg` | `MaxRounds = 2` calibrations, `AwaitStore = TRUE` | holds | 46 |
| `PointFocus.cfg` | a point, a look-away, a closed tab, `MaxReplies = 2` replies or resumes, `DropStaleFocus = TRUE`, `RevealOnReply = FALSE` | holds | 67 |
| `Start.cfg` | `MaxPages = 3`, `MaxEnvironmentChanges = 4`, `MaxClicks = 2`, `DropStale = TRUE`, `ReaskOnSetUp = TRUE`, `InTerminal = TRUE`, `OneAgent = TRUE`, `NoteOnClick = TRUE`, `ClearOnExit = TRUE` | holds | 242,152 |
| `ListenGrace.cfg` | unbounded, `Grace = TRUE`, `ShowAbsent = TRUE`, `EndOnAnyCall = TRUE` | holds | 80 |
| `CommandDelivery.cfg` | queue bounded to two completions | holds | 84 |
| `ShfmtDownload.cfg` | two sources, three outcomes each | holds | 10 |
| `CommandTracking.cfg` | one execution, two session identities, late report and replay | holds | 18 |
| `CommandEncoding.cfg` | two shell types, six abstract character classes | holds | 24 |
| `IntegrationFixture.cfg` | workspace, packaged and companion roots | holds | 15 |

| `CiScheduler.cfg` | three configs, two worker slots | holds | 134 |
| `CiConcurrency.cfg` | two PR runs, one push, two manual runs | holds | 324 |

`Controller.tla` also passes at `NumBatches = 3, MaxCancels = 2` (570,008 states).

Each violation TLC found was checked against the code step by step before it was
reported. The traces are in the issues.

## Specs and the code they model

The code that implements a spec's action carries a comment naming the spec and
the action. The actions below have no code of their own: they stand for the
programmer, VS Code, the disk, the agent's MCP client, or the end of a run, so no
comment names them.

| Spec | Actions | What they stand for |
|---|---|---|
| `Actions`, `Bridge`, `FollowMode`, `Player`, `Reload`, `RunBox`, `Serialize`, `Wire` | `Finished` | the model's end: nothing left to do |
| `EditorAdapter` | `EditAsProgrammer`, `Reload` | the programmer typing; VS Code reloading a clean document from disk |
| `FileText` | `OpenDocument`, `CloseDocument`, `Write`, `Delete`, `Edit`, `Save`, `Reload` | VS Code and the disk |
| `Navigator` | `Lull` | the programmer pausing their typing for `navigatorIdleMs` |
| `Outside` | `CloseDocument`, `Edit`, `Save`, `WriteOutside` | VS Code, the programmer, and another program writing the file |
| `PanelScroll` | `Scroll` | the programmer scrolling the history |
| `Start` | `Choose`, `FlipCliAndFolder` | the programmer setting `preferredLocation`; the CLI installed or removed, or the folder closed |
| `Wire` | `AbortInClient`, `Deliver` | the agent's client canceling a call; the MCP SDK handing the relay's answer to the client |

### `PairDefs`: the vocabulary the specs share

No config: the module holds definitions only, as 5.2 of the style guide allows,
and the specs that `EXTENDS` it check them. `ActionKinds` is the nine kinds of
action (Actions, BatchFile, Turns); `SessionPhases` and `NoSession` a session's
phases (Bridge, Resume); `Views` what the panel shows of a session (Resume);
`PageStates` a webview's page, loaded or disposed (Draft, Start); `Calls` and
`NoCall` the agent's blocking calls (ListenGrace, Navigator); and
`PauseReasons` why playback pauses (Timeline). A spec that models one of
these takes the shared definition, so two specs always mean the same thing by
the same word, and could be put together without a clash (#197).
It also holds `Files` and `NoFile` for the specs that name files (BatchFile,
FollowMode, PointFocus), and the letters a text spec spells (`Letter`,
`OtherLetter`, `Space`, `LineFeed`, `CarriageReturn`) with `Seqs`, so that
`n` is a line feed in LineIdentity, Places, and Typing alike; each keeps its
own small alphabet, since one alphabet for all would multiply their state
spaces.

### `Serialize`: the chain of tool calls

`packages/core/src/controller.ts`. A constant `AbortInBlock` switches the abort
check at the top of `block()` (#1).

| Spec | Code |
|---|---|
| `Guard` | `serialize`: `guarded` checks `signal.aborted` once the call before has settled |
| `Rehearse` | `step`: an empty step blocks with no batch; else `await this.rehearse(...)`, the batch pushed onto the queue, or discarded when `stale` or ended, then `block()` |
| `FailRehearsal` | `rejectBatch`, or `rejectUnanchored` (#112): the call answers with the rejection at once; an abort meanwhile ends it with that, not `canceled` |
| `Cancel` | the `AbortSignal` firing; its listener in `block()` runs only if attached, and checks `this.call === call` |
| `Played` | the player finishing batches in queue order |
| `Return`, `Timeout`, `Commit` | `finishCall` from `ready()`, true at once for an ended session; an empty step, or one whose batch was discarded, once nothing is queued (#219); else where a step's batch is done or first in the queue (#150), or from the `maxBlockMs` timer; clears `this.call`, and reports on `call.session`, the session the call was made on |
| `HandBack` | `withCursor(...).then(call.resolve)`: the report handed back after the commit |
| `End` | `endSession`: `s.ended`, and `interrupt()` discarding every queued batch but the one playing; a step on a closed session refused by `requireSession()` |
| `Interrupt` | `interrupt()`, for an edit, a turn, or a batch that did not complete: every queued batch discarded, the one playing plays on (#151) |
| `CloseSocket` | the bridge's close handler: `abort()` on each of the socket's calls, then `disconnect()`, which closes an ended session (#174) |
| `Finished` | every call settled: the agent makes no more calls |

Each invariant was proved to bite with a mutation of a copy of the model, run
in TLC and then reverted. A stalled chain also leaves a call aborted while it
waits uncanceled, so its mutation breaks CancelReleases as well, and it ran
with the deadlock check off, since TLC otherwise stops first at the deadlock:

| Mutation | Breaks |
|---|---|
| `Commit` leaves `blockedCall` at 0, the old sentinel | `TypeOK` |
| `Guard` runs a call without waiting for the calls before it | `BlockedIsCurrent` |
| `Return` waits for the batch to be done, the spec before #150 | `ReadyAtHead` |
| an abort of a blocked call takes its batch off the queue | `CancelKeepsBatch` |
| `AbortInBlock = FALSE`, the code at 57ac07f | `CancelReleases` |
| the chain runs a call only after the calls before it were reported, as `this.chain.then(guarded)` with no rejection handler would | `ChainProgresses`, `CancelReleases` |
| `CloseSocket` aborts only the blocked call | `NeverBlockedClosed` |
| `Return` without its `ended` disjunct | `ReadyWhenEnded` |
| `Return` lets a discarded step go as one whose batch is done, the code before #219 | `DiscardedWaits` |

Every invariant and property names the test that proves the code obeys it; the
test's title carries its name:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `BlockedIsCurrent` | `controller.test.ts`: BlockedIsCurrent: a call waits its turn while another is blocked, and blocks only once that one has returned |
| `ReadyAtHead` | `controller.test.ts`: BatchEnds, ReadyAtHead: returns the first step immediately and blocks the second until the first finishes |
| `CancelKeepsBatch` | `controller.test.ts`: CancelKeepsBatch, BatchesDelivered: keeps a canceled step's batch queued and reports it later; CancelKeepsBatch, CancelReleases: cancels a step whose abort arrives during its rehearsal; CancelKeepsBatch, CancelReleases: a step canceled while it waits its turn never queues its batch |
| `CancelReleases` | `controller.test.ts`: CancelReleases, ChainProgresses, EventsDelivered: releases a blocked call without consuming the report; CancelKeepsBatch, CancelReleases: cancels a step whose abort arrives during its rehearsal; CancelKeepsBatch, CancelReleases: a step canceled while it waits its turn never queues its batch |
| `ChainProgresses` | `controller.test.ts`: CancelReleases, ChainProgresses, EventsDelivered: releases a blocked call without consuming the report |
| `NeverBlockedClosed` | `bridge.test.ts`: NeverBlockedClosed, CloseSocket: aborts a closed socket's calls, and suspends the session only when the socket owned it; `controller.test.ts`: NeverBlockedClosed, CancelKeepsBatch, CancelReleases: cancels a step whose abort arrives during its rehearsal |
| `ReadyWhenEnded` | `controller.test.ts`: ReadyWhenEnded: stops playing a session that closed while a batch played |
| `DiscardedWaits` | `controller.test.ts`: DiscardedWaits: reports a step discarded while an interrupted batch plays once that batch ends, then rehearses the next; `integration.ts`, in VS Code: the controller paths, where a step discarded during a batch's held last save waits for it |

### `Wire`: the relay's side of the WebSocket

`packages/relay/src/link.ts`, with the editor's replies from
`packages/core/src/bridge.ts`. Constants: `RejectPerSocket` (#3), `GuardedParse`
(#4, #30), `CheckAbort` (#29), `WaitForReturn` (#59; what it is for is checked
in `Controller`), `HandBackAnswered` and `MarkRepeats` (#67),
`CloseAfterShutdown` (#163). The agent's MCP
client is modeled too: it drops an answer once it has canceled, and it sends a
cancel even after it took the answer, since the SDK never removes its abort
listener. So the relay can't tell whether the agent saw a report whose cancel
came after its answer. The fix for #67 delivers it at least once: the relay
hands it back with `mayRepeat`, and the next report says it may repeat an
earlier one (`RepeatsMarked`).

| Spec | Code |
|---|---|
| `OpenSocket`, `Welcome` | `connect()` -> `open()` -> `openWindow()`, one attempt at a time; `welcome` sets `this.connection`, or after the link closed, closes the socket; a closed link opens none, and `open()` tries no other window once it closed (#220) |
| `Request` | the agent's tool call reaching `call()`, which awaits `connect()` |
| `AbortInClient`, `Abort` | the agent's client canceling; the relay handling `notifications/cancelled`: the abort listener in `call()`, which the SDK runs only while the call is unanswered, or for a request already answered, `handBack` with `mayRepeat` |
| `Deliver` | the relay's answer reaching the client, which drops it after a cancel |
| `Send` | `call()` registering the call in its socket's map and sending it, once no canceled call on the socket waits for its answer; the socket is open and the arguments are JSON, so the send cannot fail, and the model has no failed send (#180) |
| `CloseSocket`, `HandleClose` | `locate()` closing `this.connection`, or the editor's end closing; the `close` handler rejecting `Victims` |
| `Reply` | a `result` frame: `result`, or `return` for a call the relay marked canceled |
| `SendGarbage` | a frame that isn't a message (`parseEditorMessage`); `ws` hands every frame over as one `Buffer`, so the model has no other forms of a frame (#180) |
| `RejectHello` | a `rejected` answer to the hello, after which the bridge closes its end: `openWindow()` rejects, and the `close` handler runs with no welcome |
| `Shutdown` | `serve()` in `server.ts`: the harness ends stdin, and it closes the server and `link.close()`, which closes `this.connection` and marks the link closed |
| `Finished` | nothing: the model's sockets are used up, the relay crashed, or it shut down and closed the sockets it opened, and the run ends |

Each invariant and property was proved to bite with a mutation of a copy of
the model, run in TLC and then reverted:

| Mutation | Breaks |
|---|---|
| `Request` sets a call to a state outside `CallStates` | `TypeOK` |
| `RejectPerSocket = FALSE`, the code before #3 | `OwnCloseOnly` |
| `GuardedParse = FALSE`, the code before #4 | `RelayStaysUp` |
| `CheckAbort = FALSE`, the code before #29 | `NoReportLost` |
| `MarkRepeats = FALSE` | `RepeatsMarked` |
| `HandBackAnswered = FALSE`, the code before #67 | `DroppedHandedBack` |
| no fairness on `Reply` | `CallsAnswered` |
| `Finished` left out of `Next` | the deadlock check |
| `CloseAfterShutdown = FALSE`, the code before #163 | `ExitsAfterShutdown`: the harness ends stdin while socket 1 connects, socket 1 fails, `open()` goes on to socket 2, and its welcome leaves it open with nothing to close it (49,428 states) |
| `WaitForReturn = FALSE`, the code before #59 | nothing here, with the same 43,426 states: what it is for is checked in `Controller` |

Every invariant and property names the test that proves the code obeys it;
the test's title carries its name:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `OwnCloseOnly` | `link.test.ts`: OwnCloseOnly: rejects a call only when the socket it was sent on closes |
| `RelayStaysUp` | `link.test.ts`: RelayStaysUp: fails to connect, without crashing, when a window answers with $name (a string, a number, an array, an object with no type, or a rejection whose reason isn't a text); RelayStaysUp: drops a frame that is not a message after the welcome, and an answer to no call; `integration.ts`, in VS Code: RelayStaysUp, ConnectedToOpen: a relay skipped the windows that are not, canceled and shut down cleanly, and started without AI_PAIR_HOME |
| `NoReportLost` | `link.test.ts`: NoReportLost: doesn't send a call that was cancelled before it went out |
| `RepeatsMarked` | `relay.test.ts`: RepeatsMarked, NoUnmarkedRepeat: delivers a report again, saying it may repeat, when the agent cancels after taking it (#67) |
| `CallsAnswered` | `link.test.ts`: CallsAnswered: tells the agent to call `start` again when the editor disconnects during a call (#138) |
| `DroppedHandedBack` | `link.test.ts`: DroppedHandedBack: hands a report back on the socket it came over, marked as maybe seen, and nothing it cannot; `relay.test.ts`: DroppedHandedBack, NoUnmarkedRepeat: hands back a report the agent canceled after the relay answered it, saying it may repeat (#67); `server.test.ts`: DroppedHandedBack: hands back an answered report once, and passes every message on to the SDK (#67) |
| `ExitsAfterShutdown` | `link.test.ts`: ExitsAfterShutdown: closes a socket the editor welcomes after the link closed, and opens none after it; `server.test.ts`: ExitsAfterShutdown: connects, and once stdin ends, closes the server and then the link (#163); `relay.test.ts`, end to end: ExitsAfterShutdown: serves until stdin ends, then closes the server and the link (#163) |

### `PanelMenus`: menu ownership

The panel page opens at most one of the playback, reading, and code menus.
The finite model bounds clicks at two, has three menu identities, and assumes
no fairness. It does not model pixel placement or browser focus. TLC checked
12 distinct states with `PanelMenus.cfg`.

| Invariant | Code test |
| --- | --- |
| `TypeOK` | `webview/panel.test.ts`: TypeOK, OneOpen, RequestedVisible, ClosedWhenNone, ClickShows: opening another menu closes the first and Escape closes the last |
| `OneOpen` | `webview/panel.test.ts`: TypeOK, OneOpen, RequestedVisible, ClosedWhenNone, ClickShows: opening another menu closes the first and Escape closes the last |
| `RequestedVisible` | `webview/panel.test.ts`: TypeOK, OneOpen, RequestedVisible, ClosedWhenNone, ClickShows: opening another menu closes the first and Escape closes the last |
| `ClosedWhenNone` | `webview/panel.test.ts`: TypeOK, OneOpen, RequestedVisible, ClosedWhenNone, ClickShows: opening another menu closes the first and Escape closes the last |
| `ClickShows` | `webview/panel.test.ts`: TypeOK, OneOpen, RequestedVisible, ClosedWhenNone, ClickShows: opening another menu closes the first and Escape closes the last |

The click count witnesses user actions independently of menu state, so an open
action that ignores a click violates `ClickShows`. TLC rejected five mutations:
assigning a negative count violated `TypeOK`; retaining the previous menu on
open violated `OneOpen`; opening no menu violated `RequestedVisible`; keeping
the menu on close violated `ClosedWhenNone`; ignoring a click's requested menu violated
`ClickShows`. The click counter is bounded only for model checking.

### `Panel`: the history

The page, `packages/vscode/src/webview/panel.ts`. `Fix = 1` is the code
since #18.

| Spec | Code |
|---|---|
| `OpenSettings`, `CloseSettings` | the Settings dialog opens and closes |
| `SwitchOrder` | the setting changes the displayed order without changing events |
| `Say` | `setNow` |
| `AddEntry` | `addYou`, `addRun`, `addOutside`, the interrupt and turn dividers: `add()` |
| `ChangeSession` | the `session` event: a start, an end, and a suspension or resumption shown for the first time |
| `RepeatSession` | the `session` event repeating a suspension the page already shows (#138): the band is filed and emptied, with no divider |
| `currentMessage`, `messageFiled`, `bandVisible`, `WithMessageFiled` | `current`, `filed`, the current narration, and `fileCurrent()` |

Each invariant was proved to bite with a mutation, run in TLC and then
reverted. NewestFirst implies NoDuplicates (a strictly decreasing history has
no duplicates), so NoDuplicates' mutation ran with NewestFirst left out of the
config:

| Mutation | Breaks |
|---|---|
| `AddEntry` stamps the entry with the old time, 0 at first | `TypeOK` |
| `Fix = 0`, the code at 57ac07f (`Fix = 2` passes) | `NewestFirst` |
| `ChangeSession` drops the band's message | `NoneLost` |
| `RepeatSession` drops the band's message | `NoneLost` |
| Fix 1 never marks the message as filed | `NoDuplicates` |
| Present the logical history without reversing it in oldest-first order | `DisplayOrdered` |
| Leave the filed message visible in the band | `VisibleOnce` |
| Hide a new message in the band | `NoneLost` |

Every invariant names the test that proves the code obeys it:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `VisibleOnce` | `webview/panel.test.ts`: VisibleOnce, NoneLost: shows each agent and programmer message once in each order |
| `DisplayOrdered` | `visual/chat_order.spec.ts`: DisplayOrdered, NoneLost and NoDuplicates: switching reverses populated history and keeps the draft |
| `NewestFirst` | `webview/panel.test.ts`: NewestFirst, NoneLost: puts a reply above the agent message it answers; NoDuplicates, NewestFirst: files the current message once, before anything added while it was current |
| `NoneLost` | `webview/panel.test.ts`: NewestFirst, NoneLost: puts a reply above the agent message it answers |
| `NoDuplicates` | `webview/panel.test.ts`: NoDuplicates, NewestFirst: files the current message once, before anything added while it was current |

### `PanelScroll`: the history's scroll position

`add` and `addYou` in `packages/vscode/src/webview/panel.ts`. Issue #139
and #5. `ScrollOn = "you"` reveals the programmer's message. The model
abstracts the viewport to one entry and permits newest-first browser anchoring
at the top to keep the old entry. Oldest-first follows the latest edge only
when already there, and preserves the visible entry otherwise.

| Spec | Code |
|---|---|
| `AddEntry` | add a filed message, run, divider or outside change |
| `AddYours` | add a programmer message and reveal the newest edge |
| `Scroll` | the programmer scrolling the history |
| `SwitchOrder` | reverse the entries and preserve the visible position |
| `view` | the visible entry tracked by browser scroll anchoring |

Each invariant was mutation-tested in TLC and the mutation reverted:

| Mutation | Breaks |
|---|---|
| Set the view to 0 on addition | `TypeOK` |
| Clear the view on addition | `ViewAtEntry` |
| Keep the old view when a reply arrives | `YoursInView` |
| Always follow the latest entry | `KeepsPlace` |
| Keep the old view when the latest entry arrives | `FollowsLatest` |
| Clear the view on an order switch | `SwitchKeepsPlace` |

| Invariant | Proved by |
|---|---|
| `YoursInView` | `visual/chat_order.spec.ts`: FollowsLatest, KeepsPlace and YoursInView: oldest-first tracks the reader |
| `KeepsPlace` | `visual/chat_order.spec.ts`: FollowsLatest, KeepsPlace and YoursInView: oldest-first tracks the reader |
| `SwitchKeepsPlace` | `visual/chat_order.spec.ts`: SwitchKeepsPlace: switching order keeps the visible history entry in place |
| `FollowsLatest` | `visual/chat_order.spec.ts`: FollowsLatest, KeepsPlace and YoursInView: oldest-first tracks the reader |
| `ViewAtEntry` | Browser scrolling keeps the view within the history |
| `TypeOK` | The TypeScript compiler checks these types |

### `PanelReplay`: the panel's log and its replay

`post` and `ready` in `packages/vscode/src/panel.ts`, and the page's
`setActive`. `KeepSession` is the fix for #54.

| Spec | Code |
|---|---|
| `Post(e)` | `post()`: the event onto `log`, the oldest cut beyond `MAX_LOG`, the last `session` event kept |
| `ReplayShowsSession` | a view created now: `ready` -> `replay`, its session state from the log's last `session` event |

Each invariant was proved to bite with a mutation, run in TLC and then
reverted:

| Mutation | Breaks |
|---|---|
| `Post` sets `liveViewSession` to every event, "other" too | `TypeOK` |
| `KeepSession = FALSE`, the code before #54 | `ReplayShowsSession` |
| `Post` never cuts the log | `Bounded` |
| `Post` leaves a non-session event off the log | `LogsPosts` |

Every invariant names the test that proves the code obeys it:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `ReplayShowsSession` | `panel.test.ts`: ReplayShowsSession and Bounded: keeps the session's start in the log however many events follow it; ReplayShowsSession: replays the session's end when that is the last session event |
| `TypeOK` | `captures only completed speech and preserves it across cancellation and replay` |
| `Bounded` | `panel.test.ts`: ReplayShowsSession and Bounded: keeps the session's start in the log however many events follow it |
| `LogsPosts` | `panel.test.ts`: LogsPosts: a posted event is on the log a new view replays |

### `Controller`: what reaches the agent

`packages/core/src/controller.ts`, with `call` and `return` in `link.ts`. Every
event and batch result reaches the agent exactly once, and since #67 at least
once: nothing reaches the agent twice in a report not marked `repeated`
(`NoUnmarkedRepeat`), and everything reaches it (`BatchesDelivered`,
`EventsDelivered`, `QuietDelivered`). A batch planned without knowledge of an
interrupting event never plays (`PlaysKnowingEvents`); a batch plays only if the
one before it completed (`PlaysAfterCompleted`); every blocked call returns
(`BlockedReturns`: `Commit` is enabled whenever a call is blocked, as the
`maxBlockMs` timer ends it); and the programmer ending the session reaches the
agent (`EndDelivered`). `RestoreRejected` is the fix for #28. `WaitForReturn` is
the fix for #59: the relay sending a call only once every canceled call on the
socket has settled, so a `return` reaches the editor before the next call.
`RestoreEnded` is the fix for #60: `restore()` working on a session the
programmer ended, and putting a closed one back. `MarkHeld` and `DrainHeld` fix
two bugs this spec found, each needing two rejections held at once, which a
cancel after an answer allows. Each held rejection now keeps its own repeat
mark, where before only the first report after them was marked. And a session
the programmer ended stays open until its held rejections are out, one per
report, where before it closed with the first.

| Spec | Code |
|---|---|
| `Submit`, `Listen` | `step` with a batch, in the agent's turn (a `say` or `point` batch in the programmer's turn is `Turns`'s); `listen`; with `WaitForReturn`, held while a report is on its way back (`Sendable`) |
| `EndByProgrammer` | `endSession()`: `ended`, the `end` event, `interrupt()` |
| `FailRehearsal`, `PassRehearsal` | `rejectBatch()` with the action the rehearsal `failed` at, or `rejectUnanchored()` before any rehearsal (#112); the batch queued, or discarded when `stale`, then `block()` |
| `Play`, `Complete` | `run()` |
| `Interrupt` | an interrupting event: `interrupt()` discards what is queued and sets `stale`; a turn change, `takeTurn` or `handBack` |
| `Commit` | `finishCall` -> `snapshot`, which also hands out one `held` rejection; with the session ended, `close()` |
| `Cancel` | the agent canceling a call |
| `Deliver`, `Bounce`, `Restore` | the report reaching the agent; the relay's `return`; `restore()` |
| `BounceLate` | the agent's cancel coming after it took the answer: the relay's `handBack` with `mayRepeat`, and `restore()` setting `s.mayRepeat`, so the next report is marked `repeated` (#67) |
| `EditQuietly` | `userEdit` in the programmer's turn: recorded, interrupting nothing |

Each invariant and property was proved to bite with a mutation of a copy of the
model, run in TLC and then reverted:

| Mutation | Breaks |
|---|---|
| `Listen` sets `callBatch` to 0, the sentinel before `NoBatch` | `TypeOK` |
| `MarkHeld = FALSE` | `NoUnmarkedRepeat` |
| `Commit` leaves `stale` false while rejections are still held | `HeldMeansStale` |
| `PassRehearsal` queues a batch while `stale` | `PlaysKnowingEvents` |
| `Commit` leaves out the batches that did not complete | `PlaysAfterCompleted` |
| `WaitForReturn = FALSE`, the code before #59 | `PlaysAfterCompleted` |
| `RestoreRejected = FALSE`, the code before #28 | `PlaysAfterCompleted` |
| `DrainHeld = FALSE` | `BatchesDelivered` |
| `Restore` drops the events of a report handed back after the end | `EventsDelivered` |
| `Commit` holds back the programmer's quiet edits during their turn | `QuietDelivered` |
| `Commit` leaves out the end event | the deadlock check; with it off, `EndDelivered` |
| `RestoreEnded = FALSE`, the code before #60 | the deadlock check; with it off, `BatchesDelivered`, `EventsDelivered`, and `EndDelivered` |
| `Commit` only with something to report, as if `block()` set no `maxBlockMs` timer | `BlockedReturns` |

Every invariant and property names the test that proves the code obeys it; the
test's title carries its name:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `NoUnmarkedRepeat` | `controller.test.ts`: NoUnmarkedRepeat: says a returned report may repeat one already seen, and marks each returned rejection the agent may have seen; `relay.test.ts`: DroppedHandedBack, NoUnmarkedRepeat: hands back a report the agent canceled after the relay answered it, saying it may repeat (#67); RepeatsMarked, NoUnmarkedRepeat: delivers a report again, saying it may repeat, when the agent cancels after taking it (#67) |
| `HeldMeansStale` | `controller.test.ts`: HeldMeansStale, BatchesDelivered: reports a returned rejection again, discarding steps until it has |
| `PlaysKnowingEvents` | `controller.test.ts`: PlaysKnowingEvents: discards a batch planned before an interruption the agent has not seen |
| `PlaysAfterCompleted` | `controller.test.ts`: PlaysAfterCompleted: discards the queued batches behind one that didn't complete, and takes none of its lines; `player.test.ts`: RejectInterruptedEdit: returns the untyped suffix and restores the cursor through a programmer edit; PlaysAfterCompleted, PlaysNothingTwice, StopAtCheck: hands back what's left of a type cut short, before the marker or after it, and nothing if none was typed; `link.test.ts`: PlaysAfterCompleted: sends the next call only after a canceled call's report is handed back (#59) |
| `BatchesDelivered` | `controller.test.ts`: CancelKeepsBatch, BatchesDelivered: keeps a canceled step's batch queued and reports it later; BatchesDelivered: keeps an ended session until its returned rejections are reported, one per call; HeldMeansStale, BatchesDelivered: reports a returned rejection again, discarding steps until it has; `relay.test.ts`: BatchesDelivered: reports the rejection of a step canceled during its rehearsal (#28) |
| `EventsDelivered` | `controller.test.ts`: CancelReleases, ChainProgresses, EventsDelivered: releases a blocked call without consuming the report; EndDelivered, EventsDelivered: reports a returned report again after the programmer ended the session with it (#60); EventsDelivered: returns once something interrupts, and not for a quiet edit by others; `relay.test.ts`: EventsDelivered: cancels a blocked call without losing the report, even when racing |
| `QuietDelivered` | `controller.test.ts`: NotWhileTyping, EditsReported, QuietDelivered: waits in the programmer's turn until they pause typing, or hand the turn back |
| `BlockedReturns` | `controller.test.ts`: BlockedReturns: returns with `waiting` after MAX_BLOCK |
| `EndDelivered` | `controller.test.ts`: EndDelivered: ends when the programmer ends it, delivering a final report; EndDelivered, EventsDelivered: reports a returned report again after the programmer ended the session with it (#60) |

### `Discovery`: finding a window

`writeDiscovery`, `focused` and `dispose` in `bridge.ts`, `findWindows` and
`open` in `link.ts`. `CheckFiles` is the fix for #31. `AtomicWrite` is the fix
for #72: a window rewrites its file each time it gains focus, and written in
place, a relay reading it mid-write skipped it. `locate` switching windows
mid-session is `CloseSocket` in `Wire`. With `AtomicWrite = TRUE`, `Focus` and
`FinishWrite` are not enabled: they are the write in place that the fix
removed. `Discovery_InPlace.cfg` sets `AtomicWrite = FALSE`, so they fire in a
checked run (#169); it leaves out `FindsRunningProp`, since that write is what
breaks it, as the mutation below shows.

| Spec | Code |
|---|---|
| `OpenWindow`, `CloseWindow`, `Crash`, `Reuse` | a window writing its file; `dispose()` removing it; a crash leaving it; its `pid` reused |
| `Focus`, `FinishWrite` | `focused()` -> `writeDiscovery`: in place, the file is truncated, then written; renamed, it is replaced whole |
| `OpenWindow` unlisted, `ListWindow` | the write failing (`failed`): the window runs, and no relay finds it; a later focus writing it |
| `Start` | `locate` -> `findWindows`: files that hold a `Discovery` with a live `pid`, and parse; it gives the workspace folder it matched too, which `workspace()` takes as the root (#180) |
| `Try` | `openWindow` on one candidate, best first; a window that refuses the hello (`rejected`, or garbage on its port) sends `open()` to the next |
| `Disconnect` | the socket closing, so the next call opens again |

Each invariant and property was proved to bite with a mutation of a copy of the
model, run in TLC and then reverted:

| Mutation | Breaks |
|---|---|
| `CloseWindow` leaves a state outside the window's states | `TypeOK` |
| `CheckFiles = FALSE`, the code before #31 | `NoInternal` |
| `AtomicWrite = FALSE`, the code before #72 | `FindsRunningProp` |
| `Try` connects without setting `connectedTo` | `ConnectedToOpen` |
| `Try` skips every candidate | `FindsOpen` |
| `Try` gives up at the first window that refuses the hello | `FindsOpen` |
| `FindsOpen` without `~refuses[w]`: a relay finds a window that refuses it | `FindsOpen` |
| `Try` connects to a window that refuses the hello | Nothing: `ConnectedToOpen` asks only that the window be open, and the relay's error for a refused hello is `link.test.ts`'s |

Every invariant and property names the test that proves the code obeys it:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `NoInternal` | `link.test.ts`: NoInternal: skips a file that isn't JSON, JSON that isn't a window's, and a file not named as JSON; `relay.test.ts`: NoInternal: skips a discovery file that parses but isn't a window's |
| `FindsRunningProp` | `bridge.test.ts`: OpenWindow, FindsRunningProp: listens on 127.0.0.1, then writes its discovery file beside it and renames it over; `integration.ts`, in VS Code: FindsRunningProp: the discovery file is never half written |
| `ConnectedToOpen` | `link.test.ts`: ConnectedToOpen, FindsOpen: tries the next window when one fails, and fails with the first error when all do; ConnectedToOpen: skips a window whose pid is gone, and keeps one it may not signal, which is alive; `relay.test.ts`: ConnectedToOpen: skips a window whose file outlived it, even when its pid now belongs to another process; `integration.ts`, in VS Code: RelayStaysUp, ConnectedToOpen: a relay skipped the windows that are not, canceled and shut down cleanly, and started without AI_PAIR_HOME |
| `FindsOpen` | `link.test.ts`: FindsOpen: opens one socket for calls made while it opens, reuses it, and opens again once it closed; `relay.test.ts`: FindsOpen: finds the window again after the relay's socket to it closes, while it stays open |

### `EditorAdapter`: who made a change

`edit`, `save`, `onChange`, and `byProgrammer` in
`packages/vscode/src/editor.ts`, which call the controller's `userEdit` or
`otherEdit`. `FlushBeforeSave` is the fix for #40. VS Code delivers a change
event before the call that made it resolves, and replies after the events sent
before them: one channel, in order. The programmer cursor is a read-only
projection of the active editor selection and is outside this attribution model;
it does not change any modeled transition. Eligible documents are workspace
files and the current agent cursor file; the host retires the latter when the
cursor moves or clears. This eligibility is an assumption of the model.

| Spec | Code |
|---|---|
| `EditAsAgent`, `ResolveEdit` | `edit()`: the entry in `own`, VS Code applying it, `finally` |
| `RejectEdit` | `edit()`: VS Code refusing the edit (`if (!applied) throw`), or the document unreadable: no change event comes |
| `StartCreateSave`, `FinishCreateSave` | `create()`, in `show()`: `doc.save()` on the document it emptied, without `saving` |
| `EditAsProgrammer` | a keystroke: its change event is queued for the extension host |
| `StartSave`, `RunParticipant`, `FinishParticipants`, `FinishSave` | `save()`: the round trip, `saving`, the save participants (format on save), the write |
| `Handle` | `onChange`: the agent's own edit, or `byProgrammer` |
| `Reload` | a file replaced on disk while open: VS Code reloads the document, and its change event is queued; `byProgrammer` takes a clean document reading what is on disk for a tool's |

A keystroke made while the save participants run can't be told from their edits,
since VS Code doesn't say who made a change. The spec allows that one wrong
attribution by name (`"programmerDuringSave"`). A reload from disk is told
apart by the document being clean and reading what is on disk, which a
keystroke never leaves, so it is a tool's (`"disk"`).

Each invariant and property was proved to bite with a mutation of a copy of the
model, run in TLC and then reverted:

| Mutation | Breaks |
|---|---|
| `ResolveEdit` leaves `ownEdit` in a fourth phase | `TypeOK` |
| `FlushBeforeSave = FALSE`, the code before #40 | `RightAuthor` |
| `onChange` never matches the agent's own edit | `RightAuthor` |
| `onChange` never runs | `ChangesHandled` |
| `Handle` without fairness | `ChangesHandled` |
| `Handle` takes a reload from disk for the programmer's | `RightAuthor` |
| `Handle` matches a rejected edit's entry to the next change | `RightAuthor` |
| `Handle` takes a change during `create`'s save for the programmer's | `RightAuthor` |
| `ResolveEdit` waits for a handled event, so a rejected edit's entry stays | `EditsEnd` |

Every invariant and property names the test that proves the code obeys it:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `EditsEnd` | `editor.test.ts`: EditsEnd, RejectEdit: rejects an edit its editor refuses, and forgets it |
| `RightAuthor`, `ChangesHandled` | `integration.ts`, in VS Code: RightAuthor, ChangesHandled: changes by others are reported as theirs; RightAuthor, ChangesHandled: a keystroke just before a save is the programmer's; `editor.test.ts`: RightAuthor, ChangesHandled: reports a keystroke as the programmer's, its changes from the highest offset down; RightAuthor: reports a reload from disk, read without its BOM, as others'; RightAuthor: counts as the programmer's a clean change that isn't what's on disk, an unreadable file, and an undo; RightAuthor, ChangesHandled: reports changes while we save as others', and after it as the programmer's; RightAuthor: edits a file in view through its editor, with its undo stops, and takes its change event for its own |

### `FollowMode`: our own navigation against looking away

`show`, `selfNav`, and `onActiveEditor` in `packages/vscode/src/editor.ts`, with
a `move` that shows its file before the agent cursor moves there.
`HoldWhileShowing` is the fix for #56.

| Spec | Code |
|---|---|
| `StartShow`, `WindowExpires`, `ShowResolves` | `show()`: our navigation starts; the window (`timings.selfNavMs`) runs out; `showTextDocument` resolves, and the `move` puts the agent cursor in the file |
| `ShowFile`, `HandleEditorChange` | VS Code's change of active editor, and `onActiveEditor` pausing as `away` outside the window |
| `LookAway` | the programmer switching files themselves |
| `ShowVisible` | `show()` returning early for a file in a visible editor (`visibleEditor`), before `selfNav()` |

Each invariant and property was proved to bite with a mutation of a copy of the
model, run in TLC and then reverted:

| Mutation | Breaks |
|---|---|
| `ShowFile` shows a file outside `Files` | `TypeOK` |
| `HoldWhileShowing = FALSE`, the code before #56 | `NoPauseFromOurOwnShow` |
| `LookAway` leaves `awayPause` as it was | `LookAwayPauses` |
| `ShowResolves` leaves the agent cursor where it was | `MoveEnds` |
| `ShowVisible` focuses the file's editor, as `showTextDocument` would | `NoPauseFromOurOwnShow` |
| `ShowResolves` only after a handled event, not after an early return | the deadlock check, and `MoveEnds` |
| `Next` without `Finished` | the deadlock check |

Every invariant and property names the test that proves the code obeys it:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `NoPauseFromOurOwnShow`, `MoveEnds` | `integration.ts`, in VS Code: NoPauseFromOurOwnShow, MoveEnds: our own move to another file doesn't pause; `editor.test.ts`: NoPauseFromOurOwnShow: leaves a file already in view as it is; NoPauseFromOurOwnShow, MoveEnds: a change of active editor during our show, or SELF_NAV_MS after, pauses nothing; LookAwayPauses: one later pauses |
| `LookAwayPauses` | `editor.test.ts`: NoPauseFromOurOwnShow, MoveEnds: a change of active editor during our show, or SELF_NAV_MS after, pauses nothing; LookAwayPauses: one later pauses; LookAwayPauses: follows the point when the focus is on it, and the cursor when there is no point. No test looks away in VS Code yet |

### `Bridge`: who drives the session

`dispatch` and the socket's `close` handler in `packages/core/src/bridge.ts`,
with the controller's session. `CheckOpen` is the fix for #42.

| Spec | Code |
|---|---|
| `BeginStart`, `FinishStart` | `dispatch("start")`: refused while another socket's session is active and not suspended; `controller.start()`; `this.owner = ws`, or on a socket that closed meanwhile, `this.owner = undefined` and `disconnect()`, which suspends the session it started, unowned |
| `CloseSocket` | the `close` handler: aborts the socket's calls, and `disconnect()` if it owns the session, which suspends it, unowned (#25) |
| `EndSuspended` | the programmer ending a suspended session: it closes at once |
| `EndByProgrammer`, `CloseEnded`, `EndByAgent` | the programmer ending the session from the panel, and its last report closing it; the agent's `end` |
| `Restore` | a `return` from the owner's socket: `restore()` puts a session its last report closed back, as ended (#60); `restorable` is `this.closed` |
| `Finished` | every socket closed, with no session: nothing more happens until another socket connects |

Each invariant and property was proved to bite with a mutation of a copy of
the model, run in TLC and then reverted:

| Mutation | Breaks |
|---|---|
| `EndSuspended` leaves the session in a fifth phase | `TypeOK` |
| `CheckOpen = FALSE`, the code before #42 | `OwnedByOpenSocket` |
| `CloseSocket` of the owner leaves an ended session ended | `EndedOwned` |
| `CloseSocket` of the owner leaves it the owner | `SuspendedUnowned` |
| `FinishStart` keeps the old owner when its socket closed (the code before this fix): 7 states | `SuspendedUnowned` |
| `FinishStart` opens no session | `StartOpensSession` |

Every invariant and property names the test that proves the code obeys it; the
test's title carries its name:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `OwnedByOpenSocket` | `relay.test.ts`: OwnedByOpenSocket: lets only one agent pair in a window at a time; OwnedByOpenSocket: doesn't leave a session to a socket that closed while it started |
| `EndedOwned` | `relay.test.ts`: EndedOwned: gives a session the programmer ended to its owner's next call, which closes it |
| `SuspendedUnowned` | `relay.test.ts`: SuspendedUnowned: suspends the session when the agent's harness goes away, and resumes it for the next agent (#25); SuspendedUnowned: a start whose socket closes while it runs leaves the suspended session to no one, even after another socket's session ended |
| `StartOpensSession` | `relay.test.ts`: StartOpensSession: runs a session: start with the guide, pipelined steps, read, end |

### `Timeline`: pausing

`packages/core/src/timeline.ts`, with the pause reasons in `Controller.pause`
and `Controller.resume`, and where they come from: the Pause button, the reply
box's draft, sending a reply, and the turn button (`panel.ts`), the Toggle Pause
command and the reading speed calibration (`extension.ts`, #109), and looking
away (`editor.ts`).

| Spec | Code |
|---|---|
| `Sleep`, `Fire` | `sleep(ms)` and its timer |
| `FinishEarly` | `Controller.finishReading` checks the live player's current reading ID, then the live `Timeline.finish()` completes that sleep without interrupting playback |
| `Hold`, `Release` | `Controller.holdReading` checks the live player's current reading ID, then the live `Timeline.hold()` or `Timeline.release()` freezes or resumes the delay; release respects a separate global pause |
| `Pause`, `Resume` | `Controller.pause(reason)` with `Timeline.pause()`; `Controller.resume(reason)`, or with no reason all of them, then `Timeline.resume()` |
| `Interrupt`, `Reset` | `interrupt()`; `reset()` for the next batch |
| `SleepAgain`, `FireReplaced` | `sleep(ms)` with a sleep pending, which no caller makes; the replaced sleep's timer in `arm`, which leaves `sleeping` alone (#174) |

A pause lasts until a resume, as PROTOCOL.md says: looking back at the code
doesn't end the `away` pause, and the agent isn't told about pauses.

Each invariant was proved to bite with a mutation of a copy of the model, run
in TLC and then reverted:

| Mutation | Breaks |
|---|---|
| `Pause` adds a reason outside `PauseReasons` | `TypeOK` |
| `Resume` of one reason resumes the timeline with others left | `PausedMatchesReasons` |
| `Pause` leaves the timer running | `NoTimerWhilePaused` |
| `Hold` leaves the timer running | `NoTimerWhileHeld` |
| `Interrupt` resolves the pending sleep but keeps it pending | `ResolvedOnce` |
| `Resume` never restarts a waiting sleep's timer | `ResumeContinues` |
| `FireReplaced` clears the pending sleep, the code without its check | `LatestPending` |
| `FireReplaced` leaves its sleep in `replaced` | `TypeOK` |

Every invariant names the test that proves the code obeys it; the test's title
carries the invariant's name:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `PausedMatchesReasons` | `controller.test.ts`: PausedMatchesReasons, NoTimerWhilePaused, ResumeContinues: holds playback until the last pause reason is gone; `webview/panel.test.ts`: PausedMatchesReasons: distinguishes actual pause, active playback, natural reading, and turn or confirmation waits (the display consumes the controller's aggregated flag) |
| `NoTimerWhilePaused` | `controller.test.ts`: PausedMatchesReasons, NoTimerWhilePaused, ResumeContinues: holds playback until the last pause reason is gone; `timeline.test.ts`: NoTimerWhilePaused, ResumeContinues: pauses a sleep with its time left, and resumes it for only that; `integration.ts`, in VS Code: NoTimerWhilePaused, ResumeContinues, ResolvedOnce: a pause held a say until the resume; an interrupt during a show cut the move, and the next batch played |
| `NoTimerWhileHeld` | `timeline.test.ts`: NoTimerWhileHeld: holds only the remaining time and resumes it on release |
| `ResolvedOnce` | `timeline.test.ts`: ResolvedOnce: resolves an interrupted sleep false once, and the next sleep after reset only when its own time is up. A `Promise` settles once, so no change to `timeline.ts` can resolve a sleep twice; the test checks what the code decides: `false` on an interrupt, and the next sleep's own time after `reset`; `integration.ts`, in VS Code: NoTimerWhilePaused, ResumeContinues, ResolvedOnce: a pause held a say until the resume; an interrupt during a show cut the move, and the next batch played |
| `LatestPending` | `timeline.test.ts`: LatestPending: an earlier sleep that runs out leaves the later sleep that replaced it pending, for an interrupt to cut short |
| `ResumeContinues` | `controller.test.ts`: PausedMatchesReasons, NoTimerWhilePaused, ResumeContinues: holds playback until the last pause reason is gone; `timeline.test.ts`: ResumeContinues: holds a sleep begun while paused until the resume, then runs all of its time; `integration.ts`, in VS Code: NoTimerWhilePaused, ResumeContinues, ResolvedOnce: a pause held a say until the resume; an interrupt during a show cut the move, and the next batch played |

Two sleeps at once: `sleep` accepts a second while one is pending, though no
caller makes one, and the first's timer, running out, leaves the second pending,
so an interrupt still cuts it short (`LatestPending`, #174). A replaced sleep's
own timer keeps running through a pause, and an interrupt does not cut it short;
no caller can reach either, since no caller makes a second sleep.

### `Anchor`: the cursor after a discarded batch

`step` and `snapshot` in `packages/core/src/controller.ts`. The agent plans a
batch against where the one before would have ended; when that one is
interrupted, discarded, or failed, the cursor is where it stopped (#112). `Guard`
switches the refusal; with `FALSE`, TLC violates `NoMisplacedEdit` in two steps:
`StopShort`, `SubmitUnanchored`. `DropsHeld` is the bug of #193: the refusal's
report took a rejection `restore` held and overwrote it; with `TRUE`, TLC
violates `NoRejectionLost` in three steps: `StopShort`, `Restore`,
`RefuseUnanchored`.

| Spec | Code |
|---|---|
| `StopShort` | a report with a batch not completed sets `anchorNeeded` |
| `SubmitAnchored` | a batch whose first action at the cursor is a `move` or `select` with `file` and `line`: accepted, and the flag cleared |
| `SubmitUnanchored` | any other action at the cursor first, accepted while the flag is clear |
| `RefuseUnanchored` | such a batch while the flag holds: `rejectUnanchored`, with `unanchored`, while nothing is held; with a held rejection, `step` discards it as stale and its report delivers the rejection |
| `Restore` | `restore` of a report with a rejection: onto `held`, and `stale` set (#67) |
| `TakeHeld` | `snapshot` taking one held rejection into the report of a `listen`, an `end`, or a step discarded as stale |

Each invariant was proved to bite with a mutation, run in TLC and then
reverted:

| Mutation | Breaks |
|---|---|
| `StopShort` leaves the cursor at a fourth place | `TypeOK` |
| `Guard = FALSE`, the code before #112 | `NoMisplacedEdit` |
| the guard refuses every unanchored batch, pending or not | `AcceptsUnanchored` |
| `DropsHeld = TRUE`, the code before #193 | `NoRejectionLost` |

Every invariant names the test that proves the code obeys it:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `NoMisplacedEdit` | `controller.test.ts`: NoMisplacedEdit, AcceptsUnanchored: refuses a batch after a discarded one unless it anchors the cursor with a file and line |
| `AcceptsUnanchored` | the same test |
| `NoRejectionLost` | `controller.test.ts`: NoRejectionLost: delivers a held rejection with the step discarded as stale before refusing an unanchored one (#193) |

### `Calibration`: calibrating the reading speed

The calibration flow in `packages/vscode/src/calibration.ts`, its view in
`webview/panel.ts` and `panel.ts`, the `calibrate` pair tool in `bridge.ts`,
the setting the rate is stored in, written by `extension.ts`, and the `say`
pause that reads it in `player.ts`.
Issue #109. The constant `AwaitStore` switches whether playback resumes before
or after the stored rate has been applied; with `FALSE`, TLC violates
`FreshRate` in five steps: `Supply`, `Go`, `StopTimer`, then a `StartSay` timed
with the default rate.

| Spec | Code |
|---|---|
| `Arm`, `Supply` | the Calibrate Reading Speed command, or the calibrate tool, which the bridge refuses unless idle; both add the calibrate pause reason |
| `Go`, `StopTimer` | the programmer typing go and x in the panel; the extension timestamps both |
| `ApplyRate` | `store` awaits the settings write, then `controller.setTiming` applies the new timing; once `store` resolves, `finish` removes the pause |
| `CancelCalibration` | any other reply, the view disposed, the session ending |
| `StartSay` | the reading time computed in the player from the timing in force at that moment |
| `EndSay` | the reading time's sleep ending |

Each invariant and property was proved to bite with a mutation, run in TLC and
then reverted:

| Mutation | Breaks |
|---|---|
| a say timed with a third rate | `TypeOK` |
| `Arm` does not pause | `PauseMatchesPhase` |
| `AwaitStore = FALSE`, the code before | `FreshRate` |
| the settings write is never applied: no fairness on `ApplyRate` | `StoreLands` |

Every invariant and property names the test that proves the code obeys it:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `PauseMatchesPhase` | `calibration.test.ts`: PauseMatchesPhase, FreshRate, StoreLands: measures the rate from go to x over the passage's characters, and holds the pause until the rate is stored; PauseMatchesPhase: cancels on any other reply, with nothing stored |
| `FreshRate`, `StoreLands` | `calibration.test.ts`: PauseMatchesPhase, FreshRate, StoreLands: measures the rate from go to x over the passage's characters, and holds the pause until the rate is stored |

### `PointFocus`: the view on a reply and on Resume

`resume` in `packages/core/src/controller.ts` and the `reply` message in
`packages/vscode/src/panel.ts`, with the scene's `focus` from `player.ts` and
the away pause from `editor.ts`. Found while working on #109: the view followed
a point until the next cursor action, so a reveal after the programmer had
looked away brought back a point from long ago, reopening a file they had
closed. `DropStaleFocus` switches that fix; with `FALSE`, TLC violates
`NoStaleReveal` in three steps: `Point`, `LookAway`, `ResumeAll`. Issue #125: every
typed reply revealed the target, since typing a draft pauses playback and a
reply lifts the pause, so a reply reopened a file the programmer had closed or
took them off the one they had switched to. `RevealOnReply` switches that fix;
with `TRUE`, TLC violates `ReplyKeepsView` in two steps: `LookAway`, `SendReply`.

| Spec | Code |
|---|---|
| `Point`, `ActAtCursor` | a `point` action setting the focus; the next cursor action taking it back, and showing its file (`player.ts`, `editor.show` before each edit) |
| `LookAway` | `onActiveEditor` away from the target: `pause("away")` |
| `CloseTab` | the programmer closing the target's tab, or every tab: `onActiveEditor(undefined)` returns early, so nothing pauses |
| `SendReply` | the panel's `reply`: `resume(undefined, { reveal: false })`, then `userMessage`; a stale point is dropped, and nothing is revealed |
| `ResumeAll` | the Resume button: `resume()`: with an away pause among the reasons and the focus on a point, the focus returns to the cursor and the editor is rendered before `reveal` |

Each invariant was proved to bite with a mutation of a copy of the model, run
in TLC and then reverted:

| Mutation | Breaks |
|---|---|
| `RevealOnReply = TRUE` | `ReplyKeepsView` |
| `DropStaleFocus = FALSE` | `NoStaleReveal` |
| `ActAtCursor` leaves the active editor | `CursorShown` |
| a point to a file outside `Files` | `TypeOK` |

Every invariant names the test that proves the code obeys it; the test's title
carries the invariant's name:

| Invariant | Proved by |
|---|---|
| `NoStaleReveal` | `controller.test.ts`: NoStaleReveal, ReplyKeepsView: a resume after a look-away reveals the cursor, not the point, and a reply reveals nothing |
| `ReplyKeepsView` | `controller.test.ts`: NoStaleReveal, ReplyKeepsView: a resume after a look-away reveals the cursor, not the point, and a reply reveals nothing |
| `CursorShown` | `player.test.ts`: CursorShown, ActAtCursor: brings the view back from far-pointed code with a far pause, and from near code with none |
| `TypeOK` | Nothing: the TypeScript compiler checks these types |

### `Start`: the Start a session button

`packages/vscode/src/panel.ts` (`askStart`, the `ready` and `start` messages),
`setup.ts` (`claudeStarter`), and `webview/panel.ts` (`canStart`, the button),
with `extension.ts` asking again after Set Up Agent. Issue #107. A page asks
once as it loads; the answer comes later, from Claude Code's configuration and
its CLI, both read when asked; pages come and go; the environment flips. Two
constants switch fixes the model found before the code was reviewed against it.
`DropStale`: the panel posted every answer to whatever view it had; with
`FALSE`, TLC violates `OwnAnswer` in three steps: `LoadPage` (page 2 loads),
then page 1's `AnswerCheck` lands on page 2. Issue #192 numbered the questions:
the model's `DropStale` had let any answer for the live page through, where the
code posts only the latest question's; with that rule, TLC violates
`LatestAnswerProp` in three steps: `FlipSetUp` asks again, its `AnswerCheck`
lands, then the first question's `AnswerCheck` lands after it. #200 made it an
action property: as an invariant over the newest answer, it also counted an
answer the page drops, so it failed on correct behavior once the bound allowed
two asks in flight, which `MaxEnvironmentChanges = 2` had hidden; the bound is
now 4. The same issue moved
the CLI check to the ask, where `available()` reads it. `ReaskOnSetUp`: the
page asked only as it loaded; with `FALSE`, TLC violates `ReaskedProp` in three
steps: `AnswerCheck` (hidden), then `FlipSetUp` sets Claude Code up with
nothing pending.
Issue #115 added how a start lands. `InTerminal`: the starter ran Claude Code's
open command, which brings Claude Code to the front with the prompt unsent and
writes `panel` to `claudeCode.preferredLocation`; with `FALSE`, TLC violates
`KeepsLocation` and `StaysOnPair` in two steps: `AnswerCheck` shows the
button, then `Click`. `OneAgent`: a second start while the first agent runs;
with `FALSE`, TLC violates `OneAtATime`. Issue #118 added the note the click
shows, Starting a
session with Claude Code, until a session starts. `NoteOnClick`: the page
changed nothing until the agent's `start` landed; with `FALSE`, TLC violates
`AcknowledgedProp` on the first `Click`. `ClearOnExit`: the note went only with
a session, so a CLI that exited without starting one left it up; with `FALSE`,
TLC violates `NoteGoes`: `Click`, then `AgentExits`, and the note stays.

| Spec | Code |
|---|---|
| `LoadPage` | `ready`: `askStart` numbers the question and calls `available()`, which reads `isSetUp` at once |
| `AnswerCheck(c)` | `available()` resolving with what it read when asked: Claude Code set up, the CLI found, a folder open; `canStart` is posted only if the question is still the latest; the page sets `hidden` |
| `Dispose` | `onDidDispose`; the next page starts hidden |
| `FlipSetUp` | Set Up Agent run or undone; `extension.ts` calls `askStart` after Set Up Agent |
| `FlipCliAndFolder` | Claude Code's CLI installed or removed, or the folder closed |
| `Click` | the button posting `start`; `starter.start()` creates a terminal, never shown, whose process is `claude -p "start pairing session" --allowedTools mcp__pair`, unless its last terminal is still open; the page shows the note before it posts `start` |
| `AgentExits` | the CLI exiting when the session ends; its terminal closes, and `onDidCloseTerminal` clears the starter's terminal and resolves the promise `start()` returned, and the panel posts `startEnded`, which hides the note |
| `Choose(l)` | the programmer, or Claude Code's own commands, setting `claudeCode.preferredLocation` |
| `StartSession` | the `session` event reaching the page: `handle`'s `session` case hides the note |
| `EndSession` | the session ending: the idle view and its button are back |

Checked one property at a time, each mutation failed on the properties named and
no others, and passed with them left out. Each invariant was proved to bite with
a mutation of a copy of the model, run in TLC and then reverted:

| Mutation | Breaks |
|---|---|
| `Choose` sets a location outside `Locations` | `TypeOK` |
| `DropStale = FALSE` | `OwnAnswer` and `LatestAnswerProp` |
| `AnswerCheck` posts any answer for the live page, the model before #192 | `LatestAnswerProp` |
| `ReaskOnSetUp = FALSE` | `ReaskedProp` |
| `AnswerCheck`'s value ignores `cliAndFolder` | `GroundedProp` |
| `AnswerCheck` reads `cliAndFolder` when it lands, not when asked | `GroundedProp` and `Offered` |
| `Click` without a run | `StartsAreClicks` |
| `Click` while hidden | `ClicksNeedButtonProp` |
| `AnswerCheck` never delivered | `Offered` |
| `InTerminal = FALSE` | `KeepsLocation` and `StaysOnPair` |
| `Click` writes `panel` to the setting | `KeepsLocation` |
| `Click` brings Claude Code to the front | `StaysOnPair` |
| `OneAgent = FALSE` | `OneAtATime` |
| `Click` starts no agent | `StartsProp` and `NoteGoes` |
| `AgentExits` never happens | `Closes` and `NoteGoes` |
| `NoteOnClick = FALSE` | `AcknowledgedProp` |
| `ClearOnExit = FALSE` | `NoteGoes` |
| `StartSession` leaves the note | `NoteUntilSession` |
| `Dispose` leaves the note | `NoteUntilSession` |
| `Click` during a session | `NoteUntilSession` |

Every invariant and property names the test that proves the code obeys it:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types, in `Starter`, `FromPanel`, and `ToPanel` |
| `OwnAnswer` | `panel.test.ts`: OwnAnswer: drops the answer of a page replaced before it landed, so it cannot set its successor's button |
| `LatestAnswerProp` | `panel.test.ts`: LatestAnswerProp: drops an earlier question's answer that lands after the reask's, on the same page |
| `GroundedProp` | `setup.test.ts`: GroundedProp: offers the button only once Claude Code is set up, its CLI is here, and a folder is open |
| `StartsAreClicks` | `panel.test.ts`: StartsAreClicks: runs the starter once per start from the page; `webview/panel.test.ts`: StartsAreClicks: posts start when the button is clicked; `setup.test.ts`: StartsAreClicks, StartsProp, StaysOnPair, KeepsLocation: runs the CLI with the prompt in a terminal it never shows, once per start |
| `ClicksNeedButtonProp` | `webview/panel.test.ts`: ClicksNeedButtonProp: hides Start a session until the extension says it can start one |
| `Offered` | `panel.test.ts`: Offered: tells a new page whether it can start a session |
| `ReaskedProp` | `panel.test.ts`: ReaskedProp: asks again after Set Up Agent, so the button appears without a reload; `extension.test.ts`: ReaskedProp: sets the agent up, and offers the panel the start again |
| `KeepsLocation`, `StaysOnPair`, `StartsProp` | `setup.test.ts`: StartsAreClicks, StartsProp, StaysOnPair, KeepsLocation: runs the CLI with the prompt in a terminal it never shows, once per start |
| `OneAtATime` | `setup.test.ts`: OneAtATime, Closes: starts no second agent while the first one's terminal is open, and starts again once it closes |
| `Closes` | the same test, for the terminal closing. Nothing yet proves the CLI exits when the session ends; that needs a run in the editor |
| `AcknowledgedProp` | `webview/panel.test.ts`: AcknowledgedProp: shows the starting note at once when the button is clicked |
| `NoteUntilSession` | `webview/panel.test.ts`: NoteUntilSession: hides the starting note when a session starts, new or resumed |
| `NoteGoes` | `webview/panel.test.ts`: NoteGoes: hides the starting note once the agent has exited, with no session; `panel.test.ts`: NoteGoes: tells the page once the agent a start ran has exited; `setup.test.ts`: NoteGoes: resolves a start once its agent's terminal closes, a refused start with it, and one that runs nothing at once |

### `Actions`: what an interrupted batch reports as unplayed

The unplayed actions of an interrupted batch come back in order, and
resubmitting them plays nothing twice: `actions` and `perform` in
`packages/core/src/player.ts`. Each action is its steps between awaits, read
from the code: awaits, checks of a sleep's or `confirm`'s result or of
`notStarted`, and effects the programmer sees. An interrupt comes at any await.
Two defenses keep that. A `type` cut after a chunk returns only what's left of
it (`RestOnly`), and a `run` interrupted while its command keeps running counts
as played (`ConsumeRun`).

| Spec | Code |
|---|---|
| `Steps(k)` | each action's awaits, checks, and effects; `type` with two chunks; `type0`, a `type` with nothing to type, which returns `nothing` |
| `Complete` | `actions` returning `completed` after its last action |
| `StopBeforeAction` | the loop in `actions` checking `isInterrupted` before each action |
| `TakeEffect`, `Proceed` | the action's steps in `perform`: an effect, an await, or a check that finds no interrupt |
| `StopAtCheck` | a check that finds the timeline interrupted: a sleep's result, `confirm`, or `notStarted`; a `type` cut after a chunk returns its `chunksLeft` |
| `RejectInterruptedEdit` | an in-flight typing edit is rejected after interruption; the rejected chunk remains unplayed |
| `StopWhileRunning` | `run` interrupted while its command runs on: `consumed` |
| `FinishAction` | the loop in `actions` going on to the next action |
| `Stop` | `stopped(id, unplayed, effect)`: `discarded` unless an earlier action changed the screen (the `effect` flag in `actions`), or this one typed part of its text or left its command running |
| `Interrupt` | the timeline interrupted, by an edit, a message, a turn change |

Each invariant and property was proved to bite with a mutation of a copy of
the model, run in TLC and then reverted:

| Mutation | Breaks |
|---|---|
| `Complete` reports a fifth status, "done" | `TypeOK` |
| `RestOnly = FALSE`: a cut `type` returns all of its text | `PlaysNothingTwice` |
| `ConsumeRun = FALSE`: an interrupted `run` whose command runs on is returned as unplayed | `PlaysNothingTwice` |
| `RejectInterruptedEdit` returns the entire type after an earlier chunk played | `PlaysNothingTwice` |
| `StopBeforeAction` ignores the earlier actions' effects | `DiscardedMeansNothing` |
| an await never returns: `Proceed` leaves `pc` as it was | `EventuallyReported` |

Every invariant and property names the test that proves the code obeys it:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `PlaysNothingTwice` | `session.e2e.test.ts`: PlaysNothingTwice: returns what's left of a type cut inside its second part; PlaysNothingTwice, DiscardedMeansNothing: stops waiting when the programmer interrupts, reporting the command as still running; `player.test.ts`: RejectInterruptedEdit: returns the untyped suffix and restores the cursor through a programmer edit; PlaysAfterCompleted, PlaysNothingTwice, StopAtCheck: hands back what's left of a type cut short, before the marker or after it, and nothing if none was typed; StopWhileRunning: reports a command running on, posts its exit when it ends, and counts it as played when interrupted |
| `DiscardedMeansNothing` | `session.e2e.test.ts`: DiscardedMeansNothing: discards a batch interrupted after a type with nothing to type, which changed nothing (specs/Actions.tla); PlaysNothingTwice, DiscardedMeansNothing: stops waiting when the programmer interrupts, reporting the command as still running; `player.test.ts`: Stop: discards a batch interrupted before its first action, and reports no code for it |
| `EventuallyReported` | `session.e2e.test.ts`: EventuallyReported: runs a command, reporting its output and exit code with the batch; `player.test.ts`: SaveAndRun: saves the batch first, runs in the root, waits as long as asked within the most, and reports the run |

### `Player`: a delete while the programmer edits

The `delete` action in `packages/core/src/player.ts`, between its awaits, while
the programmer types in front of the selection or behind it. `ReadAfterAwait`
and `CheckInterrupt` are the fix for #49.

| Spec | Code |
|---|---|
| `StartDelete`, `Finish` | the delete: before #49 it copied the selection, then awaited `show` and `getText` |
| `TypeBefore`, `TypeAfter` | a programmer's edit: `transform` moves the live selection, and the edit interrupts |
| `Finished` | the delete is done; the run ends |

Each invariant and property was proved to bite with a mutation of a copy of
the model, run in TLC and then reverted:

| Mutation | Breaks |
|---|---|
| `Finish` stops with a third outcome, "stopped" | `TypeOK` |
| `Finish` deletes one past the selection | `DeletesTheSelection` |
| `ReadAfterAwait = FALSE`, `CheckInterrupt = FALSE`, the code before #49 | `DeletesTheSelection` |
| `CheckInterrupt = FALSE` | `EditInterrupts` |
| no fairness on `Finish` | `DeleteEnds` |

Every invariant and property names the test that proves the code obeys it:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `DeletesTheSelection` | `session.e2e.test.ts`: DeletesTheSelection: replaces a selection by typing, and deletes a selection; `player.test.ts`: types over the selection, deletes it when there is nothing to type, and with neither changes nothing |
| `EditInterrupts` | `session.e2e.test.ts`: EditInterrupts: stops a delete when the programmer edits while it starts, and deletes nothing; `player.test.ts`: TakeEffect: stops before any effect when an edit interrupts it while the file is read (#49); `controller.test.ts`: NetReported, EditInterrupts: reports programmer edits as one diff a file, the agent cursor moving with them |
| `DeleteEnds` | `session.e2e.test.ts`: DeleteEnds: a delete held at its awaits ends once they return, removing the selected text; `player.test.ts`: Finish: deletes the selection, reading it only once the file is shown, and pauses after |

### `BatchFile`: the file each action of a batch acts in

`names`, `fileOf`, `type` and `delete` in `packages/core/src/player.ts`, over
every sequence of up to 4 actions, each with `file` of `sourceFile`,
`destinationFile`, `otherFile`, or none, from any cursor. A `point` names a
file without moving the cursor, so with the cursor
elsewhere an action without `file` looked in the cursor's file, and a `type` or
`delete` edited it. `FallBackToNamed` and `CursorInNamed` are the fix for #58.
Every editing batch must now name its file before the first edit (#6). The model
abstracts the controller's preflight as refusing the edit; the controller rejects
such a batch before rehearsal or playback. Its accepted queue cannot reach the
player's former late-naming guard: after an edit, the batch already has a named
file, which the player does not clear within that batch. Direct calls to the
internal player are not the public controller admission path.

| Spec | Code |
|---|---|
| `Act` | `perform`: `names`, then `fileOf` for `move`, `select` and `point`, or the cursor for `type` and `delete` |
| `Say` | a `say` or `run`, which act in no file |
| `ActInFile` | `move`, `select` and `point` in the file `fileOf` gives; only `move` and `select` move the cursor |
| `ActAtCursor` | `type`, `newline` and `delete` at the cursor, rejected without a named file or with the cursor outside it, and a `delete` with nothing selected (`no_selection`) |
| `Stop` | an action that fails: two files named, an edit without a prior file name, `no_cursor`, the cursor outside the named file, or a `delete` with nothing selected; the other ways an action fails (a text not found, the programmer's turn) are other specs' |
| `EndBatch` | a new `Playing` for the next batch; the cursor stays |

Each invariant and property was proved to bite with a mutation of a copy of the
model, run in TLC and then reverted:

| Mutation | Breaks |
|---|---|
| a rejected action's file is the string `"none"`, the sentinel before #148 | `TypeOK` |
| `FallBackToNamed = FALSE`, the code before #58 | `ActsInNamedFile` |
| `CursorInNamed = FALSE`, the code before #58 | `ActsInNamedFile` |
| `ActAtCursor` permits an edit in a batch that named no file | `EditRequiresNamed` |
| `EditAtCursorProp` without `k = "delete" => selected`: a `delete` with nothing selected must edit | `EditAtCursorProp` |
| `ActAtCursor` refuses a `delete` even with a selection | `EditAtCursorProp` |
| `move` makes a selection | Nothing: no property says a `delete` after a `move` fails; `player.test.ts` does |

Every invariant and property names the test that proves the code obeys it; the
test's title carries its name:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `ActsInNamedFile` | `session.e2e.test.ts`: ActsInNamedFile: looks in the file its batch named for an action without `file`, not the cursor's; ActsInNamedFile: looks in the file its batch named before the agent's cursor is in any file; ActsInNamedFile: rejects a type or delete with the cursor outside the file its batch named, editing nothing; `player.test.ts`: Act: refuses a second file in a batch; ActAtCursor: refuses a type or delete when the cursor is in another file than the batch's |
| `EditAtCursorProp` | `session.e2e.test.ts`: EditAtCursorProp, EditRequiresNamed: types and deletes only after naming the cursor's file; `player.test.ts`: EditAtCursorProp: refuses a move, select, point, or type before the cursor is anywhere, and a delete with nothing selected |
| `EditRequiresNamed` | `controller.test.ts`: EditRequiresNamed: refuses an unnamed editing batch before rehearsal, while allowing named edits and non-editing batches; `session.e2e.test.ts`: EditAtCursorProp, EditRequiresNamed: types and deletes only after naming the cursor's file |

After removing the unreachable late-name branch, TLC still checks 8,610
generated / 330 distinct states. Each mutation above was rerun with its stated
result; the public late-name rejection remains covered by `integration_paths.ts`.

### `Diagnostics`: advisory checks after edits

The controller checks only files actually edited by a batch, after playback.
Available observations are advisory and never change its result. The general
VS Code snapshot caveat is reported once per session; specific failures are not
suppressed. This model
abstracts provider availability and outcomes; changing sessions or source text
while a check runs is covered by tests, not modeled here.

| Spec | Code |
|---|---|
| `Edit` | successful editor edits recorded by `Player` |
| `Finish` | `Controller.run` collects a snapshot without changing the batch result |
| `NextBatch` | the next batch starts with its own edited-file set |

Each behavioral invariant was checked with a mutation and then restored:

| Mutation | Breaks |
|---|---|
| observe even when no edit happened | `OnlyEdited` |
| suppress observations from an available provider | `ObserveWhenAvailable` |
| force a failed result regardless of playback | `OutcomeUnchanged` |
| disable batch completion | `Advisory` |
| issue the caveat without an edit | `CaveatNeedsEdit` |
| fail to record a sent caveat | `CaveatRecorded` |
| issue the caveat after every edited batch | `CaveatOnce` |
| never record the first edited batch | `CaveatOnFirstEdit` (checked with `CaveatRecorded` disabled) |

| Invariant | Proved by |
|---|---|
| `TypeOK` | TypeScript checks these types |
| `OnlyEdited`, `ObserveWhenAvailable`, `OutcomeUnchanged`, `Advisory` | `controller.test.ts`: OnlyEdited, Advisory: reports diagnostics only for files actually edited and does not reject the batch; `integration_render_diagnostic.ts`: a real editor advisory reaches the agent through the relay |
| `CaveatNeedsEdit`, `CaveatRecorded`, `CaveatOnce`, `CaveatOnFirstEdit` | `controller.test.ts`: reports Pylance diagnostics on every batch but the snapshot caveat only once per session |

### `Draft`: the reply box's pause, across the view's page

`packages/vscode/src/webview/panel.ts` (`syncDraft`, `takeDraft`) and `panel.ts`
(`draft`, `reply`, `ready`, `onDidDispose`), with `Controller.pause` and
`resume`. A draft in the reply box pauses playback for the reason "reply".
`ClearOnReady` is the fix for #69: a new page (`ready`) and a disposed view have
no draft, so they remove that reason. `ClearOnTaken` is the fix for #191: a
reply the reading speed calibration takes empties the box without a `draft`
message, so the panel removes the reason itself.

| Spec | Code |
|---|---|
| `TypeDraft`, `Clear` | `syncDraft` posting `draft` when the box's emptiness changes; `takeDraft` on sending or handing the turn back |
| `SendToCalibration` | the `reply` message while a calibration runs: `calibration.reply` takes it, and `resume('reply')` |
| `ResumeAll` | the Resume button, sending a reply, or the turn button: `resume()` with no reason |
| `Dispose`, `LoadPage` | `onDidDispose`; a page loaded, in a new view or by "Reload Webviews", posting `ready` |

Each invariant and property was proved to bite with a mutation, run in TLC and
then reverted:

| Mutation | Breaks |
|---|---|
| `Dispose` sets the view to a third state, "closed" | `TypeOK` |
| `ClearOnReady = FALSE`, the code before #69 | `ReplyMeansDraft` |
| `ClearOnTaken = FALSE`, the code before #191 | `ReplyMeansDraft`: `TypeDraft`, `SendToCalibration` |
| `TypeDraft` leaves the pause as it was | `DraftPausesProp` |

Every invariant and property names the test that proves the code obeys it:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `ReplyMeansDraft` | `panel.test.ts`: ReplyMeansDraft: ends the draft's pause when the view is disposed with it; ReplyMeansDraft: ends the draft's pause when the view's page reloads, keeping a pause the programmer asked for; ReplyMeansDraft: a reply the calibration takes ends the draft's pause; any other resumes without revealing and is sent on |
| `DraftPausesProp` | `panel.test.ts`: DraftPausesProp: a draft in the reply box pauses playback |

### `RunBox`: the panel's run box

The model checks phase transitions, not the wording of an unknown exit status.

One `run`: the phases `runCommand` in `packages/core/src/player.ts` posts, and
the page's `case "run"` and `setActive` in `webview/panel.ts`. Every way a run
ends posts a phase other than `confirm` and `running`, which clears the box:
skipped or interrupted at the confirmation (`declined`), a command that never
started or threw (`declined`), and one that ran (`done`, `background`). A
session ending clears it too.

| Spec | Code |
|---|---|
| `SaveAndConfirm`, `SaveAndRun`, `FailSave` | after `save`: `confirm` with confirmation on, else `running`; a failed save posts nothing |
| `Go`, `Decline` | `confirm` resolving: `running`, or `declined` for a skip or an interrupt |
| `FinishCommand` | `editor.runCommand`: `done` or `background`, or `declined` for `notStarted` or a throw |
| `EndSession` | the session ending: `setActive(false)` |

Each invariant and property was proved to bite with a mutation, run in TLC and
then reverted. Under the fairness, BoxMatches implies Clears, so Clears'
mutation ran with BoxMatches left out of the config:

| Mutation | Breaks |
|---|---|
| the box shows every phase | `TypeOK` |
| `Go` posts nothing, so the box says confirm while the command runs | `BoxMatches` |
| `ClearOnEnd = FALSE` | `Clears` |

Every invariant and property names the test that proves the code obeys it:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `BoxMatches` | `webview/panel.test.ts`: BoxMatches: shows the box while a command waits for a decision, and while it runs |
| `Clears` | `webview/panel.test.ts`: Clears: a %s phase clears the box (done, background, declined); Clears: the session ending clears the box |

### `FileText`: the text the session takes for a file

`getText` and `show` in `packages/vscode/src/editor.ts`, for #88 and #89. One
file, on disk or absent, and a document VS Code may hold for it, with or without
a tab. VS Code keeps a document after its file is deleted, and reloads one
without unsaved changes some time after its file changes. `PreferDirty` is the
fix for both: a document with unsaved changes is the programmer's text;
otherwise a file not on disk is reported missing (`MissingIsReported`); and
`show` creates a missing file by emptying and saving a document VS Code kept
for it, never one with unsaved changes (`KeepsUnsavedProp`).

| Spec | Code |
|---|---|
| `GetText` | `getText` -> `document()`: `openDocument()`, `exists()`, `openTextDocument` |
| `OpenDocument`, `CloseDocument`, `Edit`, `Save`, `Reload` | VS Code's documents: opened by anything, dropped, edited, saved (recreating a deleted file), reloaded |
| `Write`, `Delete` | the file changed or deleted on disk |
| `Show` | `show` -> `create`, for a `move` to the file |

Each invariant and property was proved to bite with a mutation, run in TLC and
then reverted:

| Mutation | Breaks |
|---|---|
| `show` writes a text outside `Contents` | `TypeOK` |
| `PreferDirty = FALSE`, the code before #88 and #89 | `NotStale` |
| the fixed `getText` throws for an empty file with no document | `MissingIsReported` |
| `show` writes a file that is not empty | `CreatedIsEmpty` |
| the fixed `show` keeps the old guard, so it empties unsaved text | `KeepsUnsavedProp` |

Every invariant and property names the test that proves the code obeys it:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `NotStale`, `MissingIsReported`, `CreatedIsEmpty`, `KeepsUnsavedProp` | `integration.ts`, in VS Code: NotStale, MissingIsReported, CreatedIsEmpty, KeepsUnsavedProp: missing and deleted files read as missing, and are created empty; `editor.test.ts`: NotStale: takes the text of a document with unsaved changes, whether its file exists or not; MissingIsReported: reports a file that isn't on disk as missing, whatever document VS Code kept; CreatedIsEmpty: creates a missing file empty, with its folder, and says it wrote it; CreatedIsEmpty: empties and saves the document VS Code kept for a deleted file; KeepsUnsavedProp: leaves a deleted file's document with unsaved changes as it is, and shows it |

### `Outside`: marking files changed outside the protocol

The feature of #15, specified before its code: `outside.ts` and
`outside_watch.ts` in `packages/vscode/src`. One file, written by VS Code's
saves, by the extension's own `show`, and by anything else; a watcher that
reports writes late and merges them. The code marks a file when a group of
writes settles, if the file differs from the text it knows: the last VS Code
wrote, or the programmer saw. A timing assumption: VS Code tells of a save
(`onDidSaveTextDocument`) within milliseconds, before the group settles, and
nothing the programmer does falls in between.

| Spec | Code |
|---|---|
| `Save`, `NotifySave` | a document saved; `onDidSaveTextDocument` -> `saved` |
| `Show` | `show` creating a missing file -> `wrote` -> `saved` |
| `WriteOutside` | anything else writing the file; an open document without unsaved changes reloads |
| `WatcherReports` | the watcher's events -> `reported`; the group settles -> `settle` reads and compares |
| `OpenDocument` | opening the file or its diff -> `seen` |
| `FocusDocument` | the file's open document becoming the active editor again -> `seen`, which reads the disk |

Each invariant and property was proved to bite with a mutation, run in TLC and
then reverted. The other rules and an unsettled decision all break
NoFalseMark, so Marks has a mutation of its own:

| Mutation | Breaks |
|---|---|
| an outside write leaves content 0 | `TypeOK` |
| `Rule = "every"`, `Rule = "afterSave"`, or `Settle = FALSE` | `NoFalseMark` |
| `FocusDocument` leaves the known text as it was | `NoFalseMark` |
| `FocusDocument` takes the document's text, not the disk's | `NoFalseMark` |
| `FocusDocument` leaves the mark | `NoFalseMark` |
| the content rule never marks | `Marks` |

Every invariant and property names the test that proves the code obeys it:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `NoFalseMark` | `outside.test.ts`: NoFalseMark: doesn't mark a save, or a file the extension created; NoFalseMark: clears the mark when the programmer sees the file, and a late event for what they saw doesn't bring it back; NoFalseMark: doesn't mark a file the programmer saw before its writes settled |
| `Marks` | `outside.test.ts`: Marks: marks a file written outside once its writes settle, and reports it; Marks: marks a write the watcher reports in one event with a save (the afterSave rule misses it) |

### `ProjectGuide`: which project guides `start` reads

The feature of #23, specified before its code: `projectGuides` in
`packages/relay/src/guide.ts`. Checked over every small tree, as `ASSUME`s:
walking up from the working directory to the workspace folder gives exactly the
guides on that path that git doesn't ignore, outer first, and none above the
folder. Walking past the folder, or reading an ignored guide, is caught. Like
the pure functions below, it is `ASSUME`s alone, with a config of constants.

Each `ASSUME` was proved to bite with a mutation, run in TLC and then reverted.
Exactly implies Contained, so Contained's mutation ran without Exactly's
`ASSUME`:

| Mutation | Breaks |
|---|---|
| the walk skips the workspace folder's own guide | `Exactly` |
| `Found` without `Reverse`: innermost first | `OuterFirst` |
| the walk reads guides git ignores | `Contained` |

Each names the test that proves the code obeys it:

| Assumption | Proved by |
|---|---|
| `Exactly` | `guide.test.ts`: Exactly, OuterFirst, Contained: reads the guides from the workspace folder down to the working directory, outer first; Exactly, Contained: leaves out a guide git ignores |
| `OuterFirst` | `guide.test.ts`: Exactly, OuterFirst, Contained: reads the guides from the workspace folder down to the working directory, outer first |
| `Contained` | both tests above |

### `Resume`: a session that waits for its agent

The feature of #25, specified before its code: `disconnect`, `start`,
`resumeSession`, `saved`, `revive` and `endSession` in
`packages/core/src/controller.ts`, with the extension saving the session in the
workspace's storage (`extension.ts`). A session whose agent disconnects, or that
the window reloads with, is suspended, not ended, and waits until the programmer
ends it or a `start` resumes it. Checked: a `start` from its directory resumes
the same session (`ResumesSameProp`); it leaves the suspended state only to
resume, end, or give way to a session from another directory (`WaitsProp`); a
session the programmer ended has its agent to tell, or is closed
(`EndedHasAgent`); the storage holds the session as it is (`SavedIsCurrent`); a
message isn't lost while it waits, or across a reload (`NotLostProp`); a message
the agent can be sent reaches it (`Arrives`); and the panel shows the session as
it is (`ShownIsState`; #138: after a reload, the replayed history showed a
suspended session as live). The spec saves with every change; the code saves 200
ms after the last one and again as the window goes, so a reload within 200 ms of
a change relies on that last save.

| Spec | Code |
|---|---|
| `Connect`, `Disconnect` | a relay's socket opening and closing; `disconnect()` suspends an active session, and closes one the programmer ended (no session) |
| `ReloadWindow` | the window reloading: `activate` revives the saved session, suspended (`revive`), with the panel's history; `revive` posts the suspended event (`PostOnRevive`), and the page adds its divider only when the session goes between live and suspended |
| `Start(d)` | `start`: a suspended session from `d` resumes (`resumeSession`); another directory ends it and starts a new one |
| `EndByProgrammer`, `EndByAgent` | `endSession`: an active session is ended, a suspended one closed at once (no session); the agent's `end` |
| `CloseEnded` | `finishCall` closing an ended session with its last report |
| `SendMessage`, `Report` | `userMessage`, to an active or a suspended session; the next report, once the agent is back |
| `Store` | `onChange` and `onPost`: the extension writes `stored` and the panel's history 200 ms after a change, and as the window goes |

Each invariant and property was proved to bite with a mutation of a copy of the
model, run in TLC and then reverted:

| Mutation | Breaks |
|---|---|
| `EndByAgent` leaves a fifth state, `"closed"` | `TypeOK` |
| `PostOnRevive = FALSE`, the code before #138 | `ShownIsState` |
| `ClearOnReplace = FALSE`, preserving the previous suspended display | `ShownIsState` |
| `SendMessage` leaves `stored` unchanged | `SavedIsCurrent` |
| `Start(d)` never resumes: a new session from any directory | `ResumesSameProp` |
| `ReloadWindow` brings back no session, checked without `ShownIsState`, which fails first | `WaitsProp` |
| `ReloadWindow` drops the pending message | `NotLostProp` |
| `Spec` without `Fairness`, `WF_vars(Report)` | `Arrives` |
| `EndByProgrammer` ends a suspended session as `"ended"`, the model before #200 | `EndedHasAgent` |
| `Disconnect` leaves an ended session ended | `EndedHasAgent` |
| a suspended session closed while connected by other than `EndByProgrammer` | `WaitsProp` |

Every invariant and property names the test that proves the code obeys it:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `SavedIsCurrent`, `NotLostProp` | `controller.test.ts`: Store: saves queued replies without delivering or duplicating them in the live session; SavedIsCurrent, NotLostProp: saves a session for the window, and none once it ended; SavedIsCurrent, NotLostProp, ShownIsState: brings back a session the window saved, suspended, after a reload |
| `ResumesSameProp`, `Arrives` | `controller.test.ts`: ResumesSameProp, Arrives: suspends a session the agent disconnects from, and resumes it on a start from its directory |
| `WaitsProp` | `controller.test.ts`: WaitsProp: starts a new session from another directory, ending the suspended one; WaitsProp: closes a suspended session at once when the programmer ends it |
| `EndedHasAgent` | `controller.test.ts`: WaitsProp: closes a suspended session at once when the programmer ends it; EndedHasAgent: rejects the open call when the agent disconnects, and closes at once a session the programmer ended |
| `ShownIsState` | `controller.test.ts`: SavedIsCurrent, NotLostProp, ShownIsState: brings back a session the window saved, suspended, after a reload; `webview/panel.test.ts`: ShownIsState: a session revived after a reload shows as suspended; ShownIsState: a revive after a disconnect shows the suspension once; ShownIsState: a replacement session clears an old suspension (live and replay) |

### `NavigatorCommentary`: live preference notices

The controller owns the preference and a session-scoped pending notice. A real
change wakes an open listen, or the next one, with a settings-only report;
other report evidence stays pending. The latest mode is projected at delivery.
A canceled notice is restored only if its generation is current. The model's
`reportGen` retains a canceled notice candidate while a newer notice is taken;
it abstracts the notice's identity, rather than every concurrent report. It
bounds changes at three and models session end, but not restart or resume.
The named controller tests cover those lifecycle boundaries. Transport, actual
speech and prompt timing are outside the model. Weak fairness of `Notice`,
`Commit` and `Deliver` ensures a pending or committed call settles.

| Spec | Code |
|---|---|
| `SetMode` | `setNavigatorCommentary` |
| `Start`, `Notice`, `Commit`, `Deliver` | `listen`, settings-only return, ordinary report, final projection |
| `Cancel`, `Restore`, `End` | canceled report restoration and session close |

| Mutation | Breaks |
|---|---|
| `FreshProjection = FALSE` | `CurrentAtDelivery` |
| `RestoreOldMode = TRUE` | `RestoreKeepsMode` |
| `WakeOnChange = FALSE` | `ChangedWake` |
| `PreserveEvidence = FALSE` | `EvidencePreserved` |
| `GuardRestore = FALSE` | `NoOldRestore` |
| `Start` sets an invalid call state | `TypeOK` |
| Remove notice, commit and delivery fairness | `EventuallySettled` |

| Invariant or property | Test |
|---|---|
| `TypeOK` | `index.test.ts`: validates the live commentary notice identity |
| `CurrentAtDelivery`, `RestoreKeepsMode` | `controller.test.ts`: CurrentAtDelivery, RestoreKeepsMode: projects the current mode on start, pending listen and replay |
| `EvidencePreserved`, `ChangedWake` | `controller.test.ts`: wakes a pending listen without interrupting a playing batch; does not wake on the same mode and preserves a due typing pause |
| `NoOldRestore` | `controller.test.ts`: delivers changes made while computing and restores only the current notice; does not revive a notice in a replacement or resumed session |
| `EventuallySettled` | `controller.test.ts`: BlockedReturns: returns with `waiting` after MAX_BLOCK |

### `NavigatorFollowup`: burst, handback and visible lines

This bounded model abstracts two files and two texts. A timeout records whether
it delivered a meaningful change; a subsequent timer evaluation wakes only for
that activity or a pending net change. `ready` means the timer was evaluated,
including the no-wake case. `ConsumePause` resets burst evidence. The handback
transition models only plain handback; taking the turn interrupts in `Turns`
and `Rehearsal`. Message handback interruption is outside this model. `Show`
abstracts visible versus omitted lines; line identity through subsequent edits
is modeled separately by `LineIdentity` and
`Rehearsal`. It does not model diff parsing or speech. Historical diffs whose
text no longer matches the tracked current text grant no line sightings, so a
current read may be needed.

| Spec | Code |
|---|---|
| `Edit`, `Timeout`, `Fire`, `ConsumePause` | `userEdit`, `snapshot`, navigator timer and `finishCall` |
| `HandBack` | `handBack` without message or selection |
| `Show`, `Accept` | numbered diff sightings, `saw`, and rehearsal line checks |

| Mutation | Property violated |
|---|---|
| `PreserveQueue = FALSE` | `QueuePreserved` |
| `PreserveBaseline = FALSE` | `WakeMatches` |
| `VisibleOnly = FALSE` or `CheckCurrent = FALSE` | `VisibleLinesOnly` |
| Initialize `pending` with an outside-domain file | `TypeOK` |
| Remove fairness for `Fire` | `EventuallyReady` |
| Always wake in `Fire`, or retain observed activity in `ConsumePause` | `WakeMatches` |

| Property | Test |
|---|---|
| `TypeOK` | TypeScript and protocol schemas |
| `QueuePreserved` | `controller.test.ts`: PlainHandback: keeps queued navigator speech |
| `WakeMatches` | `controller.test.ts`: NoEmptyWake: undo before a report does not wake navigator listen; ObservedBurst: a timeout followed by undo still reports the reversal at a pause |
| `VisibleLinesOnly` | `diff.test.ts`: numbers only visible new-side lines in a bounded diff; `controller.test.ts`: VisibleLinesOnly: restored diff cannot authorize current shifted line IDs; VisibleLinesOnly: stale event text does not replace the live line tracker |
| `EventuallyReady` | `controller.test.ts`: ObservedBurst: a timeout followed by undo still reports the reversal at a pause |

### `Navigator`: the programmer's edits, reported when they pause

`userEdit`, the navigator timer, `navigatorReady` for `listen`, and `snapshot` in
`packages/core/src/controller.ts`. During the programmer's turn, a `listen`
returns for their edits only once they pause typing (`navigatorIdleMs` after
their last edit), so the agent comments on a whole thought. `ResetReady` is the
fix: an edit takes back `navigatorReady`, which a pause before it set, so a
`listen` made after the programmer resumes typing waits for their next pause.
A timeout may report an edit before the pause; the pause remains reportable on
the next listen. The model abstracts elapsed wall-clock time and the editor.
The timer model over-approximates ready after any edit; `NavigatorFollowup`
refines that choice for net-zero bursts and timeout-observed activity. Strong
fairness of `Return` rules out repeated timeouts starving a ready call;
in code a ready call is pumped synchronously before its timeout. Restored
notices carry an edit generation, so later edits invalidate a bounced pause.

| Spec | Code |
|---|---|
| `EditAsProgrammer` | `userEdit` in the programmer's turn: `recordEdit`, `navigatorReady = false`, the timer started again |
| `Lull`, `Fire` | `navigatorIdleMs` without an edit; the timer setting `navigatorReady` and calling `pump()` |
| `Listen`, `Return`, `Timeout` | `listen`; `finishCall` consumes `navigatorReady` only for a typing-pause report; the navigator timeout preserves it |
| `Restore` | `restore` re-arms a bounced typing pause only for the current edit generation |

Each invariant and property was proved to bite with a mutation, run in TLC and
then reverted:

| Mutation | Breaks |
|---|---|
| `Listen` sets the call to a third state | `TypeOK` |
| `ResetReady = FALSE`, the code before | `NotWhileTyping` |
| `Fire` leaves `navigatorReady` unset, so no call returns for the edits | `EditsReported` |
| Require an unreported edit for `Return`, the former design | `PauseDelivered` |
| Mark every pause report as wrongly timed | `WakeMatches` |

Every invariant and property names the test that proves the code obeys it:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `NotWhileTyping`, `EditsReported` | `controller.test.ts`: NotWhileTyping, EditsReported, QuietDelivered: waits in the programmer's turn until they pause typing, or hand the turn back |
| `WakeMatches` | `scripted_agent.e2e.test.ts`: reports a typing pause and unsaved programmer edits before the listen timeout |
| `PauseDelivered` | `controller.test.ts`: reports a typing pause after a timeout already delivered the edit; preserves a due typing pause when a queued batch outlasts the timeout |

### `ListenGrace`: "Your move" between two idle listens

`state`, `finishCall`, `serialize`, `read`, and `close` in
`packages/core/src/controller.ts`. Issue #126: a `listen` that times out at
`maxBlockMs` with nothing to report leaves no call open until the agent's next
`listen`, a few seconds later, and the status showed "Agent is thinking" in that
gap. `Grace` is the fix: such a timeout keeps the status "listening" for
`listenGraceMs`, until the agent's next call, or until the programmer does
something that wakes a `listen`. The grace changes only the status, not when a
call returns or what a report holds, so no other spec changes. Issue #149: an
agent that stopped calling left the status at "Agent is thinking", so the
programmer could not tell it was gone. `ShowAbsent` is the fix: once no call
has been open for `absentMs`, the status is "absent" ("Agent isn't listening")
until the agent calls again. Issue #194: only a call that blocked ended the
grace, so "Your move" stayed through a `read`, and after a step refused at
once, with its rejection to act on. `EndOnAnyCall` is the fix: every call ends
it. `Scroll` reads the status only through `FOLLOWING` in `editor.ts`, which
holds "thinking", "absent", and "listening".

| Spec | Code |
|---|---|
| `Status` | `state()` with the queue empty; the panel labels thinking as "Waiting for agent" |
| `Call` | a call that blocks arriving: `serialize` counting it in `openCalls`, ending the quiet with `endQuiet` and the grace with `endGrace`, then `block()`; `close` ends both |
| `Read` | `read`: `endGrace`, and the quiet restarted at once |
| `FailRehearsal` | a `step` answered by `rejectBatch` or `rejectUnanchored`: `serialize` ended the grace, the agent owes a response to the rejection, and the report takes the events |
| `Timeout` | `finishCall` for a `listen` with `waiting` and no batches, events, or rejection: `startGrace` |
| `QuietNews`, `TimeoutWithNews` | a batch completing without a command, or an edit `interrupting` does not hold for, which wakes no `listen`; `finishCall` for a `listen` with `waiting` and such news: no grace |
| `RunNews`, `RunDelivered` | `callReady` and `finishCall` for completed command results; `controller.test.ts`: wakes a pending listen with the command result once |
| `Return` | `finishCall` with anything else |
| `Interrupt` | an event `interrupting` holds for: a message, an interrupt, an edit of the programmer's, a turn change |
| `Expire` | the grace timer firing after `listenGraceMs` |
| `GoAbsent` | the quiet timer firing `absentMs` after the last open call settled: `startQuiet`, from `serialize` once `openCalls` is 0, and from `read` |

Each invariant and property was proved to bite with a mutation of a copy of the
model, run in TLC and then reverted:

| Mutation | Breaks |
|---|---|
| a call outside `Calls` | `TypeOK` |
| `Grace = FALSE`, the code before | `NoFlicker` |
| `Status` ignores `unreported` | `NoYourMoveAfterInterrupt` |
| `Return` starts the grace too | `NoFalseYourMove` |
| `Expire` leaves the grace set | `GraceEnds` |
| `Call` leaves the grace set | `NoYourMoveInOtherCall` |
| `ShowAbsent = FALSE`, the code before #149 | `AbsentShows` |
| `EndOnAnyCall = FALSE`, the code before #194 | `NoFalseYourMove`: `Call("listen")`, `Timeout`, `FailRehearsal` |
| `Call` leaves `absent` set, checked without `NoYourMoveInOtherCall`, which it breaks first | `AbsentWithoutCall` |
| `TimeoutWithNews` starts the grace | `NoFalseYourMove` |
| `Timeout` ignores `quietNews` | `NewsSkipsGraceProp` |

Every invariant and property names the test that proves the code obeys it:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `NoFlicker` | `controller.test.ts`: NoFlicker, GraceEnds: keeps listening after a listen times out with nothing to report, until the grace runs out |
| `GraceEnds` | `controller.test.ts`: NoFlicker, GraceEnds: keeps listening after a listen times out with nothing to report, until the grace runs out |
| `NoFalseYourMove` | `controller.test.ts`: NoFalseYourMove, NewsSkipsGraceProp: shows thinking when a listen times out with a batch to report; NoFalseYourMove: ends the grace when the agent reads, and when its step is refused at once (#194) |
| `NoYourMoveAfterInterrupt` | `controller.test.ts`: NoYourMoveAfterInterrupt, NoYourMoveInOtherCall: shows thinking when the programmer acts, or the agent calls, during the grace |
| `NoYourMoveInOtherCall` | `controller.test.ts`: NoYourMoveAfterInterrupt, NoYourMoveInOtherCall: shows thinking when the programmer acts, or the agent calls, during the grace |
| `AbsentWithoutCall` | `controller.test.ts`: AbsentShows, AbsentWithoutCall: says the agent is not listening once no call has been open for absentMs, until it calls |
| `AbsentShows` | `controller.test.ts`: AbsentShows, AbsentWithoutCall: says the agent is not listening once no call has been open for absentMs, until it calls |
| `NewsSkipsGraceProp` | `controller.test.ts`: NoFalseYourMove, NewsSkipsGraceProp: shows thinking when a listen times out with a batch to report. No test times a listen out with only an edit that interrupts nothing yet |

### `IntegrationFixture`: test bundle ownership

The native test harness puts each temporary bundle inside the selected
extension root, so VS Code supplies the same extension API facade to both the
test and the extension. A packaged extension and the companion can have roots
different from the source workspace. The model abstracts the file system and
assumes cleanup can run; it does not model abrupt process termination or a
read-only extension directory. Weak fairness of `Build` and `Cleanup` requires
an invocation to finish. The cleanup tests also cover an extension-host error.

| Spec | Code |
|---|---|
| `Build`, `Launch`, `Cleanup` | `integration.sh` and `integration_speech_faults.sh` |

| Mutation | Breaks |
|---|---|
| `PlaceInside = FALSE` | `SameExtension` |
| `CleanupOwned = FALSE` | `NoLeftovers` |
| Start with an invalid phase | `TypeOK` |
| Remove build and cleanup fairness | `EventuallyCleaned` |

| Invariant or property | Test |
|---|---|
| `TypeOK` | Bash shell tests |
| `SameExtension`, `NoLeftovers` | `integration_sh.bats`: SameExtension, NoLeftovers: loads the packaged fixture under its extension and removes it; `integration_speech_faults_sh.bats`: SameExtension, NoLeftovers: loads each speech fixture from its development extension |
| `EventuallyCleaned` | `integration_sh.bats`: EventuallyCleaned: removes a packaged test bundle when the extension host fails; `integration_speech_faults_sh.bats`: EventuallyCleaned: removes a packaged speech fixture when the extension host fails |

### `CommandTracking`: observed completion and report origin

This bounded model tracks one command, a possible replacement session, the
terminal lease and one completion report. It distinguishes confirmation,
foreground execution, background waiting and observed completion; a missing
completion never becomes success. Restoring command news does not stale queued
work, and an old session cannot publish or restore into its successor. The
model abstracts terminal closure, bounded output, multiple simultaneous runs,
actual shell events and UUID generation. The named tests cover those boundaries.
Weak fairness of `Report` establishes progress once news exists.

| Spec | Code |
|---|---|
| `Approve`, `Timeout` | `Player.runCommand` and terminal wait |
| `End`, `Replace` | exact execution end/close and session identity guard |
| `Report`, `Restore` | controller snapshot, report origin and `restore` |
| `View` | controller's pending approval and player command projections |

| Mutation | Breaks |
|---|---|
| `ExactEnd = FALSE` | `MatchingExecution` |
| `SessionGuard = FALSE` | `SessionIsolated` |
| `RestoreGuard = FALSE` | `RestoreIsolated` |
| `KeepNews = FALSE` | `Conservation` |
| `NoFalseSuccess = FALSE` | `NoInventedSuccess` |
| `ViewUsesPhase = FALSE` | `AccurateView` |
| `PreserveStale = FALSE` | `InformationalRestore` |
| Give the initial session an invalid identity | `TypeOK` |
| Remove report fairness | `EventuallyReported` |

| Invariant or property | Test |
|---|---|
| `TypeOK` | protocol schemas and TypeScript |
| `NoInventedSuccess`, `MatchingExecution` | `terminal.test.ts`: waits for a timed-out execution output stream to drain after its matching end |
| `SessionIsolated`, `RestoreIsolated` | `controller.test.ts`: retains an observed background exit while suspended and rejects predecessor callbacks; does not restore a previous session command completion into a replacement session; `integration_command_delivery.ts`: rejects a wire-roundtripped predecessor report in a new session |
| `Conservation`, `InformationalRestore` | `controller.test.ts`: restoring completion news does not stale later queued work |
| `AccurateView`, `EventuallyReported` | `scripted_agent.e2e.test.ts`: distinguishes approval, pending execution and a later background completion; `integration_command_delivery.ts`: reports real approval and execution before a bounded late output tail |

### `ShellIdentity`: bounded shell identification

`ShellIdentity.tla` models one multiline submission with a known, delayed or
unavailable shell identity. An unknown identity waits for a change or a bounded
timeout; cancellation and terminal closure stop submission. The model abstracts
the timer as a fair expiration and does not promise that identity will arrive.
TLC checked 26 generated states, 18 distinct states and depth 4. Mutations that
skip waiting, wrap every shell, submit after cancellation, add an invalid shell,
or remove expiration fairness violate `WaitBeforeUnknown`, `WrapOnlyBash`,
`NoSubmitAfterStop`, `TypeOK`, and `EventuallySettled`, respectively.

| Property | Test |
|---|---|
| `WaitBeforeUnknown`, `WrapOnlyBash` | `terminal.test.ts`: delayed Bash identity and unavailable shell timeout; `integration_gap_paths.ts`: delayed identity and timeout with a real terminal |
| `NoSubmitAfterStop` | `terminal.test.ts` and `integration_gap_paths.ts`: interruption and terminal closure during identification |
| `EventuallySettled` | `terminal.test.ts`: unavailable shell timeout and known non-Bash immediate submission |

### `CommandEncoding`: scoped Bash submission

This is an abstract contract for one character class and shell choice, not a
model of Bash parsing or the encoding algorithm. It checks the intended scope,
payload and approval invariants; the real Bash comparison tests exercise quote,
backslash, newline, Unicode, heredoc and exit behavior. The native VS Code
integration test checks capture and an observed exit for Bash. Bash `eval` may
change trap, stack and line-number observability. Unknown shells and input with
a NUL are left unchanged. Weak fairness of `Submit` gives progress.

| Spec | Code |
|---|---|
| `Submit` | `commandForShell`, called only for terminal submission |

| Mutation | Breaks |
|---|---|
| `ExactEncode = FALSE` | `PayloadPreserved` (with `TypeOK` omitted), and `TypeOK` |
| `ScopeBash = FALSE` | `ScopeBashOnly` |
| Mark the approved command as changed | `ApprovalPreserved` |
| Remove submit fairness | `EventuallySubmitted` |

| Invariant or property | Test |
|---|---|
| `TypeOK`, `PayloadPreserved`, `ScopeBashOnly` | `terminal.test.ts`: encodes Bash multiline input on one physical line and leaves unsupported shells unchanged; `terminal_encoding.e2e.test.ts`: preserves command output and exit |
| `ApprovalPreserved` | `integration_command_delivery.ts`: Bash heredoc and control-character commands retain their original text in the report |
| `EventuallySubmitted` | `terminal_smoke_integration.ts`: native Bash heredoc captures output and observed exit |

### `CommandDelivery`: prompt command results

`callReady` and `ready` in `packages/core/src/controller.ts` (#27). A
completed command wakes a listen or empty step, including while later work is
queued. The model bounds the queue to two completions and abstracts a playing
head and its interruption with a count and flag. Nonempty step readiness is
a simplified head approximation; this is not a complete serialization model.
Weak fairness of quiet completion abstracts eventual settlement of an
interrupted head, and fairness of Return makes enabled reports eventual.

| Property | Code test or check |
|---|---|
| `TypeOK` | TypeScript checks types |
| `Conservation`, `PromptRunReady` | `controller.test.ts`: command result delivery tests; `integration_command_delivery.ts`: real listen and empty step return a command result once while later work plays |
| `NoQuietWake` | `controller.test.ts`: a completed batch without a command leaves listen pending; `integration_command_delivery.ts`: an empty step waits for later work after quiet completion |
| `NoEarlyEnd` | `controller.test.ts`: command news does not let end return before later work finishes |
| `NoEarlyDiscarded` | `controller.test.ts`: command news does not let a discarded step return before the interrupted head |
| `NoInterruptedReturn` | `controller.test.ts`: command news waits until the interrupted head settles |
| `RunDelivered` | `controller.test.ts`: wakes a pending listen with the command result once |

Mutation checks detected omitted wake (`PromptRunReady`; separately
`RunDelivered` with the invariant disabled), lost or duplicated news
(`Conservation`), a quiet wake (`NoQuietWake`), early end (`NoEarlyEnd`),
early discarded step (`NoEarlyDiscarded`), and return before interrupt
settlement (`NoInterruptedReturn`). `TypeOK` is enforced by TLC's domains.

### `EditEvents`: an edit undone, in the report

`recordEdit`, `otherEdit`, and `snapshot` in `packages/core/src/controller.ts`,
for one file. A report has one edit event per file, its diff from the file's
text at the first edit since the last report. An edit that interrupts (the
programmer's, or a tool's to a file the queued batches edit) discards the
agent's batches. `KeepInterrupts` is the fix: such an edit is reported even when
the file ends up as it was, with an empty diff, so the agent knows why its
batches were discarded. A tool's net-zero edit that interrupted nothing is still
left out.

| Spec | Code |
|---|---|
| `EditAsProgrammer`, `EditAsOther` | `userEdit` and `otherEdit` -> `recordEdit`: a new event only with none pending for the file (`pendingEdit`); the event's `before` (the baseline) and `after`, `by`, `interrupted`; the event holds both texts, so a pending edit always has them (#176) |
| `Report` | `snapshot`: the event, unless the file is unchanged and the edit didn't interrupt |

Each invariant was proved to bite with a mutation, run in TLC and then
reverted:

| Mutation | Breaks |
|---|---|
| an edit to a text outside `Contents` | `TypeOK` |
| an event only for an edit that interrupted | `NetReported` |
| `KeepInterrupts = FALSE`, the code before | `Explained` |
| `Record` adds an event for every edit | `OnePendingEdit` |
| `Report` leaves the events pending | `OnePendingEdit` |

Every invariant names the test that proves the code obeys it:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `NetReported` | `controller.test.ts`: NetReported, EditInterrupts, OnePendingEdit: reports programmer edits as one diff a file, the agent cursor moving with them |
| `OnePendingEdit` | `controller.test.ts`: NetReported, EditInterrupts, OnePendingEdit: reports programmer edits as one diff a file, the agent cursor moving with them |
| `Explained` | `controller.test.ts`: Explained: reports an interrupting edit the programmer undid, and drops a quiet edit by others that was undone |

### `Scroll`: follow mode's scrolling

`renderCursor`, `follow`, `keepInView`, `scroll`, and `glide` in
`packages/vscode/src/editor.ts`, with `comfortable` and `landing` from
`view.ts`, and `resume`'s `reveal` in `controller.ts`. A glide stops early when
the state stops following: a pause, or a command running. A pause ends in
`resume`, which reveals the target. `CatchUp` is the fix: a glide a command cut
short goes on once the command is done, from `renderCursor`; before it, the view
stayed where the glide stopped, with the target possibly out of view. The
programmer's turn drops it. `scrollBeyondLastLine` is
`editor.scrollBeyondLastLine`, either way: with it on (the default), the last
line can scroll to the top. How long a glide takes (#123: `glideMs` in
`controller.ts`, from the timing and the
playback speed) is not modeled: a `Glide` step carries no time, and `Move` and
`Leave` can come between any two frames, so a longer or shorter glide is a run
the model already has.

| Spec | Code |
|---|---|
| `Move` | an action moving the target, and the player's `follow()`; no action plays while a command runs |
| `Leave`, `Follow` | the state leaving the following states (`paused`, `running`, `navigator`) and coming back: `renderCursor`; a pause's end: `resume`'s `reveal`, which a reply turns off (#125), so only the Resume button reveals |
| `Glide` | `glide`'s frames; `scroll`'s `finally` and its follow if the target moved |

Each invariant and property was proved to bite with a mutation of a copy of the
model, run in TLC and then reverted:

| Mutation | Breaks |
|---|---|
| `Move` moves the target past the file's last line | `TypeOK` |
| `Landing` ignores how far the editor scrolls | `InRange` |
| `CatchUp = FALSE`, the code before the fix | `ComesInView` |
| a finished `Glide` does not follow a target that moved | `ComesInView` |
| `Follow` from a pause does not reveal the target | `ComesInView` |
| `ComesInView` without `~turnSinceFollow`: the view follows a target moved before the programmer's turn | `ComesInView` |
| the turn keeps a glide cut before it | Nothing: a glide picked up after the turn only brings the target in view |
| a glide cut on the programmer's turn is kept | Nothing: as above |

Every invariant and property names the test that proves the code obeys it:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `InRange` | `view.test.ts`: InRange: stops at the top of the document; InRange: stops with the last line at the top when the editor scrolls beyond the end, else at the bottom |
| `ComesInView` | `integration.ts`, in VS Code: ComesInView: a scroll a command cut short went on to line 250; `editor.test.ts`: ComesInView: glides the target to a third of the way down, a frame at a time, leaving room for sticky scroll; ComesInView: a measure that a command cuts short goes on once the command is done; ComesInView: a glide a command cuts short goes on once it is done, not while paused, and not on the programmer's turn; ComesInView: catches up after a glide with a target that moved on in its file, and lets go of one that left it; ComesInView: reveal shows the target and follows it there, and does nothing with no target |

### `Turns`: only talk during the programmer's turn

During the programmer's turn, only `say` and `point` take effect, in
`packages/core/src/player.ts`: `perform` checks the turn as each action starts,
a turn change interrupts (`takeTurn`, `handBack` in `controller.ts`), and each
action that edits checks for an interrupt after its awaits, before its effect. A
batch may start at any time, from either turn, which is more than the controller
allows. `DeleteChecks` is the fix for #49, which also let a `delete` take effect
after the programmer took the turn.

| Spec | Code |
|---|---|
| `StartHead` | `startHead`: the next batch, with `timeline.reset()` |
| `Perform` | the loop in `actions` checking `isInterrupted`; `perform` rejecting with `not_your_turn` |
| `TakeEffect` | the action after its awaits: `type`'s `delay` before each chunk, `delete`'s check after `show` and `getText`, `run`'s `notStarted` after `shellIntegration` |
| `ChangeTurn` | `takeTurn` or `handBack`, which call `interrupt()` |

Each invariant and property was proved to bite with a mutation, run in TLC and
then reverted:

| Mutation | Breaks |
|---|---|
| an action leaves a third phase | `TypeOK` |
| `DeleteChecks = FALSE`, the code before #49 | `OnlyTalkInTheirTurn` |
| `Perform` never moves an action on | `BatchEnds` |

Every invariant and property names the test that proves the code obeys it:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `OnlyTalkInTheirTurn` | `controller.test.ts`: OnlyTalkInTheirTurn: takes the turn, interrupting playback, and hands it back with no message or selection; `player.test.ts`: OnlyTalkInTheirTurn, Perform: allows only say and point during the programmer's turn; `session.e2e.test.ts`: OnlyTalkInTheirTurn: stops a delete when the programmer takes the turn while it starts, and deletes nothing |
| `BatchEnds` | `controller.test.ts`: BatchEnds, ReadyAtHead: returns the first step immediately and blocks the second until the first finishes |

### `Reload`: a file changed on disk

Line identities, and the agent's selection staying on its text, through
`otherEdit` and `recordEdit` in `packages/core/src/controller.ts`, with the
change VS Code reports when it reloads a document from disk. Measured in an
integration run, that is one change from the first line that differs to the
last, unchanged lines included. `SplitRuns` is the fix for #65: `lineChanges` in
`diff.ts` splits it into one change per run of changed lines.

| Spec | Code |
|---|---|
| `Reload` | a file changed on disk: `onChange` in `editor.ts` passes VS Code's changes, `otherEdit` -> `recordEdit` moves the scene (`mapThrough`, which keeps a position where a change starts) and the identities (`applyChange`) through them |
| `Runs`, `Coarse` | the changes `recordEdit` is given, with and without `lineChanges` |

Each invariant was proved to bite with a mutation, run in TLC and then
reverted. `SplitRuns = FALSE`, the code before #65, breaks UnchangedKeepIds
first, and SelectionStays with UnchangedKeepIds left out of the config:

| Mutation | Breaks |
|---|---|
| a selection moved past the file | `TypeOK` |
| a selection on an unchanged line moves down one | `SelectionStays` |
| a selection at the start of a changed run moves past it, as one inside it does | `StartOfRunStays` |
| every line gets a fresh id | `UnchangedKeepIds` |
| no line gets a fresh id | `ChangedGetNewIds` |

Every invariant names the test that proves the code obeys it:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `SelectionStays` | `session.e2e.test.ts`: SelectionStays: keeps the agent's selection on a line between the changed ones |
| `UnchangedKeepIds` | `session.e2e.test.ts`: UnchangedKeepIds: keeps the numbers of the lines between the changed ones known |
| `StartOfRunStays` | `player.test.ts`: StartOfRunStays: keeps a selection that starts where a change starts, and moves its end past the change |
| `ChangedGetNewIds` | `session.e2e.test.ts`: ChangedGetNewIds: forgets the number of a changed line, so a batch has to read it again |

### `Rehearsal`: line identities across a rehearsal

A line number the agent was shown is accepted only while that line still has
that number: `core/src/lines.ts`, `rehearsal.ts`, `controller.ts`, and the
player's `knows`. Each line has a ghost, which line it really is, next to the
tracker's id, and changes are whole lines inserted or deleted or an edit within
a line, where `applyChange`'s rules are plain. Two defenses keep that: a change
by others to a file the queue edits interrupts it (`OtherInterrupts`), and
`adopt` takes the fork's ids only for a text that reads as in the fork
(`AdoptChecksText`). An interrupt discards the batches still queued, but one
already playing plays on and may complete, as when a formatter changes the file
on save (#151); `AdoptChecksText` keeps that batch's fork ids off the changed
text. The programmer's edit interrupts in the agent's turn and is never
followed; a turn change interrupts too. Until a report says the queue was
interrupted, and the batch the interrupt left playing has ended (`stale`), no
batch is rehearsed, and `read` shows the editor's text. A report while that
batch plays marks the interrupt reported (`staleReported`), and `stale` clears
when it ends (`ReportWaitsForQueue`, the fix for #219: a report cleared `stale`
at once, so the next batch was rehearsed from the playing batch's fork, which
missed the programmer's edit, and a line just read was refused). Batches are
queued, each rehearsed from the one before; the config bounds the queue.
`ReadIsStart`: right after a read, the agent's next batch is checked against
what it was shown. `ShareIds` is the fix for a bug this spec found:
`followChange` gave a queued batch's fork its own id for a line a tool inserted,
unlike the editor's id the agent was shown, so a line the agent had just read
was refused. Now the fork drops its copy of the file's ids, and reads the
editor's.

| Spec | Code |
|---|---|
| `Read` | `read`: `saw` with the queue's last `after.lines` when a queued batch edits the file (`planned`), unless `stale`; else the editor's |
| `Submit` | `step`'s rehearsal: `fork()` of where the queue leaves off (`Origin`), the batch played in memory; while `stale`, the batch is discarded unrehearsed |
| `Play`, `FailPlay` | the oldest batch playing, the editor tracking its edits, `adopt`; a batch that does not complete (interrupted, discarded, or failed), with its change made or not, is not adopted, and interrupts the queue |
| `EndStale` | the player's loop: once the batch an interrupt left playing ends, an interrupt already reported is over (`staleReported`) |
| `EditAsOther` | `otherEdit`: the editor tracks the change; the queue is interrupted if a batch edits the file (`interrupt`: the batches still queued are discarded, one already playing plays on, and `stale` is set), else each rehearsal follows it (`followChange`) |
| `EditAsProgrammer` | `userEdit`: the editor tracks the change; in the agent's turn it interrupts, whatever file it is in; never followed |
| `ChangeTurn` | `takeTurn` and `handBack`, each interrupting the queue |
| `Accept` | the rehearsal's `knows` in `unseen`: the id the agent was shown at a number is the id there where the rehearsal starts |
| `Report` | every `snapshot`: a step's, from `ready()` or its timer, `rejectBatch`'s, `rejectUnanchored`'s, and `resumeSession`'s, which forgets `seen`; it clears `stale` with the queue empty, and otherwise sets `staleReported` (#219) |

Each invariant was proved to bite with a mutation of a copy of the model, run in
TLC and then reverted:

| Mutation | Breaks |
|---|---|
| a line someone else inserts gets an id below 0 | `TypeOK` |
| `knows` takes any number in the text, whatever its id | `AcceptedOnlyForThatLine` |
| `Submit` doesn't advance the shared counter | `IdsDistinct` |
| a change by others leaves the editor's ids as they were | `OnePerLine` |
| `ShareIds = FALSE`, the code before this spec | `ReadIsStart` |
| `OtherInterrupts = FALSE` | `ReadIsStart` |
| `AdoptChecksText = FALSE`, with `OtherInterrupts = FALSE` | `OnePerLine` |
| `AdoptChecksText = FALSE` alone | `OnePerLine`: a batch playing when a change by others interrupted the queue completes, and adopts its fork's ids for a text with a line more or fewer (#151) |
| an interrupt discards the playing batch too, the spec before #151, with `AdoptChecksText = FALSE` | nothing: no batch then plays on a text other than its fork's, so that spec could not see what `AdoptChecksText` guards |
| a programmer's edit in the agent's turn leaves the queue alone | `ReadIsStart` |
| `FailPlay` adopts the fork's ids for a change it made | `OnePerLine` |
| `Submit` queues an edit rehearsed in the programmer's turn | `ReadIsStart` |
| `ReportWaitsForQueue = FALSE`, the code before #219 | `ReadIsStart` |
| the player's loop does not end a reported interrupt (`EndStale` left out) | `ReportedWhilePlaying` |
| `Submit` queues a batch while `stale` | nothing here: `Controller`'s `PlaysKnowingEvents` checks that no batch is queued before the agent knows of an interrupt |

`OtherInterrupts = FALSE` alone does not break `AcceptedOnlyForThatLine`. With
`AdoptChecksText = FALSE`, `OnePerLine` breaks first, and past it the model
reads beyond the end of a sequence, so `AcceptedOnlyForThatLine` is not checked
on its own there.

Every invariant names the test that proves the code obeys it:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `AcceptedOnlyForThatLine` | `session.e2e.test.ts`: AcceptedOnlyForThatLine: rejects a number from before the lines a queued batch adds above it, and takes one from a `read` after them; AcceptedOnlyForThatLine: rejects a report's number that a queued batch has since moved |
| `IdsDistinct` | `lines.test.ts`: IdsDistinct: never gives two lines one identity, in the editor's LineIds or a fork of it, through the same change to both |
| `OnePerLine` | `lines.test.ts`: OnePerLine, Distinct, Untouched, WithinALine, BreakAtEnd, BreakAtStart: gives each line of the result one identity, never one twice, and keeps the untouched lines'; `lines.test.ts`: OnePerLine: adopts a fork's identities only for a file that reads as it did in the fork (specs/Rehearsal.tla, #151). In the code, `version` checks a file's text again before it uses its ids, so a wrong `adopt` gives the file new identities, not too few or too many; this test fails that way when `adopt` skips its check |
| `ReadIsStart` | `session.e2e.test.ts`: ReadIsStart: accepts a line a tool inserted, read while a batch that edits no file plays (specs/Rehearsal.tla); ReadIsStart: still interrupts for a change to a file a queued batch edits; `controller.test.ts`: ReadIsStart: an edit by others to a file a queued batch edits interrupts it, and to another file the queue's rehearsals follow it; ReadIsStart, ReportedWhilePlaying: stays stale after a report while the batch an interrupt left plays, until it completes |
| `ReportedWhilePlaying` | `controller.test.ts`: ReadIsStart, ReportedWhilePlaying: stays stale after a report while the batch an interrupt left plays, until it completes; `integration.ts`, in VS Code: the controller paths, where a report during a batch's held last save leaves the next step rehearsed once it completes |

### `Terminals`: running commands

`packages/vscode/src/terminal.ts`: `acquire`, the wait for shell integration,
the command, and what ends each wait. The real foreign-execution fixture keeps
a bounded, failure-only trace of terminal event identities and captured output;
this diagnostic does not change the transitions modeled here.

| Spec | Code |
|---|---|
| `Acquire` | `acquire()`: a terminal that isn't busy, whose shell is alive, in the run's directory, or a new one there; `busy = true`. The signal may have fired before (an interrupt during the save) |
| `ExecuteCommand`, `AbortBeforeStart`, `RejectClosed` | `shellIntegration()`: integration or its timer, then `executeCommand`; the signal; a terminal closed meanwhile (VS Code throws for its `sendText`) |
| `End`, `StopWaiting`, `CloseTerminal` | `onDidEndTerminalShellExecution`; `stopWaiting` (the wait or an interrupt during it: one before it is `SkipAborted`, and nothing awaits between that check and the wait, #176); `onDidCloseTerminal` |
| `SendText` | the timer fires with no integration: the command is typed in (`sendText`), and the terminal stays busy for good |
| `SkipAborted` | a signal that fired before the run: `shellIntegration()` returns at once, and `run()` reports `notStarted` |
| `Exit` | the shell exits (`exitStatus`); the terminal stays open, and `acquire()` won't reuse it |

Each invariant and property was proved to bite with a mutation of a copy of the
model, run in TLC and then reverted:

| Mutation | Breaks |
|---|---|
| `Acquire` leaves the command a value outside `CommandStates` | `TypeOK` |
| `Reusable` ignores `busy` | `NoReuseWhileBusy` |
| `End` leaves its terminal busy | `FreedAfterEnd` |
| `SendText` leaves the call running, waiting for a command nothing tracks | `RunReturns` |

Every invariant and property names the test that proves the code obeys it:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `NoReuseWhileBusy` | `terminal.test.ts`: NoReuseWhileBusy: gives a second command a new terminal while the first one's command still runs |
| `FreedAfterEnd` | `terminal.test.ts`: FreedAfterEnd, Exit: reuses a terminal once its command ends, in the folder it's in, and not one whose shell exited |
| `RunReturns` | `terminal.test.ts`: RunReturns, SkipAborted: doesn't wait for shell integration once playback is interrupted, and starts nothing; RunReturns, ExecuteCommand, End: runs the command, reads its output, and reports how it ended, with its shell; RunReturns, StopWaiting: returns with the command still running when the wait is over, or playback is interrupted; RunReturns, CloseTerminal: ends the wait when the programmer closes the terminal, and not for another terminal; RunReturns, SendText: waits for shell integration to come, for this terminal only, and types the command in without it |

### `QuietTerminals`: visibility and cleanup

This model checks quiet startup, automatic show, explicit reveal, fallback
visibility, and cleanup. It abstracts shell completion; a live shell is never
closed automatically because background work cannot be ruled out. Exposed
terminals are also retained. Both settings were checked: 9 distinct states
for quiet and 11 for automatic show.

| Mutation | Breaks |
|---|---|
| allow cleanup of protected or live shells | `NeverCloseProtected` |
| hide the untracked fallback | `FallbackVisible` |
| fail to show on a reveal request | `RevealWorks` |
| show a quiet start | `QuietStart` |
| fail to show an automatic start | `AutoStartVisible` |
| make starts a no-op | `RunBegins` |

| Property | Test |
|---|---|
| `TypeOK` | TypeScript checks these types |
| `NeverCloseProtected` | `terminal.test.ts`: cleans up exited owned terminals while preserving live, running and untracked shells |
| `FallbackVisible` | `terminal.test.ts`: RunReturns, SendText |
| `RevealWorks`, `QuietStart` | `terminal.test.ts`: runs quietly and reveals only the owned terminal on request |
| `AutoStartVisible` | `terminal.test.ts`: StartRespectsPreference: reveals commands when automatic display is enabled |
| `RunBegins` | `terminal.test.ts`: RunReturns, ExecuteCommand, End |

### `TerminalReuse`: protected reuse

This separate model enumerates shell state, exposure and pending output drain,
and a foreign shell-start event. It abstracts path and terminal-ID matching,
which the existing `Terminals` model and terminal tests cover. TLC checked 48
states. An unobserved background descendant is not modeled as detectable; live
shells are retained on cleanup even after a foreground command ends.
The native `foreignTerminalExecution` fixture first observes the initial Pair
execution's actual start and end and verifies its successful run report before
starting a foreign execution. This strengthens the test precondition; it does
not change the modeled behavior or establish the cause of issue #53.

| Mutation | Breaks |
|---|---|
| ignore exposure | `ProtectedNotReused` |
| ignore pending output drain | `ProtectedNotReused` |
| fail to protect a foreign start | `ForeignProtected` |
| skip eligible reuse | `EligibleReused` |
| make an attempt a no-op | `AttemptCompletes` |

| Property | Test |
|---|---|
| `TypeOK` | TypeScript checks these types |
| `ProtectedNotReused` | `terminal.test.ts`: NoReuseWhileBusy; protects a terminal if another execution starts; pending output drain prevents reuse |
| `EligibleReused` | `terminal.test.ts`: ShowExact: invalidates the old command ID when a hidden terminal is reused |
| `ForeignProtected` | `terminal.test.ts`: protects a terminal if another execution starts, while recognizing its own execution |
| `AttemptCompletes` | `terminal.test.ts`: RunReturns, ExecuteCommand, End |

### Pure functions: `LineIdentity`, `Places`, `Typing`, `ActionValidation`

These have no state or concurrency, so each spec is a model of the function and
`ASSUME`s that TLC checks over every small input. Each also has an exhaustive
test that checks the same properties on the code itself, so the model and the
code are held to one contract.

| Spec | Code | Contract | Test |
|---|---|---|---|
| `LineIdentity` | `applyChange` in `core/src/lines.ts` | one identity per line, none named twice; lines outside the change keep theirs; a line break at the end of a line keeps it in place, at its start moves it down | `core/test/lines.test.ts` |
| `Places` | `resolveSpot`, `resolveSpan` in `core/src/places.ts` | a spot or span resolves exactly when one match is on its line, and lies there; a range ends at the first `through` after `from` | `core/test/places.test.ts`, with `through` up to 2 characters (the spec: 3) |
| `Typing` | `planTyping` in `core/src/typing.ts` | chunks concatenate to the text; quote runs of three or more are atomic, and other chunks are characters or indentation with their line break | `core/test/typing.test.ts`, texts up to 5 characters (the spec: 7) |
| `ActionValidation` | `moveProblem`, `spanProblem` in `protocol/src/index.ts` | a place gets no problem exactly when it is valid, and no place makes either check throw | `protocol/test/index.test.ts`, with the same kinds of value as the spec |

Each is a module of `ASSUME`s alone, with a config that only gives the
constants (the guide's 8.7, item 6): TLC checks the `ASSUME`s and explores no
states.

#### `LineIdentity`

Each `ASSUME` was proved to bite with a mutation, run in TLC and then reverted;
each mutation broke only its own:

| Mutation | Breaks |
|---|---|
| the id of the line after the change is dropped | `OnePerLine` |
| every fresh id is 100 | `Distinct` |
| the lines before the change get new ids | `Untouched` |
| a line edited within itself gets a new id | `WithinALine` |
| with a prefix, the id stays on the line after the break | `BreakAtEnd` |
| at a line's start, the id stays on the first line | `BreakAtStart` |

Each names the test that proves the code obeys it:

| Assumption | Proved by |
|---|---|
| `OnePerLine` | `lines.test.ts`: OnePerLine, Distinct, Untouched, WithinALine, BreakAtEnd, BreakAtStart: gives each line of the result one identity, never one twice, and keeps the untouched lines' |
| `Distinct`, `Untouched`, `WithinALine`, `BreakAtEnd`, `BreakAtStart` | the same test |

#### `Places`

Each `ASSUME` was proved to bite with a mutation, run in TLC and then reverted:

| Mutation | Breaks |
|---|---|
| `SpotsOnLine` ignores the line | `SpotOK` |
| `ResolveSpot` takes any match on the line, not only a single one | `SpotOnlyWhenUnique` |
| `ResolveText` ignores the line | `SpanOK` |
| a `through` may start inside `from` | `RangeOK` |

Each names the test that proves the code obeys it:

| Assumption | Proved by |
|---|---|
| `SpotOK`, `SpotOnlyWhenUnique` | `places.test.ts`: SpotOK, SpotOnlyWhenUnique: resolves a spot only when one match has its marker on the line, and puts it there |
| `SpanOK`, `RangeOK` | `places.test.ts`: SpanOK, RangeOK: resolves a span only when its text starts once on the line, and a range to the first `through` after it |

#### `Typing`

Each `ASSUME` was proved to bite with a mutation, run in TLC and then reverted:

| Mutation | Breaks |
|---|---|
| a line feed's chunk drops the line feed | `ConcatenatesToText` |
| an "x" shares its chunk with the character after it | `ChunksAreUnits` |
| split every quote run into individual characters | `QuoteRunsAtomic` |

Each names the test that proves the code obeys it:

| Assumption | Proved by |
|---|---|
| `ConcatenatesToText` | `typing.test.ts`: ConcatenatesToText, ChunksAreUnits: splits text into chunks that concatenate to it, each one character or a line break with its indentation |
| `ChunksAreUnits` | the same test |
| `QuoteRunsAtomic` | `typing.test.ts`: types a run of three or more quotes in one edit without losing cadence; `session.e2e.test.ts`: reports the correct remaining text when interrupted around an atomic quote run |

#### `TypingEol`

The model normalizes CRLF input before chunk planning and writes line feeds in
the document's line ending. It covers suffixes at input-unit boundaries; lone
carriage returns are outside the model. TLC checked all sequences of up to five
units, for both output endings.

| Mutation | Breaks |
|---|---|
| omit normalization before encoding | `CorrectEol` |
| omit normalization from the remaining suffix | `SuffixSafe` |
| allow a cursor between CR and LF | `NoSplitCRLF` |

| Assumption | Proved by |
|---|---|
| `CorrectEol` | `player.test.ts`: normalizes CRLF input for both actions and document endings |
| `SuffixSafe` | `session.e2e.test.ts`: normalizes CRLF and replays the interrupted action in both document endings and typing modes |
| `NoSplitCRLF` | `index.test.ts`: rejects a cursor marker between CR and LF while allowing lone CR; `session.e2e.test.ts`: refuses both actions before editing |

#### `ActionValidation`

The checks both the relay's schema and the player ask (#45), over every
`move` and every `select` or `point`, by the kind of value in each field.
Each `ASSUME` was proved to bite with a mutation, run in
TLC and then reverted:

| Mutation | Breaks |
|---|---|
| `CheckAtText = FALSE`, the code before #163, where `{ at: 5 }` threw in `spotProblem` | `NeverThrows` |
| `MoveProblem` without its check for neither `at` nor `to` | `MoveExactly` |
| omit the multi-close acknowledgment restriction | `MoveExactly` |
| `SpanProblem` without its check for empty code | `SpanExactly` |
| `Spoken` ignores `speak: false` (#41) | `SpokenByDefault` |

Each names the test that proves the code obeys it:

| Assumption | Proved by |
|---|---|
| `MoveExactly` | `protocol/test/index.test.ts`: MoveExactly, NeverThrows: gives no problem exactly for a valid move, and a message for every other; accepts the multiple-close acknowledgment only as true on line_end; `integration.ts`, in VS Code: MoveExactly, SpanExactly, NeverThrows: malformed actions refused by name in the editor; frames that aren't messages dropped |
| `SpanExactly` | `protocol/test/index.test.ts`: SpanExactly, NeverThrows: gives no problem exactly for a valid span, and a message for every other; `integration.ts`, in VS Code: MoveExactly, SpanExactly, NeverThrows: 27 malformed actions refused by name in the editor; frames that aren't messages dropped |
| `NeverThrows` | both tests |
| `SpokenByDefault` | `protocol/test/index.test.ts`: Spoken: speaks a say by default, unless it opts out or its text cannot be spoken |
| `SpeechExactly` | `protocol/test/index.test.ts`: accepts only bounded plain speech units and allows unflagged narration; reports counts for rejected strings. The count feedback changes only error formatting, which the model does not represent. |

### Contracts checked by tests: `ActionValidation`, `Render`, `AgentSetup`

These three contracts from #19 are about what the code accepts or writes, not
about states, so they are tests on the code, not TLA+. `ActionValidation`'s
two checks, `moveProblem` and `spanProblem`, also have a spec of their own,
above (#163); this contract holds the relay's schema and the player to them.

| Contract | Test |
|---|---|
| The relay's schema and the player's checks accept the same actions (#45) | `relay/test/validation.test.ts`: every action in its table through both, malformed ones above all |
| Every field of a `Report` appears in its rendered text | `relay/test/render.test.ts`: renders every field of a report |
| Setting up an agent changes only its `pair` entry, and twice equals once | `vscode/test/agents.test.ts`: AgentSetup, for the TOML and JSON configs |

### Attention cue cache

`AttentionCache.tla` models a single pending synthesis and cache generation,
including a late completion after cancellation or a settings change. The model
abstracts the existing worker and output lease lifecycles; it does not prove
physical retirement. `JobRetires` assumes weak fairness of completion.

| Property | Code evidence |
|---|---|
| `TypeOK` | Bounded model state; no direct test |
| `CurrentCache` | `rejects a late attention result after a settings change`; `does not cache a canceled attention cue` |
| `CurrentPlayback` | `invalidates attention audio eagerly when settings change away and back`; `reserves the current route again when replaying attention audio` |
| `JobRetires` | Existing speech lifecycle retirement tests; completion fairness is an environmental assumption |

Removing the completion identity guard produces a `CurrentCache`
counterexample after a settings change and late completion. Removing the replay
admission guard violates `CurrentPlayback`. The model does not
prove waveform correctness or physical playback retirement.

## Keeping specs and code in step

Nothing ties a spec to its code but the tables above. When code in one of the
files above changes, update its spec, and run `specs/check.sh`.

### `LineEndGuard`: intent before crossing multiple closes

Rehearsal rejects a batch before playback when its current-line suffix contains
only multiple closing brackets and whitespace, unless the move acknowledges
the crossing. Playback checks the live suffix again. The model abstracts this
predicate as danger; it does not parse code or cover other suffixes. Its 22
distinct states include different rehearsed and live contexts.

| Mutation | Breaks |
|---|---|
| disable the rehearsal guard | `PreflightRefuses` |
| disable the live guard | `LiveGuard` |
| make an edit before rejecting | `RejectBeforeEdits` |
| refuse acknowledged live crossings | `AllowedActs` |
| make all allowed moves no-ops | `AllowedActs` |

| Invariant | Test |
|---|---|
| `TypeOK` | TypeScript checks the state types |
| `RejectBeforeEdits`, `PreflightRefuses` | `session.e2e.test.ts`: rejects an entire batch when a later line_end would cross multiple closes |
| `LiveGuard` | `player.test.ts`: guards multiple adjacent closes during playback unless acknowledged |
| `AllowedActs` | `session.e2e.test.ts`: allows an explicitly acknowledged multi-close move and subsequent edit; `player.test.ts`: allows line_end for a single close or when code follows the closes |

### `StructuralTyping`: explicit structural edits

`structuralNewline` and `Player.perform` split a supported Python or JSON pair
only in code, and `next_close` crosses one adjacent close without altering the
text. The model abstracts the prefix to ordinary, closed-field, open-field, and
opaque categories; it does not model character-by-character lexing. The helper
tests cover quoted fields, nesting, escaping, mismatches and the depth bound.

| Spec | Code |
|---|---|
| `SmartNewline` | the opt-in `newline` action and its lexical guard |
| `StepClose` | the relative `next_close` move |
| `NewlineSafe`, `RefusalSafe` | reject unsupported or unsafe contexts |
| `NewlineActs`, `StepActs` | eligible actions take effect |
| `StepOne` | one close is crossed, and the text stays unchanged |

Each invariant was mutation-tested in TLC, then the mutation was reverted:

| Mutation | Breaks |
|---|---|
| Set the move distance to 2 | `TypeOK`, `StepOne` |
| Make an eligible newline a no-op | `NewlineActs` |
| Accept an unmatched pair | `NewlineSafe` |
| Make an eligible close step a no-op | `StepActs` |
| Change state after refusing a newline | `RefusalSafe` |
| Treat a closed formatted field as opaque | `ClosedFieldRecovers` |
| Treat open or unsupported fields as code | `OpaqueFieldRefused` |

| Invariant | Test |
|---|---|
| `TypeOK` | The TypeScript compiler checks the types |
| `NewlineSafe`, `RefusalSafe` | `player.test.ts`: NewlineSafe, RefusalSafe: refuses newline without a cursor, with a selection, or in an unsafe context |
| `NewlineActs` | `player.test.ts`: NewlineActs: inserts a structural newline inside a Python pair |
| `ClosedFieldRecovers` | `structural_typing.test.ts`: ClosedFieldRecovers: accepts a later assertion after a closed field; `session.e2e.test.ts`: ClosedFieldRecovers: splits the assertion after a closed quoted field |
| `OpaqueFieldRefused` | `structural_typing.test.ts`: OpaqueFieldRefused: retains conservative refusal |
| `StepOne`, `StepActs` | `player.test.ts`: StepOne, StepActs: steps past exactly one adjacent close and refuses any other character |

### `BuildIdentity`: the running bundle's label

The panel's Settings dialog displays the version and content-derived build ID
compiled into the running extension. Installing another bundle changes the
model's `installed` value; only a reload changes `running` and `displayed`.

| Spec | Code |
|---|---|
| `Install`, `Reload` | VS Code installation and extension activation |
| `ShowsRunning` | the panel receives the values compiled into its host |
| `ShowsNewAfterReload` | activation uses the newly loaded bundle's values |

TLC mutations that put an invalid value in the label, update it on install, or
leave it stale on reload violate `TypeOK`, `ShowsRunning`, and
`ShowsNewAfterReload`, respectively.

| Invariant | Test |
|---|---|
| `TypeOK` | The TypeScript compiler checks the types |
| `ShowsRunning`, `ShowsNewAfterReload` | `vscode/test/panel.test.ts`: ShowsRunning, ShowsNewAfterReload: each page uses its running bundle identity |

### `ReadingSkip`: finishing a message's reading delay

The panel sends an ID for the selected message countdown. The controller checks
the session and pause state, queries the live Player for the current ID, then
asks the session Timeline to finish its active sleep. IDs absent from older
replay events do not enable the control. The model abstracts the timeline to
one pending countdown.

| Spec | Code |
|---|---|
| `Start`, `Finish` | a `say` starts and ends its reading delay |
| `ChangeContext` | pause, turn or session suspension changes |
| `Click` | the panel request, Controller guards and live Player identity query before the Timeline operation |

Each property was checked by a mutation in a temporary model: accepting the
wrong ID or an explicit pause violates `OnlyCurrent`; ignoring an eligible
click violates `EligibleFinishes`; clearing a countdown on an ineligible click
violates `IneligibleKeepsReading`; an out-of-range ID violates `TypeOK`.

| Invariant | Test |
|---|---|
| `TypeOK` | The TypeScript compiler checks types |
| `OnlyCurrent` | `controller.test.ts`: only the current live reading ID can finish the session Timeline |
| `EligibleFinishes`, `IneligibleKeepsReading` | `session.e2e.test.ts`: EligibleFinishes, IneligibleKeepsReading: finishes the requested delay without lifting a user pause |
| `IneligibleKeepsReading` | `controller.test.ts`: IneligibleKeepsReading: forwards an ID only in an active unpaused agent turn |

### `SpeechWorker`: canceled inference and bounded cleanup

> The `LocalSynthesisClient` of `WarmSynthesisWorker` now owns the worker
> lifecycle this model describes; this model remains the record of the
> service-level cleanup it checked, and the client's own invariants are in the
> `WarmSynthesisWorker` section.

`SpeechWorker.tla` keeps CPU-job ownership after its visible gate is canceled.
A separate fair watchdog transitions a stuck job to termination, and a new job
is admitted only after completion or termination. The liveness property
assumes worker termination eventually settles; cancellation itself resolves the
visible gate without waiting for that settlement. Two bounded job IDs expose
stale results and attempts to overlap work. The build stages a compatible C++
runtime alongside the native binding; this packaging repair does not change
the modeled worker ownership, cancellation, or watchdog behavior.

### `Narration`: spoken units and reading gates

`Narration.tla` models the default wait mode. `SpeechOverlap.tla` models the
additional continue mode below. `Narration.tla` models spoken units that queue
behind one another (#41: every
`say` is spoken unless it opts out, so a unit may be admitted while another is
outstanding), one active unit at a time, two units,
generation IDs, two page and session epochs, page loss, reply, pause, reading
holds, and an independent command decision. `ReadyCurrent` and
`CompletionCurrent` reject stale worker and page callbacks; `GateSafe` keeps
speech completion, error, and cancellation from changing reading, holds,
pause, or command approval. `AdvanceAfterGates` requires both gates, and
`Progress` checks eventual advancement under weak fairness when a page and
session eventually stay present and all pauses and holds eventually clear.
The integration-only speech observation records `ended` or page failure only
when the service accepts a callback for the current generation and page; idle
after cancellation is not playback completion. The model abstracts the audio
transport and the full queue implementation. `QueueDrains` checks that every
admitted unit is eventually displayed, under the same fairness. TLC checked
8,684 distinct states with `Narration.cfg`.

| Property | Test |
|---|---|
| `TypeOK` | The TypeScript compiler checks types |
| `Ownership`, `QueueDrains` | `controller.test.ts`: Admit: queues a spoken batch behind another and accepts several spoken says in one batch |
| `DisplayedBeforeSpeech`, `AdvanceAfterGates`, `Progress` | `player.test.ts`: waits for reading when speech finishes first and never speaks a say that opts out; `session.e2e.test.ts`: waits for selected speech after reading before playing the next edit |
| `GateSafe` | `player.test.ts`: keeps reading and command approval after speech throw and reject |
| `LiveOnly` | Nothing yet names it; the rehearsal player is built without a narration port |
| `ReadyCurrent`, `CompletionCurrent`, `PlayingHasReady` | `speech_service.test.ts`: matches generation and page acknowledgements before resolving speech; never accepts a late ended event after playback starts and cancel or pageClosed occurs |
| `NoPlayingWhilePaused` | `speech_service.test.ts`: retains prepared audio during pause and never revives canceled audio; resumes a prepared waveform only when the global pause clears |
| `NoAudioWithoutPage`, `NoAudioWithoutSession` | `speech_service.test.ts`: cancels on page closure and ignores a late page acknowledgement |

Each mutation below was applied alone, and TLC reported the named property:

| Mutation | Violates |
|---|---|
| `Admit` accepts a third unit | `TypeOK` |
| `Display` leaves the unit queued | `Ownership` |
| `Ready` accepts a stale unit ID | `ReadyCurrent` |
| `Display` does not record the display | `DisplayedBeforeSpeech` |
| `Display` starts speech outside live mode | `LiveOnly` |
| `StartSpeech` without a ready waveform | `PlayingHasReady` |
| `StartSpeech` while paused | `NoPlayingWhilePaused` |
| `Advance` before reading is done | `AdvanceAfterGates` |
| `LosePage` leaves audio | `NoAudioWithoutPage` |
| `Reply` leaves audio | `NoAudioWithoutSession` |
| `Advance` is not fair | `Progress` |
| `Display` is not fair | `QueueDrains` |
| `SpeechError` approves the command | `GateSafe` |
| `SpeechError` accepts a stale unit ID | `CompletionCurrent` |

### `SpeechOverlap`: per-action speech pacing

`SpeechOverlap.tla` models one logical action and one physical owner. Wait mode
requires reading and speech completion; continue mode advances after reading.
An end or stop invalidates the session but retains physical ownership until a
matching terminal event. `SpeechOverlap.cfg` assumes fair reading, advance and
terminal events; `SpeechOverlap_Continue.cfg` omits terminal fairness and
checks that continue advances or the session stops. Both explore 141 distinct
states. The model abstracts admission timeout, pause, the owner wrapper and
reused local IDs across sessions; implementation tests cover these boundaries.

| Property | Test |
|---|---|
| `TypeOK` | TypeScript checks implementation types. |
| `WaitGate`, `ReadingGate` | `player.test.ts`: displays selected text before requesting speech and waits for both gates. |
| `NoOverwrite`, `ContinueProgress` | `player.test.ts`: ContinueProgress: advances after reading while speech continues, then gates the next say. |
| `MatchingTerminal`, `NoOldOwner` | `remote_narration.test.ts`: settles only a matching current terminal and rejects stale acknowledgements. |
| `CancelOnEnd` | Controller end cancels narration. |
| `Progress` | `player.test.ts`: displays selected text before requesting speech and waits for both gates. |

Mutations allowing a busy successor, advancing wait early, advancing before
reading, and ending without cancellation violate `NoOverwrite`, `WaitGate`,
`ReadingGate`, and `CancelOnEnd`, respectively. Accepting stale terminal
identity violates `MatchingTerminal`. Requiring speech completion in continue
mode violates `ContinueProgress` without terminal fairness.

### `ReadingHold`: scoped timer holds

The controller accepts a hold only for the current eligible reading. Release
clears the matching hold even if another pause arose meanwhile; it never clears
that separate pause. Mutations accepting a stale ID, clearing global pause,
ignoring eligible holds, or refusing a matching release while paused violate
`StaleDoesNothing`, `ReleaseKeepsPause`, `EligibleHold`, and `EligibleRelease`.
An unscoped hold violates `ScopedHold`. The player exposes the current reading
identity; the controller applies matching live hold, release and finish to the
session's `Timeline`. Only a new hold checks ended, suspended, turn and global
pause eligibility. A matching release may still clear the local hold while any
of those states apply, and `Timeline.release` preserves a separate global pause.
The rehearsal has an immediate pacing clock and no programmer-addressable
reading controls. Stale page-disposal safety is enforced separately by the
panel's page-identity guard; a current-reading query alone does not establish it.

| Invariant | Test |
|---|---|
| `TypeOK` | The TypeScript compiler checks types |
| `ScopedHold`, `StaleDoesNothing`, `EligibleHold` | `controller.test.ts`: matching live reading IDs alone accept eligible holds; `integration_code_playback.ts`: held real code reading remains incomplete and unsettled |
| `ReleaseKeepsPause`, `EligibleRelease` | `controller.test.ts`: matching release is forwarded even while globally paused; `timeline.test.ts`: ReleaseKeepsPause, EligibleRelease: does not release a separate playback pause when the hold ends |

### `ReadingGesture`: binding a press to its countdown

The panel captures the countdown ID at press time. A long press suppresses its
following click; a short press can finish only that captured countdown. Mutations
using the new ID, allowing the long click, and ignoring a short current press
violate `NoNewerSkip`, `LongDoesNotSkip`, and `ShortCurrentSkips`.

| Invariant | Test |
|---|---|
| `TypeOK` | The TypeScript compiler checks types |
| `NoNewerSkip` | `webview/panel.test.ts`: NoNewerSkip: does not let an old press finish a newer countdown |
| `LongDoesNotSkip` | `webview/panel.test.ts`: LongDoesNotSkip: holds, resumes on release, and suppresses the resulting click |
| `ShortCurrentSkips` | `webview/panel.test.ts`: ShortCurrentSkips: finishes once on a short pointer press |

### `ListeningHint` and `SettingsAccess`: panel controls

The hint appears only for active, unpaused listening; Settings remains reachable
in idle and active panels. Mutating the hint to ignore context violates
`HintMatchesStatus`; hiding the gear while idle violates `SettingsAvailable`.

| Invariant | Test |
|---|---|
| `TypeOK` | The TypeScript compiler checks types |
| `HintMatchesStatus` | `webview/panel.test.ts`: offers a focusable explanation only while the active agent is listening |
| `SettingsAvailable` | `panel_html.test.ts`: places one icon-only Settings control in the toolbar before End; `visual/chat_order.spec.ts`: the Settings gear remains available while idle, calibrating, and active |

### `TerminalPanel`: preference and explicit terminal reveal

The panel keeps automatic visibility separate from explicit requests. A reveal
uses the command ID; a missing terminal produces an unavailable response. The
model abstracts terminal ownership and cleanup, which the terminal model covers.
TLC checked 61 distinct states. Mutating the result type, ignoring automatic
visibility, showing a different ID, failing to report a missing ID, or ignoring
an available request violates `TypeOK`, `StartRespectsPreference`, `ShowExact`,
`MissingReported`, and `AvailableShown`, respectively.

| Invariant | Test |
|---|---|
| `TypeOK` | TypeScript checks the message types; runtime requests are validated |
| `StartRespectsPreference` | `terminal.test.ts`: StartRespectsPreference: reveals commands when automatic display is enabled |
| `ShowExact` | `terminal.test.ts`: ShowExact: invalidates the old command ID when a hidden terminal is reused |
| `AvailableShown` | `webview/panel.test.ts`: AvailableShown: offers the matching terminal for running and filed commands |
| `MissingReported` | `panel.test.ts`: MissingReported and AvailableShown: validates settings and reports a closed terminal |

### `DiagnosticsPrivacy`: bounded allowlisted history

The recorder keeps a bounded history and constructs each event from permitted
fields before it can be copied. The model represents an extra raw secret field,
abstracts timestamps and lifecycle values, and checks a capacity of two. TLC
checked 22,778 distinct states; the speech-only configuration checked 38.
Concrete tests check runtime validation, the 100-event limit, pause-reason
bounds, speech-only events and independent snapshots.

| Mutation | Breaks |
|---|---|
| append the raw event instead of its safe projection | `TypeOK`, `OnlyAllowed` |
| stop dropping the oldest event at capacity | `Bounded` |
| copy an empty history instead of the current history | `CopiedExactly` |
| record without appending | `Recorded` |
| disable recording | `RecordsEventually` |

| Property | Test |
|---|---|
| `TypeOK`, `OnlyAllowed` | `diagnostics.test.ts`: TypeOK, OnlyAllowed: rejects unrecognized speech enums and records capability without a reason; copies only allowlisted fields and rejects malformed input and unsafe identity strings |
| `TypeOK` | `captures only completed speech and preserves it across cancellation and replay` |
| `Bounded` | `diagnostics.test.ts`: bounds its history while retaining the latest state and returns independent snapshots |
| `CopiedExactly` | `diagnostics.test.ts`: starts with unavailable states and records typed events in order |
| `Recorded`, `RecordsEventually` | `diagnostics.test.ts`: OnlyAllowed, Recorded: records speech lifecycle without secret extras even when no session exists; retains valid request, integration and completion events |

The owner connection ID is local to this extension activation; request IDs are
scoped by that ID. `replied` records that the bridge sent a response to the
socket, not that the client acknowledged or consumed it. Unknown state and
uncaptured values stay unavailable; no task, chat, command, output, path,
environment, credential or error text enters this history.

### `DiagnosticsRequest`: isolated bounded diagnostics

The Command Palette and connection-failure warning use the same bounded
snapshot as the panel, including when no panel provider was selected.

The request has no effect on session, owner, pause or queued reports. Collection
can return available facts, unavailable facts, or cancellation. Weak fairness
models the collector deadline; the model abstracts the concrete 100-event bound
and the specific field and audio enums, which protocol and collector tests check.
TLC checked 456 distinct states with 24 initial combinations. Each property was
mutated separately: an invalid response breaks `TypeOK`; a secret fact breaks
`Allowlist`; an absent result breaks `Outcome`; changing the session breaks
`Isolation`; removing fairness breaks `EventuallyResponds`.

| Property | Test |
|---|---|
| `TypeOK`, `Allowlist` | `diagnostics.test.ts`: accepts bounded allowlisted workspace and audio facts; rejects secrets, arbitrary fields, and excess events |
| `Outcome`, `EventuallyResponds` | `diagnostics_collector.test.ts`: returns within the bound when a companion hangs; retains workspace facts when companion commands fail or return private data |
| `Isolation` | `bridge.test.ts`: lets a non-owner inspect without affecting the owner session; cancels an idle diagnostics request without starting a session; `extension.test.ts`: reports the current idle, active, and suspended session without changing it |

### `DiagnosticsCopy`: explicit clipboard export

An explicit action from the panel, Command Palette, or connection warning can
succeed or fail; opening Settings alone does not copy.
TLC checked three states. Mutations that copy before a request, fail to produce
an outcome, or produce both outcomes violate `OnlyOnRequest`,
`RequestedCompletes`, and `ExclusiveOutcome`; an invalid type is rejected.

| Invariant | Test |
|---|---|
| `TypeOK` | TypeScript checks the control and outcome types |
| `OnlyOnRequest` | `webview/panel.test.ts`: OnlyOnRequest: requests diagnostics only when the button is activated |
| `RequestedCompletes`, `ExclusiveOutcome` | `panel.test.ts`: OnlyOnRequest and RequestedCompletes: copies only when asked and reports either outcome; `extension.test.ts`: copies diagnostics from a command when the panel is unavailable; reports a clipboard failure from the diagnostics command |

### `CodePlayback`: grouped code and its reading pauses

The model treats existing typing chunks as indivisible atoms. Each insertion
chooses a contiguous, bounded group, including the exception for one oversized
atom. A fresh countdown blocks the next insertion until it finishes; pause and
interrupt also block insertion. A click can finish only its own live countdown.
The progress config assumes no pause or interrupt and weak fairness.
`Typing` separately models quote and newline/indent atoms. The model abstracts
line/whitespace preference, text encoding, the visual highlight and panel
rendering; tests cover those concrete details.

The model mutations drop or duplicate an atom (`PrefixExact`), overflow the
identifier (`TypeOK`), accept a stale click (`CurrentCountdown`), clear a
rejected click (`RejectedKeepsCountdown`), bypass pause, reading, interruption
or the group bounds (the corresponding action property), or disable insertion
(`EventuallyComplete`). TLC found a violation for each mutation.

| Property | Test |
|---|---|
| `TypeOK` | TypeScript checks the corresponding code types. |
| `PrefixExact` | `typing.test.ts`: PrefixExact: groups complete lines without losing indentation or quote atoms; `player.test.ts`: PrefixExact: returns only the suffix when interrupted during reading. |
| `CurrentCountdown`, `RejectedKeepsCountdown` | `controller.test.ts`: ScopedHold: controls only the current reading and releases while globally paused; `integration_code_playback.ts`: holds and finishes real grouped-code readings. |
| `PausedBlocksInsert` | `session.e2e.test.ts`: PausedBlocksInsert: a paused code countdown blocks the next group. |
| `ReadingBlocksInsert` | `session.e2e.test.ts`: ReadingBlocksInsert: interrupts a code reading pause with the exact suffix. |
| `InterruptedBlocksInsert` | `player.test.ts`: PrefixExact: returns only the suffix when interrupted during reading. |
| `BoundedGroups` | `typing.test.ts`: BoundedGroups: limits blocks to four lines and 240 Unicode characters. |
| `EventuallyComplete` | `session.e2e.test.ts`: StableDuringChoice, NextActionUsesChoice: snapshots the mode for each typing action, while rehearsal stays instant. |

### `PlaybackPreference`: choosing the code display

The menu saves and displays the chosen mode independently of the pace. An
in-progress typing action keeps its captured mode; the next action takes the
new choice. TLC checked 36 states. Mutations that write an invalid pace, fail
to save or apply a choice, change an ongoing action, start with the wrong mode,
or change mode while changing pace violate `TypeOK`, `ChoiceSaved`,
`ChoiceApplied`, `StableDuringChoice`, `NextActionUsesChoice`, and
`PaceIndependent`, respectively.

| Property | Test |
|---|---|
| `TypeOK` | TypeScript checks mode values; the panel and extension validate boundary values. |
| `ChoiceSaved` | `extension.test.ts`: ChoiceSaved: reads, stores and applies the playback mode, defaulting invalid values to typing. |
| `ChoiceApplied` | `panel.test.ts`: ChoiceApplied: sends the saved mode and accepts only valid choices; `webview/panel.test.ts`: ChoiceApplied: the code display menu updates mode separately from speed. |
| `StableDuringChoice`, `NextActionUsesChoice` | `session.e2e.test.ts`: StableDuringChoice, NextActionUsesChoice: snapshots the mode for each typing action, while rehearsal stays instant. |
| `PaceIndependent` | `webview/panel.test.ts`: ChoiceSaved, PaceIndependent: keeps code display and speed independent in either message order. |

### `PlaybackAnchor`: cursor and reading target

The final grouped insert puts the cursor at its marker before the editor
awaits. The `reading` phase abstracts that editor await and the following
reading pause. An external edit transforms that live cursor; finishing leaves
it where the edit put it. The follow target is the start of the highlighted
group while reading, then the cursor. The model abstracts the group start as a
fixed offset and does not model visual layout or scroll motion; `Scroll`
models the latter.

Mutations placing an anchor outside the document, applying a stale tail
subtraction, following the cursor while reading, keeping the group target after
reading, and disabling finish violate the corresponding properties below.

| Property | Test |
|---|---|
| `TypeOK` | TypeScript checks code types; cursor bounds are checked by the marker regressions below. |
| `MarkerPreserved` | `session.e2e.test.ts`: MarkerPreserved: user edits during final code reading keep the marker at the transformed position; `player.test.ts`: MarkerPreserved: transforms the final marker when a user edit arrives during editor.edit. |
| `ReadingTargetsGroup`, `FinishedTargetsCursor` | `editor.test.ts`: ReadingTargetsGroup: follows the inserted group during reading, then returns to the cursor. |
| `EventuallyFinished` | `session.e2e.test.ts`: StableDuringChoice, NextActionUsesChoice: snapshots the mode for each typing action, while rehearsal stays instant. |

### `SpeechPage`: current-page audio

This model abstracts one page's audio clip, page replacement, pause, and the
current narration ID. A delivery attempt records its eligibility independently
of whether playback started. TLC checked 28 states. Mutating the initial page
outside its range violates `TypeOK`; accepting a stale ID violates
`PlayingIsCurrent`; refusing an eligible delivery violates `AcceptedStarts`.
The page plays every clip through one shared element that any click or
keypress in the panel unlocks, because a browser that wants a user gesture
unlocks an element, not the page (#39). Before the first gesture the browser
can still refuse an eligible clip: `Audio` takes the browser's answer as a
parameter, a refused clip is held as `blocked`, and `Gesture` starts it on the
next click or keypress (#77). `Interrupt` also stands for the host's 20 second
start timeout, which gives up a clip no gesture starts; it is weakly fair, so
`BlockedResolves` says a refused clip either plays or is given up, never waits
silently forever. TLC checked 28 distinct states.

| Mutation | Result |
|---|---|
| A refused clip is dropped, as before #77 (`blocked' = FALSE`) | `AcceptedStarts` violated |
| `Gesture` leaves the clip silent | `AcceptedStarts` violated |
| `Interrupt` keeps the clip blocked | `BlockedIsCurrent` violated |
| `Pause` keeps the clip blocked | `BlockedIsCurrent` violated |
| No start timeout (fairness on `Interrupt` removed) | `BlockedResolves` violated |
| `Gesture` without its `~paused` guard | passes: `Pause` already clears `blocked`, so the guard is defensive |

| Property | Test |
|---|---|
| `TypeOK` | `speech_audio.test.ts`: rejects invalid page and unit IDs and ignores duplicate audio. |
| `PlayingIsCurrent` | `speech_audio.test.ts`: interrupts synchronously and never resurrects the old unit; ignores stale callbacks when a page or unit changes. |
| `AcceptedStarts` | `speech_audio.test.ts`: plays only the current page and unit, then acknowledges and releases it.; keeps the refused clip and starts it from the next gesture; `panel.test.ts`: unlocks one shared player on a gesture so later narration can start without one. |
| `BlockedIsCurrent` | `speech_audio.test.ts`: BlockedIsCurrent: a gesture after a pause or stop starts nothing. |
| `BlockedResolves` | `panel.test.ts`: BlockedResolves: starts narration the browser refused from the next gesture in the panel; the timeout half is the host's start timeout, covered by `speech_service.test.ts`. |

### `SpeechSetup`: verified model installation

One setup downloads a fixed manifest into staging, verifies it, and replaces a
previous directory using backup and atomic rename. `Dispatch` is the commit
boundary: cancellation before it cannot install new files; a dispatched
rename may finish despite cancellation. Failed rollback leaves the backup in
place. The model abstracts file contents as valid or corrupt and filesystem
operations as atomic successes or failures; it does not model concurrent
setup processes. TLC checked 42 states. Mutations that bypass verification,
install on cancellation, accept corrupt content, lose the backup, or allow a
stuck rollback violate the corresponding safety or progress property.

| Property | Test |
|---|---|
| `InstalledOnlyIfVerified`, `NoBadInstall` | `speech_setup.test.ts`: downloads and verifies all fixed assets before exposing the model directory; rejects a corrupt download and never exposes a partial model. |
| `CancelledDoesNotInstall` | `speech_setup_fs.test.ts`: restores the previous directory if cancelled after backup. |
| `NoLostPrevious` | `speech_setup_fs.test.ts`: restores the previous directory if commit rename fails; preserves the backup directory if rollback also fails. |
| `SetupProgress` | `speech_setup.test.ts`: times out a stalled download and cleans staging. |

The same model applies to the separate GPU FP32 cache. Setup copies the pinned
shared files from the verified CPU cache, verifies those copies and the GPU
model, and commits a separate directory. The CPU q8 model is not changed.
The model's limitation on concurrent setup processes also applies here.

| Property | GPU model test |
|---|---|
| `InstalledOnlyIfVerified` | `speech_gpu_model.test.ts`: InstalledOnlyIfVerified: installs the separate verified GPU model only after explicit setup; `speech_gpu_model.integration.test.ts` verifies real file operations with small test assets. |
| `NoBadInstall` | `speech_gpu_model.test.ts`: NoBadInstall: rejects oversize, truncated, or corrupted bytes and a changed shared asset. |
| `CancelledDoesNotInstall` | `speech_gpu_model.test.ts`: CancelledDoesNotInstall: honors cancellation while copying shared assets and before dispatching replacement. |
| `NoLostPrevious` | `speech_gpu_model.test.ts`: NoLostPrevious: restores an older GPU cache if the atomic replacement fails. |
| `SetupProgress` | `speech_gpu_model.test.ts`: SetupProgress: bounds a stalled model request and cleans staging after timeout. |

### `SpeechSettings`: credentials and account voices

The model captures two immutable catalog request identities and credential
reads. Provider, key and page changes invalidate old results. Explicit refresh
requests and delivered current replies progress under weak fairness. TLC checks
50,968 states. Negative controls detect invalid types, retaining a catalog
across a provider change, accepting an old response after a new request,
accepting a stale key read, changing a canceled prompt's key, disclosing a
secret, refusing request dispatch, and refusing a current response.

| Property | Test |
|---|---|
| `TypeOK` | `panel.test.ts`: NoSecret, TypeOK: forwards only nonsecret key actions and validated cloud selections. |
| `CatalogSafe`, `AcceptedSafe`, `RequestProgress`, `ReplyProgress` | `speech_catalog.test.ts`: CatalogSafe, AcceptedSafe, RequestProgress, ReplyProgress: loads only on request and ignores stale results. |
| `ReadSafe` | `speech_credentials.test.ts`: ReadSafe: waits for replacement and rejects a stale read after an external change. |
| `PromptSafe` | `speech_credentials.test.ts`: PromptSafe: stores only a prompted key and preserves it when a prompt is canceled. |
| `NoSecret` | `extension.test.ts`: NoSecret: uses the native masked prompt and does not put a key in settings or logs. |

### `CloudNarration`: provider, cancellation and gates

The model separates admission, asynchronous key reading, dispatch and response.
It bounds two generations and credential changes; cancellation retains request
ownership until settlement or timeout. The healthy-key configuration makes
forward dispatch observable without assuming the network succeeds. Both
configurations checked 264 and 251 states, respectively. The diagnostic
category abstracts `key` as `no_key` at the reporting boundary; `unknown`
covers unrecognized exceptions. A stale canceled request cannot overwrite a
newer diagnostic. Mutations disabling provider, key, epoch,
single-request, gate, cancellation and retry guards violate the corresponding
safety properties. Disabling admission, dispatch, playback or fair timeout
violates the respective progress property. Clearing approval on timeout and
allowing only the first generation also produce counterexamples.

`Retry` never fires in the checked configurations because `GuardRetry` is true:
automatic retry is forbidden. The negative control disables this guard and
violates `NoRetry`; it does not represent supported production behavior.

| Property | Test |
|---|---|
| `SafeSend` | `speech_elevenlabs.test.ts`: sends only the selected unit to the fixed endpoint using the secret header; never calls the provider when the key or voice is missing. |
| `NoStaleDiagnostic` | `speech_service.test.ts`: does not report a late rejected cloud request after cancellation; replacing stale preservation with `unknown` violates the invariant. |
| `NoStale` | `speech_service.test.ts`: cancels cloud work when credentials change and discards the late response; aborts a canceled request and ignores its late output without queuing a successor. |
| `NoOverlap`, `NoRetry` | `speech_service.test.ts`: aborts a canceled request and ignores its late output without queuing a successor; `speech_elevenlabs.test.ts`: times out a stalled request without retrying. |
| `IndependentGates` | Existing `Narration` gate tests cover the independent reading and approval controls; cloud transport never receives these controls. |
| `NoRestart`, `ReadyPlays` | `speech_service.test.ts`: keeps prepared cloud speech paused until resume and rejects stale page events. |
| `RequestSettles`, `EligibleStarts`, `EligibleDispatch` | `speech_service.test.ts`: releases a hung cloud request at its watchdog without reviving late output; `speech_elevenlabs.e2e.test.ts`: converts a real streamed PCM response to bounded playable WAV. |

### `ProviderChoice`: immediate selection and ordered persistence

The model separates the visible and effective provider from stored settings.
It bounds two choices and serial write completions, including external changes,
write failures, and a key change that clears a previously selected voice. TLC
checked 122 distinct states; `Settlement` assumes fair completion or failure
of each queued write. It abstracts settings values other than provider and
the presence of an old voice.

| Mutation | Breaks |
|---|---|
| initialize an unsupported provider | `TypeOK` |
| retain the old effective provider after selection | `ProviderAligned` |
| let an older success or failure replace the newer choice | `LatestHonored` |
| leave the old voice on key change, or restore it when the reset fails | `KeyClearsVoice` |
| disable both write success and failure | `Settlement` |

The liveness negative control disables deadlock checking to expose the
stuttering counterexample; the normal configuration checks deadlocks.

| Property | Test |
|---|---|
| `TypeOK` | `extension.test.ts`: TypeOK: ignores workspace attempts to select the cloud provider |
| `ProviderAligned` | `extension.test.ts`: ProviderAligned: uses a selected provider immediately while its global setting is still being saved; ProviderAligned: does not cancel a preview on delayed settings echoes or unchanged disabled state |
| `LatestHonored` | `extension.test.ts`: LatestHonored, Settlement: keeps the latest choice when an older global write settles; LatestHonored: does not roll back a newer provider when an older write fails; `integration_legacy_speech_paths.ts`, in VS Code: the later of two saves posted back to back wins (#46) |
| `KeyClearsVoice` | `extension.test.ts`: KeyClearsVoice: clears an old account voice even while a settings save is pending; KeyClearsVoice: keeps the old account voice unavailable when a key-reset write fails; `integration_legacy_speech_paths.ts`, in VS Code: a voice named after the key was removed is not restored (#46) |
| `Settlement` | `extension.test.ts`: Settlement: rolls back the latest provider and reports a failed settings write; LatestHonored, Settlement: keeps the latest choice when an older global write settles |

### `AudioOutput` and `OutputAdmission`: explicit speech routing

`AudioOutput` models two immutable native job IDs, independent physical
process ownership, output and page epochs, pause, cancellation, and the
default route. It does not model PipeWire internals; an isolated PipeWire
server verifies named-target behavior. `OutputAdmission` models overlapping
discoveries, selected-route epochs, per-request reservation and timeout. The
`pw-dump` catalog parser is outside both models; discovery changes do not alter
the modeled admission or process ownership mechanics.

On macOS the main extension also packages the CoreAudio helper (#82). The
model's `helper` records whether that helper verified at startup; when it did,
`Reserve("sys")` plays the system default through it, and the browser default
(`DefaultStart`) is only the fallback when no helper can run. `NativeDefault`
says the browser default is never used while a verified helper exists, and
`HelperRoute` that the system route exists only with one.

On a local Linux desktop the same route plays PipeWire's default sink through
`pw-play` (#84). There the "helper" is PipeWire with a known default sink,
which can appear or disappear while the extension runs, so `HelperChange`
flips `helper` at any time, and the router asks before every line. Each route
is therefore decided when it is admitted: `defaultHelper` and `sysHelper`
record the helper's state at `DefaultStart` and at `Reserve("sys")`, and
`NativeDefault` and `HelperRoute` are stated over those, not over the current
state. A line already playing keeps its route. `GuardAdmit` controls the
`Reserve("sys")` guard. TLC checked 11,640 distinct states, up from 7,242
before #84, and every action fires.

| Mutation | Result |
|---|---|
| `GuardHelper = FALSE`: the browser default runs beside a verified helper | `NativeDefault` violated |
| `Reserve` takes `"sys"` without a verified helper | `HelperRoute` violated |
| `GuardAdmit = FALSE`: `Reserve("sys")` while PipeWire has no default sink (#84) | `HelperRoute` violated |
| `HelperRoute` judged by the current `helper` instead of `sysHelper`, the #82 form (#84) | `HelperRoute` violated: a sink that disappears mid-line would make a correct line look wrong, so the invariant has to be about admission |
| `NativeDefault` judged by the current `helper` instead of `defaultHelper`, the #82 form (#84) | `NativeDefault` violated, for the same reason |
| `HelperChange` moves a playing `"sys"` line to the browser when the sink disappears (#84) | `NoCrossRouteOverlap` violated |
| `GuardTarget = FALSE`: a job opens another route than its target, including `"sys"` | `NoFallback` violated |
| `GuardDefault = FALSE`: the browser default starts while a native job lives | `NoCrossRouteOverlap` violated |

The `GuardDefault`, `GuardRetire`, callback, admission and play-ID negative
controls violate their respective safety invariants. Disabled admission or
completion controls violate enabledness checks. Each pending discovery can
settle through an independently fair timeout.

| Property | Test |
|---|---|
| `NoOverlap`, `NoCrossRouteOverlap` | `speech_native_output.test.ts`: does not allow another route until the stopped process actually closes; `speech_output_router.test.ts`: blocks default synthesis and playback while a canceled native child is retiring; NoOverlap: refuses any route while the helper still owns a job. |
| `NativeDefault` | `speech_output_router.test.ts`: NativeDefault: plays the default through the helper, never the browser, and controls only that job; `speech_system_output.test.ts`: NativeDefault: admits the default, plays, reports start and end, and releases only after the helper stops. |
| `HelperRoute` | `speech_output_router.test.ts`: HelperRoute: falls back to the browser only when the helper is not supported; HelperRoute and NativeDefault: decides each line at admission, so a lost PipeWire default sink sends the next line to the browser; `speech_system_output.test.ts`: creates a driver on a local macOS or Linux desktop only; `extension.test.ts`: plays the default output natively only on a local desktop, never on a remote host. |
| `RetirementCompletes` (system helper) | `speech_system_output.test.ts`: RetirementCompletes: pauses and resumes the job, and a stop keeps ownership until retirement with no late events. |
| `NoRevival`, `NoCanceledEnd` | `speech_native_output.test.ts`: ignores callbacks retained from a retired process; keeps a timed-out child owned until close and ignores its late readiness. |
| `NoFallback` | `speech_output_router.test.ts`: refuses an unavailable saved device before synthesis without falling back; isolated PipeWire target-loss test. |
| `NoStartPaused` | `speech_native_output.test.ts`: freezes the startup deadline while paused; defers a readiness notification observed during pause until resume. |
| `NoUnsafeDispatch`, `NoStalePlay` | `speech_output_router.test.ts`: does not let an older prepare replace a newer reservation; a stale play cannot consume a newer reserved route; `speech_service.test.ts`: blocks provider synthesis when output admission rejects or returns unavailable. |
| `Settles`, `CanCheck`, `CanComplete` | `speech_service.test.ts`: times out admission and ignores its late success without sending text; ignores canceled admission success or rejection after a replacement starts. |

### `OutputPreference`: route selection and persistence

The model checks ordered local setting writes, immediate speech cancellation,
stale discovery results and unavailable saved devices. A restored device starts
discovery without opening Settings. TLC checked 934 states, with two choices
and up to two overlapping requests. Removing startup discovery violates
`StartupDiscovery` in the restored-device initial state.
Negative controls for invalid choices, stale writes or results, missing stop,
disabled selection and missing fairness violate their corresponding properties.

| Property | Test |
|---|---|
| `StartupDiscovery` | `speech_host.test.ts`: refreshes a restored native output at startup without opening Settings; `extension.test.ts`: refreshes a restored native route when the legacy host owns speech. |
| `SelectionStops`, `ChoiceChangeStops` | `speech_output_preferences.test.ts`: stops speech before immediate selection and persists only the choice. |
| `LatestHonored`, `Settlement` | `speech_output_preferences.test.ts`: serializes writes and ignores an older failed write after a newer selection; rolls back a latest failed write and exposes a fixed error. |
| `StaleIgnored`, `EligibleSelect` | `speech_output_preferences.test.ts`: ignores stale discovery and keeps a missing saved output selected; treats a missing native choice as not ready until an available match is discovered. |

### `OutputDiscoveryLifecycle`: discovery and disposal

The model checks one pending capability request and host disposal, with fair
completion. TLC checked five distinct states. Removing the disposal guard
violates `NoLateList`; removing completion fairness violates `Completion`.
An isolated initial state with a non-Boolean model value for `listed` violates
`TypeOK` before transitions; temporal properties are omitted for this control.

| Property | Test |
|---|---|
| `NoLateList`, `Completion` | `speech_host.test.ts`: does not list devices after a restored host is disposed during discovery. |

### `OutputHandoff`: admission and browser retirement

The model distinguishes pending output admission from a worker-ready state.
It models two browser job IDs, two page IDs, delayed acknowledgements, native
playback, same-page disposal and a bounded retirement timeout. Timeout reports
the problem while retaining ownership; it cannot itself make native playback safe.
A same-page close is trusted only because the page stops audio synchronously
before reporting the hide, or because VS Code disposes the page. TLC checked
270 states.

Removing the worker admission gate, either acknowledgement identity check,
the page-close identity check, or
the native handoff guard violates `NoEarlyWorker`, `NoStaleAck`, or
`NoCrossRouteOverlap`, respectively. Disabling timeout violates
`RetirementReported`; disabling worker readiness violates `CanReady`. The
model assumes a fair timeout action but does not assume an acknowledgement.

| Property | Test |
|---|---|
| `NoEarlyWorker`, `CanReady` | `speech_service.test.ts`: does not let a canceled worker readiness bypass a newer pending output admission; starts the already-ready worker exactly once after the newer admission succeeds. |
| `NoStaleAck`, `NoCrossRouteOverlap`, `CanAck`, `CanClose` | `speech_output_router.test.ts`: blocks native admission until the matching browser stop is acknowledged; only a requested stop or closure of the same page retires browser ownership. |
| `RetirementReported` | `speech_service.test.ts`: times out admission and ignores its late success without sending text. |

### `OutputReplacement`: preserve old-page audio ownership

Replacing a view invalidates its page without proving that its browser audio
has stopped. The model keeps the old owner until that same page is actually
disposed, and allows immediate refusal of a native request while the owner
remains. TLC checked 22 states. Releasing on replacement or accepting another
page's disposal independently violates `NoPrematureRelease`.

| Property | Test |
|---|---|
| `NoPrematureRelease`, `NoOverlap` | `panel.test.ts`: retains replaced browser-page ownership until its actual disposal; `extension.test.ts`: routes speech through the output router and invalidates it before a preference change. |
| `CanRefuse` | `speech_output_router.test.ts`: blocks native admission until the matching browser stop is acknowledged. |

### `LocalAudioAdmission` and `LocalAudioOwnership`: local playback bridge

The admission model checks a logical snapshot of the selected output and its
availability before provider dispatch. It does not assert that a device has
been physically opened at that point. If the device disappears after cloud
dispatch, provider work may already have incurred cost; playback must still
fail without falling back to another output.

The ownership model bounds two jobs, two page and connection epochs, and
independent inbound control and outbound acknowledgement sequences. A lost
remote link is detected by a local lease, then the adapter retires the local
player. Parent loss likewise requests retirement; physical ownership remains
until exit. `LeaseStops`, `RetirementStops` and `ParentLossSettles` assume fair
detection and process retirement. Device loss cancels the selected route.

The capability, admission, cloud, target, acknowledgement, control, heartbeat,
parent and natural-end negative controls violate their safety properties.
Disabling lease detection or retirement violates their liveness properties.
The stale-terminal-callback control violates `NoStaleAck`. Requiring the
current page instead of the immutable job page in `Retired` violates
`LeaseStops`, `RetirementStops` and `ParentLossSettles` after page replacement;
the unchanged baseline passes 3,632 states.

| Property | Current test evidence |
|---|---|
| `NoOverlap`, `NoStaleAck` | `audio-native/test/ownership.test.ts`: holds exclusive ownership until the corresponding process has actually retired; snapshots owner identity and rejects leases after retirement or replacement. |
| `NoStaleHeartbeat` | `audio-ui/test/local_connection.test.ts`: accepts ordered messages, rejects stale or malformed frames, and expires locally; refreshes the lease only for a valid ordered heartbeat and stops on disposal. |
| `NoStaleAck`, sequence bounds | `audio-native/test/protocol.test.ts`: handles fragmented and coalesced event frames while rejecting stale sequences. |
| `SafeAdmission`, `NoFallback` | `audio-native/test/adapter.test.ts`: validates and snapshots the selected route before admitting a job. |
| `NoAbandonedReservation` | `speech_service.test.ts`: retires pending admission on cancel, timeout, and disposal before late results; `audio-native/test/adapter.test.ts`: cancels pending admission and ignores late discovery after stop. |
| `NoOverlap`, `NoStaleAck` | `audio-ui/test/companion_output.test.ts`: keeps the route occupied until physical stop completes and ignores stale events; ignores late failures after cancellation and never releases on failed retirement. |
| `RetirementStops`, `NoStaleAck` | `workspace_session.integration.test.ts`: retires the exact old job after a replacement page is ready; `remote_narration.test.ts`: rejects a later job acknowledgement with a reused sequence or job id. |
| Protocol shape | `protocol/test/local_audio.test.ts`: accepts the bounded commands and terminal acknowledgements; rejects wrong versions, unknown commands, extra keys and invalid identities. |

Native process retirement, parent loss, physical device routing, preflight and
remote-host integration require further implementation-specific tests; the
current parser and ownership tests alone do not establish those properties.

### `PanelPlacement`: bounded two-phase panel ownership

Prepare does not register a view. The main extension selects the companion
irrevocably before sending commit; a lost acknowledgement cannot select legacy
fallback. A preparation timeout expires the token and may fall back only
before commit. A delayed prepare cannot register an extra view. TLC checked
16 states and assumes fair timeouts before and after commit. Workspace
session startup follows a positive commit acknowledgement and cannot begin
after closure. Removing the acknowledgement guard violates
`NoSessionBeforeAck`; permitting startup after closure violates
`NoSessionAfterClose`. Activation has a
separate bounded interval before preparation begins and requires a valid readiness
reply; a late activation cannot
start preparation after the selection has settled. `RejectInstalled`
models the new incompatible result without registering either owner;
`StatusTransport` models the version guard that selects this result.

The prepare-registration, late-registration and post-commit fallback negative
controls violate `NoEarlyRegistration`, `NoDuplicateRegistration` and
`NoFallbackAfterCommit`. Disabling the precommit timeout violates
`PreparationSettles`.

`UnsafeFallback` never fires in the checked configuration because
`GuardFallback` is true: falling back to the legacy panel after commit is
forbidden. The negative control disables this guard and violates
`NoFallbackAfterCommit`; it does not represent supported production behavior.

| Property | Test |
|---|---|
| `NoSessionBeforeAck`, `NoSessionAfterClose` | `panel_placement.test.ts`: waits for a successful commit acknowledgement before creating the session; `extension.test.ts`: does not create a workspace session after the window closes during commit. |
| `RejectInstalled` | `panel_placement.test.ts`: rejects an installed incompatible companion before selecting any panel owner; `integration_workspace_incompatible.ts`: a synthetic companion refusal shows the warning without committing or previewing. |
| `NoFallbackAfterCommit`, `CommittedSettles` | `panel_placement.test.ts`: chooses companion irrevocably before committing, including on a lost acknowledgement. |
| `NoEarlyRegistration`, `NoDuplicateRegistration`, `PreparationSettles` | `panel_placement.test.ts`: falls back only before commit and ignores late prepare replies; ignores activation completing after its deadline; uses local legacy only for a failed or invalid preparation before commit. |

### `LocalPanelReplay`: ordered local panel replay

One replay event is abstracted as two chunks. Frames carry a connection epoch,
page epoch, sequence, message ID, index, count, bounded size and payload class.
Invalid, duplicate, out-of-order and oversized frames discard a partial
assembly; stale-page frames are rejected. Disconnect and page change clear it.
The implementation must validate
complete JSON and the visible-event schema before delivery. The payload classes
abstract that validation; this model does not inspect JSON or prove that a
particular field is nonsecret. Production bounds are 16,384 UTF-16 code units
per chunk, 1,024 chunks and 16 MiB per message; oversize must be reported.
Per-event messages preserve replay order without truncating the whole history.

| Property | Code test |
|---|---|
| `NoPartialOrMixed` | `protocol/test/panel_chunks.test.ts`: reassembles a complete ordered update only for the current page; drops mixed chunk counts and invalid assembled JSON or updates. |
| `NoStaleDelivery` | `protocol/test/panel_chunks.test.ts`: never combines fragments across page replacement or a duplicate fragment; `audio-ui/test/local_connection.test.ts`: accepts ordered messages, rejects stale or malformed frames, and expires locally. |
| `BoundedAssembly` | `protocol/test/panel_chunks.test.ts`: discards partial, reordered, stale-page, malformed and oversized updates; `vscode/test/panel_update_sender.integration.test.ts`: reports oversized updates and stops sending after page replacement. |
| `NoAudioOrSecrets` | `protocol/test/panel_update.test.ts`: rejects audio, speech settings, arbitrary commands, and unexpected properties. |
| `DisconnectClears` | `protocol/test/panel_chunks.test.ts`: never combines fragments across page replacement or a duplicate fragment; `protocol/test/command_channel.test.ts`: settles active and queued sends on disposal and ignores a late rejection. Direct disconnect-to-assembler integration coverage remains pending. |
| `CanStart`, `CanComplete`, `CanAbort` | `protocol/test/panel_chunks.test.ts`: reassembles a complete ordered update only for the current page; discards partial, reordered, stale-page, malformed and oversized updates. |
| `PendingSettles`, `EventuallySettled` | `protocol/test/command_channel.test.ts`: closes on a lost acknowledgement without accepting late completion; sends one frame at a time and preserves enqueue order. |
| Replay ordering and oversize | `vscode/test/panel_update_sender.integration.test.ts`: sends replay as ordered bounded per-event updates using the shared sequence; reports an oversized replay event and still sends later complete events. |

TLC checked `LocalPanelReplay.cfg` with 51,992 generated and 138 distinct states;
`LocalPanelReplay_Delivery.cfg` checked three distinct states under fair successful
processing. Weak fairness of disconnect gives eventual abort in the loss model;
the separate success model assumes both valid chunks are eventually processed.
Disabling each of `GuardOrder`, `GuardEpoch`, `GuardBound` and `GuardPayload`
produced a counterexample to `NoPartialOrMixed`, `NoStaleDelivery`,
`BoundedAssembly` and `NoAudioOrSecrets`, respectively. Type and enabledness
checks are sanity checks rather than independently mutation-tested properties.

Native remote integration and real-device Windows playback verification remain
pending; mocked or in-process tests do not establish those results.

### `SentencePipeline`: bounded synthesis and playback

The model separates a requested child from its started acknowledgement and
physical close. One unit holds one captured output route; two unit identities
and three part ordinals exercise stale output and synthesis callbacks. A
single ready or in-flight next part is permitted. Duration units abstract the
aggregate speech bound, and reading and approval remain held. The model does not
represent actual PCM or text; the tests cover source reconstruction and the
final thinking tail.

| Property | Code test |
|---|---|
| `NoExcessLookahead` | `vscode/test/speech_service.test.ts`: SentencePipeline waits for the first started acknowledgement before one lookahead and completes only after the final part. |
| `NoDispatchWhilePaused` | `vscode/test/speech_service.test.ts`: SentencePipeline does not dispatch the next part until its own started acknowledgement after pause and close; SentencePipeline holds first synthesis while paused during model loading. |
| `FixedRoute` | `audio-ui/test/sentence_pipeline.e2e.test.ts`: SentencePipeline composes one captured route through physical closes and completes only the final part. |
| `NoStaleEnd` | `vscode/test/speech_service.test.ts`: SentencePipeline ignores a stale part result without releasing the current inference; `audio-ui/test/companion_output.test.ts`: keeps the unit lease across parts and rejects stale part events. |
| `FinalOnly` | `audio-ui/test/sentence_pipeline.e2e.test.ts`: SentencePipeline composes one captured route through physical closes and completes only the final part. |
| `RetireBeforeRelease` | `audio-native/test/multipart_native_adapter.e2e.test.ts`: suppresses a pending natural end after cancellation and waits for child close. |
| `ReadingApprovalHeld` | `core/test/player.test.ts`: keeps held reading and command approval after speech throw; keeps held reading and command approval after speech reject. |
| `ContiguousParts` | `audio-native/test/multipart_native_adapter.e2e.test.ts`: rejects overlapping, repeated and skipped parts without launching another child. |
| `AggregateBound` | `vscode/test/speech_service.test.ts`: SentencePipeline fails the whole unit if aggregate audio exceeds its bound. |
| `CanStart`, `CanResume`, `HealthyProgress` | `vscode/test/speech_service.test.ts`: SentencePipeline keeps a finished lookahead paused until the current part retires and resumes; `audio-ui/test/sentence_pipeline.e2e.test.ts`: SentencePipeline composes one captured route through physical closes and completes only the final part. |
| `CanceledProgress` | `vscode/test/speech_service.test.ts`: SentencePipeline cancels a delayed lookahead on reply and ignores its result; `audio-native/test/multipart_native_adapter.e2e.test.ts`: suppresses a pending natural end after cancellation and waits for child close. |
| Source slices and final tail | `vscode/test/speech_segments.test.ts`: preserves every source character while grouping excess sentences into a fourth part; `vscode/test/speech_waveform.test.ts`: adds the thinking tail only when explicitly requested for the final part. |

TLC checked 7,545 generated / 2,242 distinct safety states, 223 / 107
healthy states, and 194 / 137 canceled states. Healthy progress assumes fair
inference, start acknowledgement, output close and eventual stable unpause;
canceled progress separately assumes fair pending inference settlement, stop,
physical close and release. A permanently paused healthy unit need not finish.

Disabling pause, route, stale-output, stale-synthesis, final-only, physical
retirement or started-ack guards yields the corresponding invariant violation.
Disabling synthesis, playback or close violates healthy progress. Disabling
resume violates `CanResume`; disabling stop or release violates
`CanceledProgress`. Raising the aggregate bound, releasing reading on admit,
and skipping the first physical part violate their respective invariants.
Disabling the buffer guard alone passes: in this three-part model the started
acknowledgement guard already prevents a third buffered part. Disabling both
buffer and started guards violates `NoExcessLookahead`. `TypeOK` is a sanity
check rather than an independently mutated behavioral property.

### `MultipartAudioLease`: one endpoint across sequential parts

The model bounds two units and three parts, while the implementation allows
at most four parts. It separates an early backend terminal callback from the
physical child-close event. A logical unit retains one captured output route
across part boundaries, including changes to the system default. The next part
requires the previous child's close, a current route check, a contiguous
ordinal and an unpaused start. An unstarted terminal result fails the part.
The healthy configuration assumes fair starts, terminal callbacks and physical
closes; paused units may remain paused in the general configuration.

Negative controls for early lease release, delivery before close, stale
callbacks, route changes, premature whole-unit completion, paused start,
skipped part, stale route check and unstarted success each violate the
corresponding invariant. Disabling either unit or any healthy request, spawn,
start, terminal, close or release action violates `HealthyFinishes`.

| Property | Test |
|---|---|
| `LeaseRetained`, `NoEarlyPartEvent`, `FixedRoute` | `audio-native/test/multipart_native_adapter.e2e.test.ts`: retains one exact route across parts and publishes completion only after child close; `audio-ui/test/sentence_pipeline.e2e.test.ts`: SentencePipeline composes one captured route through physical closes and completes only the final part. |
| `NoStaleCallback`, `NoSkippedPart`, `NoOverlap` | `audio-native/test/multipart_native_adapter.e2e.test.ts`: rejects overlapping, repeated and skipped parts without launching another child; `audio-ui/test/companion_output.test.ts`: keeps the unit lease across parts and rejects stale part events. |
| `NoStartPaused`, `NoStaleCheck` | `audio-native/test/multipart_native_adapter.e2e.test.ts`: rechecks the captured route after a paused boundary and refuses a missing device; rechecks when pause and resume both occur during an in-flight route check. |
| `NoUnstartedSuccess` | `audio-native/test/multipart_native_adapter.e2e.test.ts`: treats end before start as failure and cannot launch another part. |
| `NoEarlyCompletion`, `RetirementCompletes` | `audio-native/test/multipart_native_adapter.e2e.test.ts`: caps a unit at four parts and releases the lease only on explicit stop; suppresses a pending natural end after cancellation and waits for child close. |

Real platform/device playback and a packaged GUI run remain separate acceptance
checks; the composed test uses a fake worker and backend.

### `SpeechTempo`: local listening-rate transforms

The model snapshots a listening rate for a unit, associates each transform
with its unit and part, and keeps one physical worker slot through retirement.
It derives the watchdog from actual transformed samples, checks the aggregate
unit bound, and appends a fixed tail only to the final part. A timed-out caller
can settle before the worker exits; the slot remains occupied. The model
abstracts PCM and does not establish speech quality or pitch preservation.

| Property | Code test |
|---|---|
| `ImmutableRate` | `vscode/test/speech_service.test.ts`: snapshots listening speed, transforms once, and uses transformed duration without a second cloud request. |
| `NoStaleResult`, `OneWorker` | `vscode/test/speech_tempo_client.test.ts`: rejects canceled work immediately but keeps its slot until physical retirement; rejects a wrong-part result without exposing its contents; reports busy from admission until the worker has physically retired. `vscode/test/speech_service.test.ts`: "Admit: refuses a transformed unit while the previous tempo worker is still retiring" (an unchanged-rate unit is admitted). |
| `BoundedOutput`, `AccurateDuration` | `vscode/test/speech_service.test.ts`: fails closed when transformed audio exceeds the complete-unit duration limit; snapshots listening speed, transforms once, and uses transformed duration without a second cloud request. |
| `FixedTail` | `vscode/test/speech_tempo_pcm.test.ts`: round trips exact signed samples and appends one final silent tail; `audio-ui/test/speech_tempo_composed.e2e.test.ts`: transforms two synthetic Kokoro parts in a real worker before local physical playback. |
| `ReadingApprovalHeld` | `core/test/player.test.ts`: keeps held reading and command approval after speech throw; keeps held reading and command approval after speech reject. |
| `HealthyProgress`, `CancelProgress` | `vscode/test/speech_tempo_client.e2e.test.ts`: runs the packaged worker in a real process and returns owned synthetic PCM; `vscode/test/speech_tempo_client.test.ts`: rejects canceled work immediately but keeps its slot until physical retirement. |
| Byte identity and signal tests | `vscode/test/speech_tempo.test.ts`: preserves the original samples exactly at 1.0 without aliasing them; changes duration while preserving a voiced tone at rate %s. |

TLC checked 2,563 generated / 868 distinct safety states, 17 / 17 healthy
states and 15 / 11 cancellation states. Successful progress assumes fair
transform and play; cancellation assumes eventual physical worker exit.
Disabling each snapshot, stale-result, bound, tail, worker-exclusivity,
watchdog-duration or played-rate guard violates its corresponding invariant.
Disabling transform, play or retirement violates the associated progress
property. Restricting retirement to the canceled phase violates cancellation
progress when the caller times out first. Setting reading to released violates
`ReadingApprovalHeld`. `TypeOK` is a sanity check, not independently mutated.
The model's `failed` phase is terminal, so no unit after a failed one is explored
(`CHECK_DEADLOCK FALSE`), a worker failure during `transforming` without a
`Cancel` is covered only by the timeout, and `ReadingApprovalHeld` holds
vacuously because no action touches those variables; the reading and approval
guarantee is tested in the Player. The code bypasses the stretch for inputs under
3,072 samples (one window of the target length), which the model abstracts.
Synthetic tones and the retained offline corpus are not listening-quality
validation; real speech review is still required before claiming validated rates.

### `WarmSynthesisWorker`: bounded local synthesis ownership

The model abstracts the versioned capabilities to valid or invalid and a result
to a correctly sized or oversized one. It tracks a worker epoch, two units with
two parts each, and keeps a worker alive until its matching exit. `Ready` and
`Result` must match their owners; `LateResult` is a response that arrives while
the worker expects none (a previous epoch's result after the slot is ready, a
duplicate part, a result after retirement) and is rejected before buffering.
`Cancel` discards the matching result of a busy inference; `CancelBetween`
ends a unit between parts at once, so its remaining part never starts
(`NoCanceledResume`). No inference starts while paused. A fatal error leaves
the worker unavailable until a new epoch loads (`TruthfulUnavailable`). Buffers
are modeled only as the oversize flag on a result; a stored buffer that must be
cleared on cancel is not modeled, and cancel during loading is not covered (the
load is not interrupted). Single inference is structural: `Dispatch` is enabled
only from `ready`, and no invariant would catch one from another phase.
Automatic replay of canceled or failed text is not modeled; `GuardReplay =
FALSE` models a dispatch that still names the previous unit.

| Invariant | Implementation mapping |
|---|---|
| `TypeOK` | Sanity check of the declared variable ranges. |
| `OneEngine` | `LocalSynthesisClient` (`speech_local_client.ts`) spawns one worker per epoch and refuses a second load, a second inference, and any replacement while the retiring worker has not exited. `SpeechWorkerHost` loads once and answers a concurrent request `busy`. Tests: `speech_local_client.test.ts` "OneEngine: ..." (one load, one inference, slot kept until the actual exit whatever `terminate` reports), `speech_worker_host.test.ts` "OneEngine: ...", `speech_service.test.ts` "OneEngine: refuses a new unit while a retired worker has not exited", `speech_local.e2e.test.ts` "NoCanceledResume: ..." (reuse after a canceled inference). |
| `ValidReady` | The client accepts `ready` only if its capabilities equal the host constants (`LOCAL_CAPABILITIES`) and its epoch is the current one; anything else retires the worker. Tests: `speech_local_client.test.ts` "ValidReady: ...", `speech_local_protocol.test.ts` "accepts ready only with the exact capabilities of the host constants". |
| `CorrectDelivery` | Results and failures are strict schemas; a stale epoch, unit or part, a duplicate after settlement and a result with no inference owed change nothing, and an oversized or malformed result retires the worker before it is buffered. Tests: `speech_local_client.test.ts` "CorrectDelivery: ...", `speech_worker_host.test.ts` "CorrectDelivery: ...", `speech_local_protocol.test.ts` "accepts a bounded result and rejects an oversized, undersized or malformed one before buffering". |
| `NoPausedDispatch` | Pause is the service's: `SpeechService.synthesize` does not dispatch a multi-part unit while paused. Test: `speech_service.test.ts` "NoPausedDispatch: SentencePipeline holds first synthesis while paused during model loading". |
| `NoReplay` | A request is dispatched once with its own unit and part, and a failed or retired unit is never re-sent. Tests: `speech_local_client.test.ts` "NoReplay: a dispatch names exactly the requested unit and part, once", `speech_service.test.ts` "NoReplay: after a failure the next explicit request sends only its own text". |
| `NoCanceledResume` | `cancel()` settles the unit's result at once and the discarded result never resumes it; nothing further is posted. Tests: `speech_local_client.test.ts` "NoCanceledResume: ...", `speech_service.test.ts` "NoCanceledResume: SentencePipeline cancels a delayed lookahead on reply and ignores its result" and "NoCanceledResume: a unit canceled during model loading ...", `speech_local.e2e.test.ts` "NoCanceledResume: a canceled inference keeps the worker owned ...". |
| `TruthfulUnavailable` | A fatal error retires the worker, reports one fixed category to the listener, and refuses work until a new explicit load. Tests: `speech_local_client.test.ts` "TruthfulUnavailable: ...", `speech_service.test.ts` "TruthfulUnavailable: ...", `speech_local.e2e.test.ts` "TruthfulUnavailable: a fatal load error ends the unit ...". |
| `HealthyProgress` | One load serves consecutive units; the independent watchdog bounds a load that never becomes ready. Tests: `speech_local_client.test.ts` "HealthyProgress: ...", `speech_local.e2e.test.ts` "HealthyProgress: two units share one worker and one model load ...". |
| `CancellationProgress` | A canceled inference either returns and is discarded, or the watchdog retires the worker. Test: `speech_local_client.test.ts` "CancellationProgress: retires a canceled inference that never returns ...". |
| `RetirementProgress` | A retired worker returns the slot to cold exactly once, at its exit. Test: `speech_local_client.test.ts` "RetirementProgress: ...". |

Action mapping in the code (comments name the spec and action): `Load`,
`Ready`, `Dispatch`/`NextPart`, `Result`/`DiscardResult`, `LateResult`,
`Cancel`, `Retire` and `Exit` in `speech_local_client.ts`; `Load`, `Retire`
and `Cancel` in `speech_service.ts`. The model forbids any dispatch while
paused; the service holds only multi-part units while paused (a single-part
unit is dispatched and its audio waits), so `NoPausedDispatch` is mapped for
multi-part units only. The synthesis protocol (`speech_local_protocol.ts`) is
transport neutral; the shipped Kokoro engine keeps its Node worker thread.

| Mutation | Breaks |
|---|---|
| `GuardEpoch`, `GuardReady` | `ValidReady` |
| `GuardPart`, `GuardBound`, `GuardLate` | `CorrectDelivery` |
| `GuardExit`, `GuardExitEpoch`, `GuardDiscard` | `OneEngine` |
| `GuardPause` | `NoPausedDispatch` |
| `GuardReplay` | `NoReplay` |
| `GuardCancel` | `NoCanceledResume` |
| `GuardFailed` | `TruthfulUnavailable` |
| `EnableLoad`, `EnableReady`, `EnableDispatch`, `EnableNextPart`, `EnableResult` (healthy config) | `HealthyProgress`, counterexamples of 1, 2, 3, 5 and 4 states |
| `EnableDiscard` (cancellation config) | `CancellationProgress` (372 states) |
| `EnableRetire`, `EnableExit` (watchdog config) | `CancellationProgress` (70 and 114 states) |
| `EnableExit` (retirement config) | `RetirementProgress` |

TLC checked 3,969 generated / 440 distinct safety states, 11 / 11 healthy
states, and 3,969 / 440 states in each cancellation, watchdog and retirement
configuration. Disabling the discard alone violates the discard-fair
`CancellationProgress` while the watchdog configuration still holds, and
disabling the watchdog alone violates the watchdog configuration while the
discard-fair one still holds, so neither fairness assumption hides the other.
`EnableNextPart` is distinct from `EnableDispatch`.
The model does not prove actual audio quality or operating-system process exit.

## Diagnostic fault isolation

`DiagnosticsFaultIsolation` models one synchronous diagnostic attempt at one
of the bridge, controller, and terminal call sites. The observer can be absent,
return normally, or throw. A caught exception must not escape or stop the
surrounding business operation. Weak fairness requires both the attempt and the
completion to occur; it does not model a callback that never returns, asynchronous
rejection, reentrancy, or changes the callback itself makes to shared state.
Call sites must preserve the receiver used by the existing invocation.

| Property | Implementation and test mapping |
|---|---|
| `TypeOK` | Sanity check of the bounded state. |
| `NoEscapedException` | `diagnostic_delivery.test.ts`: "isolates a throwing observer from the operation". Its absent-observer and original-receiver tests cover the other modeled choices; bridge, controller, and terminal delegate to the helper. |
| `BusinessCompletes` | `integration_gap_paths.ts`: `diagnosticObserverFailure` starts, pauses, resumes, and ends a real controller session with a throwing observer. Equivalent bridge and terminal integration cases are not yet mapped. |

TLC checked 19 generated and 19 distinct states with `GuardCatch` and
`EnableAttempt` true. Setting `GuardCatch` false violates `NoEscapedException`
on a throwing observer; setting `EnableAttempt` false violates
`BusinessCompletes` with a stuttering behavior. Both mutations were checked
independently and discarded.

## Speech platform evidence

`SpeechPlatformEvidence` checks one local host. Linux x64 is supported on
positive evidence of the running process's GNU libc; a missing or failed
process report can use independently verified process mappings, and unknown
evidence fails closed. macOS on x64 or arm64 is supported on its platform and
architecture alone, since it has one system C runtime (#39). Any other
operating system, or Linux or macOS on another architecture, is rejected
before any probe. Desktop and remote-host placement remain separate caller
checks. The model abstracts the bounded probe, groups hosts into four classes
rather than naming each `<platform>-<arch>`, and does not prove the operating
system's mappings are truthful.

| Property | Implementation and test mapping |
|---|---|
| `TypeOK` | Sanity check of the bounded state. |
| `PositiveEvidence` | `speech_platform.test.ts`: positive report or mappings are required; musl and missing evidence are rejected; SpeechPlatformEvidence PositiveEvidence: rejects Windows, or macOS on another architecture, before probing. |
| `RecognizesEvidence` | `speech_platform.test.ts`: accepts a valid runtime report and current-process GNU mappings, including versioned and Snap paths; SpeechPlatformEvidence RecognizesEvidence: accepts darwin arm64 and darwin x64 without libc probes. |
| `CheckCompletes` | `speech_platform.test.ts`: the fixed process-maps reader rejects oversized or unreadable input and closes its descriptor. |

TLC checked 37 generated and 37 distinct states, no violation. Disabling
`GuardEvidence` violates `PositiveEvidence`; disabling `EnableCheck` violates
`CheckCompletes`; disabling `EnablePositive` violates `RecognizesEvidence`;
disabling `GuardArch`, so any architecture is accepted, violates
`PositiveEvidence`; disabling `EnableNonLinux`, the Linux-only check this
replaced, violates `RecognizesEvidence`. All five mutations were discarded.

### `RecoveryBatchIds`: saved batch allocation

`RecoveryBatchIds` models allocation within a session, a fresh session, and a
reload from the latest successfully saved snapshot. A fresh session starts at
one; a resumed session retains its saved counter. It assumes each allocation is
saved before reload; the actual workspace storage is asynchronous and a crash
before that save can reuse an ID.
Legacy snapshots cannot recover IDs already reported and removed from the saved
results. The model does not cover command IDs or queue replay.

| Property | Test |
|---|---|
| `TypeOK` | The saved counter and restored batch IDs are checked by the recovery tests below; the model also checks their types. |
| `Unique` | `controller.test.ts`: RecoveryBatchIds Unique: keeps the next batch ID after saving and reviving a session; derives a safe counter from legacy or invalid saved value. `session.e2e.test.ts`: RecoveryBatchIds Unique: keeps IDs distinct when a saved session is resumed. |
| `FreshStartsAtOne` | `controller.test.ts`: RecoveryBatchIds FreshStartsAtOne: starts numbering again after ending a session. |
| `Progress` | `session.e2e.test.ts`: RecoveryBatchIds Unique: keeps IDs distinct when a saved session is resumed. |

TLC checked `RecoveryBatchIds.cfg` with `MaxId = 3`: 29 generated and 16
distinct states, no violation. Retaining the prior counter in `Fresh` violates
`FreshStartsAtOne`. Setting `PreserveCounter` to `FALSE` makes
`Unique` fail after one allocation and a reload. Initializing `nextId` to zero
violates `TypeOK`. Disabling `Allocate` while
retaining its fairness condition makes `Progress` fail.

## Model status

`ModelStatus` abstracts one check of an installed or missing model. A check
reports verified only for a verified installation. The real implementation
reports the result of a check, not a continuously watched guarantee.

| Property | Code test |
|---|---|
| `TypeOK` | `reports the pinned source, local path and verification result` |
| `VerifiedIsInstalled` | `reports the pinned source, local path and verification result` |
| `StatusProgress` | `reports the pinned source, local path and verification result` |

Mutations checked with TLC: an invalid display state violates `TypeOK`;
reporting verified for a missing model violates `VerifiedIsInstalled`; removing
fairness for the check violates `StatusProgress`.

## Deferred messages

`DeferredMessage` checks one deferred reply, the current action and an urgent
stop. The real queue can hold multiple replies; urgent input flushes them in
order. `Resume` also treats a deferred reply as a waiting message when stored.
The Settings reply preference selects whether the existing deferred action is
requested; it does not change the modeled queue or urgent-stop semantics.

| Property | Code test |
|---|---|
| `TypeOK` | `SendDeferred and FinishAction: holds multiple replies until the action boundary` |
| `NoEarlyDelivery` | `NoEarlyDelivery: defers a reply until the current action finishes, then discards later actions` |
| `UrgentIsImmediate` | `Urgent: a stop interrupts immediately and delivers a previously queued reply first` |
| `PendingProgress` | `SendDeferred and FinishAction: holds multiple replies until the action boundary` |

TLC mutations changed the action state outside its domain, delivered a reply
early, let urgent input avoid interruption, and removed action fairness; each
violated its corresponding property.

### `SpeechReminder`: reminders for spoken narration

`SpeechReminder.tla` counts accepted unspoken batches up to three, resets on
a batch with a spoken `say` (its `selected`; since #41 any `say` that is
spoken by default, so the model is unchanged), and gates the next reminder on
current readiness. A report
that emits a reminder resets the count. Readiness abstracts the local checks
and cannot guarantee future synthesis or playback. All three actions fired in
the TLC coverage run. The real controller and counter also meet in the core
session test `reminds after three accepted unspoken batches only while speech
is ready`.

| Invariant | Test |
| --- | --- |
| `TypeOK` | `speech_reminder.test.ts`: count and report cases |
| `ReminderOnlyReady` | `speech_reminder.test.ts`: reminds after three unspoken batches only when ready, then counts again |
| `SelectedResets` | `speech_reminder.test.ts`: resets its count on a selected narration |
| `DueIsReminded` | `speech_reminder.test.ts`: reminds after three unspoken batches only when ready, then counts again |

With the readiness gate removed, `ReminderOnlyReady` fails. With the selected
reset removed, `SelectedResets` fails. With reminder emission disabled,
`DueIsReminded` fails. `TypeOK` bounds the counter and state types; removing
its counter cap permits the count to leave its declared range.

| Configuration | Bounds | Distinct states | Result |
| --- | --- | ---: | --- |
| `SpeechReminder.cfg` | Three batches; Boolean readiness and selection | 11 | Pass |

### `StartDirectory`: choosing the session directory

`server.ts` validates an explicit directory and selects only it; omitted
directories use client roots and the relay directory. The model abstracts
filesystem and editor matching as booleans. TLC checks 32 distinct states with
`StartDirectory.cfg`. `Strict = FALSE` produces an `Authoritative` violation.
Changing a rejected selection to `fallback` violates
`RejectedWithoutSelection`. That invariant abstracts selection; the unit tests
also check that discovery, guide reads, and editor calls never happen on invalid
input. Setting a successful request phase to `unknown` violates `TypeOK`;
this checks the model's bounded state types rather than a production enum.

| Property | Test |
| --- | --- |
| `TypeOK` | `server.test.ts`: rejects missing and non-directory explicit paths before contacting the editor; `relay.test.ts`: works in the folder the agent gives, when the harness started the relay somewhere else (these exercise valid and invalid inputs, not a production phase enum) |
| `Authoritative` | `relay.test.ts`: uses the harness root when no working directory is given, and rejects an unmatched explicit directory; `server.test.ts`: rejects missing and non-directory explicit paths before contacting the editor |
| `RejectedWithoutSelection` | `server.test.ts`: rejects missing and non-directory explicit paths before contacting the editor |
| `Finishes` | `relay.test.ts`: uses the harness root when no working directory is given, and rejects an unmatched explicit directory |

### `RuntimeIdentity`: matching the relay and editor

The current editor always advertises its runtime identity; older discovery
records may omit it. A new relay forwards a start only when the selected editor
advertises the same
version and shipped relay hash. Missing identity is a mismatch. The model
abstracts the comparison into `Match`; it does not model the older relays that
lack this guard or prove the authenticity of the discovery file.

| Configuration | Result | Distinct states |
| --- | --- | ---: |
| `RuntimeIdentity.cfg` | holds, matching | 2 |
| `RuntimeIdentity_Mismatch.cfg` | holds, mismatching | 2 |

| Property | Test |
| --- | --- |
| `TypeOK` | No direct code test: the model phase is an abstraction, not a runtime value. |
| `Safe` | `link.test.ts` and `relay.test.ts`: RuntimeIdentity Safe; `integration_runtime_identity.ts`: refuses missing, different-version and different-digest identities before connecting |
| `Settles` | `link.test.ts`: RuntimeIdentity Settles; `relay.test.ts`: RuntimeIdentity Settles |

Changing the initial phase to an unrecognized value violates `TypeOK`; changing
the mismatch result to `forwarded` violates `Safe`; disabling `Start` violates
`Settles`. The terminal states intentionally have no outgoing action,
so both configurations disable deadlock checking.

### `ReadyCount` and `StatusTransport`: status and version boundary

`ReadyCount` bounds accepted, unstarted batches to two. `shown` abstracts the
latest emitted panel state, not instantaneous delivery to the DOM. `Start`
is weakly fair after `Drain` stops new admissions. TLC found 8 distinct states.
`Accurate` is tested by `controller.test.ts`: reports accepted queued batches
and clears the count when playback starts; panel replay and reset are tested
in `panel.test.ts`. Mutations of count update, close reset, type bounds and
start fairness violated `Accurate`, `ClosedEmpty`, `TypeOK` and `Drains`,
respectively.

`StatusTransport` models the new endpoints' prepare/attach gate, not an old
binary's fallback choice. `StatusTransport.cfg` checks workspace/companion
versions 2/1; `StatusTransport_Matching.cfg` checks 2/2 and exercises `Send`.
An additional 1/2 mismatch was checked separately.

| Configuration | Versions | Distinct states |
| --- | --- | ---: |
| `StatusTransport.cfg` | 2/1 | 2 |
| `StatusTransport_Matching.cfg` | 2/2 | 3 |

Bypassing the gate violates `NoMixedAttach` and
`NoMixedDelivery`; separately suppressing the warning or matching delivery
violates `MixedWarns` or `MatchingDelivers`. `panel_placement.test.ts`,
`attachment_gate.test.ts`, `extension.test.ts` and `local_audio.test.ts`
exercise rejection and guidance. An already-installed old workspace may still
select legacy fallback, which the new companion cannot prevent.

### `CoreMlCompute`: GPU speech on Core ML

On macOS arm64 the GPU path is ONNX Runtime's Core ML execution provider, with
the shipped q8 model and no extra download (#42). The model covers whether the
host has that path (`capable`), whether the model is installed, whether Core ML
can create the session (`loads`), the three modes, and what the panel offers.
A saved GPU setting can exist on any host. `Check` is the light check before a
launch: Auto falls back to the CPU there, and only there; a Core ML session
that then fails to load fails the unit in either mode. TLC checked 82 distinct
states, with `GpuSpeaks` and `Settles`. `NoGpuWithoutPath` is implied by
`GpuOnlyIfLoaded`, which catches its mutation first. Speed is not modelled:
measured on one Apple silicon Mac, a Core ML load took 13 to 34 seconds and a
sentence of 6.5 seconds of audio took 3.2 to 4.9 seconds, against 3.2 to 3.5 on
the CPU.

| Mutation | Result |
|---|---|
| Explicit GPU falls back to the CPU when Core ML fails | `ExplicitNoFallback` violated |
| GPU reported without a Core ML session | `GpuOnlyIfLoaded` violated |
| GPU offered on every host | `OfferedOnlyWhereCapable` violated |
| GPU selected without checking the offer | `NoGpuSelectWithoutPath` violated |
| Core ML run on a host without the path | `GpuOnlyIfLoaded` violated |
| The check never settles without a model | `Settles` violated |
| The GPU check always fails, as code that does nothing would | `GpuSpeaks` violated |

| Property | Test |
|---|---|
| `TypeOK`, `GpuOnlyIfLoaded` | `speech_coreml.test.ts`: GpuOnlyIfLoaded: reports ready only after a CoreML session loads, and waits for the worker to exit; a CoreML session that fails to load fails the check; `speech_engine.test.ts`: CoreMlCompute Load: loads the q8 model on the CoreML execution provider, never the CPU path. |
| `ExplicitNoFallback`, `NoGpuWithoutPath` | `speech_service.test.ts`: refuses explicit GPU when GPU collaborators are missing; CoreMlCompute Check and Load: launches a CoreML worker only after the runtime and model check. |
| `OfferedOnlyWhereCapable`, `NoGpuSelectWithoutPath` | `speech_coreml.test.ts`: OfferedOnlyWhereCapable: offers no GPU and checks nothing without the CoreML path; `panel.test.ts`: OfferedOnlyWhereCapable: tells the page GPU is possible only on a supported host with a GPU path; `webview/panel.test.ts`: OfferedOnlyWhereCapable: disables GPU and Auto and explains why on a host without a GPU path. |
| `GpuSpeaks` | `speech_worker.test.ts`: CoreMlCompute Load: loads on CoreML only when the host asked for it; `extension.test.ts`: CoreMlCompute: wires the host GPU offer, the CoreML worker and the explicit check into speech. Real Core ML synthesis was run once by hand on an Apple silicon Mac; no automated test runs Core ML. |
| `Settles` | `speech_coreml.test.ts`: Settles: reports a missing model, and an abort before or during the load; `speech_local_client.test.ts`: HealthyProgress: bounds a slow CoreML load by its own load timeout. |

### `GpuSetup`: preflight, download and hardware proof

The model requires trusted runtime and physical-device preflight before the
optional GPU download, then bounds the negative control, tiny graph and model
proofs. `GpuSetup.cfg` checked 74 distinct states, including `CheckSettles`.
The preflight-bypass mutation violates `PreflightBeforeDownload`; mutations
bypassing the negative control, allowing explicit GPU CPU fallback, or starting
a successor before retirement violate their respective safety properties.
The symlink-safe gate mutation violates `TrustedSymlinkChain`. Negative-control
and positive-driver mapping bypasses violate `DriverIdentity`. Physical GPU
availability and real audio quality are not established by TLC. The model
abstracts execution-provider placement: model inference retains GPU admission
and proofs while one known operation runs on CPU. Strict probes still forbid
CPU fallback; `speech_gpu_options.test.ts` checks both policies.

The settings presentation keeps the requested and reported backend distinct,
shows setup outcomes outside a collapsed technical-details disclosure, and keeps
model provenance inside it. These presentation changes do not alter the model
or its transitions; `panel.test.ts` checks the visible state mapping.

| Property | Test |
|---|---|
| `TypeOK`, `GpuVerified` | `speech_gpu_check.test.ts`: GpuVerified: requires trust, physical device, negative control, tiny graph and model; `speech_gpu_admission.integration.test.ts`: runs verified setup then dispatches a GPU unit through a controlled worker port. |
| `PreflightBeforeDownload` | `speech_gpu_setup_flow.test.ts`: PreflightBeforeDownload: does not download when preflight or the CPU model is unavailable; `speech_gpu_model.integration.test.ts`: runs physical preflight before downloading a model and reports byte progress through the real setup flow. |
| `TrustedSymlinkChain` | `speech_gpu_trust.test.ts`: TrustedSymlinkChain: rejects a user-owned intermediate symlink even when the final target is trusted. |
| `DriverIdentity` | `speech_gpu_driver_identity.test.ts`: DriverIdentity: accepts only the exact mapped Radeon device, inode and hash; DriverIdentity: requires no Radeon driver mapping in the invalid-ICD control. |
| `ExplicitNoFallback` | `speech_service.test.ts`: ExplicitNoFallback: refuses explicit GPU before starting a CPU worker. |
| `NoSuccessorBeforeReap`, `CheckSettles` | `speech_gpu_process.test.ts`: NoSuccessorBeforeReap, CheckSettles: kills a timed-out child and waits for its exit before settling; `speech_service.test.ts`: NoSuccessorBeforeReap: keeps a canceled GPU proof slot until the proof settles. |

### `GpuMappedIcd`: mapped driver classification

`GpuMappedIcd.cfg` checks 67 distinct states with three mapped objects. `Safe`
and `NegativeSafe` require classification independent of filenames, with no
extra or unreadable ICD in either positive or negative checks. Disabling the
classification guard violates `NegativeSafe`. The `NeverAdmit` and
`NeverAcceptNegative` properties are intentionally false reachability witnesses
for valid positive and negative paths. The model does not establish physical
AMD compatibility or sandbox native code.

| Property | Test |
|---|---|
| `Safe`, `NegativeSafe` | `speech_gpu_driver_identity.test.ts`: Safe, NegativeSafe: rejects a renamed extra ICD instead of relying on its filename; `speech_gpu_elf.integration.test.ts`: Safe, NegativeSafe: rejects a valid ICD mapped under an unrelated filename. |

### `GpuSynthesisProcess`: isolated GPU ownership

The model bounds two process epochs and requires a fresh verified capability
before each spawn. The child verifies its mapped Vulkan loader before ready and
before each audio result. Cancellation retires the process; no successor or
fallback starts before its close event. It models both graceful disposal and
forced termination. `audio` abstracts a result already handed off, so
prohibiting fallback after it is more conservative than the runtime rule
against replay after playback starts. `RetirementProgress` assumes the
operating system eventually reports exit after forced termination; the
implementation holds the slot if it does not.

TLC checked 132 distinct states. Removing any of the proof, reaping, epoch,
loader or playback guards violates `Safe`; disabling forced termination
violates `RetirementProgress`. The unit tests for `speech_gpu_client.ts`,
`speech_gpu_transport.ts`, `speech_gpu_worker_runtime.ts`, and
`speech_gpu_verified_engine.ts` exercise the concrete boundary. The separate
`speech_gpu_process.e2e.test.ts` starts a real synthetic child, tests warm reuse,
and verifies cancellation retains ownership until forced termination and close.
The model does not establish actual GPU hardware availability or audio quality.
The IPC wire encoding changes without changing the modeled ownership, proof,
or retirement behavior. GPU IPC codec tests cover bounded byte round trips and
rejection of malformed messages.

### `GpuProcessSlot`: shared GPU child ownership

The shared slot abstracts inference, proof and physical-device checks as one
process owner. Contending work receives a retryable busy result immediately. A
result does not free the slot; only the child's close event does. TLC checked
five states and an early-release mutation violates `Safe`. `BusyResponds`
models a prompt refusal; `Reaped` assumes the operating system eventually
reports a child close. Unit and integration tests for `speech_gpu_slot.ts`,
`speech_gpu_client.ts`, and `speech_gpu_proof_runner.ts` exercise the in-
process lease and reaping boundary. The model does not coordinate separate
extension-host processes. `Result` never fires in the checked configuration
because `GuardClose` is true; it exists only to model the early-release mutation.

### `VoiceIndicator`: truthful toolbar readiness

`VoiceIndicator.tla` models an atomic projection of enablement, transport,
provider prerequisites, worker lifecycle and a recorded failure. The
prerequisites abstract the
provider-specific runtime, route, model, key, voice and GPU checks; their
concrete mapping is tested separately. The model does not prove audibility,
cloud credit availability, or hardware execution. In that mapping the panel
page, the default output, counts as an available route, since transport
already says whether it is up; only a native device waits for discovery (#39).
The model is unchanged. Local readiness requires a ready
worker, while loading takes precedence over unknown prerequisites. Weak fairness
makes the
observation step eventually update the view.

| Property | Test |
|---|---|
| `TypeOK`, `Accurate` | `voice_indicator.test.ts`: maps each supported state and unknown evidence. |
| `ReadyRequiresEvidence` | `voice_indicator.test.ts`: requires known provider, route, GPU and worker evidence before ready. |
| `OffWhenDisabled` | `voice_indicator.test.ts`: reports off when speech is disabled. |
| `EventuallyObserved` | `webview/panel.test.ts`: updates voice readiness without opening settings and opens speech controls. |

Mutations producing an invalid type, retaining the old indicator, accepting
unknown prerequisites as ready, showing checking when disabled, or never
recording observation each produced a counterexample for its named property.
Removing the local worker-ready guard violates `ReadyRequiresEvidence`.

| Config | Bounds | Distinct states | Result |
|---|---|---|---|
| `VoiceIndicator.cfg` | Enablement, transport, provider, four worker states, three prerequisite states and failure | 193 | Pass |

### `SpeechBackendHandoff`: switching local workers

The bounded model checks the old worker's retirement and exit, a waiting
request and cancellation. It does not model admitting a replacement while the
old worker retires; `HandoffCurrent: cancellation replaces the waiting request
without starting the old one` tests that implementation behavior.
TLC checked 8 distinct states. Disabling each of `GuardReap`, `GuardCurrent`,
and `GuardPlanned` separately violates `Safety`, respectively by overlapping
workers, continuing stale work, or failing a planned switch. Setting the initial
request identity to 3 violates `TypeOK`, whose range is 1 through 2.

| Property | Implementation test |
| --- | --- |
| `TypeOK` | TypeScript types and `HandoffCurrent: stale CPU callbacks cannot change an active GPU request` |
| `Safety` | `HandoffAfterReap: switches a warm CPU worker to GPU for the next utterance`; `HandoffCurrent: cancellation replaces the waiting request without starting the old one` |
| `Progress` | `HandoffAfterReap: switches a warm CPU worker to GPU for the next utterance`; `HandoffCurrent: a worker that never exits times out without starting a successor` |

The progress property assumes fair exit and continuation; the code additionally
bounds an exit that never arrives with its startup timeout.

### `GpuProofAbort`: aborting physical proof processes

The model represents four sequential physical processes: enumeration, negative
control, tiny graph, and model proof. An abort requests a kill of the live child;
settlement and the next spawn wait for close. Capability issuance requires an
unaborted completed proof. It abstracts filesystem cleanup and the operating
system's kill implementation. Progress assumes a live child eventually closes
and enabled actions run fairly. A child that cannot be reaped retains the slot
indefinitely; the implementation does not manufacture a close event.

| Property | Implementation test |
| --- | --- |
| `TypeOK` | TypeScript types and `NoLateSpawn: abort after %s prevents all later proof stages` |
| `AbortKills` | `SettledReaped: abort kills proof and cleans up only after close` |
| `NoOverlap` | `rejects replacement proof work until the previous child closes` |
| `NoLateSpawn` | `NoLateSpawn: abort after %s prevents all later proof stages` |
| `SettledReaped` | `SettledReaped: abort kills and waits for close before rejecting`; `SettledReaped: aborts and reaps a real proof child before permitting a successor` |
| `NoAbortedCapability` | `NoAbortedCapability: refuses to issue when aborted before or after proof` |
| `Progress` | `SettledReaped: aborts and reaps a real proof child before permitting a successor` |

TLC negative controls independently allowed overlap, settlement before close,
late spawning, and capability issuance after abort; omitted the kill request;
set the initial stage outside its type; and removed fairness. Each violated its
corresponding property. The late-spawn control checks `NoLateSpawn` before
`AbortKills` because it also violates the latter.

| Config | Bounds | Distinct states | Result |
| --- | --- | --- | --- |
| `GpuProofAbort.cfg` | Four stages and Boolean lifecycle flags | 32 | Pass |

### `SpeechLifecycle`: shared speech resource ownership

`SpeechLifecycle.cfg` checks two successive request identities, three desired
modes, and one physical slot. A resource token pairs the originating request
with proof or worker; it is separate from the current request. Selecting a mode
or replacing a pending request retires the old slot while the latest request
waits. Proof results, including failure, retain the slot until retirement,
kill and actual reap. After reap the latest request progresses automatically;
Auto may choose CPU after failed GPU proof, while explicit GPU reports typed
unavailability. Loading can succeed or fail, and disposal completes only after
reap. `actual = "unavailable"` abstracts a typed failure, not its reason.

TLC checked 482 generated and 258 distinct states with `MaxRequest = 2`;
all invariants and temporal properties passed. `WF_vars(Drive)` assumes the
manager and external operations eventually take an enabled internal step; in
particular a canceled discovery settles and the operating system eventually
reports close after kill. It makes no claim when these dependencies hang. The
bounded identity space explores at most two requests, not twenty cycles. The
model abstracts explicit setup-check arbitration, unit-level inference and
playback, observer reentrancy, proof stages, and worker crashes after readiness;
those require concrete tests. It treats retirement uniformly as kill then reap,
including a normally finished proof; actual implementations may observe close
without needing a kill. A fresh host/restart is outside this model: tests must
construct a new manager from preferences only and verify fresh proof and no
restored worker, capability, pending check, or reservation. It does not prove
hardware, audio, or cross-process coordination. The model also abstracts the
health projection: selecting a different mode resets stale GPU failure to an
idle, unchecked state while retaining retiring ownership until reap. A setup
check refused as busy during an active unit returns busy without changing the
last verified GPU health. These obligations are checked by `clears stale GPU
failure when switching GPU to CPU and back` and `keeps verified GPU health when
a setup check is refused during speech` in `speech_lifecycle.test.ts`.
Worker construction or load errors retain their sanitized category through
`preserves the sanitized module category when worker startup throws` in
`speech_lifecycle.test.ts`; the physical-slot model abstracts failure details.

| Property | Implementation and test mapping |
| --- | --- |
| `TypeOK` | `speech_lifecycle.test.ts`: `TypeOK: starts with a valid cold CPU snapshot`. The bounded model state is an abstraction rather than a production enum. |
| `Safety` | `speech_lifecycle.test.ts`: `Safety: waits for the old worker to exit before switching backends` and `Safety: never starts CPU after an explicit GPU proof failure`. |
| `LatestProgress` | `speech_lifecycle.test.ts`: `LatestProgress: cancels a stale proof and waits for its reaping before starting CPU`. |
| `DisposeProgress` | `speech_lifecycle.test.ts`: `DisposeProgress: aborts a pending proof on shutdown and waits for the proof to be reaped`. |

Independent temporary configurations setting `GuardReap`, `GuardCurrent`, or
`GuardExplicit` to `FALSE` each violate `Safety`. Setting `EnableProgress` to
`FALSE` violates `LatestProgress`; the fairness assumption does not force a
disabled action. `StaleCallback` never fires with `GuardCurrent = TRUE` in the
normal configuration. It models a stale completion only when the negative
control disables that guard, which violates `Safety`. These negative controls
were discarded. The model abstracts unit ownership, proof arbitration and
restart; their concrete tests provide additional coverage.

### `SpeechWarmup`: pre-session local speech warmup

The model tracks enablement, local route, CPU/GPU mode, bounded generation,
worker ownership and asynchronous ready/failure events. A configuration change
invalidates the visible result immediately; stale workers retain the single slot
until reaped. A result applies only to the current eligible loading worker.
The model allows old events to arrive after a change and allows successive
configuration changes before worker retirement. It abstracts the worker's
backend internals, startup timeout, actual audio, and process-level cleanup.
`DemandProgress` assumes weak fairness of starting and of reaping each stale
worker: an eligible idle demand eventually starts or becomes ineligible. The
model does not guarantee progress if a child never reaps, and it does not
assume worker completion. Retry after loading or unexpected worker failure
keeps the configuration generation and gives the worker a new attempt identity.
The model bounds retries to one per configuration generation.

| Property | Implementation test |
| --- | --- |
| `TypeOK` | `speech_lifecycle.test.ts`: `TypeOK: starts with a valid cold CPU snapshot`. |
| `SingleWorker` | `speech_lifecycle.test.ts`: `WarmupSafe: re-enabling waits for the retired worker before starting a replacement`. |
| `CurrentResult`, `ReadyHasWorker` | `speech_lifecycle.test.ts`: `WarmupSafe: disabling during loading retires the worker and blocks stale readiness`; `speech_warmup.integration.test.ts`: `projects pre-session warmup through the service and lifecycle into the voice indicator`. |
| `DemandProgress` | `speech_lifecycle.test.ts`: `retries a failed warmup when setup completes` and `retries after an unexpected warm worker failure`. |

TLC checked 422,427 generated and 53,112 distinct states with three
configuration changes and one retry per generation. Deadlock checking is
disabled because the generation bound can stop configuration changes.
Independently setting `GuardCurrent` to false violates
`CurrentResult`, setting `GuardSingle` to false violates `SingleWorker`, and
setting `EnableStart` to false violates `DemandProgress`; these temporary
negative-control configurations were discarded.

### `OpenRouterSpeech`: account-scoped speech selection

The finite model represents one account catalog request, optional ZDR
narrowing, selection and synthesis admission. It abstracts network transport,
individual model identities and voices (bounded by the shared protocol
schemas), PCM parsing, and audio output. The policy can
change before selection; after it stops changing, `StableProgress` requires
that the request reach synthesis admission or account failure. Weak fairness
of `Resolve`, `Narrow`, `Select`, and `Synthesize` assumes each continuously
enabled step eventually occurs. It does not guarantee provider responses,
playback, or progress when the setting changes forever.

`OpenRouterSpeech.cfg` explores successful authentication: TLC checked 17
generated and 12 distinct states. `OpenRouterSpeech_Failure.cfg` explores
account failure: 7 generated and 4 distinct states. Both pass all safety and
temporal properties. Terminal states are permitted.

| Property | Implementation test |
| --- | --- |
| `TypeOK` | `openrouter.test.ts`: bounded catalog metadata, arbitrary bounded model and voice IDs, and rejection of MP3 requests until a decoder exists. |
| `AccountOnly` | `speech_openrouter.test.ts`: `AccountOnly uses the authenticated account catalog and maps advertised voices`; `includes arbitrary advertised models and voices while preserving the account intersection`; `AccountOnly never falls back when authentication fails`. |
| `ZdrSelection` | `speech_openrouter.test.ts`: `ZdrSelection intersects the authenticated catalog with the public ZDR catalog`. |
| `PolicySampled` | `speech_openrouter.test.ts`: `PolicySampled sends the selected request and converts documented PCM`; `omits provider policy when ZDR is off`. |
| `StableProgress` | `speech_openrouter.test.ts`: `AccountOnly uses the authenticated account catalog and maps advertised voices`; `PolicySampled sends the selected request and converts documented PCM`; `AccountOnly never falls back when authentication fails`. These tests check the corresponding outcomes, not fairness. |

An invalid initial result violates `TypeOK`. Independent temporary mutations
disabling authentication, allowing selection
without narrowing, and inverting the sampled policy violated `AccountOnly`,
`ZdrSelection`, and `PolicySampled`, respectively. Disabling each of
`Authenticate`, `Select`, and `Synthesize` separately violated
`StableProgress`. The mutations were discarded.

### `OpenRouterCatalog`: remembered pair eligibility

The model tracks two request generations, a remembered model and voice, the
latest authoritative eligibility, and whether one admission has occurred.
Unknown eligibility permits a restored selection before a catalog request;
a current successful response can allow or deny it. Refreshing the same
identity retains previous evidence, including a denial, while a response is
pending or fails. Changing identity invalidates that evidence. An old response
may arrive after invalidation or replacement, but cannot update eligibility.
An admission records the evidence at that instant: the model does not revoke a
request already admitted before a later denial. It abstracts request payloads,
provider transport, user interface details, cancellation, and physical playback.
Pricing labels on model choices are optional display data; they do not change
model/voice eligibility or a transition in `OpenRouterCatalog.tla`.

TLC checked `OpenRouterCatalog.cfg` with two generations: 71 generated and 36
distinct states. The safety invariants and temporal properties passed. Terminal
states are permitted. `StableProgress` assumes weak fairness of admission: if eligibility
eventually remains non-denied, an enabled admission eventually happens.
`CatalogProgress` separately checks that admission is enabled. Neither property
guarantees progress when the caller does not make or sustain a request.

| Property | Implementation test |
| --- | --- |
| `TypeOK` | `speech_openrouter_catalog.test.ts`: `CatalogProgress: permits an unknown restored pair` and `CatalogEligibility: rejects a remembered pair only after an authoritative catalog excludes it`. |
| `CatalogStale` | `speech_openrouter_catalog.test.ts`: `CatalogStale: invalidation rejects late catalog replies`. |
| `CatalogEligibility` | `speech_openrouter_catalog.test.ts`: `CatalogEligibility: rejects a remembered pair only after an authoritative catalog excludes it`; service tests cover preview and narration admission. |
| `CatalogProgress` | `speech_openrouter_catalog.test.ts`: `CatalogProgress: permits an unknown restored pair`. |
| `StableProgress` | `speech_openrouter_catalog.test.ts`: `CatalogProgress: permits an unknown restored pair` checks admission is possible; fairness is a model assumption. |
| `DeniedRefresh` | `speech_openrouter_catalog.test.ts`: `DeniedRefresh: keeps a denial while refreshing the same identity and after failure`. |

Independent negative controls allowing stale replies, allowing admission after
a denial, disabling admission, clearing evidence during refresh, and assigning
an invalid initial eligibility violated `CatalogStale`, `CatalogEligibility`,
`CatalogProgress`, `DeniedRefresh`, and `TypeOK`, respectively. With the
`CatalogProgress` invariant removed in the negative control, disabled
admission also violates `StableProgress`. All mutations were discarded.

### `OpenRouterBoot`: admission during a browser boot handshake

The bounded model separates a candidate boot from the currently active
browser document. A distinct boot freezes new admissions and cancels the active
logical request before acknowledgement, but it retains any physical decoder
slot. Only a matching acknowledgement activates the candidate; recovery to the
current document resumes it without replacing the decoder. The model also
checks that provider POSTs require admission and cannot happen during the
handshake.

| Property | Implementation test |
| --- | --- |
| `AdmissionFrozen` | `speech_decode_panel.e2e.test.ts`: no provider key read or POST while a new boot awaits acknowledgement. |
| `NoPaidPostDuringBoot` | `speech_decode_panel.e2e.test.ts`: a deferred credential read is aborted when the replacement boot starts. |
| `PostHasAdmission` | `speech_openrouter.test.ts`: decoder admission happens before credentials and the provider request. |
| `RetainSlotOnBoot` | `speech_decode_panel.e2e.test.ts`: an active decode remains reserved during stale-token recovery. |
| `RetainSlotOnRecovery` | `speech_decode_panel.e2e.test.ts`: recovering the current token does not release the physical decode slot. |

### `OpenRouterDecode`: decoder admission and retirement

The bounded model has two document generations, two request IDs and two probe
IDs per page. A readiness probe is identified by page and probe ID. Probe
failure or timeout invalidates the pending probe but its delayed delivery may
still arrive; only a matching current live probe establishes readiness. A later
probe on the same page has a different ID.

The browser implements one shared in-flight codec self-test per document;
retries join it rather than starting another. Distinct predecessor documents
may complete their own self-tests until the corresponding document is
destroyed. The model abstracts the physical codec work of those self-tests;
it checks only the identity and acceptance of their readiness deliveries.

`Admit` reserves a unique logical request before `Post` can perform the paid
provider call. It requires current readiness and a free physical decode slot.
`PostFailure` releases that admission after provider failure before decoding;
`Cancel` releases it before or after POST. A late provider response may still
arrive after either action, but cannot dispatch a decode for an invalid request.
Cancellation does not release an in-flight decode slot. A replacement page is
not proof of destruction. Only settlement or actual destruction of the owning
document releases its physical slot. Settlement may succeed or fail; a
successful result is accepted only for the current page and request.

`CloudFree` is an external prerequisite, fixed to true in this model. The cloud
request owner must establish it before admission and retain its own physical
lease until the prior cloud operation retires, including after cancellation or
failure before decode. The model does not prove that prerequisite. It abstracts
network transport, payloads, codec validation, playback and browser internals;
the implementation must establish that destruction means actual document
destruction rather than logical page replacement. Admission does not guarantee
that a subsequent provider call succeeds or that a decode starts.

TLC checked `OpenRouterDecode.cfg` with the repository-pinned 1.8.0 jar: 482,436
generated states, 125,266 distinct states and search depth 30. All invariants
and temporal properties passed and all eleven actions fired; terminal states
are allowed. Weak fairness for `Admit` and `Post` supports `StablePost`, which
only says that at least one POST eventually occurs under stable preconditions.
Neither the availability of a release action nor any property guarantees
readiness, provider response, decode settlement, destruction or playback.

| Property | Implementation test |
| --- | --- |
| `TypeOK` | `speech_decode.test.ts`: accepts locally scoped browser messages and rejects malformed identities. |
| `ReadyBeforePaid` | `speech_openrouter.test.ts`: waits for per-request admission before reading credentials or making a paid request. |
| `ExclusiveSlot` | `speech_decode_bridge.test.ts`: retains a canceled physical decode until its matching result arrives. |
| `CurrentReadiness` | `speech_decode_bridge.test.ts`: times out a probe and ignores its late acknowledgement during a retry; `panel.test.ts`: keeps boot, challenge and decoder replies in the local view and retires only the replaced document. |
| `CurrentDispatch` | `speech_decode_lifecycle.test.ts`: rejects late decode delivery and stale cancellation while allowing matching work. |
| `CurrentResult` | `speech_decode_bridge.test.ts`: returns only the matching request and document result; `panel.test.ts`: keeps the current decoder on an old-view disposal and on visibility changes. |
| `PostHasAdmission` | `speech_openrouter.test.ts`: reserves a decoder lease before the paid POST and retires it after decoding. |
| `CanReleaseOnCancel` | `speech_decode_bridge.test.ts`: releases an admission canceled before decode and permits the next request. |
| `CanReleaseOnFailure` | `speech_openrouter.test.ts`: releases the lease on provider failure, cancellation, or decode failure. |
| `RetainOnCancel` | `speech_decode_bridge.test.ts`: retains a canceled physical decode until its matching result arrives. |
| `CanAdmit` | `speech_decode_bridge.test.ts`: waits for the matching readiness response before granting a lease. |
| `StablePost` | Nothing yet; fairness is a model assumption. |

Each property was checked alone with the same two-page, two-request and
two-probe bounds. The following temporary mutations were discarded. A trace
lists the action sequence after the initial state; `StablePost` ends in a
stuttering cycle. All violations were isolated to the named property.

| Property | Mutation | Counterexample actions |
| --- | --- | --- |
| `TypeOK` | Invalid initial request identity. | Initial state. |
| `ReadyBeforePaid` | Disable readiness guard. | `Admit`. |
| `ExclusiveSlot` | Disable slot guard. | `Probe`, `ReadinessDelivery`, `Admit`, `Post`, `DecodeDelivery`, `Cancel`, `Admit`. |
| `CurrentReadiness` | Accept stale probe delivery. | `Probe`, `ProbeFailure`, `ReadinessDelivery`. |
| `CurrentDispatch` | Allow stale decode dispatch. | `Probe`, `ReadinessDelivery`, `Admit`, `Post`, `PostFailure`, `DecodeDelivery`. |
| `CurrentResult` | Accept stale decoded result. | `Probe`, `ReadinessDelivery`, `Admit`, `Post`, `DecodeDelivery`, `Cancel`, `Settle`. |
| `PostHasAdmission` | Do not record admission. | `Probe`, `ReadinessDelivery`, `Admit`. |
| `CanReleaseOnCancel` | Cancellation leaves the request active. | `Probe`, `ReadinessDelivery`, `Admit`. |
| `CanReleaseOnFailure` | Provider failure leaves the request active. | `Probe`, `ReadinessDelivery`, `Admit`, `Post`. |
| `RetainOnCancel` | Cancellation clears the decode slot. | `Probe`, `ReadinessDelivery`, `Admit`, `Post`, `DecodeDelivery`, `Cancel`. |
| `CanAdmit` | Disable admission. | `Probe`, `ReadinessDelivery`. |
| `StablePost` | Disable admission. | `Probe`, `ReadinessDelivery`, then stuttering. |

### `SessionSpeechCost`: local pairing-session cost ownership

`Capture` records the session before the request waits for admission and
`Dispatch` records the actual paid POST. `Resolve` accepts a confirmed cost
only for that session and `Unavailable` marks a current result partial. New
sessions discard the previous subtotal; an already-dispatched request may
settle after its session ends, until a fresh session replaces it. The model
abstracts provider currency values as request membership, network timing,
preview exclusion, panel replay, credentials and audio. Those boundaries need
implementation tests; the model does not establish billing accuracy or
provider availability.

The panel presents the same ledger as a compact toolbar subtotal beside the
voice control. Its focusable tooltip retains the precise subtotal, pending and
incomplete states, and fixed missing-cost reasons; an asterisk marks incomplete
values. This presentation does not change the modeled ledger.

Fixed missing-cost reasons are presentation metadata on the same partial
state. Stream-settlement ordering and the bounded publication backoff are
covered by deterministic tests in `speech_openrouter.test.ts` and
`speech_openrouter_usage.test.ts`; they remain outside this model's network
timing abstraction.

TLC checked `SessionSpeechCost.cfg` with two session increments and two
requests per session: 144,385 generated states, 47,988 distinct states and
depth 21. Invariants and `AccountingProgress` passed. Progress assumes fair
resolution of a valid dispatched request; it ends if a fresh session replaces it.

| Property | Implementation test |
| --- | --- |
| `TypeOK` | `session_speech_cost.test.ts`: marks invalid provider values partial and retains finite subtotals. |
| `CurrentOnly` | `session_speech_cost.test.ts`: ignores a late charge after a fresh session begins. |
| `NoDoubleCount` | `session_speech_cost.test.ts`: accumulates confirmed charges once. |
| `CurrentDispatch` | `session_speech_cost.test.ts`: rejects a previous session request delayed before provider dispatch. |
| `AccountingProgress` | `session_speech_cost.test.ts`: accumulates provider-confirmed charges once and retains them after end. |

Temporary mutations were checked independently and discarded. Removing the
current-session guard from `Resolve` violated `CurrentOnly` after `Capture`,
`Dispatch`, `Start`, `Resolve`. Keeping a resolved request pending violated
`NoDoubleCount` after `Capture`, `Dispatch`, `Resolve`. Allowing stale
`Dispatch` violated `CurrentDispatch` after `Capture`, `Start`, `Dispatch`.
Dropping valid resolution effects violated `AccountingProgress`.

### `CommandApproval`: session-scoped command permission

The model distinguishes global confirmation settings, an individual command grant,
and an explicit grant for all commands in the current session. It rejects stale
and interrupted decisions,
preserves grants on resume, and clears them on a fresh session or an explicit
`Revoke`. Revocation leaves a pending confirmation unresolved. TLC checked 612
distinct states to depth 12. `PromptProgress` assumes fair decision or
interruption. `ResetEnforces` checks that the reset action turns confirmation on
and clears both grant types. Three temporary mutations that retained the global
bypass, remembered commands, or the all-command grant each violated
`ResetEnforces` (the all-command mutation was checked with the overlapping
`CurrentAllGrant` and `RunHasApproval` invariants disabled). Temporary mutations
violated `TypeOK`, `CurrentAllGrant`,
`RunHasApproval` and `PromptProgress`. The corresponding lifecycle and stale
decision cases are exercised in `core/test/controller.test.ts` and
`core/test/player.test.ts`; `vscode/test/integration_paths.ts` also exercises
the session-wide grant through the editor. `Revoke` is checked by the named
`Revoke` cases in `core/test/controller.test.ts`; those cases verify both grant
forms and a pending confirmation; `core/test/player.test.ts` checks policy at
admission after a delayed save.

### `CommandCue`: command approval sound

The model permits a cue only for a newly shown live confirmation when sound is
enabled. Replay, duplicate IDs, running and automatically approved commands are
silent. TLC checked 518 distinct states to depth 10. Temporary mutations
violated `TypeOK`, `CueCorrect` and `EventProgress`. Panel webview tests cover
the live confirmation and replay; `webview/approval_sound.test.ts` covers audio
playback and cleanup.

### `CostReplay`: companion session identity

This model covers replay identity and ledger ownership when a companion page
is absent across a session change; it does not model other transport failures.
TLC checked 19 distinct states to depth 6. Temporary mutations violated
`TypeOK`, `CurrentLedger`, `SamePreserved` and `ReopenProgress`. The regression
in `vscode/test/panel.test.ts` checks same-session replay and a new session
missed while the page was absent.

## Speech context

`SpeechContext.tla` models logical completed narration history, session and
setting resets, capture snapshots, cancellation and stale completion. It does
not model physical playback ownership or Unicode strings; the implementation
bounds those strings separately. The finite model has four utterances and three
reset generations, with weak fairness for capture.

| Check | Implementation test |
| --- | --- |
| `TypeOK` | `captures only completed speech and preserves it across cancellation and replay` |
| `Bounded` | `bounds history to three utterances and 500 Unicode code points including separators` |
| `ValidHistory` | `captures only completed speech and preserves it across cancellation and replay`; `invalidates stale completion on reset and superseding capture`; `resets on setting changes, session end and disconnect` |
| `PriorSnapshot` | `captures only completed speech and preserves it across cancellation and replay` |
| `EventualCapture` | `captures only completed speech and preserves it across cancellation and replay` |

TLC checked `SpeechContext.cfg`: 2,450 distinct states, pass. Disabling the
generation guard, clearing history on cancel, trimming, or append-on-complete
respectively violated `ValidHistory`, `ValidHistory`, `Bounded`, and
`ValidHistory`. Capturing the current utterance in its own snapshot violates
`PriorSnapshot`; disabling capture violates `EventualCapture`. Initializing
`pending` outside its declared range violates `TypeOK`.

### `RevealCursor`: explicit cursor navigation

The finite model starts with or without a cursor, each turn and either pause
state. `Request` and `Show` preserve turn and pause; weak fairness for both
models an accepted request and a responsive editor. `RevealCursor.cfg` passes
with 100 distinct states, two file locations, two offsets, and at most two
requests. It models a file or offset change while a request is pending and
supersession or disposal before completion. It abstracts editor failures and
cannot revoke a navigation already accepted by VS Code.

| Property | Implementation evidence |
| --- | --- |
| `TypeOK` | Model type check. |
| `ShowsCursor` | `editor.test.ts`: ShowsCursor; `panel.test.ts`: ShowsCursor; `controller.test.ts`: ShowsCursor. |
| `NoCursorNoNavigation` | `editor.test.ts`: NoCursorNoNavigation. |
| `LatestPosition` | `editor.test.ts`: LatestPosition and file changes during open and show. |
| `CurrentRequest` | `editor.test.ts`: CurrentRequest. |
| `EventuallyHandled` | `webview/panel.test.ts`: ShowsCursor; editor responsiveness is an environment assumption. |
| `PreservesPlayback` | `controller.test.ts`: ShowsCursor; `panel.test.ts`: ShowsCursor. |

Mutations to an invalid visible value, always show the wrong file, and show a
file without a cursor violate `TypeOK`, `ShowsCursor`, and
`NoCursorNoNavigation`, respectively. A `Show` that never sets `shown`
violates `EventuallyHandled`. Toggling pause during `Show` violates
`PreservesPlayback`. Revealing offset 0 after a move violates `LatestPosition`;
accepting a superseded request violates `CurrentRequest`.

### `RemoteCue`: cue retirement across hosts

The model bounds one cue job and its acknowledgement, with weak fairness for
send, physical retirement, and acceptance. `RemoteCue.cfg` passes with six
distinct states. It abstracts transport loss and timeout; the existing
`LocalAudioOwnership` model covers leases and connection epochs.

| Property | Implementation evidence |
| --- | --- |
| `TypeOK` | Model type check. |
| `NoEarlyReuse` | `companion_narration.test.ts`: NoEarlyReuse; `remote_narration.test.ts`: NoEarlyReuse. |
| `AckMatches` | `companion_narration.test.ts`: AckMatches; `remote_narration.test.ts`: NoEarlyReuse. |
| `EventuallyResolved` | `remote_narration.test.ts`: NoEarlyReuse; retirement fairness is an environment assumption. |

Mutating the acknowledged ID, releasing the owner on cancel, or using an
out-of-range acknowledgement violates `AckMatches`, `NoEarlyReuse`, and
`TypeOK`, respectively. Never resolving violates `EventuallyResolved`.

## Attention

`Attention.tla` models a single playback action and speech unit, an independent
pause, a cancelable attention request, and a granted hold. The action's edit
version is a bit so the state space is finite without constraining progress.
Weak fairness of `Boundary`, `Drain`, and `Grant` assumes the active action and
speech eventually finish; cancellation may also end a request. The model does
not represent session generations, cue caching, or physical audio retirement.
`Restore` re-arms a notice only for the current grant generation, checked by
`controller.test.ts`: restores a granted hand only while the same grant remains
active. Weak fairness of
`Acknowledge` assumes a navigator listen eventually accepts
the granted-hand notice; release can also clear it.

| Configuration | Bounds | Result |
| --- | --- | --- |
| `Attention.cfg` | Two edit versions; two request generations; one action and one speech unit | Pass, 536 distinct states |

| Property | Code evidence | Mutation checked |
| --- | --- | --- |
| `TypeOK` | Attention composed tests in `session.e2e.test.ts` | Setting an edit version to 2 violates `TypeOK`. |
| `HeldStopsEdits` | `Attention: holds later edits until the requested floor is released after speech drains` | Allowing a boundary while idle violates `HeldStopsEdits`. |
| `GrantAfterDrain` | `Attention: idle continued speech drains before granting the floor` | Granting with speech active violates `GrantAfterDrain`. |
| `CueRespectsPause` | `Attention: releasing the floor keeps a separate programmer pause` | Starting a cue while paused violates `CueRespectsPause`. |
| `RequestedProgress` | `Attention: lowering a pending hand releases the boundary and rejects the late grant` | Disabling grant violates `RequestedProgress`. |
| `NoticeIsGranted` | `controller.test.ts`: reports a granted raised hand once to a waiting navigator | Retaining the notice on release violates `NoticeIsGranted`. |
| `NoticeDelivered` | `controller.test.ts`: reports a granted raised hand once to a waiting navigator | Disabling acknowledgement violates `NoticeDelivered`. |

### `ShfmtDownload`: verified download and fallback

The bounded model abstracts each URL's bounded curl retries as one of three
outcomes: unavailable, wrong bytes, or the pinned bytes. Weak fairness of
`Next` assumes each external download eventually returns; the model does not
prove network availability or SHA-256 security. TLC checks 10 distinct states.

| Property | Code test or check |
|---|---|
| `TypeOK` | `download_shfmt_sh.bats`: all bounded source outcomes |
| `VerifiedSuccess` | `download_shfmt_sh.bats`: a matching download is accepted |
| `FallbackWorks` | `download_shfmt_sh.bats`: failure or a bad digest falls back |
| `FailureClean` | `download_shfmt_sh.bats`: bad and unavailable sources remove output |
| `Finished` | `download_shfmt_sh.bats`: successful and failed downloads return |
| `EventuallySettled` | Bounded curl retries and the four `download_shfmt_sh.bats` cases |

Each mutation was checked independently: invalid phase violates `TypeOK`;
accepting unverified bytes violates `VerifiedSuccess`; refusing a valid
fallback violates `FallbackWorks`; retaining failed output violates
`FailureClean`; returning without a result violates `Finished`; and blocking
fallback violates `EventuallySettled` under the modeled fairness assumption.

### `CiScheduler`: bounded TLC workers

The model bounds three configs to two worker slots. It retains active workers
until `Finish`, including after cancellation, and reports only after all normal
results settle. Cancellation sends `SIGKILL` to each TLC process and awaits
exit. Weak fairness of `Next` assumes each TLC process eventually
exits after completion or cancellation. Abrupt host termination and operating
system failure are outside the model. A custom `TLC` wrapper must `exec` the
checker: the helper owns and reaps the direct process, not arbitrary descendants.

| Property | Code test or check |
|---|---|
| `TypeOK`, `Partition`, `Bounded` | `check_sh.bats`: bounded workers run independent configs concurrently and report every result |
| `NoEarlyReport`, `FailurePreserved` | `check_sh.bats`: names every config and fails on a violation or an error; nonzero TLC cannot pass |
| `NoReportAfterCancel`, `EventuallySettled` | `run_configs_sh.bats`: cancellation retires each started process before the owner exits |

Mutations independently broke each invariant: an invalid result violated
`TypeOK`, retaining started work in pending violated `Partition`, removing
admission bounds violated `Bounded`, early reporting violated `NoEarlyReport`,
reporting after cancellation violated `NoReportAfterCancel`, losing failure
violated `FailurePreserved`, and preventing retirement violated
`EventuallySettled`.

### `CiConcurrency`: run grouping

The model uses two runs for one pull request, one main push and two uniquely
keyed manual runs. It assumes unique manual run IDs and event-qualified group
keys; GitHub Actions enforces the cancellation operation. Weak fairness assumes
pending runs eventually start and active runs eventually finish.

| Property | Code test or check |
|---|---|
| `TypeOK`, `Partition` | `ci_workflows.bats`: CI and packaging isolate pull requests, main and manual runs |
| `OnePerGroup`, `ManualSafe` | `ci_workflows.bats`: CI and packaging isolate pull requests, main and manual runs |
| `AllStarted` | `ci_workflows.bats`: packaging runs for main, pull requests and manual dispatch only |

Mutations independently broke type membership, run partitioning, group
exclusivity, manual isolation and eventual start, respectively. The model does
not simulate GitHub runner availability or prove its event delivery.

## PairShortcuts

The model abstracts key resolution; platform-specific default key values are
checked by `shortcuts_manifest.test.ts`. macOS overrides use Control+Shift;
other platforms retain their defaults and the modeled transitions are unchanged.

`PairShortcuts.cfg` checks active-session dispatch, attention grant, deferred
reply focus, page reload and customization without draft submission. TLC
checked 38 distinct states (247 generated, depth 9). `FocusProgress` assumes
eventual page readiness and fair delivery while the session remains active.
The extension, panel and webview shortcut tests exercise the corresponding
commands, replacement and modal-focus paths; native tests exercise VS Code
dispatch. The model abstracts keyboard resolution and operating-system
interception.

`NoInactiveEffect` and `GrantedIsPreserved` map to "guards shortcuts without
a session and mirrors the hand button during a session". `FocusProgress` maps
to "delivers a reply focus requested before the page is ready", "keeps a
pending reply focus across page replacement", and "drops a pending reply
focus when its session ends". `DraftNotSubmitted` maps to the browser test
"reply focus closes the modal settings dialog without sending a draft". The
mutants for
`GuardActive`, `PreserveGrant`, `PreserveDraft`, and `DeliverFocus` each
violate their corresponding property; an invalid initial attention state violates
`TypeOK`.
