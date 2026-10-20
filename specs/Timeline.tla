---- MODULE Timeline -----------------------------------------------------------
(******************************************************************************)
(* Pausable delays in packages/core/src/timeline.ts, with the pause reasons   *)
(* that Controller.pause and Controller.resume keep in                        *)
(* packages/core/src/controller.ts, and the places that pause and resume:     *)
(* packages/vscode/src/panel.ts (Pause, Resume, the reply box's draft,        *)
(* sending a reply, the turn button), packages/vscode/src/editor.ts (looking  *)
(* away), and packages/vscode/src/extension.ts (the reading speed             *)
(* calibration, the Toggle Pause command). With no interruption and no        *)
(* pause, every queued batch plays, and once no pause reason is left,         *)
(* playback continues (#19). `sleep` also takes a second sleep while one is   *)
(* pending, which replaces it; the replaced sleep's timer runs on, and when   *)
(* it runs out it leaves the later sleep pending (#174).                      *)
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
    pauseReasons, \* Controller.pauseReasons
    paused,       \* Timeline.paused
    sleeping,     \* Timeline.sleeping: NoSleep, "timerStopped" (no timer), or
                  \* "armed" (timer running)
    interrupted,  \* Timeline.interrupted
    sleeps,       \* how many sleeps have started; the pending sleep, if any,
                  \* is the last of them
    resolved,     \* how many sleeps have resolved, with true or false
    unresolved,   \* the numbers of the sleeps not yet resolved
    replaced      \* the numbers of the replaced sleeps whose timer still runs

vars == <<pauseReasons, paused, sleeping, interrupted, sleeps, resolved,
          unresolved, replaced>>

--------------------------------------------------------------------------------

\* The values each variable can hold.
TypeOK ==
    /\ pauseReasons \subseteq PauseReasons
    /\ paused \in BOOLEAN
    /\ sleeping \in SleepStates \cup {NoSleep}
    /\ interrupted \in BOOLEAN
    /\ sleeps \in Nat
    /\ resolved \in Nat
    /\ unresolved \subseteq 1..sleeps
    /\ replaced \subseteq unresolved

--------------------------------------------------------------------------------

\* A pause can outlive a session: new Timeline(this.pauseReasons.size > 0).
Init ==
    /\ pauseReasons \in SUBSET PauseReasons
    /\ paused = (pauseReasons # {})
    /\ sleeping = NoSleep
    /\ interrupted = FALSE
    /\ sleeps = 0
    /\ resolved = 0
    /\ unresolved = {}
    /\ replaced = {}

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
    /\ unresolved' =
           IF interrupted THEN unresolved ELSE unresolved \cup {sleeps + 1}
    /\ UNCHANGED <<pauseReasons, paused, interrupted, replaced>>

\* sleep(ms) with a sleep pending, which no caller does: the player awaits
\* each sleep. The new sleep replaces the pending one, whose timer, if
\* running, runs on; a replaced sleep with no timer never resolves.
SleepAgain ==
    /\ sleeping # NoSleep
    /\ sleeping' = IF paused THEN "timerStopped" ELSE "armed"
    /\ sleeps' = sleeps + 1
    /\ unresolved' = unresolved \cup {sleeps + 1}
    /\ replaced' =
           IF sleeping = "armed" THEN replaced \cup {sleeps} ELSE replaced
    /\ UNCHANGED <<pauseReasons, paused, interrupted, resolved>>

\* The timer fires: the sleep resolves true.
Fire ==
    /\ sleeping = "armed"
    /\ sleeping' = NoSleep
    /\ resolved' = resolved + 1
    /\ unresolved' = unresolved \ {sleeps}
    /\ UNCHANGED <<pauseReasons, paused, interrupted, sleeps, replaced>>

\* A replaced sleep's timer fires: that sleep resolves true, and the pending
\* sleep is left as it is (`this.sleeping === p` is false).
FireReplaced(n) ==
    /\ n \in replaced
    /\ replaced' = replaced \ {n}
    /\ unresolved' = unresolved \ {n}
    /\ resolved' = resolved + 1
    /\ UNCHANGED <<pauseReasons, paused, sleeping, interrupted, sleeps>>

\* Controller.pause(reason): adds the reason; Timeline.pause() stops the
\* timer, keeping what is left.
Pause(r) ==
    /\ pauseReasons' = pauseReasons \cup {r}
    /\ paused' = TRUE
    /\ sleeping' = IF sleeping = "armed" THEN "timerStopped" ELSE sleeping
    /\ UNCHANGED <<interrupted, sleeps, resolved, unresolved, replaced>>

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
        /\ UNCHANGED <<interrupted, sleeps, resolved, unresolved, replaced>>

\* interrupt(): the sleep resolves false, and later ones too until
\* reset().
Interrupt ==
    /\ sleeping' = NoSleep
    /\ interrupted' = TRUE
    /\ resolved' = IF sleeping # NoSleep THEN resolved + 1 ELSE resolved
    /\ unresolved' =
           IF sleeping # NoSleep THEN unresolved \ {sleeps} ELSE unresolved
    /\ UNCHANGED <<pauseReasons, paused, sleeps, replaced>>

\* reset(), for the next batch.
Reset ==
    /\ interrupted
    /\ sleeping = NoSleep
    /\ interrupted' = FALSE
    /\ UNCHANGED <<pauseReasons, paused, sleeping, sleeps, resolved,
                   unresolved, replaced>>

Next ==
    \/ Sleep
    \/ SleepAgain
    \/ Fire
    \/ \E n \in replaced : FireReplaced(n)
    \/ \E r \in PauseReasons : Pause(r)
    \/ \E r \in PauseReasons : Resume({r})
    \/ Resume(PauseReasons)
    \/ Interrupt
    \/ Reset

\* The player sleeps again whenever it can, and timers fire. The programmer,
\* interrupts, and a second sleep get no fairness.
Fairness ==
    /\ WF_vars(Sleep)
    /\ WF_vars(Fire)
    /\ \A n \in 1..MaxSleeps : WF_vars(FireReplaced(n))

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

\* A replaced sleep's timer never clears a later sleep: while the last sleep
\* started is unresolved, it is the pending one, for an interrupt to cut
\* short (#174).
LatestPending == (sleeps \in unresolved) => (sleeping # NoSleep)

\* Once no pause reason is left and none comes back, a waiting sleep
\* resolves. The programmer may pause for good, so the leads-to holds only
\* under that hypothesis (6.29). Code that never resumed a waiting sleep would
\* fail it, so it says something must happen.
ResumeContinues ==
    <>[](pauseReasons = {}) => ((sleeping = "timerStopped")
        ~> (sleeping = NoSleep))

\* Sleeps run out only so that the model is finite (6.8). It prunes exactly
\* the states a guard `sleeps < MaxSleeps` on Sleep and SleepAgain never
\* reached, so the behaviors, and ResumeContinues' result, are the guard's
\* (8.6).
Constraint == sleeps <= MaxSleeps

================================================================================
