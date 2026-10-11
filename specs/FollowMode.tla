---- MODULE FollowMode ---------------------------------------------------------
(******************************************************************************)
(* Our own navigation against the programmer looking away: `show`, `selfNav`  *)
(* and `onActiveEditor` in packages/vscode/src/editor.ts, and a `move` to     *)
(* another file in packages/core/src/player.ts, which shows the file before   *)
(* it moves the agent cursor there. A change of active editor outside the     *)
(* self-navigation window, away from what the view follows, pauses playback   *)
(* (`pause("away")`) until the programmer resumes. The model makes one move,  *)
(* from file "a" to file "b", and ends once the programmer has looked away    *)
(* after it.                                                                  *)
(******************************************************************************)
EXTENDS Naturals

CONSTANTS
    HoldWhileShowing    \* TRUE: the window stays open until showTextDocument
                        \* resolves (the fix for #56)

ASSUME AssumeHoldWhileShowing == HoldWhileShowing \in BOOLEAN

\* The files: where the agent cursor starts, and where it moves.
Files == {"a", "b"}

VARIABLES
    active,   \* the file in the active editor
    target,   \* the file of what the view follows (the agent cursor)
    window,   \* the self-navigation window: "closed", "open", or "held" (open
              \* until show resolves)
    show,     \* our show("b"): "none" (not started), "awaiting"
              \* (openTextDocument and showTextDocument), "event" (the change
              \* is queued), or "done"
    paused,   \* playback paused as `away`
    looked    \* the programmer looked away themselves

vars == <<active, target, window, show, paused, looked>>

--------------------------------------------------------------------------------

\* The values each variable can hold.
TypeOK ==
    /\ active \in Files
    /\ target \in Files
    /\ window \in {"closed", "open", "held"}
    /\ show \in {"none", "awaiting", "event", "done"}
    /\ paused \in BOOLEAN
    /\ looked \in BOOLEAN

\* The file that is not f.
Other(f) == IF f = "a" THEN "b" ELSE "a"

--------------------------------------------------------------------------------

Init ==
    /\ active = "a"
    /\ target = "a"
    /\ window = "closed"
    /\ show = "none"
    /\ paused = FALSE
    /\ looked = FALSE

\* The move to b: show("b") calls selfNav(), then awaits.
StartShow ==
    /\ show = "none"
    /\ window' = IF HoldWhileShowing THEN "held" ELSE "open"
    /\ show' = "awaiting"
    /\ UNCHANGED <<active, target, paused, looked>>

\* SELF_NAV_MS passes. A held window doesn't expire.
Expire ==
    /\ window = "open"
    /\ window' = "closed"
    /\ UNCHANGED <<active, target, show, paused, looked>>

\* VS Code shows b: the active editor changes, and its event is queued before
\* the call's reply.
ShowFile ==
    /\ show = "awaiting"
    /\ active' = "b"
    /\ show' = "event"
    /\ UNCHANGED <<target, window, paused, looked>>

\* onActiveEditor: inside the window, the change is ignored; outside it, a
\* change away from the target pauses.
Handle ==
    /\ show = "event"
    /\ show' = "done"
    /\ paused' = (paused \/ (window = "closed" /\ active # target))
    /\ UNCHANGED <<active, target, window, looked>>

\* showTextDocument resolves: a held window gets its SELF_NAV_MS from now; the
\* player then moves the cursor to b.
Resolve ==
    /\ show = "done"
    /\ target = "a"
    /\ target' = "b"
    /\ window' = IF window = "held" THEN "open" ELSE window
    /\ UNCHANGED <<active, show, paused, looked>>

\* The programmer switches to another file themselves: pausing then is right.
LookAway ==
    /\ window = "closed"
    /\ show \in {"none", "done"}
    /\ active = target
    /\ active' = Other(target)
    /\ paused' = TRUE
    /\ looked' = TRUE
    /\ UNCHANGED <<target, window, show>>

\* The move is done and the programmer has looked away from it: the model has
\* nothing more to do, and ends here by design (6.13).
Finished ==
    /\ target = "b"
    /\ window = "closed"
    /\ active # target
    /\ UNCHANGED vars

Next ==
    \/ StartShow
    \/ Expire
    \/ ShowFile
    \/ Handle
    \/ Resolve
    \/ LookAway
    \/ Finished

\* Our show goes on to its end; the programmer looks away when they do.
Fairness ==
    /\ WF_vars(StartShow)
    /\ WF_vars(ShowFile)
    /\ WF_vars(Handle)
    /\ WF_vars(Resolve)

Spec == Init /\ [][Next]_vars /\ Fairness

--------------------------------------------------------------------------------

\* Playback is paused as `away` only when the programmer looked away.
NoPauseFromOurOwnShow == paused => looked

\* The programmer looking away pauses playback. Code that never paused would
\* fail it, so it says something must happen.
LookAwayPauses == looked => paused

\* Our move to b ends with the agent cursor there, however the programmer
\* looks. Code whose show never resolved would fail it.
MoveEnds == <>(target = "b")

================================================================================
