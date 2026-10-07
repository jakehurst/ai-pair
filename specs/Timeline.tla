------------------------------- MODULE Timeline -------------------------------
\* Pausable delays in packages/core/src/timeline.ts, with the pause reasons that
\* Controller.pause and Controller.resume keep in packages/core/src/controller.ts, and the
\* places that pause and resume: packages/vscode/src/panel.ts (Pause, Resume, the reply
\* box's draft, sending a reply, the turn button) and packages/vscode/src/editor.ts
\* (looking away). L3 and L4 in #19.
EXTENDS Naturals

CONSTANT N   \* how many sleeps the player makes in a run

Reasons == {"user", "reply", "away"}

VARIABLES
    reasons,      \* Controller.pauseReasons
    paused,       \* Timeline.paused
    pending,      \* Timeline.pending: "none", "waiting" (no timer), "armed" (timer running)
    interrupted,  \* Timeline.interrupted
    sleeps,       \* how many sleeps have started
    resolved      \* how many sleeps have resolved, with true or false

vars == <<reasons, paused, pending, interrupted, sleeps, resolved>>

\* A pause can outlive a session: new Timeline(this.pauseReasons.size > 0).
Init ==
    /\ reasons \in SUBSET Reasons /\ paused = (reasons # {})
    /\ pending = "none" /\ interrupted = FALSE /\ sleeps = 0 /\ resolved = 0

\* sleep(ms): resolves false at once if interrupted; else waits, with a timer unless paused.
Sleep ==
    /\ pending = "none" /\ sleeps < N /\ sleeps' = sleeps + 1
    /\ IF interrupted
          THEN resolved' = resolved + 1 /\ UNCHANGED pending
          ELSE pending' = (IF paused THEN "waiting" ELSE "armed") /\ UNCHANGED resolved
    /\ UNCHANGED <<reasons, paused, interrupted>>

\* The timer fires: the sleep resolves true.
Fire ==
    /\ pending = "armed" /\ pending' = "none" /\ resolved' = resolved + 1
    /\ UNCHANGED <<reasons, paused, interrupted, sleeps>>

\* Controller.pause(reason): adds the reason; Timeline.pause() stops the timer, keeping what's left.
Pause(r) ==
    /\ reasons' = reasons \cup {r}
    /\ paused' = TRUE
    /\ pending' = IF pending = "armed" THEN "waiting" ELSE pending
    /\ UNCHANGED <<interrupted, sleeps, resolved>>

\* Controller.resume(reason) removes one reason; resume() with none removes all (sending a reply,
\* the Resume button, the turn button). Playback continues when none are left.
Resume(rs) ==
    /\ reasons # {}
    /\ reasons' = reasons \ rs
    /\ IF reasons \ rs = {}
          THEN /\ paused' = FALSE
               /\ pending' = IF pending = "waiting" THEN "armed" ELSE pending
          ELSE UNCHANGED <<paused, pending>>
    /\ UNCHANGED <<interrupted, sleeps, resolved>>

\* interrupt(): the pending sleep resolves false, and later ones too until reset().
Interrupt ==
    /\ interrupted' = TRUE
    /\ IF pending # "none" THEN pending' = "none" /\ resolved' = resolved + 1 ELSE UNCHANGED <<pending, resolved>>
    /\ UNCHANGED <<reasons, paused, sleeps>>

\* reset(), for the next batch.
Reset == interrupted /\ pending = "none" /\ interrupted' = FALSE /\ UNCHANGED <<reasons, paused, pending, sleeps, resolved>>

Next ==
    \/ Sleep \/ Fire \/ Interrupt \/ Reset
    \/ \E r \in Reasons : Pause(r) \/ Resume({r})
    \/ Resume(Reasons)

\* The player sleeps again whenever it can, and timers fire. The programmer and interrupts get no fairness.
Spec == Init /\ [][Next]_vars /\ WF_vars(Fire) /\ WF_vars(Sleep)

\* The timeline is paused exactly when there is a pause reason.
PausedMatchesReasons == paused = (reasons # {})

\* No timer runs while paused.
NoTimerWhilePaused == paused => pending # "armed"

\* Each sleep resolves at most once.
ResolvedOnce == resolved <= sleeps /\ (pending # "none" => resolved < sleeps)

\* L4: once no pause reason is left and none comes back, a waiting sleep resolves.
ResumeContinues == <>[](reasons = {}) => [](pending = "waiting" => <>(pending = "none"))

=============================================================================
