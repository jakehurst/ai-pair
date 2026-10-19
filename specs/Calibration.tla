---- MODULE Calibration --------------------------------------------------------
(******************************************************************************)
(* Calibrating the programmer's reading speed, issue 109: the flow in         *)
(* packages/vscode/src/calibration.ts, its view in webview/panel.ts and       *)
(* panel.ts, the calibrate pair tool that supplies a passage, in bridge.ts,   *)
(* the setting the rate is stored in, in extension.ts, and the say pause that *)
(* reads it, in player.ts. The measurement is a number; what the spec checks  *)
(* is the order of things around it: the pause that holds playback while the  *)
(* passage is read, and the stored rate reaching the player before playback   *)
(* resumes.                                                                   *)
(******************************************************************************)
EXTENDS Naturals

CONSTANTS
    MaxRuns,        \* how many calibrations the model completes
    AwaitStore      \* TRUE: playback resumes only once the stored rate has been
                    \* applied

ASSUME AssumeMaxRuns == MaxRuns \in Nat
ASSUME AssumeAwaitStore == AwaitStore \in BOOLEAN

\* No say in flight. Any value that is not a rate a say was timed with will do,
\* so the config makes it a model value (6.20).
NoSay == CHOOSE v : v \notin {"default", "measured", "old"}

VARIABLES
    phase,     \* "idle"; "armed", waiting for go; "reading", the timer
               \* running; "storing", the rate being written
    passage,   \* "builtin", or "supplied" by the agent's calibrate tool
    rate,      \* what the player reads: "default", or "measured"
    pending,   \* a measured rate written to the settings, not yet applied
    pause,     \* calibrate is a pause reason
    say,       \* a say in flight: the rate its pause was timed with, or NoSay
    finished,  \* a calibration has completed
    runs       \* calibrations completed

vars == <<phase, passage, rate, pending, pause, say, finished, runs>>

--------------------------------------------------------------------------------

\* The values each variable can hold.
TypeOK ==
    /\ phase \in {"idle", "armed", "reading", "storing"}
    /\ passage \in {"builtin", "supplied"}
    /\ rate \in {"default", "measured"}
    /\ pending \in BOOLEAN
    /\ pause \in BOOLEAN
    /\ say \in {"default", "measured", "old", NoSay}
    /\ finished \in BOOLEAN
    /\ runs \in Nat

--------------------------------------------------------------------------------

Init ==
    /\ phase = "idle"
    /\ passage = "builtin"
    /\ rate = "default"
    /\ pending = FALSE
    /\ pause = FALSE
    /\ say = NoSay
    /\ finished = FALSE
    /\ runs = 0

\* The command, or the programmer asking in the panel: it says it will show the
\* passage on go.
Arm ==
    /\ phase = "idle"
    /\ phase' = "armed"
    /\ pause' = TRUE
    /\ UNCHANGED <<passage, rate, pending, say, finished, runs>>

\* The agent's calibrate tool: a passage of its own, then the same flow.
\* Refused unless idle.
Supply ==
    /\ phase = "idle"
    /\ phase' = "armed"
    /\ passage' = "supplied"
    /\ pause' = TRUE
    /\ UNCHANGED <<rate, pending, say, finished, runs>>

\* go: the passage appears and the timer starts.
Go ==
    /\ phase = "armed"
    /\ phase' = "reading"
    /\ UNCHANGED <<passage, rate, pending, pause, say, finished, runs>>

\* x: the timer stops, the rate is written to the settings. A say already in
\* flight keeps its old pause, so it no longer counts as a default one.
Finish ==
    /\ phase = "reading"
    /\ IF AwaitStore
       THEN /\ phase' = "storing"
            /\ UNCHANGED pause
       ELSE /\ phase' = "idle"
            /\ pause' = FALSE
    /\ pending' = TRUE
    /\ say' = IF say = "default" THEN "old" ELSE say
    /\ finished' = TRUE
    /\ runs' = runs + 1
    /\ UNCHANGED <<passage, rate>>

\* The settings change reaches the controller: the player reads the measured
\* rate from now on.
ApplyRate ==
    /\ pending
    /\ IF phase = "storing"
       THEN /\ phase' = "idle"
            /\ pause' = FALSE
       ELSE UNCHANGED <<phase, pause>>
    /\ rate' = "measured"
    /\ pending' = FALSE
    /\ UNCHANGED <<passage, say, finished, runs>>

\* Anything else typed, the view going away, or the session ending: back to
\* idle, nothing stored.
Cancel ==
    /\ phase \in {"armed", "reading"}
    /\ phase' = "idle"
    /\ pause' = FALSE
    /\ UNCHANGED <<passage, rate, pending, say, finished, runs>>

\* A say starts: its pause is computed from the rate the player reads at that
\* moment.
StartSay ==
    /\ ~pause
    /\ say = NoSay
    /\ say' = rate
    /\ UNCHANGED <<phase, passage, rate, pending, pause, finished, runs>>

\* The say's pause ends.
EndSay ==
    /\ say # NoSay
    /\ say' = NoSay
    /\ UNCHANGED <<phase, passage, rate, pending, pause, finished, runs>>

Next ==
    \/ Arm
    \/ Supply
    \/ Go
    \/ Finish
    \/ ApplyRate
    \/ Cancel
    \/ StartSay
    \/ EndSay

\* The settings write lands and a say's pause ends on their own; the programmer
\* and the agent get no fairness.
Fairness ==
    /\ WF_vars(ApplyRate)
    /\ WF_vars(EndSay)

Spec == Init /\ [][Next]_vars /\ Fairness

--------------------------------------------------------------------------------

\* Playback is held exactly while a calibration is under way.
PauseMatchesPhase == pause <=> (phase # "idle")

\* Once a calibration has completed, no say starts with the default rate.
FreshRate == finished => (say # "default")

\* A rate written to the settings is applied, and playback resumes: something
\* must happen.
StoreLands == pending ~> (rate = "measured" /\ ~pause)

\* Calibrations stop only so that the model is finite (6.8): once MaxRuns are
\* done, none starts. That prunes exactly the states the old guard
\* `runs < MaxRuns` on Arm and Supply never reached, so the behaviors, and
\* StoreLands' result, are the guard's (8.6).
Constraint == runs < MaxRuns \/ phase \in {"idle", "storing"}

================================================================================
