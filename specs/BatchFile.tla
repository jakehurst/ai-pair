---- MODULE BatchFile ----------------------------------------------------------
(******************************************************************************)
(* Which file each action of a batch acts in, in packages/core/src/player.ts: *)
(* `names` (a batch works in one file, named in a `move`, `select` or `point` *)
(* before its first edit), `fileOf` (the file a `move`, `select` or `point`   *)
(* looks in), and `type` and `delete`, which act at the agent's cursor. Only  *)
(* `move` and `select` move the cursor; `point` names a file without moving   *)
(* it. The batch's actions are any sequence of actions, each with or without  *)
(* `file`.                                                                    *)
(******************************************************************************)
EXTENDS Naturals

CONSTANTS
    Files,           \* the files
    MaxActions,      \* how many actions the model plays in a batch
    FallBackToNamed, \* TRUE: an action without `file` looks in the file its
                     \* batch named
    CursorInNamed    \* TRUE: `type` and `delete` are rejected with the cursor
                     \* outside the named file

ASSUME AssumeMaxActions == MaxActions \in Nat
ASSUME AssumeFallBackToNamed == FallBackToNamed \in BOOLEAN
ASSUME AssumeCursorInNamed == CursorInNamed \in BOOLEAN

\* No file: no cursor before the first move, no file named, no `file` given,
\* or no file acted in. Any value that is not a file will do, so the config
\* makes it a model value (6.20).
NoFile == CHOOSE v : v \notin Files

\* The kinds of action.
Kinds == {"move", "select", "point", "type", "delete", "say"}

\* The kinds of action that name a file, when given one.
Names == {"move", "select", "point"}

VARIABLES
    cursor,   \* the agent's cursor's file, or NoFile: kept from batch to batch
    named,    \* the file the batch named, or NoFile (playing.named)
    edited,   \* the batch has edited (playing.edited)
    played,   \* actions played in this batch
    stopped,  \* the batch was rejected at an action
    actedIn   \* the file the last action acted in, or NoFile

vars == <<cursor, named, edited, played, stopped, actedIn>>

--------------------------------------------------------------------------------

\* The values each variable can hold.
TypeOK ==
    /\ cursor \in Files \cup {NoFile}
    /\ named \in Files \cup {NoFile}
    /\ edited \in BOOLEAN
    /\ played \in Nat
    /\ stopped \in BOOLEAN
    /\ actedIn \in Files \cup {NoFile}

--------------------------------------------------------------------------------

Init ==
    /\ cursor \in Files \cup {NoFile}
    /\ named = NoFile
    /\ edited = FALSE
    /\ played = 0
    /\ stopped = FALSE
    /\ actedIn = NoFile

\* The action fails, and the batch stops at it.
Reject ==
    /\ stopped' = TRUE
    /\ actedIn' = NoFile
    /\ UNCHANGED <<cursor, named, edited>>

\* A `say`: it acts in no file.
Say ==
    /\ actedIn' = NoFile
    /\ UNCHANGED <<cursor, named, edited, stopped>>

\* A `move`, `select` or `point` in the file it looks in, `looks`, with the
\* batch's file now `n`; with no file to look in, no_cursor rejects it. Only
\* `move` and `select` move the cursor there.
ActInFile(kind, n, looks) ==
    IF looks = NoFile
    THEN Reject
    ELSE /\ cursor' = IF kind = "point" THEN cursor ELSE looks
         /\ named' = n
         /\ actedIn' = looks
         /\ UNCHANGED <<edited, stopped>>

\* A `type` or `delete` at the cursor, with the batch's file `n`: rejected
\* with no cursor, and, with CursorInNamed, with the cursor outside the file
\* the batch named.
ActAtCursor(n) ==
    IF cursor = NoFile \/ (CursorInNamed /\ n # NoFile /\ cursor # n)
    THEN Reject
    ELSE /\ named' = n
         /\ edited' = TRUE
         /\ actedIn' = cursor
         /\ UNCHANGED <<cursor, stopped>>

\* One action of the batch, of kind `kind`, with `file`, or NoFile for none
\* given. It is rejected when it names a second file, or names the batch's
\* file after its first edit. `n` is the batch's file after it, and `looks` is
\* fileOf: the file given, else the named one (with FallBackToNamed), else
\* the cursor's. CASE's OTHER arm is `type` and `delete`.
Act(kind, file) ==
    LET naming == kind \in Names /\ file # NoFile
        n == IF naming THEN file ELSE named
        looks == IF file # NoFile
                 THEN file
                 ELSE IF FallBackToNamed /\ n # NoFile THEN n ELSE cursor
    IN  /\ ~stopped
        /\ played' = played + 1
        /\ IF naming /\ named # NoFile /\ file # named
           THEN Reject
           ELSE IF naming /\ named = NoFile /\ edited
                THEN Reject
                ELSE CASE kind = "say" -> Say
                       [] kind \in Names -> ActInFile(kind, n, looks)
                       [] OTHER -> ActAtCursor(n)

\* The batch ends (played through, or rejected) and the next starts, with the
\* cursor where it is.
EndBatch ==
    /\ played > 0
    /\ named' = NoFile
    /\ edited' = FALSE
    /\ played' = 0
    /\ stopped' = FALSE
    /\ actedIn' = NoFile
    /\ UNCHANGED cursor

Next ==
    \/ \E k \in Kinds, f \in Files \cup {NoFile} : Act(k, f)
    \/ EndBatch

Spec == Init /\ [][Next]_vars

--------------------------------------------------------------------------------

\* An action acts in the file its batch named, once it named one.
ActsInNamedFile == (actedIn # NoFile /\ named # NoFile) => (actedIn = named)

\* A `type` or `delete` with the cursor in the batch's file, or in a batch
\* that named none, edits there. Code that rejected every edit would fail
\* it, so it says something must happen.
EditAtCursorProp ==
    [][\A k \in {"type", "delete"} :
           (Act(k, NoFile) /\ cursor # NoFile /\ named \in {cursor, NoFile})
               => (~stopped' /\ edited' /\ actedIn' = cursor)]_vars

\* Batches run out of actions only so that the model is finite (6.8). It
\* prunes exactly the states a guard `played < MaxActions` on Act never
\* reached.
Constraint == played <= MaxActions

================================================================================
