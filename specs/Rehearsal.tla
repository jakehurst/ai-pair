------------------------------ MODULE Rehearsal ------------------------------
\* Line identities across rehearsals, line by line: the editor's LineIds, each queued batch's fork
\* of it, `adopt` when a batch completes, `followChange`, and the numbers the agent was shown
\* (`seen`), in core/src/lines.ts, core/src/rehearsal.ts, core/src/controller.ts and
\* core/src/player.ts. S10 in #19: a line number the agent was shown is accepted only while that
\* line still has it.
\*
\* Each line has a ghost: which line it really is, kept through edits within it and moved by
\* lines inserted or deleted around it. Changes are whole lines inserted or deleted, or an edit
\* within one line, where applyChange's rules (checked in LineIdentity.tla) say plainly which
\* line keeps which identity: an inserted line is new, the others keep theirs.
\*
\* Up to two batches are queued, each rehearsed from the one before it, or from the editor. A batch
\* edits the file, or leaves it alone. A change by others interrupts the queue if a queued batch
\* edits the file; otherwise the queued rehearsals follow it (`followChange`).
EXTENDS Naturals, Sequences

CONSTANTS
    MaxLines,   \* the most lines the file has
    Others,     \* how many changes others make (a tool, the programmer)
    Batches,         \* how many batches the agent submits
    OtherInterrupts, \* TRUE: a change by others to a file the queue edits interrupts it (`otherEdit`)
    AdoptChecksText, \* TRUE: `adopt` takes the fork's ids only for a text that reads as in the fork
    ShareIds         \* TRUE: followChange drops a fork's own copy of the file's ids, so it reads the editor's

VARIABLES
    ghosts,     \* the file's lines: which line each really is
    ids,        \* the editor's LineIds for them
    queue,      \* the queued batches, oldest first: [op, tracks, ids, ghosts]. `op`: its change to the file,
                \* or none; `tracks`: its fork has its own copy of the file's ids; `ids`, `ghosts`: the
                \* fork's, for the text it leaves
    seen,       \* what the agent was shown: number -> [id, ghost]
    bad,        \* a number was accepted for a line other than the one shown at it
    others,     \* changes by others so far
    batches,    \* batches submitted so far
    next,       \* the counter all trackers share, and new ghosts
    fresh       \* nothing changed since the agent's last read

vars == <<ghosts, ids, queue, seen, bad, others, batches, next, fresh>>

\* A change to a sequence of lines; an inserted line gets `new`.
Apply(s, o, new) ==
    CASE o.kind = "insert" -> SubSeq(s, 1, o.at - 1) \o <<new>> \o SubSeq(s, o.at, Len(s))
      [] o.kind = "delete" -> SubSeq(s, 1, o.at - 1) \o SubSeq(s, o.at + 1, Len(s))
      [] OTHER -> s   \* within one line, or none: everything keeps its identity

Ops(n) == [kind : {"insert"}, at : 1..(n + 1)] \cup [kind : {"delete", "edit"}, at : 1..n]
Allowed(o, n) == (o.kind = "insert" => n < MaxLines) /\ (o.kind # "insert" => n > 0)

\* A batch that leaves the file alone.
NoneOp == [kind |-> "none", at |-> 0]

Init ==
    /\ ghosts = <<1, 2>> /\ ids = <<101, 102>> /\ next = 3
    /\ queue = <<>> /\ seen = <<>> /\ bad = FALSE /\ others = 0 /\ batches = 0 /\ fresh = FALSE

\* Where the next batch's rehearsal starts: the last queued batch's fork, if it has its own copy
\* of the file's ids, else the editor.
Start == IF queue # <<>> /\ queue[Len(queue)].tracks THEN queue[Len(queue)] ELSE [ids |-> ids, ghosts |-> ghosts]

\* A queued batch edits the file, so `read` shows the text the queue leaves (`planned`).
Planned == \E k \in 1..Len(queue) : queue[k].op.kind # "none"

\* `read`: the text as the queued batches leave it, with the last one's ids (`saw` with its
\* `after.lines`), if they edit the file; else the editor's, with its ids.
Read ==
    /\ LET s == IF Planned THEN queue[Len(queue)] ELSE [ids |-> ids, ghosts |-> ghosts]
       IN seen' = [n \in 1..Len(s.ids) |-> [id |-> s.ids[n], ghost |-> s.ghosts[n]]]
    /\ fresh' = TRUE
    /\ UNCHANGED <<ghosts, ids, queue, bad, others, batches, next>>

\* `step`: the rehearsal forks where the queue leaves off, and plays the batch in memory. A line
\* the batch inserts gets a fresh id in the fork, and is the line the real play will make.
Submit ==
    /\ Len(queue) < 2 /\ batches < Batches
    /\ LET s == Start
           copied == queue # <<>> /\ queue[Len(queue)].tracks
       IN \E o \in Ops(Len(s.ghosts)) \cup {NoneOp} :
             /\ Allowed(o, Len(s.ghosts))
             /\ queue' = Append(queue, [op |-> o, tracks |-> o.kind # "none" \/ copied,
                                        ids |-> Apply(s.ids, o, next), ghosts |-> Apply(s.ghosts, o, next + 1)])
    /\ next' = next + 2 /\ batches' = batches + 1 /\ fresh' = FALSE
    /\ UNCHANGED <<ghosts, ids, seen, bad, others>>

\* The oldest batch plays its change on the editor, which tracks it (`apply`): a fresh id for an
\* inserted line. Then `adopt` takes its fork's ids, if the fork has a copy of them and the text
\* reads as it did in the fork. (A text is modeled by its lines, so "reads as in the fork" is "the
\* same lines".)
Play ==
    /\ queue # <<>>
    /\ LET b == Head(queue) IN
       /\ b.op \in Ops(Len(ghosts)) \cup {NoneOp}   \* else it fails on a line that isn't there: see PlayFails
       /\ LET g == Apply(ghosts, b.op, IF b.op.kind = "insert" THEN b.ghosts[b.op.at] ELSE 0)
              played == Apply(ids, b.op, next)
          IN /\ ghosts' = g
             /\ ids' = IF b.tracks /\ (~AdoptChecksText \/ g = b.ghosts) THEN b.ids ELSE played
    /\ queue' = Tail(queue) /\ next' = next + 1 /\ fresh' = FALSE
    /\ UNCHANGED <<seen, bad, others, batches>>

\* Played on a text with fewer lines than it was planned for, the batch fails (a line it names
\* isn't there): nothing is adopted, and the failure interrupts the queue behind it.
PlayFails ==
    /\ queue # <<>> /\ Head(queue).op \notin Ops(Len(ghosts)) \cup {NoneOp}
    /\ queue' = <<>> /\ fresh' = FALSE
    /\ UNCHANGED <<ghosts, ids, seen, bad, others, batches, next>>

\* A change by someone else to the file. If a queued batch edits it, the queue is interrupted and
\* discarded (`interrupt`). Otherwise each queued rehearsal follows it (`followChange`): its fork
\* reads the file's ids and moves them through the change, a fresh id of its own for an inserted
\* line; or with ShareIds, it drops its copy, to read the editor's.
Other ==
    /\ others < Others
    /\ \E o \in Ops(Len(ghosts)) :
          /\ Allowed(o, Len(ghosts))
          /\ ghosts' = Apply(ghosts, o, next) /\ ids' = Apply(ids, o, next + 1)
          /\ queue' =
                IF Planned THEN (IF OtherInterrupts THEN <<>> ELSE queue)
                ELSE [k \in 1..Len(queue) |->
                        IF ShareIds THEN [queue[k] EXCEPT !.tracks = FALSE]
                        ELSE [queue[k] EXCEPT
                                !.tracks = TRUE,
                                !.ids = Apply(IF queue[k].tracks THEN queue[k].ids ELSE ids, o, next + 2 + k),
                                !.ghosts = Apply(IF queue[k].tracks THEN queue[k].ghosts ELSE ghosts, o, next)]]
    /\ next' = next + 3 + Len(queue) /\ others' = others + 1 /\ fresh' = FALSE
    /\ UNCHANGED <<seen, bad, batches>>

\* The rehearsal of the agent's next batch checks a number it gives (`knows`, in `unseen`): accepted
\* when the id the agent was shown at that number is the id there where the rehearsal starts. The
\* real play doesn't check again.
Accept ==
    /\ \E n \in DOMAIN seen :
          /\ n <= Len(Start.ids) /\ seen[n].id = Start.ids[n]
          /\ bad' = (bad \/ seen[n].ghost # Start.ghosts[n])
    /\ UNCHANGED <<ghosts, ids, queue, seen, others, batches, next, fresh>>

Next == Read \/ Submit \/ Play \/ PlayFails \/ Other \/ Accept

Spec == Init /\ [][Next]_vars

\* S10.
AcceptedOnlyForThatLine == ~bad

\* The editor's LineIds has one identity for each line of the text.
OnePerLine == Len(ids) = Len(ghosts)

\* No identity names two lines, in the editor or in a fork.
Distinct(s) == \A i, j \in 1..Len(s) : s[i] = s[j] => i = j
IdsDistinct == Distinct(ids) /\ \A k \in 1..Len(queue) : Distinct(queue[k].ids)

\* Right after a read, the agent's next batch is checked against what it was shown: a line it was
\* just shown is accepted at its number.
ReadIsStart == fresh => \A n \in DOMAIN seen : n <= Len(Start.ids) /\ seen[n].id = Start.ids[n]

=============================================================================
