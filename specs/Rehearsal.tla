---- MODULE Rehearsal ----------------------------------------------------------
(******************************************************************************)
(* Line identities across rehearsals, line by line: the editor's LineIds,     *)
(* each queued batch's fork of it, `adopt` when a batch completes,            *)
(* `followChange`, and the numbers the agent was shown (`seen`), in           *)
(* core/src/lines.ts, core/src/rehearsal.ts, core/src/controller.ts and       *)
(* core/src/player.ts. A line number the agent was shown is accepted only     *)
(* while that line still has it.                                              *)
(*                                                                            *)
(* Each line has a ghost: which line it really is, kept through edits within  *)
(* it and moved by lines inserted or deleted around it. Changes are whole     *)
(* lines inserted or deleted, or an edit within one line, where applyChange's *)
(* rules (checked in LineIdentity.tla) say plainly which line keeps which     *)
(* identity: an inserted line is new, the others keep theirs.                 *)
(*                                                                            *)
(* Batches are queued, each rehearsed from the one before it, or from the     *)
(* editor; the code queues any number, and the config bounds them. A batch    *)
(* edits the file, or leaves it alone. A change by others interrupts the      *)
(* queue if a queued batch edits the file; otherwise the queued rehearsals    *)
(* follow it (`followChange`).                                                *)
(******************************************************************************)
EXTENDS Naturals, Sequences

CONSTANTS
    MaxLines,           \* how many lines the file has, at most
    MaxOthers,          \* how many changes others make (a tool, the
                        \* programmer)
    MaxBatches,         \* how many batches the agent submits
    MaxQueued,          \* how many batches are queued at once, at most
    OtherInterrupts,    \* TRUE: a change by others to a file the queue edits
                        \* interrupts it (`otherEdit`)
    AdoptChecksText,    \* TRUE: `adopt` takes the fork's ids only for a text
                        \* that reads as in the fork
    ShareIds            \* TRUE: followChange drops a fork's own copy of the
                        \* file's ids, so it reads the editor's

\* The file starts with two lines.
ASSUME AssumeMaxLines == MaxLines \in Nat \ {0, 1}
ASSUME AssumeMaxOthers == MaxOthers \in Nat
ASSUME AssumeMaxBatches == MaxBatches \in Nat
ASSUME AssumeMaxQueued == MaxQueued \in Nat
ASSUME AssumeOtherInterrupts == OtherInterrupts \in BOOLEAN
ASSUME AssumeAdoptChecksText == AdoptChecksText \in BOOLEAN
ASSUME AssumeShareIds == ShareIds \in BOOLEAN

\* The file's lines at the start, as ghosts.
FirstGhosts == <<1, 2>>

\* The editor's ids for them, above every id the shared counter reaches in a
\* model.
FirstIds == <<101, 102>>

\* Every change to the file: a line inserted before line `at`, line `at`
\* deleted, or an edit within line `at`.
Changes == [kind : {"insert", "delete", "edit"}, at : Nat \ {0}]

\* No change: a batch that leaves the file alone. Any value that is not a
\* change will do, so the config makes it a model value (6.20).
NoChange == CHOOSE v : v \notin Changes

\* A queued batch: its change to the file, or NoChange; whether its fork has
\* its own copy of the file's ids; and the fork's ids and ghosts, for the text
\* it leaves.
QueuedBatches ==
    [op : Changes \cup {NoChange},
     tracks : BOOLEAN,
     ids : Seq(Nat),
     ghosts : Seq(Nat)]

VARIABLES
    ghosts,     \* the file's lines: which line each really is
    ids,        \* the editor's LineIds for them
    queue,      \* the queued batches, oldest first
    seen,       \* what the agent was shown: number -> [id, ghost]
    bad,        \* a number was accepted for a line other than the one shown
                \* at it
    others,     \* changes by others so far
    batches,    \* batches submitted so far
    next,       \* the counter all trackers share, and new ghosts
    fresh,      \* nothing changed since the agent's last read
    stale       \* an interrupt came, and no report has said so yet (`stale`)

vars ==
    <<ghosts, ids, queue, seen, bad, others, batches, next, fresh, stale>>

--------------------------------------------------------------------------------

\* The values each variable can hold.
TypeOK ==
    /\ ghosts \in Seq(Nat)
    /\ ids \in Seq(Nat)
    /\ queue \in Seq(QueuedBatches)
    /\ seen \in Seq([id : Nat, ghost : Nat])
    /\ bad \in BOOLEAN
    /\ others \in Nat
    /\ batches \in Nat
    /\ next \in Nat
    /\ fresh \in BOOLEAN
    /\ stale \in BOOLEAN

\* The changes to a text of n lines.
Ops(n) ==
    [kind : {"insert"}, at : 1..(n + 1)] \cup
        [kind : {"delete", "edit"}, at : 1..n]

\* What a batch can do to a text of n lines: a change, or none.
BatchOps(n) == Ops(n) \cup {NoChange}

\* Change o inserts a line.
Inserts(o) == (o # NoChange) /\ (o.kind = "insert")

\* A change to a sequence of lines; an inserted line gets `new`. An edit
\* within one line, or no change, keeps every identity.
Apply(s, o, new) ==
    IF (o = NoChange) \/ (o.kind = "edit")
    THEN s
    ELSE IF o.kind = "insert"
         THEN SubSeq(s, 1, o.at - 1) \o <<new>> \o SubSeq(s, o.at, Len(s))
         ELSE SubSeq(s, 1, o.at - 1) \o SubSeq(s, o.at + 1, Len(s))

\* No identity names two lines of s.
Distinct(s) == \A i, j \in 1..Len(s) : (s[i] = s[j]) => (i = j)

\* The editor's lines, with their ids.
Editor == [ids |-> ids, ghosts |-> ghosts]

\* The last queued batch's fork has its own copy of the file's ids.
LastTracks == (queue # <<>>) /\ queue[Len(queue)].tracks

\* Where the next batch's rehearsal starts: the last queued batch's fork, if
\* it has its own copy of the file's ids, else the editor.
Start == IF LastTracks THEN queue[Len(queue)] ELSE Editor

\* A queued batch edits the file, so `read` shows the text the queue leaves
\* (`planned`).
Planned == \E k \in 1..Len(queue) : queue[k].op # NoChange

\* The lines of s as the agent is shown them, by number.
Shown(s) ==
    [n \in 1..Len(s.ids) |-> [id |-> s.ids[n], ghost |-> s.ghosts[n]]]

\* The rehearsal knows number n (`knows`): the id the agent was shown at it is
\* the id there where the rehearsal starts.
CanAccept(n) ==
    /\ n <= Len(Start.ids)
    /\ seen[n].id = Start.ids[n]

\* Queued batch k after a change o by others, which it follows
\* (`followChange`): with ShareIds, its fork drops its copy of the file's ids,
\* to read the editor's; else the fork moves its own copy, or the editor's,
\* through the change, with a fresh id of its own for an inserted line.
Followed(k, o) ==
    IF ShareIds
    THEN [queue[k] EXCEPT !.tracks = FALSE]
    ELSE LET from == IF queue[k].tracks THEN queue[k] ELSE Editor
         IN  [queue[k] EXCEPT !.tracks = TRUE,
                              !.ids = Apply(from.ids, o, next + 2 + k),
                              !.ghosts = Apply(from.ghosts, o, next)]

\* What an interrupt leaves of the queue: nothing, or the oldest batch, if it
\* was already playing; `interrupt` discards only the batches still queued, and
\* the playing one may go on to complete (#151).
Interrupted == {<<>>, SubSeq(queue, 1, 1)}

--------------------------------------------------------------------------------

Init ==
    /\ ghosts = FirstGhosts
    /\ ids = FirstIds
    /\ queue = <<>>
    /\ seen = <<>>
    /\ bad = FALSE
    /\ others = 0
    /\ batches = 0
    /\ next = Len(FirstGhosts) + 1
    /\ fresh = FALSE
    /\ stale = FALSE

\* `read`: the text as the queued batches leave it, with the last one's ids
\* (`saw` with its `after.lines`), if they edit the file and no interrupt is
\* unreported (`planned`); else the editor's, with its ids.
Read ==
    /\ seen' = Shown(IF Planned /\ ~stale THEN queue[Len(queue)] ELSE Editor)
    /\ fresh' = TRUE
    /\ UNCHANGED <<ghosts, ids, queue, bad, others, batches, next, stale>>

\* `step`: the rehearsal forks where the queue leaves off, and plays the batch,
\* with change o, in memory. A line the batch inserts gets a fresh id in the
\* fork, and is the line the real play will make. While `stale`, the batch is
\* discarded, unrehearsed, so nothing is queued.
Submit(o) ==
    /\ ~stale
    /\ queue' =
           Append(queue,
                  [op |-> o,
                   tracks |-> (o # NoChange) \/ LastTracks,
                   ids |-> Apply(Start.ids, o, next),
                   ghosts |-> Apply(Start.ghosts, o, next + 1)])
    /\ batches' = batches + 1
    /\ next' = next + 2
    /\ fresh' = FALSE
    /\ UNCHANGED <<ghosts, ids, seen, bad, others, stale>>

\* The oldest batch plays its change on the editor, which tracks it (`apply`):
\* a fresh id for an inserted line. Then `adopt` takes its fork's ids, if the
\* fork has a copy of them and the text reads as it did in the fork. (A text is
\* modeled by its lines, so "reads as in the fork" is "the same lines".) A
\* change to a line that isn't there is FailPlay's. Apply takes the ghost
\* argument only for an insert, so 0 stands in for any other change.
Play ==
    LET b == Head(queue)
        g == Apply(ghosts, b.op, IF Inserts(b.op) THEN b.ghosts[b.op.at] ELSE 0)
        adopted == b.tracks /\ (~AdoptChecksText \/ (g = b.ghosts))
    IN  /\ queue # <<>>
        /\ b.op \in BatchOps(Len(ghosts))
        /\ ghosts' = g
        /\ ids' = IF adopted THEN b.ids ELSE Apply(ids, b.op, next)
        /\ queue' = Tail(queue)
        /\ next' = next + 1
        /\ fresh' = FALSE
        /\ UNCHANGED <<seen, bad, others, batches, stale>>

\* Played on a text with fewer lines than it was planned for, the batch fails
\* (a line it names isn't there): nothing is adopted, and the failure
\* interrupts the queue behind it.
FailPlay ==
    /\ queue # <<>>
    /\ Head(queue).op \notin BatchOps(Len(ghosts))
    /\ queue' = <<>>
    /\ fresh' = FALSE
    /\ stale' = TRUE
    /\ UNCHANGED <<ghosts, ids, seen, bad, others, batches, next>>

\* Someone else makes change o to the file. If a queued batch edits it, the
\* queue is interrupted (`interrupt`): the batches still queued are discarded,
\* and the one playing, if any, plays on (#151). Otherwise each queued
\* rehearsal follows it (`followChange`).
EditAsOther(o) ==
    /\ ghosts' = Apply(ghosts, o, next)
    /\ ids' = Apply(ids, o, next + 1)
    /\ IF Planned /\ OtherInterrupts
       THEN /\ queue' \in Interrupted
            /\ stale' = TRUE
       ELSE /\ queue' =
                   IF Planned THEN queue
                   ELSE [k \in 1..Len(queue) |-> Followed(k, o)]
            /\ UNCHANGED stale
    /\ others' = others + 1
    /\ next' = next + 3 + Len(queue)
    /\ fresh' = FALSE
    /\ UNCHANGED <<seen, bad, batches>>

\* The rehearsal of the agent's next batch checks number n it gives (`knows`,
\* in `unseen`), and accepts it. The real play doesn't check again. While
\* `stale`, no batch is rehearsed, so nothing is accepted.
Accept(n) ==
    /\ ~stale
    /\ CanAccept(n)
    /\ bad' = (bad \/ (seen[n].ghost # Start.ghosts[n]))
    /\ UNCHANGED
           <<ghosts, ids, queue, seen, others, batches, next, fresh, stale>>

\* A report tells the agent about the interrupt (`stale = false` in its
\* snapshot), once the batch that was playing has finished: `ready()` waits
\* for it.
Report ==
    /\ stale
    /\ queue = <<>>
    /\ stale' = FALSE
    /\ UNCHANGED <<ghosts, ids, queue, seen, bad, others, batches, next, fresh>>

Next ==
    \/ Read
    \/ \E o \in BatchOps(Len(Start.ghosts)) : Submit(o)
    \/ Play
    \/ FailPlay
    \/ \E o \in Ops(Len(ghosts)) : EditAsOther(o)
    \/ \E n \in DOMAIN seen : Accept(n)
    \/ Report

Spec == Init /\ [][Next]_vars

--------------------------------------------------------------------------------

\* A number is accepted only for the line the agent was shown at it.
AcceptedOnlyForThatLine == ~bad

\* The editor's LineIds has one identity for each line of the text.
OnePerLine == Len(ids) = Len(ghosts)

\* No identity names two lines, in the editor or in a fork.
IdsDistinct ==
    /\ Distinct(ids)
    /\ \A k \in 1..Len(queue) : Distinct(queue[k].ids)

\* Right after a read, the agent's next batch is checked against what it was
\* shown, once no interrupt is unreported: a line it was just shown is accepted
\* at its number. Code that refused one would fail it, so it says something
\* must happen.
ReadIsStart == (fresh /\ ~stale) => (\A n \in DOMAIN seen : CanAccept(n))

\* The lines, the changes by others, the batches, and the queue are bounded
\* only so that the model is finite (6.8). Each bound prunes exactly the
\* states a guard on the action that grows it never reached (8.6).
Constraint ==
    /\ Len(ghosts) <= MaxLines
    /\ \A k \in 1..Len(queue) : Len(queue[k].ghosts) <= MaxLines
    /\ others <= MaxOthers
    /\ batches <= MaxBatches
    /\ Len(queue) <= MaxQueued

================================================================================
