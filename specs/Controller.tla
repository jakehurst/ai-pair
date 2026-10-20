---- MODULE Controller ---------------------------------------------------------
(******************************************************************************)
(* Reports in packages/core/src/controller.ts: what the agent has to be told, *)
(* the snapshot a call takes, and a canceled call's report coming back        *)
(* through `return` (relay/src/link.ts) and `restore`. From issue #19: every  *)
(* event and batch result reaches the agent exactly once; a batch planned     *)
(* without knowledge of an interrupting event never plays; a batch plays only *)
(* if the one before it completed; every blocked call returns; and the        *)
(* programmer ending the session reaches the agent.                           *)
(*                                                                            *)
(* A canceled call's result can reach the relay after the agent made its next *)
(* call. Without WaitForReturn the relay forwards that call at once, so       *)
(* `return` can reach the editor after the next `step` was queued: `Restore`  *)
(* is enabled at any time after `Bounce`. With it, the relay sends the next   *)
(* call only once every canceled call has settled, after any `return`, on the *)
(* same socket, and the editor handles them in that order.                    *)
(******************************************************************************)
EXTENDS Naturals

CONSTANTS
    NumBatches,      \* how many batches the agent submits
    NumEvents,       \* how many programmer events (message, interrupt, edit,
                     \* turn)
    NumQuietEdits,   \* how many edits the programmer makes in their turn,
                     \* which interrupt nothing
    RestoreRejected, \* TRUE: restore() puts back a report's `reportRejection`
                     \* too
    WaitForReturn,   \* TRUE: the relay sends a call only once every canceled
                     \* call has settled
    RestoreEnded,    \* TRUE: restore() works on a session the programmer ended
    MaxCancels,      \* how many calls the model cancels, before or after their
                     \* answer
    MarkHeld,        \* TRUE: a held rejection the agent may have seen marks the
                     \* report it comes in
    DrainHeld        \* TRUE: an ended session closes only once no rejection is
                     \* held

ASSUME AssumeNumBatches == NumBatches \in Nat
ASSUME AssumeNumEvents == NumEvents \in Nat
ASSUME AssumeNumQuietEdits == NumQuietEdits \in Nat
ASSUME AssumeRestoreRejected == RestoreRejected \in BOOLEAN
ASSUME AssumeWaitForReturn == WaitForReturn \in BOOLEAN
ASSUME AssumeRestoreEnded == RestoreEnded \in BOOLEAN
ASSUME AssumeMaxCancels == MaxCancels \in Nat
ASSUME AssumeMarkHeld == MarkHeld \in BOOLEAN
ASSUME AssumeDrainHeld == DrainHeld \in BOOLEAN

BatchIds == 1..NumBatches

EventIds == 1..NumEvents

QuietEdits == 1..NumQuietEdits

\* No batch: a call that submitted none, a report that carries no rejection.
\* Any value that is not a batch will do, so the config makes it a model value
\* (6.20).
NoBatch == CHOOSE v : v \notin BatchIds

\* A batch's states. "answered": in the last report the agent took, which a
\* cancel arriving after it hands back.
BatchStates ==
    {"new", "rehearsing", "queued", "playing", "unreported", "inReport",
     "returning", "held", "answered", "delivered", "lost"}

\* An event's states, and a quiet edit's.
EventStates ==
    {"new", "unreported", "inReport", "returning", "answered", "delivered",
     "lost"}

VARIABLES
    batchState,          \* each batch's state
    eventState,          \* each programmer event's state
    endState,            \* the programmer ending the session: an event's state
    batchDeliveries,     \* how many times each batch has reached the agent
    eventDeliveries,     \* how many times each event has reached the agent
    phase,               \* the agent's call: "idle", "rehearsing", "blocked",
                         \* or "committed"
    callBatch,           \* the batch the current step submitted, or NoBatch
    canceled,            \* whether the agent canceled the current call
    cancels,             \* how many calls the agent has canceled
    reportRejection,     \* the batch whose rejection the committed report
                         \* carries, or NoBatch
    returningRejection,  \* the batch whose rejection the returning report
                         \* carries, or NoBatch
    stale,               \* s.stale: an unreported interruption; new batches are
                         \* discarded
    held,                \* restore(): the returned rejections waiting to be
                         \* reported again, each with whether the agent may have
                         \* seen it
    completed,           \* each batch: it played to the end
    knownBatches,        \* each batch: the batches the agent had been told
                         \* about when it submitted it
    knownEvents,         \* each batch: the events the agent had been told about
    knownQuietEdits,     \* each batch: the programmer's quiet edits the agent
                         \* had been told about
    ended,               \* the programmer ended the session (s.ended)
    closed,              \* close(): this.session is null; the agent's calls
                         \* fail with no_session
    quietEditState,      \* each edit the programmer makes in their turn: an
                         \* event's state
    quietEditDeliveries, \* how many times each quiet edit has reached the agent
    turn,                \* s.scene.turn: "agent" or "programmer"
    lastRejection,       \* the batch whose rejection the last report the agent
                         \* took carried, or NoBatch
    returnedAfterTaken,  \* the returning report was handed back after the agent
                         \* took it (#67)
    mayRepeat,           \* s.mayRepeat: the next report is marked as one that
                         \* may repeat an earlier one
    unmarkedRepeat       \* something reached the agent again, in a report not
                         \* marked as a repeat

vars ==
    <<batchState, eventState, endState, batchDeliveries, eventDeliveries, phase,
      callBatch, canceled, cancels, reportRejection, returningRejection, stale,
      held, completed, knownBatches, knownEvents, knownQuietEdits, ended,
      closed, quietEditState, quietEditDeliveries, turn, lastRejection,
      returnedAfterTaken, mayRepeat, unmarkedRepeat>>

\* What the agent was told when it submitted each batch.
toldVars == <<completed, knownBatches, knownEvents, knownQuietEdits>>

\* What most actions leave alone.
keptVars ==
    <<quietEditDeliveries, turn, lastRejection, returnedAfterTaken, mayRepeat,
      unmarkedRepeat>>

--------------------------------------------------------------------------------

\* The values each variable can hold.
TypeOK ==
    /\ batchState \in [BatchIds -> BatchStates]
    /\ eventState \in [EventIds -> EventStates]
    /\ endState \in EventStates
    /\ batchDeliveries \in [BatchIds -> Nat]
    /\ eventDeliveries \in [EventIds -> Nat]
    /\ phase \in {"idle", "rehearsing", "blocked", "committed"}
    /\ callBatch \in BatchIds \cup {NoBatch}
    /\ canceled \in BOOLEAN
    /\ cancels \in Nat
    /\ reportRejection \in BatchIds \cup {NoBatch}
    /\ returningRejection \in BatchIds \cup {NoBatch}
    /\ stale \in BOOLEAN
    /\ held \subseteq [batch : BatchIds, returnedAfterTaken : BOOLEAN]
    /\ completed \in [BatchIds -> BOOLEAN]
    /\ knownBatches \in [BatchIds -> SUBSET BatchIds]
    /\ knownEvents \in [BatchIds -> SUBSET EventIds]
    /\ knownQuietEdits \in [BatchIds -> SUBSET QuietEdits]
    /\ ended \in BOOLEAN
    /\ closed \in BOOLEAN
    /\ quietEditState \in [QuietEdits -> EventStates]
    /\ quietEditDeliveries \in [QuietEdits -> Nat]
    /\ turn \in {"agent", "programmer"}
    /\ lastRejection \in BatchIds \cup {NoBatch}
    /\ returnedAfterTaken \in BOOLEAN
    /\ mayRepeat \in BOOLEAN
    /\ unmarkedRepeat \in BOOLEAN

\* Each state of f that is `from` is now `to`.
Moved(f, from, to) == [x \in DOMAIN f |-> IF f[x] = from THEN to ELSE f[x]]

\* The state x, `to` if it was `from`.
MovedOne(x, from, to) == IF x = from THEN to ELSE x

\* interrupt(): what is queued is discarded, what plays stops.
Interrupted(f) ==
    [b \in DOMAIN f |->
        IF f[b] \in {"queued", "playing"} THEN "unreported" ELSE f[b]]

\* Taken: in the report the agent just took. The last report's items are now
\* "delivered".
TookOne(x) ==
    IF x = "inReport"
    THEN "answered"
    ELSE IF x = "answered" THEN "delivered" ELSE x

\* TookOne for each state of f.
Took(f) == [x \in DOMAIN f |-> TookOne(f[x])]

\* The items that have reached the agent, from their counts.
Reached(count) == {x \in DOMAIN count : count[x] > 0}

\* Each count, one more for each item in the report the agent takes.
Counted(count, state) ==
    [x \in DOMAIN count |->
        IF state[x] = "inReport" THEN count[x] + 1 ELSE count[x]]

\* The item reached the agent, in the last report or one before it.
HasReached(x) == x \in {"answered", "delivered"}

\* A canceled call's report is on its way back.
Returning ==
    \/ \E b \in BatchIds : batchState[b] = "returning"
    \/ \E e \in EventIds : eventState[e] = "returning"
    \/ endState = "returning"
    \/ \E q \in QuietEdits : quietEditState[q] = "returning"

\* The relay holds the agent's call while a canceled call's report is on its
\* way back.
Sendable == ~WaitForReturn \/ ~Returning

\* The report carries something the agent already had.
CarriesRepeat ==
    \/ \E b \in BatchIds : batchState[b] = "inReport" /\ batchDeliveries[b] > 0
    \/ \E e \in EventIds : eventState[e] = "inReport" /\ eventDeliveries[e] > 0
    \/ \E q \in QuietEdits :
           quietEditState[q] = "inReport" /\ quietEditDeliveries[q] > 0

\* The rejections a report can hand out: any one held, or none.
HeldOrNone ==
    IF held = {}
    THEN {[batch |-> NoBatch, returnedAfterTaken |-> FALSE]}
    ELSE held

\* What the agent has to plan around in the returning report: an event, a
\* batch that didn't complete, a rejection.
ReturningNews ==
    \/ returningRejection # NoBatch
    \/ endState = "returning"
    \/ \E e \in EventIds : eventState[e] = "returning"
    \/ \E b \in BatchIds : batchState[b] = "returning" /\ ~completed[b]
    \/ \E q \in QuietEdits : quietEditState[q] = "returning"

\* What restore() puts back for batch b of the returning report: its result
\* to report again, or its rejection, held with RestoreRejected and lost
\* without it.
Restored(b) ==
    IF b # returningRejection
    THEN "unreported"
    ELSE IF RestoreRejected THEN "held" ELSE "lost"

--------------------------------------------------------------------------------

Init ==
    /\ batchState = [b \in BatchIds |-> "new"]
    /\ eventState = [e \in EventIds |-> "new"]
    /\ endState = "new"
    /\ batchDeliveries = [b \in BatchIds |-> 0]
    /\ eventDeliveries = [e \in EventIds |-> 0]
    /\ phase = "idle"
    /\ callBatch = NoBatch
    /\ canceled = FALSE
    /\ cancels = 0
    /\ reportRejection = NoBatch
    /\ returningRejection = NoBatch
    /\ stale = FALSE
    /\ held = {}
    /\ completed = [b \in BatchIds |-> FALSE]
    /\ knownBatches = [b \in BatchIds |-> {}]
    /\ knownEvents = [b \in BatchIds |-> {}]
    /\ knownQuietEdits = [b \in BatchIds |-> {}]
    /\ ended = FALSE
    /\ closed = FALSE
    /\ quietEditState = [q \in QuietEdits |-> "new"]
    /\ quietEditDeliveries = [q \in QuietEdits |-> 0]
    /\ turn = "agent"
    /\ lastRejection = NoBatch
    /\ returnedAfterTaken = FALSE
    /\ mayRepeat = FALSE
    /\ unmarkedRepeat = FALSE

\* `step` with a batch, the next one, in the agent's turn: it is rehearsed,
\* knowing what has reached the agent.
Submit(b) ==
    /\ phase = "idle"
    /\ turn = "agent"
    /\ ~closed
    /\ Sendable
    /\ batchState[b] = "new"
    /\ \A c \in 1..(b - 1) : batchState[c] # "new"
    /\ batchState' = [batchState EXCEPT ![b] = "rehearsing"]
    /\ phase' = "rehearsing"
    /\ callBatch' = b
    /\ canceled' = FALSE
    /\ knownBatches' = [knownBatches EXCEPT ![b] = Reached(batchDeliveries)]
    /\ knownEvents' = [knownEvents EXCEPT ![b] = Reached(eventDeliveries)]
    /\ knownQuietEdits' =
           [knownQuietEdits EXCEPT ![b] = Reached(quietEditDeliveries)]
    /\ UNCHANGED <<eventState, endState, batchDeliveries, eventDeliveries,
                   cancels, reportRejection, returningRejection, stale, held,
                   completed, ended, closed, quietEditState, keptVars>>

\* `listen`: the call blocks until there is something to report.
Listen ==
    /\ phase = "idle"
    /\ ~closed
    /\ Sendable
    /\ phase' = "blocked"
    /\ callBatch' = NoBatch
    /\ canceled' = FALSE
    /\ UNCHANGED <<batchState, eventState, endState, batchDeliveries,
                   eventDeliveries, cancels, reportRejection,
                   returningRejection, stale, held, toldVars, ended, closed,
                   quietEditState, keptVars>>

\* rejectBatch(): the rehearsal fails, and the call answers at once with the
\* rejection and everything unreported.
FailRehearsal ==
    /\ phase = "rehearsing"
    /\ ~stale
    /\ ~ended
    /\ batchState' =
           [Moved(batchState, "unreported", "inReport") EXCEPT
               ![callBatch] = "inReport"]
    /\ eventState' = Moved(eventState, "unreported", "inReport")
    /\ phase' = "committed"
    /\ reportRejection' = callBatch
    /\ quietEditState' = Moved(quietEditState, "unreported", "inReport")
    /\ UNCHANGED <<endState, batchDeliveries, eventDeliveries, callBatch,
                   canceled, cancels, returningRejection, stale, held, toldVars,
                   ended, closed, keptVars>>

\* The rehearsal passes: the batch is queued, or discarded when `stale` or
\* ended, then block(); a call canceled meanwhile does not block.
PassRehearsal ==
    /\ phase = "rehearsing"
    /\ batchState' =
           [batchState EXCEPT
               ![callBatch] = IF stale \/ ended THEN "unreported" ELSE "queued"]
    /\ phase' = IF canceled THEN "idle" ELSE "blocked"
    /\ UNCHANGED <<eventState, endState, batchDeliveries, eventDeliveries,
                   callBatch, canceled, cancels, reportRejection,
                   returningRejection, stale, held, toldVars, ended, closed,
                   quietEditState, keptVars>>

\* run(): the first batch queued starts playing, once none plays.
Play(b) ==
    /\ batchState[b] = "queued"
    /\ \A c \in BatchIds : batchState[c] # "playing"
    /\ \A c \in 1..(b - 1) : batchState[c] # "queued"
    /\ batchState' = [batchState EXCEPT ![b] = "playing"]
    /\ UNCHANGED <<eventState, endState, batchDeliveries, eventDeliveries,
                   phase, callBatch, canceled, cancels, reportRejection,
                   returningRejection, stale, held, toldVars, ended, closed,
                   quietEditState, keptVars>>

\* run(): the playing batch plays to the end, to be reported.
Complete(b) ==
    /\ batchState[b] = "playing"
    /\ batchState' = [batchState EXCEPT ![b] = "unreported"]
    /\ completed' = [completed EXCEPT ![b] = TRUE]
    /\ UNCHANGED <<eventState, endState, batchDeliveries, eventDeliveries,
                   phase, callBatch, canceled, cancels, reportRejection,
                   returningRejection, stale, held, knownBatches, knownEvents,
                   knownQuietEdits, ended, closed, quietEditState, keptVars>>

\* An interrupting event: a message, an interrupt, an edit in the agent's
\* turn, or a turn change, which may leave the turn either way. Once the
\* session is ended, activeSession() is null and nothing happens.
Interrupt(e) ==
    /\ ~ended
    /\ eventState[e] = "new"
    /\ batchState' = Interrupted(batchState)
    /\ eventState' = [eventState EXCEPT ![e] = "unreported"]
    /\ stale' = TRUE
    /\ turn' \in {"agent", "programmer"}
    /\ UNCHANGED <<endState, batchDeliveries, eventDeliveries, phase, callBatch,
                   canceled, cancels, reportRejection, returningRejection, held,
                   toldVars, ended, closed, quietEditState, quietEditDeliveries,
                   lastRejection, returnedAfterTaken, mayRepeat,
                   unmarkedRepeat>>

\* The programmer edits during their turn: userEdit records it, and
\* interrupts nothing.
EditQuietly(q) ==
    /\ ~ended
    /\ turn = "programmer"
    /\ quietEditState[q] = "new"
    /\ quietEditState' = [quietEditState EXCEPT ![q] = "unreported"]
    /\ UNCHANGED <<batchState, eventState, endState, batchDeliveries,
                   eventDeliveries, phase, callBatch, canceled, cancels,
                   reportRejection, returningRejection, stale, held, toldVars,
                   ended, closed, keptVars>>

\* endSession(): s.ended, the `end` event, interrupt().
EndByProgrammer ==
    /\ ~ended
    /\ batchState' = Interrupted(batchState)
    /\ endState' = "unreported"
    /\ stale' = TRUE
    /\ ended' = TRUE
    /\ UNCHANGED <<eventState, batchDeliveries, eventDeliveries, phase,
                   callBatch, canceled, cancels, reportRejection,
                   returningRejection, held, toldVars, closed, quietEditState,
                   keptVars>>

\* finishCall -> snapshot: the report takes everything unreported and one held
\* rejection, if any. With the session ended, close() too, once no rejection
\* is held (DrainHeld).
Commit ==
    /\ phase = "blocked"
    /\ \E h \in HeldOrNone :
           /\ batchState' =
                  [b \in BatchIds |->
                      IF batchState[b] = "unreported" \/ b = h.batch
                      THEN "inReport"
                      ELSE batchState[b]]
           /\ eventState' = Moved(eventState, "unreported", "inReport")
           /\ endState' = MovedOne(endState, "unreported", "inReport")
           /\ phase' = "committed"
           /\ reportRejection' = h.batch
           /\ stale' = ((held \ {h}) # {})
           /\ held' = held \ {h}
           /\ closed' =
                  (closed \/ (ended /\ (~DrainHeld \/ (held \ {h}) = {})))
           /\ quietEditState' = Moved(quietEditState, "unreported", "inReport")
           /\ mayRepeat' = (mayRepeat \/ (MarkHeld /\ h.returnedAfterTaken))
           /\ UNCHANGED <<batchDeliveries, eventDeliveries, callBatch, canceled,
                          cancels, returningRejection, toldVars, ended,
                          quietEditDeliveries, turn, lastRejection,
                          returnedAfterTaken, unmarkedRepeat>>

\* The agent cancels its call: a blocked one at once, else once it answers.
Cancel ==
    /\ phase \in {"rehearsing", "blocked", "committed"}
    /\ ~canceled
    /\ phase' = IF phase = "blocked" THEN "idle" ELSE phase
    /\ canceled' = TRUE
    /\ cancels' = cancels + 1
    /\ UNCHANGED <<batchState, eventState, endState, batchDeliveries,
                   eventDeliveries, callBatch, reportRejection,
                   returningRejection, stale, held, toldVars, ended, closed,
                   quietEditState, keptVars>>

\* The report reaches the agent.
Deliver ==
    /\ phase = "committed"
    /\ ~canceled
    /\ batchState' = Took(batchState)
    /\ eventState' = Took(eventState)
    /\ endState' = TookOne(endState)
    /\ batchDeliveries' = Counted(batchDeliveries, batchState)
    /\ eventDeliveries' = Counted(eventDeliveries, eventState)
    /\ phase' = "idle"
    /\ reportRejection' = NoBatch
    /\ quietEditState' = Took(quietEditState)
    /\ quietEditDeliveries' = Counted(quietEditDeliveries, quietEditState)
    /\ lastRejection' = reportRejection
    /\ mayRepeat' = FALSE
    /\ unmarkedRepeat' = (unmarkedRepeat \/ (~mayRepeat /\ CarriesRepeat))
    /\ UNCHANGED <<callBatch, canceled, cancels, returningRejection, stale,
                   held, toldVars, ended, closed, turn, returnedAfterTaken>>

\* The relay's `return`: the canceled call's report goes back to the editor,
\* one at a time: Wire's `Reply` sends it, for a call its `Abort` marked, and
\* Bridge's `Restore` passes it on from the owner's socket.
Bounce ==
    /\ phase = "committed"
    /\ canceled
    /\ returningRejection = NoBatch
    /\ ~Returning
    /\ batchState' = Moved(batchState, "inReport", "returning")
    /\ eventState' = Moved(eventState, "inReport", "returning")
    /\ endState' = MovedOne(endState, "inReport", "returning")
    /\ phase' = "idle"
    /\ reportRejection' = NoBatch
    /\ returningRejection' = reportRejection
    /\ quietEditState' = Moved(quietEditState, "inReport", "returning")
    /\ returnedAfterTaken' = FALSE
    /\ UNCHANGED <<batchDeliveries, eventDeliveries, callBatch, canceled,
                   cancels, stale, held, toldVars, ended, closed,
                   quietEditDeliveries, turn, lastRejection, mayRepeat,
                   unmarkedRepeat>>

\* The agent's cancel comes after it took the answer: its SDK still sends it,
\* and the relay hands the report back, as one the agent may have seen
\* (`mayRepeat`, #67): Wire's `Abort` with HandBackAnswered.
BounceLate ==
    /\ phase = "idle"
    /\ ~Returning
    /\ returningRejection = NoBatch
    /\ \/ \E b \in BatchIds : batchState[b] = "answered"
       \/ \E e \in EventIds : eventState[e] = "answered"
       \/ endState = "answered"
       \/ \E q \in QuietEdits : quietEditState[q] = "answered"
    /\ batchState' = Moved(batchState, "answered", "returning")
    /\ eventState' = Moved(eventState, "answered", "returning")
    /\ endState' = MovedOne(endState, "answered", "returning")
    /\ cancels' = cancels + 1
    /\ returningRejection' = lastRejection
    /\ quietEditState' = Moved(quietEditState, "answered", "returning")
    /\ lastRejection' = NoBatch
    /\ returnedAfterTaken' = TRUE
    /\ UNCHANGED <<batchDeliveries, eventDeliveries, phase, callBatch, canceled,
                   reportRejection, stale, held, toldVars, ended, closed,
                   quietEditDeliveries, turn, mayRepeat, unmarkedRepeat>>

\* restore(): dropped once the session is ended (activeSession() is null),
\* unless RestoreEnded, which puts a closed session back so the next call takes
\* the report. What the agent has to plan around makes the session stale.
\* Bridge's `Restore` is the same `return`, for a session its last report
\* closed.
Restore ==
    /\ Returning
    /\ IF ended /\ ~RestoreEnded
       THEN /\ batchState' = Moved(batchState, "returning", "lost")
            /\ eventState' = Moved(eventState, "returning", "lost")
            /\ endState' = MovedOne(endState, "returning", "lost")
            /\ quietEditState' = Moved(quietEditState, "returning", "lost")
            /\ UNCHANGED <<stale, held, closed, mayRepeat>>
       ELSE /\ batchState' =
                   [b \in BatchIds |->
                       IF batchState[b] = "returning"
                       THEN Restored(b)
                       ELSE batchState[b]]
            /\ eventState' = Moved(eventState, "returning", "unreported")
            /\ endState' = MovedOne(endState, "returning", "unreported")
            /\ stale' = (stale \/ ReturningNews)
            /\ held' =
                   IF RestoreRejected /\ returningRejection # NoBatch
                   THEN held \cup {[batch |-> returningRejection,
                                    returnedAfterTaken |-> returnedAfterTaken]}
                   ELSE held
            /\ closed' = FALSE
            /\ quietEditState' = Moved(quietEditState, "returning",
                                       "unreported")
            /\ mayRepeat' = (mayRepeat \/ returnedAfterTaken)
    /\ returningRejection' = NoBatch
    /\ returnedAfterTaken' = FALSE
    /\ UNCHANGED <<batchDeliveries, eventDeliveries, phase, callBatch, canceled,
                   cancels, reportRejection, toldVars, ended,
                   quietEditDeliveries, turn, lastRejection, unmarkedRepeat>>

Next ==
    \/ \E b \in BatchIds : Submit(b)
    \/ Listen
    \/ FailRehearsal
    \/ PassRehearsal
    \/ \E b \in BatchIds : Play(b)
    \/ \E b \in BatchIds : Complete(b)
    \/ \E e \in EventIds : Interrupt(e)
    \/ \E q \in QuietEdits : EditQuietly(q)
    \/ EndByProgrammer
    \/ Commit
    \/ Cancel
    \/ Deliver
    \/ Bounce
    \/ BounceLate
    \/ Restore

\* The agent keeps listening, and the editor and the relay go on: a rehearsal
\* ends, batches play, a blocked call returns, a report is answered or handed
\* back, and restored. The agent's batches and cancels, and the programmer,
\* come when they do.
Fairness ==
    /\ WF_vars(Listen)
    /\ WF_vars(FailRehearsal \/ PassRehearsal)
    /\ \A b \in BatchIds : WF_vars(Play(b)) /\ WF_vars(Complete(b))
    /\ WF_vars(Commit)
    /\ WF_vars(Deliver)
    /\ WF_vars(Bounce)
    /\ WF_vars(Restore)

Spec == Init /\ [][Next]_vars /\ Fairness

--------------------------------------------------------------------------------

\* Delivered at least once since #67, and so: nothing reaches the agent twice
\* in a report that isn't marked as one that may repeat an earlier one.
NoUnmarkedRepeat == ~unmarkedRepeat

\* #28: while returned rejections are held, new steps are discarded, so none
\* is rejected.
HeldMeansStale == (held # {}) => stale

\* A batch plays only if the agent had been told of every event before it
\* plays, quiet ones too.
PlaysKnowingEvents ==
    \A b \in BatchIds :
        batchState[b] = "playing" =>
            /\ \A e \in EventIds : eventState[e] # "new" => e \in knownEvents[b]
            /\ \A q \in QuietEdits :
                   quietEditState[q] # "new" => q \in knownQuietEdits[b]

\* A batch plays only if every batch before it completed, or the agent was
\* told it didn't.
PlaysAfterCompleted ==
    \A b \in BatchIds :
        batchState[b] = "playing" =>
            \A c \in 1..(b - 1) : completed[c] \/ c \in knownBatches[b]

\* Every batch submitted is eventually reported. Code that never
\* reported would fail it, so it says something must happen, as do the next
\* two.
BatchesDelivered ==
    \A b \in BatchIds : (batchState[b] # "new") ~> HasReached(batchState[b])

\* Every interrupting event is eventually reported.
EventsDelivered ==
    \A e \in EventIds : (eventState[e] # "new") ~> HasReached(eventState[e])

\* Every edit the programmer makes in their turn is eventually
\* reported.
QuietDelivered ==
    \A q \in QuietEdits : (quietEditState[q] # "new")
        ~> HasReached(quietEditState[q])

\* A blocked call returns. `Commit` is enabled whenever a call is blocked,
\* as the timer that block() sets for maxBlockMs ends it whether or not it is
\* ready; only a cancel ends it otherwise.
BlockedReturns == (phase = "blocked") ~> (phase # "blocked")

\* The programmer ending the session reaches the agent.
EndDelivered == (endState # "new") ~> HasReached(endState)

\* Cancels run out only so that the model is finite (6.8). It prunes exactly
\* the states a guard `cancels < MaxCancels` on Cancel and BounceLate never
\* reached, and neither action is under fairness, so the behaviors, and the
\* liveness properties' results, are the guard's (8.6).
Constraint == cancels <= MaxCancels

================================================================================
