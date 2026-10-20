---- MODULE Serialize ----------------------------------------------------------
(******************************************************************************)
(* The chain of tool calls in packages/core/src/controller.ts: serialize,     *)
(* step, and block. Issue #19; its first validation target is issue #1. Each  *)
(* call waits its turn in the chain, rehearses its batch and queues it, then  *)
(* blocks until it is ready to report or its timer fires; an abort can come   *)
(* at any point before it settles. The constant AbortInBlock switches the     *)
(* abort check at the top of block() (#1).                                    *)
(*                                                                            *)
(* The programmer can end the session at any point, and the agent's socket    *)
(* can close, which closes an ended session, even while a step is rehearsed   *)
(* (#174). The bridge aborts the socket's calls before disconnect(), so no    *)
(* call blocks on a closed session, and ready() is true for an ended one.     *)
(*                                                                            *)
(* An interrupt discards the batches still queued, and a step on a stale      *)
(* session discards its own. A discarded step reports once nothing is queued, *)
(* as an empty step does, so its report comes after the batch the interrupt   *)
(* left playing (#219).                                                       *)
(******************************************************************************)
EXTENDS Naturals

CONSTANTS
    NumCalls,    \* how many step calls the agent makes, one after another
    AbortInBlock \* TRUE: block() checks signal.aborted (2cab175). FALSE: the
                 \* code at 57ac07f.

ASSUME AssumeNumCalls == NumCalls \in Nat
ASSUME AssumeAbortInBlock == AbortInBlock \in BOOLEAN

\* The calls, in the order the agent makes them.
CallIds == 1..NumCalls

\* Where a call is: waiting its turn in the chain, rehearsing its batch,
\* blocked in block(), committed to a report, or settled.
Pcs == {"inChain", "rehearsing", "blocked", "committed", "settled"}

\* A queued batch, one played, and one discarded.
QueueStates == {"queued", "done", "discarded"}

\* How a call settles: canceled, with its report handed back, or refused by
\* requireSession() with `no_session`.
CallOutcomes == {"canceled", "reported", "noSession"}

\* No call: this.call is null. Any value that is not a call will do, so the
\* config makes it a model value (6.20).
NoCallId == CHOOSE v : v \notin CallIds

\* No pc: the call's abort has not fired. Any value that is not a pc will do,
\* so the config makes it a model value (6.20).
NoPc == CHOOSE v : v \notin Pcs

\* No batch: an empty step, or one canceled before it queued its batch. Any
\* value that is not a batch state will do, so the config makes it a model
\* value (6.20).
NoQueueState == CHOOSE v : v \notin QueueStates

\* No outcome: the call has not settled. Any value that is not an outcome will
\* do, so the config makes it a model value (6.20).
NoCallOutcome == CHOOSE v : v \notin CallOutcomes

VARIABLES
    pc,              \* where each call is, one of Pcs
    canceled,        \* the call's AbortSignal has fired: the agent canceled it
    canceledAt,      \* the pc the call was at when it was canceled, or NoPc
    blockedCall,     \* this.call: the call blocked in block(), or NoCallId
    queueState,      \* the call's batch: one of QueueStates, or NoQueueState
    settledAs,       \* how the call settled: one of CallOutcomes, or
                     \* NoCallOutcome
    emptyStep,       \* the step has no actions: it only waits for the queued
                     \* batches
    rehearsalFailed, \* its batch failed its rehearsal, and the call answered
                     \* with the rejection
    ended,           \* s.ended: the programmer ended the session
    gone,            \* the agent's socket closed: disconnect() ran
    closed           \* this.session is null: close() ran

vars == <<pc, canceled, canceledAt, blockedCall, queueState, settledAs,
          emptyStep, rehearsalFailed, ended, gone, closed>>

\* The session's state, which the calls leave alone.
sessionVars == <<ended, gone, closed>>

--------------------------------------------------------------------------------

\* The values each variable can hold.
TypeOK ==
    /\ pc \in [CallIds -> Pcs]
    /\ canceled \in [CallIds -> BOOLEAN]
    /\ canceledAt \in [CallIds -> Pcs \cup {NoPc}]
    /\ blockedCall \in CallIds \cup {NoCallId}
    /\ queueState \in [CallIds -> QueueStates \cup {NoQueueState}]
    /\ settledAs \in [CallIds -> CallOutcomes \cup {NoCallOutcome}]
    /\ emptyStep \in [CallIds -> BOOLEAN]
    /\ rehearsalFailed \in [CallIds -> BOOLEAN]
    /\ ended \in BOOLEAN
    /\ gone \in BOOLEAN
    /\ closed \in BOOLEAN

\* The call's batch plays next: queued, with no batch before it still queued.
AtHead(i) ==
    /\ queueState[i] = "queued"
    /\ \A j \in 1..(i - 1) : queueState[j] # "queued"

\* finishCall: the blocked call commits to a report, and this.call is cleared.
\* A report on an ended session may close it: with no rejection held
\* (Controller's DrainHeld), which this spec does not track.
Commit(i) ==
    /\ pc' = [pc EXCEPT ![i] = "committed"]
    /\ blockedCall' = NoCallId
    /\ closed' \in {closed, closed \/ ended}
    /\ UNCHANGED <<canceled, canceledAt, queueState, settledAs, emptyStep,
                   rehearsalFailed, ended, gone>>

--------------------------------------------------------------------------------

Init ==
    /\ pc = [i \in CallIds |-> "inChain"]
    /\ canceled = [i \in CallIds |-> FALSE]
    /\ canceledAt = [i \in CallIds |-> NoPc]
    /\ blockedCall = NoCallId
    /\ queueState = [i \in CallIds |-> NoQueueState]
    /\ settledAs = [i \in CallIds |-> NoCallOutcome]
    /\ emptyStep \in [CallIds -> BOOLEAN]
    /\ rehearsalFailed = [i \in CallIds |-> FALSE]
    /\ ended = FALSE
    /\ gone = FALSE
    /\ closed = FALSE

\* serialize: once every call before it has settled, the call runs, unless its
\* abort fired while it waited; with the session closed, requireSession()
\* refuses it.
Guard(i) ==
    /\ pc[i] = "inChain"
    /\ \A j \in 1..(i - 1) : pc[j] = "settled"
    /\ IF canceled[i]
       THEN /\ pc' = [pc EXCEPT ![i] = "settled"]
            /\ settledAs' = [settledAs EXCEPT ![i] = "canceled"]
       ELSE IF closed
       THEN /\ pc' = [pc EXCEPT ![i] = "settled"]
            /\ settledAs' = [settledAs EXCEPT ![i] = "noSession"]
       ELSE /\ pc' = [pc EXCEPT ![i] = "rehearsing"]
            /\ UNCHANGED settledAs
    /\ UNCHANGED <<canceled, canceledAt, blockedCall, queueState, emptyStep,
                   rehearsalFailed, sessionVars>>

\* step, after its rehearsal: an empty step blocks with no batch. A batch is
\* queued, or done at once (discarded) when an interrupt came first (`stale`)
\* or the session ended. With AbortInBlock, block() first checks for an abort
\* that fired during the rehearsal.
Rehearse(i) ==
    /\ pc[i] = "rehearsing"
    /\ IF AbortInBlock /\ canceled[i]
       THEN /\ pc' = [pc EXCEPT ![i] = "settled"]
            /\ settledAs' = [settledAs EXCEPT ![i] = "canceled"]
            /\ UNCHANGED blockedCall
       ELSE /\ pc' = [pc EXCEPT ![i] = "blocked"]
            /\ blockedCall' = i
            /\ UNCHANGED settledAs
    /\ IF emptyStep[i]
       THEN UNCHANGED queueState
       ELSE \E b \in IF ended THEN {"discarded"} ELSE {"queued", "discarded"} :
                queueState' = [queueState EXCEPT ![i] = b]
    /\ UNCHANGED <<canceled, canceledAt, emptyStep, rehearsalFailed,
                   sessionVars>>

\* rejectBatch, or rejectUnanchored: the batch failed its rehearsal, or did
\* not anchor the cursor, so the call answers with the rejection, queuing
\* nothing.
FailRehearsal(i) ==
    /\ pc[i] = "rehearsing"
    /\ ~emptyStep[i]
    /\ pc' = [pc EXCEPT ![i] = "committed"]
    /\ rehearsalFailed' = [rehearsalFailed EXCEPT ![i] = TRUE]
    /\ UNCHANGED <<canceled, canceledAt, blockedCall, queueState, settledAs,
                   emptyStep, sessionVars>>

\* The call's AbortSignal fires. Its listener in block() is attached only once
\* the call blocks, and it releases the call only if it is this.call.
Cancel(i) ==
    /\ ~canceled[i]
    /\ pc[i] # "settled"
    /\ IF pc[i] = "blocked"
       THEN /\ pc' = [pc EXCEPT ![i] = "settled"]
            /\ blockedCall' = NoCallId
            /\ settledAs' = [settledAs EXCEPT ![i] = "canceled"]
       ELSE UNCHANGED <<pc, blockedCall, settledAs>>
    /\ canceled' = [canceled EXCEPT ![i] = TRUE]
    /\ canceledAt' = [canceledAt EXCEPT ![i] = pc[i]]
    /\ UNCHANGED <<queueState, emptyStep, rehearsalFailed, sessionVars>>

\* The player finishes the call's batch, after every batch queued before it.
Played(i) ==
    /\ AtHead(i)
    /\ queueState' = [queueState EXCEPT ![i] = "done"]
    /\ UNCHANGED <<pc, canceled, canceledAt, blockedCall, settledAs, emptyStep,
                   rehearsalFailed, sessionVars>>

\* ready(): true for an ended session; else an empty step, or one whose
\* batch was discarded (#219), is ready once nothing is queued, any other once
\* its batch is done or plays next (#150); then pump() calls finishCall on
\* `call.session`.
Return(i) ==
    /\ pc[i] = "blocked"
    /\ \/ ended
       \/ IF emptyStep[i] \/ queueState[i] = "discarded"
          THEN \A j \in CallIds : queueState[j] # "queued"
          ELSE queueState[i] = "done" \/ AtHead(i)
    /\ Commit(i)

\* The maxBlockMs timer fires, and finishCall reports what there is.
Timeout(i) ==
    /\ pc[i] = "blocked"
    /\ Commit(i)

\* withCursor(...).then(call.resolve): the report is handed back after the
\* commit.
HandBack(i) ==
    /\ pc[i] = "committed"
    /\ pc' = [pc EXCEPT ![i] = "settled"]
    /\ settledAs' = [settledAs EXCEPT ![i] = "reported"]
    /\ UNCHANGED <<canceled, canceledAt, blockedCall, queueState, emptyStep,
                   rehearsalFailed, sessionVars>>

\* endSession(): s.ended, and interrupt() discards every batch still queued;
\* the one playing, at the head, plays on (#151). A suspended session closes
\* at once (Bridge's `EndSuspended`).
End ==
    /\ ~ended
    /\ ended' = TRUE
    /\ queueState' =
           [i \in CallIds |->
               IF queueState[i] = "queued" /\ ~AtHead(i)
               THEN "discarded"
               ELSE queueState[i]]
    /\ closed' = (closed \/ gone)
    /\ UNCHANGED <<pc, canceled, canceledAt, blockedCall, settledAs, emptyStep,
                   rehearsalFailed, gone>>

\* interrupt(), for an edit, a turn, or a batch that failed: every batch
\* still queued is discarded; the one playing, at the head, plays on (#151).
Interrupt ==
    /\ \E i \in CallIds : queueState[i] = "queued" /\ ~AtHead(i)
    /\ queueState' =
           [i \in CallIds |->
               IF queueState[i] = "queued" /\ ~AtHead(i)
               THEN "discarded"
               ELSE queueState[i]]
    /\ UNCHANGED <<pc, canceled, canceledAt, blockedCall, settledAs, emptyStep,
                   rehearsalFailed, sessionVars>>

\* The agent's socket closes: the bridge aborts each of its calls not yet
\* settled, a blocked one released at once as in Cancel, then disconnect()
\* rejects this.call, if any, and closes an ended session (Bridge's
\* `CloseSocket`).
CloseSocket ==
    /\ ~gone
    /\ pc' = [i \in CallIds |-> IF pc[i] = "blocked" THEN "settled" ELSE pc[i]]
    /\ canceled' = [i \in CallIds |-> canceled[i] \/ pc[i] # "settled"]
    /\ canceledAt' =
           [i \in CallIds |->
               IF ~canceled[i] /\ pc[i] # "settled"
               THEN pc[i]
               ELSE canceledAt[i]]
    /\ blockedCall' = NoCallId
    /\ settledAs' =
           [i \in CallIds |->
               IF pc[i] = "blocked" THEN "canceled" ELSE settledAs[i]]
    /\ gone' = TRUE
    /\ closed' = (closed \/ ended)
    /\ UNCHANGED <<queueState, emptyStep, rehearsalFailed, ended>>

\* Every call has settled: the agent makes no more calls.
Finished ==
    /\ \A i \in CallIds : pc[i] = "settled"
    /\ UNCHANGED vars

Next ==
    \/ \E i \in CallIds :
           \/ Guard(i)
           \/ Rehearse(i)
           \/ FailRehearsal(i)
           \/ Cancel(i)
           \/ Played(i)
           \/ Return(i)
           \/ Timeout(i)
           \/ HandBack(i)
    \/ End
    \/ Interrupt
    \/ CloseSocket
    \/ Finished

\* The controller goes on through each call, and the player through each
\* batch; an abort comes when it does. A rehearsal ends one way or the other,
\* so Rehearse and FailRehearsal share one condition.
Fairness ==
    \A i \in CallIds :
        /\ WF_vars(Guard(i))
        /\ WF_vars(Rehearse(i) \/ FailRehearsal(i))
        /\ WF_vars(Played(i))
        /\ WF_vars(Return(i))
        /\ WF_vars(Timeout(i))
        /\ WF_vars(HandBack(i))

Spec == Init /\ [][Next]_vars /\ Fairness

--------------------------------------------------------------------------------

\* The blocked call is this.call, so at most one call is blocked.
BlockedIsCurrent == \A i \in CallIds : (pc[i] = "blocked") => (blockedCall = i)

\* A blocked step whose batch plays next is ready to report (#150): a step
\* returns once the step before it has, not once its own batch has played.
ReadyAtHead ==
    \A i \in CallIds :
        (pc[i] = "blocked" /\ ~emptyStep[i] /\ AtHead(i)) => ENABLED Return(i)

\* A step canceled after Guard keeps its batch queued; one canceled by
\* Guard never queues it.
CancelKeepsBatch ==
    \A i \in CallIds :
        (~emptyStep[i] /\ settledAs[i] = "canceled") =>
            ((queueState[i] = NoQueueState) <=> (canceledAt[i] = "inChain"))

\* An abort that fires before the call commits to a report ends the call
\* with canceled, or with its batch's rejection, which the relay hands back
\* (Controller.tla).
CancelReleases ==
    \A i \in CallIds :
        (canceled[i] /\ pc[i] \in {"inChain", "rehearsing", "blocked"}) ~>
            (settledAs[i] = "canceled" \/ rehearsalFailed[i])

\* #174: no call is blocked on a closed session, where nothing but its timer
\* would end it.
NeverBlockedClosed == \A i \in CallIds : (pc[i] = "blocked") => ~closed

\* A blocked call on an ended session is ready to report at once, whatever
\* still plays.
ReadyWhenEnded ==
    \A i \in CallIds : (pc[i] = "blocked" /\ ended) => ENABLED Return(i)

\* #219: a step whose batch was discarded waits while a batch is queued, so
\* its report does not tell the agent of an interrupt that batch still plays
\* through.
DiscardedWaits ==
    \A i \in CallIds :
        (/\ pc[i] = "blocked"
         /\ queueState[i] = "discarded"
         /\ ~ended
         /\ \E j \in CallIds : queueState[j] = "queued") => ~ENABLED Return(i)

\* A call waiting its turn in the serialize chain eventually settles. A
\* chain that never ran a call would fail it, so it says something must
\* happen.
ChainProgresses ==
    \A i \in CallIds : (pc[i] = "inChain") ~> (pc[i] = "settled")

================================================================================
