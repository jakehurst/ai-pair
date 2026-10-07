-------------------------------- MODULE RunBox --------------------------------
\* The panel's run box, for one `run`: what `runCommand` in packages/core/src/player.ts posts,
\* and how the page in packages/vscode/src/panelHtml.ts shows it (`case "run"`, `setActive`).
\* The box shows "confirm" or "running" for the command waiting; every way the run ends posts a
\* phase that clears it, or the session ends, which clears it too.
EXTENDS Naturals

CONSTANT ClearOnEnd   \* TRUE: the page clears the box for every phase but confirm and running

VARIABLES
    run,     \* the player: "saving", "confirming", "running", "over"
    box,     \* the page's box: "off", "confirm", "running"
    active   \* the session is active in the page

vars == <<run, box, active>>

Init == run = "saving" /\ box = "off" /\ active = TRUE

\* What the page does with a `run` event of `phase`.
Show(phase) ==
    IF phase \in {"confirm", "running"} THEN box' = phase
    ELSE IF ClearOnEnd THEN box' = "off" ELSE UNCHANGED box

\* After `save`: with confirmation on, post confirm; else straight to running. A failed save
\* returns before posting anything.
Saved ==
    /\ run = "saving"
    /\ \/ run' = "confirming" /\ Show("confirm")
       \/ run' = "running" /\ Show("running")
       \/ run' = "over" /\ UNCHANGED box
    /\ UNCHANGED active

\* `confirm` resolves: go posts running; skip or an interrupt posts declined.
Decided ==
    /\ run = "confirming"
    /\ \/ run' = "running" /\ Show("running")
       \/ run' = "over" /\ Show("declined")
    /\ UNCHANGED active

\* The command: done or background when it ran, declined when it never started or threw.
Ran ==
    /\ run = "running" /\ run' = "over"
    /\ \E phase \in {"done", "background", "declined"} : Show(phase)
    /\ UNCHANGED active

\* The session ends while the run is in any state: `setActive(false)` clears the box; the player's
\* run is interrupted (close() interrupts the timeline) and posts its phase, which then finds it off.
End == active /\ active' = FALSE /\ box' = "off" /\ UNCHANGED run

Next == Saved \/ Decided \/ Ran \/ End

Spec == Init /\ [][Next]_vars /\ WF_vars(Saved) /\ WF_vars(Decided) /\ WF_vars(Ran)

\* The box shows a command only while it waits for that.
BoxMatches == (box = "confirm" => run = "confirming") /\ (box = "running" => run = "running")

\* Once the run is over, the box clears.
Clears == <>[](box = "off")

=============================================================================
