-------------------------------- MODULE Player --------------------------------
\* A `delete` in packages/core/src/player.ts, between its awaits, while the programmer edits:
\* S11 in #19 (the selection stays on the same text through an edit by someone else) and an
\* edit by the programmer interrupting playback. Offsets are where the selected text starts;
\* the programmer can type in front of it, which moves it, or behind it, which doesn't.
EXTENDS Naturals

CONSTANTS
    Edits,           \* how many edits the programmer makes, at most
    ReadAfterAwait,  \* TRUE: the delete reads the selection after its awaits (fix for #49)
    CheckInterrupt   \* TRUE: the delete stops after its awaits if playback was interrupted (fix for #49)

VARIABLES
    phase,        \* the delete: "before", "awaiting" (show, getText), "done"
    target,       \* where the selected text starts now
    selection,    \* s.selection's start: transformed by every edit, as `transform` does
    copy,         \* the start the delete copied before awaiting, or 0
    interrupted,  \* the timeline was interrupted
    edits,        \* how many edits the programmer has made
    outcome       \* "none", "deleted", "interrupted"
    , deletedAt   \* where the delete removed text, when it did

vars == <<phase, target, selection, copy, interrupted, edits, outcome, deletedAt>>

Init ==
    /\ phase = "before" /\ target = 5 /\ selection = 5 /\ copy = 0 /\ interrupted = FALSE
    /\ edits = 0 /\ outcome = "none" /\ deletedAt = 0

\* The delete starts: today it copies the selection's offsets, then awaits show() and getText().
Begin ==
    /\ phase = "before" /\ phase' = "awaiting"
    /\ copy' = selection
    /\ UNCHANGED <<target, selection, interrupted, edits, outcome, deletedAt>>

\* The awaits return; the delete removes text, or stops.
Finish ==
    /\ phase = "awaiting" /\ phase' = "done"
    /\ IF CheckInterrupt /\ interrupted
          THEN outcome' = "interrupted" /\ UNCHANGED deletedAt
          ELSE outcome' = "deleted" /\ deletedAt' = IF ReadAfterAwait THEN selection ELSE copy
    /\ UNCHANGED <<target, selection, copy, interrupted, edits>>

\* The programmer types in front of the selected text: it moves, and the selection with it.
TypeBefore ==
    /\ edits < Edits /\ phase # "done" /\ edits' = edits + 1
    /\ target' = target + 1 /\ selection' = selection + 1 /\ interrupted' = TRUE
    /\ UNCHANGED <<phase, copy, outcome, deletedAt>>

\* ...or behind it: nothing moves.
TypeAfter ==
    /\ edits < Edits /\ phase # "done" /\ edits' = edits + 1 /\ interrupted' = TRUE
    /\ UNCHANGED <<phase, target, selection, copy, outcome, deletedAt>>

Next == Begin \/ Finish \/ TypeBefore \/ TypeAfter

Spec == Init /\ [][Next]_vars

\* S11: a delete removes the text that is selected.
DeletesTheSelection == outcome = "deleted" => deletedAt = target

\* An edit by the programmer before the delete takes effect stops it.
EditInterrupts == (phase = "done" /\ interrupted) => outcome = "interrupted"

=============================================================================
