------------------------------- MODULE BatchFile -------------------------------
\* Which file each action of a batch acts in, in packages/core/src/player.ts: `names` (a batch
\* works in one file, named in a `move`, `select` or `point` before its first edit), `fileOf`
\* (the file a `move`, `select` or `point` looks in), and `type` and `delete`, which act at the
\* agent's cursor. Only `move` and `select` move the cursor; `point` names a file without moving
\* it. The batch's actions are any sequence of actions, each with or without `file`.
EXTENDS Naturals

CONSTANTS
    Files,          \* the files
    MaxActions,     \* how many actions a batch has, at most
    FallBackToNamed, \* TRUE: an action without `file` looks in the file its batch named
    CursorInNamed    \* TRUE: `type` and `delete` are rejected with the cursor outside the named file

None == "none"
Kinds == {"move", "select", "point", "type", "delete", "say"}
Names == {"move", "select", "point"}

VARIABLES
    cursor,   \* the agent's cursor's file, or None: kept from batch to batch
    named,    \* the file the batch named, or None (playing.named)
    edited,   \* the batch has edited (playing.edited)
    played,   \* actions played in this batch
    stopped,  \* the batch was rejected at an action
    actedIn   \* the file the last action acted in, or None

vars == <<cursor, named, edited, played, stopped, actedIn>>

Init ==
    /\ cursor \in Files \cup {None}
    /\ named = None /\ edited = FALSE /\ played = 0 /\ stopped = FALSE /\ actedIn = None

Reject == stopped' = TRUE /\ actedIn' = None /\ UNCHANGED <<cursor, named, edited>>

\* One action, `kind`, with `file` (or None for none given).
Act(kind, file) ==
    /\ ~stopped /\ played < MaxActions /\ played' = played + 1
    /\ IF file # None /\ kind \in Names /\ named # None /\ file # named
          THEN Reject  \* names two files
       ELSE IF file # None /\ kind \in Names /\ named = None /\ edited
          THEN Reject  \* names its file after its first edit
       ELSE
          LET n == IF file # None /\ kind \in Names THEN file ELSE named
              \* fileOf: the file given, else the named one (with the fix), else the cursor's.
              looks == IF file # None THEN file
                       ELSE IF FallBackToNamed /\ n # None THEN n ELSE cursor
          IN CASE kind = "say" ->
                    /\ named' = n /\ actedIn' = None /\ UNCHANGED <<cursor, edited, stopped>>
               [] kind \in Names ->
                    IF looks = None THEN Reject  \* no_cursor
                    ELSE /\ named' = n /\ actedIn' = looks
                         /\ cursor' = IF kind = "point" THEN cursor ELSE looks
                         /\ UNCHANGED <<edited, stopped>>
               [] OTHER ->  \* type, delete: at the cursor
                    IF cursor = None \/ (CursorInNamed /\ n # None /\ cursor # n) THEN Reject
                    ELSE /\ named' = n /\ actedIn' = cursor /\ edited' = TRUE
                         /\ UNCHANGED <<cursor, stopped>>

\* The batch ends (played through, or rejected) and the next starts, with the cursor where it is.
NextBatch ==
    /\ played > 0
    /\ named' = None /\ edited' = FALSE /\ played' = 0 /\ stopped' = FALSE /\ actedIn' = None
    /\ UNCHANGED cursor

Next == (\E k \in Kinds, f \in Files \cup {None} : Act(k, f)) \/ NextBatch

Spec == Init /\ [][Next]_vars

\* An action acts in the file its batch named, once it named one.
ActsInNamedFile == (actedIn # None /\ named # None) => actedIn = named

=============================================================================
