# Changes to the specs

What changed in the TLA+ specs in `specs/` on 2026-10-19 and 2026-10-20,
newest first, for the architecture documents and any reader of an older spec to
be updated from. Each section names its pull request and issues;
[`specs/README.md`](README.md) has every spec as it is now, with its mutations,
the tests for each invariant, and the results.

## Cross-spec gaps, and two bugs fixed spec first

Pull request #221, issues #200, #219, and #220, 2026-10-20. An audit of every
spec against the code, then a check of what falls between related specs: where
the code takes a path a spec did not model, the spec gained it. Every new
mutation is listed in the README with the invariant it breaks.

| Spec | What it models now | Properties | Distinct states |
|---|---|---|---|
| `Rehearsal` | The programmer's edits (`EditAsProgrammer`, interrupting in the agent's turn, never followed) and turn changes (`ChangeTurn`); a batch rehearsed in the programmer's turn queues no edit (`RehearsalTurn`); `FailPlay(made)` for any batch that does not complete, with its change made or not; every report as `Report`, which with a batch still playing sets `staleReported`, and `EndStale` clears `stale` when that batch ends (#219). New constants `MaxProgrammerEdits` and `ReportWaitsForQueue`, variables `turn`, `programmerEdits`, and `staleReported` | `ReportedWhilePlaying` (new) | 79,999 -> 6,721,044 |
| `Serialize` | The programmer ending the session (`End`), the socket closing (`CloseSocket`), and an interrupt (`Interrupt`) at any point, with variables `ended`, `gone`, and `closed`; a call refused with `"noSession"`; a discarded batch (`"discarded"`), whose step waits until nothing is queued (#219) | `NeverBlockedClosed`, `ReadyWhenEnded`, `DiscardedWaits` (new) | 709 -> 3,646 |
| `Start` | Two asks in flight; `newestAnswered` is gone | `LatestAnswer` became the action property `LatestAnswerProp`: only an answer the page shows counts | 27,816 -> 242,152 |
| `Timeline` | A second sleep while one is pending (`SleepAgain`), and a replaced sleep's timer firing (`FireReplaced`) | `LatestPending` (new) | 176 -> 656 |
| `ListenGrace` | News that wakes no listen (`QuietNews`), and a timeout with news to report (`TimeoutWithNews`) | `NewsSkipsGraceProp` (new) | 20 -> 40 |
| `Resume` | The programmer ending a suspended session closes it at once, and an ended one closes on its agent's next call (`CloseEnded`) | `EndedHasAgent` (new); `WaitsProp` names `EndByProgrammer` | 62 -> 56 |
| `EditorAdapter` | An edit VS Code refuses (`RejectEdit`, `ownEdit` `"rejected"`), and `create`'s save (`StartCreateSave`, `FinishCreateSave`, variable `creating`); fairness on `ResolveEdit` | `EditsEnd` (new) | 1,464 -> 3,195 |
| `Discovery` | A window that refuses the relay's hello (variable `refuses`); `open()` goes on to the next | `FindsOpen` asks only for a window that welcomes the relay | 217 -> 782; `Discovery_InPlace` 302 -> 1,106 |
| `Outside` | The file's open document becoming the active editor again (`FocusDocument`) | | 564 -> 614 |
| `FollowMode` | `show` returning early for a file already in a visible editor (`ShowVisible`, `showCall` `"visible"`, variable `destinationVisible`) | | 13 -> 19 |
| `Scroll` | The programmer's turn as a reason not to follow (`"navigator"`), which drops a cut glide (variable `turnSinceFollow`) | `ComesInView` excuses a turn since follow mode last followed | 7,552 -> 14,131 |
| `BatchFile` | The selection a `delete` needs (variable `selected`, `no_selection`) | `EditAtCursorProp` asks a `delete` to have a selection | 207 -> 369 |
| `Reload` | A selection at the start of a changed run, which `mapThrough` keeps in place (`Holding`, `Moved`, variable `selectionAtStart`) | `StartOfRunStays` (new) | 160 -> 320 |
| `EditEvents` | One pending edit event a file (variable `events`) | `OnePendingEdit` (new) | 516, unchanged |
| `Calibration`, `Draft`, `RunBox`, `Timeline` | Comments only: they say what the code does | | unchanged |

The two bugs, each shown by TLC before the fix:

-   **#219:** a report while the batch an interrupt left playing still played
    cleared `stale`, so the next batch was rehearsed from that batch's fork,
    which missed the programmer's edit, and a line just read was refused.
    `ReportWaitsForQueue = FALSE` breaks `ReadIsStart`; the old `Return`
    breaks `DiscardedWaits`.
-   **#220:** after the link closed, `open()` still tried the next window,
    against `Wire`'s `OpenSocket` guard. `Wire` was right; only the code
    changed.

A sweep with every bound raised by one found only `Controller` at
`MaxCancels = 3`, which is #202.

## One meaning per term

Pull request #199, issues #197 and #198, 2026-10-19. Every term means one thing
across the specs, and every variable is named for what it holds. TLC held on
every config, with the state counts unchanged except where a model changed:
`Turns` 538 -> 1,234 (`type_fast` checks for the interrupt as `type` does),
`EditorAdapter` 311 -> 1,464 (the `disk` author and `Reload`), and `BatchFile`
121 -> 207 (a third file).

-   **The rules.** A term means one thing in every spec; a name of two or more
    words is lowerCamelCase, a string value too, as section 5.10 of
    [the style guide](tlaplus-style-guide.md) says; an absent value is a model
    value, not a string; a spec's one process is `phase`; id sets are `Num*`
    and bounds `Max*`; an action names its object where a verb was shared
    (`CloseSocket`, `OpenDocument`).
-   **`PairDefs.tla`**, new: the shared vocabulary, `ActionKinds`,
    `SessionPhases` and `NoSession`, `Views`, `PageStates`, `Calls` and
    `NoCall`, `PauseReasons`, `Files` and `NoFile`, and the letters `Letter`,
    `OtherLetter`, `Space`, `LineFeed`, `CarriageReturn`, with `Seqs`. The specs
    that used them `EXTENDS` it.
-   **The programmer is `programmer`, never `user`**, in the specs and on the
    wire: the turn, the Pause button's reason, the code, the tests, and
    `PROTOCOL.md`, with version 0.8.0.
-   **Models that changed:** `EditorAdapter` gained the `disk` author and
    `Reload`; `Turns` takes `ActionKinds` from `PairDefs`; `FollowMode`'s
    `LookAway` goes to `"otherFile"`; `BatchFile`'s `EditAtCursorProp` covers
    `type_fast`.
-   **The review (#198)** found names the sweep left behind, in 49 code and test
    comments and in nine `ASSUME` names; nothing it found changed a formula's
    meaning.

Every rename, by spec. A row with `none` in Was is new; one with `none` in Now
is gone, and says where it went:

| Spec | Kind | Was | Now |
|---|---|---|---|
| ActionValidation | definition | `None` | `NoProblem`, over the new set `Problems` |
| ActionValidation | value | `"absent"` | `"missing"` |
| ActionValidation | value | `"none"` | `NoProblem` |
| ActionValidation | value | `"other"` | `"otherText"` |
| ActionValidation | value | `"throws"` | `Throws`, a model value |
| Actions | variable | `current` | `action` |
| Actions | variable | `effects` | `effectsPlayed` |
| Actions | constant | `MaxLen` | `MaxActions` |
| Actions | definition | `Full` | `FullEffects` |
| Actions | definition | `Kinds` | `ActionShapes` |
| Actions | value | none | `"type_fast"` in the step table |
| Anchor | variable | `cursor` | `place` |
| Anchor | variable | `pending` | `mustAnchor` |
| Anchor | variable | `misplaced` | `wrongPlace` |
| Anchor | variable | `held` | `heldCount` |
| Anchor | variable | `lost` | `rejectionLost` |
| Anchor | definition | `Discard` | `StopShort` |
| Anchor | definition | `Deliver` | `TakeHeld` |
| BatchFile | variable | `cursor` | `cursorFile` |
| BatchFile | variable | `named` | `namedFile` |
| BatchFile | variable | `played` | `actionsPlayed` |
| BatchFile | constant | `Files` | `Files` in `PairDefs` |
| BatchFile | definition | `Names` | `NamingKinds` |
| BatchFile | definition | `Reject` | `Stop` |
| BatchFile | definition | `NoFile` | `NoFile` in `PairDefs` |
| BatchFile | definition | `Kinds` | `ActionKinds` in `PairDefs` |
| BatchFile | value | none | `"run"` and `"type_fast"` among its kinds |
| Bridge | variable | `sock` | `socketState` |
| Bridge | variable | `recent` | `restorable` |
| Bridge | definition | `Close` | `CloseSocket` |
| Bridge | definition | `EndSession` | `EndByProgrammer` |
| Bridge | definition | `CallEnd` | `EndByAgent` |
| Bridge | definition | `Phases` | `SessionPhases` in `PairDefs` |
| Bridge | definition | `NoSession` | `NoSession` in `PairDefs` |
| Calibration | variable | `passage` | `passageSource` |
| Calibration | variable | `pending` | `rateUnapplied` |
| Calibration | variable | `pause` | `calibratePause` |
| Calibration | variable | `say` | `sayRate` |
| Calibration | variable | `finished` | `calibratedOnce` |
| Calibration | variable | `runs` | `rounds` |
| Calibration | constant | `MaxRuns` | `MaxRounds` |
| Calibration | definition | `Finish` | `StopTimer` |
| Calibration | definition | `Cancel` | `CancelCalibration` |
| Calibration | definition | none | `Rates` |
| Calibration | value | `"armed"` | `"ready"` |
| Calibration | value | `"old"` | `"staleDefault"` |
| Controller | variable | `call` | `phase` |
| Controller | variable | `rejected` | `reportRejection` |
| Controller | variable | `returned` | `returningRejection` |
| Controller | variable | `knownQuiet` | `knownQuietEdits` |
| Controller | variable | `quietState` | `quietEditState` |
| Controller | variable | `quietDeliveries` | `quietEditDeliveries` |
| Controller | variable | `lastRejected` | `lastRejection` |
| Controller | variable | `repeat` | `returnedAfterTaken` |
| Controller | definition | `Batches` | `BatchIds` |
| Controller | definition | `Events` | `EventIds` |
| Controller | definition | `Got` | `HasReached` |
| Controller | definition | `Again` | `CarriesRepeat` |
| Controller | definition | `Finish` | `Complete` |
| Controller | definition | `EndSession` | `EndByProgrammer` |
| Controller | definition | `Answer` | `Deliver` |
| Controller | value | `"answering"` | `"committed"` |
| Controller | value | `"user"` | `"programmer"` |
| Discovery | variable | `win` | `windowState` |
| Discovery | variable | `relay` | `phase` |
| Discovery | variable | `tries` | `untried` |
| Discovery | variable | `conn` | `connectedTo` |
| Discovery | constant | `Junk` | `JunkFile` |
| Discovery | value | `"none"` | `"unstarted"` |
| Discovery | value | `"reused"` | `"pidReused"` |
| Draft | variable | `view` | `page` |
| Draft | variable | `draft` | `hasDraft` |
| Draft | variable | `sent` | `reportedDraft` |
| Draft | variable | `reply` | `replyPause` |
| Draft | variable | `views` | `pages` |
| Draft | constant | `MaxViews` | `MaxPages` |
| Draft | definition | `Type` | `TypeDraft` |
| Draft | definition | `Ready` | `LoadPage` |
| Draft | value | `"gone"` | `"disposed"` |
| Draft | value | `"live"` | `"loaded"` |
| EditEvents | variable | `base` | `baseline` |
| EditEvents | variable | `prog` | `byProgrammer` |
| EditEvents | variable | `intr` | `interrupts` |
| EditEvents | variable | `last` | `report` |
| EditEvents | variable | `steps` | `edits` |
| EditEvents | constant | `MaxSteps` | `MaxEdits` |
| EditEvents | definition | `Texts` | `Contents` |
| EditorAdapter | variable | `own` | `ownEdit` |
| EditorAdapter | variable | `made` | `changes` |
| EditorAdapter | variable | `wrong` | `wrongAttributions` |
| EditorAdapter | definition | `Note` | `WrongAttribution` |
| EditorAdapter | definition | `Edit` | `EditAsAgent` |
| EditorAdapter | definition | `Type` | `EditAsProgrammer` |
| EditorAdapter | definition | `OK` | `RightAttribution` |
| EditorAdapter | definition | none | `Reload` |
| EditorAdapter | value | `"programmer during save"` | `"programmerDuringSave"` |
| EditorAdapter | value | `"seen"` | `"handled"` |
| EditorAdapter | value | `"sent"` | `"awaiting"` |
| EditorAdapter | value | none | `"disk"`, an author |
| FileText | variable | `disk` | `diskText` |
| FileText | variable | `doc` | `documentText` |
| FileText | variable | `steps` | `changes` |
| FileText | constant | `MaxSteps` | `MaxChanges` |
| FileText | constant | `Fixed` | `PreferDirty` |
| FileText | definition | `Texts` | `Contents` |
| FileText | definition | `Missing` | `NoSuchFile` |
| FileText | definition | `Error` | `Internal` |
| FileText | definition | `Open` | `OpenDocument` |
| FileText | definition | `Close` | `CloseDocument` |
| FollowMode | variable | `active` | `activeFile` |
| FollowMode | variable | `window` | `selfNavigationWindow` |
| FollowMode | variable | `show` | `showCall` |
| FollowMode | variable | `paused` | `awayPause` |
| FollowMode | variable | `looked` | `lookedAway` |
| FollowMode | definition | `Expire` | `WindowExpires` |
| FollowMode | definition | `Handle` | `HandleEditorChange` |
| FollowMode | definition | `Resolve` | `ShowResolves` |
| FollowMode | definition | `Files` | `Files` in `PairDefs` |
| FollowMode | definition | `Other` | none: `LookAway` goes to `"otherFile"` |
| FollowMode | value | `"a"` | `"sourceFile"` |
| FollowMode | value | `"b"` | `"destinationFile"` |
| FollowMode | value | `"none"` | `"idle"` |
| FollowMode | value | `"event"` | `"eventQueued"` |
| FollowMode | value | `"done"` | `"eventHandled"` |
| FollowMode | value | `"held"` | `"heldOpen"` |
| LineIdentity | constant | `MaxLen` | `MaxChars` |
| LineIdentity | definition | `Newlines` | `LineFeeds` |
| LineIdentity | definition | `Apply` | `ApplyChange` |
| LineIdentity | value | `"n"`, `"x"` | `LineFeed`, `Letter` in `PairDefs` |
| ListenGrace | variable | `grace` | `inGrace` |
| ListenGrace | variable | `owes` | `owesResponse` |
| ListenGrace | variable | `pending` | `unreported` |
| ListenGrace | variable | `idle` | `timedOut` |
| ListenGrace | variable | `expired` | `graceExpired` |
| ListenGrace | variable | `quiet` | `absent` |
| ListenGrace | definition | `Refuse` | `FailRehearsal` |
| ListenGrace | definition | `TimeOut` | `Timeout` |
| ListenGrace | definition | `Act` | `Interrupt` |
| ListenGrace | definition | `GoQuiet` | `GoAbsent` |
| ListenGrace | definition | `NoYourMoveAfterAct` | `NoYourMoveAfterInterrupt` |
| ListenGrace | definition | `Calls` | `Calls` in `PairDefs` |
| ListenGrace | definition | `NoCall` | `NoCall` in `PairDefs` |
| ListenGrace | value | `"other"` | `"stepOrEnd"` |
| Navigator | variable | `timer` | `timerArmed` |
| Navigator | variable | `ready` | `navigatorReady` |
| Navigator | variable | `pending` | `unreported` |
| Navigator | variable | `early` | `returnedWhileTyping` |
| Navigator | definition | `Edit` | `EditAsProgrammer` |
| Navigator | definition | `Pause` | `Lull` |
| Navigator | value | `"listening"` | `"listen"` |
| Navigator | value | `"idle"` | `NoCall` |
| Outside | variable | `doc` | `documentText` |
| Outside | variable | `known` | `knownText` |
| Outside | variable | `pending` | `unreportedWrites` |
| Outside | variable | `notify` | `unreportedSave` |
| Outside | variable | `marked` | `badged` |
| Outside | variable | `outside` | `writtenOutside` |
| Outside | definition | `Open` | `OpenDocument` |
| Outside | definition | `Close` | `CloseDocument` |
| Outside | definition | `Create` | `Show` |
| Outside | definition | `Write` | `WriteOutside` |
| Outside | definition | `Report` | `WatcherReports` |
| Outside | definition | none | `NoDocument`, a model value |
| Panel | variable | `band` | `currentMessage` |
| Panel | variable | `flag` | `messageFiled` |
| Panel | variable | `added` | `entriesSinceMessage` |
| Panel | definition | `Flushed` | `WithMessageFiled` |
| PanelReplay | variable | `live` | `liveViewSession` |
| PanelReplay | constant | `MaxPosts` | `MaxEvents` |
| PanelReplay | definition | `NoSession` | `NoSessionEvent` |
| PanelScroll | variable | `above` | `entriesAboveView` |
| PanelScroll | variable | `last` | `lastEvent` |
| PanelScroll | variable | `before` | `topBefore` |
| PanelScroll | constant | `MaxEntries` | `MaxEvents` |
| PanelScroll | definition | `InRange` | `ViewAtEntry` |
| PanelScroll | definition | none | `EventKinds` |
| Places | constant | `MaxLen` | `MaxChars` |
| Places | definition | `Seqs` | `Seqs` in `PairDefs` |
| Places | value | `"x"`, `"y"`, `"n"` | `Letter`, `OtherLetter`, `LineFeed` in `PairDefs`; `"m"`, the marker, is no character now |
| Player | variable | `target` | `selectedTextStart` |
| Player | variable | `selection` | `selectionStart` |
| Player | variable | `copy` | `copiedStart` |
| Player | definition | `Outcomes` | `DeleteOutcomes` |
| Player | definition | `NoOutcome` | `NoDeleteOutcome` |
| Player | definition | `Begin` | `StartDelete` |
| PointFocus | variable | `active` | `activeFile` |
| PointFocus | variable | `looked` | `awayPause` |
| PointFocus | variable | `stale` | `stalePointRevealed` |
| PointFocus | variable | `jumped` | `replyMovedEditor` |
| PointFocus | variable | `acted` | `cursorActed` |
| PointFocus | definition | `Reply` | `SendReply` |
| PointFocus | definition | `Resume` | `ResumeAll` |
| PointFocus | definition | `Files` | `Files` in `PairDefs` |
| PointFocus | definition | `NoFile` | `NoFile` in `PairDefs` |
| PointFocus | value | `"a"` | `"sourceFile"` |
| PointFocus | value | `"b"` | `"destinationFile"` |
| PointFocus | value | `"other"` | `"otherFile"` |
| Rehearsal | variable | `seen` | `shownLines` |
| Rehearsal | variable | `bad` | `wrongLine` |
| Rehearsal | variable | `others` | `otherChanges` |
| Rehearsal | variable | `next` | `nextId` |
| Rehearsal | variable | `fresh` | `justRead` |
| Rehearsal | definition | `Ops` | `ChangesTo` |
| Rehearsal | definition | `BatchOps` | `BatchChangesTo` |
| Rehearsal | definition | `Editor` | `EditorLines` |
| Rehearsal | definition | `Start` | `Origin` |
| Rehearsal | definition | `Interrupted` | `QueuesAfterInterrupt` |
| Reload | variable | `sel` | `selectionLine` |
| Reload | variable | `orig` | `selectionBefore` |
| Reload | constant | `Refine` | `SplitRuns` |
| Reload | definition | `NewLines` | `Replacements` |
| Resume | variable | `state` | `session` |
| Resume | variable | `dir` | `directory` |
| Resume | variable | `conn` | `connected` |
| Resume | variable | `pending` | `messageWaiting` |
| Resume | variable | `saved` | `stored` |
| Resume | constant | `Dirs` | `Directories` |
| Resume | constant | `MaxIds` | `MaxSessions` |
| Resume | definition | `NoDir` | `NoDirectory` |
| Resume | definition | `Save` | `Store` |
| Resume | definition | `States` | `SessionPhases` in `PairDefs` |
| Resume | definition | `Views` | `Views` in `PairDefs` |
| Resume | definition | `Reload` | `ReloadWindow` |
| Resume | value | `"none"` | `NoSession` |
| RunBox | variable | `run` | `playerPhase` |
| RunBox | variable | `box` | `boxShows` |
| RunBox | variable | `active` | `sessionLive` |
| RunBox | value | `"off"` | `"cleared"` |
| Scroll | variable | `target` | `targetLine` |
| Scroll | variable | `top` | `viewTop` |
| Scroll | variable | `goal` | `landing` |
| Scroll | variable | `from` | `targetAtStart` |
| Scroll | variable | `away` | `awayReason` |
| Scroll | variable | `cut` | `glideCut` |
| Scroll | variable | `changes` | `followSwitches` |
| Scroll | variable | `beyond` | `scrollBeyondLastLine` |
| Scroll | constant | `MaxChanges` | `MaxFollowSwitches` |
| Scroll | definition | `Return` | `Follow` |
| Scroll | definition | `Settled` | `InView` |
| Scroll | definition | `Settles` | `ComesInView` |
| Scroll | definition | `Reasons` | `AwayReasons` |
| Scroll | value | `"no"` | `NotAway`, a model value |
| Scroll | value | `"paused"` | `"pause"` |
| Serialize | variable | `aborted` | `canceled` |
| Serialize | variable | `abortedAt` | `canceledAt` |
| Serialize | variable | `current` | `blockedCall` |
| Serialize | variable | `batch` | `queueState` |
| Serialize | variable | `outcome` | `settledAs` |
| Serialize | variable | `empty` | `emptyStep` |
| Serialize | variable | `rejected` | `rehearsalFailed` |
| Serialize | constant | `Fixed` | `AbortInBlock` |
| Serialize | definition | `Calls` | `CallIds` |
| Serialize | definition | `BatchStates` | `QueueStates` |
| Serialize | definition | `Outcomes` | `CallOutcomes` |
| Serialize | definition | `NoCall` | `NoCallId` |
| Serialize | definition | `NoBatch` | `NoQueueState` |
| Serialize | definition | `NoOutcome` | `NoCallOutcome` |
| Serialize | definition | `Reject` | `FailRehearsal` |
| Serialize | definition | `Abort` | `Cancel` |
| Serialize | definition | `Play` | `Played` |
| Serialize | definition | `Finish` | `Return` |
| Serialize | definition | `TimeOut` | `Timeout` |
| Serialize | definition | `Resolve` | `HandBack` |
| Serialize | value | `"cancelled"` | `"canceled"` |
| Serialize | value | `"waiting"` | `"inChain"` |
| Start | variable | `shown` | `visible` |
| Start | variable | `shownFor` | `visibleFor` |
| Start | variable | `cmd` | `cliAndFolder` |
| Start | variable | `asked` | `questions` |
| Start | variable | `pending` | `unanswered` |
| Start | variable | `setBy` | `deliveredQuestion` |
| Start | variable | `newest` | `newestAnswered` |
| Start | variable | `flips` | `environmentChanges` |
| Start | variable | `runs` | `starts` |
| Start | variable | `chosen` | `chosenLocation` |
| Start | variable | `front` | `sidebarShows` |
| Start | variable | `note` | `startingNoteShown` |
| Start | variable | `session` | `sessionLive` |
| Start | constant | `MaxFlips` | `MaxEnvironmentChanges` |
| Start | definition | `RunsAreClicks` | `StartsAreClicks` |
| Start | definition | `Answer` | `AnswerCheck` |
| Start | definition | `FlipCmd` | `FlipCliAndFolder` |
| Start | definition | `Exit` | `AgentExits` |
| Start | definition | `Settles` | `NoteGoes` |
| Start | definition | none | `NoQuestion`, a model value (was 0) |
| Start | value | `"gone"` | `"disposed"` |
| Start | value | `"live"` | `"loaded"` |
| Terminals | variable | `cmd` | `command` |
| Terminals | variable | `call` | `run` |
| Terminals | variable | `at` | `callTerminal` |
| Terminals | variable | `aborted` | `interrupted` |
| Terminals | variable | `reused` | `busyReused` |
| Terminals | variable | `dir` | `directory` |
| Terminals | constant | `MaxTerminals` | `NumTerminals` |
| Terminals | constant | `Dirs` | `Directories` |
| Terminals | definition | `CallStates` | `RunStates` |
| Terminals | definition | `Start` | `Acquire` |
| Terminals | definition | `Close` | `CloseTerminal` |
| Terminals | value | `"integration"` | `"awaitingIntegration"` |
| Terminals | value | `"returned"` | `"settled"` |
| Timeline | variable | `reasons` | `pauseReasons` |
| Timeline | variable | `pending` | `sleeping` |
| Timeline | definition | `Reasons` | `PauseReasons` in `PairDefs` |
| Timeline | value | `"user"` | `"programmer"` |
| Timeline | value | `"waiting"` | `"timerStopped"` |
| Timeline | value | `"away"`, `"calibrate"`, `"reply"` | `PauseReasons` in `PairDefs` |
| Turns | variable | `changes` | `turnChanges` |
| Turns | variable | `bad` | `wrongTurn` |
| Turns | constant | `Kinds` | `ActionKinds` in `PairDefs` |
| Turns | constant | `MaxLen` | `MaxActions` |
| Turns | constant | `MaxChanges` | `MaxTurns` |
| Turns | definition | `Edits` | `EditKinds` |
| Turns | definition | `Begin` | `StartHead` |
| Turns | definition | `Start` | `Perform` |
| Turns | value | `"start"` | `"before"` |
| Turns | value | `"user"` | `"programmer"` |
| Turns | value | none | `"type_fast"` among its kinds |
| Typing | constant | `MaxLen` | `MaxChars` |
| Typing | value | `"n"`, `"s"`, `"x"` | `LineFeed`, `Space`, `Letter` in `PairDefs` |
| Wire | variable | `sock` | `socketState` |
| Wire | variable | `cur` | `activeSocket` |
| Wire | variable | `call` | `pc` |
| Wire | variable | `on` | `sentOn` |
| Wire | variable | `pending` | `awaitingAnswer` |
| Wire | variable | `rejectedBy` | `severedBy` |
| Wire | variable | `garbage` | `garbageSent` |
| Wire | variable | `aborted` | `canceled` |
| Wire | variable | `noticed` | `cancelNoticed` |
| Wire | variable | `answered` | `answerAtClient` |
| Wire | variable | `marked` | `mayRepeat` |
| Wire | constant | `MaxSockets` | `NumSockets` |
| Wire | constant | `MaxCalls` | `NumCalls` |
| Wire | constant | `PerSocket` | `RejectPerSocket` |
| Wire | constant | `WaitCancelled` | `WaitForReturn` |
| Wire | definition | `Calls` | `CallIds` |
| Wire | definition | `Open` | `OpenSocket` |
| Wire | definition | `Close` | `CloseSocket` |
| Wire | definition | `Reject` | `RejectHello` |
| Wire | value | `"cancelled"` | `"canceled"` |
| Wire | value | `"no"` | `"unanswered"` |
| Wire | value | `"pending"` | `"awaitingAnswer"` |
| Wire | value | `"rejected"` | `"severed"` |
| Wire | value | `"requestedAborted"` | `"requestedCanceled"` |

## The specs follow the code, and three bugs fixed spec first

Pull request #196, issues #191, #192, #193, and #194, 2026-10-19. An audit of
every spec against the code; TLC passed every config, and the drift was in what
the specs said about the code.

| Spec | Change | Distinct states |
|---|---|---|
| `Draft` | `ClearOnTaken` (#191): a reply the calibration took left the reply pause in place; with `FALSE`, `ReplyMeansDraft` is violated | 12, unchanged |
| `Anchor` | `DropsHeld` (#193): a step refused as unanchored dropped a rejection `restore` held; new invariant `NoRejectionLost` | 46 -> 113 |
| `ListenGrace` | `EndOnAnyCall` (#194): every call ends the grace, not only one that blocked; with `FALSE`, `NoFalseYourMove` is violated | 20, unchanged |
| `Start` | Questions carry a number, and the CLI is read when it asks (#192); new invariant `LatestAnswer`, since replaced (see the first section) | 12,684 -> 27,816 |
| `Panel` | The session event that repeats a suspension (`RepeatSession`, #138) | 21, unchanged |
| `Timeline` | The calibration's pause reason, `"calibrate"` | 88 -> 176 |
| `Anchor`, `Serialize`, `FollowMode`, `EditEvents`, `Outside`, `Calibration` | Comments name the code as it is; `Anchor` says a failed batch needs an anchor too | unchanged |
