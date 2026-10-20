# Changes to the specs for #197

A running changelog of the renames and additions that make a term mean one
thing across the TLA+ specs, for the architecture documents to be updated
from. One entry per fix, newest last.

## Fixes

1.  **`pending` named one thing per spec** (finding 1). Wire keeps `pending`,
    the code's own word for a sent call awaiting its answer (`link.ts`). The
    others are named for what they hold: Start `unanswered` (checks asked and
    not answered), Resume `message` (the programmer's message the agent has
    not been sent), ListenGrace and Navigator `unreported` (what the programmer
    did and the agent has not been told), Anchor `mustAnchor` (a report said a
    batch did not complete, and no anchored batch since), Outside `coalescing`
    (writes the watcher has not reported), Timeline `sleeping` (the sleep in
    progress, with the code's `Timeline.pending` renamed `Timeline.sleeping`,
    since the class's `sleep` is its method), and
    Calibration `written` (a rate written to the settings, not yet applied).
    TLC: every config holds with its state count unchanged.

2.  **`call` named one thing per spec** (finding 2). Controller's one call is
    `phase`, the word Calibration, Player, and Turns use for where their one
    process is, and its `answering` phase is `committed`, Serialize's name for
    the same point (the snapshot taken, the answer on its way). Wire's map from
    call id to state is `pc`, Serialize's name for the same map. Terminals'
    run() call is `run`, and RunBox's player phase `player`, so the two do not
    share a name; Terminals' `CallStates` is `RunStates`, since Wire's
    `CallStates` is a different set. Navigator's open call is `call`, one of
    `Calls` or `NoCall`, with ListenGrace's two definitions word for word, so
    the two specs agree. TLC: every config holds with its state count
    unchanged.

3.  **`active` named one thing per spec** (finding 3). PointFocus and
    FollowMode call the active editor's file `editor`. RunBox's boolean for the
    session being active in the page is `live`, the word Resume's `Views` uses
    for a live session. Bridge and Resume keep `"active"` as the session's
    phase. TLC: every config holds with its state count unchanged.

4.  **One session vocabulary, and no absent value spelled as a string**
    (finding 4). Resume takes Bridge's `Phases` and `NoSession` definitions
    word for word, its `state` is `session` as in Bridge, and its `"none"` is
    gone. ActionValidation's `None == "none"` was two things: the answer for
    no problem is now the model value `NoProblem`, over a `Problems` set the
    spec names, and the kind for a missing `old` field is `"missing"` (first
    `"absent"`; fix 16 settled the word), like
    every other field's. TLC: both hold, Resume with its state count
    unchanged.

5.  **`runs` counts one thing per spec** (finding 5). Calibration counts
    `rounds`, bounded by `MaxRounds` (first `completed`, which Controller uses
    for a batch played to the end; see 16); Start counts `starts`,
    and `RunsAreClicks` is `StartsAreClicks`, in the README's rows and the
    three tests named for it; Terminals keeps `runs` for run() calls. TLC:
    both hold with their state counts unchanged.

6.  **A call cut off by its socket's close is `severed`** (finding 6), with
    `severedBy` the socket, in Wire. `rejected` now means one thing: a batch
    that failed rehearsal (Serialize, Controller). The hello's `rejected`
    answer is the protocol's own message type and stays. TLC: holds with the
    state count unchanged.

7.  **`idle` means nothing in flight everywhere** (finding 7). ListenGrace's
    boolean for a listen that timed out empty is `timedOut`. TLC: holds with
    the state count unchanged.

8.  **`stale` is the queue gate only** (finding 8). PointFocus's boolean for a
    reply that showed a point the programmer had looked away from is `reshown`.
    TLC: holds with the state count unchanged.

9.  **Set names name their set** (finding 9). Timeline's pause reasons are
    `PauseReasons`, and Scroll's reasons the view stops following are
    `AwayReasons`; Player's are `DeleteOutcomes` with `NoDeleteOutcome`, and
    Serialize's `CallOutcomes` with `NoCallOutcome`. The kinds of action are
    `ActionKinds`, one list of eight, in PairDefs (fix 13): Actions keeps
    `Shapes`, the kinds its step table tells apart (`type_fast` steps as
    `type`; `type0` is a `type` with nothing to type); BatchFile takes all
    eight (`run` acts in no file, like `say`; `type_fast` edits at the cursor);
    Turns takes them from PairDefs instead of its config, and `type_fast`
    checks for the interrupt as `type` does, which TLC caught when the first
    run let it take effect in the programmer's turn. TLC: Turns 538 to 1,234
    states; the rest unchanged.

10.  **The programmer is `programmer`, never `user`** (finding 10). The turn
     (Turns, Controller) and the Pause button's reason (`PauseReasons`) say so;
     the code, the tests, the stylesheet's `programmer-turn` class, and
     `PROTOCOL.md` follow, with a minor version bump to 0.8.0. TLC: both hold.

11.  **`ReloadWindow`** (finding 11): Resume's window reload, so `Reload` is a
     file replaced on disk only (Reload, FileText); the README rows and the two
     code comments follow.

12.  **`phase` is where a spec's one process is** (finding 12): Controller's
     call (fix 2) and Resume's session (fix 4) joined Calibration, Player, and
     Turns; a function over objects keeps its own name (Terminals' `state[t]`,
     Wire's `sock[s]` and `pc[c]`).

13.  **`PairDefs.tla`** (finding 13): one module for the shared vocabulary,
     `ActionKinds`, `Phases` and `NoSession`, `Calls` and `NoCall`, and
     `PauseReasons`. Actions, BatchFile, Turns, Bridge, Resume, ListenGrace,
     Navigator, and Timeline `EXTENDS` it and dropped their copies; the README
     has its section. TLC: every config holds.

14.  **The hand-back names its neighbors** (finding 14): Wire's `Abort` and
     `Reply`, Bridge's `Restore`, and Controller's `Bounce`, `BounceLate`, and
     `Restore` each say where the path continues, as the code's comments did.

15.  **An outside write to an open file** (finding 15): Outside's header names
     the path through EditorAdapter and Rehearsal's `EditAsOther`. EditorAdapter
     has the `disk` author and the `Reload` action, attributed `other` as
     `byProgrammer` does for a clean document reading what is on disk; the
     mutation that takes it for the programmer's breaks `RightAuthor`, and the
     README's tables have the action, the mutation, and the existing test. TLC:
     EditorAdapter 311 to 1,464 states.

16.  **A second sweep over every name** (every variable, constant, definition,
     and string value in the 37 modules, compared by its comment). Variables:
     Terminals' playback signal is `interrupted`, the word the other playback
     specs use; the flags for what an invariant forbids are `wrongLine`
     (Rehearsal), `wrongTurn` (Turns), and `wrongPlace` (Anchor, was
     `misplaced`); Serialize's per-call batch state is `batchState`, how its
     call settled `settledAs`, and its failed rehearsal `failed`; Scroll's
     follow switches are `switches` with `MaxSwitches`, and Turns' turn changes
     `turnChanges` with `MaxTurns`; Start's CLI-and-folder check is `cli`, with
     `FlipCli`, its button `visible` with `visibleFor`, and its session `live`
     as in RunBox; Calibration's count is `rounds` with `MaxRounds`;
     Discovery's `connectedTo` and Resume's `connected`; Actions' playing
     action is `action`; EditEvents' last report is `report` and PanelScroll's
     last event `event`; PanelReplay's `shown`; Outside's badge is `badged`
     and Wire's hand-back mark `mayRepeat`, the code's word; Resume's storage
     is `stored`, so Outside keeps `saved`; Player's `textAt`. Constants and
     definitions: `PreferDirty` (FileText) and `AbortInBlock` (Serialize) for
     the two switches both called `Fixed`; `MaxChars` for a text's length
     (LineIdentity, Places, Typing), so `MaxLen` is actions per batch;
     Controller's `BatchIds` and `EventIds`; PanelReplay's `NoSessionEvent`.
     Values: a sleep with no timer is `paused` (Timeline), an action before its
     awaits `before` (Turns, as Player), a run() call that came back `settled`
     (Terminals, as Serialize), a window kept open `awaiting` (FollowMode), a
     field not given `missing` (ActionValidation), a calibration waiting for go
     `ready`, a show not started `idle` (FollowMode); Scroll's `NotAway` and
     Outside's `NoDocument` are model values. Left alone, with the reason: the
     model alphabets `Files`, `Chars`, and `Texts`, which differ per module
     because one alphabet would multiply the state spaces. TLC: every config
     holds.

17.  **The alphabets and the files, in PairDefs** (item 20 of the second
     sweep, on Justine's steer). `Letter`, `OtherLetter`, `Space`, `LineFeed`,
     and `CarriageReturn` name the letters, and `Seqs` the texts over them;
     LineIdentity, Places, and Typing build their own `Chars` from those names,
     so `n` is a line feed in each and the state spaces stay as they were.
     `Files` is `{"a", "b", "other"}` with `NoFile` for BatchFile, FollowMode,
     and PointFocus; BatchFile's config no longer names the files. TLC: every
     config holds; BatchFile's state count moves with the third file.

18.  **A third pass, over action and definition names** (Justine, 2026-10-19:
     "do another consistency pass"). Three readers compared every name in the 37
     modules by its comment, and every hit was checked against its lines. Same
     name, two things: Wire's and Serialize's call ids are `CallIds`, and
     Serialize's absent call `NoCallId` (PairDefs' `Calls` is the kinds);
     Serialize's `QueueStates`, `queueState`, and `NoQueueState` (Controller's
     `BatchStates` is per batch); Anchor's cursor is `place` and its count
     `heldCount` (Controller's `held` is a set); ListenGrace's `absent`
     (Controller's `quiet` edits); FileText's and EditEvents' text as a number
     is `Contents`, as in Outside; FileText's `NoSuchFile` and `Internal` (the
     code's `internal`); Rehearsal's `Origin`, `EditorLines`,
     `QueuesAfterInterrupt`, `justRead`; LineIdentity's `ApplyChange` and
     `LineFeeds`; Reload's `Replacements`; BatchFile's `NamingKinds`; Scroll's
     `targetLine` and `"pause"` reason; PanelScroll's `topBefore`; Discovery's
     one process is `phase`; PairDefs' `SessionPhases`, since `phase` is a
     process's. One code path, one name: the session ends by `EndByProgrammer`
     (Bridge, Controller, Resume) or `EndByAgent` (Bridge, Resume); the cancel
     is `Cancel` and `canceled` (Serialize, as Controller; `canceled` spelled
     one way, Wire too); a failed rehearsal is `FailRehearsal` (Serialize,
     ListenGrace); `Return` is finishCall with a report (Serialize too);
     `Timeout` everywhere; `Deliver` is the report reaching the agent
     (Controller); `Interrupt` (ListenGrace); `EditAsProgrammer` (Navigator,
     EditorAdapter) and `EditAsAgent`; `LoadPage` and `PageStates`, `"loaded"`
     or `"disposed"`, for a webview page (Draft, Start), so `live` is a session
     alone; `Views` in PairDefs, from Resume; `Store` for workspace storage
     (Resume); id sets are `Num*` and bounds `Max*`; the counts are
     `MaxEdits`/`edits` and `MaxChanges`/`changes`; `MaxEvents` in the three
     panel specs; the pause flags are `replyPause`, `calibratePause`, and
     `awayPause`; `ResumeAll` for resume() with no reason; `selection`,
     `baseline`, `byProgrammer`, and `interrupts` spelled out. An action names
     its object where a verb was shared: `CloseSocket` and `OpenSocket`,
     `CloseDocument` and `OpenDocument`, `CloseTerminal`, `Acquire`,
     `RejectHello`, `Perform` and `StartHead` (Turns), `StartDelete`, `Complete`
     (Controller), `Played` and `HandBack` (Serialize), `TakeHeld` and
     `StopShort` (Anchor), `Stop` (BatchFile), `WriteOutside`, `WatcherReports`,
     and `Show` (Outside, as FileText), `AnswerCheck` and `AgentExits` (Start),
     `CancelCalibration` and `StopTimer`, `SendReply`, `ShowResolves`,
     `WindowExpires`, `HandleEditorChange`, `Follow` and `InView` (Scroll),
     `Lull` (Navigator), `ViewAtEntry`, `TypeDraft`. Properties: Start's
     `NoteGoes` and Scroll's `ComesInView` (both were `Settles`), and
     `NoYourMoveAfterInterrupt`; the tests named for them follow. Absent values
     as model values: Start's `NoQuestion` (was 0) and ActionValidation's
     `Throws` (was a string); Discovery's `"unstarted"` and Wire's
     `"unanswered"` for states that read as absent. Sets named: `Rates`
     (Calibration), `EventKinds` (PanelScroll). Models: FollowMode's `LookAway`
     goes to `"other"` and its `Other(f)` is gone; BatchFile's
     `EditAtCursorProp` covers `type_fast`; Turns' and Actions' `Batches` and
     ProjectGuide's `Paths` are `Seqs`; RunBox says it stops at the first `run`
     post (`exited` comes later, to a box already off). Comments behind a rename
     in eleven modules follow it, and the three pure-function headers name their
     letters from PairDefs. The code comments naming these actions, the README's
     tables, and `COVERAGE.md` follow. Left alone, with the reason: `NoText`,
     `NoDocument`, and `NoOffset` are each a `CHOOSE` over a local set, so they
     stay local; PanelReplay's `SessionEvents` are events, not `Views`;
     EditorAdapter's `"other"` is the wire's `by`. `Files` is
     `{"sourceFile", "destinationFile", "otherFile"}`, Justine's names: where
     the cursor is, where it goes, and a file the programmer went to on their
     own; so a file and the other kind of call no longer share a word, and
     `"other"` in `Calls` stays. TLC: every config holds with its state count
     unchanged.

19.  **Variables named for what they hold** (Justine, 2026-10-19: "these specs
     should be self-documenting"; a name a reader needs the comment for gets a
     clearer one, compound in lowerCamelCase as the style guide's new 5.10
     says). Three readers judged every variable, constant, record field, and
     string value by its comment and its uses; each proposal was checked at its
     line, and kept where the name is the code's own (`pc`, `no_editor`,
     `internal`, `old`, applyChange's `a`, `b`, `k`) or already plain. Wire:
     `socketState`, `activeSocket`, `sentOn`, `awaitingAnswer`, `garbageSent`,
     `canceled` (was `aborted`, with `requestedCanceled`), `cancelNoticed`,
     `answerAtClient`, `RejectPerSocket`, `WaitForReturn` (Controller's name
     for the same #59 fix). Discovery: `windowState`, `untried`, `JunkFile`,
     `pidReused`. Bridge: `socketState`, `restorable`. Resume: `Directories`,
     `NoDirectory`, `directory`, `MaxSessions`, `messageWaiting`. Serialize:
     `inChain` (a call waiting its turn; `awaiting` is an action inside its
     awaits), `blockedCall`, `emptyStep`, `rehearsalFailed`. Controller:
     `knownQuietEdits`, `quietEditState`, `quietEditDeliveries`,
     `reportRejection`, `returningRejection`, `lastRejection`,
     `returnedAfterTaken`, `HasReached`, `CarriesRepeat`. ListenGrace:
     `inGrace`, `owesResponse`, `graceExpired`. Navigator: `timerArmed`,
     `navigatorReady`, `returnedWhileTyping`. Turns and Actions: `MaxActions`
     (was `MaxLen`), `EditKinds`, `ActionShapes`, `FullEffects`,
     `effectsPlayed`, `firstUnplayed`, `chunksLeft`. PairDefs' call kind is
     `stepOrEnd`. Player: `selectedTextStart`, `selectionStart`,
     `copiedStart`. BatchFile: `cursorFile`, `namedFile`, `actionsPlayed`,
     `namedAfter`, `looksIn`. Typing: `Chunks`, `indent`. Places: `fromStart`.
     LineIdentity: `lineFeedsBefore`, `lineFeedsAfter`, `offset`,
     `deleteLength`, `inserted` (the code's names), `textAfter`, `changedIds`.
     Rehearsal: `change`, `hasOwnIds`, `shownLines`, `otherChanges`, `nextId`,
     `ChangesTo`, `BatchChangesTo`, `batch`, `ghostsAfter`. Reload:
     `SplitRuns`, `selectionLine`, `selectionBefore`. FileText: `diskText`,
     `documentText`. EditorAdapter: `ownEdit`, `handled` (was `seen`),
     `changes`, `attribution`, `RightAttribution`, `WrongAttribution`,
     `programmerDuringSave`. EditEvents: `netChange`. Anchor: `rejectionLost`.
     ActionValidation: `otherText`. Panel: `currentMessage`, `messageFiled`,
     `entriesSinceMessage`, `WithMessageFiled`. PanelReplay:
     `liveViewSession`. PanelScroll: `entriesAboveView`, `lastEvent`. Draft:
     `hasDraft`, `reportedDraft`. RunBox: `playerPhase`, `boxShows`,
     `cleared`, `sessionLive`. Start: `MaxEnvironmentChanges`,
     `environmentChanges`, `cliAndFolder`, `FlipCliAndFolder`, `questions`,
     `question` and `page` fields, `deliveredQuestion`, `newestAnswered`,
     `chosenLocation`, `sidebarShows`, `startingNoteShown`, `sessionLive`.
     Calibration: `passageSource`, `staleDefault`, `rateUnapplied`,
     `sayRate`, `calibratedOnce`. Timeline: `timerStopped` (a sleep; `paused`
     is the variable), `pauseReasons`. Terminals: `Directories`, `directory`,
     `command`, `callTerminal`, `busyReused`, `awaitingIntegration`. Outside:
     `documentText`, `knownText`, `unreportedWrites`, `unreportedSave`,
     `writtenOutside`. Scroll: `MaxFollowSwitches`, `followSwitches`,
     `viewTop`, `landing`, `targetAtStart`, `awayReason`, `glideCut`,
     `scrollBeyondLastLine`. FollowMode: `activeFile`,
     `selfNavigationWindow`, `showCall`, `eventQueued`, `eventHandled`,
     `lookedAway`. PointFocus: `activeFile`, `stalePointRevealed`,
     `replyMovedEditor`, `cursorActed`. The ASSUMEs named for a constant that
     had been renamed follow it. Lines the longer names pushed past 80 columns
     were rewrapped; four headers that quoted a code name in backticks keep it.
     TLC: every config holds with its state count unchanged.

20.  **What the review of this branch found** (#198). An adversarial review of
     the squashed diff found names the sweep left behind; nothing it found
     changed a formula's meaning. Code and test comments that name a spec action
     follow the renames in every form of reference, not only the `specs/X.tla`
     one: 49 lines in `controller.ts`, `player.ts`, `lines.ts`, `link.ts`,
     `calibration.ts`, `panel.ts`, `editor.ts`, `extension.ts`, `setup.ts`,
     `outside.ts`, `timings.ts`, `terminal.ts`, `webview/panel.ts`,
     `integration.ts`, and `integration_paths.ts`. `specs/COVERAGE.md` names
     Anchor's `TakeHeld` and Resume's `Store` and `ReloadWindow`, and the
     README's `AddYours` row the `programmer` event. Spec comments name
     `MaxActions`, `actionsPlayed`, `EditAsProgrammer`, `SplitRuns`,
     `NoDirectory`, `MaxSessions`, `environmentChanges`, `RejectPerSocket`, and
     `followSwitches`; nine ASSUMEs are named for the constant they check
     (`AssumeNumSockets`, `AssumeNumCalls`, `AssumeRejectPerSocket`,
     `AssumeJunkFile`, `AssumeSplitRuns`, `AssumeDirectories` twice).
     FollowMode's held window is `"heldOpen"`, so `"awaiting"` there is the show
     call alone; BatchFile's flag is `stopped` again, set by `Stop`, since
     `rejected` is a batch that failed rehearsal (fix 6); Bridge's `recent` is
     `restorable`, the rename fix 19 listed. Every VARIABLES and CONSTANTS block
     whose comment column the renames left ragged is aligned at one column, its
     comments refilled; six header lines are 80 wide. Fix 18's sentences on
     `NoCallId` and the end actions say which specs have them. TLC: every config
     holds with its state count unchanged.
