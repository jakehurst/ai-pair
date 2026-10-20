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
    MaxRounds,   \* how many calibrations the model completes
    AwaitStore      \* TRUE: playback resumes only once the stored rate has been
                    \* applied

ASSUME AssumeMaxRounds == MaxRounds \in Nat
ASSUME AssumeAwaitStore == AwaitStore \in BOOLEAN

\* The rates a say is timed with: the default, the measured one, or the
\* default from before the measurement.
Rates == {"default", "measured", "staleDefault"}

\* No say in flight. Any value that is not a rate a say was timed with will do,
\* so the config makes it a model value (6.20).
NoSay == CHOOSE v : v \notin Rates

VARIABLES
    phase,     \* "idle"; "ready", waiting for go; "reading", the timer
               \* running; "storing", the rate being written
    passageSource,   \* "builtin", or "supplied" by the agent's calibrate tool
    rate,      \* what the player reads: "default", or "measured"
    rateUnapplied,   \* a measured rate written to the settings, not yet applied
    calibratePause,     \* calibrate is a pause reason
    sayRate,       \* a say in flight: the rate its pause was timed with, or
                   \* NoSay
    calibratedOnce,  \* a calibration has completed
    rounds     \* calibrations completed

vars == <<phase, passageSource, rate, rateUnapplied, calibratePause, sayRate,
          calibratedOnce, rounds>>

--------------------------------------------------------------------------------

\* The values each variable can hold.
TypeOK ==
    /\ phase \in {"idle", "ready", "reading", "storing"}
    /\ passageSource \in {"builtin", "supplied"}
    /\ rate \in {"default", "measured"}
    /\ rateUnapplied \in BOOLEAN
    /\ calibratePause \in BOOLEAN
    /\ sayRate \in {"default", "measured", "staleDefault", NoSay}
    /\ calibratedOnce \in BOOLEAN
    /\ rounds \in Nat

--------------------------------------------------------------------------------

Init ==
    /\ phase = "idle"
    /\ passageSource = "builtin"
    /\ rate = "default"
    /\ rateUnapplied = FALSE
    /\ calibratePause = FALSE
    /\ sayRate = NoSay
    /\ calibratedOnce = FALSE
    /\ rounds = 0

\* The command, or the programmer asking in the panel: it says it will show the
\* passage on go.
Arm ==
    /\ phase = "idle"
    /\ phase' = "ready"
    /\ calibratePause' = TRUE
    /\ UNCHANGED <<passageSource, rate, rateUnapplied, sayRate, calibratedOnce,
                   rounds>>

\* The agent's calibrate tool: a passage of its own, then the same flow.
\* Refused unless idle.
Supply ==
    /\ phase = "idle"
    /\ phase' = "ready"
    /\ passageSource' = "supplied"
    /\ calibratePause' = TRUE
    /\ UNCHANGED <<rate, rateUnapplied, sayRate, calibratedOnce, rounds>>

\* go: the passage appears and the timer starts.
Go ==
    /\ phase = "ready"
    /\ phase' = "reading"
    /\ UNCHANGED <<passageSource, rate, rateUnapplied, calibratePause, sayRate,
                   calibratedOnce, rounds>>

\* x: the timer stops, the rate is written to the settings. A say already in
\* flight keeps its old pause, so it no longer counts as a default one.
StopTimer ==
    /\ phase = "reading"
    /\ IF AwaitStore
       THEN /\ phase' = "storing"
            /\ UNCHANGED calibratePause
       ELSE /\ phase' = "idle"
            /\ calibratePause' = FALSE
    /\ rateUnapplied' = TRUE
    /\ sayRate' = IF sayRate = "default" THEN "staleDefault" ELSE sayRate
    /\ calibratedOnce' = TRUE
    /\ rounds' = rounds + 1
    /\ UNCHANGED <<passageSource, rate>>

\* The settings change reaches the controller: the player reads the measured
\* rate from now on.
ApplyRate ==
    /\ rateUnapplied
    /\ IF phase = "storing"
       THEN /\ phase' = "idle"
            /\ calibratePause' = FALSE
       ELSE UNCHANGED <<phase, calibratePause>>
    /\ rate' = "measured"
    /\ rateUnapplied' = FALSE
    /\ UNCHANGED <<passageSource, sayRate, calibratedOnce, rounds>>

\* Anything else typed, the view going away, or the session ending: back to
\* idle, nothing stored.
CancelCalibration ==
    /\ phase \in {"ready", "reading"}
    /\ phase' = "idle"
    /\ calibratePause' = FALSE
    /\ UNCHANGED <<passageSource, rate, rateUnapplied, sayRate, calibratedOnce,
                   rounds>>

\* A say starts: its pause is computed from the rate the player reads at that
\* moment.
StartSay ==
    /\ ~calibratePause
    /\ sayRate = NoSay
    /\ sayRate' = rate
    /\ UNCHANGED <<phase, passageSource, rate, rateUnapplied, calibratePause,
                   calibratedOnce, rounds>>

\* The say's pause ends.
EndSay ==
    /\ sayRate # NoSay
    /\ sayRate' = NoSay
    /\ UNCHANGED <<phase, passageSource, rate, rateUnapplied, calibratePause,
                   calibratedOnce, rounds>>

Next ==
    \/ Arm
    \/ Supply
    \/ Go
    \/ StopTimer
    \/ ApplyRate
    \/ CancelCalibration
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
PauseMatchesPhase == calibratePause <=> (phase # "idle")

\* Once a calibration has completed, no say starts with the default rate.
FreshRate == calibratedOnce => (sayRate # "default")

\* A rate written to the settings is applied, and playback resumes: something
\* must happen.
StoreLands == rateUnapplied ~> (rate = "measured" /\ ~calibratePause)

\* Calibrations stop only so that the model is finite (6.8): once MaxRounds
\* are done, none starts. That prunes exactly the states a guard
\* `rounds < MaxRounds` on Arm and Supply never reached, so the
\* behaviors, and StoreLands' result, are the guard's (8.6).
Constraint == rounds < MaxRounds \/ phase \in {"idle", "storing"}

================================================================================
