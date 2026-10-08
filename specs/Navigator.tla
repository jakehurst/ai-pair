------------------------------- MODULE Navigator -------------------------------
\* The programmer's edits during their turn, and the agent's `listen`: `userEdit`, the navigator
\* timer, `ready` for `listen`, and `snapshot` in packages/core/src/controller.ts. During their
\* turn, `listen` returns for their edits only once they pause typing (navigatorIdleMs after
\* their last edit), so the agent comments on a whole thought, not half a word. A call also ends
\* at maxBlockMs, whatever is pending; that one is a timeout, not a return for the edits.
EXTENDS Naturals

CONSTANTS
    Edits,      \* how many edits the programmer makes in a run
    ResetReady  \* TRUE: an edit takes back `navigatorReady`, as the timer starts again

VARIABLES
    typing,     \* the programmer edited less than navigatorIdleMs ago
    timer,      \* the navigator timer is armed
    ready,      \* s.navigatorReady
    pending,    \* edits not yet reported
    call,       \* the agent's call: "idle", "listening"
    early,      \* a listen returned for edits while the programmer was typing
    edits

vars == <<typing, timer, ready, pending, call, early, edits>>

Init ==
    /\ typing = FALSE /\ timer = FALSE /\ ready = FALSE /\ pending = FALSE
    /\ call = "idle" /\ early = FALSE /\ edits = 0

\* userEdit in the programmer's turn: recordEdit, then the timer starts again.
Edit ==
    /\ edits < Edits /\ edits' = edits + 1
    /\ typing' = TRUE /\ timer' = TRUE /\ pending' = TRUE
    /\ ready' = IF ResetReady THEN FALSE ELSE ready
    /\ UNCHANGED <<call, early>>

\* navigatorIdleMs pass without an edit.
Pause == typing /\ typing' = FALSE /\ UNCHANGED <<timer, ready, pending, call, early, edits>>

\* The timer fires, after the pause: navigatorReady, and pump().
Fire == timer /\ ~typing /\ timer' = FALSE /\ ready' = TRUE /\ UNCHANGED <<typing, pending, call, early, edits>>

Listen == call = "idle" /\ call' = "listening" /\ UNCHANGED <<typing, timer, ready, pending, early, edits>>

\* `ready` holds: the call returns with the edits, and snapshot clears navigatorReady.
Return ==
    /\ call = "listening" /\ ready /\ pending
    /\ call' = "idle" /\ pending' = FALSE /\ ready' = FALSE /\ early' = (early \/ typing)
    /\ UNCHANGED <<typing, timer, edits>>

\* maxBlockMs: the call ends anyway, with whatever is pending.
Timeout ==
    /\ call = "listening" /\ call' = "idle" /\ pending' = FALSE /\ ready' = FALSE
    /\ UNCHANGED <<typing, timer, early, edits>>

Next == Edit \/ Pause \/ Fire \/ Listen \/ Return \/ Timeout

\* The programmer pauses eventually, timers fire, the agent keeps listening, and a ready call returns.
Spec == Init /\ [][Next]_vars /\ WF_vars(Pause) /\ WF_vars(Fire) /\ WF_vars(Listen) /\ WF_vars(Return)

\* A listen returns for the programmer's edits only once they pause typing.
NotWhileTyping == ~early

\* Edits the programmer stopped making reach the agent.
EditsReported == pending ~> ~pending

=============================================================================
