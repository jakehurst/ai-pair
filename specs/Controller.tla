------------------------------ MODULE Controller ------------------------------
\* Reports in packages/core/src/controller.ts: what the agent has to be told, the
\* snapshot a call takes, and a cancelled call's report coming back through
\* `return` (relay/src/link.ts) and `restore`. Issue #19: S1, S2, S3, L1 and L5.
\*
\* A cancelled call's result can reach the relay after the agent made its next call. Without
\* WaitForReturn the relay forwards that call at once, so `return` can reach the editor after
\* the next `step` was queued: `Restore` is enabled at any time after `Bounce`. With it, the
\* relay sends the next call only once every cancelled call has settled, after any `return`,
\* on the same socket, and the editor handles them in that order.
EXTENDS Naturals

CONSTANTS
    B,                 \* how many batches the agent submits
    E,                 \* how many programmer events (message, interrupt, edit, turn)
    RestoreRejected,   \* TRUE: restore() puts back a report's `rejected` too
    WaitForReturn,     \* TRUE: the relay sends a call only once every cancelled call has settled
    RestoreEnded,      \* TRUE: restore() works on a session the programmer ended
    MaxCancels         \* how many calls the agent cancels in a run, at most

Batches == 1..B
Events == 1..E
BatchStates == {"new", "rehearsing", "queued", "playing", "unreported", "inReport", "returning", "held", "delivered", "lost"}
EventStates == {"new", "unreported", "inReport", "returning", "delivered", "lost"}

VARIABLES
    bs,         \* each batch's state
    ev,         \* each programmer event's state
    endEv,      \* the programmer ending the session: an event's state
    dB, dE,     \* how many times each batch and each event has reached the agent
    call,       \* the agent's call: "idle", "rehearsing", "blocked", "answering"
    callBatch,  \* the batch the current step submitted, or 0
    cancelled,  \* whether the agent cancelled the current call
    cancels,    \* how many calls the agent has cancelled
    rejected,   \* the batch whose rejection the answering report carries, or 0
    returned,   \* the batch whose rejection the returning report carries, or 0
    stale,      \* s.stale: an unreported interruption; new batches are discarded
    held,       \* restore(): the batches whose returned rejections wait to be reported again
    ok,         \* each batch: it played to the end
    knewB,      \* each batch: the batches the agent had been told about when it submitted it
    knewE,      \* ...and the events
    ended,      \* the programmer ended the session (s.ended)
    closed      \* close(): this.session is null; the agent's calls fail with no_session

vars == <<bs, ev, endEv, dB, dE, call, callBatch, cancelled, cancels, rejected, returned, stale, held,
          ok, knewB, knewE, ended, closed>>
told == <<ok, knewB, knewE>>

Set(f, x, v) == [f EXCEPT ![x] = v]

Moved(f, from, to) == [x \in DOMAIN f |-> IF f[x] = from THEN to ELSE f[x]]
MovedOne(x, from, to) == IF x = from THEN to ELSE x

\* interrupt(): what is queued is discarded, what plays stops.
Interrupted(f) == [b \in DOMAIN f |-> IF f[b] \in {"queued", "playing"} THEN "unreported" ELSE f[b]]

Init ==
    /\ bs = [b \in Batches |-> "new"] /\ ev = [e \in Events |-> "new"] /\ endEv = "new"
    /\ dB = [b \in Batches |-> 0] /\ dE = [e \in Events |-> 0]
    /\ call = "idle" /\ callBatch = 0 /\ cancelled = FALSE /\ cancels = 0
    /\ rejected = 0 /\ returned = 0 /\ stale = FALSE /\ held = {}
    /\ ok = [b \in Batches |-> FALSE] /\ knewB = [b \in Batches |-> {}] /\ knewE = [b \in Batches |-> {}]
    /\ ended = FALSE /\ closed = FALSE

Returning == (\E b \in Batches : bs[b] = "returning") \/ (\E e \in Events : ev[e] = "returning") \/ endEv = "returning"

\* The relay holds the agent's call while a cancelled call's report is on its way back.
Sendable == ~WaitForReturn \/ ~Returning

Submit(b) ==
    /\ call = "idle" /\ ~closed /\ Sendable /\ bs[b] = "new" /\ \A c \in 1..(b - 1) : bs[c] # "new"
    /\ call' = "rehearsing" /\ callBatch' = b /\ cancelled' = FALSE
    /\ bs' = Set(bs, b, "rehearsing")
    /\ knewB' = Set(knewB, b, {c \in Batches : dB[c] > 0})
    /\ knewE' = Set(knewE, b, {e \in Events : dE[e] > 0})
    /\ UNCHANGED <<ev, endEv, dB, dE, cancels, rejected, returned, stale, held, ok, ended, closed>>

Listen ==
    /\ call = "idle" /\ ~closed /\ Sendable
    /\ call' = "blocked" /\ callBatch' = 0 /\ cancelled' = FALSE
    /\ UNCHANGED <<bs, ev, endEv, dB, dE, cancels, rejected, returned, stale, held, told, ended, closed>>

RehearseFails ==
    /\ call = "rehearsing" /\ ~stale /\ ~ended
    /\ bs' = Set(Moved(bs, "unreported", "inReport"), callBatch, "inReport")
    /\ ev' = Moved(ev, "unreported", "inReport")
    /\ rejected' = callBatch /\ call' = "answering" /\ stale' = FALSE
    /\ UNCHANGED <<endEv, dB, dE, callBatch, cancelled, cancels, returned, held, told, ended, closed>>

RehearseOk ==
    /\ call = "rehearsing"
    /\ bs' = Set(bs, callBatch, IF stale \/ ended THEN "unreported" ELSE "queued")
    /\ call' = IF cancelled THEN "idle" ELSE "blocked"
    /\ UNCHANGED <<ev, endEv, dB, dE, callBatch, cancelled, cancels, rejected, returned, stale, held, told, ended, closed>>

Play(b) ==
    /\ bs[b] = "queued" /\ \A c \in Batches : bs[c] # "playing" /\ \A d \in 1..(b - 1) : bs[d] # "queued"
    /\ bs' = Set(bs, b, "playing")
    /\ UNCHANGED <<ev, endEv, dB, dE, call, callBatch, cancelled, cancels, rejected, returned, stale, held, told, ended, closed>>

Finish(b) ==
    /\ bs[b] = "playing" /\ bs' = Set(bs, b, "unreported") /\ ok' = Set(ok, b, TRUE)
    /\ UNCHANGED <<ev, endEv, dB, dE, call, callBatch, cancelled, cancels, rejected, returned, stale, held, knewB, knewE, ended, closed>>

\* An interrupting event; once the session is ended, activeSession() is null and nothing happens.
Programmer(e) ==
    /\ ~ended /\ ev[e] = "new" /\ ev' = Set(ev, e, "unreported")
    /\ bs' = Interrupted(bs)
    /\ stale' = TRUE
    /\ UNCHANGED <<endEv, dB, dE, call, callBatch, cancelled, cancels, rejected, returned, held, told, ended, closed>>

\* endSession(): s.ended, the `end` event, interrupt().
EndSession ==
    /\ ~ended /\ ended' = TRUE /\ endEv' = "unreported"
    /\ bs' = Interrupted(bs) /\ stale' = TRUE
    /\ UNCHANGED <<ev, dB, dE, call, callBatch, cancelled, cancels, rejected, returned, held, told, closed>>

\* finishCall → snapshot; with the session ended, close() too.
Commit ==
    /\ call = "blocked"
    /\ \E h \in IF held = {} THEN {0} ELSE held :
          /\ bs' = [b \in Batches |-> IF bs[b] = "unreported" \/ b = h THEN "inReport" ELSE bs[b]]
          /\ rejected' = h /\ held' = held \ {h} /\ stale' = (held \ {h} # {})
    /\ ev' = Moved(ev, "unreported", "inReport") /\ endEv' = MovedOne(endEv, "unreported", "inReport")
    /\ call' = "answering" /\ closed' = (closed \/ ended)
    /\ UNCHANGED <<dB, dE, callBatch, cancelled, cancels, returned, told, ended>>

Cancel ==
    /\ call \in {"rehearsing", "blocked", "answering"} /\ ~cancelled /\ cancels < MaxCancels
    /\ cancelled' = TRUE /\ cancels' = cancels + 1
    /\ call' = IF call = "blocked" THEN "idle" ELSE call
    /\ UNCHANGED <<bs, ev, endEv, dB, dE, callBatch, rejected, returned, stale, held, told, ended, closed>>

Answer ==
    /\ call = "answering" /\ ~cancelled
    /\ dB' = [b \in Batches |-> IF bs[b] = "inReport" THEN dB[b] + 1 ELSE dB[b]]
    /\ dE' = [e \in Events |-> IF ev[e] = "inReport" THEN dE[e] + 1 ELSE dE[e]]
    /\ bs' = Moved(bs, "inReport", "delivered") /\ ev' = Moved(ev, "inReport", "delivered")
    /\ endEv' = MovedOne(endEv, "inReport", "delivered")
    /\ call' = "idle" /\ rejected' = 0
    /\ UNCHANGED <<callBatch, cancelled, cancels, returned, stale, held, told, ended, closed>>

Bounce ==
    /\ call = "answering" /\ cancelled /\ returned = 0
    /\ \A b \in Batches : bs[b] # "returning"
    /\ \A e \in Events : ev[e] # "returning"
    /\ endEv # "returning"
    /\ bs' = Moved(bs, "inReport", "returning") /\ ev' = Moved(ev, "inReport", "returning")
    /\ endEv' = MovedOne(endEv, "inReport", "returning")
    /\ returned' = rejected /\ rejected' = 0 /\ call' = "idle"
    /\ UNCHANGED <<dB, dE, callBatch, cancelled, cancels, stale, held, told, ended, closed>>

\* restore(): dropped once the session is ended (activeSession() is null), unless RestoreEnded,
\* which puts a closed session back so the next call takes the report.
Restore ==
    /\ Returning
    /\ IF ended /\ ~RestoreEnded
          THEN /\ bs' = Moved(bs, "returning", "lost") /\ ev' = Moved(ev, "returning", "lost")
               /\ endEv' = MovedOne(endEv, "returning", "lost")
               /\ UNCHANGED <<stale, held, closed>>
          ELSE LET \* What the agent has to plan around: an event, a batch that didn't complete, a rejection.
                   news == returned # 0 \/ endEv = "returning" \/ (\E e \in Events : ev[e] = "returning")
                           \/ (\E b \in Batches : bs[b] = "returning" /\ ~ok[b])
                   back == [b \in Batches |->
                              IF bs[b] # "returning" THEN bs[b]
                              ELSE IF b # returned THEN "unreported" ELSE IF RestoreRejected THEN "held" ELSE "lost"]
               IN /\ bs' = back
                  /\ ev' = Moved(ev, "returning", "unreported")
                  /\ endEv' = MovedOne(endEv, "returning", "unreported")
                  /\ stale' = (stale \/ news)
                  /\ held' = IF RestoreRejected /\ returned # 0 THEN held \cup {returned} ELSE held
                  /\ closed' = FALSE
    /\ returned' = 0
    /\ UNCHANGED <<dB, dE, call, callBatch, cancelled, cancels, rejected, told, ended>>

Next ==
    \/ \E b \in Batches : Submit(b) \/ Play(b) \/ Finish(b)
    \/ \E e \in Events : Programmer(e)
    \/ EndSession
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

\* S2: a batch plays only if the agent had been told of every event before it plays.
PlaysKnowingEvents ==
    \A b \in Batches : bs[b] = "playing" => \A e \in Events : ev[e] # "new" => e \in knewE[b]

\* S3: a batch plays only if every batch before it completed, or the agent was told it didn't.
PlaysAfterCompleted ==
    \A b \in Batches : bs[b] = "playing" => \A c \in 1..(b - 1) : ok[c] \/ c \in knewB[b]

\* S1, liveness: every batch submitted, and every event, is eventually reported.
BatchesDelivered == \A b \in Batches : bs[b] # "new" ~> bs[b] = "delivered"
EventsDelivered == \A e \in Events : ev[e] # "new" ~> ev[e] = "delivered"

\* L1: a blocked call returns. `Commit` is enabled whenever a call is blocked, as the timer that
\* block() sets for maxBlockMs ends it whether or not it is ready; only a cancel ends it otherwise.
BlockedReturns == call = "blocked" ~> call # "blocked"

\* L5: the programmer ending the session reaches the agent.
EndDelivered == endEv # "new" ~> endEv = "delivered"

===============================================================================
