---- MODULE Serialize ----------------------------------------------------------
(******************************************************************************)
(* The chain of tool calls in packages/core/src/controller.ts: serialize,     *)
(* step, and block. Issue #19; its first validation target is issue #1. Each  *)
(* call waits its turn in the chain, rehearses its batch and queues it, then  *)
(* blocks until it is ready to report or its timer fires; an abort can come   *)
(* at any point before it settles. The constant Fixed switches the abort      *)
(* check at the top of block() (#1).                                          *)
(******************************************************************************)
EXTENDS Naturals

CONSTANTS
    NumCalls,   \* how many step calls the agent makes, one after another
    Fixed       \* TRUE: block() checks signal.aborted (2cab175). FALSE: the
                \* code at 57ac07f.

ASSUME AssumeNumCalls == NumCalls \in Nat
ASSUME AssumeFixed == Fixed \in BOOLEAN

\* The calls, in the order the agent makes them.
Calls == 1..NumCalls

\* Where a call is: waiting its turn in the chain, rehearsing its batch,
\* blocked in block(), committed to a report, or settled.
Pcs == {"waiting", "rehearsing", "blocked", "committed", "settled"}

\* A queued batch, and one played or discarded.
BatchStates == {"queued", "done"}

\* How a call settles: canceled, or with its report handed back.
Outcomes == {"cancelled", "reported"}

\* No call: this.call is null. Any value that is not a call will do, so the
\* config makes it a model value (6.20).
NoCall == CHOOSE v : v \notin Calls

\* No pc: the call's abort has not fired. Any value that is not a pc will do,
\* so the config makes it a model value (6.20).
NoPc == CHOOSE v : v \notin Pcs

\* No batch: an empty step, or one canceled before it queued its batch. Any
\* value that is not a batch state will do, so the config makes it a model
\* value (6.20).
NoBatch == CHOOSE v : v \notin BatchStates

\* No outcome: the call has not settled. Any value that is not an outcome will
\* do, so the config makes it a model value (6.20).
NoOutcome == CHOOSE v : v \notin Outcomes

VARIABLES
    pc,         \* where each call is, one of Pcs
    aborted,    \* whether the call's AbortSignal has fired
    abortedAt,  \* the pc the call was at when its abort fired, or NoPc
    current,    \* this.call: the call blocked in block(), or NoCall
    batch,      \* the call's batch: one of BatchStates, or NoBatch
    outcome,    \* how the call settled: one of Outcomes, or NoOutcome
    empty,      \* the step has no actions: it only waits for the queued
                \* batches
    rejected    \* its batch failed its rehearsal, and the call answered with
                \* the rejection

vars == <<pc, aborted, abortedAt, current, batch, outcome, empty, rejected>>

--------------------------------------------------------------------------------

\* The values each variable can hold.
TypeOK ==
    /\ pc \in [Calls -> Pcs]
    /\ aborted \in [Calls -> BOOLEAN]
    /\ abortedAt \in [Calls -> Pcs \cup {NoPc}]
    /\ current \in Calls \cup {NoCall}
    /\ batch \in [Calls -> BatchStates \cup {NoBatch}]
    /\ outcome \in [Calls -> Outcomes \cup {NoOutcome}]
    /\ empty \in [Calls -> BOOLEAN]
    /\ rejected \in [Calls -> BOOLEAN]

\* The call's batch plays next: queued, with no batch before it still queued.
AtHead(i) ==
    /\ batch[i] = "queued"
    /\ \A j \in 1..(i - 1) : batch[j] # "queued"

\* finishCall: the blocked call commits to a report, and this.call is cleared.
Commit(i) ==
    /\ pc' = [pc EXCEPT ![i] = "committed"]
    /\ current' = NoCall
    /\ UNCHANGED <<aborted, abortedAt, batch, outcome, empty, rejected>>

--------------------------------------------------------------------------------

Init ==
    /\ pc = [i \in Calls |-> "waiting"]
    /\ aborted = [i \in Calls |-> FALSE]
    /\ abortedAt = [i \in Calls |-> NoPc]
    /\ current = NoCall
    /\ batch = [i \in Calls |-> NoBatch]
    /\ outcome = [i \in Calls |-> NoOutcome]
    /\ empty \in [Calls -> BOOLEAN]
    /\ rejected = [i \in Calls |-> FALSE]

\* serialize: once every call before it has settled, the call runs, unless its
\* abort fired while it waited.
Guard(i) ==
    /\ pc[i] = "waiting"
    /\ \A j \in 1..(i - 1) : pc[j] = "settled"
    /\ IF aborted[i]
       THEN /\ pc' = [pc EXCEPT ![i] = "settled"]
            /\ outcome' = [outcome EXCEPT ![i] = "cancelled"]
       ELSE /\ pc' = [pc EXCEPT ![i] = "rehearsing"]
            /\ UNCHANGED outcome
    /\ UNCHANGED <<aborted, abortedAt, current, batch, empty, rejected>>

\* step, after its rehearsal: an empty step blocks with no batch. A batch is
\* queued, or done at once (discarded) when an interrupt came first (`stale`)
\* or the session ended. With Fixed, block() first checks for an abort that
\* fired during the rehearsal.
Rehearse(i) ==
    /\ pc[i] = "rehearsing"
    /\ IF Fixed /\ aborted[i]
       THEN /\ pc' = [pc EXCEPT ![i] = "settled"]
            /\ outcome' = [outcome EXCEPT ![i] = "cancelled"]
            /\ UNCHANGED current
       ELSE /\ pc' = [pc EXCEPT ![i] = "blocked"]
            /\ current' = i
            /\ UNCHANGED outcome
    /\ IF empty[i]
       THEN UNCHANGED batch
       ELSE \E b \in BatchStates : batch' = [batch EXCEPT ![i] = b]
    /\ UNCHANGED <<aborted, abortedAt, empty, rejected>>

\* rejectBatch, or rejectUnanchored: the batch failed its rehearsal, or did
\* not anchor the cursor, so the call answers with the rejection, queuing
\* nothing.
Reject(i) ==
    /\ pc[i] = "rehearsing"
    /\ ~empty[i]
    /\ pc' = [pc EXCEPT ![i] = "committed"]
    /\ rejected' = [rejected EXCEPT ![i] = TRUE]
    /\ UNCHANGED <<aborted, abortedAt, current, batch, outcome, empty>>

\* The call's AbortSignal fires. Its listener in block() is attached only once
\* the call blocks, and it releases the call only if it is this.call.
Abort(i) ==
    /\ ~aborted[i]
    /\ pc[i] # "settled"
    /\ IF pc[i] = "blocked"
       THEN /\ pc' = [pc EXCEPT ![i] = "settled"]
            /\ current' = NoCall
            /\ outcome' = [outcome EXCEPT ![i] = "cancelled"]
       ELSE UNCHANGED <<pc, current, outcome>>
    /\ aborted' = [aborted EXCEPT ![i] = TRUE]
    /\ abortedAt' = [abortedAt EXCEPT ![i] = pc[i]]
    /\ UNCHANGED <<batch, empty, rejected>>

\* The player finishes the call's batch, after every batch queued before it.
Play(i) ==
    /\ AtHead(i)
    /\ batch' = [batch EXCEPT ![i] = "done"]
    /\ UNCHANGED <<pc, aborted, abortedAt, current, outcome, empty, rejected>>

\* ready(): an empty step is ready once nothing is queued, any other once its
\* batch is done or plays next (#150); then finishCall.
Finish(i) ==
    /\ pc[i] = "blocked"
    /\ IF empty[i]
       THEN \A j \in Calls : batch[j] # "queued"
       ELSE batch[i] = "done" \/ AtHead(i)
    /\ Commit(i)

\* The maxBlockMs timer fires, and finishCall reports what there is.
TimeOut(i) ==
    /\ pc[i] = "blocked"
    /\ Commit(i)

\* withCursor(...).then(call.resolve): the report is handed back after the
\* commit.
Resolve(i) ==
    /\ pc[i] = "committed"
    /\ pc' = [pc EXCEPT ![i] = "settled"]
    /\ outcome' = [outcome EXCEPT ![i] = "reported"]
    /\ UNCHANGED <<aborted, abortedAt, current, batch, empty, rejected>>

\* Every call has settled: the agent makes no more calls.
Finished ==
    /\ \A i \in Calls : pc[i] = "settled"
    /\ UNCHANGED vars

Next ==
    \/ \E i \in Calls :
           \/ Guard(i)
           \/ Rehearse(i)
           \/ Reject(i)
           \/ Abort(i)
           \/ Play(i)
           \/ Finish(i)
           \/ TimeOut(i)
           \/ Resolve(i)
    \/ Finished

\* The controller goes on through each call, and the player through each
\* batch; an abort comes when it does. A rehearsal ends one way or the other,
\* so Rehearse and Reject share one condition.
Fairness ==
    \A i \in Calls :
        /\ WF_vars(Guard(i))
        /\ WF_vars(Rehearse(i) \/ Reject(i))
        /\ WF_vars(Play(i))
        /\ WF_vars(Finish(i))
        /\ WF_vars(TimeOut(i))
        /\ WF_vars(Resolve(i))

Spec == Init /\ [][Next]_vars /\ Fairness

--------------------------------------------------------------------------------

\* The blocked call is this.call, so at most one call is blocked.
BlockedIsCurrent == \A i \in Calls : (pc[i] = "blocked") => (current = i)

\* A blocked step whose batch plays next is ready to report (#150): a step
\* returns once the step before it has, not once its own batch has played.
ReadyAtHead ==
    \A i \in Calls :
        (pc[i] = "blocked" /\ ~empty[i] /\ AtHead(i)) => ENABLED Finish(i)

\* A step cancelled after Guard keeps its batch queued; one cancelled by
\* Guard never queues it.
CancelKeepsBatch ==
    \A i \in Calls :
        (~empty[i] /\ outcome[i] = "cancelled") =>
            ((batch[i] = NoBatch) <=> (abortedAt[i] = "waiting"))

\* An abort that fires before the call commits to a report ends the call
\* with cancelled, or with its batch's rejection, which the relay hands back
\* (Controller.tla).
CancelReleases ==
    \A i \in Calls :
        (aborted[i] /\ pc[i] \in {"waiting", "rehearsing", "blocked"}) ~>
            (outcome[i] = "cancelled" \/ rejected[i])

\* A call waiting its turn in the serialize chain eventually settles. A
\* chain that never ran a call would fail it, so it says something must
\* happen.
ChainProgresses ==
    \A i \in Calls : (pc[i] = "waiting") ~> (pc[i] = "settled")

================================================================================
