---- MODULE Timeline -----------------------------------------------------------
(******************************************************************************)
(* Pausable delays in packages/core/src/timeline.ts, with the pause reasons   *)
(* that Controller.pause and Controller.resume keep in                        *)
(* packages/core/src/controller.ts, and the places that pause and resume:     *)
(* packages/vscode/src/panel.ts (Pause, Resume, the reply box's draft,        *)
(* sending a reply, the turn button) and packages/vscode/src/editor.ts        *)
(* (looking away). With no interruption and no pause, every queued batch      *)
(* plays, and once no pause reason is left, playback continues (#19).         *)
(******************************************************************************)
EXTENDS Naturals, PairDefs

CONSTANTS
    MaxSleeps   \* how many sleeps the model makes

ASSUME AssumeMaxSleeps == MaxSleeps \in Nat

\* What the sleep is doing: paused with no timer, or with its timer
\* running.
SleepStates == {"timerStopped", "armed"}

\* No sleep: Timeline.sleeping is null. Any value that is not a sleep
\* state will do, so the config makes it a model value (6.20).
NoSleep == CHOOSE v : v \notin SleepStates

VARIABLES
    pauseReasons,      \* Controller.pauseReasons
    paused,       \* Timeline.paused
    sleeping,     \* Timeline.sleeping: NoSleep, "timerStopped" (no timer), or
                  \* "armed" (timer running)
    interrupted,  \* Timeline.interrupted
    sleeps,       \* how many sleeps have started
    resolved      \* how many sleeps have resolved, with true or false

vars == <<pauseReasons, paused, sleeping, interrupted, sleeps, resolved>>

--------------------------------------------------------------------------------

\* The values each variable can hold.
TypeOK ==
    /\ pauseReasons \subseteq PauseReasons
    /\ paused \in BOOLEAN
    /\ sleeping \in SleepStates \cup {NoSleep}
    /\ interrupted \in BOOLEAN
    /\ sleeps \in Nat
    /\ resolved \in Nat

--------------------------------------------------------------------------------

\* A pause can outlive a session: new Timeline(this.pauseReasons.size > 0).
Init ==
    /\ pauseReasons \in SUBSET PauseReasons
    /\ paused = (pauseReasons # {})
    /\ sleeping = NoSleep
    /\ interrupted = FALSE
    /\ sleeps = 0
    /\ resolved = 0

\* sleep(ms): resolves false at once if interrupted; else waits, with a timer
\* unless paused.
Sleep ==
    /\ sleeping = NoSleep
    /\ sleeping' =
           IF interrupted
           THEN NoSleep
           ELSE IF paused THEN "timerStopped" ELSE "armed"
    /\ sleeps' = sleeps + 1
    /\ resolved' = IF interrupted THEN resolved + 1 ELSE resolved
    /\ UNCHANGED <<pauseReasons, paused, interrupted>>

\* The timer fires: the sleep resolves true.
Fire ==
    /\ sleeping = "armed"
    /\ sleeping' = NoSleep
    /\ resolved' = resolved + 1
    /\ UNCHANGED <<pauseReasons, paused, interrupted, sleeps>>

\* Controller.pause(reason): adds the reason; Timeline.pause() stops the
\* timer, keeping what is left.
Pause(r) ==
    /\ pauseReasons' = pauseReasons \cup {r}
    /\ paused' = TRUE
    /\ sleeping' = IF sleeping = "armed" THEN "timerStopped" ELSE sleeping
    /\ UNCHANGED <<interrupted, sleeps, resolved>>

\* Controller.resume(reason) removes one reason; resume() with none removes
\* all (sending a reply, the Resume button, the turn button). Playback
\* continues when none are left.
Resume(rs) ==
    LET left == pauseReasons \ rs
    IN  /\ pauseReasons # {}
        /\ pauseReasons' = left
        /\ paused' = IF left = {} THEN FALSE ELSE paused
        /\ sleeping' =
               IF left = {} /\ sleeping = "timerStopped" THEN "armed"
               ELSE sleeping
        /\ UNCHANGED <<interrupted, sleeps, resolved>>

\* interrupt(): the sleep resolves false, and later ones too until
\* reset().
Interrupt ==
    /\ sleeping' = NoSleep
    /\ interrupted' = TRUE
    /\ resolved' = IF sleeping # NoSleep THEN resolved + 1 ELSE resolved
    /\ UNCHANGED <<pauseReasons, paused, sleeps>>

\* reset(), for the next batch.
Reset ==
    /\ interrupted
    /\ sleeping = NoSleep
    /\ interrupted' = FALSE
    /\ UNCHANGED <<pauseReasons, paused, sleeping, sleeps, resolved>>

Next ==
    \/ Sleep
    \/ Fire
    \/ \E r \in PauseReasons : Pause(r)
    \/ \E r \in PauseReasons : Resume({r})
    \/ Resume(PauseReasons)
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
PausedMatchesReasons == paused <=> (pauseReasons # {})

\* No timer runs while paused.
NoTimerWhilePaused == paused => (sleeping # "armed")

\* Each sleep resolves at most once.
ResolvedOnce ==
    /\ resolved <= sleeps
    /\ (sleeping # NoSleep) => (resolved < sleeps)

\* Once no pause reason is left and none comes back, a waiting sleep
\* resolves. The programmer may pause for good, so the leads-to holds only
\* under that hypothesis (6.29). Code that never resumed a waiting sleep would
\* fail it, so it says something must happen.
ResumeContinues ==
    <>[](pauseReasons = {}) => ((sleeping = "timerStopped")
        ~> (sleeping = NoSleep))

\* Sleeps run out only so that the model is finite (6.8). It prunes exactly
\* the states a guard `sleeps < MaxSleeps` on Sleep never reached, so the
\* behaviors, and ResumeContinues' result, are the guard's (8.6).
Constraint == sleeps <= MaxSleeps

================================================================================
