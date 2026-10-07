------------------------------ MODULE FollowMode ------------------------------
\* Our own navigation against the programmer looking away: `show`, `selfNav` and
\* `onActiveEditor` in packages/vscode/src/editor.ts, and a `move` to another file in
\* packages/core/src/player.ts, which shows the file before it moves the agent cursor there.
\* A change of active editor outside the self-navigation window, away from what the view
\* follows, pauses playback (`pause("away")`) until the programmer resumes.
EXTENDS Naturals

CONSTANTS
    HoldWhileShowing  \* TRUE: the window stays open until showTextDocument resolves (fix for #56)

VARIABLES
    active,   \* the file in the active editor: "a" or "b"
    target,   \* the file of what the view follows (the agent cursor): "a" or "b"
    window,   \* the self-navigation window: "closed", "open", "held" (open until show resolves)
    show,     \* our show("b"): "none", "awaiting" (open/showTextDocument), "event" (the change is queued), "done"
    paused,   \* playback paused as `away`
    looked    \* the programmer looked away themselves

vars == <<active, target, window, show, paused, looked>>

Init == active = "a" /\ target = "a" /\ window = "closed" /\ show = "none" /\ paused = FALSE /\ looked = FALSE

\* move to b: show("b") calls selfNav(), then awaits.
ShowStart ==
    /\ show = "none" /\ show' = "awaiting"
    /\ window' = IF HoldWhileShowing THEN "held" ELSE "open"
    /\ UNCHANGED <<active, target, paused, looked>>

\* SELF_NAV_MS passes. A held window doesn't expire.
Expire ==
    /\ window = "open" /\ window' = "closed"
    /\ UNCHANGED <<active, target, show, paused, looked>>

\* VS Code shows b: the active editor changes, and its event is queued before the call's reply.
Shown ==
    /\ show = "awaiting" /\ show' = "event" /\ active' = "b"
    /\ UNCHANGED <<target, window, paused, looked>>

\* onActiveEditor: inside the window, ignored; else, away from the target pauses.
Handle ==
    /\ show = "event" /\ show' = "done"
    /\ paused' = (paused \/ (window = "closed" /\ active # target))
    /\ UNCHANGED <<active, target, window, looked>>

\* showTextDocument resolves: a held window gets its SELF_NAV_MS from now; the player then moves
\* the cursor to b.
Resolved ==
    /\ show = "done" /\ target = "a"
    /\ window' = IF window = "held" THEN "open" ELSE window
    /\ target' = "b"
    /\ UNCHANGED <<active, show, paused, looked>>

\* The programmer switches to another file themselves: pausing then is right.
LookAway ==
    /\ window = "closed" /\ show \in {"none", "done"} /\ active = target
    /\ active' = (IF target = "a" THEN "b" ELSE "a") /\ paused' = TRUE /\ looked' = TRUE
    /\ UNCHANGED <<target, window, show>>

Next == ShowStart \/ Expire \/ Shown \/ Handle \/ Resolved \/ LookAway

Spec == Init /\ [][Next]_vars

\* Playback is paused as `away` only when the programmer looked away.
NoPauseFromOurOwnShow == paused => looked

=============================================================================
