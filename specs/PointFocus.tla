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
EXTENDS Naturals

CONSTANTS
    DropStaleFocus, \* TRUE: a reply after a look-away moves the focus from the
                    \* point to the cursor
    RevealOnReply,  \* TRUE: a reply reveals what the view follows (the code
                    \* before issue 125)
    MaxReplies      \* how many replies and Resumes the model makes

ASSUME AssumeDropStaleFocus == DropStaleFocus \in BOOLEAN
ASSUME AssumeRevealOnReply == RevealOnReply \in BOOLEAN
ASSUME AssumeMaxReplies == MaxReplies \in Nat

\* The files: the cursor's, the pointed one, and any other.
Files == {"a", "b", "other"}

\* No file: no cursor before the first move, no point, or no editor open. Any
\* value that is not a file will do, so the config makes it a model value
\* (6.20).
NoFile == CHOOSE v : v \notin Files

VARIABLES
    cursor,   \* the agent cursor's file: "a", or NoFile before the first move
    point,    \* the pointed code's file: "b", or NoFile
    focus,    \* what the view follows: "cursor", or "point"
    active,   \* the file in the active editor: "a", "b", "other", or NoFile
              \* (no editor open)
    looked,   \* the programmer looked away from what the view follows: the
              \* away pause holds
    stale,    \* a reply just revealed a point the programmer had looked away
              \* from
    replies,  \* replies so far
    jumped,   \* the last step was a reply that changed the active editor
    acted     \* the last step was a cursor action

vars == <<cursor, point, focus, active, looked, stale, replies, jumped, acted>>

--------------------------------------------------------------------------------

\* The values each variable can hold.
TypeOK ==
    /\ cursor \in {"a", NoFile}
    /\ point \in {"b", NoFile}
    /\ focus \in {"cursor", "point"}
    /\ active \in Files \cup {NoFile}
    /\ looked \in BOOLEAN
    /\ stale \in BOOLEAN
    /\ replies \in Nat
    /\ jumped \in BOOLEAN
    /\ acted \in BOOLEAN

\* The file the view follows.
Target == IF focus = "point" THEN point ELSE cursor

\* The focus after a resume: a point the programmer looked away from is
\* dropped first, with DropStaleFocus (issue 109).
ResumedFocus ==
    IF DropStaleFocus /\ looked /\ focus = "point" THEN "cursor" ELSE focus

--------------------------------------------------------------------------------

Init ==
    /\ cursor \in {"a", NoFile}
    /\ point = NoFile
    /\ focus = "cursor"
    /\ active = IF cursor = "a" THEN "a" ELSE "other"
    /\ looked = FALSE
    /\ stale = FALSE
    /\ replies = 0
    /\ jumped = FALSE
    /\ acted = FALSE

\* A point action: the view goes to the pointed file and follows it.
Point ==
    /\ ~looked
    /\ point' = "b"
    /\ focus' = "point"
    /\ active' = "b"
    /\ jumped' = FALSE
    /\ acted' = FALSE
    /\ UNCHANGED <<cursor, looked, stale, replies>>

\* A cursor action, a move or an edit: the view comes back to the cursor and
\* follows it.
ActAtCursor ==
    /\ ~looked
    /\ cursor' = "a"
    /\ focus' = "cursor"
    /\ active' = "a"
    /\ jumped' = FALSE
    /\ acted' = TRUE
    /\ UNCHANGED <<point, looked, stale, replies>>

\* The programmer switches to another editor: away from the target, playback
\* pauses.
LookAway ==
    /\ ~looked
    /\ Target # NoFile
    /\ active' = "other"
    /\ looked' = TRUE
    /\ jumped' = FALSE
    /\ acted' = FALSE
    /\ UNCHANGED <<cursor, point, focus, stale, replies>>

\* The programmer closes the target's tab, or every tab: no editor is active,
\* and nothing pauses.
CloseTab ==
    /\ active # NoFile
    /\ active' = NoFile
    /\ jumped' = FALSE
    /\ acted' = FALSE
    /\ UNCHANGED <<cursor, point, focus, looked, stale, replies>>

\* A reply: resume with no reason. A typed reply always gets here with a pause
\* to lift, its draft's, so before the fix for issue 125 every reply revealed
\* the target; with it, the view stays where the programmer left it. A point
\* the programmer looked away from is dropped first (issue 109).
Reply ==
    LET revealed == IF ResumedFocus = "point" THEN point ELSE cursor
        shown == IF RevealOnReply /\ revealed # NoFile THEN revealed ELSE active
    IN  /\ focus' = ResumedFocus
        /\ active' = shown
        /\ looked' = FALSE
        /\ stale' =
               (RevealOnReply /\ looked /\ revealed = point /\ point # NoFile)
        /\ replies' = replies + 1
        /\ jumped' = (shown # active)
        /\ acted' = FALSE
        /\ UNCHANGED <<cursor, point>>

\* The Resume button: resume with no reason, which reveals the target, as
\* documented. A point the programmer looked away from is dropped first (issue
\* 109).
Resume ==
    LET revealed == IF ResumedFocus = "point" THEN point ELSE cursor
    IN  /\ focus' = ResumedFocus
        /\ active' = IF revealed # NoFile THEN revealed ELSE active
        /\ looked' = FALSE
        /\ stale' = (looked /\ revealed = point /\ point # NoFile)
        /\ replies' = replies + 1
        /\ jumped' = FALSE
        /\ acted' = FALSE
        /\ UNCHANGED <<cursor, point>>

Next ==
    \/ Point
    \/ ActAtCursor
    \/ LookAway
    \/ CloseTab
    \/ Reply
    \/ Resume

Spec == Init /\ [][Next]_vars

--------------------------------------------------------------------------------

\* A reply never brings back a point the programmer had looked away from.
NoStaleReveal == ~stale

\* A reply leaves the active editor as the programmer left it (issue 125).
ReplyKeepsView == ~jumped

\* Right after a cursor action, the cursor's file is the active editor: the
\* view comes back once the agent works. Code that never showed it would fail
\* it, so it says something must happen.
CursorShown == acted => (active = cursor)

\* Replies and Resumes run out only so that the model is finite (6.8).
Constraint == replies <= MaxReplies

================================================================================
