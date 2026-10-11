---- MODULE Actions ------------------------------------------------------------
(******************************************************************************)
(* What an interrupted batch reports as unplayed, in `actions` and `perform`  *)
(* in packages/core/src/player.ts: the unplayed actions come back             *)
(* in order, and resubmitting them plays nothing twice. Each action is the    *)
(* steps between its awaits, from the code; an interrupt can come at any      *)
(* await. The timeline stays interrupted until the next batch. The steps:     *)
(*   "await"     an await: `show`, `getText`, `eol`, `save`, a sleep whose    *)
(*               result is ignored                                            *)
(*   "check"     the result of a sleep, `confirm`, or `notStarted`: stop      *)
(*               here if interrupted                                          *)
(*   "effect"    something the programmer sees: a keystroke, a delete, a      *)
(*               command, a move                                              *)
(*   "consumed"  `run`: interrupted while its command runs on, the command    *)
(*               counts as played                                             *)
(******************************************************************************)
EXTENDS Naturals, Sequences

CONSTANTS
    MaxLen,     \* how many actions a batch has, at most
    RestOnly,   \* TRUE: a `type` cut after a chunk returns only what's left
                \* of it
    ConsumeRun  \* TRUE: a `run` interrupted while its command runs counts as
                \* played

ASSUME AssumeMaxLen == MaxLen \in Nat \ {0}
ASSUME AssumeRestOnly == RestOnly \in BOOLEAN
ASSUME AssumeConsumeRun == ConsumeRun \in BOOLEAN

\* The kinds of action. `type0` is a `type` with nothing to type.
Kinds == {"say", "move", "select", "point", "type", "type0", "delete", "run"}

\* The steps of each kind of action, in order, read from the code. `type` has
\* two chunks: `show`, `getText`, `eol`, then a delay before each chunk.
\* `type0` has only the cursor marker and no selection: `show`, `getText`,
\* `eol`, and no chunks. `run`: `save`, `confirm`, `shellIntegration`
\* (`notStarted`), the command, then still running. The arms cover Kinds, so
\* the CASE needs no OTHER (4.8).
Steps(k) ==
    CASE k = "say" -> <<"effect", "await">>
      [] k = "move" -> <<"await", "check", "await", "await", "effect", "await">>
      [] k = "select" ->
             <<"await", "check", "await", "await", "effect", "await">>
      [] k = "point" -> <<"await", "await", "effect", "await">>
      [] k = "type" ->
             <<"await", "await", "await", "await", "check", "effect", "await",
               "check", "effect">>
      [] k = "type0" -> <<"await", "await", "await">>
      [] k = "delete" -> <<"await", "await", "check", "effect", "await">>
      [] k = "run" ->
             <<"await", "await", "check", "await", "check", "effect", "await",
               "consumed">>

\* How many effects an action of kind k has when it plays in full.
Full(k) == Len(SelectSeq(Steps(k), LAMBDA s : s = "effect"))

\* How many steps the longest action has; the maximum is unique.
MostSteps ==
    CHOOSE n \in {Len(Steps(k)) : k \in Kinds} :
        \A k \in Kinds : Len(Steps(k)) <= n

\* Every batch: one to MaxLen actions.
Batches == UNION {[1..n -> Kinds] : n \in 1..MaxLen}

\* No first unplayed action, while the batch plays. Any value that is not an
\* action's index will do, so the config makes it a model value (6.20).
NoAction == CHOOSE v : v \notin Nat

VARIABLES
    batch,       \* the batch's actions
    current,     \* the index of the action playing
    pc,          \* its step next
    effects,     \* each action: how many of its effects took place
    interrupted, \* the timeline was interrupted
    result       \* the outcome: status ("playing" until done), from (the
                 \* first unplayed action), and rest (a cut type's chunks
                 \* left)

vars == <<batch, current, pc, effects, interrupted, result>>

--------------------------------------------------------------------------------

\* The values each variable can hold.
TypeOK ==
    /\ batch \in Batches
    /\ current \in 1..(Len(batch) + 1)
    /\ pc \in 1..(MostSteps + 1)
    /\ effects \in [1..Len(batch) -> Nat]
    /\ \A j \in 1..Len(batch) : effects[j] <= Full(batch[j])
    /\ interrupted \in BOOLEAN
    /\ result \in
           [status : {"playing", "completed", "interrupted", "discarded"},
            from : 1..(Len(batch) + 1) \cup {NoAction},
            rest : Nat]

\* The result while the batch plays.
Playing == [status |-> "playing", from |-> NoAction, rest |-> 0]

\* The batch has its result.
Done == result # Playing

\* One of the first n actions changed something the programmer sees.
AnyEffect(n) == \E j \in 1..n : effects[j] > 0

\* stopped(id, unplayed, effect): the batch stops, its first unplayed action
\* being `from` and a cut type's chunks left `rest`. `effect`: an earlier
\* action changed something on screen, or this one typed some of its text, or
\* left its command running; without it, the batch is discarded.
Stop(from, rest, effect) ==
    LET status == IF effect THEN "interrupted" ELSE "discarded"
    IN  result' = [status |-> status, from |-> from, rest |-> rest]

\* The playing action has a step left, and the loop's check before the action
\* has passed.
CanStep ==
    /\ result = Playing
    /\ current <= Len(batch)
    /\ pc <= Len(Steps(batch[current]))
    /\ ~(pc = 1 /\ interrupted)

\* The step the playing action takes next.
CurrentStep == Steps(batch[current])[pc]

--------------------------------------------------------------------------------

Init ==
    /\ batch \in Batches
    /\ current = 1
    /\ pc = 1
    /\ effects = [j \in 1..Len(batch) |-> 0]
    /\ interrupted = FALSE
    /\ result = Playing

\* The loop in `actions` finds no action left: the batch completed.
Complete ==
    /\ result = Playing
    /\ current > Len(batch)
    /\ result' = [status |-> "completed", from |-> Len(batch) + 1, rest |-> 0]
    /\ UNCHANGED <<batch, current, pc, effects, interrupted>>

\* The loop in `actions` checks for an interrupt before each action, and
\* stops the batch there.
StopBeforeAction ==
    /\ result = Playing
    /\ current <= Len(batch)
    /\ pc = 1
    /\ interrupted
    /\ Stop(current, 0, AnyEffect(current - 1))
    /\ UNCHANGED <<batch, current, pc, effects, interrupted>>

\* An effect takes place, interrupted or not: a keystroke, a delete, a
\* command, a move.
TakeEffect ==
    /\ CanStep
    /\ CurrentStep = "effect"
    /\ pc' = pc + 1
    /\ effects' = [effects EXCEPT ![current] = @ + 1]
    /\ UNCHANGED <<batch, current, interrupted, result>>

\* A check finds the timeline interrupted: a sleep's result, `confirm`, or
\* `notStarted`. A `type` that typed some of its text returns only what's
\* left of it, with RestOnly; otherwise the batch stops at this action.
StopAtCheck ==
    /\ CanStep
    /\ CurrentStep = "check"
    /\ interrupted
    /\ IF effects[current] > 0 /\ RestOnly
       THEN Stop(current, Full(batch[current]) - effects[current], TRUE)
       ELSE Stop(current, 0, AnyEffect(current - 1))
    /\ UNCHANGED <<batch, current, pc, effects, interrupted>>

\* A `run` is interrupted while its command runs on. With ConsumeRun the
\* command counts as played, so the first unplayed action is the next one.
StopWhileRunning ==
    /\ CanStep
    /\ CurrentStep = "consumed"
    /\ interrupted
    /\ IF ConsumeRun
       THEN Stop(current + 1, 0, TRUE)
       ELSE Stop(current, 0, AnyEffect(current - 1))
    /\ UNCHANGED <<batch, current, pc, effects, interrupted>>

\* An await returns, or a check or a running command finds no interrupt: the
\* action goes on to its next step.
Proceed ==
    /\ CanStep
    /\ \/ CurrentStep = "await"
       \/ /\ CurrentStep \in {"check", "consumed"}
          /\ ~interrupted
    /\ pc' = pc + 1
    /\ UNCHANGED <<batch, current, effects, interrupted, result>>

\* The action has taken all its steps: the loop goes on to the next.
FinishAction ==
    /\ result = Playing
    /\ current <= Len(batch)
    /\ pc > Len(Steps(batch[current]))
    /\ current' = current + 1
    /\ pc' = 1
    /\ UNCHANGED <<batch, effects, interrupted, result>>

\* The programmer interrupts, by an edit, a message, or a turn change, at any
\* await: between steps.
Interrupt ==
    /\ result = Playing
    /\ ~interrupted
    /\ interrupted' = TRUE
    /\ UNCHANGED <<batch, current, pc, effects, result>>

\* The run ends once the batch has its result, by design (6.13).
Finished ==
    /\ Done
    /\ UNCHANGED vars

Next ==
    \/ Complete
    \/ StopBeforeAction
    \/ TakeEffect
    \/ StopAtCheck
    \/ StopWhileRunning
    \/ Proceed
    \/ FinishAction
    \/ Interrupt
    \/ Finished

\* The player goes on through the batch; an interrupt comes when it does.
Fairness ==
    /\ WF_vars(Complete)
    /\ WF_vars(StopBeforeAction)
    /\ WF_vars(TakeEffect)
    /\ WF_vars(StopAtCheck)
    /\ WF_vars(StopWhileRunning)
    /\ WF_vars(Proceed)
    /\ WF_vars(FinishAction)

Spec == Init /\ [][Next]_vars /\ Fairness

--------------------------------------------------------------------------------

\* The actions before the unplayed ones played in full; the unplayed
\* ones never started, except a cut `type`, whose rest is exactly the chunks
\* it didn't type.
PlaysNothingTwice ==
    Done =>
        /\ \A j \in 1..(result.from - 1) : effects[j] = Full(batch[j])
        /\ \A j \in result.from..Len(batch) :
               IF j = result.from /\ result.rest > 0
               THEN effects[j] + result.rest = Full(batch[j])
               ELSE effects[j] = 0

\* A stopped batch is discarded exactly when nothing the programmer could see
\* took place.
DiscardedMeansNothing ==
    LET stopped == Done /\ result.status # "completed"
        unseen == \A j \in 1..Len(batch) : effects[j] = 0
    IN  stopped => ((result.status = "discarded") <=> unseen)

\* Every batch ends with its result: completed, interrupted, or discarded. A
\* player that never played would fail it, so it says something must happen.
EventuallyReported == <>Done

================================================================================
