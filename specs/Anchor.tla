---- MODULE Anchor -------------------------------------------------------------
(******************************************************************************)
(* The agent's cursor after a batch that was not completed (interrupted,      *)
(* discarded, or failed), issue 112: the agent plans the next batch against   *)
(* where that batch would have ended, while the cursor is where it stopped.   *)
(* step in packages/core/src/controller.ts, with the reports snapshot builds. *)
(* With the guard, a batch after such a report must anchor the cursor, a move *)
(* or select naming its file and line, before any action at the cursor, or it *)
(* is refused.                                                                *)
(******************************************************************************)
EXTENDS Naturals

CONSTANTS
    MaxBatches,     \* how many batches the model submits, and restores
    Guard,          \* TRUE: a batch after a discard report must anchor the
                    \* cursor
    DropsHeld       \* TRUE: the refusal's report overwrites a rejection
                    \* `restore` held, the code before #193

ASSUME AssumeMaxBatches == MaxBatches \in Nat
ASSUME AssumeGuard == Guard \in BOOLEAN
ASSUME AssumeDropsHeld == DropsHeld \in BOOLEAN

\* The places the cursor can be.
Positions == 1..3

VARIABLES
    place,      \* where the agent's cursor is
    belief,     \* where the agent thinks it is
    mustAnchor, \* a report said a batch was not completed, and no anchored
                \* batch was accepted since
    wrongPlace, \* an edit played where the agent did not think the cursor was
    heldCount,  \* how many rejections `restore` holds for the next
                \* reports (#67)
    rejectionLost,       \* a held rejection reached no report
    batches     \* batches submitted, and reports restored

vars == <<place, belief, mustAnchor, wrongPlace, heldCount, rejectionLost,
          batches>>

--------------------------------------------------------------------------------

\* The values each variable can hold.
TypeOK ==
    /\ place \in Positions
    /\ belief \in Positions
    /\ mustAnchor \in BOOLEAN
    /\ wrongPlace \in BOOLEAN
    /\ heldCount \in Nat
    /\ rejectionLost \in BOOLEAN
    /\ batches \in Nat

--------------------------------------------------------------------------------

Init ==
    /\ place = 1
    /\ belief = 1
    /\ mustAnchor = FALSE
    /\ wrongPlace = FALSE
    /\ heldCount = 0
    /\ rejectionLost = FALSE
    /\ batches = 0

\* A batch plays through: the cursor ends where the agent planned.
Complete ==
    /\ \E c \in Positions :
           /\ place' = c
           /\ belief' = c
    /\ batches' = batches + 1
    /\ UNCHANGED <<mustAnchor, wrongPlace, heldCount, rejectionLost>>

\* A batch is not completed (interrupted, discarded, or failed): the cursor
\* stops short of the plan, and the report says so.
StopShort ==
    /\ \E c, b \in Positions :
           /\ c # b
           /\ place' = c
           /\ belief' = b
    /\ mustAnchor' = TRUE
    /\ batches' = batches + 1
    /\ UNCHANGED <<wrongPlace, heldCount, rejectionLost>>

\* A batch whose first action at the cursor names its file and line: the
\* cursor goes there, the belief with it.
SubmitAnchored ==
    /\ \E c \in Positions :
           /\ place' = c
           /\ belief' = c
    /\ mustAnchor' = FALSE
    /\ batches' = batches + 1
    /\ UNCHANGED <<wrongPlace, heldCount, rejectionLost>>

\* A batch that types at the cursor, trusting the plan: accepted while the
\* guard holds no pending report.
SubmitUnanchored ==
    /\ ~(Guard /\ mustAnchor)
    /\ wrongPlace' = (wrongPlace \/ (place # belief))
    /\ batches' = batches + 1
    /\ UNCHANGED <<place, belief, mustAnchor, heldCount, rejectionLost>>

\* Such a batch while the guard holds a pending report. With nothing held, it
\* is refused with the `unanchored` rejection, in a report of its own
\* (rejectUnanchored). With a held rejection, the report takes it: under
\* DropsHeld the refusal's snapshot overwrites it; else the step is discarded
\* as stale and its report delivers it (#193).
RefuseUnanchored ==
    /\ Guard /\ mustAnchor
    /\ heldCount' = IF heldCount > 0 THEN heldCount - 1 ELSE heldCount
    /\ rejectionLost' = (rejectionLost \/ (DropsHeld /\ heldCount > 0))
    /\ batches' = batches + 1
    /\ UNCHANGED <<place, belief, mustAnchor, wrongPlace>>

\* `restore` of a report with a rejection: held for the next report (#67).
Restore ==
    /\ heldCount' = heldCount + 1
    /\ batches' = batches + 1
    /\ UNCHANGED <<place, belief, mustAnchor, wrongPlace, rejectionLost>>

\* A report of any other call takes one held rejection (snapshot).
TakeHeld ==
    /\ heldCount > 0
    /\ heldCount' = heldCount - 1
    /\ UNCHANGED <<place, belief, mustAnchor, wrongPlace, rejectionLost,
                   batches>>

Next ==
    \/ Complete
    \/ StopShort
    \/ SubmitAnchored
    \/ SubmitUnanchored
    \/ RefuseUnanchored
    \/ Restore
    \/ TakeHeld

Spec == Init /\ [][Next]_vars

--------------------------------------------------------------------------------

\* No edit plays where the agent did not think the cursor was.
NoMisplacedEdit == ~wrongPlace

\* Something must happen: with no discard pending, an unanchored batch is
\* accepted. A guard that refused every batch would fail it.
AcceptsUnanchored == ~mustAnchor => ENABLED SubmitUnanchored

\* Every rejection `restore` held reaches a report (#193).
NoRejectionLost == ~rejectionLost

\* Batches run out only so that the model is finite (6.8).
Constraint == batches <= MaxBatches

================================================================================
