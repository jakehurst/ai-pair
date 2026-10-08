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
    outcome,   \* "none", "cancelled", "reported"
    empty,     \* the step has no actions: it only waits for the queued batches
    rejected   \* its batch failed its rehearsal, and the call answered with the rejection

vars == <<pc, aborted, abortedAt, current, batch, outcome, empty, rejected>>

Pcs == {"waiting", "rehearsing", "blocked", "committed", "settled"}

TypeOK ==
    /\ pc \in [Calls -> Pcs]
    /\ aborted \in [Calls -> BOOLEAN]
    /\ abortedAt \in [Calls -> Pcs \cup {"never"}]
    /\ current \in Calls \cup {0}
    /\ batch \in [Calls -> {"none", "queued", "done"}]
    /\ outcome \in [Calls -> {"none", "cancelled", "reported"}]
    /\ empty \in [Calls -> BOOLEAN]
    /\ rejected \in [Calls -> BOOLEAN]

Init ==
    /\ pc = [i \in Calls |-> "waiting"]
    /\ aborted = [i \in Calls |-> FALSE]
    /\ abortedAt = [i \in Calls |-> "never"]
    /\ current = 0
    /\ batch = [i \in Calls |-> "none"]
    /\ outcome = [i \in Calls |-> "none"]
    /\ empty \in [Calls -> BOOLEAN]
    /\ rejected = [i \in Calls |-> FALSE]

Set(f, i, v) == [f EXCEPT ![i] = v]

Guard(i) ==
    /\ pc[i] = "waiting"
    /\ \A j \in 1..(i - 1) : pc[j] = "settled"
    /\ IF aborted[i]
          THEN /\ pc' = Set(pc, i, "settled")
               /\ outcome' = Set(outcome, i, "cancelled")
          ELSE /\ pc' = Set(pc, i, "rehearsing")
               /\ UNCHANGED outcome
    /\ UNCHANGED <<aborted, abortedAt, current, batch, empty, rejected>>

\* An empty step blocks with no batch. A batch is queued, or done at once (discarded) when an
\* interrupt came first (`stale`) or the session ended.
Rehearsed(i) ==
    /\ pc[i] = "rehearsing"
    /\ IF empty[i] THEN UNCHANGED batch ELSE (\E b \in {"queued", "done"} : batch' = Set(batch, i, b))
    /\ IF Fixed /\ aborted[i]
          THEN /\ pc' = Set(pc, i, "settled")
               /\ outcome' = Set(outcome, i, "cancelled")
               /\ UNCHANGED current
          ELSE /\ pc' = Set(pc, i, "blocked")
               /\ current' = i
               /\ UNCHANGED outcome
    /\ UNCHANGED <<aborted, abortedAt, empty, rejected>>

\* The batch failed its rehearsal: rejectBatch answers with the rejection, queuing nothing.
RehearseFails(i) ==
    /\ pc[i] = "rehearsing" /\ ~empty[i]
    /\ pc' = Set(pc, i, "committed") /\ rejected' = Set(rejected, i, TRUE)
    /\ UNCHANGED <<aborted, abortedAt, current, batch, outcome, empty>>

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
    /\ UNCHANGED <<batch, empty, rejected>>

Play(i) ==
    /\ batch[i] = "queued"
    /\ \A j \in 1..(i - 1) : batch[j] # "queued"
    /\ batch' = Set(batch, i, "done")
    /\ UNCHANGED <<pc, aborted, abortedAt, current, outcome, empty, rejected>>

Commit(i) ==
    /\ pc' = Set(pc, i, "committed")
    /\ current' = 0
    /\ UNCHANGED <<aborted, abortedAt, batch, outcome, empty, rejected>>

Ready(i) == pc[i] = "blocked" /\ (IF empty[i] THEN (\A j \in Calls : batch[j] # "queued") ELSE batch[i] = "done") /\ Commit(i)

Timeout(i) == pc[i] = "blocked" /\ Commit(i)

Resolve(i) ==
    /\ pc[i] = "committed"
    /\ pc' = Set(pc, i, "settled")
    /\ outcome' = Set(outcome, i, "reported")
    /\ UNCHANGED <<aborted, abortedAt, current, batch, empty, rejected>>

Next == \E i \in Calls :
    \/ Guard(i) \/ Rehearsed(i) \/ RehearseFails(i) \/ Abort(i) \/ Play(i)
    \/ Ready(i) \/ Timeout(i) \/ Resolve(i)

Fairness == \A i \in Calls :
    /\ WF_vars(Guard(i)) /\ WF_vars(Rehearsed(i) \/ RehearseFails(i)) /\ WF_vars(Play(i))
    /\ WF_vars(Ready(i)) /\ WF_vars(Timeout(i)) /\ WF_vars(Resolve(i))

Spec == Init /\ [][Next]_vars /\ Fairness

\* S4: the blocked call is this.call, so at most one call is blocked.
BlockedIsCurrent == \A i \in Calls : pc[i] = "blocked" => current = i

\* S7: a step cancelled after Guard keeps its batch queued; one cancelled by
\* Guard never queues it.
CancelKeepsBatch == \A i \in Calls :
    ~empty[i] /\ outcome[i] = "cancelled" => (batch[i] = "none" <=> abortedAt[i] = "waiting")

\* L2: an abort that fires before the call commits to a report ends the call
\* with cancelled, or with its batch's rejection, which the relay hands back (Controller.tla).
CancelReleases == \A i \in Calls :
    (aborted[i] /\ pc[i] \in {"waiting", "rehearsing", "blocked"}) ~> (outcome[i] = "cancelled" \/ rejected[i])

\* L8: a call waiting its turn in the serialize chain eventually settles.
ChainProgresses == \A i \in Calls : pc[i] = "waiting" ~> pc[i] = "settled"

=============================================================================
