------------------------------ MODULE Controller ------------------------------
\* Reports in packages/core/src/controller.ts: what the agent has to be told, the
\* snapshot a call takes, and a cancelled call's report coming back through
\* `return` (relay/src/link.ts) and `restore`. Issue #19, S1.
EXTENDS Naturals

CONSTANTS
    B,                \* how many batches the agent submits
    E,                \* how many programmer events (message, interrupt, edit, turn)
    RestoreRejected,  \* TRUE: restore() puts back a report's `rejected` too
    MaxCancels        \* how many calls the agent cancels in a run, at most

Batches == 1..B
Events == 1..E
BatchStates == {"new", "rehearsing", "queued", "playing", "unreported", "inReport", "returning", "held", "delivered", "lost"}
EventStates == {"new", "unreported", "inReport", "returning", "delivered"}

VARIABLES
    bs,         \* each batch's state
    ev,         \* each programmer event's state
    dB, dE,     \* how many times each batch and each event has reached the agent
    call,       \* the agent's call: "idle", "rehearsing", "blocked", "answering"
    callBatch,  \* the batch the current step submitted, or 0
    cancelled,  \* whether the agent cancelled the current call
    cancels,    \* how many calls the agent has cancelled
    rejected,   \* the batch whose rejection the answering report carries, or 0
    returned,   \* the batch whose rejection the returning report carries, or 0
    stale,       \* s.stale: an unreported interruption; new batches are discarded
    held        \* restore(): the batches whose returned rejections wait to be reported again

vars == <<bs, ev, dB, dE, call, callBatch, cancelled, cancels, rejected, returned, stale, held>>

Set(f, x, v) == [f EXCEPT ![x] = v]

Moved(f, from, to) == [x \in DOMAIN f |-> IF f[x] = from THEN to ELSE f[x]]

Init ==
    /\ bs = [b \in Batches |-> "new"] /\ ev = [e \in Events |-> "new"]
    /\ dB = [b \in Batches |-> 0] /\ dE = [e \in Events |-> 0]
    /\ call = "idle" /\ callBatch = 0 /\ cancelled = FALSE /\ cancels = 0
    /\ rejected = 0 /\ returned = 0 /\ stale = FALSE /\ held = {}

Submit(b) ==
    /\ call = "idle" /\ bs[b] = "new" /\ \A c \in 1..(b - 1) : bs[c] # "new"
    /\ call' = "rehearsing" /\ callBatch' = b /\ cancelled' = FALSE
    /\ bs' = Set(bs, b, "rehearsing")
    /\ UNCHANGED <<ev, dB, dE, cancels, rejected, returned, stale, held>>

Listen ==
    /\ call = "idle"
    /\ call' = "blocked" /\ callBatch' = 0 /\ cancelled' = FALSE
    /\ UNCHANGED <<bs, ev, dB, dE, cancels, rejected, returned, stale, held>>

RehearseFails ==
    /\ call = "rehearsing" /\ ~stale
    /\ bs' = Set(Moved(bs, "unreported", "inReport"), callBatch, "inReport")
    /\ ev' = Moved(ev, "unreported", "inReport")
    /\ rejected' = callBatch /\ call' = "answering" /\ stale' = FALSE
    /\ UNCHANGED <<dB, dE, callBatch, cancelled, cancels, returned, held>>

RehearseOk ==
    /\ call = "rehearsing"
    /\ bs' = Set(bs, callBatch, IF stale THEN "unreported" ELSE "queued")
    /\ call' = IF cancelled THEN "idle" ELSE "blocked"
    /\ UNCHANGED <<ev, dB, dE, callBatch, cancelled, cancels, rejected, returned, stale, held>>

Play(b) ==
    /\ bs[b] = "queued" /\ \A c \in Batches : bs[c] # "playing" /\ \A d \in 1..(b - 1) : bs[d] # "queued"
    /\ bs' = Set(bs, b, "playing")
    /\ UNCHANGED <<ev, dB, dE, call, callBatch, cancelled, cancels, rejected, returned, stale, held>>

Finish(b) ==
    /\ bs[b] = "playing" /\ bs' = Set(bs, b, "unreported")
    /\ UNCHANGED <<ev, dB, dE, call, callBatch, cancelled, cancels, rejected, returned, stale, held>>

Programmer(e) ==
    /\ ev[e] = "new" /\ ev' = Set(ev, e, "unreported")
    /\ bs' = [b \in Batches |-> IF bs[b] \in {"queued", "playing"} THEN "unreported" ELSE bs[b]]
    /\ stale' = TRUE
    /\ UNCHANGED <<dB, dE, call, callBatch, cancelled, cancels, rejected, returned, held>>

Commit ==
    /\ call = "blocked"
    /\ \E h \in IF held = {} THEN {0} ELSE held :
          /\ bs' = [b \in Batches |-> IF bs[b] = "unreported" \/ b = h THEN "inReport" ELSE bs[b]]
          /\ rejected' = h /\ held' = held \ {h} /\ stale' = (held \ {h} # {})
    /\ ev' = Moved(ev, "unreported", "inReport")
    /\ call' = "answering"
    /\ UNCHANGED <<dB, dE, callBatch, cancelled, cancels, returned>>

Cancel ==
    /\ call \in {"rehearsing", "blocked", "answering"} /\ ~cancelled /\ cancels < MaxCancels
    /\ cancelled' = TRUE /\ cancels' = cancels + 1
    /\ call' = IF call = "blocked" THEN "idle" ELSE call
    /\ UNCHANGED <<bs, ev, dB, dE, callBatch, rejected, returned, stale, held>>

Answer ==
    /\ call = "answering" /\ ~cancelled
    /\ dB' = [b \in Batches |-> IF bs[b] = "inReport" THEN dB[b] + 1 ELSE dB[b]]
    /\ dE' = [e \in Events |-> IF ev[e] = "inReport" THEN dE[e] + 1 ELSE dE[e]]
    /\ bs' = Moved(bs, "inReport", "delivered") /\ ev' = Moved(ev, "inReport", "delivered")
    /\ call' = "idle" /\ rejected' = 0
    /\ UNCHANGED <<callBatch, cancelled, cancels, returned, stale, held>>

Bounce ==
    /\ call = "answering" /\ cancelled /\ returned = 0
    /\ \A b \in Batches : bs[b] # "returning"
    /\ \A e \in Events : ev[e] # "returning"
    /\ bs' = Moved(bs, "inReport", "returning") /\ ev' = Moved(ev, "inReport", "returning")
    /\ returned' = rejected /\ rejected' = 0 /\ call' = "idle"
    /\ UNCHANGED <<dB, dE, callBatch, cancelled, cancels, stale, held>>

Restore ==
    /\ (\E b \in Batches : bs[b] = "returning") \/ \E e \in Events : ev[e] = "returning"
    /\ bs' = [b \in Batches |->
          IF bs[b] # "returning" THEN bs[b]
          ELSE IF b # returned THEN "unreported" ELSE IF RestoreRejected THEN "held" ELSE "lost"]
    /\ ev' = Moved(ev, "returning", "unreported")
    /\ stale' = (stale \/ returned # 0 \/ \E e \in Events : ev[e] = "returning")
    /\ returned' = 0
    /\ held' = IF RestoreRejected /\ returned # 0 THEN held \cup {returned} ELSE held
    /\ UNCHANGED <<dB, dE, call, callBatch, cancelled, cancels, rejected>>

Next ==
    \/ \E b \in Batches : Submit(b) \/ Play(b) \/ Finish(b)
    \/ \E e \in Events : Programmer(e)
    \/ Listen \/ RehearseFails \/ RehearseOk \/ Commit \/ Cancel \/ Answer \/ Bounce \/ Restore

Fairness ==
    /\ WF_vars(Listen) /\ WF_vars(RehearseFails \/ RehearseOk) /\ WF_vars(Commit)
    /\ WF_vars(Answer) /\ WF_vars(Bounce) /\ WF_vars(Restore)
    /\ \A b \in Batches : WF_vars(Play(b)) /\ WF_vars(Finish(b))

Spec == Init /\ [][Next]_vars /\ Fairness

\* S1, safety: nothing reaches the agent twice.
ExactlyOnce == \A b \in Batches : dB[b] <= 1 /\ \A e \in Events : dE[e] <= 1

\* #28: while returned rejections are held, new steps are discarded, so none is rejected.
HeldMeansStale == held # {} => stale

\* S1, liveness: every batch submitted, and every event, is eventually reported.
BatchesDelivered == \A b \in Batches : bs[b] # "new" ~> bs[b] = "delivered"
EventsDelivered == \A e \in Events : ev[e] # "new" ~> ev[e] = "delivered"

===============================================================================
