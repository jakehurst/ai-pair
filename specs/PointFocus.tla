---- MODULE PointFocus ---------------------------------------------------------
(******************************************************************************)
(* The view's focus after a point, and a reply after the programmer looked    *)
(* away. Found while working on issue 109: resume in                          *)
(* packages/core/src/controller.ts reveals what the view follows, which is    *)
(* the pointed code until the next cursor action (focus in the scene,         *)
(* player.ts), so a point from long ago comes back on a reply, reopening a    *)
(* file the programmer had closed. With the fix, a reply after a look-away    *)
(* returns the focus to the cursor before the reveal. Issue 125: every typed  *)
(* reply revealed the target, reopening a file the programmer had closed or   *)
(* leaving the one they had switched to; with RevealOnReply = FALSE, a reply  *)
(* moves no view.                                                             *)
(******************************************************************************)
EXTENDS Naturals, PairDefs

CONSTANTS
    DropStaleFocus, \* TRUE: a reply after a look-away moves the focus from the
                    \* point to the cursor
    RevealOnReply,  \* TRUE: a reply reveals what the view follows (the code
                    \* before issue 125)
    MaxReplies      \* how many replies and Resumes the model makes

ASSUME AssumeDropStaleFocus == DropStaleFocus \in BOOLEAN
ASSUME AssumeRevealOnReply == RevealOnReply \in BOOLEAN
ASSUME AssumeMaxReplies == MaxReplies \in Nat

VARIABLES
    cursor,     \* the agent cursor's file: "sourceFile", or NoFile before the
                \* first move
    point,      \* the pointed code's file: "destinationFile", or NoFile
    focus,      \* what the view follows: "cursor", or "point"
    activeFile,     \* the file in the active editor: "sourceFile",
                \* "destinationFile", "otherFile", or NoFile (no editor open)
    awayPause,  \* the programmer looked away from what the view follows: the
                \* away pause holds
    stalePointRevealed,    \* a reply just revealed a point the programmer had
                           \* looked away
                \* from
    replies,    \* replies so far
    replyMovedEditor,     \* the last step was a reply that changed the active
                          \* editor
    cursorActed       \* the last step was a cursor action

vars == <<cursor, point, focus, activeFile, awayPause, stalePointRevealed,
          replies, replyMovedEditor, cursorActed>>

--------------------------------------------------------------------------------

\* The values each variable can hold.
TypeOK ==
    /\ cursor \in {"sourceFile", NoFile}
    /\ point \in {"destinationFile", NoFile}
    /\ focus \in {"cursor", "point"}
    /\ activeFile \in Files \cup {NoFile}
    /\ awayPause \in BOOLEAN
    /\ stalePointRevealed \in BOOLEAN
    /\ replies \in Nat
    /\ replyMovedEditor \in BOOLEAN
    /\ cursorActed \in BOOLEAN

\* The file the view follows.
Target == IF focus = "point" THEN point ELSE cursor

\* The focus after a resume: a point the programmer looked away from is
\* dropped first, with DropStaleFocus (issue 109).
ResumedFocus ==
    IF DropStaleFocus /\ awayPause /\ focus = "point" THEN "cursor" ELSE focus

--------------------------------------------------------------------------------

Init ==
    /\ cursor \in {"sourceFile", NoFile}
    /\ point = NoFile
    /\ focus = "cursor"
    /\ activeFile = IF cursor = "sourceFile" THEN "sourceFile" ELSE "otherFile"
    /\ awayPause = FALSE
    /\ stalePointRevealed = FALSE
    /\ replies = 0
    /\ replyMovedEditor = FALSE
    /\ cursorActed = FALSE

\* A point action: the view goes to the pointed file and follows it.
Point ==
    /\ ~awayPause
    /\ point' = "destinationFile"
    /\ focus' = "point"
    /\ activeFile' = "destinationFile"
    /\ replyMovedEditor' = FALSE
    /\ cursorActed' = FALSE
    /\ UNCHANGED <<cursor, awayPause, stalePointRevealed, replies>>

\* A cursor action, a move or an edit: the view comes back to the cursor and
\* follows it.
ActAtCursor ==
    /\ ~awayPause
    /\ cursor' = "sourceFile"
    /\ focus' = "cursor"
    /\ activeFile' = "sourceFile"
    /\ replyMovedEditor' = FALSE
    /\ cursorActed' = TRUE
    /\ UNCHANGED <<point, awayPause, stalePointRevealed, replies>>

\* The programmer switches to another editor: away from the target, playback
\* pauses.
LookAway ==
    /\ ~awayPause
    /\ Target # NoFile
    /\ activeFile' = "otherFile"
    /\ awayPause' = TRUE
    /\ replyMovedEditor' = FALSE
    /\ cursorActed' = FALSE
    /\ UNCHANGED <<cursor, point, focus, stalePointRevealed, replies>>

\* The programmer closes the target's tab, or every tab: no editor is active,
\* and nothing pauses.
CloseTab ==
    /\ activeFile # NoFile
    /\ activeFile' = NoFile
    /\ replyMovedEditor' = FALSE
    /\ cursorActed' = FALSE
    /\ UNCHANGED <<cursor, point, focus, awayPause, stalePointRevealed,
                   replies>>

\* A reply: resume with no reason. A typed reply always gets here with a pause
\* to lift, its draft's, so before the fix for issue 125 every reply revealed
\* the target; with it, the view stays where the programmer left it. A point
\* the programmer looked away from is dropped first (issue 109).
SendReply ==
    LET revealed == IF ResumedFocus = "point" THEN point ELSE cursor
        shown == IF RevealOnReply /\ revealed # NoFile THEN revealed
                 ELSE activeFile
    IN  /\ focus' = ResumedFocus
        /\ activeFile' = shown
        /\ awayPause' = FALSE
        /\ stalePointRevealed' =
               (RevealOnReply /\ awayPause
                  /\ revealed = point /\ point # NoFile)
        /\ replies' = replies + 1
        /\ replyMovedEditor' = (shown # activeFile)
        /\ cursorActed' = FALSE
        /\ UNCHANGED <<cursor, point>>

\* The Resume button: resume with no reason, which reveals the target, as
\* documented. A point the programmer looked away from is dropped first (issue
\* 109).
ResumeAll ==
    LET revealed == IF ResumedFocus = "point" THEN point ELSE cursor
    IN  /\ focus' = ResumedFocus
        /\ activeFile' = IF revealed # NoFile THEN revealed ELSE activeFile
        /\ awayPause' = FALSE
        /\ stalePointRevealed' = (awayPause /\ revealed = point
                                  /\ point # NoFile)
        /\ replies' = replies + 1
        /\ replyMovedEditor' = FALSE
        /\ cursorActed' = FALSE
        /\ UNCHANGED <<cursor, point>>

Next ==
    \/ Point
    \/ ActAtCursor
    \/ LookAway
    \/ CloseTab
    \/ SendReply
    \/ ResumeAll

Spec == Init /\ [][Next]_vars

--------------------------------------------------------------------------------

\* A reply never brings back a point the programmer had looked away from.
NoStaleReveal == ~stalePointRevealed

\* A reply leaves the active editor as the programmer left it (issue 125).
ReplyKeepsView == ~replyMovedEditor

\* Right after a cursor action, the cursor's file is the active editor: the
\* view comes back once the agent works. Code that never showed it would fail
\* it, so it says something must happen.
CursorShown == cursorActed => (activeFile = cursor)

\* Replies and Resumes run out only so that the model is finite (6.8).
Constraint == replies <= MaxReplies

================================================================================
