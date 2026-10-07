---------------------------- MODULE Serialize ----------------------------
\* The chain of tool calls in packages/core/src/controller.ts: serialize,
\* step, and block. Issue #19; its first validation target is issue #1.
EXTENDS Naturals

CONSTANTS
    N,      \* how many step calls the agent makes, one after another
    Fixed   \* TRUE: block() checks signal.aborted (2cab175). FALSE: 57ac07f.

Calls == 1..N

VARIABLES
    pc,        \* "waiting", "rehearsing", "blocked", "committed", "settled"
    aborted,   \* whether the call's AbortSignal has fired
    abortedAt, \* the pc the call was at when its abort fired, or "never"
    current,   \* this.call: the call blocked in block(), or 0
    batch,     \* the call's batch: "none", "queued", "done"
    outcome    \* "none", "cancelled", "reported"

vars == <<pc, aborted, abortedAt, current, batch, outcome>>

Pcs == {"waiting", "rehearsing", "blocked", "committed", "settled"}

TypeOK ==
    /\ pc \in [Calls -> Pcs]
    /\ aborted \in [Calls -> BOOLEAN]
    /\ abortedAt \in [Calls -> Pcs \cup {"never"}]
    /\ current \in Calls \cup {0}
    /\ batch \in [Calls -> {"none", "queued", "done"}]
    /\ outcome \in [Calls -> {"none", "cancelled", "reported"}]

Init ==
    /\ pc = [i \in Calls |-> "waiting"]
    /\ aborted = [i \in Calls |-> FALSE]
    /\ abortedAt = [i \in Calls |-> "never"]
    /\ current = 0
    /\ batch = [i \in Calls |-> "none"]
    /\ outcome = [i \in Calls |-> "none"]

Set(f, i, v) == [f EXCEPT ![i] = v]

Guard(i) ==
    /\ pc[i] = "waiting"
    /\ \A j \in 1..(i - 1) : pc[j] = "settled"
    /\ IF aborted[i]
          THEN /\ pc' = Set(pc, i, "settled")
               /\ outcome' = Set(outcome, i, "cancelled")
          ELSE /\ pc' = Set(pc, i, "rehearsing")
               /\ UNCHANGED outcome
    /\ UNCHANGED <<aborted, abortedAt, current, batch>>

Rehearsed(i) ==
    /\ pc[i] = "rehearsing"
    /\ batch' = Set(batch, i, "queued")
    /\ IF Fixed /\ aborted[i]
          THEN /\ pc' = Set(pc, i, "settled")
               /\ outcome' = Set(outcome, i, "cancelled")
               /\ UNCHANGED current
          ELSE /\ pc' = Set(pc, i, "blocked")
               /\ current' = i
               /\ UNCHANGED outcome
    /\ UNCHANGED <<aborted, abortedAt>>

Abort(i) ==
    /\ ~aborted[i]
    /\ pc[i] # "settled"
    /\ aborted' = Set(aborted, i, TRUE)
    /\ abortedAt' = Set(abortedAt, i, pc[i])
    /\ IF pc[i] = "blocked"
          THEN /\ pc' = Set(pc, i, "settled")
               /\ outcome' = Set(outcome, i, "cancelled")
               /\ current' = 0
          ELSE UNCHANGED <<pc, outcome, current>>
    /\ UNCHANGED batch

Play(i) ==
    /\ batch[i] = "queued"
    /\ \A j \in 1..(i - 1) : batch[j] # "queued"
    /\ batch' = Set(batch, i, "done")
    /\ UNCHANGED <<pc, aborted, abortedAt, current, outcome>>

Commit(i) ==
    /\ pc' = Set(pc, i, "committed")
    /\ current' = 0
    /\ UNCHANGED <<aborted, abortedAt, batch, outcome>>

Ready(i) == pc[i] = "blocked" /\ batch[i] = "done" /\ Commit(i)

Timeout(i) == pc[i] = "blocked" /\ Commit(i)

Resolve(i) ==
    /\ pc[i] = "committed"
    /\ pc' = Set(pc, i, "settled")
    /\ outcome' = Set(outcome, i, "reported")
    /\ UNCHANGED <<aborted, abortedAt, current, batch>>

Next == \E i \in Calls :
    \/ Guard(i) \/ Rehearsed(i) \/ Abort(i) \/ Play(i)
    \/ Ready(i) \/ Timeout(i) \/ Resolve(i)

Fairness == \A i \in Calls :
    /\ WF_vars(Guard(i)) /\ WF_vars(Rehearsed(i)) /\ WF_vars(Play(i))
    /\ WF_vars(Ready(i)) /\ WF_vars(Timeout(i)) /\ WF_vars(Resolve(i))

Spec == Init /\ [][Next]_vars /\ Fairness

\* S4: the blocked call is this.call, so at most one call is blocked.
BlockedIsCurrent == \A i \in Calls : pc[i] = "blocked" => current = i

\* S7: a step cancelled after Guard keeps its batch queued; one cancelled by
\* Guard never queues it.
CancelKeepsBatch == \A i \in Calls :
    outcome[i] = "cancelled" => (batch[i] = "none" <=> abortedAt[i] = "waiting")

\* L2: an abort that fires before the call commits to a report ends the call
\* with cancelled.
CancelReleases == \A i \in Calls :
    (aborted[i] /\ pc[i] \in {"waiting", "rehearsing", "blocked"}) ~> outcome[i] = "cancelled"

\* L8: a call waiting its turn in the serialize chain eventually settles.
ChainProgresses == \A i \in Calls : pc[i] = "waiting" ~> pc[i] = "settled"

=============================================================================
