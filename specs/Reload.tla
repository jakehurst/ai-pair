---- MODULE Reload -------------------------------------------------------------
(******************************************************************************)
(* A file replaced on disk while it is open, as a git checkout does: line     *)
(* identities and the agent's selection, for `otherEdit` and `recordEdit` in  *)
(* packages/core/src/controller.ts, with the change VS Code reports. VS Code  *)
(* reloads the document with one change from the first line that differs to   *)
(* the last, unchanged lines between them included (measured: lines 2 and 5   *)
(* of 6 changed on disk came as one change replacing lines 2 to 5).           *)
(* `recordEdit` moves the agent's selection and the lines' identities through *)
(* each change it is given: a line inside a change gets a fresh identity, and *)
(* a selection inside one ends up after it (`mapThrough`). Lines are changed  *)
(* in place: which lines change, of NumLines, is any nonempty set.            *)
(******************************************************************************)
EXTENDS Naturals

CONSTANTS
    NumLines,   \* how many lines the file has
    SplitRuns      \* TRUE: each run of changed lines is its own change
                \* (diffLines within VS Code's change)

ASSUME AssumeNumLines == NumLines \in Nat \ {0}
ASSUME AssumeRefine == SplitRuns \in BOOLEAN

\* The file's lines.
Lines == 1..NumLines

\* The editor's identity for line l before the reload, and the fresh one the
\* reload gives it.
OldId(l) == 100 + l
FreshId(l) == 200 + l

\* The new line that replaces line l when it changes.
NewLine(l) == 1000 + l

\* All of each.
OldIds == {OldId(l) : l \in Lines}
FreshIds == {FreshId(l) : l \in Lines}
Replacements == {NewLine(l) : l \in Lines}

VARIABLES
    ghosts,  \* which line each line really is; a changed line is a new one
    ids,     \* the editor's LineIds for the lines
    selectionLine,     \* the line the agent's selection is on
    selectionBefore,    \* the line it was on before the reload
    reloaded \* the disk change happened

vars == <<ghosts, ids, selectionLine, selectionBefore, reloaded>>

--------------------------------------------------------------------------------

\* The values each variable can hold. A selection inside a change at the last
\* line ends up after it, one past the last line.
TypeOK ==
    /\ ghosts \in [Lines -> Lines \cup Replacements]
    /\ ids \in [Lines -> OldIds \cup FreshIds]
    /\ selectionLine \in 1..(NumLines + 1)
    /\ selectionBefore \in Lines
    /\ reloaded \in BOOLEAN

\* The changes recordEdit is given, as ranges of lines, when `changed` are the
\* lines that changed: with Refine, each run of them is its own change.
Runs(changed) ==
    {r \in [from : changed, to : changed] :
        /\ r.from <= r.to
        /\ (r.from - 1) \notin changed
        /\ (r.to + 1) \notin changed
        /\ \A l \in r.from..r.to : l \in changed}

\* Without Refine: one change from the first changed line to the last, which
\* the two CHOOSEs pick; each is unique.
Coarse(changed) ==
    {[from |-> CHOOSE a \in changed : \A l \in changed : a <= l,
      to |-> CHOOSE b \in changed : \A l \in changed : l <= b]}

\* Line l is inside one of the changes cs.
InChange(l, cs) == \E r \in cs : r.from <= l /\ l <= r.to

\* mapThrough: a position inside a change maps to its end, the start of the
\* line after it. The changes are disjoint, so the CHOOSE's change, the one
\* holding l, is unique.
After(l, cs) == (CHOOSE r \in cs : r.from <= l /\ l <= r.to).to + 1

--------------------------------------------------------------------------------

Init ==
    /\ ghosts = [l \in Lines |-> l]
    /\ ids = [l \in Lines |-> OldId(l)]
    /\ selectionLine \in Lines
    /\ selectionBefore = selectionLine
    /\ reloaded = FALSE

\* The file changes on disk, `changed` being its changed lines, and VS Code
\* reports the change, coarse or split into runs.
Reload(changed) ==
    LET cs == IF SplitRuns THEN Runs(changed) ELSE Coarse(changed)
    IN  /\ ~reloaded
        /\ ghosts' =
           [l \in Lines |-> IF l \in changed THEN NewLine(l) ELSE ghosts[l]]
        /\ ids' =
           [l \in Lines |-> IF InChange(l, cs) THEN FreshId(l) ELSE ids[l]]
        /\ selectionLine' = IF InChange(selectionLine, cs)
                        THEN After(selectionLine, cs)
                        ELSE selectionLine
        /\ reloaded' = TRUE
        /\ UNCHANGED selectionBefore

\* The run ends after its one reload, by design (6.13).
Finished ==
    /\ reloaded
    /\ UNCHANGED vars

Next ==
    \/ \E changed \in (SUBSET Lines) \ {{}} : Reload(changed)
    \/ Finished

Spec == Init /\ [][Next]_vars

--------------------------------------------------------------------------------

\* A selection on a line that didn't change stays on it.
SelectionStays == (ghosts[selectionBefore] = selectionBefore)
    => (selectionLine = selectionBefore)

\* For precision: a line that didn't change keeps its identity, so its
\* number is still known.
UnchangedKeepIds == \A l \in Lines : (ghosts[l] = l) => (ids[l] = OldId(l))

\* A changed line gets a fresh identity, so a number shown for it before is
\* no longer taken. Code that kept every identity would fail it, so it says
\* something must happen.
ChangedGetNewIds == \A l \in Lines : (ghosts[l] # l) => (ids[l] # OldId(l))

================================================================================
