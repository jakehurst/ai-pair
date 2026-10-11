---- MODULE Anchor -------------------------------------------------------------
(******************************************************************************)
(* The agent's cursor after a discarded or interrupted batch, issue 112: the  *)
(* agent plans the next batch against where the discarded batch would have    *)
(* ended, while the cursor is where it stopped. step in                       *)
(* packages/core/src/controller.ts, with the reports snapshot builds. With    *)
(* the guard, a batch after such a report must anchor the cursor, a move,     *)
(* select or point naming its file and line, before any action at the cursor, *)
(* or it is refused.                                                          *)
(******************************************************************************)
EXTENDS Naturals

CONSTANTS
    MaxBatches,     \* how many batches the model submits
    Guard           \* TRUE: a batch after a discard report must anchor the
                    \* cursor

ASSUME AssumeMaxBatches == MaxBatches \in Nat
ASSUME AssumeGuard == Guard \in BOOLEAN

\* The places the cursor can be.
Positions == 1..3

VARIABLES
    cursor,     \* where the agent's cursor is
    belief,     \* where the agent thinks it is
    pending,    \* a report said a batch was discarded or interrupted, and no
                \* anchored batch was accepted since
    misplaced,  \* an edit played where the agent did not think the cursor was
    batches     \* batches submitted

vars == <<cursor, belief, pending, misplaced, batches>>

--------------------------------------------------------------------------------

\* The values each variable can hold.
TypeOK ==
    /\ cursor \in Positions
    /\ belief \in Positions
    /\ pending \in BOOLEAN
    /\ misplaced \in BOOLEAN
    /\ batches \in Nat

--------------------------------------------------------------------------------

Init ==
    /\ cursor = 1
    /\ belief = 1
    /\ pending = FALSE
    /\ misplaced = FALSE
    /\ batches = 0

\* A batch plays through: the cursor ends where the agent planned.
Complete ==
    /\ \E c \in Positions :
           /\ cursor' = c
           /\ belief' = c
    /\ batches' = batches + 1
    /\ UNCHANGED <<pending, misplaced>>

\* A batch is interrupted or discarded: the cursor stops short of the plan,
\* and the report says so.
Discard ==
    /\ \E c, b \in Positions :
           /\ c # b
           /\ cursor' = c
           /\ belief' = b
    /\ pending' = TRUE
    /\ batches' = batches + 1
    /\ UNCHANGED misplaced

\* A batch whose first action at the cursor names its file and line: the
\* cursor goes there, the belief with it.
SubmitAnchored ==
    /\ \E c \in Positions :
           /\ cursor' = c
           /\ belief' = c
    /\ pending' = FALSE
    /\ batches' = batches + 1
    /\ UNCHANGED misplaced

\* A batch that types at the cursor, trusting the plan: refused while the
\* guard holds a pending report.
SubmitUnanchored ==
    /\ ~(Guard /\ pending)
    /\ misplaced' = (misplaced \/ (cursor # belief))
    /\ batches' = batches + 1
    /\ UNCHANGED <<cursor, belief, pending>>

Next ==
    \/ Complete
    \/ Discard
    \/ SubmitAnchored
    \/ SubmitUnanchored

Spec == Init /\ [][Next]_vars

--------------------------------------------------------------------------------

\* No edit plays where the agent did not think the cursor was.
NoMisplacedEdit == ~misplaced

\* Something must happen: with no discard pending, an unanchored batch is
\* accepted. A guard that refused every batch would fail it.
AcceptsUnanchored == ~pending => ENABLED SubmitUnanchored

\* Batches run out only so that the model is finite (6.8).
Constraint == batches <= MaxBatches

================================================================================
