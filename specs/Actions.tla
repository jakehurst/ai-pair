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
EXTENDS Naturals, Sequences, PairDefs

CONSTANTS
    MaxActions, \* how many actions a batch has, at most
    RestOnly,   \* TRUE: a `type` cut after a chunk returns only what's left of
                \* it
    ConsumeRun  \* TRUE: a `run` interrupted while its command runs counts as
                \* played

ASSUME AssumeMaxActions == MaxActions \in Nat \ {0}
ASSUME AssumeRestOnly == RestOnly \in BOOLEAN
ASSUME AssumeConsumeRun == ConsumeRun \in BOOLEAN

\* The kinds of action the step table tells apart: `type_fast` steps as `type`
\* does, and `type0` is a `type` with nothing to type.
ActionShapes == (ActionKinds \ {"type_fast"}) \cup {"type0"}

\* The steps of each kind of action, in order, read from the code. `type` has
\* two chunks: `show`, `getText`, `eol`, then a delay before each chunk.
\* `type0` has only the cursor marker and no selection: `show`, `getText`,
\* `eol`, and no chunks. `run`: `save`, `confirm`, `shellIntegration`
\* (`notStarted`), the command, then still running. The arms cover Shapes, so
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
FullEffects(k) == Len(SelectSeq(Steps(k), LAMBDA s : s = "effect"))

\* How many steps the longest action has; the maximum is unique.
MostSteps ==
    CHOOSE n \in {Len(Steps(k)) : k \in ActionShapes} :
        \A k \in ActionShapes : Len(Steps(k)) <= n

\* Every batch: one to MaxActions actions.
Batches == Seqs(ActionShapes, MaxActions) \ {<<>>}

\* No first unplayed action, while the batch plays. Any value that is not an
\* action's index will do, so the config makes it a model value (6.20).
NoAction == CHOOSE v : v \notin Nat

VARIABLES
    batch,         \* the batch's actions
    action,        \* the index of the action playing
    pc,            \* its step next
    effectsPlayed, \* each action: how many of its effects took place
    interrupted,   \* the timeline was interrupted
    result         \* the outcome: status ("playing" until done), from (the
                   \* first unplayed action), and rest (a cut type's chunks
                   \* left)

vars == <<batch, action, pc, effectsPlayed, interrupted, result>>

--------------------------------------------------------------------------------

\* The values each variable can hold.
TypeOK ==
    /\ batch \in Batches
    /\ action \in 1..(Len(batch) + 1)
    /\ pc \in 1..(MostSteps + 1)
    /\ effectsPlayed \in [1..Len(batch) -> Nat]
    /\ \A j \in 1..Len(batch) : effectsPlayed[j] <= FullEffects(batch[j])
    /\ interrupted \in BOOLEAN
    /\ result \in
           [status : {"playing", "completed", "interrupted", "discarded"},
            firstUnplayed : 1..(Len(batch) + 1) \cup {NoAction},
            chunksLeft : Nat]

\* The result while the batch plays.
Playing == [status |-> "playing", firstUnplayed |-> NoAction, chunksLeft |-> 0]

\* The batch has its result.
Done == result # Playing

\* One of the first n actions changed something the programmer sees.
AnyEffect(n) == \E j \in 1..n : effectsPlayed[j] > 0

\* Stop(from, rest, effect): the batch stops, its first unplayed action
\* being `firstUnplayed` and a cut type's chunks left `chunksLeft`. `effect`: an
\* earlier
\* action changed something on screen, or this one typed some of its text, or
\* left its command running; without it, the batch is discarded.
Stop(firstUnplayed, chunksLeft, effect) ==
    LET status == IF effect THEN "interrupted" ELSE "discarded"
    IN  result' = [status |-> status, firstUnplayed |-> firstUnplayed,
                   chunksLeft |-> chunksLeft]

\* The playing action has a step left, and the loop's check before the action
\* has passed.
CanStep ==
    /\ result = Playing
    /\ action <= Len(batch)
    /\ pc <= Len(Steps(batch[action]))
    /\ ~(pc = 1 /\ interrupted)

\* The step the playing action takes next.
CurrentStep == Steps(batch[action])[pc]

--------------------------------------------------------------------------------

Init ==
    /\ batch \in Batches
    /\ action = 1
    /\ pc = 1
    /\ effectsPlayed = [j \in 1..Len(batch) |-> 0]
    /\ interrupted = FALSE
    /\ result = Playing

\* The loop in `actions` finds no action left: the batch completed.
Complete ==
    /\ result = Playing
    /\ action > Len(batch)
    /\ result' = [status |-> "completed", firstUnplayed |-> Len(batch) + 1,
                  chunksLeft |-> 0]
    /\ UNCHANGED <<batch, action, pc, effectsPlayed, interrupted>>

\* The loop in `actions` checks for an interrupt before each action, and
\* stops the batch there.
StopBeforeAction ==
    /\ result = Playing
    /\ action <= Len(batch)
    /\ pc = 1
    /\ interrupted
    /\ Stop(action, 0, AnyEffect(action - 1))
    /\ UNCHANGED <<batch, action, pc, effectsPlayed, interrupted>>

\* An effect takes place, interrupted or not: a keystroke, a delete, a
\* command, a move.
TakeEffect ==
    /\ CanStep
    /\ CurrentStep = "effect"
    /\ pc' = pc + 1
    /\ effectsPlayed' = [effectsPlayed EXCEPT ![action] = @ + 1]
    /\ UNCHANGED <<batch, action, interrupted, result>>

\* A check finds the timeline interrupted: a sleep's result, `confirm`, or
\* `notStarted`. A `type` that typed some of its text returns only what's
\* left of it, with RestOnly; otherwise the batch stops at this action.
StopAtCheck ==
    /\ CanStep
    /\ CurrentStep = "check"
    /\ interrupted
    /\ IF effectsPlayed[action] > 0 /\ RestOnly
       THEN Stop(action, FullEffects(batch[action]) - effectsPlayed[action],
                 TRUE)
       ELSE Stop(action, 0, AnyEffect(action - 1))
    /\ UNCHANGED <<batch, action, pc, effectsPlayed, interrupted>>

\* A `run` is interrupted while its command runs on. With ConsumeRun the
\* command counts as played, so the first unplayed action is the next one.
StopWhileRunning ==
    /\ CanStep
    /\ CurrentStep = "consumed"
    /\ interrupted
    /\ IF ConsumeRun
       THEN Stop(action + 1, 0, TRUE)
       ELSE Stop(action, 0, AnyEffect(action - 1))
    /\ UNCHANGED <<batch, action, pc, effectsPlayed, interrupted>>

\* An await returns, or a check or a running command finds no interrupt: the
\* action goes on to its next step.
Proceed ==
    /\ CanStep
    /\ \/ CurrentStep = "await"
       \/ /\ CurrentStep \in {"check", "consumed"}
          /\ ~interrupted
    /\ pc' = pc + 1
    /\ UNCHANGED <<batch, action, effectsPlayed, interrupted, result>>

\* The action has taken all its steps: the loop goes on to the next.
FinishAction ==
    /\ result = Playing
    /\ action <= Len(batch)
    /\ pc > Len(Steps(batch[action]))
    /\ action' = action + 1
    /\ pc' = 1
    /\ UNCHANGED <<batch, effectsPlayed, interrupted, result>>

\* The programmer interrupts, by an edit, a message, or a turn change, at any
\* await: between steps.
Interrupt ==
    /\ result = Playing
    /\ ~interrupted
    /\ interrupted' = TRUE
    /\ UNCHANGED <<batch, action, pc, effectsPlayed, result>>

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
        /\ \A j \in 1..(result.firstUnplayed - 1)
           : effectsPlayed[j] = FullEffects(batch[j])
        /\ \A j \in result.firstUnplayed..Len(batch) :
               IF j = result.firstUnplayed /\ result.chunksLeft > 0
               THEN effectsPlayed[j] + result.chunksLeft = FullEffects(batch[j])
               ELSE effectsPlayed[j] = 0

\* A stopped batch is discarded exactly when nothing the programmer could see
\* took place.
DiscardedMeansNothing ==
    LET stopped == Done /\ result.status # "completed"
        unseen == \A j \in 1..Len(batch) : effectsPlayed[j] = 0
    IN  stopped => ((result.status = "discarded") <=> unseen)

\* Every batch ends with its result: completed, interrupted, or discarded. A
\* player that never played would fail it, so it says something must happen.
EventuallyReported == <>Done

================================================================================
