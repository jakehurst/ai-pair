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
    MaxEdits,       \* how many edits the model makes
    KeepInterrupts  \* TRUE: an interrupting edit is reported even with no net
                    \* change

ASSUME AssumeMaxEdits == MaxEdits \in Nat
ASSUME AssumeKeepInterrupts == KeepInterrupts \in BOOLEAN

\* The file's texts, as numbers.
Contents == 0..2

\* No baseline. Any value that is not a text will do, so the config makes it a
\* model value (6.20).
NoText == CHOOSE v : v \notin Contents

VARIABLES
    text,         \* the file's text
    baseline,     \* the event's `before`: the text at the first edit since
                  \* the last report, or NoText
    byProgrammer, \* the pending event is the programmer's (`by`)
    interrupts,   \* the pending event interrupts: the programmer's, or marked
                  \* `interrupted`
    discarded,    \* batches were discarded for an edit since the last report
    report,       \* the last report: taken, with an event, the programmer's, a
                  \* net change, batches discarded, a file edited
    edits         \* edits made so far

vars == <<text, baseline, byProgrammer, interrupts, discarded, report, edits>>

--------------------------------------------------------------------------------

\* The values each variable can hold.
TypeOK ==
    /\ text \in Contents
    /\ baseline \in Contents \cup {NoText}
    /\ byProgrammer \in BOOLEAN
    /\ interrupts \in BOOLEAN
    /\ discarded \in BOOLEAN
    /\ report \in [taken : BOOLEAN, event : BOOLEAN, byProgrammer : BOOLEAN,
                 netChange : BOOLEAN, discarded : BOOLEAN, edited : BOOLEAN]
    /\ edits \in Nat

\* No report yet.
NoReport ==
    [taken |-> FALSE, event |-> FALSE, byProgrammer |-> FALSE,
     netChange |-> FALSE,
     discarded |-> FALSE, edited |-> FALSE]

\* recordEdit: the first edit since the report sets the baseline and the
\* event.
Record(t, asProgrammer, interrupting) ==
    /\ t # text
    /\ text' = t
    /\ baseline' = IF baseline = NoText THEN text ELSE baseline
    /\ byProgrammer' = (byProgrammer \/ asProgrammer)
    /\ interrupts' = (interrupts \/ interrupting)
    /\ discarded' = (discarded \/ interrupting)
    /\ edits' = edits + 1
    /\ UNCHANGED report

--------------------------------------------------------------------------------

Init ==
    /\ text \in Contents
    /\ baseline = NoText
    /\ byProgrammer = FALSE
    /\ interrupts = FALSE
    /\ discarded = FALSE
    /\ report = NoReport
    /\ edits = 0

\* userEdit in the agent's turn: it interrupts.
EditAsProgrammer(t) == Record(t, TRUE, TRUE)

\* otherEdit, to a file the queued batches edit (`planned`) or not.
EditAsOther(t, planned) == Record(t, FALSE, planned)

\* snapshot: the event, unless the file is as it was; with KeepInterrupts, an
\* interrupting one stays.
Report ==
    /\ baseline # NoText
    /\ baseline' = NoText
    /\ byProgrammer' = FALSE
    /\ interrupts' = FALSE
    /\ discarded' = FALSE
    /\ LET netChange == text # baseline
           event == netChange \/ (KeepInterrupts /\ interrupts)
       IN  report' = [taken |-> TRUE, event |-> event,
                     byProgrammer |-> byProgrammer, netChange |-> netChange,
                     discarded |-> discarded, edited |-> TRUE]
    /\ UNCHANGED <<text, edits>>

Next ==
    \/ \E t \in Contents : EditAsProgrammer(t)
    \/ \E t \in Contents, planned \in BOOLEAN : EditAsOther(t, planned)
    \/ Report

Spec == Init /\ [][Next]_vars

--------------------------------------------------------------------------------

\* A change that remains is reported: something must happen.
NetReported == (report.taken /\ report.netChange) => report.event

\* Batches discarded for an edit come with the edit that discarded them, so
\* the agent knows why.
Explained == (report.taken /\ report.discarded) => report.event

\* Edits run out only so that the model is finite (6.8).
Constraint == edits <= MaxEdits

================================================================================
