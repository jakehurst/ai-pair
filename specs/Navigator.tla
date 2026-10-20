---- MODULE Navigator ----------------------------------------------------------
(******************************************************************************)
(* The programmer's edits during their turn, and the agent's `listen`:        *)
(* `userEdit`, the navigator timer, `ready` for `listen`, and `snapshot` in   *)
(* packages/core/src/controller.ts. During their turn, `listen` returns for   *)
(* their edits only once they pause typing (navigatorIdleMs after their last  *)
(* edit), so the agent comments on a whole thought, not half a word. A call   *)
(* also ends at maxBlockMs, whatever is unreported; that one is a timeout,    *)
(* not a return for the edits.                                                *)
(******************************************************************************)
EXTENDS Naturals, PairDefs

CONSTANTS
    MaxEdits,       \* how many edits the model makes
    ResetReady      \* TRUE: an edit takes back `navigatorReady`, as the timer
                    \* starts again

ASSUME AssumeMaxEdits == MaxEdits \in Nat
ASSUME AssumeResetReady == ResetReady \in BOOLEAN

VARIABLES
    typing,              \* the programmer edited less than navigatorIdleMs ago
    timerArmed,          \* the navigator timer is armed
    navigatorReady,      \* s.navigatorReady
    unreported,          \* edits not yet reported
    call,                \* the agent's open call: one of Calls, or NoCall
    returnedWhileTyping, \* a listen returned for edits while the programmer was
                         \* typing
    edits                \* edits made so far

vars == <<typing, timerArmed, navigatorReady, unreported, call,
          returnedWhileTyping, edits>>

--------------------------------------------------------------------------------

\* The values each variable can hold.
TypeOK ==
    /\ typing \in BOOLEAN
    /\ timerArmed \in BOOLEAN
    /\ navigatorReady \in BOOLEAN
    /\ unreported \in BOOLEAN
    /\ call \in Calls \cup {NoCall}
    /\ returnedWhileTyping \in BOOLEAN
    /\ edits \in Nat

--------------------------------------------------------------------------------

Init ==
    /\ typing = FALSE
    /\ timerArmed = FALSE
    /\ navigatorReady = FALSE
    /\ unreported = FALSE
    /\ call = NoCall
    /\ returnedWhileTyping = FALSE
    /\ edits = 0

\* userEdit in the programmer's turn: recordEdit, then the timer starts again.
EditAsProgrammer ==
    /\ typing' = TRUE
    /\ timerArmed' = TRUE
    /\ navigatorReady' = IF ResetReady THEN FALSE ELSE navigatorReady
    /\ unreported' = TRUE
    /\ edits' = edits + 1
    /\ UNCHANGED <<call, returnedWhileTyping>>

\* navigatorIdleMs pass without an edit.
Lull ==
    /\ typing
    /\ typing' = FALSE
    /\ UNCHANGED <<timerArmed, navigatorReady, unreported, call,
                   returnedWhileTyping, edits>>

\* The timer fires, after the pause: navigatorReady, and pump().
Fire ==
    /\ timerArmed
    /\ ~typing
    /\ timerArmed' = FALSE
    /\ navigatorReady' = TRUE
    /\ UNCHANGED <<typing, unreported, call, returnedWhileTyping, edits>>

\* The agent calls `listen`.
Listen ==
    /\ call = NoCall
    /\ call' = "listen"
    /\ UNCHANGED <<typing, timerArmed, navigatorReady, unreported,
                   returnedWhileTyping, edits>>

\* `navigatorReady` holds: the call returns with the edits, and snapshot clears
\* navigatorReady.
Return ==
    /\ call = "listen"
    /\ navigatorReady
    /\ unreported
    /\ navigatorReady' = FALSE
    /\ unreported' = FALSE
    /\ call' = NoCall
    /\ returnedWhileTyping' = (returnedWhileTyping \/ typing)
    /\ UNCHANGED <<typing, timerArmed, edits>>

\* maxBlockMs: the call ends anyway, with whatever is unreported.
Timeout ==
    /\ call = "listen"
    /\ navigatorReady' = FALSE
    /\ unreported' = FALSE
    /\ call' = NoCall
    /\ UNCHANGED <<typing, timerArmed, returnedWhileTyping, edits>>

Next ==
    \/ EditAsProgrammer
    \/ Lull
    \/ Fire
    \/ Listen
    \/ Return
    \/ Timeout

\* The programmer pauses eventually, timers fire, the agent keeps listening,
\* and a ready call returns.
Fairness ==
    /\ WF_vars(Lull)
    /\ WF_vars(Fire)
    /\ WF_vars(Listen)
    /\ WF_vars(Return)

Spec == Init /\ [][Next]_vars /\ Fairness

--------------------------------------------------------------------------------

\* A listen returns for the programmer's edits only once they pause typing.
NotWhileTyping == ~returnedWhileTyping

\* Edits the programmer stopped making reach the agent: something must happen.
EditsReported == unreported ~> ~unreported

\* Edits run out only so that the model is finite (6.8). It prunes exactly the
\* states a guard `edits < MaxEdits` on EditAsProgrammer never reached, so the
\* behaviors, and EditsReported's result, are the guard's (8.6).
Constraint == edits <= MaxEdits

================================================================================
