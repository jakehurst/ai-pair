---- MODULE FollowMode ---------------------------------------------------------
(******************************************************************************)
(* Our own navigation against the programmer looking away: `show`, `selfNav`  *)
(* and `onActiveEditor` in packages/vscode/src/editor.ts, and a `move` to     *)
(* another file in packages/core/src/player.ts, which shows the file before   *)
(* it moves the agent cursor there. A change of active editor outside the     *)
(* self-navigation window, away from what the view follows, pauses playback   *)
(* (`pause("away")`) until the programmer resumes. The model makes one move,  *)
(* from the source file to the destination file, and ends once the programmer *)
(* has looked away after it.                                                  *)
(******************************************************************************)
EXTENDS Naturals, PairDefs

CONSTANTS
    HoldWhileShowing    \* TRUE: the window stays open until showTextDocument
                        \* resolves (the fix for #56)

ASSUME AssumeHoldWhileShowing == HoldWhileShowing \in BOOLEAN

VARIABLES
    activeFile,   \* the file in the active editor
    target,   \* the file of what the view follows (the agent cursor)
    selfNavigationWindow,   \* the self-navigation window: "closed", "open", or
                            \* "awaiting"
              \* (open until show resolves)
    showCall,     \* our show("destinationFile"): "idle" (not started),
                  \* "awaiting"
              \* (openTextDocument and showTextDocument), "eventQueued" (the
              \* change
              \* is queued), or "eventHandled"
    awayPause,   \* playback paused as `away`
    lookedAway    \* the programmer looked away themselves

vars == <<activeFile, target, selfNavigationWindow, showCall, awayPause,
          lookedAway>>

--------------------------------------------------------------------------------

\* The values each variable can hold.
TypeOK ==
    /\ activeFile \in Files
    /\ target \in Files
    /\ selfNavigationWindow \in {"closed", "open", "awaiting"}
    /\ showCall \in {"idle", "awaiting", "eventQueued", "eventHandled"}
    /\ awayPause \in BOOLEAN
    /\ lookedAway \in BOOLEAN

--------------------------------------------------------------------------------

Init ==
    /\ activeFile = "sourceFile"
    /\ target = "sourceFile"
    /\ selfNavigationWindow = "closed"
    /\ showCall = "idle"
    /\ awayPause = FALSE
    /\ lookedAway = FALSE

\* The move to the destination file: show("destinationFile")
\* calls selfNav(), then awaits.
StartShow ==
    /\ showCall = "idle"
    /\ selfNavigationWindow' = IF HoldWhileShowing THEN "awaiting" ELSE "open"
    /\ showCall' = "awaiting"
    /\ UNCHANGED <<activeFile, target, awayPause, lookedAway>>

\* timings.selfNavMs passes. A held window doesn't expire.
WindowExpires ==
    /\ selfNavigationWindow = "open"
    /\ selfNavigationWindow' = "closed"
    /\ UNCHANGED <<activeFile, target, showCall, awayPause, lookedAway>>

\* VS Code shows the destination file: the active editor changes, and its
\* event is queued before the call's reply.
ShowFile ==
    /\ showCall = "awaiting"
    /\ activeFile' = "destinationFile"
    /\ showCall' = "eventQueued"
    /\ UNCHANGED <<target, selfNavigationWindow, awayPause, lookedAway>>

\* onActiveEditor: inside the window, the change is ignored; outside it, a
\* change away from the target pauses.
HandleEditorChange ==
    /\ showCall = "eventQueued"
    /\ showCall' = "eventHandled"
    /\ awayPause' = (awayPause \/ (selfNavigationWindow = "closed"
                                   /\ activeFile # target))
    /\ UNCHANGED <<activeFile, target, selfNavigationWindow, lookedAway>>

\* showTextDocument resolves: a held window gets its timings.selfNavMs from
\* now; the player then moves the cursor to the destination file.
ShowResolves ==
    /\ showCall = "eventHandled"
    /\ target = "sourceFile"
    /\ target' = "destinationFile"
    /\ selfNavigationWindow' = IF selfNavigationWindow = "awaiting"
                               THEN "open" ELSE selfNavigationWindow
    /\ UNCHANGED <<activeFile, showCall, awayPause, lookedAway>>

\* The programmer switches to another file themselves: pausing then is right.
LookAway ==
    /\ selfNavigationWindow = "closed"
    /\ showCall \in {"idle", "eventHandled"}
    /\ activeFile = target
    /\ activeFile' = "otherFile"
    /\ awayPause' = TRUE
    /\ lookedAway' = TRUE
    /\ UNCHANGED <<target, selfNavigationWindow, showCall>>

\* The move is done and the programmer has looked away from it: the model has
\* nothing more to do, and ends here by design (6.13).
Finished ==
    /\ target = "destinationFile"
    /\ selfNavigationWindow = "closed"
    /\ activeFile # target
    /\ UNCHANGED vars

Next ==
    \/ StartShow
    \/ WindowExpires
    \/ ShowFile
    \/ HandleEditorChange
    \/ ShowResolves
    \/ LookAway
    \/ Finished

\* Our show goes on to its end; the programmer looks away when they do.
Fairness ==
    /\ WF_vars(StartShow)
    /\ WF_vars(ShowFile)
    /\ WF_vars(HandleEditorChange)
    /\ WF_vars(ShowResolves)

Spec == Init /\ [][Next]_vars /\ Fairness

--------------------------------------------------------------------------------

\* Playback is paused as `away` only when the programmer looked away.
NoPauseFromOurOwnShow == awayPause => lookedAway

\* The programmer looking away pauses playback. Code that never paused would
\* fail it, so it says something must happen.
LookAwayPauses == lookedAway => awayPause

\* Our move to the destination file ends with the agent cursor there, however
\* the programmer looks. Code whose show never resolved would fail it.
MoveEnds == <>(target = "destinationFile")

================================================================================
