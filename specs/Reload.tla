-------------------------------- MODULE Reload --------------------------------
\* A file replaced on disk while it is open, as a git checkout does: S10 and S11 in #19, for
\* `otherEdit` and `recordEdit` in packages/core/src/controller.ts, with the change VS Code
\* reports. VS Code reloads the document with one change from the first line that differs to the
\* last, unchanged lines between them included (measured: lines 2 and 5 of 6 changed on disk
\* came as one change replacing lines 2 to 5). `recordEdit` moves the agent's selection and the
\* lines' identities through each change it is given: a line inside a change gets a fresh
\* identity, and a selection inside one ends up after it (`mapThrough`). Lines are changed in
\* place: which lines change, of N, is any nonempty set.
EXTENDS Naturals, FiniteSets

CONSTANTS
    N,       \* how many lines the file has
    Refine   \* TRUE: each run of changed lines is its own change (diffLines within VS Code's change)

VARIABLES
    ghosts,  \* which line each line really is; a changed line is a new one
    ids,     \* the editor's LineIds for the lines
    sel,     \* the line the agent's selection is on
    orig,    \* the line it was on before the reload
    reloaded \* the disk change happened

vars == <<ghosts, ids, sel, orig, reloaded>>

Lines == 1..N

Init ==
    /\ ghosts = [l \in Lines |-> l] /\ ids = [l \in Lines |-> 100 + l]
    /\ sel \in Lines /\ orig = sel /\ reloaded = FALSE

\* The changes recordEdit is given, as ranges of lines [from, to].
Runs(R) == {<<a, b>> \in R \X R : a <= b /\ (a - 1) \notin R /\ (b + 1) \notin R /\ \A l \in a..b : l \in R}
Coarse(R) == {<<CHOOSE a \in R : \A l \in R : a <= l, CHOOSE b \in R : \A l \in R : l <= b>>}

InChange(l, cs) == \E c \in cs : c[1] <= l /\ l <= c[2]
\* mapThrough: a position inside a change maps to its end, the start of the line after it.
After(l, cs) == LET c == CHOOSE c \in cs : c[1] <= l /\ l <= c[2] IN c[2] + 1

Reload ==
    /\ ~reloaded /\ reloaded' = TRUE
    /\ \E R \in SUBSET Lines \ {{}} :
          LET cs == IF Refine THEN Runs(R) ELSE Coarse(R) IN
          /\ ghosts' = [l \in Lines |-> IF l \in R THEN 1000 + l ELSE ghosts[l]]
          /\ ids' = [l \in Lines |-> IF InChange(l, cs) THEN 200 + l ELSE ids[l]]
          /\ sel' = IF InChange(sel, cs) THEN After(sel, cs) ELSE sel
    /\ UNCHANGED orig

Next == Reload

Spec == Init /\ [][Next]_vars

\* S11: a selection on a line that didn't change stays on it.
SelectionStays == ghosts[orig] = orig => sel = orig

\* S10, for precision: a line that didn't change keeps its identity, so its number is still known.
UnchangedKeepIds == \A l \in Lines : ghosts[l] = l => ids[l] = 100 + l

=============================================================================
