---- MODULE Timeline -----------------------------------------------------------
(******************************************************************************)
(* Pausable delays in packages/core/src/timeline.ts, with the pause reasons   *)
(* that Controller.pause and Controller.resume keep in                        *)
(* packages/core/src/controller.ts, and the places that pause and resume:     *)
(* packages/vscode/src/panel.ts (Pause, Resume, the reply box's draft,        *)
(* sending a reply, the turn button) and packages/vscode/src/editor.ts        *)
(* (looking away). L3 and L4 in #19.                                          *)
(******************************************************************************)
EXTENDS Naturals

CONSTANTS
    MaxSleeps   \* how many sleeps the model makes

ASSUME AssumeMaxSleeps == MaxSleeps \in Nat

\* Why playback is paused: the Pause button, a draft in the reply box, and
\* looking away.
Reasons == {"user", "reply", "away"}

\* What a pending sleep is doing: waiting with no timer, or with its timer
\* running.
SleepStates == {"waiting", "armed"}

\* No pending sleep: Timeline.pending is null. Any value that is not a sleep
\* state will do, so the config makes it a model value (6.20).
NoSleep == CHOOSE v : v \notin SleepStates

VARIABLES
    reasons,      \* Controller.pauseReasons
    paused,       \* Timeline.paused
    pending,      \* Timeline.pending: NoSleep, "waiting" (no timer), or
                  \* "armed" (timer running)
    interrupted,  \* Timeline.interrupted
    sleeps,       \* how many sleeps have started
    resolved      \* how many sleeps have resolved, with true or false

vars == <<reasons, paused, pending, interrupted, sleeps, resolved>>

--------------------------------------------------------------------------------

\* The values each variable can hold.
TypeOK ==
    /\ reasons \subseteq Reasons
    /\ paused \in BOOLEAN
    /\ pending \in SleepStates \cup {NoSleep}
    /\ interrupted \in BOOLEAN
    /\ sleeps \in Nat
    /\ resolved \in Nat

--------------------------------------------------------------------------------

\* A pause can outlive a session: new Timeline(this.pauseReasons.size > 0).
Init ==
    /\ reasons \in SUBSET Reasons
    /\ paused = (reasons # {})
    /\ pending = NoSleep
    /\ interrupted = FALSE
    /\ sleeps = 0
    /\ resolved = 0

\* sleep(ms): resolves false at once if interrupted; else waits, with a timer
\* unless paused.
Sleep ==
    /\ pending = NoSleep
    /\ pending' =
           IF interrupted
           THEN NoSleep
           ELSE IF paused THEN "waiting" ELSE "armed"
    /\ sleeps' = sleeps + 1
    /\ resolved' = IF interrupted THEN resolved + 1 ELSE resolved
    /\ UNCHANGED <<reasons, paused, interrupted>>

\* The timer fires: the sleep resolves true.
Fire ==
    /\ pending = "armed"
    /\ pending' = NoSleep
    /\ resolved' = resolved + 1
    /\ UNCHANGED <<reasons, paused, interrupted, sleeps>>

\* Controller.pause(reason): adds the reason; Timeline.pause() stops the
\* timer, keeping what is left.
Pause(r) ==
    /\ reasons' = reasons \cup {r}
    /\ paused' = TRUE
    /\ pending' = IF pending = "armed" THEN "waiting" ELSE pending
    /\ UNCHANGED <<interrupted, sleeps, resolved>>

\* Controller.resume(reason) removes one reason; resume() with none removes
\* all (sending a reply, the Resume button, the turn button). Playback
\* continues when none are left.
Resume(rs) ==
    LET left == reasons \ rs
    IN  /\ reasons # {}
        /\ reasons' = left
        /\ paused' = IF left = {} THEN FALSE ELSE paused
        /\ pending' =
               IF left = {} /\ pending = "waiting" THEN "armed" ELSE pending
        /\ UNCHANGED <<interrupted, sleeps, resolved>>

\* interrupt(): the pending sleep resolves false, and later ones too until
\* reset().
Interrupt ==
    /\ pending' = NoSleep
    /\ interrupted' = TRUE
    /\ resolved' = IF pending # NoSleep THEN resolved + 1 ELSE resolved
    /\ UNCHANGED <<reasons, paused, sleeps>>

\* reset(), for the next batch.
Reset ==
    /\ interrupted
    /\ pending = NoSleep
    /\ interrupted' = FALSE
    /\ UNCHANGED <<reasons, paused, pending, sleeps, resolved>>

Next ==
    \/ Sleep
    \/ Fire
    \/ \E r \in Reasons : Pause(r)
    \/ \E r \in Reasons : Resume({r})
    \/ Resume(Reasons)
    \/ Interrupt
    \/ Reset

\* The player sleeps again whenever it can, and timers fire. The programmer
\* and interrupts get no fairness.
Fairness ==
    /\ WF_vars(Sleep)
    /\ WF_vars(Fire)

Spec == Init /\ [][Next]_vars /\ Fairness

--------------------------------------------------------------------------------

\* The timeline is paused exactly when there is a pause reason.
PausedMatchesReasons == paused <=> (reasons # {})

\* No timer runs while paused.
NoTimerWhilePaused == paused => (pending # "armed")

\* Each sleep resolves at most once.
ResolvedOnce ==
    /\ resolved <= sleeps
    /\ (pending # NoSleep) => (resolved < sleeps)

\* L4: once no pause reason is left and none comes back, a waiting sleep
\* resolves. The programmer may pause for good, so the leads-to holds only
\* under that hypothesis (6.29). Code that never resumed a waiting sleep would
\* fail it, so it says something must happen.
ResumeContinues ==
    <>[](reasons = {}) => ((pending = "waiting") ~> (pending = NoSleep))

\* Sleeps run out only so that the model is finite (6.8). It prunes exactly
\* the states a guard `sleeps < MaxSleeps` on Sleep never reached, so the
\* behaviors, and ResumeContinues' result, are the guard's (8.6).
Constraint == sleeps <= MaxSleeps

================================================================================
