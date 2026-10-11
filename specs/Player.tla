---- MODULE Player -------------------------------------------------------------
(******************************************************************************)
(* A `delete` in packages/core/src/player.ts, between its awaits, while the   *)
(* programmer edits: the selection stays on the same text through an edit by  *)
(* someone else, and an edit by the programmer interrupting playback. Offsets *)
(* are where the selected text starts; the programmer can type in front of    *)
(* it, which moves it, or behind it, which does not. The delete runs once,    *)
(* and the programmer edits only until it is done: Finished models the end.   *)
(******************************************************************************)
EXTENDS Naturals

CONSTANTS
    MaxEdits,       \* how many edits the model lets the programmer make
    ReadAfterAwait, \* TRUE: the delete reads the selection after its awaits
                    \* (fix for #49)
    CheckInterrupt  \* TRUE: the delete stops after its awaits if playback was
                    \* interrupted (fix for #49)

ASSUME AssumeMaxEdits == MaxEdits \in Nat
ASSUME AssumeReadAfterAwait == ReadAfterAwait \in BOOLEAN
ASSUME AssumeCheckInterrupt == CheckInterrupt \in BOOLEAN

\* Where the selected text starts before any edit. Any offset will do.
StartOffset == 5

\* What a delete that is done did.
Outcomes == {"deleted", "interrupted"}

\* No offset: the delete has copied none, or removed no text. Any value that
\* is not an offset will do, so the config makes it a model value (6.20).
NoOffset == CHOOSE v : v \notin Nat

\* No outcome: the delete is not done. Any value that is not an outcome will
\* do, so the config makes it a model value (6.20).
NoOutcome == CHOOSE v : v \notin Outcomes

VARIABLES
    phase,       \* the delete: "before", "awaiting" (show, getText), or "done"
    target,      \* where the selected text starts now
    selection,   \* s.selection's start: moved by every edit, as `transform`
                 \* does
    copy,        \* the start the delete copied before awaiting, or NoOffset
    interrupted, \* the timeline was interrupted
    edits,       \* how many edits the programmer has made
    outcome,     \* what the delete did: an outcome, or NoOutcome
    deletedAt    \* where the delete removed text, or NoOffset

vars ==
    <<phase, target, selection, copy, interrupted, edits, outcome, deletedAt>>

--------------------------------------------------------------------------------

\* The values each variable can hold.
TypeOK ==
    /\ phase \in {"before", "awaiting", "done"}
    /\ target \in Nat
    /\ selection \in Nat
    /\ copy \in {NoOffset} \cup Nat
    /\ interrupted \in BOOLEAN
    /\ edits \in Nat
    /\ outcome \in Outcomes \cup {NoOutcome}
    /\ deletedAt \in {NoOffset} \cup Nat

--------------------------------------------------------------------------------

Init ==
    /\ phase = "before"
    /\ target = StartOffset
    /\ selection = StartOffset
    /\ copy = NoOffset
    /\ interrupted = FALSE
    /\ edits = 0
    /\ outcome = NoOutcome
    /\ deletedAt = NoOffset

\* The delete starts and awaits show() and getText(). It copies the
\* selection's start first, which only the code before #49 then used.
Begin ==
    /\ phase = "before"
    /\ phase' = "awaiting"
    /\ copy' = selection
    /\ UNCHANGED <<target, selection, interrupted, edits, outcome, deletedAt>>

\* The awaits return; the delete removes text, or stops.
Finish ==
    /\ phase = "awaiting"
    /\ phase' = "done"
    /\ IF CheckInterrupt /\ interrupted
       THEN /\ outcome' = "interrupted"
            /\ UNCHANGED deletedAt
       ELSE /\ outcome' = "deleted"
            /\ deletedAt' = IF ReadAfterAwait THEN selection ELSE copy
    /\ UNCHANGED <<target, selection, copy, interrupted, edits>>

\* The programmer types in front of the selected text: it moves, and the
\* selection with it.
TypeBefore ==
    /\ phase # "done"
    /\ target' = target + 1
    /\ selection' = selection + 1
    /\ interrupted' = TRUE
    /\ edits' = edits + 1
    /\ UNCHANGED <<phase, copy, outcome, deletedAt>>

\* The programmer types behind the selected text: nothing moves.
TypeAfter ==
    /\ phase # "done"
    /\ interrupted' = TRUE
    /\ edits' = edits + 1
    /\ UNCHANGED <<phase, target, selection, copy, outcome, deletedAt>>

\* The delete is done, and the run ends, by design (6.13).
Finished ==
    /\ phase = "done"
    /\ UNCHANGED vars

Next ==
    \/ Begin
    \/ Finish
    \/ TypeBefore
    \/ TypeAfter
    \/ Finished

\* The delete goes on through its awaits; edits come when they do.
Fairness ==
    /\ WF_vars(Begin)
    /\ WF_vars(Finish)

Spec == Init /\ [][Next]_vars /\ Fairness

--------------------------------------------------------------------------------

\* A delete removes the text that is selected.
DeletesTheSelection == (outcome = "deleted") => (deletedAt = target)

\* An edit by the programmer before the delete takes effect stops it.
EditInterrupts == (phase = "done" /\ interrupted) => (outcome = "interrupted")

\* A delete ends: it removes text, or stops. A delete that hung at its awaits
\* would fail it, so it says something must happen.
DeleteEnds == (phase = "before") ~> (outcome # NoOutcome)

\* Edits run out only so that the model is finite (6.8). It prunes exactly the
\* states a guard `edits < MaxEdits` on TypeBefore and TypeAfter never
\* reached, so the behaviors, and DeleteEnds' result, are the guard's (8.6).
Constraint == edits <= MaxEdits

================================================================================
