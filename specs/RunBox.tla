---- MODULE RunBox -------------------------------------------------------------
(******************************************************************************)
(* The panel's run box, for one `run`: what `runCommand` in                   *)
(* packages/core/src/player.ts posts, and how the page in                     *)
(* packages/vscode/src/webview/panel.ts shows it (`case "run"`, `setActive`). *)
(* The box shows "confirm" or "running" for the command waiting; every way    *)
(* the run ends posts a phase that clears it, or the session ends, which      *)
(* clears it too.                                                             *)
(******************************************************************************)
CONSTANTS
    ClearOnEnd  \* TRUE: the page clears the box for every phase but confirm
                \* and running

ASSUME AssumeClearOnEnd == ClearOnEnd \in BOOLEAN

VARIABLES
    run,     \* the player: "saving", "confirming", "running", "over"
    box,     \* the page's box: "off", "confirm", "running"
    active   \* the session is active in the page

vars == <<run, box, active>>

--------------------------------------------------------------------------------

\* The values each variable can hold.
TypeOK ==
    /\ run \in {"saving", "confirming", "running", "over"}
    /\ box \in {"off", "confirm", "running"}
    /\ active \in BOOLEAN

\* What the page does with a `run` event of `phase`.
Show(phase) ==
    IF phase \in {"confirm", "running"}
    THEN box' = phase
    ELSE IF ClearOnEnd
         THEN box' = "off"
         ELSE UNCHANGED box

--------------------------------------------------------------------------------

Init ==
    /\ run = "saving"
    /\ box = "off"
    /\ active = TRUE

\* After `save`, with confirmation on: post confirm.
SaveAndConfirm ==
    /\ run = "saving"
    /\ run' = "confirming"
    /\ Show("confirm")
    /\ UNCHANGED active

\* After `save`, with confirmation off: post running.
SaveAndRun ==
    /\ run = "saving"
    /\ run' = "running"
    /\ Show("running")
    /\ UNCHANGED active

\* A failed save returns before posting anything.
FailSave ==
    /\ run = "saving"
    /\ run' = "over"
    /\ UNCHANGED <<box, active>>

\* `confirm` resolves with go: post running.
Go ==
    /\ run = "confirming"
    /\ run' = "running"
    /\ Show("running")
    /\ UNCHANGED active

\* `confirm` resolves with skip, or an interrupt: post declined.
Decline ==
    /\ run = "confirming"
    /\ run' = "over"
    /\ Show("declined")
    /\ UNCHANGED active

\* The command: done or background when it ran, declined when it never
\* started or threw.
FinishCommand ==
    /\ run = "running"
    /\ run' = "over"
    /\ \E phase \in {"done", "background", "declined"} : Show(phase)
    /\ UNCHANGED active

\* The session ends while the run is in any state: `setActive(false)` clears
\* the box; the player's run is interrupted (close() interrupts the timeline)
\* and posts its phase, which then finds it off.
EndSession ==
    /\ active
    /\ box' = "off"
    /\ active' = FALSE
    /\ UNCHANGED run

\* The run is over and the session has ended: nothing more happens, by
\* design (6.13).
Finished ==
    /\ run = "over"
    /\ ~active
    /\ UNCHANGED vars

Next ==
    \/ SaveAndConfirm
    \/ SaveAndRun
    \/ FailSave
    \/ Go
    \/ Decline
    \/ FinishCommand
    \/ EndSession
    \/ Finished

\* The player goes on until the run is over; the session need not end. The
\* actions that leave one state are enabled together, and each disables the
\* rest, so fairness on each is fairness on their disjunction.
Fairness ==
    /\ WF_vars(SaveAndConfirm)
    /\ WF_vars(SaveAndRun)
    /\ WF_vars(FailSave)
    /\ WF_vars(Go)
    /\ WF_vars(Decline)
    /\ WF_vars(FinishCommand)

Spec == Init /\ [][Next]_vars /\ Fairness

--------------------------------------------------------------------------------

\* The box shows a command only while it waits for that.
BoxMatches ==
    /\ (box = "confirm") => (run = "confirming")
    /\ (box = "running") => (run = "running")

\* Once the run is over, the box clears: something must happen.
Clears == <>[](box = "off")

================================================================================
