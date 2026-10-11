---- MODULE Navigator ----------------------------------------------------------
(******************************************************************************)
(* The programmer's edits during their turn, and the agent's `listen`:        *)
(* `userEdit`, the navigator timer, `ready` for `listen`, and `snapshot` in   *)
(* packages/core/src/controller.ts. During their turn, `listen` returns for   *)
(* their edits only once they pause typing (navigatorIdleMs after their last  *)
(* edit), so the agent comments on a whole thought, not half a word. A call   *)
(* also ends at maxBlockMs, whatever is pending; that one is a timeout, not a *)
(* return for the edits.                                                      *)
(******************************************************************************)
EXTENDS Naturals

CONSTANTS
    MaxEdits,       \* how many edits the model makes
    ResetReady      \* TRUE: an edit takes back `navigatorReady`, as the timer
                    \* starts again

ASSUME AssumeMaxEdits == MaxEdits \in Nat
ASSUME AssumeResetReady == ResetReady \in BOOLEAN

VARIABLES
    typing,     \* the programmer edited less than navigatorIdleMs ago
    timer,      \* the navigator timer is armed
    ready,      \* s.navigatorReady
    pending,    \* edits not yet reported
    call,       \* the agent's call: "idle", "listening"
    early,      \* a listen returned for edits while the programmer was typing
    edits       \* edits made so far

vars == <<typing, timer, ready, pending, call, early, edits>>

--------------------------------------------------------------------------------

\* The values each variable can hold.
TypeOK ==
    /\ typing \in BOOLEAN
    /\ timer \in BOOLEAN
    /\ ready \in BOOLEAN
    /\ pending \in BOOLEAN
    /\ call \in {"idle", "listening"}
    /\ early \in BOOLEAN
    /\ edits \in Nat

--------------------------------------------------------------------------------

Init ==
    /\ typing = FALSE
    /\ timer = FALSE
    /\ ready = FALSE
    /\ pending = FALSE
    /\ call = "idle"
    /\ early = FALSE
    /\ edits = 0

\* userEdit in the programmer's turn: recordEdit, then the timer starts again.
Edit ==
    /\ typing' = TRUE
    /\ timer' = TRUE
    /\ ready' = IF ResetReady THEN FALSE ELSE ready
    /\ pending' = TRUE
    /\ edits' = edits + 1
    /\ UNCHANGED <<call, early>>

\* navigatorIdleMs pass without an edit.
Pause ==
    /\ typing
    /\ typing' = FALSE
    /\ UNCHANGED <<timer, ready, pending, call, early, edits>>

\* The timer fires, after the pause: navigatorReady, and pump().
Fire ==
    /\ timer
    /\ ~typing
    /\ timer' = FALSE
    /\ ready' = TRUE
    /\ UNCHANGED <<typing, pending, call, early, edits>>

\* The agent calls `listen`.
Listen ==
    /\ call = "idle"
    /\ call' = "listening"
    /\ UNCHANGED <<typing, timer, ready, pending, early, edits>>

\* `ready` holds: the call returns with the edits, and snapshot clears
\* navigatorReady.
Return ==
    /\ call = "listening"
    /\ ready
    /\ pending
    /\ ready' = FALSE
    /\ pending' = FALSE
    /\ call' = "idle"
    /\ early' = (early \/ typing)
    /\ UNCHANGED <<typing, timer, edits>>

\* maxBlockMs: the call ends anyway, with whatever is pending.
Timeout ==
    /\ call = "listening"
    /\ ready' = FALSE
    /\ pending' = FALSE
    /\ call' = "idle"
    /\ UNCHANGED <<typing, timer, early, edits>>

Next ==
    \/ Edit
    \/ Pause
    \/ Fire
    \/ Listen
    \/ Return
    \/ Timeout

\* The programmer pauses eventually, timers fire, the agent keeps listening,
\* and a ready call returns.
Fairness ==
    /\ WF_vars(Pause)
    /\ WF_vars(Fire)
    /\ WF_vars(Listen)
    /\ WF_vars(Return)

Spec == Init /\ [][Next]_vars /\ Fairness

--------------------------------------------------------------------------------

\* A listen returns for the programmer's edits only once they pause typing.
NotWhileTyping == ~early

\* Edits the programmer stopped making reach the agent: something must happen.
EditsReported == pending ~> ~pending

\* Edits run out only so that the model is finite (6.8). It prunes exactly the
\* states a guard `edits < MaxEdits` on Edit never reached, so the behaviors,
\* and EditsReported's result, are the guard's (8.6).
Constraint == edits <= MaxEdits

================================================================================
