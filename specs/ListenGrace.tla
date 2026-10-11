---- MODULE ListenGrace --------------------------------------------------------
(******************************************************************************)
(* The panel's status while the agent waits: `state` and `finishCall` in      *)
(* packages/core/src/controller.ts (#126). A `listen` ends at maxBlockMs with *)
(* nothing to report, and the agent calls `listen` again a few seconds later. *)
(* With `Grace`, such a timeout starts listenGraceMs of grace, during which   *)
(* the status stays "listening" ("Your move"). The grace ends at the agent's  *)
(* next call, when the programmer acts, or when it expires.                   *)
(******************************************************************************)

CONSTANTS
    Grace   \* TRUE: a listen that timed out with nothing to report keeps
            \* "listening"

ASSUME AssumeGrace == Grace \in BOOLEAN

\* The calls the agent makes: a `listen`, or another (a `step` or `end`).
Calls == {"listen", "other"}

\* No call open. Any value that is not a call will do, so the config makes it
\* a model value (6.20).
NoCall == CHOOSE v : v \notin Calls

VARIABLES
    call,       \* the agent's open call: one of Calls, or NoCall
    grace,      \* the grace timer is armed
    owes,       \* the agent was handed something to act on, and has not
                \* called since
    pending,    \* the programmer did something not yet reported
    idle,       \* the agent's last listen timed out empty, and it has not
                \* called since
    expired     \* listenGraceMs passed since that timeout

vars == <<call, grace, owes, pending, idle, expired>>

--------------------------------------------------------------------------------

\* The values each variable can hold.
TypeOK ==
    /\ call \in Calls \cup {NoCall}
    /\ grace \in BOOLEAN
    /\ owes \in BOOLEAN
    /\ pending \in BOOLEAN
    /\ idle \in BOOLEAN
    /\ expired \in BOOLEAN

\* The panel's status with the queue empty: "listening" ("Your move") or
\* "thinking".
Status ==
    IF call = "listen" \/ (grace /\ ~pending)
    THEN "listening"
    ELSE "thinking"

--------------------------------------------------------------------------------

Init ==
    /\ call = NoCall
    /\ grace = FALSE
    /\ owes = FALSE
    /\ pending = FALSE
    /\ idle = FALSE
    /\ expired = FALSE

\* `block()`: the agent opens a call, which ends the grace.
Call(kind) ==
    /\ call = NoCall
    /\ call' = kind
    /\ grace' = FALSE
    /\ owes' = FALSE
    /\ idle' = FALSE
    /\ expired' = FALSE
    /\ UNCHANGED pending

\* `finishCall` after maxBlockMs, nothing to report: the grace starts.
TimeOut ==
    /\ call = "listen"
    /\ ~pending
    /\ call' = NoCall
    /\ grace' = Grace
    /\ idle' = TRUE
    /\ UNCHANGED <<owes, pending, expired>>

\* `finishCall` with a report the agent has to act on: the programmer's input,
\* or a step's.
Return ==
    /\ call # NoCall
    /\ (call = "other" \/ pending)
    /\ call' = NoCall
    /\ grace' = FALSE
    /\ owes' = TRUE
    /\ pending' = FALSE
    /\ UNCHANGED <<idle, expired>>

\* A message, an interrupt, an edit of the programmer's, a turn change: an
\* interrupting event.
Act ==
    /\ ~pending
    /\ pending' = TRUE
    /\ UNCHANGED <<call, grace, owes, idle, expired>>

\* listenGraceMs pass: the grace timer fires.
Expire ==
    /\ idle
    /\ ~expired
    /\ grace' = FALSE
    /\ expired' = TRUE
    /\ UNCHANGED <<call, owes, pending, idle>>

Next ==
    \/ \E kind \in Calls : Call(kind)
    \/ TimeOut
    \/ Return
    \/ Act
    \/ Expire

\* The grace timer fires once armed, whether or not the agent calls again.
Fairness == WF_vars(Expire)

Spec == Init /\ [][Next]_vars /\ Fairness

--------------------------------------------------------------------------------

\* "Your move" never shows while the agent has something to act on.
NoFalseYourMove == owes => (Status = "thinking")

\* After the programmer acts, "Your move" waits for the agent's next listen.
NoYourMoveAfterAct == (pending /\ call = NoCall) => (Status = "thinking")

\* A step or an end call is the agent at work.
NoYourMoveInOtherCall == (call = "other") => (Status = "thinking")

\* Between a listen that timed out empty and the agent's next call, the status
\* stays "listening" until the grace expires or the programmer acts.
NoFlicker == (idle /\ ~expired /\ ~pending) => (Status = "listening")

\* The grace ends, whether or not the agent calls again. Code whose grace never
\* ended would fail it, so it says something must happen.
GraceEnds == grace ~> ~grace

================================================================================
