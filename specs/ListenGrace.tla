------------------------------ MODULE ListenGrace ------------------------------
\* The panel's status while the agent waits: `state` and `finishCall` in
\* packages/core/src/controller.ts (#126). A `listen` ends at maxBlockMs with nothing to report,
\* and the agent calls `listen` again a few seconds later. With `Grace`, such a timeout starts
\* listenGraceMs of grace, during which the status stays "listening" ("Your move"). The grace
\* ends at the agent's next call, when the programmer acts, or when it expires.

CONSTANTS
    Grace       \* TRUE: a listen that timed out with nothing to report keeps "listening"

VARIABLES
    call,       \* the agent's open call: "none", "listen", "other" (a `step` or `end`)
    grace,      \* the grace timer is armed
    owes,       \* the agent was handed something to act on, and has not called since
    pending,    \* the programmer did something not yet reported
    idle,       \* the agent's last listen timed out empty, and it has not called since
    expired     \* listenGraceMs passed since that timeout

vars == <<call, grace, owes, pending, idle, expired>>

Status ==
    IF call = "listen" \/ (grace /\ ~pending) THEN "listening" ELSE "thinking"

Init ==
    /\ call = "none" /\ grace = FALSE /\ owes = FALSE
    /\ pending = FALSE /\ idle = FALSE /\ expired = FALSE

\* `block()`: a new call ends the grace.
Call(kind) ==
    /\ call = "none" /\ call' = kind
    /\ grace' = FALSE /\ owes' = FALSE /\ idle' = FALSE /\ expired' = FALSE
    /\ UNCHANGED pending

\* `finishCall` after maxBlockMs, nothing to report: the grace starts.
TimeOut ==
    /\ call = "listen" /\ ~pending
    /\ call' = "none" /\ grace' = Grace /\ idle' = TRUE
    /\ UNCHANGED <<owes, pending, expired>>

\* `finishCall` with a report the agent has to act on: the programmer's input, or a step's.
Return ==
    /\ call /= "none" /\ (call = "other" \/ pending)
    /\ call' = "none" /\ owes' = TRUE /\ pending' = FALSE /\ grace' = FALSE
    /\ UNCHANGED <<idle, expired>>

\* A message, an interrupt, an edit of the programmer's, a turn change: an interrupting event.
Act == ~pending /\ pending' = TRUE /\ UNCHANGED <<call, grace, owes, idle, expired>>

\* listenGraceMs pass: the grace timer fires.
Expire ==
    /\ idle /\ ~expired /\ expired' = TRUE /\ grace' = FALSE
    /\ UNCHANGED <<call, owes, pending, idle>>

Next == Call("listen") \/ Call("other") \/ TimeOut \/ Return \/ Act \/ Expire

Spec == Init /\ [][Next]_vars /\ WF_vars(Expire)

\* "Your move" never shows while the agent has something to act on.
NoFalseYourMove == owes => Status = "thinking"

\* After the programmer acts, "Your move" waits for the agent's next listen.
NoYourMoveAfterAct == (pending /\ call = "none") => Status = "thinking"

\* A step or an end call is the agent at work.
NoYourMoveInOtherCall == call = "other" => Status = "thinking"

\* Between a listen that timed out empty and the agent's next call, the status stays
\* "listening" until the grace expires or the programmer acts.
NoFlicker == (idle /\ ~expired /\ ~pending) => Status = "listening"

\* The grace ends, whether or not the agent calls again.
GraceEnds == grace ~> ~grace

=============================================================================
