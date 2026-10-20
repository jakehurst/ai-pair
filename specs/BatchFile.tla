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
EXTENDS Naturals, PairDefs

CONSTANTS
    MaxActions,      \* how many actions the model plays in a batch
    FallBackToNamed, \* TRUE: an action without `file` looks in the file its
                     \* batch named
    CursorInNamed    \* TRUE: `type` and `delete` are rejected with the cursor
                     \* outside the named file

ASSUME AssumeMaxActions == MaxActions \in Nat
ASSUME AssumeFallBackToNamed == FallBackToNamed \in BOOLEAN
ASSUME AssumeCursorInNamed == CursorInNamed \in BOOLEAN

\* The kinds of action that name a file, when given one.
NamingKinds == {"move", "select", "point"}

VARIABLES
    cursorFile,   \* the agent's cursor's file, or NoFile: kept from batch to
                  \* batch
    namedFile,    \* the file the batch named, or NoFile (playing.named)
    edited,   \* the batch has edited (playing.edited)
    actionsPlayed,   \* actions played in this batch
    rejected,  \* the batch was rejected at an action
    actedIn   \* the file the last action acted in, or NoFile

vars == <<cursorFile, namedFile, edited, actionsPlayed, rejected, actedIn>>

--------------------------------------------------------------------------------

\* The values each variable can hold.
TypeOK ==
    /\ cursorFile \in Files \cup {NoFile}
    /\ namedFile \in Files \cup {NoFile}
    /\ edited \in BOOLEAN
    /\ actionsPlayed \in Nat
    /\ rejected \in BOOLEAN
    /\ actedIn \in Files \cup {NoFile}

--------------------------------------------------------------------------------

Init ==
    /\ cursorFile \in Files \cup {NoFile}
    /\ namedFile = NoFile
    /\ edited = FALSE
    /\ actionsPlayed = 0
    /\ rejected = FALSE
    /\ actedIn = NoFile

\* The action fails, and the batch stops at it.
Stop ==
    /\ rejected' = TRUE
    /\ actedIn' = NoFile
    /\ UNCHANGED <<cursorFile, namedFile, edited>>

\* A `say` or `run`: it acts in no file.
Say ==
    /\ actedIn' = NoFile
    /\ UNCHANGED <<cursorFile, namedFile, edited, rejected>>

\* A `move`, `select` or `point` in the file it looks in, `looksIn`, with the
\* batch's file now `namedAfter`; with no file to look in, no_cursor rejects it.
\* Only
\* `move` and `select` move the cursor there.
ActInFile(kind, namedAfter, looksIn) ==
    IF looksIn = NoFile
    THEN Stop
    ELSE /\ cursorFile' = IF kind = "point" THEN cursorFile ELSE looksIn
         /\ namedFile' = namedAfter
         /\ actedIn' = looksIn
         /\ UNCHANGED <<edited, rejected>>

\* A `type`, `type_fast`, or `delete` at the cursor, with the batch's file
\* `namedAfter`:
\* rejected with no cursor, and, with CursorInNamed, with the cursor outside
\* the file the batch named.
ActAtCursor(namedAfter) ==
    IF cursorFile = NoFile \/ (CursorInNamed /\ namedAfter # NoFile
                               /\ cursorFile # namedAfter)
    THEN Stop
    ELSE /\ namedFile' = namedAfter
         /\ edited' = TRUE
         /\ actedIn' = cursorFile
         /\ UNCHANGED <<cursorFile, rejected>>

\* One action of the batch, of kind `kind`, with `file`, or NoFile for none
\* given. It is rejected when it names a second file, or names the batch's
\* file after its first edit. `namedAfter` is the batch's file after it, and
\* `looksIn` is
\* fileOf: the file given, else the named one (with FallBackToNamed), else
\* the cursor's. CASE's OTHER arm is `type`, `type_fast`, and `delete`.
Act(kind, file) ==
    LET naming == kind \in NamingKinds /\ file # NoFile
        namedAfter == IF naming THEN file ELSE namedFile
        looksIn == IF file # NoFile
                 THEN file
                 ELSE IF FallBackToNamed /\ namedAfter # NoFile
                      THEN namedAfter ELSE cursorFile
    IN  /\ ~rejected
        /\ actionsPlayed' = actionsPlayed + 1
        /\ IF naming /\ namedFile # NoFile /\ file # namedFile
           THEN Stop
           ELSE IF naming /\ namedFile = NoFile /\ edited
                THEN Stop
                ELSE CASE kind \in {"say", "run"} -> Say
                       [] kind \in NamingKinds -> ActInFile(kind, namedAfter,
                                                            looksIn)
                       [] OTHER -> ActAtCursor(namedAfter)

\* The batch ends (played through, or rejected) and the next starts, with the
\* cursor where it is.
EndBatch ==
    /\ actionsPlayed > 0
    /\ namedFile' = NoFile
    /\ edited' = FALSE
    /\ actionsPlayed' = 0
    /\ rejected' = FALSE
    /\ actedIn' = NoFile
    /\ UNCHANGED cursorFile

Next ==
    \/ \E k \in ActionKinds, f \in Files \cup {NoFile} : Act(k, f)
    \/ EndBatch

Spec == Init /\ [][Next]_vars

--------------------------------------------------------------------------------

\* An action acts in the file its batch named, once it named one.
ActsInNamedFile == (actedIn # NoFile
                    /\ namedFile # NoFile) => (actedIn = namedFile)

\* A `type`, `type_fast`, or `delete` with the cursor in the batch's file, or
\* in a batch that named none, edits there. Code that rejected every edit
\* would fail it, so it says something must happen.
EditAtCursorProp ==
    [][\A k \in {"type", "type_fast", "delete"} :
           (Act(k, NoFile) /\ cursorFile # NoFile /\ namedFile \in {cursorFile,
                                                                    NoFile})
               => (~rejected' /\ edited' /\ actedIn' = cursorFile)]_vars

\* Batches run out of actions only so that the model is finite (6.8). It
\* prunes exactly the states a guard `played < MaxActions` on Act never
\* reached.
Constraint == actionsPlayed <= MaxActions

================================================================================
