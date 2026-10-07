-------------------------------- MODULE Turns --------------------------------
\* Turns in packages/core/src/player.ts and controller.ts: S6 in #19, during the programmer's
\* turn only `say` and `point` take effect. `perform` checks the turn as each action starts;
\* taking or handing back the turn interrupts (`takeTurn`, `handBack`), and an action that edits
\* checks for an interrupt after its awaits, before its effect: `type` in its delay before each
\* chunk, `delete` after `show` and `getText` (#49), and `run` in the terminal after
\* `shellIntegration` (`notStarted`). A batch starts at any time, from any turn: the controller
\* discards batches planned before a turn change, so this is more than the code allows.
EXTENDS Naturals, Sequences

CONSTANTS
    Kinds,         \* the actions a batch may have
    MaxLen,        \* how many actions a batch has, at most
    Changes,       \* how many times the turn changes, at most
    DeleteChecks   \* TRUE: `delete` stops after its awaits if interrupted (fix for #49)

Edits == {"type", "delete", "run"}

VARIABLES
    turn,        \* "agent" or "user"
    batch,       \* the playing batch's actions left, or <<>>
    phase,       \* the action at the head: "start", "awaiting"
    interrupted, \* the timeline was interrupted since the batch started
    changes,     \* turn changes so far
    bad          \* an edit took effect during the programmer's turn

vars == <<turn, batch, phase, interrupted, changes, bad>>

Batches == UNION {[1..n -> Kinds] : n \in 1..MaxLen}

Init ==
    /\ turn \in {"agent", "user"} /\ batch = <<>> /\ phase = "start"
    /\ interrupted = FALSE /\ changes = 0 /\ bad = FALSE

\* startHead: the next batch, with the timeline reset.
Begin ==
    /\ batch = <<>> /\ \E b \in Batches : batch' = b
    /\ phase' = "start" /\ interrupted' = FALSE
    /\ UNCHANGED <<turn, changes, bad>>

Stop == batch' = <<>> /\ phase' = "start" /\ UNCHANGED <<turn, interrupted, changes, bad>>

\* The loop in `actions` checks for an interrupt between actions; `perform` checks the turn.
Start ==
    /\ batch # <<>> /\ phase = "start"
    /\ IF interrupted THEN Stop
       ELSE IF turn = "user" /\ Head(batch) \notin {"say", "point"} THEN Stop  \* not_your_turn
       ELSE phase' = "awaiting" /\ UNCHANGED <<turn, batch, interrupted, changes, bad>>

\* The action's awaits return; it takes effect, or stops if it checks and was interrupted.
Effect ==
    /\ batch # <<>> /\ phase = "awaiting"
    /\ LET k == Head(batch)
           checks == k = "type" \/ k = "run" \/ (k = "delete" /\ DeleteChecks)
       IN IF interrupted /\ checks THEN Stop
          ELSE /\ bad' = (bad \/ (k \in Edits /\ turn = "user"))
               /\ batch' = Tail(batch) /\ phase' = "start"
               /\ UNCHANGED <<turn, interrupted, changes>>

\* takeTurn or handBack: the turn changes, and playback is interrupted.
Change ==
    /\ changes < Changes /\ changes' = changes + 1
    /\ turn' = IF turn = "agent" THEN "user" ELSE "agent"
    /\ interrupted' = TRUE
    /\ UNCHANGED <<batch, phase, bad>>

Next == Begin \/ Start \/ Effect \/ Change

Spec == Init /\ [][Next]_vars

\* S6.
OnlyTalkInTheirTurn == ~bad

=============================================================================
