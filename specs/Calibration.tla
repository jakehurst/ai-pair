----------------------------- MODULE Calibration -----------------------------
\* Calibrating the programmer's reading speed, issue 109: the panel's calibration flow in
\* packages/vscode/src/webview/panel.ts and panel.ts, the calibrate pair tool that supplies a
\* passage, in bridge.ts, the setting the rate is stored in, in extension.ts, and the say pause
\* that reads it, in player.ts. The measurement is a number; what the spec checks is the order of
\* things around it: the pause that holds playback while the passage is read, and the stored rate
\* reaching the player before playback resumes.
EXTENDS Naturals

CONSTANTS
    N,          \* how many calibrations a run may complete
    AwaitStore  \* TRUE: playback resumes only once the stored rate has been applied

VARIABLES
    phase,     \* idle; armed, waiting for go; reading, the timer running; storing, the rate being written
    passage,   \* builtin, or supplied by the agent's calibrate tool
    rate,      \* what the player reads: default, or measured
    pending,   \* a measured rate written to the settings, not yet applied
    pause,     \* calibrate is a pause reason
    say,       \* a say in flight: none, or the rate its pause was timed with
    finished,  \* a calibration has completed
    runs       \* calibrations completed

vars == <<phase, passage, rate, pending, pause, say, finished, runs>>

Init ==
    /\ phase = "idle" /\ passage = "builtin" /\ rate = "default" /\ pending = FALSE
    /\ pause = FALSE /\ say = "none" /\ finished = FALSE /\ runs = 0

\* The command, or the programmer asking in the panel: it says it will show the passage on go.
Arm ==
    /\ phase = "idle" /\ runs < N
    /\ phase' = "armed" /\ pause' = TRUE
    /\ UNCHANGED <<passage, rate, pending, say, finished, runs>>

\* The agent's calibrate tool: a passage of its own, then the same flow. Refused unless idle.
Supply ==
    /\ phase = "idle" /\ runs < N
    /\ passage' = "supplied" /\ phase' = "armed" /\ pause' = TRUE
    /\ UNCHANGED <<rate, pending, say, finished, runs>>

\* go: the passage appears and the timer starts.
Go ==
    /\ phase = "armed" /\ phase' = "reading"
    /\ UNCHANGED <<passage, rate, pending, pause, say, finished, runs>>

\* x: the timer stops, the rate is written to the settings. A say already in flight keeps its old
\* pause, so it no longer counts as a default one.
Finish ==
    /\ phase = "reading"
    /\ pending' = TRUE /\ finished' = TRUE /\ runs' = runs + 1
    /\ say' = IF say = "default" THEN "old" ELSE say
    /\ IF AwaitStore
          THEN phase' = "storing" /\ UNCHANGED pause
          ELSE phase' = "idle" /\ pause' = FALSE
    /\ UNCHANGED <<passage, rate>>

\* The settings change reaches the controller: the player reads the measured rate from now on.
Stored ==
    /\ pending /\ pending' = FALSE /\ rate' = "measured"
    /\ IF phase = "storing" THEN phase' = "idle" /\ pause' = FALSE ELSE UNCHANGED <<phase, pause>>
    /\ UNCHANGED <<passage, say, finished, runs>>

\* Anything else typed, the view going away, or the session ending: back to idle, nothing stored.
Cancel ==
    /\ phase \in {"armed", "reading"}
    /\ phase' = "idle" /\ pause' = FALSE
    /\ UNCHANGED <<passage, rate, pending, say, finished, runs>>

\* A say starts: its pause is computed from the rate the player reads at that moment.
SayStart ==
    /\ ~pause /\ say = "none" /\ say' = rate
    /\ UNCHANGED <<phase, passage, rate, pending, pause, finished, runs>>

SayEnd ==
    /\ say # "none" /\ say' = "none"
    /\ UNCHANGED <<phase, passage, rate, pending, pause, finished, runs>>

Next == Arm \/ Supply \/ Go \/ Finish \/ Stored \/ Cancel \/ SayStart \/ SayEnd

\* The settings write lands and a say's pause ends on their own; the programmer and the agent get no fairness.
Spec == Init /\ [][Next]_vars /\ WF_vars(Stored) /\ WF_vars(SayEnd)

\* Playback is held exactly while a calibration is under way.
PauseMatchesPhase == pause = (phase # "idle")

\* Once a calibration has completed, no say starts with the default rate.
FreshRate == finished => say # "default"

\* A rate written to the settings is applied, and playback resumes.
StoreLands == [](pending => <>(rate = "measured" /\ ~pause))
==============================================================================
