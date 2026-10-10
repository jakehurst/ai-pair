------------------------------ MODULE PointFocus ------------------------------
\* The view's focus after a point, and a reply after the programmer looked away. Found while
\* working on issue 109: resume in packages/core/src/controller.ts reveals what the view follows,
\* which is the pointed code until the next cursor action (focus in the scene, player.ts), so a
\* point from long ago comes back on a reply, reopening a file the programmer had closed. With
\* the fix, a reply after a look-away returns the focus to the cursor before the reveal.
\* Issue 125: every typed reply revealed the target, reopening a file the programmer had closed or
\* leaving the one they had switched to; with RevealOnReply = FALSE, a reply moves no view.
EXTENDS Naturals

CONSTANT DropStaleFocus  \* TRUE: a reply after a look-away moves the focus from the point to the cursor
CONSTANT RevealOnReply   \* TRUE: a reply reveals what the view follows (the code before issue 125)

VARIABLES
    cursor,   \* the agent cursor's file: a, or none before the first move
    point,    \* the pointed code's file: b, or none
    focus,    \* what the view follows: cursor, or point
    active,   \* the file in the active editor: a, b, other, or none (no editor open)
    looked,   \* the programmer looked away from what the view follows: the away pause holds
    stale,    \* a reply just revealed a point the programmer had looked away from
    replies,  \* replies so far, for a bound
    jumped,   \* the last step was a reply that changed the active editor
    acted     \* the last step was a cursor action

vars == <<cursor, point, focus, active, looked, stale, replies, jumped, acted>>

Target == IF focus = "point" THEN point ELSE cursor

Init ==
    /\ cursor \in {"none", "a"} /\ point = "none" /\ focus = "cursor"
    /\ active = IF cursor = "a" THEN "a" ELSE "other"
    /\ looked = FALSE /\ stale = FALSE /\ replies = 0 /\ jumped = FALSE /\ acted = FALSE

\* A point action: the view goes to the pointed file and follows it.
Point ==
    /\ ~looked /\ point' = "b" /\ focus' = "point" /\ active' = "b" /\ acted' = FALSE /\ jumped' = FALSE
    /\ UNCHANGED <<cursor, looked, stale, replies>>

\* A cursor action, a move or an edit: the view comes back to the cursor and follows it.
CursorAction ==
    /\ ~looked /\ cursor' = "a" /\ focus' = "cursor" /\ active' = "a" /\ acted' = TRUE /\ jumped' = FALSE
    /\ UNCHANGED <<point, looked, stale, replies>>

\* The programmer switches to another editor: away from the target, playback pauses.
LookAway ==
    /\ ~looked /\ Target # "none"
    /\ active' = "other" /\ looked' = TRUE /\ jumped' = FALSE /\ acted' = FALSE
    /\ UNCHANGED <<cursor, point, focus, stale, replies>>

\* The programmer closes the target's tab, or every tab: no editor is active, and nothing pauses.
CloseTab ==
    /\ active # "none" /\ active' = "none" /\ jumped' = FALSE /\ acted' = FALSE
    /\ UNCHANGED <<cursor, point, focus, looked, stale, replies>>

\* A reply: resume with no reason. A typed reply always gets here with a pause to lift, its draft's,
\* so before the fix for issue 125 every reply revealed the target; with it, the view stays where the
\* programmer left it. A point the programmer looked away from is dropped first (issue 109).
Reply ==
    /\ replies < 2 /\ replies' = replies + 1
    /\ focus' = IF DropStaleFocus /\ looked /\ focus = "point" THEN "cursor" ELSE focus
    /\ LET revealed == IF focus' = "point" THEN point ELSE cursor
       IN /\ active' = IF RevealOnReply /\ revealed # "none" THEN revealed ELSE active
          /\ stale' = (RevealOnReply /\ looked /\ revealed = point /\ point # "none")
    /\ jumped' = (active' # active)
    /\ looked' = FALSE /\ acted' = FALSE
    /\ UNCHANGED <<cursor, point>>

\* The Resume button: resume with no reason, which reveals the target, as documented. A point the
\* programmer looked away from is dropped first (issue 109). It shares the replies' bound.
Resume ==
    /\ replies < 2 /\ replies' = replies + 1
    /\ focus' = IF DropStaleFocus /\ looked /\ focus = "point" THEN "cursor" ELSE focus
    /\ LET revealed == IF focus' = "point" THEN point ELSE cursor
       IN /\ active' = IF revealed # "none" THEN revealed ELSE active
          /\ stale' = (looked /\ revealed = point /\ point # "none")
    /\ looked' = FALSE /\ jumped' = FALSE /\ acted' = FALSE
    /\ UNCHANGED <<cursor, point>>

Next == Point \/ CursorAction \/ LookAway \/ CloseTab \/ Reply \/ Resume

Spec == Init /\ [][Next]_vars

\* A reply never brings back a point the programmer had looked away from.
NoStaleReveal == ~stale

\* A reply leaves the active editor as the programmer left it (issue 125).
ReplyKeepsView == ~jumped

\* Right after a cursor action, the cursor's file is the active editor: the view comes back once
\* the agent works.
CursorShown == acted => active = cursor
==============================================================================
