---- MODULE Turns --------------------------------------------------------------
(******************************************************************************)
(* Turns in packages/core/src/player.ts and controller.ts: during the         *)
(* programmer's turn only `say` and `point` take effect. `perform` checks the *)
(* turn as each action starts; taking or handing back the turn interrupts     *)
(* (`takeTurn`, `handBack`), and an action that edits checks for an interrupt *)
(* after its awaits, before its effect: `type` in its delay before each       *)
(* chunk, `delete` after `show` and `getText` (#49), and `run` in the         *)
(* terminal after `shellIntegration` (`notStarted`). A batch starts at any    *)
(* time, from any turn: the controller discards batches planned before a turn *)
(* change, so this is more than the code allows.                              *)
(******************************************************************************)
EXTENDS Naturals, Sequences, PairDefs

CONSTANTS
    MaxActions,         \* how many actions a batch has, at most
    MaxTurns,       \* how many times the model changes the turn
    DeleteChecks    \* TRUE: `delete` stops after its awaits if interrupted
                    \* (the fix for #49)

ASSUME AssumeMaxActions == MaxActions \in Nat \ {0}
ASSUME AssumeMaxTurns == MaxTurns \in Nat
ASSUME AssumeDeleteChecks == DeleteChecks \in BOOLEAN

\* The actions that edit.
EditKinds == {"type", "type_fast", "delete", "run"}

\* Every batch: one to MaxLen actions.
Batches == Seqs(ActionKinds, MaxActions) \ {<<>>}

VARIABLES
    turn,        \* "agent" or "programmer"
    batch,       \* the playing batch's actions left, or <<>>
    phase,       \* the action at the head: "before", "awaiting"
    interrupted, \* the timeline was interrupted since the batch started
    turnChanges, \* turn changes so far
    wrongTurn    \* an edit took effect during the programmer's turn

vars == <<turn, batch, phase, interrupted, turnChanges, wrongTurn>>

--------------------------------------------------------------------------------

\* The values each variable can hold.
TypeOK ==
    /\ turn \in {"agent", "programmer"}
    /\ batch \in Batches \cup {<<>>}
    /\ phase \in {"before", "awaiting"}
    /\ interrupted \in BOOLEAN
    /\ turnChanges \in Nat
    /\ wrongTurn \in BOOLEAN

\* The batch stops: what is left of it is dropped.
Stop ==
    /\ batch' = <<>>
    /\ phase' = "before"
    /\ UNCHANGED <<turn, interrupted, turnChanges, wrongTurn>>

--------------------------------------------------------------------------------

Init ==
    /\ turn \in {"agent", "programmer"}
    /\ batch = <<>>
    /\ phase = "before"
    /\ interrupted = FALSE
    /\ turnChanges = 0
    /\ wrongTurn = FALSE

\* startHead: the next batch, with the timeline reset.
StartHead ==
    /\ batch = <<>>
    /\ batch' \in Batches
    /\ phase' = "before"
    /\ interrupted' = FALSE
    /\ UNCHANGED <<turn, turnChanges, wrongTurn>>

\* The loop in `actions` checks for an interrupt between actions; `perform`
\* checks the turn, and stops an edit in the programmer's turn with
\* not_your_turn.
Perform ==
    /\ batch # <<>>
    /\ phase = "before"
    /\ IF interrupted
       THEN Stop
       ELSE IF turn = "programmer" /\ Head(batch) \notin {"say", "point"}
            THEN Stop
            ELSE /\ phase' = "awaiting"
                 /\ UNCHANGED <<turn, batch, interrupted, turnChanges,
                                wrongTurn>>

\* The action's awaits return; it takes effect, or stops if it checks and was
\* interrupted.
TakeEffect ==
    /\ batch # <<>>
    /\ phase = "awaiting"
    /\ LET k == Head(batch)
           checks == k \in {"type", "type_fast", "run"}
                     \/ (k = "delete" /\ DeleteChecks)
       IN  IF interrupted /\ checks
           THEN Stop
           ELSE /\ batch' = Tail(batch)
                /\ phase' = "before"
                /\ wrongTurn' =
                       (wrongTurn \/ (k \in EditKinds /\ turn = "programmer"))
                /\ UNCHANGED <<turn, interrupted, turnChanges>>

\* takeTurn or handBack: the turn changes, and playback is interrupted.
ChangeTurn ==
    /\ turn' = IF turn = "agent" THEN "programmer" ELSE "agent"
    /\ interrupted' = TRUE
    /\ turnChanges' = turnChanges + 1
    /\ UNCHANGED <<batch, phase, wrongTurn>>

Next ==
    \/ StartHead
    \/ Perform
    \/ TakeEffect
    \/ ChangeTurn

\* The player goes on through a batch; batches and turn changes come when they
\* do.
Fairness ==
    /\ WF_vars(Perform)
    /\ WF_vars(TakeEffect)

Spec == Init /\ [][Next]_vars /\ Fairness

--------------------------------------------------------------------------------

\* During the programmer's turn, no edit takes effect.
OnlyTalkInTheirTurn == ~wrongTurn

\* A batch begun ends: each action takes effect or the batch stops. A player
\* that never played would fail it, so it says something must happen.
BatchEnds == (batch # <<>>) ~> (batch = <<>>)

\* Turn changes run out only so that the model is finite (6.8). It prunes
\* exactly the states a guard `turnChanges < MaxTurns` on ChangeTurn never
\* reached, so the behaviors, and BatchEnds' result, are the guard's (8.6).
Constraint == turnChanges <= MaxTurns

================================================================================
