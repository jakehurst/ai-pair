------------------------------- MODULE EditEvents -------------------------------
\* Edit events across reports: `recordEdit`, `otherEdit` and `snapshot` in
\* packages/core/src/controller.ts. One file. A report has one edit event for it, with the diff
\* from its text at the first edit since the last report to its text now, as the programmer's if
\* any of those edits was theirs. An edit that interrupts (the programmer's, or a tool's to a file
\* the queued batches edit) discards the agent's batches and wakes a `listen` (`interrupting`), so
\* the agent has to be told of it, even when the file ends up as it was.
EXTENDS Integers

CONSTANTS
    Steps,          \* how many edits in a run
    KeepInterrupts  \* TRUE: an interrupting edit is reported even with no net change

Texts == 0..2
None == -1

VARIABLES
    text,       \* the file's text
    base,       \* s.baselines: its text at the first edit since the last report, or None
    prog,       \* the pending event is the programmer's (`by`)
    intr,       \* the pending event interrupts: the programmer's, or marked `interrupted`
    discarded,  \* batches were discarded for an edit since the last report
    last,       \* the last report: [taken, event, by programmer, why]
    steps

vars == <<text, base, prog, intr, discarded, last, steps>>

NoReport == [taken |-> FALSE, event |-> FALSE, prog |-> FALSE, net |-> FALSE, discarded |-> FALSE, edited |-> FALSE]

Init ==
    /\ text \in Texts /\ base = None /\ prog = FALSE /\ intr = FALSE /\ discarded = FALSE
    /\ last = NoReport /\ steps = 0

\* recordEdit: the first edit since the report sets the baseline and the event.
Record(t, byProgrammer, interrupts) ==
    /\ steps < Steps /\ steps' = steps + 1 /\ t # text /\ text' = t
    /\ base' = IF base = None THEN text ELSE base
    /\ prog' = (prog \/ byProgrammer)
    /\ intr' = (intr \/ interrupts)
    /\ discarded' = (discarded \/ interrupts)
    /\ UNCHANGED last

\* userEdit in the agent's turn (it interrupts), and otherEdit, to a file the queue edits or not.
Programmer == \E t \in Texts : Record(t, TRUE, TRUE)
Other == \E t \in Texts, planned \in BOOLEAN : Record(t, FALSE, planned)

\* snapshot: the event, unless the file is as it was; with KeepInterrupts, an interrupting one stays.
Report ==
    /\ base # None
    /\ LET net == text # base
           event == net \/ (KeepInterrupts /\ intr)
       IN last' = [taken |-> TRUE, event |-> event, prog |-> prog, net |-> net, discarded |-> discarded, edited |-> TRUE]
    /\ base' = None /\ prog' = FALSE /\ intr' = FALSE /\ discarded' = FALSE
    /\ UNCHANGED <<text, steps>>

Next == Programmer \/ Other \/ Report

Spec == Init /\ [][Next]_vars

\* A change that remains is reported.
NetReported == last.taken /\ last.net => last.event

\* Batches discarded for an edit come with the edit that discarded them, so the agent knows why.
Explained == last.taken /\ last.discarded => last.event

=============================================================================
