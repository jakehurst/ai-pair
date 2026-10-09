------------------------------ MODULE PointFocus ------------------------------
\* The view's focus after a point, and a reply after the programmer looked away. Found while
\* working on issue 109: resume in packages/core/src/controller.ts reveals what the view follows,
\* which is the pointed code until the next cursor action (focus in the scene, player.ts), so a
\* point from long ago comes back on a reply, reopening a file the programmer had closed. With
\* the fix, a reply after a look-away returns the focus to the cursor before the reveal.
EXTENDS Naturals

CONSTANT DropStaleFocus  \* TRUE: a reply after a look-away moves the focus from the point to the cursor

VARIABLES
    cursor,   \* the agent cursor's file: a, or none before the first move
    point,    \* the pointed code's file: b, or none
    focus,    \* what the view follows: cursor, or point
    active,   \* the file in the active editor: a, b, or other
    looked,   \* the programmer looked away from what the view follows: the away pause holds
    stale,    \* a reply just revealed a point the programmer had looked away from
    replies   \* replies so far, for a bound

vars == <<cursor, point, focus, active, looked, stale, replies>>

Target == IF focus = "point" THEN point ELSE cursor

Init ==
    /\ cursor \in {"none", "a"} /\ point = "none" /\ focus = "cursor"
    /\ active = IF cursor = "a" THEN "a" ELSE "other"
    /\ looked = FALSE /\ stale = FALSE /\ replies = 0

\* A point action: the view goes to the pointed file and follows it.
Point ==
    /\ ~looked /\ point' = "b" /\ focus' = "point" /\ active' = "b"
    /\ UNCHANGED <<cursor, looked, stale, replies>>

\* A cursor action, a move or an edit: the view comes back to the cursor and follows it.
CursorAction ==
    /\ ~looked /\ cursor' = "a" /\ focus' = "cursor" /\ active' = "a"
    /\ UNCHANGED <<point, looked, stale, replies>>

\* The programmer switches to another editor, or closes the file's tab: away from the target, playback pauses.
LookAway ==
    /\ ~looked /\ Target # "none"
    /\ active' = "other" /\ looked' = TRUE
    /\ UNCHANGED <<cursor, point, focus, stale, replies>>

\* A reply: resume with no reason, which reveals the target. With the fix, a point the programmer
\* looked away from is dropped first, so the reveal is of the cursor, if there is one.
Reply ==
    /\ replies < 2 /\ replies' = replies + 1
    /\ focus' = IF DropStaleFocus /\ looked /\ focus = "point" THEN "cursor" ELSE focus
    /\ LET revealed == IF focus' = "point" THEN point ELSE cursor
       IN /\ active' = IF looked /\ revealed # "none" THEN revealed ELSE active
          /\ stale' = (looked /\ revealed = point /\ point # "none")
    /\ looked' = FALSE
    /\ UNCHANGED <<cursor, point>>

Next == Point \/ CursorAction \/ LookAway \/ Reply

Spec == Init /\ [][Next]_vars

\* A reply never brings back a point the programmer had looked away from.
NoStaleReveal == ~stale
==============================================================================
