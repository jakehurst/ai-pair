---- MODULE ListenGrace --------------------------------------------------------
(******************************************************************************)
(* The panel's status while the agent waits: `state` and `finishCall` in      *)
(* packages/core/src/controller.ts (#126). A `listen` ends at maxBlockMs with *)
(* nothing to report, and the agent calls `listen` again a few seconds later. *)
(* With `Grace`, such a timeout starts listenGraceMs of grace, during which   *)
(* the status stays "listening" ("Your move"). The grace ends at the agent's  *)
(* next call, when the programmer acts, or when it expires. With             *)
(* `ShowAbsent`, once no call has been open for absentMs, the status is       *)
(* "absent" ("Agent isn't listening") until the agent calls again (#149).     *)
(******************************************************************************)

CONSTANTS
    Grace,      \* TRUE: a listen that timed out with nothing to report keeps
                \* "listening"
    ShowAbsent  \* TRUE: with no call open for absentMs, the panel says the
                \* agent isn't listening (#149)

ASSUME AssumeGrace == Grace \in BOOLEAN
ASSUME AssumeShowAbsent == ShowAbsent \in BOOLEAN

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
    expired,    \* listenGraceMs passed since that timeout
    quiet       \* absentMs passed since the agent's last call ended, with no
                \* call since

vars == <<call, grace, owes, pending, idle, expired, quiet>>

--------------------------------------------------------------------------------

\* The values each variable can hold.
TypeOK ==
    /\ call \in Calls \cup {NoCall}
    /\ grace \in BOOLEAN
    /\ owes \in BOOLEAN
    /\ pending \in BOOLEAN
    /\ idle \in BOOLEAN
    /\ expired \in BOOLEAN
    /\ quiet \in BOOLEAN

\* The panel's status with the queue empty: "listening" ("Your move"),
\* "absent" ("Agent isn't listening"), or "thinking".
Status ==
    IF call = "listen" \/ (grace /\ ~pending)
    THEN "listening"
    ELSE IF quiet THEN "absent" ELSE "thinking"

--------------------------------------------------------------------------------

Init ==
    /\ call = NoCall
    /\ grace = FALSE
    /\ owes = FALSE
    /\ pending = FALSE
    /\ idle = FALSE
    /\ expired = FALSE
    /\ quiet = FALSE

\* The agent makes a call, any tool: `serialize` or `read`, and for a call that
\* waits, `block()`. It ends the grace and the quiet.
Call(kind) ==
    /\ call = NoCall
    /\ call' = kind
    /\ grace' = FALSE
    /\ owes' = FALSE
    /\ idle' = FALSE
    /\ expired' = FALSE
    /\ quiet' = FALSE
    /\ UNCHANGED pending

\* `finishCall` after maxBlockMs, nothing to report: the grace starts.
TimeOut ==
    /\ call = "listen"
    /\ ~pending
    /\ call' = NoCall
    /\ grace' = Grace
    /\ idle' = TRUE
    /\ UNCHANGED <<owes, pending, expired, quiet>>

\* `finishCall` with a report the agent has to act on: the programmer's input,
\* or a step's.
Return ==
    /\ call # NoCall
    /\ (call = "other" \/ pending)
    /\ call' = NoCall
    /\ grace' = FALSE
    /\ owes' = TRUE
    /\ pending' = FALSE
    /\ UNCHANGED <<idle, expired, quiet>>

\* A message, an interrupt, an edit of the programmer's, a turn change: an
\* interrupting event.
Act ==
    /\ ~pending
    /\ pending' = TRUE
    /\ UNCHANGED <<call, grace, owes, idle, expired, quiet>>

\* listenGraceMs pass: the grace timer fires.
Expire ==
    /\ idle
    /\ ~expired
    /\ grace' = FALSE
    /\ expired' = TRUE
    /\ UNCHANGED <<call, owes, pending, idle, quiet>>

\* absentMs pass with no call open: the panel says the agent isn't listening
\* (#149), once any grace is over.
GoQuiet ==
    /\ ShowAbsent
    /\ call = NoCall
    /\ ~quiet
    /\ quiet' = TRUE
    /\ UNCHANGED <<call, grace, owes, pending, idle, expired>>

Next ==
    \/ \E kind \in Calls : Call(kind)
    \/ TimeOut
    \/ Return
    \/ Act
    \/ Expire
    \/ GoQuiet

\* The grace timer and the quiet timer fire once armed, whether or not the
\* agent calls again.
Fairness == WF_vars(Expire) /\ WF_vars(GoQuiet)

Spec == Init /\ [][Next]_vars /\ Fairness

--------------------------------------------------------------------------------

\* "Your move" never shows while the agent has something to act on.
NoFalseYourMove == owes => (Status # "listening")

\* After the programmer acts, "Your move" waits for the agent's next listen.
NoYourMoveAfterAct == (pending /\ call = NoCall) => (Status # "listening")

\* A step or an end call is the agent at work.
NoYourMoveInOtherCall == (call = "other") => (Status = "thinking")

\* Between a listen that timed out empty and the agent's next call, the status
\* stays "listening" until the grace expires or the programmer acts.
NoFlicker == (idle /\ ~expired /\ ~pending) => (Status = "listening")

\* The grace ends, whether or not the agent calls again. Code whose grace never
\* ended would fail it, so it says something must happen.
GraceEnds == grace ~> ~grace

\* "Agent isn't listening" shows only while no call is open (#149).
AbsentWithoutCall == (Status = "absent") => (call = NoCall)

\* With no call open, the panel says the agent isn't listening, unless it calls
\* first (#149). Code that never said so would fail it, so it says something
\* must happen.
AbsentShows == (call = NoCall) ~> (call # NoCall \/ Status = "absent")

================================================================================
