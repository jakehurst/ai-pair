# Changes to the specs

What changed in the TLA+ specs in `specs/` from 10f2b64 (2026-10-18) to
fc8b717 (2026-10-20), described as one change, for the architecture documents
and any reader of an older spec to be updated from. [`specs/README.md`](README.md)
has every spec as it is now, with its mutations, the tests for each invariant,
and the results.

## Summary

-   Every term means one thing across the specs, every name says what it
    holds, and a shared module, `PairDefs.tla`, holds the vocabulary that
    several specs use.
-   Nineteen specs model more of what the code does, from a full audit against
    the code and a check of what falls between related specs.
-   Four bugs are fixed spec first: TLC shows each one with the old design, and
    passes with the fix. A fifth, in the relay, needed the code fixed only.
-   TLC holds on every config.

## Across the specs

-   **One meaning per term.** A term names one thing in every spec; where two
    specs used one word for two things, each got its own.
-   **Names say what they hold.** A name of two or more words is
    lowerCamelCase, a string value too, as section 5.10 of
    [the style guide](tlaplus-style-guide.md) says; id sets are `Num*` and
    bounds `Max*`; a spec's one process is `phase`; an action names its object
    where a verb was shared (`CloseSocket`, `OpenDocument`).
-   **An absent value is a model value**, never a string or a number:
    `NoProblem`, `NoQuestion`, `NotAway`, `NoDocument`, `Throws`.
-   **`PairDefs.tla`**, new, holds `ActionKinds`, `SessionPhases` and
    `NoSession`, `Views`, `PageStates`, `Calls` and `NoCall`, `PauseReasons`,
    `Files` and `NoFile`, and the letters `Letter`, `OtherLetter`, `Space`,
    `LineFeed`, and `CarriageReturn`, with `Seqs`. The specs that use them
    `EXTENDS` it.
-   **The programmer is `programmer`, never `user`**, in the specs and on the
    wire: the turn, the Pause button's reason, the code, the tests, and
    `PROTOCOL.md` (version 0.8.0).
-   **The files** in the specs that name them are `"sourceFile"`,
    `"destinationFile"`, and `"otherFile"`: where the cursor is, where it goes,
    and a file the programmer went to on their own.

## What each spec models now

Specs whose models did not change, only their names or comments, are left out.

| Spec | What it models now | Properties | Distinct states |
|---|---|---|---|
| `Actions` | `type_fast` in the step table | | 2,294, unchanged |
| `Anchor` | A step refused as unanchored hands over a rejection `restore` held first (`DropsHeld = FALSE`, `RefuseUnanchored`, `Restore`, `TakeHeld`, variables `heldCount` and `rejectionLost`); a failed batch needs an anchor too, as an interrupted or discarded one does | `NoRejectionLost` (new) | 46 -> 113 |
| `BatchFile` | Three files, from `PairDefs`; `run` and `type_fast` among its kinds; the selection a `delete` needs (variable `selected`, `no_selection`) | `EditAtCursorProp` covers `type_fast`, and asks a `delete` to have a selection | 121 -> 369 |
| `Discovery` | A window that refuses the relay's hello (variable `refuses`); `open()` goes on to the next | `FindsOpen` asks only for a window that welcomes the relay | 217 -> 782; `Discovery_InPlace` 302 -> 1,106 |
| `Draft` | A reply the calibration takes resumes the reply pause (`ClearOnTaken`, `SendToCalibration`) | `ReplyMeansDraft` holds with it | 12, unchanged |
| `EditEvents` | One pending edit event a file (variable `events`) | `OnePendingEdit` (new) | 516, unchanged |
| `EditorAdapter` | A file reloaded from disk (`Reload`, the `"disk"` author, attributed `other`); an edit VS Code refuses (`RejectEdit`, `ownEdit` `"rejected"`); `create`'s save (`StartCreateSave`, `FinishCreateSave`, variable `creating`); fairness on `ResolveEdit` | `EditsEnd` (new) | 311 -> 3,195 |
| `FollowMode` | `show` returning early for a file already in a visible editor (`ShowVisible`, `showCall` `"visible"`, variable `destinationVisible`); `LookAway` goes to `"otherFile"` | | 13 -> 19 |
| `ListenGrace` | Every call ends the grace, not only one that blocked (`EndOnAnyCall`, `Read`, `FailRehearsal`); news that wakes no listen (`QuietNews`), and a timeout with news to report (`TimeoutWithNews`) | `NewsSkipsGraceProp` (new); `NoFalseYourMove` holds with `EndOnAnyCall` | 20 -> 40 |
| `Outside` | The file's open document becoming the active editor again (`FocusDocument`) | | 564 -> 614 |
| `Panel` | The session event that repeats a suspension (`RepeatSession`) | | 21, unchanged |
| `Rehearsal` | The programmer's edits (`EditAsProgrammer`: interrupting in the agent's turn, never followed) and turn changes (`ChangeTurn`); a batch rehearsed in the programmer's turn queues no edit (`RehearsalTurn`); `FailPlay(made)` for any batch that does not complete, with its change made or not; every report as `Report`, which with a batch still playing sets `staleReported`, and `EndStale` clears `stale` when that batch ends. New constants `MaxProgrammerEdits` and `ReportWaitsForQueue`, variables `turn`, `programmerEdits`, and `staleReported` | `ReportedWhilePlaying` (new) | 79,999 -> 6,721,044 |
| `Reload` | A selection at the start of a changed run, which `mapThrough` keeps in place (`Holding`, `Moved`, variable `selectionAtStart`) | `StartOfRunStays` (new) | 160 -> 320 |
| `Resume` | The programmer ending a suspended session closes it at once, and an ended one closes on its agent's next call (`CloseEnded`) | `EndedHasAgent` (new); `WaitsProp` names `EndByProgrammer` | 62 -> 56 |
| `Scroll` | The programmer's turn as a reason not to follow (`"navigator"`), which drops a cut glide (variable `turnSinceFollow`) | `ComesInView` excuses a turn since follow mode last followed | 7,552 -> 14,131 |
| `Serialize` | The programmer ending the session (`End`), the socket closing (`CloseSocket`), and an interrupt (`Interrupt`) at any point, with variables `ended`, `gone`, and `closed`; a call refused with `"noSession"`; a discarded batch (`"discarded"`), whose step waits until nothing is queued | `NeverBlockedClosed`, `ReadyWhenEnded`, `DiscardedWaits` (new) | 709 -> 3,646 |
| `Start` | Numbered questions (`questions`, `deliveredQuestion`, `NoQuestion`), so only the latest one's answer reaches the page; the CLI read when it asks; two asks in flight | `LatestAnswerProp` (new): only an answer the page shows counts | 12,684 -> 242,152 |
| `Timeline` | The calibration's pause reason (`"calibrate"`); a second sleep while one is pending (`SleepAgain`), and a replaced sleep's timer firing (`FireReplaced`), with variables `unresolved` and `replaced` | `LatestPending` (new) | 88 -> 656 |
| `Turns` | The action kinds from `PairDefs`; `type_fast` checks for the interrupt as `type` does | | 538 -> 1,234 |

Comments in `Anchor`, `Calibration`, `Draft`, `EditEvents`, `FollowMode`,
`Outside`, `RunBox`, `Serialize`, `Start`, and `Timeline` say what the code does
now, and every action with code of its own has a comment in the code naming its
spec.

## Bugs fixed

The first four were shown by TLC with the old design, then fixed in the spec
and the code, with a test named for the invariant. The last needed the code
only.

| Issue | Spec | The bug | Shown by |
|---|---|---|---|
| #191 | `Draft` | A reply the calibration took left playback paused until the Resume button | `ClearOnTaken = FALSE` breaks `ReplyMeansDraft` |
| #193 | `Anchor` | A step refused as unanchored dropped a rejection `restore` held | `DropsHeld = TRUE` breaks `NoRejectionLost` |
| #194 | `ListenGrace` | Only a call that blocked ended the grace | `EndOnAnyCall = FALSE` breaks `NoFalseYourMove` |
| #219 | `Rehearsal`, `Serialize` | A report while the batch an interrupt left playing still played cleared `stale`, so the next batch was rehearsed without the programmer's edit, and a line just read was refused | `ReportWaitsForQueue = FALSE` breaks `ReadIsStart`; the old `Return` breaks `DiscardedWaits` |
| #220 | `Wire` | After the link closed, `open()` still tried the next window | `Wire`'s `OpenSocket` was right; only the code changed |

A sweep with every bound raised by one found only `Controller` at
`MaxCancels = 3`, which is #202, filed with the audit's other findings
(#201 to #218).

## Renames

Every name that changed, by spec. A Now that says "in `PairDefs`" moved there;
one that starts with "none" is gone, and says why.

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
| Anchor | variable | `cursor` | `place` |
| Anchor | variable | `pending` | `mustAnchor` |
| Anchor | variable | `misplaced` | `wrongPlace` |
| Anchor | definition | `Discard` | `StopShort` |
| BatchFile | variable | `cursor` | `cursorFile` |
| BatchFile | variable | `named` | `namedFile` |
| BatchFile | variable | `played` | `actionsPlayed` |
| BatchFile | constant | `Files` | `Files` in `PairDefs` |
| BatchFile | definition | `Names` | `NamingKinds` |
| BatchFile | definition | `Reject` | `Stop` |
| BatchFile | definition | `NoFile` | `NoFile` in `PairDefs` |
| BatchFile | definition | `Kinds` | `ActionKinds` in `PairDefs` |
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
| Calibration | definition | the set `{"default", "measured"}`, inline | `Rates` |
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
| EditorAdapter | value | `"programmer during save"` | `"programmerDuringSave"` |
| EditorAdapter | value | `"seen"` | `"handled"` |
| EditorAdapter | value | `"sent"` | `"awaiting"` |
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
| Outside | definition | `NoText`, for the document | `NoDocument` |
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
| PanelScroll | definition | the set `{"entry", "you", "scroll"}`, inline | `EventKinds` |
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
| Reload | definition | `After` | `Moved` |
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
| Start | variable | `pending` | `unanswered` |
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
| Start | value | `0`, for no question | `NoQuestion`, a model value |
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
| Timeline | value | `"away"`, `"reply"` | `PauseReasons` in `PairDefs` |
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
