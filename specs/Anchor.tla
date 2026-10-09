-------------------------------- MODULE Anchor --------------------------------
\* The agent's cursor after a discarded or interrupted batch, issue 112: the agent plans the next
\* batch against where the discarded batch would have ended, while the cursor is where it
\* stopped. step in packages/core/src/controller.ts, with the reports snapshot builds. With the
\* guard, a batch after such a report must anchor the cursor, a move, select or point naming its
\* file and line, before any action at the cursor, or it is refused.
EXTENDS Naturals

CONSTANTS
    N,      \* how many batches a run submits
    Guard   \* TRUE: a batch after a discard report must anchor the cursor

VARIABLES
    cursor,     \* where the agent's cursor is: 1 to 3
    belief,     \* where the agent thinks it is
    pending,    \* a report said a batch was discarded or interrupted, and no anchored batch was accepted since
    misplaced,  \* an edit played where the agent did not think the cursor was
    batches     \* batches submitted

vars == <<cursor, belief, pending, misplaced, batches>>

Init == cursor = 1 /\ belief = 1 /\ pending = FALSE /\ misplaced = FALSE /\ batches = 0

\* A batch plays through: the cursor ends where the agent planned.
Complete ==
    /\ batches < N /\ batches' = batches + 1
    /\ \E c \in 1..3 : cursor' = c /\ belief' = c
    /\ UNCHANGED <<pending, misplaced>>

\* A batch is interrupted or discarded: the cursor stops short of the plan, and the report says so.
Discard ==
    /\ batches < N /\ batches' = batches + 1
    /\ \E c, b \in 1..3 : c # b /\ cursor' = c /\ belief' = b
    /\ pending' = TRUE
    /\ UNCHANGED misplaced

\* A batch whose first action at the cursor names its file and line: the cursor goes there, the belief with it.
Anchored ==
    /\ batches < N /\ batches' = batches + 1
    /\ \E c \in 1..3 : cursor' = c /\ belief' = c
    /\ pending' = FALSE
    /\ UNCHANGED misplaced

\* A batch that types at the cursor, trusting the plan: refused while the guard holds a pending report.
Unanchored ==
    /\ batches < N /\ batches' = batches + 1
    /\ ~(Guard /\ pending)
    /\ misplaced' = (misplaced \/ cursor # belief)
    /\ UNCHANGED <<cursor, belief, pending>>

Next == Complete \/ Discard \/ Anchored \/ Unanchored

Spec == Init /\ [][Next]_vars

\* No edit plays where the agent did not think the cursor was.
NoMisplacedEdit == ~misplaced
==============================================================================
