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
    Q,                 \* how many edits the programmer makes in their turn, which interrupt nothing
    RestoreRejected,   \* TRUE: restore() puts back a report's `rejected` too
    WaitForReturn,     \* TRUE: the relay sends a call only once every cancelled call has settled
    RestoreEnded,      \* TRUE: restore() works on a session the programmer ended
    MaxCancels,        \* how many calls the agent cancels in a run, at most, before or after their answer
    MarkHeld,          \* TRUE: a held rejection the agent may have seen marks the report it comes in
    DrainHeld          \* TRUE: an ended session closes only once no rejection is held

Batches == 1..B
Events == 1..E
Quiet == 1..Q
\* "answered": in the last report the agent took, which a cancel arriving after it hands back.
BatchStates == {"new", "rehearsing", "queued", "playing", "unreported", "inReport", "returning", "held", "answered", "delivered", "lost"}
EventStates == {"new", "unreported", "inReport", "returning", "answered", "delivered", "lost"}

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
    held,       \* restore(): the returned rejections waiting to be reported again: [b, repeat (the agent may have seen it)]
    ok,         \* each batch: it played to the end
    knewB,      \* each batch: the batches the agent had been told about when it submitted it
    knewE,      \* ...and the events
    ended,      \* the programmer ended the session (s.ended)
    closed,     \* close(): this.session is null; the agent's calls fail with no_session
    quiet,      \* each edit the programmer makes in their turn: an event's state
    dQ,         \* how many times each has reached the agent
    knewQ,      \* each batch: the programmer's quiet edits the agent had been told about
    turn,       \* s.scene.turn: "agent" or "user"
    lastRej,    \* the batch whose rejection the last report the agent took carried, or 0
    repeat,     \* the returning report was handed back after the agent took it (#67)
    mayRepeat,  \* s.mayRepeat: the next report is marked as one that may repeat an earlier one
    dup         \* something reached the agent again, in a report not marked as a repeat

vars == <<bs, ev, endEv, dB, dE, call, callBatch, cancelled, cancels, rejected, returned, stale, held,
          ok, knewB, knewE, ended, closed, quiet, dQ, knewQ, turn, lastRej, repeat, mayRepeat, dup>>
\* What most actions leave alone.
kept == <<dQ, turn, lastRej, repeat, mayRepeat, dup>>
told == <<ok, knewB, knewE, knewQ>>

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
    /\ quiet = [q \in Quiet |-> "new"] /\ dQ = [q \in Quiet |-> 0] /\ knewQ = [b \in Batches |-> {}]
    /\ turn = "agent" /\ lastRej = 0 /\ repeat = FALSE /\ mayRepeat = FALSE /\ dup = FALSE

Returning == (\E b \in Batches : bs[b] = "returning") \/ (\E e \in Events : ev[e] = "returning") \/ endEv = "returning"
    \/ (\E q \in Quiet : quiet[q] = "returning")

\* The relay holds the agent's call while a cancelled call's report is on its way back.
Sendable == ~WaitForReturn \/ ~Returning

Submit(b) ==
    /\ call = "idle" /\ turn = "agent" /\ ~closed /\ Sendable /\ bs[b] = "new" /\ \A c \in 1..(b - 1) : bs[c] # "new"
    /\ call' = "rehearsing" /\ callBatch' = b /\ cancelled' = FALSE
    /\ bs' = Set(bs, b, "rehearsing")
    /\ knewB' = Set(knewB, b, {c \in Batches : dB[c] > 0})
    /\ knewE' = Set(knewE, b, {e \in Events : dE[e] > 0})
    /\ knewQ' = Set(knewQ, b, {q \in Quiet : dQ[q] > 0})
    /\ UNCHANGED <<ev, endEv, dB, dE, cancels, rejected, returned, stale, held, ok, ended, closed, quiet, kept>>

Listen ==
    /\ call = "idle" /\ ~closed /\ Sendable
    /\ call' = "blocked" /\ callBatch' = 0 /\ cancelled' = FALSE
    /\ UNCHANGED <<bs, ev, endEv, dB, dE, cancels, rejected, returned, stale, held, told, ended, closed, quiet, kept>>

RehearseFails ==
    /\ call = "rehearsing" /\ ~stale /\ ~ended
    /\ bs' = Set(Moved(bs, "unreported", "inReport"), callBatch, "inReport")
    /\ ev' = Moved(ev, "unreported", "inReport") /\ quiet' = Moved(quiet, "unreported", "inReport")
    /\ rejected' = callBatch /\ call' = "answering" /\ stale' = FALSE
    /\ UNCHANGED <<endEv, dB, dE, callBatch, cancelled, cancels, returned, held, told, ended, closed, kept>>

RehearseOk ==
    /\ call = "rehearsing"
    /\ bs' = Set(bs, callBatch, IF stale \/ ended THEN "unreported" ELSE "queued")
    /\ call' = IF cancelled THEN "idle" ELSE "blocked"
    /\ UNCHANGED <<ev, endEv, dB, dE, callBatch, cancelled, cancels, rejected, returned, stale, held, told, ended, closed, quiet, kept>>

Play(b) ==
    /\ bs[b] = "queued" /\ \A c \in Batches : bs[c] # "playing" /\ \A d \in 1..(b - 1) : bs[d] # "queued"
    /\ bs' = Set(bs, b, "playing")
    /\ UNCHANGED <<ev, endEv, dB, dE, call, callBatch, cancelled, cancels, rejected, returned, stale, held, told, ended, closed, quiet, kept>>

Finish(b) ==
    /\ bs[b] = "playing" /\ bs' = Set(bs, b, "unreported") /\ ok' = Set(ok, b, TRUE)
    /\ UNCHANGED <<ev, endEv, dB, dE, call, callBatch, cancelled, cancels, rejected, returned, stale, held, knewB, knewE, knewQ, ended, closed, quiet, kept>>

\* An interrupting event: a message, an interrupt, an edit in the agent's turn, or a turn change,
\* which may leave the turn either way. Once the session is ended, activeSession() is null and
\* nothing happens.
Programmer(e) ==
    /\ ~ended /\ ev[e] = "new" /\ ev' = Set(ev, e, "unreported")
    /\ bs' = Interrupted(bs)
    /\ stale' = TRUE /\ \E t \in {"agent", "user"} : turn' = t
    /\ UNCHANGED <<endEv, dB, dE, call, callBatch, cancelled, cancels, rejected, returned, held, told, ended, closed, quiet, dQ, lastRej, repeat, mayRepeat, dup>>

\* The programmer edits during their turn: userEdit records it, and interrupts nothing.
QuietEdit(q) ==
    /\ ~ended /\ turn = "user" /\ quiet[q] = "new" /\ quiet' = Set(quiet, q, "unreported")
    /\ UNCHANGED <<bs, ev, endEv, dB, dE, call, callBatch, cancelled, cancels, rejected, returned, stale, held, told, ended, closed, kept>>

\* endSession(): s.ended, the `end` event, interrupt().
EndSession ==
    /\ ~ended /\ ended' = TRUE /\ endEv' = "unreported"
    /\ bs' = Interrupted(bs) /\ stale' = TRUE
    /\ UNCHANGED <<ev, dB, dE, call, callBatch, cancelled, cancels, rejected, returned, held, told, closed, quiet, kept>>

\* finishCall → snapshot; with the session ended, close() too, once no rejection is held (DrainHeld).
Commit ==
    /\ call = "blocked"
    /\ \E h \in IF held = {} THEN {[b |-> 0, repeat |-> FALSE]} ELSE held :
          /\ bs' = [b \in Batches |-> IF bs[b] = "unreported" \/ b = h.b THEN "inReport" ELSE bs[b]]
          /\ rejected' = h.b /\ held' = held \ {h} /\ stale' = (held \ {h} # {})
          /\ mayRepeat' = (mayRepeat \/ (MarkHeld /\ h.repeat))
          /\ closed' = (closed \/ (ended /\ (~DrainHeld \/ held \ {h} = {})))
    /\ ev' = Moved(ev, "unreported", "inReport") /\ endEv' = MovedOne(endEv, "unreported", "inReport")
    /\ quiet' = Moved(quiet, "unreported", "inReport")
    /\ call' = "answering"
    /\ UNCHANGED <<dB, dE, callBatch, cancelled, cancels, returned, told, ended, dQ, turn, lastRej, repeat, dup>>

Cancel ==
    /\ call \in {"rehearsing", "blocked", "answering"} /\ ~cancelled /\ cancels < MaxCancels
    /\ cancelled' = TRUE /\ cancels' = cancels + 1
    /\ call' = IF call = "blocked" THEN "idle" ELSE call
    /\ UNCHANGED <<bs, ev, endEv, dB, dE, callBatch, rejected, returned, stale, held, told, ended, closed, quiet, kept>>

\* Taken: in the report the agent just took. The last report's items are now "delivered".
Took(f) == [x \in DOMAIN f |-> IF f[x] = "inReport" THEN "answered" ELSE IF f[x] = "answered" THEN "delivered" ELSE f[x]]
TookOne(x) == IF x = "inReport" THEN "answered" ELSE IF x = "answered" THEN "delivered" ELSE x

\* The report carries something the agent already had.
Again ==
    \/ \E b \in Batches : bs[b] = "inReport" /\ dB[b] > 0
    \/ \E e \in Events : ev[e] = "inReport" /\ dE[e] > 0
    \/ \E q \in Quiet : quiet[q] = "inReport" /\ dQ[q] > 0

Answer ==
    /\ call = "answering" /\ ~cancelled
    /\ dup' = (dup \/ (~mayRepeat /\ Again))
    /\ dB' = [b \in Batches |-> IF bs[b] = "inReport" THEN dB[b] + 1 ELSE dB[b]]
    /\ dE' = [e \in Events |-> IF ev[e] = "inReport" THEN dE[e] + 1 ELSE dE[e]]
    /\ dQ' = [q \in Quiet |-> IF quiet[q] = "inReport" THEN dQ[q] + 1 ELSE dQ[q]]
    /\ bs' = Took(bs) /\ ev' = Took(ev) /\ quiet' = Took(quiet) /\ endEv' = TookOne(endEv)
    /\ call' = "idle" /\ rejected' = 0 /\ lastRej' = rejected /\ mayRepeat' = FALSE
    /\ UNCHANGED <<callBatch, cancelled, cancels, returned, stale, held, told, ended, closed, turn, repeat>>

Bounce ==
    /\ call = "answering" /\ cancelled /\ returned = 0
    /\ \A b \in Batches : bs[b] # "returning"
    /\ \A e \in Events : ev[e] # "returning"
    /\ endEv # "returning" /\ \A q \in Quiet : quiet[q] # "returning"
    /\ bs' = Moved(bs, "inReport", "returning") /\ ev' = Moved(ev, "inReport", "returning")
    /\ endEv' = MovedOne(endEv, "inReport", "returning") /\ quiet' = Moved(quiet, "inReport", "returning")
    /\ returned' = rejected /\ rejected' = 0 /\ call' = "idle"
    /\ repeat' = FALSE
    /\ UNCHANGED <<dB, dE, callBatch, cancelled, cancels, stale, held, told, ended, closed, dQ, turn, lastRej, mayRepeat, dup>>

\* The agent's cancel comes after it took the answer: its SDK still sends it, and the relay hands
\* the report back, as one the agent may have seen (`mayRepeat`, #67).
LateBounce ==
    /\ call = "idle" /\ cancels < MaxCancels /\ ~Returning /\ returned = 0
    /\ \/ \E b \in Batches : bs[b] = "answered"
       \/ \E e \in Events : ev[e] = "answered"
       \/ \E q \in Quiet : quiet[q] = "answered"
       \/ endEv = "answered"
    /\ bs' = Moved(bs, "answered", "returning") /\ ev' = Moved(ev, "answered", "returning")
    /\ quiet' = Moved(quiet, "answered", "returning") /\ endEv' = MovedOne(endEv, "answered", "returning")
    /\ returned' = lastRej /\ lastRej' = 0 /\ repeat' = TRUE /\ cancels' = cancels + 1
    /\ UNCHANGED <<dB, dE, dQ, call, callBatch, cancelled, rejected, stale, held, told, ended, closed, turn, mayRepeat, dup>>

\* restore(): dropped once the session is ended (activeSession() is null), unless RestoreEnded,
\* which puts a closed session back so the next call takes the report.
Restore ==
    /\ Returning
    /\ IF ended /\ ~RestoreEnded
          THEN /\ bs' = Moved(bs, "returning", "lost") /\ ev' = Moved(ev, "returning", "lost")
               /\ endEv' = MovedOne(endEv, "returning", "lost") /\ quiet' = Moved(quiet, "returning", "lost")
               /\ UNCHANGED <<stale, held, closed, mayRepeat>>
          ELSE LET \* What the agent has to plan around: an event, a batch that didn't complete, a rejection.
                   news == returned # 0 \/ endEv = "returning" \/ (\E e \in Events : ev[e] = "returning")
                           \/ (\E b \in Batches : bs[b] = "returning" /\ ~ok[b]) \/ (\E q \in Quiet : quiet[q] = "returning")
                   back == [b \in Batches |->
                              IF bs[b] # "returning" THEN bs[b]
                              ELSE IF b # returned THEN "unreported" ELSE IF RestoreRejected THEN "held" ELSE "lost"]
               IN /\ bs' = back
                  /\ ev' = Moved(ev, "returning", "unreported")
                  /\ endEv' = MovedOne(endEv, "returning", "unreported")
                  /\ quiet' = Moved(quiet, "returning", "unreported")
                  /\ stale' = (stale \/ news)
                  /\ held' = IF RestoreRejected /\ returned # 0 THEN held \cup {[b |-> returned, repeat |-> repeat]} ELSE held
                  /\ closed' = FALSE
                  /\ mayRepeat' = (mayRepeat \/ repeat)
    /\ returned' = 0 /\ repeat' = FALSE
    /\ UNCHANGED <<dB, dE, call, callBatch, cancelled, cancels, rejected, told, ended, dQ, turn, lastRej, dup>>

Next ==
    \/ \E b \in Batches : Submit(b) \/ Play(b) \/ Finish(b)
    \/ \E e \in Events : Programmer(e)
    \/ \E q \in Quiet : QuietEdit(q)
    \/ EndSession
    \/ Listen \/ RehearseFails \/ RehearseOk \/ Commit \/ Cancel \/ Answer \/ Bounce \/ LateBounce \/ Restore

Fairness ==
    /\ WF_vars(Listen) /\ WF_vars(RehearseFails \/ RehearseOk) /\ WF_vars(Commit)
    /\ WF_vars(Answer) /\ WF_vars(Bounce) /\ WF_vars(Restore)
    /\ \A b \in Batches : WF_vars(Play(b)) /\ WF_vars(Finish(b))

Spec == Init /\ [][Next]_vars /\ Fairness

\* S1, safety, since #67 at least once: nothing reaches the agent twice in a report that isn't marked
\* as one that may repeat an earlier one.
NoUnmarkedRepeat == ~dup

\* #28: while returned rejections are held, new steps are discarded, so none is rejected.
HeldMeansStale == held # {} => stale

\* S2: a batch plays only if the agent had been told of every event before it plays, quiet ones too.
PlaysKnowingEvents ==
    \A b \in Batches : bs[b] = "playing" =>
        /\ \A e \in Events : ev[e] # "new" => e \in knewE[b]
        /\ \A q \in Quiet : quiet[q] # "new" => q \in knewQ[b]

\* S3: a batch plays only if every batch before it completed, or the agent was told it didn't.
PlaysAfterCompleted ==
    \A b \in Batches : bs[b] = "playing" => \A c \in 1..(b - 1) : ok[c] \/ c \in knewB[b]

\* S1, liveness: every batch submitted, and every event, is eventually reported.
Got(x) == x \in {"answered", "delivered"}
BatchesDelivered == \A b \in Batches : bs[b] # "new" ~> Got(bs[b])
EventsDelivered == \A e \in Events : ev[e] # "new" ~> Got(ev[e])
QuietDelivered == \A q \in Quiet : quiet[q] # "new" ~> Got(quiet[q])

\* L1: a blocked call returns. `Commit` is enabled whenever a call is blocked, as the timer that
\* block() sets for maxBlockMs ends it whether or not it is ready; only a cancel ends it otherwise.
BlockedReturns == call = "blocked" ~> call # "blocked"

\* L5: the programmer ending the session reaches the agent.
EndDelivered == endEv # "new" ~> Got(endEv)

===============================================================================
