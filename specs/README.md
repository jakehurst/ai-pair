# TLA+ specs

Models of the code's state machines, checked with TLC (issue #19). Run them all
with:

```sh
specs/check.sh            # TLC=<command> to use another TLC; default `tlc`
```

[COVERAGE.md](COVERAGE.md) maps every source file, function by function, to the
spec that models it, or says why it has none.

The specs and their configs follow the
[TLA+ style guide](tlaplus-style-guide.md) (#148). `npm run lint:tla`
(`scripts/lint-tla.mjs`) checks the rules a script can check, in CI's `check`
job.

CI runs `check.sh` on every push to `main` and every pull request
(`.github/workflows/ci.yml`), with TLA+ tools 1.8.0. `check.sh` runs TLC on
every `.cfg`. A config is named after its spec. `Spec.cfg` models the code as it
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
| `Serialize.cfg` | `N = 2` calls, each empty or not | holds | 709 |
| `Wire.cfg` | `S = 2` sockets, `C = 2` calls | holds | 24,714 |
| `Panel.cfg` | `MaxEvents = 5` | holds | 21 |
| `PanelScroll.cfg` | `N = 5` entries, `ScrollOn = "you"` | holds | 42 |
| `PanelReplay.cfg` | `MaxLog = 3`, `MaxPosts = 6` | holds | 127 |
| `Controller.cfg` | `B = 2` batches, `E = 1` event, `Q = 1` quiet edit, `MaxCancels = 2` | holds | 82,085 |
| `Discovery.cfg` | `W = 2` windows, one junk file, a write that may fail | holds | 217 |
| `EditorAdapter.cfg` | `N = 5` changes | holds | 311 |
| `FollowMode.cfg` | one move to another file, the programmer looking away | holds | 13 |
| `Bridge.cfg` | `S = 2` sockets | holds | 76 |
| `Draft.cfg` | `MaxViews = 3` pages | holds | 12 |
| `RunBox.cfg` | one `run`, the session ending at any point | holds | 10 |
| `FileText.cfg` | one file, 4 changes | holds | 123 |
| `Outside.cfg` | one file, 5 contents | holds | 564 |
| `Navigator.cfg` | `Edits = 3` | holds | 44 |
| `EditEvents.cfg` | one file, 3 texts, `Steps = 4` | holds | 516 |
| `Scroll.cfg` | 8 lines, a view of 4, `Moves = 2`, `Changes = 2`, `scrollBeyondLastLine` on and off | holds | 7,552 |
| `ProjectGuide.cfg` | every tree of depth 2 over two names, any of its guides ignored by git | holds (`ASSUME`s) | |
| `Resume.cfg` | 2 directories, up to 3 sessions, `PostOnRevive = TRUE` | holds | 62 |
| `Timeline.cfg` | `N = 3` sleeps | holds | 88 |
| `Terminals.cfg` | `T = 2` terminals, `Runs = 3`, 2 directories | holds | 3,361 |
| `Turns.cfg` | batches of up to 2 actions, 2 turn changes | holds | 538 |
| `Reload.cfg` | `N = 5` lines, any of them changed on disk | holds | 160 |
| `Rehearsal.cfg` | 3 lines, 2 changes by others, 2 batches, up to 2 queued | holds | 34,939 |
| `BatchFile.cfg` | files `a` and `b`, batches of up to 4 actions | holds | 121 |
| `Actions.cfg` | every batch of up to 2 actions, an interrupt at any await | holds | 2,294 |
| `Player.cfg` | `Edits = 2` | holds | 26 |
| `LineIdentity.cfg` | texts up to 4 characters, inserts up to 2 | holds (checked as `ASSUME`s) | |
| `Places.cfg` | texts up to 5 characters, needles up to 3 | holds (`ASSUME`s) | |
| `Typing.cfg` | texts up to 7 characters | holds (`ASSUME`s) | |
| `Anchor.cfg` | `MaxBatches = 4`, `Guard = TRUE` | holds | 46 |
| `Calibration.cfg` | `N = 2` calibrations, `AwaitStore = TRUE` | holds | 46 |
| `PointFocus.cfg` | a point, a look-away, a closed tab, 2 replies or resumes, `DropStaleFocus = TRUE`, `RevealOnReply = FALSE` | holds | 67 |
| `Start.cfg` | `Pages = 3`, `Flips = 2`, `Clicks = 2`, `DropStale = TRUE`, `ReaskOnSetUp = TRUE`, `InTerminal = TRUE`, `OneAgent = TRUE`, `NoteOnClick = TRUE`, `ClearOnExit = TRUE` | holds | 12,684 |
| `ListenGrace.cfg` | unbounded, `Grace = TRUE` | holds | 12 |

`Controller.tla` also passes at `B = 3, MaxCancels = 2` (570,008 states).

Each violation TLC found was checked against the code step by step before it was
reported. The traces are in the issues.

## Specs and the code they model

### `Serialize`: the chain of tool calls

`packages/core/src/controller.ts`. A constant `Fixed` switches the abort check
at the top of `block()` (#1).

| Spec | Code |
|---|---|
| `Guard` | `serialize`: `guarded` checks `signal.aborted` once the call before has settled |
| `Rehearsed` | `step`: an empty step blocks with no batch; else `await this.rehearse(...)`, the batch pushed onto the queue, or discarded when `stale` or ended, then `block()` |
| `RehearseFails` | `rejectBatch`: the call answers with the rejection at once; an abort meanwhile ends it with that, not `cancelled` |
| `Abort` | the `AbortSignal` firing; its listener in `block()` runs only if attached, and checks `this.call === call` |
| `Play` | the player finishing batches in queue order |
| `Ready`, `Timeout`, `Commit` | `finishCall` from `ready()` or the `maxBlockMs` timer; clears `this.call` |
| `Resolve` | `withCursor(...).then(call.resolve)`: the report handed back after the commit |

### `Wire`: the relay's side of the WebSocket

`packages/relay/src/link.ts`, with the editor's replies from
`packages/core/src/bridge.ts`. Constants: `PerSocket` (#3), `GuardedParse`
(#4, #30), `CheckAbort` (#29), `WaitCancelled` (#59; what it is for is checked
in `Controller`), `HandBackAnswered` and `MarkRepeats` (#67). The agent's MCP
client is modeled too: it drops an answer once it has canceled, and it sends a
cancel even after it took the answer, since the SDK never removes its abort
listener. So the relay can't tell whether the agent saw a report whose cancel
came after its answer. The fix for #67 delivers it at least once: the relay
hands it back with `mayRepeat`, and the next report says it may repeat an
earlier one (`RepeatsMarked`).

| Spec | Code |
|---|---|
| `Open`, `Welcome` | `connect()` -> `open()` -> `openWindow()`, one attempt at a time; `welcome` sets `this.ws` |
| `Request` | the agent's tool call reaching `call()`, which awaits `connect()` |
| `ClientAbort`, `Abort` | the agent's client canceling; the relay handling `notifications/cancelled`: the abort listener in `call()`, or for a request already answered, `handBack` with `mayRepeat` |
| `Deliver` | the relay's answer reaching the client, which drops it after a cancel |
| `Send` | `call()` registering the call in its socket's map and sending it, once no cancelled call on the socket waits for its answer |
| `Close`, `Closed` | `locate()` closing `this.ws`, or the editor's end closing; the `close` handler rejecting `Victims` |
| `Reply` | a `result` frame: `result`, or `return` for a call the relay marked cancelled |
| `Garbage` | a frame that isn't a message (`parseEditorMessage`) |

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
| `Entry` | everything `add()` puts in but the programmer's message: the agent's message filed, runs, dividers, changes outside the editor |
| `You` | `addYou`, for the `user` event and a `turn` event with a message: it sets `scrollTop` to 0 |
| `Scroll` | the programmer scrolling the history |
| `above`, and `Prepend` keeping the entry at the view's top | `scrollTop`, and the browser's scroll anchoring |

Each invariant was proved to bite with a mutation, run in TLC and then reverted:

| Mutation | Breaks |
|---|---|
| `ScrollOn = "none"`, the code before #139 | `YoursInView` |
| `ScrollOn = "all"` | `KeepsPlace` |
| `Scroll` reaches `Len(history)` | `InRange` |

Every invariant names the test that proves the code obeys it; the test's title
carries the invariant's name:

| Invariant | Proved by |
|---|---|
| `YoursInView` | `history.test.ts`: YoursInView: your message scrolls the history back to its top (#139) |
| `KeepsPlace` | `history.test.ts`: KeepsPlace: entries other than your message leave the history where you scrolled it (#139) |
| `InRange` | Nothing: the browser keeps `scrollTop` within the history |

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

`packages/core/src/controller.ts`, with `call` and `return` in `link.ts`. S1, at
least once since #67: nothing reaches the agent twice in a report not marked
`repeated` (`NoUnmarkedRepeat`), and everything reaches it (`BatchesDelivered`,
`EventsDelivered`, `QuietDelivered`). S2 (`PlaysKnowingEvents`), S3
(`PlaysAfterCompleted`), L1 (`BlockedReturns`: `Commit` is enabled whenever a
call is blocked, as the `maxBlockMs` timer ends it), and L5 (`EndDelivered`).
`RestoreRejected` is the fix for #28. `WaitForReturn` is the fix for #59: the
relay sending a call only once every cancelled call on the socket has settled,
so a `return` reaches the editor before the next call. `RestoreEnded` is the fix
for #60: `restore()` working on a session the programmer ended, and putting a
closed one back. `MarkHeld` and `DrainHeld` fix two bugs this spec found, each
needing two rejections held at once, which a cancel after an answer allows. Each
held rejection now keeps its own repeat mark, where before only the first report
after them was marked. And a session the programmer ended stays open until its
held rejections are out, one per report, where before it closed with the first.

| Spec | Code |
|---|---|
| `Submit`, `Listen` | `step` with a batch; `listen`; with `WaitForReturn`, held while a report is on its way back (`Sendable`) |
| `EndSession` | `endSession()`: `ended`, the `end` event, `interrupt()` |
| `RehearseFails`, `RehearseOk` | `rejectBatch()`; the batch queued, or discarded when `stale`, then `block()` |
| `Play`, `Finish` | `run()` |
| `Programmer` | an interrupting event: `interrupt()` discards what is queued and sets `stale`; a turn change, `takeTurn` or `handBack` |
| `Commit` | `finishCall` -> `snapshot`, which also hands out one `held` rejection; with the session ended, `close()` |
| `Cancel` | the agent cancelling a call |
| `Answer`, `Bounce`, `Restore` | the report reaching the agent; the relay's `return`; `restore()` |
| `LateBounce` | the agent's cancel coming after it took the answer: the relay's `handBack` with `mayRepeat`, and `restore()` setting `s.mayRepeat`, so the next report is marked `repeated` (#67) |
| `QuietEdit` | `userEdit` in the programmer's turn: recorded, interrupting nothing |

### `Discovery`: finding a window

`writeDiscovery`, `focused` and `dispose` in `bridge.ts`, `findWindows` and
`open` in `link.ts`. `CheckFiles` is the fix for #31. `AtomicWrite` is the fix
for #72: a window rewrites its file each time it gains focus, and written in
place, a relay reading it mid-write skipped it. `locate` switching windows
mid-session is `Close` in `Wire`.

| Spec | Code |
|---|---|
| `OpenW`, `CloseW`, `Crash`, `Reuse` | a window writing its file; `dispose()` removing it; a crash leaving it; its `pid` reused |
| `Focus`, `Written` | `focused()` -> `writeDiscovery`: in place, the file is truncated, then written; renamed, it is replaced whole |
| `OpenW` unlisted, `Listed` | the write failing (`failed`): the window runs, and no relay finds it; a later focus writing it |
| `Start` | `locate` -> `findWindows`: files that hold a `Discovery` with a live `pid`, and parse |
| `Try` | `openWindow` on one candidate, best first |
| `Disconnect` | the socket closing, so the next call opens again |

### `EditorAdapter`: who made a change

`edit`, `save`, `onChange`, and `byProgrammer` in
`packages/vscode/src/editor.ts`, which call the controller's `userEdit` or
`otherEdit`. `FlushBeforeSave` is the fix for #40. VS Code delivers a change
event before the call that made it resolves, and replies after the events sent
before them: one channel, in order.

| Spec | Code |
|---|---|
| `AgentEdit`, `AgentResolved` | `edit()`: the entry in `own`, VS Code applying it, `finally` |
| `Programmer` | a keystroke: its change event is queued for the extension host |
| `SaveStart`, `Participant`, `ParticipantsDone`, `SaveDone` | `save()`: the round trip, `saving`, the save participants (format on save), the write |
| `Handle` | `onChange`: the agent's own edit, or `byProgrammer` |

A keystroke made while the save participants run can't be told from their edits,
since VS Code doesn't say who made a change. The spec allows that one wrong
attribution by name (`"programmer during save"`).

### `FollowMode`: our own navigation against looking away

`show`, `selfNav`, and `onActiveEditor` in `packages/vscode/src/editor.ts`, with
a `move` that shows its file before the agent cursor moves there.
`HoldWhileShowing` is the fix for #56.

| Spec | Code |
|---|---|
| `ShowStart`, `Expire`, `Resolved` | `show()`: our navigation starts; the window (`SELF_NAV_MS`) runs out; `showTextDocument` resolves |
| `Shown`, `Handle` | VS Code's change of active editor, and `onActiveEditor` pausing as `away` outside the window |
| `LookAway` | the programmer switching files themselves |

### `Bridge`: who drives the session

`dispatch` and the socket's `close` handler in `packages/core/src/bridge.ts`,
with the controller's session. `CheckOpen` is the fix for #42.

| Spec | Code |
|---|---|
| `BeginStart`, `FinishStart` | `dispatch("start")`: refused while another socket's session is active and not suspended; `controller.start()`; `this.owner = ws`, or on a socket that closed meanwhile, `disconnect()`, which suspends the session it started |
| `Close` | the `close` handler: aborts the socket's calls, and `disconnect()` if it owns the session, which suspends it, unowned (#25) |
| `EndSuspended` | the programmer ending a suspended session: it closes at once |
| `EndSession`, `Closed`, `AgentEnd` | the programmer ending the session from the panel, and its last report closing it; the agent's `end` |
| `Restore` | a `return` from the owner's socket: `restore()` puts a session its last report closed back, as ended (#60); `recent` is `this.closed` |

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
`FreshRate` in five steps: `Supply`, `Go`, `Finish`, then a `SayStart` timed
with the default rate.

| Spec | Code |
|---|---|
| `Arm`, `Supply` | the Calibrate Reading Speed command, or the calibrate tool, which the bridge refuses unless idle; both add the calibrate pause reason |
| `Go`, `Finish` | the programmer typing go and x in the panel; the extension timestamps both |
| `Stored` | the configuration change applying the new timing, which also removes the pause |
| `Cancel` | any other reply, the view disposed, the session ending |
| `SayStart` | the reading time computed in the player from the timing in force at that moment |

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
| `Point`, `CursorAction` | a `point` action setting the focus; the next cursor action taking it back, and showing its file (`player.ts`, `editor.show` before each edit) |
| `LookAway` | `onActiveEditor` away from the target: `pause("away")` |
| `CloseTab` | the programmer closing the target's tab, or every tab: `onActiveEditor(undefined)` returns early, so nothing pauses |
| `Reply` | the panel's `reply`: `resume(undefined, { reveal: false })`, then `userMessage`; a stale point is dropped, and nothing is revealed |
| `Resume` | the Resume button: `resume()`: with an away pause among the reasons and the focus on a point, the focus returns to the cursor and the editor is rendered before `reveal` |

Each invariant was proved to bite with a mutation of a copy of the model; each
mutation failed on the invariant named and no other:

| Mutation | Breaks |
|---|---|
| `RevealOnReply = TRUE` | `ReplyKeepsView` |
| `DropStaleFocus = FALSE` | `NoStaleReveal` |
| `CursorAction` leaves the active editor | `CursorShown` |

Every invariant names the test that proves the code obeys it; the test's title
carries the invariant's name:

| Invariant | Proved by |
|---|---|
| `NoStaleReveal` | `controller.test.ts`: NoStaleReveal: Resume after a look-away reveals the cursor, not a point the programmer looked away from (#109) |
| `ReplyKeepsView` | `controller.test.ts`: ReplyKeepsView: a reply resumes playback without revealing, after a look-away or with every tab closed (#125) |
| `CursorShown` | `controller.test.ts`: CursorShown: the agent's next edit after a reply shows its file again (#125) |

### `Start`: the Start a session button

`packages/vscode/src/panel.ts` (`askStart`, the `ready` and `start` messages),
`setup.ts` (`claudeStarter`), and `webview/panel.ts` (`canStart`, the button),
with `extension.ts` asking again after Set Up Agent. Issue #107. A page asks
once as it loads; the answer comes later, from Claude Code's configuration read
at once and VS Code's command list awaited; pages come and go; the environment
flips. Two constants switch fixes the model found before the code was reviewed
against it. `DropStale`: the panel posted every answer to whatever view it had;
with `FALSE`, TLC violates `OwnAnswer` in three steps: `Ready` (page 2 loads),
then page 1's `Answer` lands on page 2. `ReaskOnSetUp`: the page asked only as
it loaded; with `FALSE`, TLC violates `Reasked` in three steps: `Answer`
(hidden), then `Flip` sets Claude Code up with nothing pending. Issue #115 added
how a start lands. `InTerminal`: the starter ran Claude Code's open command,
which brings Claude Code to the front with the prompt unsent and writes `panel`
to `claudeCode.preferredLocation`; with `FALSE`, TLC violates `KeepsLocation`
and `StaysOnPair` in two steps: `Answer` shows the button, then `Click`.
`OneAgent`: a second start while the first agent runs; with `FALSE`, TLC
violates `OneAtATime`. Issue #118 added the note the click shows, Starting a
session with Claude Code, until a session starts. `NoteOnClick`: the page
changed nothing until the agent's `start` landed; with `FALSE`, TLC violates
`Acknowledged` on the first `Click`. `ClearOnExit`: the note went only with a
session, so a CLI that exited without starting one left it up; with `FALSE`, TLC
violates `Settles`: `Click`, then `Exit`, and the note stays.

| Spec | Code |
|---|---|
| `Ready` | `ready`: `askStart` numbers the question and calls `available()`, which reads `isSetUp` at once |
| `Answer(c)` | `available()` resolving, with the CLI found and a folder open; `canStart` is posted only if the question is still the latest; the page sets `hidden` |
| `Dispose` | `onDidDispose`; the next page starts hidden |
| `Flip` | Set Up Agent, or Claude Code's CLI installed or removed; `extension.ts` calls `askStart` after Set Up Agent |
| `Click` | the button posting `start`; `starter.start()` creates a terminal, never shown, whose process is `claude -p "start pairing session" --allowedTools mcp__pair`, unless its last terminal is still open; the page shows the note before it posts `start` |
| `Exit` | the CLI exiting when the session ends; its terminal closes, and `onDidCloseTerminal` clears the starter's terminal and resolves the promise `start()` returned, and the panel posts `startEnded`, which hides the note |
| `Choose` | the programmer, or Claude Code's own commands, setting `claudeCode.preferredLocation` |
| `AgentStart` | the `session` event reaching the page: `handle`'s `session` case hides the note |
| `AgentEnd` | the session ending: the idle view and its button are back |

Each property was proved to bite with a mutation of a copy of the model, and
each mutation failed on the properties named and no others, and passed with them
left out (all but `Click` unbounded, whose state space has no end without
`TypeOK`):

| Mutation | Breaks |
|---|---|
| `DropStale = FALSE` | `OwnAnswer` |
| `ReaskOnSetUp = FALSE` | `Reasked` |
| `Answer`'s value ignores `cmd` | `Grounded` |
| `Click` without a run | `RunsAreClicks` |
| `Click` while hidden | `ClicksNeedButton` |
| `Answer` never delivered | `Offered` |
| `Click` unbounded | `TypeOK` |
| `InTerminal = FALSE` | `KeepsLocation` and `StaysOnPair` |
| `Click` writes `panel` to the setting | `KeepsLocation` |
| `Click` brings Claude Code to the front | `StaysOnPair` |
| `OneAgent = FALSE` | `OneAtATime` |
| `Click` starts no agent | `Starts` and `Settles` |
| `Exit` never happens | `Closes` and `Settles` |
| `NoteOnClick = FALSE` | `Acknowledged` |
| `ClearOnExit = FALSE` | `Settles` |
| `AgentStart` leaves the note | `NoteUntilSession` |
| `Dispose` leaves the note | `NoteUntilSession` |
| `Click` during a session | `NoteUntilSession` |

Every property names the test that proves the code obeys it; the test's title
carries the property's name:

| Property | Proved by |
|---|---|
| `TypeOK` | the TypeScript types of `Starter`, `FromPanel`, and `ToPanel` |
| `OwnAnswer` | `start.test.ts`: drops the answer of a page replaced before it landed |
| `Grounded` | `start.setup.test.ts`: offers the button only once Claude Code is set up, its CLI is here, and a folder is open |
| `RunsAreClicks` | `start.test.ts`: runs the starter once per start; `start.page.test.ts`: posts start when the button is clicked; `start.setup.test.ts`: runs the CLI with the prompt in a terminal it never shows, once per start |
| `ClicksNeedButton` | `start.page.test.ts`: hides Start a session until the extension says it can start one; `start.test.ts`: tells the page nothing without a starter |
| `Offered` | `start.test.ts`: tells a new page whether it can start a session |
| `Reasked` | `start.test.ts`: asks again after Set Up Agent |
| `KeepsLocation` | `start.setup.test.ts`: runs the CLI with the prompt in a terminal it never shows, without Claude Code's open command |
| `StaysOnPair` | `start.setup.test.ts`: runs the CLI with the prompt in a terminal it never shows |
| `Starts` | `start.setup.test.ts`: runs the CLI with the prompt in a terminal it never shows, once per start |
| `OneAtATime` | `start.setup.test.ts`: starts no second agent while the first one's terminal is open |
| `Closes` | `start.setup.test.ts`: starts again once it closes. Nothing yet proves the CLI exits when the session ends; that needs a run in the editor |
| `Acknowledged` | `start.page.test.ts`: shows the starting note at once when the button is clicked |
| `NoteUntilSession` | `start.page.test.ts`: hides the starting note when a session starts, new or resumed |
| `Settles` | `start.page.test.ts`: hides the starting note once the agent has exited, with no session; `start.test.ts`: tells the page once the agent a start ran has exited; `start.setup.test.ts`: resolves a start once its agent's terminal closes, a refused start with it, and a start that runs nothing at once |

### `Actions`: what an interrupted batch reports as unplayed

S14 in `actions` and `perform` in `packages/core/src/player.ts`. Each action is
its steps between awaits, read from the code: awaits, checks of a sleep's or
`confirm`'s result or of `notStarted`, and effects the programmer sees. An
interrupt comes at any await. Two defenses keep S14. A `type` cut after a chunk
returns only what's left of it (`RestOnly`), and a `run` interrupted while its
command keeps running counts as played (`ConsumeRun`). Unit tests cover both:
"returns what's left of a type cut inside its second part" and "stops waiting
when the programmer interrupts, reporting the command as still running".

| Spec | Code |
|---|---|
| `Steps(k)` | each action's awaits, checks, and effects; `type` with two chunks; `type0`, a `type` with nothing to type, which returns `nothing` |
| `Next1` | the loop in `actions` checking `isInterrupted` before each action, then the action's steps |
| `Stopped` | `stopped(id, unplayed, effect)`: `discarded` unless an earlier action changed the screen (the `effect` flag in `actions`), or this one typed part of its text or left its command running |
| `Interrupt` | the timeline interrupted, by an edit, a message, a turn change |

### `Player`: a delete while the programmer edits

The `delete` action in `packages/core/src/player.ts`, between its awaits, while
the programmer types in front of the selection or behind it. `ReadAfterAwait`
and `CheckInterrupt` are the fix for #49.

| Spec | Code |
|---|---|
| `Begin`, `Finish` | the delete: before #49 it copied the selection, then awaited `show` and `getText` |
| `TypeBefore`, `TypeAfter` | a programmer's edit: `transform` moves the live selection, and the edit interrupts |

### `BatchFile`: the file each action of a batch acts in

`names`, `fileOf`, `type` and `delete` in `packages/core/src/player.ts`, over
every sequence of up to 4 actions, each with `file` of `a`, `b`, or none, from
any cursor. A `point` names a file without moving the cursor, so with the cursor
elsewhere an action without `file` looked in the cursor's file, and a `type` or
`delete` edited it. `FallBackToNamed` and `CursorInNamed` are the fix for #58.

| Spec | Code |
|---|---|
| `Act` | `perform`: `names`, then `fileOf` for `move`, `select` and `point`, or the cursor for `type` and `delete`; only `move` and `select` move the cursor |
| `Reject` | an action that fails: two files named, a file named after an edit, `no_cursor`, or the cursor outside the named file |
| `NextBatch` | a new `Playing` for the next batch; the cursor stays |

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
| `Saved` | after `save`: `confirm` with confirmation on, else `running`; a failed save posts nothing |
| `Decided` | `confirm` resolving: `running`, or `declined` for a skip or an interrupt |
| `Ran` | `editor.runCommand`: `done` or `background`, or `declined` for `notStarted` or a throw |
| `End` | the session ending: `setActive(false)` |

### `FileText`: the text the session takes for a file

`getText` and `show` in `packages/vscode/src/editor.ts`, for #88 and #89. One
file, on disk or absent, and a document VS Code may hold for it, with or without
a tab. VS Code keeps a document after its file is deleted, and reloads one
without unsaved changes some time after its file changes. `Fixed` is the fix for
both: a document with unsaved changes is the programmer's text; otherwise a file
not on disk is `MissingFile`; and `show` creates a missing file by emptying and
saving a document VS Code kept for it, never one with unsaved changes
(`KeepsUnsaved`).

| Spec | Code |
|---|---|
| `GetText` | `getText` -> `document()`: `openDocument()`, `exists()`, `openTextDocument` |
| `Open`, `Close`, `Edit`, `Save`, `Reload` | VS Code's documents: opened by anything, dropped, edited, saved (recreating a deleted file), reloaded |
| `Write`, `Delete` | the file changed or deleted on disk |
| `Show` | `show` -> `create`, for a `move` to the file |

### `Outside`: marking files changed outside the protocol

The feature of #15, specified before its code: `outside.ts` and
`outsideWatch.ts` in `packages/vscode/src`. One file, written by VS Code's
saves, by the extension's own `show`, and by anything else; a watcher that
reports writes late and merges them. The code marks a file when a group of
writes settles, if the file differs from the text it knows: the last VS Code
wrote, or the programmer saw. A timing assumption: VS Code tells of a save
(`onDidSaveTextDocument`) within milliseconds, before the group settles, and
nothing the programmer does falls in between.

| Spec | Code |
|---|---|
| `Save`, `Saved` | a document saved; `onDidSaveTextDocument` -> `saved` |
| `Create` | `show` creating a missing file -> `wrote` -> `saved` |
| `Write` | anything else writing the file; an open document without unsaved changes reloads |
| `Report` | the watcher's events -> `reported`; the group settles -> `settle` reads and compares |
| `Open` | opening the file or its diff -> `seen` |

### `ProjectGuide`: which project guides `start` reads

The feature of #23, specified before its code: `projectGuides` in
`packages/relay/src/guide.ts`. Checked over every small tree, as `ASSUME`s:
walking up from the working directory to the workspace folder gives exactly the
guides on that path that git doesn't ignore, outer first, and none above the
folder. Walking past the folder, or reading an ignored guide, is caught.

### `Resume`: a session that waits for its agent

The feature of #25, specified before its code: `disconnect`, `start`,
`resumeSession`, `saved`, `revive` and `endSession` in
`packages/core/src/controller.ts`, with the extension saving the session in the
workspace's storage (`extension.ts`). A session whose agent disconnects, or that
the window reloads with, is suspended, not ended, and waits until the programmer
ends it or a `start` resumes it. Checked: a `start` from its directory resumes
the same session (`ResumesSame`); it leaves the suspended state only to resume,
end, or give way to a session from another directory (`Waits`); the storage
holds the session as it is (`SavedIsCurrent`); a message isn't lost while it
waits, or across a reload (`NotLost`); and the panel shows the session as it is
(`ShownIsState`; #138: after a reload, the replayed history showed a suspended
session as live). The spec saves with every change; the code saves 200 ms after
the last one and again as the window goes, so a reload within 200 ms of a change
relies on that last save.

| Spec | Code |
|---|---|
| `Connect`, `Disconnect` | a relay's socket opening and closing; `disconnect()` suspends an active session, and closes one the programmer ended |
| `Reload` | the window reloading: `activate` revives the saved session, suspended (`revive`), with the panel's history; `revive` posts the suspended event (`PostOnRevive`), and the page adds its divider only when the session goes between live and suspended |
| `Start(d)` | `start`: a suspended session from `d` resumes (`resumeSession`); another directory ends it and starts a new one |
| `ProgrammerEnd`, `AgentEnd` | `endSession`, which closes a suspended session at once; the agent's `end` |
| `Message`, `Report` | `userMessage`, to an active or a suspended session; the next report, once the agent is back |
| `Save` | `onChange` and `onPost`: the extension writes `saved` and the panel's history 200 ms after a change, and as the window goes |

Each property was proved to bite with a mutation of a copy of the model:

| Mutation | Breaks |
|---|---|
| `PostOnRevive = FALSE`, the code before #138 | `ShownIsState` |
| `Message` leaves `saved` unchanged | `SavedIsCurrent` |
| `Start(d)` never resumes: a new session from any directory | `ResumesSame` |
| `Reload` brings back no session, checked without the invariants, which fail first | `Waits` |
| `Reload` drops the pending message | `NotLost` |
| `Spec` without `WF_vars(Report)` | `Arrives` |

| Property | Test |
|---|---|
| `SavedIsCurrent`, `NotLost` | `controller.test.ts`: SavedIsCurrent, NotLost: brings back a session the window saved, suspended, after a reload |
| `ResumesSame`, `Arrives` | `controller.test.ts`: ResumesSame, Arrives: suspends a session the agent disconnects from, and resumes it on a start from its directory |
| `Waits` | `controller.test.ts`: Waits: starts a new session from another directory, ending the suspended one; Waits: closes a suspended session at once when the programmer ends it |
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

### `ListenGrace`: "Your move" between two idle listens

`state`, `finishCall`, `block`, and `close` in
`packages/core/src/controller.ts`. Issue #126: a `listen` that times out at
`maxBlockMs` with nothing to report leaves no call open until the agent's next
`listen`, a few seconds later, and the status showed "Agent is thinking" in that
gap. `Grace` is the fix: such a timeout keeps the status "listening" for
`listenGraceMs`, until the agent's next call, or until the programmer does
something that wakes a `listen`. The grace changes only the status, not when a
call returns or what a report holds, so no other spec changes. `Scroll` reads
the status only through `FOLLOWING` in `editor.ts`, which holds both "thinking"
and "listening".

| Spec | Code |
|---|---|
| `Status` | `state()` with the queue empty |
| `Call` | `block()` ending the grace with `endGrace` as the call opens; `close` too |
| `TimeOut` | `finishCall` for a `listen` with `waiting` and no batches, events, or rejection: `startGrace` |
| `Return` | `finishCall` with anything else |
| `Act` | an event `interrupting` holds for: a message, an interrupt, an edit of the programmer's, a turn change |
| `Expire` | the grace timer firing after `listenGraceMs` |

Each property was proved to bite with a mutation of a copy of the model:

| Mutation | Breaks |
|---|---|
| `Grace = FALSE`, the code before | `NoFlicker` |
| `Status` ignores `pending` | `NoYourMoveAfterAct` |
| `Return` starts the grace too | `NoFalseYourMove` |
| `Expire` leaves the grace set | `GraceEnds` |
| `Call` leaves the grace set | `NoYourMoveInOtherCall` |

Every property names the test that proves the code obeys it:

| Property | Proved by |
|---|---|
| `NoFlicker` | `controller.test.ts`: NoFlicker: keeps listening after a listen times out with nothing to report |
| `GraceEnds` | `controller.test.ts`: GraceEnds: shows thinking once the grace runs out without a call |
| `NoFalseYourMove` | `controller.test.ts`: NoFalseYourMove: shows thinking when a listen times out with a batch to report |
| `NoYourMoveAfterAct` | `controller.test.ts`: NoYourMoveAfterAct: shows thinking when the programmer sends a message during the grace |
| `NoYourMoveInOtherCall` | `controller.test.ts`: NoYourMoveInOtherCall: shows thinking after a step during the grace |

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
| `Programmer`, `Other` | `userEdit` and `otherEdit` -> `recordEdit`: the baseline, `by`, `interrupted` |
| `Report` | `snapshot`: the event, unless the file is unchanged and the edit didn't interrupt |

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
playback speed) is not modeled: a `Frame` carries no time, and `Move` and
`Leave` can come between any two frames, so a longer or shorter glide is a run
the model already has.

| Spec | Code |
|---|---|
| `Move` | an action moving the target, and the player's `follow()`; no action plays while a command runs |
| `Leave`, `Return` | the state leaving the following states (`paused`, `running`) and coming back: `renderCursor` |
| `Frame` | `glide`'s frames; `scroll`'s `finally` and its follow if the target moved |

### `Turns`: only talk during the programmer's turn

S6 in `packages/core/src/player.ts`: `perform` checks the turn as each action
starts, a turn change interrupts (`takeTurn`, `handBack` in `controller.ts`),
and each action that edits checks for an interrupt after its awaits, before its
effect. A batch may start at any time, from either turn, which is more than the
controller allows. `DeleteChecks` is the fix for #49, which also let a `delete`
take effect after the programmer took the turn.

| Spec | Code |
|---|---|
| `Begin` | `startHead`: the next batch, with `timeline.reset()` |
| `Start` | the loop in `actions` checking `isInterrupted`; `perform` rejecting with `not_your_turn` |
| `Effect` | the action after its awaits: `type`'s `delay` before each chunk, `delete`'s check after `show` and `getText`, `run`'s `notStarted` after `shellIntegration` |
| `Change` | `takeTurn` or `handBack`, which call `interrupt()` |

### `Reload`: a file changed on disk

S10 and S11 for `otherEdit` and `recordEdit` in
`packages/core/src/controller.ts`, with the change VS Code reports when it
reloads a document from disk. Measured in an integration run, that is one change
from the first line that differs to the last, unchanged lines included. `Refine`
is the fix for #65: `lineChanges` in `diff.ts` splits it into one change per run
of changed lines.

| Spec | Code |
|---|---|
| `Reload` | a file changed on disk: `onChange` in `editor.ts` passes VS Code's changes, `otherEdit` -> `recordEdit` moves the scene (`mapThrough`) and the identities (`applyChange`) through them |
| `Runs`, `Coarse` | the changes `recordEdit` is given, with and without `lineChanges` |

### `Rehearsal`: line identities across a rehearsal

S10 across `core/src/lines.ts`, `rehearsal.ts`, `controller.ts`, and the
player's `knows`. Each line has a ghost, which line it really is, next to the
tracker's id, and changes are whole lines inserted or deleted or an edit within
a line, where `applyChange`'s rules are plain. Two defenses keep S10: a change
by others to a file the queue edits interrupts it (`OtherInterrupts`), and
`adopt` takes the fork's ids only for a text that reads as in the fork
(`AdoptChecksText`). Up to two batches are queued, each rehearsed from the one
before. `ReadIsStart`: right after a read, the agent's next batch is checked
against what it was shown. `ShareIds` is the fix for a bug this spec found:
`followChange` gave a queued batch's fork its own id for a line a tool inserted,
unlike the editor's id the agent was shown, so a line the agent had just read
was refused. Now the fork drops its copy of the file's ids, and reads the
editor's.

| Spec | Code |
|---|---|
| `Read` | `read`: `saw` with the queue's last `after.lines` when a queued batch edits the file (`planned`), else the editor's |
| `Submit` | `step`'s rehearsal: `fork()` of where the queue leaves off (`Start`), the batch played in memory |
| `Play`, `PlayFails` | the oldest batch playing, the editor tracking its edits, `adopt`; a failure interrupts the queue |
| `Other` | `otherEdit` or `userEdit`: the editor tracks the change; the queue is interrupted if a batch edits the file, else each rehearsal follows it (`followChange`) |
| `Accept` | the rehearsal's `knows` in `unseen`: the id the agent was shown at a number is the id there where the rehearsal starts |

### `Terminals`: running commands

`packages/vscode/src/terminal.ts`: `acquire`, the wait for shell integration,
the command, and what ends each wait.

| Spec | Code |
|---|---|
| `Start` | `acquire()`: a terminal that isn't busy, whose shell is alive, in the run's directory, or a new one there; `busy = true`. The signal may have fired before (an interrupt during the save) |
| `Integrated`, `AbortBeforeStart`, `ClosedWhileWaiting` | `shellIntegration()`: integration or its timer; the signal; a terminal closed meanwhile (VS Code throws for its `sendText`) |
| `End`, `StopWaiting`, `Close` | `onDidEndTerminalShellExecution`; `stopWaiting` (the wait or an interrupt); `onDidCloseTerminal` |
| `NoIntegration` | the timer fires with no integration: the command is typed in (`sendText`), and the terminal stays busy for good |
| `AlreadyAborted` | a signal that fired before the run: `shellIntegration()` returns at once, and `run()` reports `notStarted` |
| `Exit` | the shell exits (`exitStatus`); the terminal stays open, and `acquire()` won't reuse it |

### Pure functions: `LineIdentity`, `Places`, `Typing`

These have no state or concurrency, so each spec is a model of the function and
`ASSUME`s that TLC checks over every small input. Each also has an exhaustive
test that checks the same properties on the code itself, so the model and the
code are held to one contract.

| Spec | Code | Contract | Test |
|---|---|---|---|
| `LineIdentity` | `applyChange` in `core/src/lines.ts` | one identity per line, none named twice; lines outside the change keep theirs; a line break at the end of a line keeps it in place, at its start moves it down | `core/test/lines.exhaustive.test.ts` |
| `Places` | `resolveSpot`, `resolveSpan` in `core/src/places.ts` | a spot or span resolves exactly when one match is on its line, and lies there; a range ends at the first `through` after `from` | `core/test/places.exhaustive.test.ts`, with `through` up to 2 characters (the spec: 3) |
| `Typing` | `planTyping` in `core/src/typing.ts` | the chunks concatenate to the text; each is one character, a line break with its indentation, or the leading indentation | `core/test/typing.exhaustive.test.ts`, texts up to 5 characters (the spec: 7) |

### Contracts checked by tests: `ActionValidation`, `Render`, `AgentSetup`

These three contracts from #19 are about what the code accepts or writes, not
about states, so they are tests on the code, not TLA+.

| Contract | Test |
|---|---|
| The relay's schema and the player's checks accept the same actions (#45) | `relay/test/validation.test.ts`: 68 actions through both |
| Every field of a `Report` appears in its rendered text | `relay/test/render.fields.test.ts` |
| Setting up an agent changes only its `pair` entry, and twice equals once | `vscode/test/setup.properties.test.ts`: TOML and JSON configs |

## Keeping specs and code in step

Nothing ties a spec to its code but the tables above. When code in one of the
files above changes, update its spec, and run `specs/check.sh`.
