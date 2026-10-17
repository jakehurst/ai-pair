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
| `Serialize.cfg` | `NumCalls = 2` calls, each empty or not | holds | 709 |
| `Wire.cfg` | `MaxSockets = 2` sockets, `MaxCalls = 2` calls | holds | 43,426 |
| `Panel.cfg` | `MaxEvents = 5` | holds | 21 |
| `PanelScroll.cfg` | `MaxEntries = 5`, `ScrollOn = "you"` | holds | 42 |
| `PanelReplay.cfg` | `MaxLog = 3`, `MaxPosts = 6` | holds | 127 |
| `Controller.cfg` | `NumBatches = 2` batches, `NumEvents = 1` event, `NumQuietEdits = 1` quiet edit, `MaxCancels = 2` | holds | 82,085 |
| `Discovery.cfg` | `NumWindows = 2` windows, one junk file, a write that may fail | holds | 217 |
| `Discovery_InPlace.cfg` | the same, `AtomicWrite = FALSE`: the write in place, so `Focus` and `FinishWrite` fire; `FindsRunningProp` left out | holds | 302 |
| `EditorAdapter.cfg` | `MaxChanges = 5` changes | holds | 311 |
| `FollowMode.cfg` | one move to another file, the programmer looking away, `HoldWhileShowing = TRUE` | holds | 13 |
| `Bridge.cfg` | `NumSockets = 2` sockets | holds | 76 |
| `Draft.cfg` | `MaxViews = 3` pages | holds | 12 |
| `RunBox.cfg` | one `run`, the session ending at any point | holds | 10 |
| `FileText.cfg` | one file, `MaxSteps = 4` changes | holds | 123 |
| `Outside.cfg` | one file, `MaxWrites = 5` contents | holds | 564 |
| `Navigator.cfg` | `MaxEdits = 3` | holds | 44 |
| `EditEvents.cfg` | one file, 3 texts, `MaxSteps = 4` | holds | 516 |
| `Scroll.cfg` | `NumLines = 8` lines, a view of `ViewHeight = 4`, `MaxMoves = 2`, `MaxChanges = 2`, `scrollBeyondLastLine` on and off | holds | 7,552 |
| `ProjectGuide.cfg` | every tree of depth 2 over two names, any of its guides ignored by git | holds (`ASSUME`s) | |
| `Resume.cfg` | 2 directories, `MaxIds = 3` sessions, `PostOnRevive = TRUE` | holds | 62 |
| `Timeline.cfg` | `MaxSleeps = 3` sleeps | holds | 88 |
| `Terminals.cfg` | `MaxTerminals = 2` terminals, `MaxRuns = 3`, 2 directories | holds | 3,361 |
| `Turns.cfg` | batches of up to 2 actions, `MaxChanges = 2` turn changes | holds | 538 |
| `Reload.cfg` | `NumLines = 5` lines, any of them changed on disk | holds | 160 |
| `Rehearsal.cfg` | `MaxLines = 3` lines, `MaxOthers = 2` changes by others, `MaxBatches = 2` batches, `MaxQueued = 2` queued | holds | 79,999 |
| `BatchFile.cfg` | files `a` and `b`, `MaxActions = 4` actions a batch, `FallBackToNamed = TRUE`, `CursorInNamed = TRUE` | holds | 121 |
| `Actions.cfg` | every batch of up to 2 actions, an interrupt at any await | holds | 2,294 |
| `Player.cfg` | `MaxEdits = 2` | holds | 26 |
| `LineIdentity.cfg` | texts up to 4 characters, inserts up to 2 | holds (checked as `ASSUME`s) | |
| `Places.cfg` | texts up to 5 characters, needles up to 3 | holds (`ASSUME`s) | |
| `ActionValidation.cfg` | every move and span place by the kind of value in each field (180 moves, 960 spans), `CheckAtText = TRUE` | holds (`ASSUME`s) | |
| `Typing.cfg` | texts up to 7 characters | holds (`ASSUME`s) | |
| `Anchor.cfg` | `MaxBatches = 4`, `Guard = TRUE` | holds | 46 |
| `Calibration.cfg` | `MaxRuns = 2` calibrations, `AwaitStore = TRUE` | holds | 46 |
| `PointFocus.cfg` | a point, a look-away, a closed tab, `MaxReplies = 2` replies or resumes, `DropStaleFocus = TRUE`, `RevealOnReply = FALSE` | holds | 67 |
| `Start.cfg` | `MaxPages = 3`, `MaxFlips = 2`, `MaxClicks = 2`, `DropStale = TRUE`, `ReaskOnSetUp = TRUE`, `InTerminal = TRUE`, `OneAgent = TRUE`, `NoteOnClick = TRUE`, `ClearOnExit = TRUE` | holds | 12,684 |
| `ListenGrace.cfg` | unbounded, `Grace = TRUE`, `ShowAbsent = TRUE` | holds | 20 |

`Controller.tla` also passes at `NumBatches = 3, MaxCancels = 2` (570,008 states).

Each violation TLC found was checked against the code step by step before it was
reported. The traces are in the issues.

## Specs and the code they model

### `Serialize`: the chain of tool calls

`packages/core/src/controller.ts`. A constant `Fixed` switches the abort check
at the top of `block()` (#1).

| Spec | Code |
|---|---|
| `Guard` | `serialize`: `guarded` checks `signal.aborted` once the call before has settled |
| `Rehearse` | `step`: an empty step blocks with no batch; else `await this.rehearse(...)`, the batch pushed onto the queue, or discarded when `stale` or ended, then `block()` |
| `Reject` | `rejectBatch`: the call answers with the rejection at once; an abort meanwhile ends it with that, not `cancelled` |
| `Abort` | the `AbortSignal` firing; its listener in `block()` runs only if attached, and checks `this.call === call` |
| `Play` | the player finishing batches in queue order |
| `Finish`, `TimeOut`, `Commit` | `finishCall` from `ready()`, where a step's batch is done or first in the queue (#150), or from the `maxBlockMs` timer; clears `this.call` |
| `Resolve` | `withCursor(...).then(call.resolve)`: the report handed back after the commit |
| `Finished` | every call settled: the agent makes no more calls |

Each invariant was proved to bite with a mutation of a copy of the model, run
in TLC and then reverted. A stalled chain also leaves a call aborted while it
waits uncanceled, so its mutation breaks CancelReleases as well, and it ran
with the deadlock check off, since TLC otherwise stops first at the deadlock:

| Mutation | Breaks |
|---|---|
| `Commit` leaves `current` at 0, the old sentinel | `TypeOK` |
| `Guard` runs a call without waiting for the calls before it | `BlockedIsCurrent` |
| `Finish` waits for the batch to be done, the spec before #150 | `ReadyAtHead` |
| an abort of a blocked call takes its batch off the queue | `CancelKeepsBatch` |
| `Fixed = FALSE`, the code at 57ac07f | `CancelReleases` |
| the chain runs a call only after the calls before it were reported, as `this.chain.then(guarded)` with no rejection handler would | `ChainProgresses`, `CancelReleases` |

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

### `Wire`: the relay's side of the WebSocket

`packages/relay/src/link.ts`, with the editor's replies from
`packages/core/src/bridge.ts`. Constants: `PerSocket` (#3), `GuardedParse`
(#4, #30), `CheckAbort` (#29), `WaitCancelled` (#59; what it is for is checked
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
| `Open`, `Welcome` | `connect()` -> `open()` -> `openWindow()`, one attempt at a time; `welcome` sets `this.connection`, or after the link closed, closes the socket; a closed link opens none |
| `Request` | the agent's tool call reaching `call()`, which awaits `connect()` |
| `AbortInClient`, `Abort` | the agent's client canceling; the relay handling `notifications/cancelled`: the abort listener in `call()`, which the SDK runs only while the call is unanswered, or for a request already answered, `handBack` with `mayRepeat` |
| `Deliver` | the relay's answer reaching the client, which drops it after a cancel |
| `Send` | `call()` registering the call in its socket's map and sending it, once no cancelled call on the socket waits for its answer; the socket is open and the arguments are JSON, so the send cannot fail, and the model has no failed send (#180) |
| `Close`, `HandleClose` | `locate()` closing `this.connection`, or the editor's end closing; the `close` handler rejecting `Victims` |
| `Reply` | a `result` frame: `result`, or `return` for a call the relay marked cancelled |
| `SendGarbage` | a frame that isn't a message (`parseEditorMessage`); `ws` hands every frame over as one `Buffer`, so the model has no other forms of a frame (#180) |
| `Reject` | a `rejected` answer to the hello, after which the bridge closes its end: `openWindow()` rejects, and the `close` handler runs with no welcome |
| `Shutdown` | `serve()` in `server.ts`: the harness ends stdin, and it closes the server and `link.close()`, which closes `this.connection` and marks the link closed |
| `Finished` | nothing: the model's sockets are used up, the relay crashed, or it shut down and closed the sockets it opened, and the run ends |

Each invariant and property was proved to bite with a mutation of a copy of
the model, run in TLC and then reverted:

| Mutation | Breaks |
|---|---|
| `Request` sets a call to a state outside `CallStates` | `TypeOK` |
| `PerSocket = FALSE`, the code before #3 | `OwnCloseOnly` |
| `GuardedParse = FALSE`, the code before #4 | `RelayStaysUp` |
| `CheckAbort = FALSE`, the code before #29 | `NoReportLost` |
| `MarkRepeats = FALSE` | `RepeatsMarked` |
| `HandBackAnswered = FALSE`, the code before #67 | `DroppedHandedBack` |
| no fairness on `Reply` | `CallsAnswered` |
| `Finished` left out of `Next` | the deadlock check |
| `CloseAfterShutdown = FALSE`, the code before #163 | `ExitsAfterShutdown`: the harness ends stdin while socket 1 connects, socket 1 fails, `open()` goes on to socket 2, and its welcome leaves it open with nothing to close it (49,428 states) |
| `WaitCancelled = FALSE`, the code before #59 | nothing here, with the same 43,426 states: what it is for is checked in `Controller` |

Every invariant and property names the test that proves the code obeys it;
the test's title carries its name:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `OwnCloseOnly` | `link.test.ts`: OwnCloseOnly: rejects a call only when the socket it was sent on closes |
| `RelayStaysUp` | `link.test.ts`: RelayStaysUp: fails to connect, without crashing, when a window answers with a string, a number, an array, an object with no type, or a rejection whose reason isn't a text; RelayStaysUp: drops a frame that is not a message after the welcome, and an answer to no call; `integration.ts`, in VS Code: RelayStaysUp, ConnectedToOpen: a relay skipped a window that answered with something not a message, and started without AI_PAIR_HOME |
| `NoReportLost` | `link.test.ts`: NoReportLost: doesn't send a call that was cancelled before it went out |
| `RepeatsMarked` | `relay.test.ts`: RepeatsMarked, NoUnmarkedRepeat: delivers a report again, saying it may repeat, when the agent cancels after taking it (#67) |
| `CallsAnswered` | `link.test.ts`: CallsAnswered: tells the agent to call `start` again when the editor disconnects during a call (#138) |
| `DroppedHandedBack` | `link.test.ts`: DroppedHandedBack: hands a report back on the socket it came over, marked as maybe seen, and nothing it cannot; `relay.test.ts`: DroppedHandedBack, NoUnmarkedRepeat: hands back a report the agent canceled after the relay answered it, saying it may repeat (#67); `server.test.ts`: DroppedHandedBack: hands back an answered report once, and passes every message on to the SDK (#67) |
| `ExitsAfterShutdown` | `link.test.ts`: ExitsAfterShutdown: closes a socket the editor welcomes after the link closed, and opens none after it; `server.test.ts`: ExitsAfterShutdown: connects, and once stdin ends, closes the server and then the link (#163); `relay.test.ts`, end to end: ExitsAfterShutdown: serves until stdin ends, then closes the server and the link (#163) |

### `Panel`: the history

The page, `packages/vscode/src/webview/panel.ts`. `Fix = 1` is the code
since #18.

| Spec | Code |
|---|---|
| `Say` | `setNow` |
| `AddEntry` | `addYou`, `addRun`, `addOutside`, the interrupt and turn dividers: `add()` |
| `ChangeSession` | the `session` event, start and end |
| `band`, `flag`, `Flushed` | `current`, `filed`, `fileCurrent()` |

Each invariant was proved to bite with a mutation, run in TLC and then
reverted. NewestFirst implies NoDuplicates (a strictly decreasing history has
no duplicates), so NoDuplicates' mutation ran with NewestFirst left out of the
config:

| Mutation | Breaks |
|---|---|
| `AddEntry` stamps the entry with the old time, 0 at first | `TypeOK` |
| `Fix = 0`, the code at 57ac07f (`Fix = 2` passes) | `NewestFirst` |
| `ChangeSession` drops the band's message | `NoneLost` |
| Fix 1 never marks the message as filed | `NoDuplicates` |

Every invariant names the test that proves the code obeys it:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `NewestFirst` | `history.test.ts`: NewestFirst, NoneLost: puts a reply above the agent message it answers; NoDuplicates, NewestFirst: files the current message once, before anything added while it was current |
| `NoneLost` | `history.test.ts`: NewestFirst, NoneLost: puts a reply above the agent message it answers |
| `NoDuplicates` | `history.test.ts`: NoDuplicates, NewestFirst: files the current message once, before anything added while it was current |

### `PanelScroll`: the history's scroll position

`add` and `addYou` in `packages/vscode/src/webview/panel.ts`. Issue #139. The
constant `ScrollOn` says which entries scroll the history to its top; the code
is `"you"`.

| Spec | Code |
|---|---|
| `AddEntry` | everything `add()` puts in but the programmer's message: the agent's message filed, runs, dividers, changes outside the editor |
| `AddYours` | `addYou`, for the `user` event and a `turn` event with a message: it sets `scrollTop` to 0 |
| `Scroll` | the programmer scrolling the history |
| `above`, and `Prepend` keeping the entry at the view's top | `scrollTop`, and the browser's scroll anchoring |

Each invariant was proved to bite with a mutation, run in TLC and then reverted:

| Mutation | Breaks |
|---|---|
| `ScrollOn = "none"`, the code before #139 | `YoursInView` |
| `ScrollOn = "all"` | `KeepsPlace` |
| `Scroll` reaches `Len(history)` | `InRange` |
| an entry stamped with the old time, 0 at first | `TypeOK` |

Every invariant names the test that proves the code obeys it; the test's title
carries the invariant's name:

| Invariant | Proved by |
|---|---|
| `YoursInView` | `history.test.ts`: YoursInView: your message scrolls the history back to its top (#139) |
| `KeepsPlace` | `history.test.ts`: KeepsPlace: entries other than your message leave the history where you scrolled it (#139) |
| `InRange` | Nothing: the browser keeps `scrollTop` within the history |
| `TypeOK` | Nothing: the TypeScript compiler checks these types |

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
| `Post` sets `live` to every event, "other" too | `TypeOK` |
| `KeepSession = FALSE`, the code before #54 | `ReplayShowsSession` |
| `Post` never cuts the log | `Bounded` |
| `Post` leaves a non-session event off the log | `LogsPosts` |

Every invariant names the test that proves the code obeys it:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `ReplayShowsSession` | `replay.test.ts`: ReplayShowsSession and Bounded: keeps the session's start in the log however many events follow it; ReplayShowsSession: replays the session's end when that is the last session event |
| `Bounded` | `replay.test.ts`: ReplayShowsSession and Bounded: keeps the session's start in the log however many events follow it |
| `LogsPosts` | `replay.test.ts`: LogsPosts: a posted event is on the log a new view replays |

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
| `Submit`, `Listen` | `step` with a batch; `listen`; with `WaitForReturn`, held while a report is on its way back (`Sendable`) |
| `EndSession` | `endSession()`: `ended`, the `end` event, `interrupt()` |
| `FailRehearsal`, `PassRehearsal` | `rejectBatch()`; the batch queued, or discarded when `stale`, then `block()` |
| `Play`, `Finish` | `run()` |
| `Interrupt` | an interrupting event: `interrupt()` discards what is queued and sets `stale`; a turn change, `takeTurn` or `handBack` |
| `Commit` | `finishCall` -> `snapshot`, which also hands out one `held` rejection; with the session ended, `close()` |
| `Cancel` | the agent canceling a call |
| `Answer`, `Bounce`, `Restore` | the report reaching the agent; the relay's `return`; `restore()` |
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
| `NoUnmarkedRepeat` | `controller.test.ts`: NoUnmarkedRepeat: says a returned report may repeat one already seen, when the relay can't tell (#67); NoUnmarkedRepeat: marks each report that carries a returned rejection the agent may have seen. `relay.test.ts`: DroppedHandedBack, NoUnmarkedRepeat: hands back a report the agent canceled after the relay answered it, saying it may repeat (#67); RepeatsMarked, NoUnmarkedRepeat: delivers a report again, saying it may repeat, when the agent cancels after taking it (#67) |
| `HeldMeansStale` | `controller.test.ts`: HeldMeansStale: reports a returned rejection again, discarding steps until it has |
| `PlaysKnowingEvents` | `controller.test.ts`: PlaysKnowingEvents: discards a batch planned before an interruption the agent hasn't seen |
| `PlaysAfterCompleted` | `controller.test.ts`: PlaysAfterCompleted: shows the code as far as it got, returns the rest of the cut action, and discards the queued batch. `link.test.ts`: PlaysAfterCompleted: sends the next call only after a canceled call's report is handed back (#59) |
| `BatchesDelivered` | `controller.test.ts`: CancelKeepsBatch, BatchesDelivered: keeps a canceled step's batch queued and reports it later; BatchesDelivered: keeps an ended session until its returned rejections are reported, one per call. `relay.test.ts`: BatchesDelivered: reports the rejection of a step canceled during its rehearsal (#28) |
| `EventsDelivered` | `controller.test.ts`: CancelReleases, ChainProgresses, EventsDelivered: releases a blocked call without consuming the report; EventsDelivered, EndDelivered: reports a returned report again after the programmer ended the session with it (#60). `relay.test.ts`: EventsDelivered: cancels a blocked call without losing the report, even when racing |
| `QuietDelivered` | `controller.test.ts`: QuietDelivered: reports an edit the programmer made in their turn, which interrupted nothing, when they hand the turn back |
| `BlockedReturns` | `controller.test.ts`: BlockedReturns: returns with `waiting` after MAX_BLOCK |
| `EndDelivered` | `controller.test.ts`: EndDelivered: ends when the programmer ends it, delivering a final report; EventsDelivered, EndDelivered: reports a returned report again after the programmer ended the session with it (#60); EndDelivered: reports a returned report again when the programmer ends the session before it comes back (#60) |

### `Discovery`: finding a window

`writeDiscovery`, `focused` and `dispose` in `bridge.ts`, `findWindows` and
`open` in `link.ts`. `CheckFiles` is the fix for #31. `AtomicWrite` is the fix
for #72: a window rewrites its file each time it gains focus, and written in
place, a relay reading it mid-write skipped it. `locate` switching windows
mid-session is `Close` in `Wire`. With `AtomicWrite = TRUE`, `Focus` and
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
| `Try` | `openWindow` on one candidate, best first |
| `Disconnect` | the socket closing, so the next call opens again |

Each invariant and property was proved to bite with a mutation of a copy of the
model, run in TLC and then reverted:

| Mutation | Breaks |
|---|---|
| `CloseWindow` leaves a state outside the window's states | `TypeOK` |
| `CheckFiles = FALSE`, the code before #31 | `NoInternal` |
| `AtomicWrite = FALSE`, the code before #72 | `FindsRunningProp` |
| `Try` connects without setting `conn` | `ConnectedToOpen` |
| `Try` skips every candidate | `FindsOpen` |

Every invariant and property names the test that proves the code obeys it:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `NoInternal` | `link.test.ts`: NoInternal: skips a file that isn't JSON, JSON that isn't a window's, and a file not named as JSON; `relay.test.ts`: NoInternal: skips a discovery file that parses but isn't a window's |
| `FindsRunningProp` | `bridge.test.ts`: OpenWindow, FindsRunningProp: listens on 127.0.0.1, then writes its discovery file beside it and renames it over; `integration.ts`, in VS Code: FindsRunningProp: the discovery file is never half written |
| `ConnectedToOpen` | `link.test.ts`: ConnectedToOpen: tries the next window when one fails, and fails with the first error when all do; ConnectedToOpen: skips a window whose pid is gone, and keeps one it may not signal, which is alive; `relay.test.ts`: ConnectedToOpen: skips a window whose file outlived it, even when its pid now belongs to another process; `integration.ts`, in VS Code: RelayStaysUp, ConnectedToOpen: a relay skipped a window that answered with something not a message, and started without AI_PAIR_HOME |
| `FindsOpen` | `link.test.ts`: FindsOpen: opens one socket for calls made while it opens, reuses it, and opens again once it closed; `relay.test.ts`: FindsOpen: finds the window again after the relay's socket to it closes, while it stays open |

### `EditorAdapter`: who made a change

`edit`, `save`, `onChange`, and `byProgrammer` in
`packages/vscode/src/editor.ts`, which call the controller's `userEdit` or
`otherEdit`. `FlushBeforeSave` is the fix for #40. VS Code delivers a change
event before the call that made it resolves, and replies after the events sent
before them: one channel, in order.

| Spec | Code |
|---|---|
| `Edit`, `ResolveEdit` | `edit()`: the entry in `own`, VS Code applying it, `finally` |
| `Type` | a keystroke: its change event is queued for the extension host |
| `StartSave`, `RunParticipant`, `FinishParticipants`, `FinishSave` | `save()`: the round trip, `saving`, the save participants (format on save), the write |
| `Handle` | `onChange`: the agent's own edit, or `byProgrammer` |

A keystroke made while the save participants run can't be told from their edits,
since VS Code doesn't say who made a change. The spec allows that one wrong
attribution by name (`"programmer during save"`).

Each invariant and property was proved to bite with a mutation of a copy of the
model, run in TLC and then reverted:

| Mutation | Breaks |
|---|---|
| `ResolveEdit` leaves `own` in a fourth phase | `TypeOK` |
| `FlushBeforeSave = FALSE`, the code before #40 | `RightAuthor` |
| `onChange` never matches the agent's own edit | `RightAuthor` |
| `onChange` never runs | `ChangesHandled` |
| `Handle` without fairness | `ChangesHandled` |

Every invariant and property names the test that proves the code obeys it:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `RightAuthor`, `ChangesHandled` | `integration.ts`, in VS Code: RightAuthor, ChangesHandled: changes by others are reported as theirs; RightAuthor, ChangesHandled: a keystroke just before a save is the programmer's |

### `FollowMode`: our own navigation against looking away

`show`, `selfNav`, and `onActiveEditor` in `packages/vscode/src/editor.ts`, with
a `move` that shows its file before the agent cursor moves there.
`HoldWhileShowing` is the fix for #56.

| Spec | Code |
|---|---|
| `StartShow`, `Expire`, `Resolve` | `show()`: our navigation starts; the window (`SELF_NAV_MS`) runs out; `showTextDocument` resolves, and the `move` puts the agent cursor in the file |
| `ShowFile`, `Handle` | VS Code's change of active editor, and `onActiveEditor` pausing as `away` outside the window |
| `LookAway` | the programmer switching files themselves |

Each invariant and property was proved to bite with a mutation of a copy of the
model, run in TLC and then reverted:

| Mutation | Breaks |
|---|---|
| `ShowFile` shows a file outside `Files` | `TypeOK` |
| `HoldWhileShowing = FALSE`, the code before #56 | `NoPauseFromOurOwnShow` |
| `LookAway` leaves `paused` as it was | `LookAwayPauses` |
| `Resolve` leaves the agent cursor where it was | `MoveEnds` |
| `Next` without `Finished` | the deadlock check |

Every invariant and property names the test that proves the code obeys it:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `NoPauseFromOurOwnShow`, `MoveEnds` | `integration.ts`, in VS Code: NoPauseFromOurOwnShow, MoveEnds: our own move to another file doesn't pause |
| `LookAwayPauses` | Nothing yet: no test looks away in VS Code |

### `Bridge`: who drives the session

`dispatch` and the socket's `close` handler in `packages/core/src/bridge.ts`,
with the controller's session. `CheckOpen` is the fix for #42.

| Spec | Code |
|---|---|
| `BeginStart`, `FinishStart` | `dispatch("start")`: refused while another socket's session is active and not suspended; `controller.start()`; `this.owner = ws`, or on a socket that closed meanwhile, `this.owner = null` and `disconnect()`, which suspends the session it started, unowned |
| `Close` | the `close` handler: aborts the socket's calls, and `disconnect()` if it owns the session, which suspends it, unowned (#25) |
| `EndSuspended` | the programmer ending a suspended session: it closes at once |
| `EndSession`, `CloseEnded`, `CallEnd` | the programmer ending the session from the panel, and its last report closing it; the agent's `end` |
| `Restore` | a `return` from the owner's socket: `restore()` puts a session its last report closed back, as ended (#60); `recent` is `this.closed` |
| `Finished` | every socket closed, with no session: nothing more happens until another socket connects |

Each invariant and property was proved to bite with a mutation of a copy of
the model, run in TLC and then reverted:

| Mutation | Breaks |
|---|---|
| `EndSuspended` leaves the session in a fifth phase | `TypeOK` |
| `CheckOpen = FALSE`, the code before #42 | `OwnedByOpenSocket` |
| `Close` of the owner leaves an ended session ended | `EndedOwned` |
| `Close` of the owner leaves it the owner | `SuspendedUnowned` |
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
command (`extension.ts`), and looking away (`editor.ts`).

| Spec | Code |
|---|---|
| `Sleep`, `Fire` | `sleep(ms)` and its timer |
| `Pause`, `Resume` | `Controller.pause(reason)` with `Timeline.pause()`; `Controller.resume(reason)`, or with no reason all of them, then `Timeline.resume()` |
| `Interrupt`, `Reset` | `interrupt()`; `reset()` for the next batch |

A pause lasts until a resume, as PROTOCOL.md says: looking back at the code
doesn't end the `away` pause, and the agent isn't told about pauses.

Each invariant was proved to bite with a mutation of a copy of the model, run
in TLC and then reverted:

| Mutation | Breaks |
|---|---|
| `Pause` adds a reason outside `Reasons` | `TypeOK` |
| `Resume` of one reason resumes the timeline with others left | `PausedMatchesReasons` |
| `Pause` leaves the timer running | `NoTimerWhilePaused` |
| `Interrupt` resolves the pending sleep but keeps it pending | `ResolvedOnce` |
| `Resume` never restarts a waiting sleep's timer | `ResumeContinues` |

Every invariant names the test that proves the code obeys it; the test's title
carries the invariant's name:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `PausedMatchesReasons` | `controller.test.ts`: PausedMatchesReasons: holds playback until the last pause reason is gone |
| `NoTimerWhilePaused` | `controller.test.ts`: NoTimerWhilePaused, ResumeContinues: holds playback while paused and continues on resume; `timeline.test.ts`: NoTimerWhilePaused, ResumeContinues: pauses a sleep with its time left, and resumes it for only that; `integration.ts`, in VS Code: NoTimerWhilePaused, ResumeContinues, ResolvedOnce: a pause held a say until the resume; an interrupt during a show cut the move, and the next batch played |
| `ResolvedOnce` | `timeline.test.ts`: ResolvedOnce: resolves an interrupted sleep false once, and the next sleep after reset only when its own time is up. A `Promise` settles once, so no change to `timeline.ts` can resolve a sleep twice; the test checks what the code decides: `false` on an interrupt, and the next sleep's own time after `reset`; `integration.ts`, in VS Code: NoTimerWhilePaused, ResumeContinues, ResolvedOnce: a pause held a say until the resume; an interrupt during a show cut the move, and the next batch played |
| `ResumeContinues` | `controller.test.ts`: NoTimerWhilePaused, ResumeContinues: holds playback while paused and continues on resume; `timeline.test.ts`: ResumeContinues: holds a sleep begun while paused until the resume, then runs all of its time; `integration.ts`, in VS Code: NoTimerWhilePaused, ResumeContinues, ResolvedOnce: a pause held a say until the resume; an interrupt during a show cut the move, and the next batch played |

Two sleeps at once are outside the model: `Sleep` needs none pending, and the
player awaits its sleeps one at a time. `sleep` does accept a second one, and
the first's timer, running out, must leave the second pending, so an interrupt
still cuts it short; `timeline.test.ts` checks that: an earlier sleep that runs
out leaves the later sleep that replaced it pending, for an interrupt to cut
short.

### `Anchor`: the cursor after a discarded batch

`step` and `snapshot` in `packages/core/src/controller.ts`. The agent plans a
batch against where the one before would have ended; when that one is
interrupted or discarded, the cursor is where it stopped (#112). `Guard`
switches the refusal; with `FALSE`, TLC violates `NoMisplacedEdit` in two steps:
`Discard`, `SubmitUnanchored`.

| Spec | Code |
|---|---|
| `Discard` | a report with a batch not completed sets `anchorNeeded` |
| `SubmitAnchored` | a batch whose first action at the cursor is a `move` or `select` with `file` and `line`: accepted, and the flag cleared |
| `SubmitUnanchored` | any other action at the cursor first: refused with `unanchored` while the flag holds |

Each invariant was proved to bite with a mutation, run in TLC and then
reverted:

| Mutation | Breaks |
|---|---|
| `Discard` leaves the cursor at a fourth place | `TypeOK` |
| `Guard = FALSE`, the code before #112 | `NoMisplacedEdit` |
| the guard refuses every unanchored batch, pending or not | `AcceptsUnanchored` |

Every invariant names the test that proves the code obeys it:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `NoMisplacedEdit` | `controller.test.ts`: NoMisplacedEdit, AcceptsUnanchored: refuses a batch after a discarded one unless it anchors the cursor with a file and line (specs/Anchor.tla) |
| `AcceptsUnanchored` | the same test |

### `Calibration`: calibrating the reading speed

The calibration flow in `packages/vscode/src/webview/panel.ts` and `panel.ts`,
the `calibrate` pair tool in `bridge.ts`, the setting the rate is stored in,
written by `extension.ts`, and the `say` pause that reads it in `player.ts`.
Issue #109. The constant `AwaitStore` switches whether playback resumes before
or after the stored rate has been applied; with `FALSE`, TLC violates
`FreshRate` in five steps: `Supply`, `Go`, `Finish`, then a `StartSay` timed
with the default rate.

| Spec | Code |
|---|---|
| `Arm`, `Supply` | the Calibrate Reading Speed command, or the calibrate tool, which the bridge refuses unless idle; both add the calibrate pause reason |
| `Go`, `Finish` | the programmer typing go and x in the panel; the extension timestamps both |
| `ApplyRate` | the configuration change applying the new timing, which also removes the pause |
| `Cancel` | any other reply, the view disposed, the session ending |
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
`NoStaleReveal` in three steps: `Point`, `LookAway`, `Resume`. Issue #125: every
typed reply revealed the target, since typing a draft pauses playback and a
reply lifts the pause, so a reply reopened a file the programmer had closed or
took them off the one they had switched to. `RevealOnReply` switches that fix;
with `TRUE`, TLC violates `ReplyKeepsView` in two steps: `LookAway`, `Reply`.

| Spec | Code |
|---|---|
| `Point`, `ActAtCursor` | a `point` action setting the focus; the next cursor action taking it back, and showing its file (`player.ts`, `editor.show` before each edit) |
| `LookAway` | `onActiveEditor` away from the target: `pause("away")` |
| `CloseTab` | the programmer closing the target's tab, or every tab: `onActiveEditor(undefined)` returns early, so nothing pauses |
| `Reply` | the panel's `reply`: `resume(undefined, { reveal: false })`, then `userMessage`; a stale point is dropped, and nothing is revealed |
| `Resume` | the Resume button: `resume()`: with an away pause among the reasons and the focus on a point, the focus returns to the cursor and the editor is rendered before `reveal` |

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
| `NoStaleReveal` | `controller.test.ts`: NoStaleReveal: Resume after a look-away reveals the cursor, not a point the programmer looked away from (#109) |
| `ReplyKeepsView` | `controller.test.ts`: ReplyKeepsView: a reply resumes playback without revealing, after a look-away or with every tab closed (#125) |
| `CursorShown` | `controller.test.ts`: CursorShown: the agent's next edit after a reply shows its file again (#125) |
| `TypeOK` | Nothing: the TypeScript compiler checks these types |

### `Start`: the Start a session button

`packages/vscode/src/panel.ts` (`askStart`, the `ready` and `start` messages),
`setup.ts` (`claudeStarter`), and `webview/panel.ts` (`canStart`, the button),
with `extension.ts` asking again after Set Up Agent. Issue #107. A page asks
once as it loads; the answer comes later, from Claude Code's configuration read
at once and VS Code's command list awaited; pages come and go; the environment
flips. Two constants switch fixes the model found before the code was reviewed
against it. `DropStale`: the panel posted every answer to whatever view it had;
with `FALSE`, TLC violates `OwnAnswer` in three steps: `LoadPage` (page 2
loads), then page 1's `Answer` lands on page 2. `ReaskOnSetUp`: the page asked
only as it loaded; with `FALSE`, TLC violates `ReaskedProp` in three steps:
`Answer` (hidden), then `FlipSetUp` sets Claude Code up with nothing pending.
Issue #115 added how a start lands. `InTerminal`: the starter ran Claude Code's
open command, which brings Claude Code to the front with the prompt unsent and
writes `panel` to `claudeCode.preferredLocation`; with `FALSE`, TLC violates
`KeepsLocation` and `StaysOnPair` in two steps: `Answer` shows the button, then
`Click`. `OneAgent`: a second start while the first agent runs; with `FALSE`,
TLC violates `OneAtATime`. Issue #118 added the note the click shows, Starting a
session with Claude Code, until a session starts. `NoteOnClick`: the page
changed nothing until the agent's `start` landed; with `FALSE`, TLC violates
`AcknowledgedProp` on the first `Click`. `ClearOnExit`: the note went only with
a session, so a CLI that exited without starting one left it up; with `FALSE`,
TLC violates `Settles`: `Click`, then `Exit`, and the note stays.

| Spec | Code |
|---|---|
| `LoadPage` | `ready`: `askStart` numbers the question and calls `available()`, which reads `isSetUp` at once |
| `Answer(c)` | `available()` resolving, with the CLI found and a folder open; `canStart` is posted only if the question is still the latest; the page sets `hidden` |
| `Dispose` | `onDidDispose`; the next page starts hidden |
| `FlipSetUp` | Set Up Agent run or undone; `extension.ts` calls `askStart` after Set Up Agent |
| `FlipCmd` | Claude Code's CLI installed or removed, or the folder closed |
| `Click` | the button posting `start`; `starter.start()` creates a terminal, never shown, whose process is `claude -p "start pairing session" --allowedTools mcp__pair`, unless its last terminal is still open; the page shows the note before it posts `start` |
| `Exit` | the CLI exiting when the session ends; its terminal closes, and `onDidCloseTerminal` clears the starter's terminal and resolves the promise `start()` returned, and the panel posts `startEnded`, which hides the note |
| `Choose(l)` | the programmer, or Claude Code's own commands, setting `claudeCode.preferredLocation` |
| `StartSession` | the `session` event reaching the page: `handle`'s `session` case hides the note |
| `EndSession` | the session ending: the idle view and its button are back |

Checked one property at a time, each mutation failed on the properties named and
no others, and passed with them left out. Each invariant was proved to bite with
a mutation of a copy of the model, run in TLC and then reverted:

| Mutation | Breaks |
|---|---|
| `Choose` sets a location outside `Locations` | `TypeOK` |
| `DropStale = FALSE` | `OwnAnswer` |
| `ReaskOnSetUp = FALSE` | `ReaskedProp` |
| `Answer`'s value ignores `cmd` | `GroundedProp` |
| `Click` without a run | `RunsAreClicks` |
| `Click` while hidden | `ClicksNeedButtonProp` |
| `Answer` never delivered | `Offered` |
| `InTerminal = FALSE` | `KeepsLocation` and `StaysOnPair` |
| `Click` writes `panel` to the setting | `KeepsLocation` |
| `Click` brings Claude Code to the front | `StaysOnPair` |
| `OneAgent = FALSE` | `OneAtATime` |
| `Click` starts no agent | `StartsProp` and `Settles` |
| `Exit` never happens | `Closes` and `Settles` |
| `NoteOnClick = FALSE` | `AcknowledgedProp` |
| `ClearOnExit = FALSE` | `Settles` |
| `StartSession` leaves the note | `NoteUntilSession` |
| `Dispose` leaves the note | `NoteUntilSession` |
| `Click` during a session | `NoteUntilSession` |

Every invariant and property names the test that proves the code obeys it:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types, in `Starter`, `FromPanel`, and `ToPanel` |
| `OwnAnswer` | `start.test.ts`: OwnAnswer: drops the answer of a page replaced before it landed, so it cannot set its successor's button |
| `GroundedProp` | `start.setup.test.ts`: GroundedProp: offers the button only once Claude Code is set up, its CLI is here, and a folder is open |
| `RunsAreClicks` | `start.test.ts`: RunsAreClicks: runs the starter once per start from the page; `start.page.test.ts`: RunsAreClicks: posts start when the button is clicked; `start.setup.test.ts`: RunsAreClicks, StartsProp, StaysOnPair, KeepsLocation: runs the CLI with the prompt in a terminal it never shows, once per start, without Claude Code's open command |
| `ClicksNeedButtonProp` | `start.page.test.ts`: ClicksNeedButtonProp: hides Start a session until the extension says it can start one; `start.test.ts`: ClicksNeedButtonProp: tells the page nothing without a starter, so the button stays hidden |
| `Offered` | `start.test.ts`: Offered: tells a new page whether it can start a session |
| `ReaskedProp` | `start.test.ts`: ReaskedProp: asks again after Set Up Agent, so the button appears without a reload |
| `KeepsLocation`, `StaysOnPair`, `StartsProp` | `start.setup.test.ts`: RunsAreClicks, StartsProp, StaysOnPair, KeepsLocation: runs the CLI with the prompt in a terminal it never shows, once per start, without Claude Code's open command |
| `OneAtATime` | `start.setup.test.ts`: OneAtATime, Closes: starts no second agent while the first one's terminal is open, and starts again once it closes |
| `Closes` | the same test, for the terminal closing. Nothing yet proves the CLI exits when the session ends; that needs a run in the editor |
| `AcknowledgedProp` | `start.page.test.ts`: AcknowledgedProp: shows the starting note at once when the button is clicked |
| `NoteUntilSession` | `start.page.test.ts`: NoteUntilSession: hides the starting note when a session starts, new or resumed |
| `Settles` | `start.page.test.ts`: Settles: hides the starting note once the agent has exited, with no session; `start.test.ts`: Settles: tells the page once the agent a start ran has exited; `start.setup.test.ts`: Settles: resolves a start once its agent's terminal closes, a refused start with it, and a start that runs nothing at once |

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
| `StopAtCheck` | a check that finds the timeline interrupted: a sleep's result, `confirm`, or `notStarted`; a `type` cut after a chunk returns its `rest` |
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
| `StopBeforeAction` ignores the earlier actions' effects | `DiscardedMeansNothing` |
| an await never returns: `Proceed` leaves `pc` as it was | `EventuallyReported` |

Every invariant and property names the test that proves the code obeys it:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `PlaysNothingTwice` | `controller.test.ts`: PlaysNothingTwice: returns what's left of a type cut inside its second part; PlaysNothingTwice, DiscardedMeansNothing: stops waiting when the programmer interrupts, reporting the command as still running |
| `DiscardedMeansNothing` | `controller.test.ts`: DiscardedMeansNothing: discards a batch interrupted after a type with nothing to type, which changed nothing (specs/Actions.tla); PlaysNothingTwice, DiscardedMeansNothing: stops waiting when the programmer interrupts, reporting the command as still running |
| `EventuallyReported` | `controller.test.ts`: EventuallyReported: runs a command, reporting its output and exit code with the batch |

### `Player`: a delete while the programmer edits

The `delete` action in `packages/core/src/player.ts`, between its awaits, while
the programmer types in front of the selection or behind it. `ReadAfterAwait`
and `CheckInterrupt` are the fix for #49.

| Spec | Code |
|---|---|
| `Begin`, `Finish` | the delete: before #49 it copied the selection, then awaited `show` and `getText` |
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
| `DeletesTheSelection` | `controller.test.ts`: DeletesTheSelection: replaces a selection by typing, and deletes a selection |
| `EditInterrupts` | `controller.test.ts`: EditInterrupts: stops a delete when the programmer edits while it starts, and deletes nothing |
| `DeleteEnds` | `controller.test.ts`: DeleteEnds: a delete held at its awaits ends once they return, removing the selected text |

### `BatchFile`: the file each action of a batch acts in

`names`, `fileOf`, `type` and `delete` in `packages/core/src/player.ts`, over
every sequence of up to 4 actions, each with `file` of `a`, `b`, or none, from
any cursor. A `point` names a file without moving the cursor, so with the cursor
elsewhere an action without `file` looked in the cursor's file, and a `type` or
`delete` edited it. `FallBackToNamed` and `CursorInNamed` are the fix for #58.

| Spec | Code |
|---|---|
| `Act` | `perform`: `names`, then `fileOf` for `move`, `select` and `point`, or the cursor for `type` and `delete` |
| `Say` | a `say`, which acts in no file |
| `ActInFile` | `move`, `select` and `point` in the file `fileOf` gives; only `move` and `select` move the cursor |
| `ActAtCursor` | `type` and `delete` at the cursor, rejected with it outside the named file |
| `Reject` | an action that fails: two files named, a file named after an edit, `no_cursor`, or the cursor outside the named file |
| `EndBatch` | a new `Playing` for the next batch; the cursor stays |

Each invariant and property was proved to bite with a mutation of a copy of the
model, run in TLC and then reverted:

| Mutation | Breaks |
|---|---|
| a rejected action's file is the string `"none"`, the sentinel before #148 | `TypeOK` |
| `FallBackToNamed = FALSE`, the code before #58 | `ActsInNamedFile` |
| `CursorInNamed = FALSE`, the code before #58 | `ActsInNamedFile` |
| `ActAtCursor` rejects an edit in a batch that named no file | `EditAtCursorProp` |

Every invariant and property names the test that proves the code obeys it; the
test's title carries its name:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `ActsInNamedFile` | `controller.test.ts`: ActsInNamedFile: looks in the file its batch named for an action without `file`, not the cursor's; ActsInNamedFile: looks in the file its batch named before the agent's cursor is in any file; ActsInNamedFile: rejects a type or delete with the cursor outside the file its batch named, editing nothing |
| `EditAtCursorProp` | `controller.test.ts`: EditAtCursorProp: types and deletes at the cursor in a batch that named the cursor's file, or named none |

### `Draft`: the reply box's pause, across the view's page

`packages/vscode/src/webview/panel.ts` (`syncDraft`, `takeDraft`) and `panel.ts`
(`draft`, `reply`, `ready`, `onDidDispose`), with `Controller.pause` and
`resume`. A draft in the reply box pauses playback for the reason "reply".
`ClearOnReady` is the fix for #69: a new page (`ready`) and a disposed view have
no draft, so they remove that reason.

| Spec | Code |
|---|---|
| `Type`, `Clear` | `syncDraft` posting `draft` when the box's emptiness changes; `takeDraft` on sending or handing the turn back |
| `ResumeAll` | the Resume button, sending a reply, or the turn button: `resume()` with no reason |
| `Dispose`, `Ready` | `onDidDispose`; a page loaded, in a new view or by "Reload Webviews", posting `ready` |

Each invariant and property was proved to bite with a mutation, run in TLC and
then reverted:

| Mutation | Breaks |
|---|---|
| `Dispose` sets the view to a third state, "closed" | `TypeOK` |
| `ClearOnReady = FALSE`, the code before #69 | `ReplyMeansDraft` |
| `Type` leaves the pause as it was | `DraftPausesProp` |

Every invariant and property names the test that proves the code obeys it:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `ReplyMeansDraft` | `draft.test.ts`: ReplyMeansDraft: ends the draft's pause when the view is disposed with it; ReplyMeansDraft: ends the draft's pause when the view's page reloads, keeping a pause the programmer asked for |
| `DraftPausesProp` | `draft.test.ts`: DraftPausesProp: a draft in the reply box pauses playback |

### `RunBox`: the panel's run box

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
| `BoxMatches` | `runbox.page.test.ts`: BoxMatches: shows the box while a command waits for a decision, and while it runs |
| `Clears` | `runbox.page.test.ts`: Clears: a %s phase clears the box (done, background, declined); Clears: the session ending clears the box |

### `FileText`: the text the session takes for a file

`getText` and `show` in `packages/vscode/src/editor.ts`, for #88 and #89. One
file, on disk or absent, and a document VS Code may hold for it, with or without
a tab. VS Code keeps a document after its file is deleted, and reloads one
without unsaved changes some time after its file changes. `Fixed` is the fix for
both: a document with unsaved changes is the programmer's text; otherwise a file
not on disk is `MissingFile`; and `show` creates a missing file by emptying and
saving a document VS Code kept for it, never one with unsaved changes
(`KeepsUnsavedProp`).

| Spec | Code |
|---|---|
| `GetText` | `getText` -> `document()`: `openDocument()`, `exists()`, `openTextDocument` |
| `Open`, `Close`, `Edit`, `Save`, `Reload` | VS Code's documents: opened by anything, dropped, edited, saved (recreating a deleted file), reloaded |
| `Write`, `Delete` | the file changed or deleted on disk |
| `Show` | `show` -> `create`, for a `move` to the file |

Each invariant and property was proved to bite with a mutation, run in TLC and
then reverted:

| Mutation | Breaks |
|---|---|
| `show` writes a text outside `Texts` | `TypeOK` |
| `Fixed = FALSE`, the code before #88 and #89 | `NotStale` |
| the fixed `getText` throws for an empty file with no document | `MissingIsReported` |
| `show` writes a file that is not empty | `CreatedIsEmpty` |
| the fixed `show` keeps the old guard, so it empties unsaved text | `KeepsUnsavedProp` |

Every invariant and property names the test that proves the code obeys it:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `NotStale`, `MissingIsReported`, `CreatedIsEmpty`, `KeepsUnsavedProp` | `integration.ts`, in VS Code: NotStale, MissingIsReported, CreatedIsEmpty, KeepsUnsavedProp: missing and deleted files read as missing, and are created empty |

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
| `Create` | `show` creating a missing file -> `wrote` -> `saved` |
| `Write` | anything else writing the file; an open document without unsaved changes reloads |
| `Report` | the watcher's events -> `reported`; the group settles -> `settle` reads and compares |
| `Open` | opening the file or its diff -> `seen` |

Each invariant and property was proved to bite with a mutation, run in TLC and
then reverted. The other rules and an unsettled decision all break
NoFalseMark, so Marks has a mutation of its own:

| Mutation | Breaks |
|---|---|
| an outside write leaves content 0 | `TypeOK` |
| `Rule = "every"`, `Rule = "afterSave"`, or `Settle = FALSE` | `NoFalseMark` |
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
| `Exactly` | `guide.test.ts`: Exactly, OuterFirst, Contained: reads the guides from the workspace folder down to the working directory, outer first; Exactly, Contained: leaves out a guide git ignores, and keeps one checked in though .gitignore names it |
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
resume, end, or give way to a session from another directory (`WaitsProp`); the
storage holds the session as it is (`SavedIsCurrent`); a message isn't lost
while it waits, or across a reload (`NotLostProp`); a message the agent can be
sent reaches it (`Arrives`); and the panel shows the session as it is
(`ShownIsState`; #138: after a reload, the replayed history showed a suspended
session as live). The spec saves with every change; the code saves 200 ms after
the last one and again as the window goes, so a reload within 200 ms of a change
relies on that last save.

| Spec | Code |
|---|---|
| `Connect`, `Disconnect` | a relay's socket opening and closing; `disconnect()` suspends an active session, and closes one the programmer ended |
| `Reload` | the window reloading: `activate` revives the saved session, suspended (`revive`), with the panel's history; `revive` posts the suspended event (`PostOnRevive`), and the page adds its divider only when the session goes between live and suspended |
| `Start(d)` | `start`: a suspended session from `d` resumes (`resumeSession`); another directory ends it and starts a new one |
| `EndByProgrammer`, `EndByAgent` | `endSession`, which closes a suspended session at once; the agent's `end` |
| `SendMessage`, `Report` | `userMessage`, to an active or a suspended session; the next report, once the agent is back |
| `Save` | `onChange` and `onPost`: the extension writes `saved` and the panel's history 200 ms after a change, and as the window goes |

Each invariant and property was proved to bite with a mutation of a copy of the
model, run in TLC and then reverted:

| Mutation | Breaks |
|---|---|
| `EndByAgent` leaves a fifth state, `"closed"` | `TypeOK` |
| `PostOnRevive = FALSE`, the code before #138 | `ShownIsState` |
| `SendMessage` leaves `saved` unchanged | `SavedIsCurrent` |
| `Start(d)` never resumes: a new session from any directory | `ResumesSameProp` |
| `Reload` brings back no session, checked without `ShownIsState`, which fails first | `WaitsProp` |
| `Reload` drops the pending message | `NotLostProp` |
| `Spec` without `Fairness`, `WF_vars(Report)` | `Arrives` |

Every invariant and property names the test that proves the code obeys it:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `SavedIsCurrent`, `NotLostProp` | `controller.test.ts`: SavedIsCurrent, NotLostProp: brings back a session the window saved, suspended, after a reload |
| `ResumesSameProp`, `Arrives` | `controller.test.ts`: ResumesSameProp, Arrives: suspends a session the agent disconnects from, and resumes it on a start from its directory |
| `WaitsProp` | `controller.test.ts`: WaitsProp: starts a new session from another directory, ending the suspended one; WaitsProp: closes a suspended session at once when the programmer ends it |
| `ShownIsState` | `controller.test.ts`: ShownIsState: a revived session tells the panel it is suspended; `history.test.ts`: ShownIsState: a session revived after a reload shows as suspended; ShownIsState: a revive after a disconnect shows the suspension once |

### `Navigator`: the programmer's edits, reported when they pause

`userEdit`, the navigator timer, `ready` for `listen`, and `snapshot` in
`packages/core/src/controller.ts`. During the programmer's turn, a `listen`
returns for their edits only once they pause typing (`navigatorIdleMs` after
their last edit), so the agent comments on a whole thought. `ResetReady` is the
fix: an edit takes back `navigatorReady`, which a pause before it set, so a
`listen` made after the programmer resumes typing waits for their next pause.

| Spec | Code |
|---|---|
| `Edit` | `userEdit` in the programmer's turn: `recordEdit`, `navigatorReady = false`, the timer started again |
| `Pause`, `Fire` | `navigatorIdleMs` without an edit; the timer setting `navigatorReady` and calling `pump()` |
| `Listen`, `Return`, `Timeout` | `listen`; `ready` holding, and `snapshot` clearing `navigatorReady`; `maxBlockMs` |

Each invariant and property was proved to bite with a mutation, run in TLC and
then reverted:

| Mutation | Breaks |
|---|---|
| `Listen` sets the call to a third state | `TypeOK` |
| `ResetReady = FALSE`, the code before | `NotWhileTyping` |
| `Fire` leaves `ready` unset, so no call returns for the edits | `EditsReported` |

Every invariant and property names the test that proves the code obeys it:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `NotWhileTyping`, `EditsReported` | `controller.test.ts`: NotWhileTyping, EditsReported: waits for the programmer to pause again when they resume typing before the agent listens (specs/Navigator.tla) |

### `ListenGrace`: "Your move" between two idle listens

`state`, `finishCall`, `block`, and `close` in
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
until the agent calls again. `Scroll` reads the status only through `FOLLOWING`
in `editor.ts`, which holds "thinking", "absent", and "listening".

| Spec | Code |
|---|---|
| `Status` | `state()` with the queue empty |
| `Call` | a tool call arriving: `serialize` counting it in `openCalls` and ending the quiet with `endQuiet`, or `read`; `block()` ending the grace with `endGrace` for a call that waits; `close` ends both |
| `TimeOut` | `finishCall` for a `listen` with `waiting` and no batches, events, or rejection: `startGrace` |
| `Return` | `finishCall` with anything else |
| `Act` | an event `interrupting` holds for: a message, an interrupt, an edit of the programmer's, a turn change |
| `Expire` | the grace timer firing after `listenGraceMs` |
| `GoQuiet` | the quiet timer firing `absentMs` after the last open call settled: `startQuiet`, from `serialize` once `openCalls` is 0, and from `read` |

Each invariant and property was proved to bite with a mutation of a copy of the
model, run in TLC and then reverted:

| Mutation | Breaks |
|---|---|
| a call outside `Calls` | `TypeOK` |
| `Grace = FALSE`, the code before | `NoFlicker` |
| `Status` ignores `pending` | `NoYourMoveAfterAct` |
| `Return` starts the grace too | `NoFalseYourMove` |
| `Expire` leaves the grace set | `GraceEnds` |
| `Call` leaves the grace set | `NoYourMoveInOtherCall` |
| `ShowAbsent = FALSE`, the code before #149 | `AbsentShows` |
| `Call` leaves `quiet` set, checked without `NoYourMoveInOtherCall`, which it breaks first | `AbsentWithoutCall` |

Every invariant and property names the test that proves the code obeys it:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `NoFlicker` | `controller.test.ts`: NoFlicker: keeps listening after a listen times out with nothing to report |
| `GraceEnds` | `controller.test.ts`: GraceEnds: shows thinking once the grace runs out without a call |
| `NoFalseYourMove` | `controller.test.ts`: NoFalseYourMove: shows thinking when a listen times out with a batch to report |
| `NoYourMoveAfterAct` | `controller.test.ts`: NoYourMoveAfterAct: shows thinking when the programmer sends a message during the grace |
| `NoYourMoveInOtherCall` | `controller.test.ts`: NoYourMoveInOtherCall: shows thinking after a step during the grace |
| `AbsentWithoutCall` | `controller.test.ts`: AbsentWithoutCall: stops saying the agent isn't listening as soon as it calls (#149) |
| `AbsentShows` | `controller.test.ts`: AbsentShows: says the agent isn't listening once no call has been open for absentMs (#149) |

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
| `EditAsProgrammer`, `EditAsOther` | `userEdit` and `otherEdit` -> `recordEdit`: the baseline, `by`, `interrupted` |
| `Report` | `snapshot`: the event, unless the file is unchanged and the edit didn't interrupt |

Each invariant was proved to bite with a mutation, run in TLC and then
reverted:

| Mutation | Breaks |
|---|---|
| an edit to a text outside `Texts` | `TypeOK` |
| an event only for an edit that interrupted | `NetReported` |
| `KeepInterrupts = FALSE`, the code before | `Explained` |

Every invariant names the test that proves the code obeys it:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `NetReported` | `controller.test.ts`: NetReported: reports programmer edits as diffs and moves the agent cursor with them |
| `Explained` | `controller.test.ts`: Explained: reports an interrupting edit the programmer undid, so the agent knows why its batches were discarded (specs/EditEvents.tla) |

### `Scroll`: follow mode's scrolling

`renderCursor`, `follow`, `keepInView`, `scroll`, and `glide` in
`packages/vscode/src/editor.ts`, with `comfortable` and `landing` from
`view.ts`, and `resume`'s `reveal` in `controller.ts`. A glide stops early when
the state stops following: a pause, or a command running. A pause ends in
`resume`, which reveals the target. `CatchUp` is the fix: a glide a command cut
short goes on once the command is done, from `renderCursor`; before it, the view
stayed where the glide stopped, with the target possibly out of view. The
programmer's turn drops it. `beyond` is `editor.scrollBeyondLastLine`, either
way: with it on (the default), the last line can scroll to the top. How long a
glide takes (#123: `glideMs` in `controller.ts`, from the timing and the
playback speed) is not modeled: a `Glide` step carries no time, and `Move` and
`Leave` can come between any two frames, so a longer or shorter glide is a run
the model already has.

| Spec | Code |
|---|---|
| `Move` | an action moving the target, and the player's `follow()`; no action plays while a command runs |
| `Leave`, `Return` | the state leaving the following states (`paused`, `running`) and coming back: `renderCursor`; a pause's end: `resume`'s `reveal` |
| `Glide` | `glide`'s frames; `scroll`'s `finally` and its follow if the target moved |

Each invariant and property was proved to bite with a mutation of a copy of the
model, run in TLC and then reverted:

| Mutation | Breaks |
|---|---|
| `Move` moves the target past the file's last line | `TypeOK` |
| `Landing` ignores how far the editor scrolls | `InRange` |
| `CatchUp = FALSE`, the code before the fix | `Settles` |
| a finished `Glide` does not follow a target that moved | `Settles` |
| `Return` from a pause does not reveal the target | `Settles` |

Every invariant and property names the test that proves the code obeys it:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `InRange` | `view.test.ts`: InRange: stops at the top of the document; InRange: stops with the last line at the top when the editor scrolls beyond the end, else at the bottom |
| `Settles` | `integration.ts`, in VS Code: Settles: a scroll a command cut short went on to line 250 |

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
| `Begin` | `startHead`: the next batch, with `timeline.reset()` |
| `Start` | the loop in `actions` checking `isInterrupted`; `perform` rejecting with `not_your_turn` |
| `TakeEffect` | the action after its awaits: `type`'s `delay` before each chunk, `delete`'s check after `show` and `getText`, `run`'s `notStarted` after `shellIntegration` |
| `ChangeTurn` | `takeTurn` or `handBack`, which call `interrupt()` |

Each invariant and property was proved to bite with a mutation, run in TLC and
then reverted:

| Mutation | Breaks |
|---|---|
| an action leaves a third phase | `TypeOK` |
| `DeleteChecks = FALSE`, the code before #49 | `OnlyTalkInTheirTurn` |
| `Start` never moves an action on | `BatchEnds` |

Every invariant and property names the test that proves the code obeys it:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `OnlyTalkInTheirTurn` | `controller.test.ts`: OnlyTalkInTheirTurn: lets the agent only comment during the programmer's turn; OnlyTalkInTheirTurn: stops a delete when the programmer takes the turn while it starts, and deletes nothing |
| `BatchEnds` | `controller.test.ts`: BatchEnds, ReadyAtHead: returns the first step immediately and blocks the second until the first finishes |

### `Reload`: a file changed on disk

Line identities, and the agent's selection staying on its text, through
`otherEdit` and `recordEdit` in `packages/core/src/controller.ts`, with the
change VS Code reports when it reloads a document from disk. Measured in an
integration run, that is one change from the first line that differs to the
last, unchanged lines included. `Refine` is the fix for #65: `lineChanges` in
`diff.ts` splits it into one change per run of changed lines.

| Spec | Code |
|---|---|
| `Reload` | a file changed on disk: `onChange` in `editor.ts` passes VS Code's changes, `otherEdit` -> `recordEdit` moves the scene (`mapThrough`) and the identities (`applyChange`) through them |
| `Runs`, `Coarse` | the changes `recordEdit` is given, with and without `lineChanges` |

Each invariant was proved to bite with a mutation, run in TLC and then
reverted. `Refine = FALSE`, the code before #65, breaks UnchangedKeepIds
first, and SelectionStays with UnchangedKeepIds left out of the config:

| Mutation | Breaks |
|---|---|
| a selection moved past the file | `TypeOK` |
| a selection on an unchanged line moves down one | `SelectionStays` |
| every line gets a fresh id | `UnchangedKeepIds` |
| no line gets a fresh id | `ChangedGetNewIds` |

Every invariant names the test that proves the code obeys it:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `SelectionStays` | `controller.test.ts`: SelectionStays: keeps the agent's selection on a line between the changed ones |
| `UnchangedKeepIds` | `controller.test.ts`: UnchangedKeepIds: keeps the numbers of the lines between the changed ones known |
| `ChangedGetNewIds` | `controller.test.ts`: ChangedGetNewIds: forgets the number of a changed line, so a batch has to read it again |

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
text. Until a report says the queue was interrupted (`stale`), no batch is
rehearsed, and `read` shows the editor's text. Batches are queued, each
rehearsed from the one before; the config bounds the queue. `ReadIsStart`: right
after a read, the agent's next batch is checked against what it was shown.
`ShareIds` is the fix for a bug this spec found: `followChange` gave a queued
batch's fork its own id for a line a tool inserted, unlike the editor's id the
agent was shown, so a line the agent had just read was refused. Now the fork
drops its copy of the file's ids, and reads the editor's.

| Spec | Code |
|---|---|
| `Read` | `read`: `saw` with the queue's last `after.lines` when a queued batch edits the file (`planned`), unless `stale`; else the editor's |
| `Submit` | `step`'s rehearsal: `fork()` of where the queue leaves off (`Start`), the batch played in memory; while `stale`, the batch is discarded unrehearsed |
| `Play`, `FailPlay` | the oldest batch playing, the editor tracking its edits, `adopt`; a failure interrupts the queue |
| `EditAsOther` | `otherEdit` or `userEdit`: the editor tracks the change; the queue is interrupted if a batch edits the file (`interrupt`: the batches still queued are discarded, one already playing plays on, and `stale` is set), else each rehearsal follows it (`followChange`) |
| `Accept` | the rehearsal's `knows` in `unseen`: the id the agent was shown at a number is the id there where the rehearsal starts |
| `Report` | the report's `snapshot` clearing `stale`; `ready()` holds the report until a batch interrupted while playing has finished |

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
| `Submit` queues a batch while `stale` | nothing here: `Controller`'s `PlaysKnowingEvents` checks that no batch is queued before the agent knows of an interrupt |

`OtherInterrupts = FALSE` alone does not break `AcceptedOnlyForThatLine`. With
`AdoptChecksText = FALSE`, `OnePerLine` breaks first, and past it the model
reads beyond the end of a sequence, so `AcceptedOnlyForThatLine` is not checked
on its own there.

Every invariant names the test that proves the code obeys it:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `AcceptedOnlyForThatLine` | `controller.test.ts`: AcceptedOnlyForThatLine: rejects a number from before the lines a queued batch adds above it, and takes one from a `read` after them; AcceptedOnlyForThatLine: rejects a report's number that a queued batch has since moved |
| `IdsDistinct` | `lines.exhaustive.test.ts`: IdsDistinct: never gives two lines one identity, in the editor's LineIds or a fork of it, through the same change to both |
| `OnePerLine` | `lines.exhaustive.test.ts`: OnePerLine, Distinct, Untouched, WithinALine, BreakAtEnd, BreakAtStart: gives each line of the result one identity, never one twice, and keeps the untouched lines'; `lines.test.ts`: OnePerLine: adopts a fork's identities only for a file that reads as it did in the fork (specs/Rehearsal.tla, #151). In the code, `version` checks a file's text again before it uses its ids, so a wrong `adopt` gives the file new identities, not too few or too many; this test fails that way when `adopt` skips its check |
| `ReadIsStart` | `controller.test.ts`: ReadIsStart: accepts a line a tool inserted, read while a queued batch edits other files (specs/Rehearsal.tla); ReadIsStart: still interrupts for a change to a file a queued batch edits |

### `Terminals`: running commands

`packages/vscode/src/terminal.ts`: `acquire`, the wait for shell integration,
the command, and what ends each wait.

| Spec | Code |
|---|---|
| `Start` | `acquire()`: a terminal that isn't busy, whose shell is alive, in the run's directory, or a new one there; `busy = true`. The signal may have fired before (an interrupt during the save) |
| `ExecuteCommand`, `AbortBeforeStart`, `RejectClosed` | `shellIntegration()`: integration or its timer, then `executeCommand`; the signal; a terminal closed meanwhile (VS Code throws for its `sendText`) |
| `End`, `StopWaiting`, `Close` | `onDidEndTerminalShellExecution`; `stopWaiting` (the wait or an interrupt); `onDidCloseTerminal` |
| `SendText` | the timer fires with no integration: the command is typed in (`sendText`), and the terminal stays busy for good |
| `SkipAborted` | a signal that fired before the run: `shellIntegration()` returns at once, and `run()` reports `notStarted` |
| `Exit` | the shell exits (`exitStatus`); the terminal stays open, and `acquire()` won't reuse it |

Each invariant and property was proved to bite with a mutation of a copy of the
model, run in TLC and then reverted:

| Mutation | Breaks |
|---|---|
| `Start` leaves the command a value outside `CommandStates` | `TypeOK` |
| `Reusable` ignores `busy` | `NoReuseWhileBusy` |
| `End` leaves its terminal busy | `FreedAfterEnd` |
| `SendText` leaves the call running, waiting for a command nothing tracks | `RunReturns` |

Every invariant and property names the test that proves the code obeys it:

| Invariant | Proved by |
|---|---|
| `TypeOK` | Nothing: the TypeScript compiler checks these types |
| `NoReuseWhileBusy` | `terminal.test.ts`: NoReuseWhileBusy: gives a second command a new terminal while the first one's command still runs |
| `FreedAfterEnd` | `terminal.test.ts`: FreedAfterEnd: reuses a terminal once its command ends |
| `RunReturns` | `terminal.test.ts`: RunReturns: doesn't wait for shell integration once playback is interrupted |

### Pure functions: `LineIdentity`, `Places`, `Typing`, `ActionValidation`

These have no state or concurrency, so each spec is a model of the function and
`ASSUME`s that TLC checks over every small input. Each also has an exhaustive
test that checks the same properties on the code itself, so the model and the
code are held to one contract.

| Spec | Code | Contract | Test |
|---|---|---|---|
| `LineIdentity` | `applyChange` in `core/src/lines.ts` | one identity per line, none named twice; lines outside the change keep theirs; a line break at the end of a line keeps it in place, at its start moves it down | `core/test/lines.exhaustive.test.ts` |
| `Places` | `resolveSpot`, `resolveSpan` in `core/src/places.ts` | a spot or span resolves exactly when one match is on its line, and lies there; a range ends at the first `through` after `from` | `core/test/places.exhaustive.test.ts`, with `through` up to 2 characters (the spec: 3) |
| `Typing` | `planTyping` in `core/src/typing.ts` | the chunks concatenate to the text; each is one character, a line break with its indentation, or the leading indentation | `core/test/typing.exhaustive.test.ts`, texts up to 5 characters (the spec: 7) |
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
| `OnePerLine` | `lines.exhaustive.test.ts`: OnePerLine, Distinct, Untouched, WithinALine, BreakAtEnd, BreakAtStart: gives each line of the result one identity, never one twice, and keeps the untouched lines' |
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
| `SpotOK`, `SpotOnlyWhenUnique` | `places.exhaustive.test.ts`: SpotOK, SpotOnlyWhenUnique: resolves a spot only when one match has its marker on the line, and puts it there |
| `SpanOK`, `RangeOK` | `places.exhaustive.test.ts`: SpanOK, RangeOK: resolves a span only when its text starts once on the line, and a range to the first `through` after it |

#### `Typing`

Each `ASSUME` was proved to bite with a mutation, run in TLC and then reverted:

| Mutation | Breaks |
|---|---|
| a line feed's chunk drops the line feed | `ConcatenatesToText` |
| an "x" shares its chunk with the character after it | `ChunksAreUnits` |

Each names the test that proves the code obeys it:

| Assumption | Proved by |
|---|---|
| `ConcatenatesToText` | `typing.exhaustive.test.ts`: ConcatenatesToText, ChunksAreUnits: splits text into chunks that concatenate to it, each one character or a line break with its indentation |
| `ChunksAreUnits` | the same test |

#### `ActionValidation`

The checks both the relay's schema and the player ask (#45), over every
`move` and every `select` or `point`, by the kind of value in each field: 180
moves and 960 spans. Each `ASSUME` was proved to bite with a mutation, run in
TLC and then reverted:

| Mutation | Breaks |
|---|---|
| `CheckAtText = FALSE`, the code before #163, where `{ at: 5 }` threw in `spotProblem` | `NeverThrows` |
| `MoveProblem` without its check for neither `at` nor `to` | `MoveExactly` |
| `SpanProblem` without its check for empty code | `SpanExactly` |

Each names the test that proves the code obeys it:

| Assumption | Proved by |
|---|---|
| `MoveExactly` | `protocol/test/index.test.ts`: MoveExactly, NeverThrows: gives no problem exactly for a valid move, and a message for every other; `integration.ts`, in VS Code: MoveExactly, SpanExactly, NeverThrows: 27 malformed actions refused by name in the editor; frames that aren't messages dropped |
| `SpanExactly` | `protocol/test/index.test.ts`: SpanExactly, NeverThrows: gives no problem exactly for a valid span, and a message for every other; `integration.ts`, in VS Code: MoveExactly, SpanExactly, NeverThrows: 27 malformed actions refused by name in the editor; frames that aren't messages dropped |
| `NeverThrows` | both tests |

### Contracts checked by tests: `ActionValidation`, `Render`, `AgentSetup`

These three contracts from #19 are about what the code accepts or writes, not
about states, so they are tests on the code, not TLA+. `ActionValidation`'s
two checks, `moveProblem` and `spanProblem`, also have a spec of their own,
above (#163); this contract holds the relay's schema and the player to them.

| Contract | Test |
|---|---|
| The relay's schema and the player's checks accept the same actions (#45) | `relay/test/validation.test.ts`: every action in its table through both, malformed ones above all |
| Every field of a `Report` appears in its rendered text | `relay/test/render.test.ts`: renders every field of a report |
| Setting up an agent changes only its `pair` entry, and twice equals once | `vscode/test/setup.properties.test.ts`: TOML and JSON configs |

## Keeping specs and code in step

Nothing ties a spec to its code but the tables above. When code in one of the
files above changes, update its spec, and run `specs/check.sh`.
