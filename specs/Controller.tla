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
    RestoreRejected, \* TRUE: restore() puts back a report's `rejected` too
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

Batches == 1..NumBatches

Events == 1..NumEvents

QuietEdits == 1..NumQuietEdits

\* No batch: a call that submitted none, a report that carries no rejection.
\* Any value that is not a batch will do, so the config makes it a model value
\* (6.20).
NoBatch == CHOOSE v : v \notin Batches

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
    batchState,      \* each batch's state
    eventState,      \* each programmer event's state
    endState,        \* the programmer ending the session: an event's state
    batchDeliveries, \* how many times each batch has reached the agent
    eventDeliveries, \* how many times each event has reached the agent
    call,            \* the agent's call: "idle", "rehearsing", "blocked", or
                     \* "answering"
    callBatch,       \* the batch the current step submitted, or NoBatch
    canceled,        \* whether the agent canceled the current call
    cancels,         \* how many calls the agent has canceled
    rejected,        \* the batch whose rejection the answering report
                     \* carries, or NoBatch
    returned,        \* the batch whose rejection the returning report
                     \* carries, or NoBatch
    stale,           \* s.stale: an unreported interruption; new batches are
                     \* discarded
    held,            \* restore(): the returned rejections waiting to be
                     \* reported again, each with whether the agent may have
                     \* seen it
    completed,       \* each batch: it played to the end
    knownBatches,    \* each batch: the batches the agent had been told about
                     \* when it submitted it
    knownEvents,     \* each batch: the events the agent had been told about
    knownQuiet,      \* each batch: the programmer's quiet edits the agent had
                     \* been told about
    ended,           \* the programmer ended the session (s.ended)
    closed,          \* close(): this.session is null; the agent's calls fail
                     \* with no_session
    quietState,      \* each edit the programmer makes in their turn: an
                     \* event's state
    quietDeliveries, \* how many times each quiet edit has reached the agent
    turn,            \* s.scene.turn: "agent" or "user"
    lastRejected,    \* the batch whose rejection the last report the agent
                     \* took carried, or NoBatch
    repeat,          \* the returning report was handed back after the agent
                     \* took it (#67)
    mayRepeat,       \* s.mayRepeat: the next report is marked as one that may
                     \* repeat an earlier one
    unmarkedRepeat   \* something reached the agent again, in a report not
                     \* marked as a repeat

vars ==
    <<batchState, eventState, endState, batchDeliveries, eventDeliveries, call,
      callBatch, canceled, cancels, rejected, returned, stale, held, completed,
      knownBatches, knownEvents, knownQuiet, ended, closed, quietState,
      quietDeliveries, turn, lastRejected, repeat, mayRepeat, unmarkedRepeat>>

\* What the agent was told when it submitted each batch.
toldVars == <<completed, knownBatches, knownEvents, knownQuiet>>

\* What most actions leave alone.
keptVars ==
    <<quietDeliveries, turn, lastRejected, repeat, mayRepeat, unmarkedRepeat>>

--------------------------------------------------------------------------------

\* The values each variable can hold.
TypeOK ==
    /\ batchState \in [Batches -> BatchStates]
    /\ eventState \in [Events -> EventStates]
    /\ endState \in EventStates
    /\ batchDeliveries \in [Batches -> Nat]
    /\ eventDeliveries \in [Events -> Nat]
    /\ call \in {"idle", "rehearsing", "blocked", "answering"}
    /\ callBatch \in Batches \cup {NoBatch}
    /\ canceled \in BOOLEAN
    /\ cancels \in Nat
    /\ rejected \in Batches \cup {NoBatch}
    /\ returned \in Batches \cup {NoBatch}
    /\ stale \in BOOLEAN
    /\ held \subseteq [batch : Batches, repeat : BOOLEAN]
    /\ completed \in [Batches -> BOOLEAN]
    /\ knownBatches \in [Batches -> SUBSET Batches]
    /\ knownEvents \in [Batches -> SUBSET Events]
    /\ knownQuiet \in [Batches -> SUBSET QuietEdits]
    /\ ended \in BOOLEAN
    /\ closed \in BOOLEAN
    /\ quietState \in [QuietEdits -> EventStates]
    /\ quietDeliveries \in [QuietEdits -> Nat]
    /\ turn \in {"agent", "user"}
    /\ lastRejected \in Batches \cup {NoBatch}
    /\ repeat \in BOOLEAN
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
Got(x) == x \in {"answered", "delivered"}

\* A canceled call's report is on its way back.
Returning ==
    \/ \E b \in Batches : batchState[b] = "returning"
    \/ \E e \in Events : eventState[e] = "returning"
    \/ endState = "returning"
    \/ \E q \in QuietEdits : quietState[q] = "returning"

\* The relay holds the agent's call while a canceled call's report is on its
\* way back.
Sendable == ~WaitForReturn \/ ~Returning

\* The report carries something the agent already had.
Again ==
    \/ \E b \in Batches : batchState[b] = "inReport" /\ batchDeliveries[b] > 0
    \/ \E e \in Events : eventState[e] = "inReport" /\ eventDeliveries[e] > 0
    \/ \E q \in QuietEdits :
           quietState[q] = "inReport" /\ quietDeliveries[q] > 0

\* The rejections a report can hand out: any one held, or none.
HeldOrNone ==
    IF held = {}
    THEN {[batch |-> NoBatch, repeat |-> FALSE]}
    ELSE held

\* What the agent has to plan around in the returning report: an event, a
\* batch that didn't complete, a rejection.
ReturningNews ==
    \/ returned # NoBatch
    \/ endState = "returning"
    \/ \E e \in Events : eventState[e] = "returning"
    \/ \E b \in Batches : batchState[b] = "returning" /\ ~completed[b]
    \/ \E q \in QuietEdits : quietState[q] = "returning"

\* What restore() puts back for batch b of the returning report: its result
\* to report again, or its rejection, held with RestoreRejected and lost
\* without it.
Restored(b) ==
    IF b # returned
    THEN "unreported"
    ELSE IF RestoreRejected THEN "held" ELSE "lost"

--------------------------------------------------------------------------------

Init ==
    /\ batchState = [b \in Batches |-> "new"]
    /\ eventState = [e \in Events |-> "new"]
    /\ endState = "new"
    /\ batchDeliveries = [b \in Batches |-> 0]
    /\ eventDeliveries = [e \in Events |-> 0]
    /\ call = "idle"
    /\ callBatch = NoBatch
    /\ canceled = FALSE
    /\ cancels = 0
    /\ rejected = NoBatch
    /\ returned = NoBatch
    /\ stale = FALSE
    /\ held = {}
    /\ completed = [b \in Batches |-> FALSE]
    /\ knownBatches = [b \in Batches |-> {}]
    /\ knownEvents = [b \in Batches |-> {}]
    /\ knownQuiet = [b \in Batches |-> {}]
    /\ ended = FALSE
    /\ closed = FALSE
    /\ quietState = [q \in QuietEdits |-> "new"]
    /\ quietDeliveries = [q \in QuietEdits |-> 0]
    /\ turn = "agent"
    /\ lastRejected = NoBatch
    /\ repeat = FALSE
    /\ mayRepeat = FALSE
    /\ unmarkedRepeat = FALSE

\* `step` with a batch, the next one, in the agent's turn: it is rehearsed,
\* knowing what has reached the agent.
Submit(b) ==
    /\ call = "idle"
    /\ turn = "agent"
    /\ ~closed
    /\ Sendable
    /\ batchState[b] = "new"
    /\ \A c \in 1..(b - 1) : batchState[c] # "new"
    /\ batchState' = [batchState EXCEPT ![b] = "rehearsing"]
    /\ call' = "rehearsing"
    /\ callBatch' = b
    /\ canceled' = FALSE
    /\ knownBatches' = [knownBatches EXCEPT ![b] = Reached(batchDeliveries)]
    /\ knownEvents' = [knownEvents EXCEPT ![b] = Reached(eventDeliveries)]
    /\ knownQuiet' = [knownQuiet EXCEPT ![b] = Reached(quietDeliveries)]
    /\ UNCHANGED <<eventState, endState, batchDeliveries, eventDeliveries,
                   cancels, rejected, returned, stale, held, completed, ended,
                   closed, quietState, keptVars>>

\* `listen`: the call blocks until there is something to report.
Listen ==
    /\ call = "idle"
    /\ ~closed
    /\ Sendable
    /\ call' = "blocked"
    /\ callBatch' = NoBatch
    /\ canceled' = FALSE
    /\ UNCHANGED <<batchState, eventState, endState, batchDeliveries,
                   eventDeliveries, cancels, rejected, returned, stale, held,
                   toldVars, ended, closed, quietState, keptVars>>

\* rejectBatch(): the rehearsal fails, and the call answers at once with the
\* rejection and everything unreported.
FailRehearsal ==
    /\ call = "rehearsing"
    /\ ~stale
    /\ ~ended
    /\ batchState' =
           [Moved(batchState, "unreported", "inReport") EXCEPT
               ![callBatch] = "inReport"]
    /\ eventState' = Moved(eventState, "unreported", "inReport")
    /\ call' = "answering"
    /\ rejected' = callBatch
    /\ quietState' = Moved(quietState, "unreported", "inReport")
    /\ UNCHANGED <<endState, batchDeliveries, eventDeliveries, callBatch,
                   canceled, cancels, returned, stale, held, toldVars, ended,
                   closed, keptVars>>

\* The rehearsal passes: the batch is queued, or discarded when `stale` or
\* ended, then block(); a call canceled meanwhile does not block.
PassRehearsal ==
    /\ call = "rehearsing"
    /\ batchState' =
           [batchState EXCEPT
               ![callBatch] = IF stale \/ ended THEN "unreported" ELSE "queued"]
    /\ call' = IF canceled THEN "idle" ELSE "blocked"
    /\ UNCHANGED <<eventState, endState, batchDeliveries, eventDeliveries,
                   callBatch, canceled, cancels, rejected, returned, stale,
                   held, toldVars, ended, closed, quietState, keptVars>>

\* run(): the first batch queued starts playing, once none plays.
Play(b) ==
    /\ batchState[b] = "queued"
    /\ \A c \in Batches : batchState[c] # "playing"
    /\ \A c \in 1..(b - 1) : batchState[c] # "queued"
    /\ batchState' = [batchState EXCEPT ![b] = "playing"]
    /\ UNCHANGED <<eventState, endState, batchDeliveries, eventDeliveries,
                   call, callBatch, canceled, cancels, rejected, returned,
                   stale, held, toldVars, ended, closed, quietState, keptVars>>

\* run(): the playing batch plays to the end, to be reported.
Finish(b) ==
    /\ batchState[b] = "playing"
    /\ batchState' = [batchState EXCEPT ![b] = "unreported"]
    /\ completed' = [completed EXCEPT ![b] = TRUE]
    /\ UNCHANGED <<eventState, endState, batchDeliveries, eventDeliveries,
                   call, callBatch, canceled, cancels, rejected, returned,
                   stale, held, knownBatches, knownEvents, knownQuiet, ended,
                   closed, quietState, keptVars>>

\* An interrupting event: a message, an interrupt, an edit in the agent's
\* turn, or a turn change, which may leave the turn either way. Once the
\* session is ended, activeSession() is null and nothing happens.
Interrupt(e) ==
    /\ ~ended
    /\ eventState[e] = "new"
    /\ batchState' = Interrupted(batchState)
    /\ eventState' = [eventState EXCEPT ![e] = "unreported"]
    /\ stale' = TRUE
    /\ turn' \in {"agent", "user"}
    /\ UNCHANGED <<endState, batchDeliveries, eventDeliveries, call, callBatch,
                   canceled, cancels, rejected, returned, held, toldVars,
                   ended, closed, quietState, quietDeliveries, lastRejected,
                   repeat, mayRepeat, unmarkedRepeat>>

\* The programmer edits during their turn: userEdit records it, and
\* interrupts nothing.
EditQuietly(q) ==
    /\ ~ended
    /\ turn = "user"
    /\ quietState[q] = "new"
    /\ quietState' = [quietState EXCEPT ![q] = "unreported"]
    /\ UNCHANGED <<batchState, eventState, endState, batchDeliveries,
                   eventDeliveries, call, callBatch, canceled, cancels,
                   rejected, returned, stale, held, toldVars, ended, closed,
                   keptVars>>

\* endSession(): s.ended, the `end` event, interrupt().
EndSession ==
    /\ ~ended
    /\ batchState' = Interrupted(batchState)
    /\ endState' = "unreported"
    /\ stale' = TRUE
    /\ ended' = TRUE
    /\ UNCHANGED <<eventState, batchDeliveries, eventDeliveries, call,
                   callBatch, canceled, cancels, rejected, returned, held,
                   toldVars, closed, quietState, keptVars>>

\* finishCall -> snapshot: the report takes everything unreported and one held
\* rejection, if any. With the session ended, close() too, once no rejection
\* is held (DrainHeld).
Commit ==
    /\ call = "blocked"
    /\ \E h \in HeldOrNone :
           /\ batchState' =
                  [b \in Batches |->
                      IF batchState[b] = "unreported" \/ b = h.batch
                      THEN "inReport"
                      ELSE batchState[b]]
           /\ eventState' = Moved(eventState, "unreported", "inReport")
           /\ endState' = MovedOne(endState, "unreported", "inReport")
           /\ call' = "answering"
           /\ rejected' = h.batch
           /\ stale' = ((held \ {h}) # {})
           /\ held' = held \ {h}
           /\ closed' =
                  (closed \/ (ended /\ (~DrainHeld \/ (held \ {h}) = {})))
           /\ quietState' = Moved(quietState, "unreported", "inReport")
           /\ mayRepeat' = (mayRepeat \/ (MarkHeld /\ h.repeat))
           /\ UNCHANGED <<batchDeliveries, eventDeliveries, callBatch,
                          canceled, cancels, returned, toldVars, ended,
                          quietDeliveries, turn, lastRejected, repeat,
                          unmarkedRepeat>>

\* The agent cancels its call: a blocked one at once, else once it answers.
Cancel ==
    /\ call \in {"rehearsing", "blocked", "answering"}
    /\ ~canceled
    /\ call' = IF call = "blocked" THEN "idle" ELSE call
    /\ canceled' = TRUE
    /\ cancels' = cancels + 1
    /\ UNCHANGED <<batchState, eventState, endState, batchDeliveries,
                   eventDeliveries, callBatch, rejected, returned, stale, held,
                   toldVars, ended, closed, quietState, keptVars>>

\* The report reaches the agent.
Answer ==
    /\ call = "answering"
    /\ ~canceled
    /\ batchState' = Took(batchState)
    /\ eventState' = Took(eventState)
    /\ endState' = TookOne(endState)
    /\ batchDeliveries' = Counted(batchDeliveries, batchState)
    /\ eventDeliveries' = Counted(eventDeliveries, eventState)
    /\ call' = "idle"
    /\ rejected' = NoBatch
    /\ quietState' = Took(quietState)
    /\ quietDeliveries' = Counted(quietDeliveries, quietState)
    /\ lastRejected' = rejected
    /\ mayRepeat' = FALSE
    /\ unmarkedRepeat' = (unmarkedRepeat \/ (~mayRepeat /\ Again))
    /\ UNCHANGED <<callBatch, canceled, cancels, returned, stale, held,
                   toldVars, ended, closed, turn, repeat>>

\* The relay's `return`: the canceled call's report goes back to the editor,
\* one at a time.
Bounce ==
    /\ call = "answering"
    /\ canceled
    /\ returned = NoBatch
    /\ ~Returning
    /\ batchState' = Moved(batchState, "inReport", "returning")
    /\ eventState' = Moved(eventState, "inReport", "returning")
    /\ endState' = MovedOne(endState, "inReport", "returning")
    /\ call' = "idle"
    /\ rejected' = NoBatch
    /\ returned' = rejected
    /\ quietState' = Moved(quietState, "inReport", "returning")
    /\ repeat' = FALSE
    /\ UNCHANGED <<batchDeliveries, eventDeliveries, callBatch, canceled,
                   cancels, stale, held, toldVars, ended, closed,
                   quietDeliveries, turn, lastRejected, mayRepeat,
                   unmarkedRepeat>>

\* The agent's cancel comes after it took the answer: its SDK still sends it,
\* and the relay hands the report back, as one the agent may have seen
\* (`mayRepeat`, #67).
BounceLate ==
    /\ call = "idle"
    /\ ~Returning
    /\ returned = NoBatch
    /\ \/ \E b \in Batches : batchState[b] = "answered"
       \/ \E e \in Events : eventState[e] = "answered"
       \/ endState = "answered"
       \/ \E q \in QuietEdits : quietState[q] = "answered"
    /\ batchState' = Moved(batchState, "answered", "returning")
    /\ eventState' = Moved(eventState, "answered", "returning")
    /\ endState' = MovedOne(endState, "answered", "returning")
    /\ cancels' = cancels + 1
    /\ returned' = lastRejected
    /\ quietState' = Moved(quietState, "answered", "returning")
    /\ lastRejected' = NoBatch
    /\ repeat' = TRUE
    /\ UNCHANGED <<batchDeliveries, eventDeliveries, call, callBatch,
                   canceled, rejected, stale, held, toldVars, ended, closed,
                   quietDeliveries, turn, mayRepeat, unmarkedRepeat>>

\* restore(): dropped once the session is ended (activeSession() is null),
\* unless RestoreEnded, which puts a closed session back so the next call takes
\* the report. What the agent has to plan around makes the session stale.
Restore ==
    /\ Returning
    /\ IF ended /\ ~RestoreEnded
       THEN /\ batchState' = Moved(batchState, "returning", "lost")
            /\ eventState' = Moved(eventState, "returning", "lost")
            /\ endState' = MovedOne(endState, "returning", "lost")
            /\ quietState' = Moved(quietState, "returning", "lost")
            /\ UNCHANGED <<stale, held, closed, mayRepeat>>
       ELSE /\ batchState' =
                   [b \in Batches |->
                       IF batchState[b] = "returning"
                       THEN Restored(b)
                       ELSE batchState[b]]
            /\ eventState' = Moved(eventState, "returning", "unreported")
            /\ endState' = MovedOne(endState, "returning", "unreported")
            /\ stale' = (stale \/ ReturningNews)
            /\ held' =
                   IF RestoreRejected /\ returned # NoBatch
                   THEN held \cup {[batch |-> returned, repeat |-> repeat]}
                   ELSE held
            /\ closed' = FALSE
            /\ quietState' = Moved(quietState, "returning", "unreported")
            /\ mayRepeat' = (mayRepeat \/ repeat)
    /\ returned' = NoBatch
    /\ repeat' = FALSE
    /\ UNCHANGED <<batchDeliveries, eventDeliveries, call, callBatch, canceled,
                   cancels, rejected, toldVars, ended, quietDeliveries, turn,
                   lastRejected, unmarkedRepeat>>

Next ==
    \/ \E b \in Batches : Submit(b)
    \/ Listen
    \/ FailRehearsal
    \/ PassRehearsal
    \/ \E b \in Batches : Play(b)
    \/ \E b \in Batches : Finish(b)
    \/ \E e \in Events : Interrupt(e)
    \/ \E q \in QuietEdits : EditQuietly(q)
    \/ EndSession
    \/ Commit
    \/ Cancel
    \/ Answer
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
    /\ \A b \in Batches : WF_vars(Play(b)) /\ WF_vars(Finish(b))
    /\ WF_vars(Commit)
    /\ WF_vars(Answer)
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
    \A b \in Batches :
        batchState[b] = "playing" =>
            /\ \A e \in Events : eventState[e] # "new" => e \in knownEvents[b]
            /\ \A q \in QuietEdits :
                   quietState[q] # "new" => q \in knownQuiet[b]

\* A batch plays only if every batch before it completed, or the agent was
\* told it didn't.
PlaysAfterCompleted ==
    \A b \in Batches :
        batchState[b] = "playing" =>
            \A c \in 1..(b - 1) : completed[c] \/ c \in knownBatches[b]

\* Every batch submitted is eventually reported. Code that never
\* reported would fail it, so it says something must happen, as do the next
\* two.
BatchesDelivered ==
    \A b \in Batches : (batchState[b] # "new") ~> Got(batchState[b])

\* Every interrupting event is eventually reported.
EventsDelivered ==
    \A e \in Events : (eventState[e] # "new") ~> Got(eventState[e])

\* Every edit the programmer makes in their turn is eventually
\* reported.
QuietDelivered ==
    \A q \in QuietEdits : (quietState[q] # "new") ~> Got(quietState[q])

\* A blocked call returns. `Commit` is enabled whenever a call is blocked,
\* as the timer that block() sets for maxBlockMs ends it whether or not it is
\* ready; only a cancel ends it otherwise.
BlockedReturns == (call = "blocked") ~> (call # "blocked")

\* The programmer ending the session reaches the agent.
EndDelivered == (endState # "new") ~> Got(endState)

\* Cancels run out only so that the model is finite (6.8). It prunes exactly
\* the states a guard `cancels < MaxCancels` on Cancel and BounceLate never
\* reached, and neither action is under fairness, so the behaviors, and the
\* liveness properties' results, are the guard's (8.6).
Constraint == cancels <= MaxCancels

================================================================================
