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
    playerPhase, \* the player: "saving", "confirming", "running", "over"
    boxShows,    \* the page's box: "cleared", "confirm", "running"
    sessionLive  \* the session is live in the page

vars == <<playerPhase, boxShows, sessionLive>>

--------------------------------------------------------------------------------

\* The values each variable can hold.
TypeOK ==
    /\ playerPhase \in {"saving", "confirming", "running", "over"}
    /\ boxShows \in {"cleared", "confirm", "running"}
    /\ sessionLive \in BOOLEAN

\* What the page does with a `run` event of `phase`.
Show(p) ==
    IF p \in {"confirm", "running"}
    THEN boxShows' = p
    ELSE IF ClearOnEnd
         THEN boxShows' = "cleared"
         ELSE UNCHANGED boxShows

--------------------------------------------------------------------------------

Init ==
    /\ playerPhase = "saving"
    /\ boxShows = "cleared"
    /\ sessionLive = TRUE

\* After `save`, with confirmation on: post confirm.
SaveAndConfirm ==
    /\ playerPhase = "saving"
    /\ playerPhase' = "confirming"
    /\ Show("confirm")
    /\ UNCHANGED sessionLive

\* After `save`, with confirmation off: post running.
SaveAndRun ==
    /\ playerPhase = "saving"
    /\ playerPhase' = "running"
    /\ Show("running")
    /\ UNCHANGED sessionLive

\* A failed save returns before posting anything.
FailSave ==
    /\ playerPhase = "saving"
    /\ playerPhase' = "over"
    /\ UNCHANGED <<boxShows, sessionLive>>

\* `confirm` resolves with go: post running.
Go ==
    /\ playerPhase = "confirming"
    /\ playerPhase' = "running"
    /\ Show("running")
    /\ UNCHANGED sessionLive

\* `confirm` resolves with skip, or an interrupt: post declined.
Decline ==
    /\ playerPhase = "confirming"
    /\ playerPhase' = "over"
    /\ Show("declined")
    /\ UNCHANGED sessionLive

\* The command: done or background when it ran, declined when it never
\* started or threw. A background command's later `exited` post only updates its
\* history entry and never touches the box, so the spec stops at the first post.
FinishCommand ==
    /\ playerPhase = "running"
    /\ playerPhase' = "over"
    /\ \E p \in {"done", "background", "declined"} : Show(p)
    /\ UNCHANGED sessionLive

\* The session ends while the run is in any state: `setActive(false)` clears
\* the box; the player's run is interrupted (close() interrupts the timeline)
\* and posts its phase, which then finds it off.
EndSession ==
    /\ sessionLive
    /\ boxShows' = "cleared"
    /\ sessionLive' = FALSE
    /\ UNCHANGED playerPhase

\* The run is over and the session has ended: nothing more happens, by
\* design (6.13).
Finished ==
    /\ playerPhase = "over"
    /\ ~sessionLive
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
    /\ (boxShows = "confirm") => (playerPhase = "confirming")
    /\ (boxShows = "running") => (playerPhase = "running")

\* Once the run is over, the box clears: something must happen.
Clears == <>[](boxShows = "cleared")

================================================================================
