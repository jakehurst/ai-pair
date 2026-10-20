---- MODULE Rehearsal ----------------------------------------------------------
(******************************************************************************)
(* Line identities across rehearsals, line by line: the editor's LineIds,     *)
(* each queued batch's fork of it, `adopt` when a batch completes,            *)
(* `followChange`, and the numbers the agent was shown (`shownLines`), in     *)
(* packages/core/src/lines.ts, rehearsal.ts, controller.ts, and player.ts. A  *)
(* line number the agent was shown is accepted only while that line still     *)
(* has it.                                                                    *)
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
(* follow it (`followChange`). The programmer's edit (`userEdit`) interrupts  *)
(* in the agent's turn, and in their own turn does nothing to the queue; it   *)
(* is never followed. A batch is rehearsed in the turn of the scene the queue *)
(* leaves, and edits nothing in the programmer's turn.                        *)
(******************************************************************************)
EXTENDS Naturals, Sequences

CONSTANTS
    MaxLines,           \* how many lines the file has, at most
    MaxOthers,          \* how many changes others make (a tool, a formatter,
                        \* or the disk)
    MaxProgrammerEdits, \* how many edits the programmer makes
    MaxBatches,         \* how many batches the agent submits
    MaxQueued,          \* how many batches are queued at once, at most
    OtherInterrupts,    \* TRUE: a change by others to a file the queue edits
                        \* interrupts it (`otherEdit`)
    AdoptChecksText,    \* TRUE: `adopt` takes the fork's ids only for a text
                        \* that reads as in the fork
    ShareIds,           \* TRUE: followChange drops a fork's own copy of the
                        \* file's ids, so it reads the editor's
    ReportWaitsForQueue \* TRUE: a report clears `stale` only once the queue
                        \* is empty; with a batch still playing, the interrupt
                        \* counts as reported, and `stale` clears when it ends

\* The file starts with two lines.
ASSUME AssumeMaxLines == MaxLines \in Nat \ {0, 1}
ASSUME AssumeMaxOthers == MaxOthers \in Nat
ASSUME AssumeMaxProgrammerEdits == MaxProgrammerEdits \in Nat
ASSUME AssumeMaxBatches == MaxBatches \in Nat
ASSUME AssumeMaxQueued == MaxQueued \in Nat
ASSUME AssumeOtherInterrupts == OtherInterrupts \in BOOLEAN
ASSUME AssumeAdoptChecksText == AdoptChecksText \in BOOLEAN
ASSUME AssumeShareIds == ShareIds \in BOOLEAN
ASSUME AssumeReportWaitsForQueue == ReportWaitsForQueue \in BOOLEAN

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

\* Whose turn it is.
Turns == {"agent", "programmer"}

\* A queued batch: its change to the file, or NoChange; whether its fork has
\* its own copy of the file's ids; the fork's ids and ghosts, for the text it
\* leaves; and the turn of the scene it leaves (`after.scene`).
QueuedBatches ==
    [change : Changes \cup {NoChange},
     hasOwnIds : BOOLEAN,
     ids : Seq(Nat),
     ghosts : Seq(Nat),
     turn : Turns]

VARIABLES
    ghosts,          \* the file's lines: which line each really is
    ids,             \* the editor's LineIds for them
    queue,           \* the queued batches, oldest first
    shownLines,      \* what the agent was shown: number -> [id, ghost]
    wrongLine,       \* a number was accepted for a line other than the one
                     \* shown at it
    otherChanges,    \* changes by others so far
    programmerEdits, \* edits by the programmer so far
    turn,            \* whose turn it is (`scene.turn`)
    batches,         \* batches submitted so far
    nextId,          \* the counter all trackers share, and new ghosts
    justRead,        \* nothing changed since the agent's last read
    stale,           \* an interrupt came, and the queue may still hold what
                     \* it left: no report has said so, or a batch it left
                     \* still plays (`stale`)
    staleReported    \* a report has said so while that batch plays
                     \* (`staleReported`)

vars ==
    <<ghosts, ids, queue, shownLines, wrongLine, otherChanges, programmerEdits,
      turn, batches, nextId, justRead, stale, staleReported>>

--------------------------------------------------------------------------------

\* The values each variable can hold.
TypeOK ==
    /\ ghosts \in Seq(Nat)
    /\ ids \in Seq(Nat)
    /\ queue \in Seq(QueuedBatches)
    /\ shownLines \in Seq([id : Nat, ghost : Nat])
    /\ wrongLine \in BOOLEAN
    /\ otherChanges \in Nat
    /\ programmerEdits \in Nat
    /\ turn \in Turns
    /\ batches \in Nat
    /\ nextId \in Nat
    /\ justRead \in BOOLEAN
    /\ stale \in BOOLEAN
    /\ staleReported \in BOOLEAN

\* The changes to a text of n lines.
ChangesTo(n) ==
    [kind : {"insert"}, at : 1..(n + 1)] \cup
        [kind : {"delete", "edit"}, at : 1..n]

\* What a batch can do to a text of n lines: a change, or none.
BatchChangesTo(n) == ChangesTo(n) \cup {NoChange}

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
EditorLines == [ids |-> ids, ghosts |-> ghosts]

\* The last queued batch's fork has its own copy of the file's ids.
LastTracks == (queue # <<>>) /\ queue[Len(queue)].hasOwnIds

\* Where the next batch's rehearsal starts: the last queued batch's fork, if
\* it has its own copy of the file's ids, else the editor.
Origin == IF LastTracks THEN queue[Len(queue)] ELSE EditorLines

\* The turn the next batch is rehearsed in: the scene the last queued batch
\* leaves, or the editor's (`rehearse`, from `from.scene`).
RehearsalTurn == IF queue = <<>> THEN turn ELSE queue[Len(queue)].turn

\* The batch an interrupt left playing leaves the queue, which is then empty
\* (ReportedWhilePlaying): an interrupt already reported is over
\* (`staleReported`, in the player's loop).
EndStale ==
    IF staleReported
    THEN /\ stale' = FALSE
         /\ staleReported' = FALSE
    ELSE UNCHANGED <<stale, staleReported>>

\* The oldest batch played on the editor's lines: a line it inserts is the line
\* the fork made. Apply takes the ghost argument only for an insert, so 0
\* stands in for any other change.
PlayedGhosts ==
    LET batch == Head(queue)
    IN  Apply(ghosts, batch.change,
              IF Inserts(batch.change) THEN batch.ghosts[batch.change.at]
              ELSE 0)

\* A queued batch edits the file, so `read` shows the text the queue leaves
\* (`planned`).
Planned == \E k \in 1..Len(queue) : queue[k].change # NoChange

\* The lines of s as the agent is shown them, by number.
Shown(s) ==
    [n \in 1..Len(s.ids) |-> [id |-> s.ids[n], ghost |-> s.ghosts[n]]]

\* The rehearsal knows number n (`knows`): the id the agent was shown at it is
\* the id there where the rehearsal starts.
CanAccept(n) ==
    /\ n <= Len(Origin.ids)
    /\ shownLines[n].id = Origin.ids[n]

\* Queued batch k after a change o by others, which it follows
\* (`followChange`): with ShareIds, its fork drops its copy of the file's ids,
\* to read the editor's; else the fork moves its own copy, or the editor's,
\* through the change, with a fresh id of its own for an inserted line.
Followed(k, o) ==
    IF ShareIds
    THEN [queue[k] EXCEPT !.hasOwnIds = FALSE]
    ELSE LET from == IF queue[k].hasOwnIds THEN queue[k] ELSE EditorLines
         IN  [queue[k] EXCEPT !.hasOwnIds = TRUE,
                              !.ids = Apply(from.ids, o, nextId + 2 + k),
                              !.ghosts = Apply(from.ghosts, o, nextId)]

\* What an interrupt leaves of the queue: nothing, or the oldest batch, if it
\* was already playing; `interrupt` discards only the batches still queued, and
\* the playing one may go on to complete (#151).
QueuesAfterInterrupt ==
    IF queue = <<>> THEN {<<>>} ELSE {<<>>, <<Head(queue)>>}

--------------------------------------------------------------------------------

Init ==
    /\ ghosts = FirstGhosts
    /\ ids = FirstIds
    /\ queue = <<>>
    /\ shownLines = <<>>
    /\ wrongLine = FALSE
    /\ otherChanges = 0
    /\ programmerEdits = 0
    /\ turn \in Turns
    /\ batches = 0
    /\ nextId = Len(FirstGhosts) + 1
    /\ justRead = FALSE
    /\ stale = FALSE
    /\ staleReported = FALSE

\* `read`: the text as the queued batches leave it, with the last one's ids
\* (`saw` with its `after.lines`), if they edit the file and no interrupt is
\* unreported (`planned`); else the editor's, with its ids.
Read ==
    /\ shownLines' =
           Shown(IF Planned /\ ~stale THEN queue[Len(queue)] ELSE EditorLines)
    /\ justRead' = TRUE
    /\ UNCHANGED <<ghosts, ids, queue, wrongLine, otherChanges, programmerEdits,
                   turn, batches, nextId, stale, staleReported>>

\* `step`: the rehearsal forks where the queue leaves off, and plays the batch,
\* with change o, in memory. A line the batch inserts gets a fresh id in the
\* fork, and is the line the real play will make. While `stale`, the batch is
\* discarded, unrehearsed, so nothing is queued. Rehearsed in the
\* programmer's turn, an edit fails (`not_your_turn`), so is not queued.
Submit(o) ==
    /\ ~stale
    /\ (RehearsalTurn = "programmer") => (o = NoChange)
    /\ queue' =
           Append(queue,
                  [change |-> o,
                   hasOwnIds |-> (o # NoChange) \/ LastTracks,
                   ids |-> Apply(Origin.ids, o, nextId),
                   ghosts |-> Apply(Origin.ghosts, o, nextId + 1),
                   turn |-> RehearsalTurn])
    /\ batches' = batches + 1
    /\ nextId' = nextId + 2
    /\ justRead' = FALSE
    /\ UNCHANGED <<ghosts, ids, shownLines, wrongLine, otherChanges,
                   programmerEdits, turn, stale, staleReported>>

\* The oldest batch plays its change on the editor, which tracks it (`apply`):
\* a fresh id for an inserted line. Then `adopt` takes its fork's ids, if the
\* fork has a copy of them and the text reads as it did in the fork. (A text is
\* modeled by its lines, so "reads as in the fork" is "the same lines".) A
\* change to a line that isn't there is FailPlay's.
Play ==
    LET batch == Head(queue)
        adopted == batch.hasOwnIds /\ (~AdoptChecksText
                                       \/ (PlayedGhosts = batch.ghosts))
    IN  /\ queue # <<>>
        /\ batch.change \in BatchChangesTo(Len(ghosts))
        /\ ghosts' = PlayedGhosts
        /\ ids' = IF adopted THEN batch.ids ELSE Apply(ids, batch.change,
                                                       nextId)
        /\ queue' = Tail(queue)
        /\ nextId' = nextId + 1
        /\ justRead' = FALSE
        /\ EndStale
        /\ UNCHANGED <<shownLines, wrongLine, otherChanges, programmerEdits,
                       turn, batches>>

\* The oldest batch ends without completing: interrupted, discarded, or
\* failed, for any reason, with its change made (`made`) or not; a change to a
\* line that isn't there is never made. Nothing is adopted: the editor tracks
\* a change made, with a fresh id for an inserted line. A batch that does not
\* complete interrupts the queue behind it.
FailPlay(made) ==
    /\ queue # <<>>
    /\ made => (Head(queue).change \in BatchChangesTo(Len(ghosts)))
    /\ ghosts' = IF made THEN PlayedGhosts ELSE ghosts
    /\ ids' = IF made THEN Apply(ids, Head(queue).change, nextId) ELSE ids
    /\ queue' = <<>>
    /\ nextId' = nextId + 1
    /\ justRead' = FALSE
    /\ stale' = TRUE
    /\ staleReported' = FALSE
    /\ UNCHANGED <<shownLines, wrongLine, otherChanges, programmerEdits, turn,
                   batches>>

\* Someone else makes change o to the file. If a queued batch edits it, the
\* queue is interrupted (`interrupt`): the batches still queued are discarded,
\* and the one playing, if any, plays on (#151). Otherwise each queued
\* rehearsal follows it (`followChange`).
EditAsOther(o) ==
    /\ ghosts' = Apply(ghosts, o, nextId)
    /\ ids' = Apply(ids, o, nextId + 1)
    /\ IF Planned /\ OtherInterrupts
       THEN /\ queue' \in QueuesAfterInterrupt
            /\ stale' = TRUE
            /\ staleReported' = FALSE
       ELSE /\ queue' =
                   IF Planned THEN queue
                   ELSE [k \in 1..Len(queue) |-> Followed(k, o)]
            /\ UNCHANGED <<stale, staleReported>>
    /\ otherChanges' = otherChanges + 1
    /\ nextId' = nextId + 3 + Len(queue)
    /\ justRead' = FALSE
    /\ UNCHANGED <<shownLines, wrongLine, programmerEdits, turn, batches>>

\* The programmer makes change o (`userEdit`). In the agent's turn it
\* interrupts the queue, whatever file the queued batches edit; in the
\* programmer's turn it leaves the queue alone. The queued rehearsals never
\* follow it.
EditAsProgrammer(o) ==
    /\ ghosts' = Apply(ghosts, o, nextId)
    /\ ids' = Apply(ids, o, nextId + 1)
    /\ IF turn = "agent"
       THEN /\ queue' \in QueuesAfterInterrupt
            /\ stale' = TRUE
            /\ staleReported' = FALSE
       ELSE UNCHANGED <<queue, stale, staleReported>>
    /\ programmerEdits' = programmerEdits + 1
    /\ nextId' = nextId + 2
    /\ justRead' = FALSE
    /\ UNCHANGED <<shownLines, wrongLine, otherChanges, turn, batches>>

\* The programmer takes the turn, or hands it back (`takeTurn`, `handBack`):
\* the queue is interrupted.
ChangeTurn ==
    /\ turn' = IF turn = "agent" THEN "programmer" ELSE "agent"
    /\ queue' \in QueuesAfterInterrupt
    /\ stale' = TRUE
    /\ staleReported' = FALSE
    /\ justRead' = FALSE
    /\ UNCHANGED <<ghosts, ids, shownLines, wrongLine, otherChanges,
                   programmerEdits, batches, nextId>>

\* The rehearsal of the agent's next batch checks number n it gives (`knows`,
\* in `unseen`), and accepts it. The real play doesn't check again. While
\* `stale`, no batch is rehearsed, so nothing is accepted.
Accept(n) ==
    /\ ~stale
    /\ CanAccept(n)
    /\ wrongLine' = (wrongLine \/ (shownLines[n].ghost # Origin.ghosts[n]))
    /\ UNCHANGED
           <<ghosts, ids, queue, shownLines, otherChanges, programmerEdits,
             turn, batches, nextId, justRead, stale, staleReported>>

\* A report tells the agent about the interrupt (`snapshot`): a step's, once
\* ready() lets it go or its timer fires; a rejected step's (`rejectBatch`,
\* `rejectUnanchored`); or the agent's, back after a disconnect
\* (`resumeSession`), which also forgets the lines it was shown (`seen`).
\* With ReportWaitsForQueue, `stale` clears only with the queue empty; with a
\* batch still playing, the interrupt counts as reported until it ends.
Report ==
    /\ stale
    /\ IF queue = <<>> \/ ~ReportWaitsForQueue
       THEN /\ stale' = FALSE
            /\ staleReported' = FALSE
       ELSE /\ staleReported' = TRUE
            /\ UNCHANGED stale
    /\ shownLines' \in {shownLines, <<>>}
    /\ UNCHANGED <<ghosts, ids, queue, wrongLine, otherChanges,
                   programmerEdits, turn, batches, nextId, justRead>>

Next ==
    \/ Read
    \/ \E o \in BatchChangesTo(Len(Origin.ghosts)) : Submit(o)
    \/ Play
    \/ \E made \in BOOLEAN : FailPlay(made)
    \/ \E o \in ChangesTo(Len(ghosts)) : EditAsOther(o)
    \/ \E o \in ChangesTo(Len(ghosts)) : EditAsProgrammer(o)
    \/ ChangeTurn
    \/ \E n \in DOMAIN shownLines : Accept(n)
    \/ Report

Spec == Init /\ [][Next]_vars

--------------------------------------------------------------------------------

\* A number is accepted only for the line the agent was shown at it.
AcceptedOnlyForThatLine == ~wrongLine

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
ReadIsStart == (justRead
                /\ ~stale) => (\A n \in DOMAIN shownLines : CanAccept(n))

\* An interrupt counts as reported only while the one batch it left still
\* plays: no batch is queued behind it, and once it ends, `stale` clears.
ReportedWhilePlaying == staleReported => (stale /\ Len(queue) = 1)

\* The lines, the edits, the batches, and the queue are bounded
\* only so that the model is finite (6.8). Each bound prunes exactly the
\* states a guard on the action that grows it never reached (8.6).
Constraint ==
    /\ Len(ghosts) <= MaxLines
    /\ \A k \in 1..Len(queue) : Len(queue[k].ghosts) <= MaxLines
    /\ otherChanges <= MaxOthers
    /\ programmerEdits <= MaxProgrammerEdits
    /\ batches <= MaxBatches
    /\ Len(queue) <= MaxQueued

================================================================================
