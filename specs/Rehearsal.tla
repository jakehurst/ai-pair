------------------------------ MODULE Rehearsal ------------------------------
\* Line identities across a rehearsal, line by line: the editor's LineIds, a rehearsal's fork of
\* it, `adopt` when the batch completes, and the numbers the agent was shown (`seen`), in
\* core/src/lines.ts, core/src/rehearsal.ts, core/src/controller.ts and core/src/player.ts.
\* S10 in #19: a line number the agent was shown is accepted only while that line still has it.
\*
\* Each line has a ghost: which line it really is, kept through edits within it and moved by
\* lines inserted or deleted around it. Changes are whole lines inserted or deleted, or an edit
\* within one line, where applyChange's rules (checked in LineIdentity.tla) say plainly which
\* line keeps which identity: an inserted line is new, the others keep theirs.
EXTENDS Naturals, Sequences

CONSTANTS
    MaxLines,   \* the most lines the file has
    Others,     \* how many changes others make (a tool, the programmer)
    Batches,         \* how many batches the agent submits
    OtherInterrupts, \* TRUE: a change by others to a file the queue edits interrupts it (`otherEdit`)
    AdoptChecksText  \* TRUE: `adopt` takes the fork's ids only for a text that reads as in the fork

VARIABLES
    ghosts,     \* the file's lines: which line each really is
    ids,        \* the editor's LineIds for them
    phase,      \* the batch: "none", "queued" (rehearsed), "done"
    op,         \* the batch's change: [kind, at, ghost (for a line it inserts)]
    forkIds,    \* the rehearsal's LineIds for the text it leaves: the fork's
    forkGhosts, \* ...and which lines those are
    seen,       \* what the agent was shown: number -> [id, ghost]
    bad,        \* a number was accepted for a line other than the one shown at it
    others,     \* changes by others so far
    batches,    \* batches submitted so far
    next        \* the counter all trackers share, and new ghosts

vars == <<ghosts, ids, phase, op, forkIds, forkGhosts, seen, bad, others, batches, next>>

\* A change to a sequence of lines; an inserted line gets `new`.
Apply(s, o, new) ==
    CASE o.kind = "insert" -> SubSeq(s, 1, o.at - 1) \o <<new>> \o SubSeq(s, o.at, Len(s))
      [] o.kind = "delete" -> SubSeq(s, 1, o.at - 1) \o SubSeq(s, o.at + 1, Len(s))
      [] OTHER -> s   \* within one line: everything keeps its identity

Ops(n) == [kind : {"insert"}, at : 1..(n + 1)] \cup [kind : {"delete", "edit"}, at : 1..n]
Allowed(o, n) == (o.kind = "insert" => n < MaxLines) /\ (o.kind # "insert" => n > 0)

Init ==
    /\ ghosts = <<1, 2>> /\ ids = <<101, 102>> /\ next = 3
    /\ phase = "none" /\ op = [kind |-> "edit", at |-> 1]
    /\ forkIds = <<>> /\ forkGhosts = <<>> /\ seen = <<>> /\ bad = FALSE /\ others = 0 /\ batches = 0

\* `read` with no batch queued: the editor's text and its ids (`saw` with s.lines).
ReadEditor ==
    /\ phase # "queued"
    /\ seen' = [n \in 1..Len(ids) |-> [id |-> ids[n], ghost |-> ghosts[n]]]
    /\ UNCHANGED <<ghosts, ids, phase, op, forkIds, forkGhosts, bad, others, batches, next>>

\* `step`: the rehearsal forks the editor's ids and plays the change in memory. A line the
\* batch inserts gets a fresh id in the fork, and is the line the real play will make.
Submit ==
    /\ phase # "queued" /\ batches < Batches
    /\ \E o \in Ops(Len(ghosts)) :
          /\ Allowed(o, Len(ghosts))
          /\ op' = o
          /\ forkIds' = Apply(ids, o, next) /\ forkGhosts' = Apply(ghosts, o, next + 1)
    /\ next' = next + 2 /\ phase' = "queued" /\ batches' = batches + 1
    /\ UNCHANGED <<ghosts, ids, seen, bad, others>>

\* `read` while the batch is queued: the text as the batch will leave it, with the fork's ids
\* (`saw` with the queue's `after.lines`).
ReadPlanned ==
    /\ phase = "queued"
    /\ seen' = [n \in 1..Len(forkIds) |-> [id |-> forkIds[n], ghost |-> forkGhosts[n]]]
    /\ UNCHANGED <<ghosts, ids, phase, op, forkIds, forkGhosts, bad, others, batches, next>>

\* The batch plays the same change on the editor, which tracks it (`apply`): a fresh id for an
\* inserted line. Then `adopt` takes the fork's ids, if the text reads as it did in the fork.
\* (A text is modeled by its lines, so "reads as in the fork" is "the same lines".)
Play ==
    /\ phase = "queued"
    /\ op \in Ops(Len(ghosts))   \* else it fails on a line that isn't there: see PlayFails
    /\ LET g == Apply(ghosts, op, IF op.kind = "insert" THEN forkGhosts[op.at] ELSE 0)
           played == Apply(ids, op, next)
       IN /\ ghosts' = g
          /\ ids' = IF ~AdoptChecksText \/ g = forkGhosts THEN forkIds ELSE played
    /\ phase' = "done" /\ next' = next + 1
    /\ UNCHANGED <<op, forkIds, forkGhosts, seen, bad, others, batches>>

\* Played on a text with fewer lines than it was planned for, the batch fails (a line it names
\* isn't there), so it doesn't complete and nothing is adopted.
PlayFails ==
    /\ phase = "queued" /\ op \notin Ops(Len(ghosts))
    /\ phase' = "done"
    /\ UNCHANGED <<ghosts, ids, op, forkIds, forkGhosts, seen, bad, others, batches, next>>

\* A change by someone else to the file. The queued batch edits it, so the batch is interrupted
\* and discarded (`interrupt`): it never plays, and nothing is adopted.
Other ==
    /\ others < Others
    /\ \E o \in Ops(Len(ghosts)) :
          /\ Allowed(o, Len(ghosts))
          /\ ghosts' = Apply(ghosts, o, next) /\ ids' = Apply(ids, o, next + 1)
    /\ next' = next + 2 /\ others' = others + 1
    /\ phase' = IF phase = "queued" /\ OtherInterrupts THEN "done" ELSE phase
    /\ UNCHANGED <<op, forkIds, forkGhosts, seen, bad, batches>>

\* The player checks a number the agent gives (`knows`, in `unseen`): accepted when the id it
\* was shown at that number is the editor's id at that number now.
Accept ==
    /\ \E n \in DOMAIN seen :
          /\ n <= Len(ids) /\ n <= Len(ghosts) /\ seen[n].id = ids[n]
          /\ bad' = (bad \/ seen[n].ghost # ghosts[n])
    /\ UNCHANGED <<ghosts, ids, phase, op, forkIds, forkGhosts, seen, others, batches, next>>

Next == ReadEditor \/ Submit \/ ReadPlanned \/ Play \/ PlayFails \/ Other \/ Accept

Spec == Init /\ [][Next]_vars

\* S10.
AcceptedOnlyForThatLine == ~bad

\* The editor's LineIds has one identity for each line of the text.
OnePerLine == Len(ids) = Len(ghosts)

\* No identity names two lines, in the editor or in the fork.
Distinct(s) == \A i, j \in 1..Len(s) : s[i] = s[j] => i = j
IdsDistinct == Distinct(ids) /\ Distinct(forkIds)

=============================================================================
