---- MODULE EditEvents ---------------------------------------------------------
(******************************************************************************)
(* Edit events across reports: `recordEdit`, `otherEdit` and `snapshot` in    *)
(* packages/core/src/controller.ts. One file. A report has one edit event for *)
(* it, with the diff from its text at the first edit since the last report to *)
(* its text now, as the programmer's if any of those edits was theirs. An     *)
(* edit that interrupts (the programmer's, or a tool's to a file the queued   *)
(* batches edit) discards the agent's batches and wakes a `listen`            *)
(* (`interrupting`), so the agent has to be told of it, even when the file    *)
(* ends up as it was.                                                         *)
(******************************************************************************)
EXTENDS Naturals

CONSTANTS
    MaxSteps,       \* how many edits the model makes
    KeepInterrupts  \* TRUE: an interrupting edit is reported even with no net
                    \* change

ASSUME AssumeMaxSteps == MaxSteps \in Nat
ASSUME AssumeKeepInterrupts == KeepInterrupts \in BOOLEAN

\* The file's texts, as numbers.
Texts == 0..2

\* No baseline. Any value that is not a text will do, so the config makes it a
\* model value (6.20).
NoText == CHOOSE v : v \notin Texts

VARIABLES
    text,       \* the file's text
    base,       \* s.baselines: its text at the first edit since the last
                \* report, or NoText
    prog,       \* the pending event is the programmer's (`by`)
    intr,       \* the pending event interrupts: the programmer's, or marked
                \* `interrupted`
    discarded,  \* batches were discarded for an edit since the last report
    last,       \* the last report: taken, with an event, the programmer's, a
                \* net change, batches discarded, a file edited
    steps       \* edits made so far

vars == <<text, base, prog, intr, discarded, last, steps>>

--------------------------------------------------------------------------------

\* The values each variable can hold.
TypeOK ==
    /\ text \in Texts
    /\ base \in Texts \cup {NoText}
    /\ prog \in BOOLEAN
    /\ intr \in BOOLEAN
    /\ discarded \in BOOLEAN
    /\ last \in [taken : BOOLEAN, event : BOOLEAN, prog : BOOLEAN,
                 net : BOOLEAN, discarded : BOOLEAN, edited : BOOLEAN]
    /\ steps \in Nat

\* No report yet.
NoReport ==
    [taken |-> FALSE, event |-> FALSE, prog |-> FALSE, net |-> FALSE,
     discarded |-> FALSE, edited |-> FALSE]

\* recordEdit: the first edit since the report sets the baseline and the
\* event.
Record(t, byProgrammer, interrupts) ==
    /\ t # text
    /\ text' = t
    /\ base' = IF base = NoText THEN text ELSE base
    /\ prog' = (prog \/ byProgrammer)
    /\ intr' = (intr \/ interrupts)
    /\ discarded' = (discarded \/ interrupts)
    /\ steps' = steps + 1
    /\ UNCHANGED last

--------------------------------------------------------------------------------

Init ==
    /\ text \in Texts
    /\ base = NoText
    /\ prog = FALSE
    /\ intr = FALSE
    /\ discarded = FALSE
    /\ last = NoReport
    /\ steps = 0

\* userEdit in the agent's turn: it interrupts.
EditAsProgrammer(t) == Record(t, TRUE, TRUE)

\* otherEdit, to a file the queued batches edit (`planned`) or not.
EditAsOther(t, planned) == Record(t, FALSE, planned)

\* snapshot: the event, unless the file is as it was; with KeepInterrupts, an
\* interrupting one stays.
Report ==
    /\ base # NoText
    /\ base' = NoText
    /\ prog' = FALSE
    /\ intr' = FALSE
    /\ discarded' = FALSE
    /\ LET net == text # base
           event == net \/ (KeepInterrupts /\ intr)
       IN  last' = [taken |-> TRUE, event |-> event, prog |-> prog,
                    net |-> net, discarded |-> discarded, edited |-> TRUE]
    /\ UNCHANGED <<text, steps>>

Next ==
    \/ \E t \in Texts : EditAsProgrammer(t)
    \/ \E t \in Texts, planned \in BOOLEAN : EditAsOther(t, planned)
    \/ Report

Spec == Init /\ [][Next]_vars

--------------------------------------------------------------------------------

\* A change that remains is reported: something must happen.
NetReported == (last.taken /\ last.net) => last.event

\* Batches discarded for an edit come with the edit that discarded them, so
\* the agent knows why.
Explained == (last.taken /\ last.discarded) => last.event

\* Edits run out only so that the model is finite (6.8).
Constraint == steps <= MaxSteps

================================================================================
