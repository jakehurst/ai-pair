---- MODULE Turns --------------------------------------------------------------
(******************************************************************************)
(* Turns in packages/core/src/player.ts and controller.ts: S6 in #19, during  *)
(* the programmer's turn only `say` and `point` take effect. `perform` checks *)
(* the turn as each action starts; taking or handing back the turn interrupts *)
(* (`takeTurn`, `handBack`), and an action that edits checks for an interrupt *)
(* after its awaits, before its effect: `type` in its delay before each       *)
(* chunk, `delete` after `show` and `getText` (#49), and `run` in the         *)
(* terminal after `shellIntegration` (`notStarted`). A batch starts at any    *)
(* time, from any turn: the controller discards batches planned before a turn *)
(* change, so this is more than the code allows.                              *)
(******************************************************************************)
EXTENDS Naturals, Sequences

CONSTANTS
    Kinds,          \* the actions a batch may have
    MaxLen,         \* how many actions a batch has, at most
    MaxChanges,     \* how many times the model changes the turn
    DeleteChecks    \* TRUE: `delete` stops after its awaits if interrupted
                    \* (the fix for #49)

ASSUME AssumeMaxLen == MaxLen \in Nat \ {0}
ASSUME AssumeMaxChanges == MaxChanges \in Nat
ASSUME AssumeDeleteChecks == DeleteChecks \in BOOLEAN

\* The actions that edit.
Edits == {"type", "delete", "run"}

\* Every batch: one to MaxLen actions.
Batches == UNION {[1..n -> Kinds] : n \in 1..MaxLen}

VARIABLES
    turn,        \* "agent" or "user"
    batch,       \* the playing batch's actions left, or <<>>
    phase,       \* the action at the head: "start", "awaiting"
    interrupted, \* the timeline was interrupted since the batch started
    changes,     \* turn changes so far
    bad          \* an edit took effect during the programmer's turn

vars == <<turn, batch, phase, interrupted, changes, bad>>

--------------------------------------------------------------------------------

\* The values each variable can hold.
TypeOK ==
    /\ turn \in {"agent", "user"}
    /\ batch \in Batches \cup {<<>>}
    /\ phase \in {"start", "awaiting"}
    /\ interrupted \in BOOLEAN
    /\ changes \in Nat
    /\ bad \in BOOLEAN

\* The batch stops: what is left of it is dropped.
Stop ==
    /\ batch' = <<>>
    /\ phase' = "start"
    /\ UNCHANGED <<turn, interrupted, changes, bad>>

--------------------------------------------------------------------------------

Init ==
    /\ turn \in {"agent", "user"}
    /\ batch = <<>>
    /\ phase = "start"
    /\ interrupted = FALSE
    /\ changes = 0
    /\ bad = FALSE

\* startHead: the next batch, with the timeline reset.
Begin ==
    /\ batch = <<>>
    /\ batch' \in Batches
    /\ phase' = "start"
    /\ interrupted' = FALSE
    /\ UNCHANGED <<turn, changes, bad>>

\* The loop in `actions` checks for an interrupt between actions; `perform`
\* checks the turn, and stops an edit in the programmer's turn with
\* not_your_turn.
Start ==
    /\ batch # <<>>
    /\ phase = "start"
    /\ IF interrupted
       THEN Stop
       ELSE IF turn = "user" /\ Head(batch) \notin {"say", "point"}
            THEN Stop
            ELSE /\ phase' = "awaiting"
                 /\ UNCHANGED <<turn, batch, interrupted, changes, bad>>

\* The action's awaits return; it takes effect, or stops if it checks and was
\* interrupted.
TakeEffect ==
    /\ batch # <<>>
    /\ phase = "awaiting"
    /\ LET k == Head(batch)
           checks == k = "type" \/ k = "run" \/ (k = "delete" /\ DeleteChecks)
       IN  IF interrupted /\ checks
           THEN Stop
           ELSE /\ batch' = Tail(batch)
                /\ phase' = "start"
                /\ bad' = (bad \/ (k \in Edits /\ turn = "user"))
                /\ UNCHANGED <<turn, interrupted, changes>>

\* takeTurn or handBack: the turn changes, and playback is interrupted.
ChangeTurn ==
    /\ turn' = IF turn = "agent" THEN "user" ELSE "agent"
    /\ interrupted' = TRUE
    /\ changes' = changes + 1
    /\ UNCHANGED <<batch, phase, bad>>

Next ==
    \/ Begin
    \/ Start
    \/ TakeEffect
    \/ ChangeTurn

\* The player goes on through a batch; batches and turn changes come when they
\* do.
Fairness ==
    /\ WF_vars(Start)
    /\ WF_vars(TakeEffect)

Spec == Init /\ [][Next]_vars /\ Fairness

--------------------------------------------------------------------------------

\* S6: during the programmer's turn, no edit takes effect.
OnlyTalkInTheirTurn == ~bad

\* A batch begun ends: each action takes effect or the batch stops. A player
\* that never played would fail it, so it says something must happen.
BatchEnds == (batch # <<>>) ~> (batch = <<>>)

\* Turn changes run out only so that the model is finite (6.8). It prunes
\* exactly the states a guard `changes < MaxChanges` on ChangeTurn never
\* reached, so the behaviors, and BatchEnds' result, are the guard's (8.6).
Constraint == changes <= MaxChanges

================================================================================
