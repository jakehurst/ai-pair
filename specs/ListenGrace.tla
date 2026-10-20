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
EXTENDS PairDefs

CONSTANTS
    Grace,      \* TRUE: a listen that timed out with nothing to report keeps
                \* "listening"
    ShowAbsent, \* TRUE: with no call open for absentMs, the panel says the
                \* agent isn't listening (#149)
    EndOnAnyCall \* TRUE: every call ends the grace; FALSE: only a call that
                \* blocks does, the code before #194

ASSUME AssumeGrace == Grace \in BOOLEAN
ASSUME AssumeShowAbsent == ShowAbsent \in BOOLEAN
ASSUME AssumeEndOnAnyCall == EndOnAnyCall \in BOOLEAN

VARIABLES
    call,       \* the agent's open call: one of Calls, or NoCall
    inGrace,      \* the grace timer is armed
    owesResponse,       \* the agent was handed something to act on, and has not
                \* called since
    unreported, \* the programmer did something not yet reported
    timedOut,   \* the agent's last listen timed out empty, and it has not
                \* called since
    graceExpired,    \* listenGraceMs passed since that timeout
    absent       \* absentMs passed since the agent's last call ended, with no
                \* call since

vars == <<call, inGrace, owesResponse, unreported, timedOut, graceExpired,
          absent>>

--------------------------------------------------------------------------------

\* The values each variable can hold.
TypeOK ==
    /\ call \in Calls \cup {NoCall}
    /\ inGrace \in BOOLEAN
    /\ owesResponse \in BOOLEAN
    /\ unreported \in BOOLEAN
    /\ timedOut \in BOOLEAN
    /\ graceExpired \in BOOLEAN
    /\ absent \in BOOLEAN

\* The panel's status with the queue empty: "listening" ("Your move"),
\* "absent" ("Agent isn't listening"), or "thinking".
Status ==
    IF call = "listen" \/ (inGrace /\ ~unreported)
    THEN "listening"
    ELSE IF absent THEN "absent" ELSE "thinking"

--------------------------------------------------------------------------------

Init ==
    /\ call = NoCall
    /\ inGrace = FALSE
    /\ owesResponse = FALSE
    /\ unreported = FALSE
    /\ timedOut = FALSE
    /\ graceExpired = FALSE
    /\ absent = FALSE

\* The agent makes a call that blocks: a `listen`, or a `step` or `end`
\* (`serialize`, then `block()`). It ends the grace and the quiet.
Call(kind) ==
    /\ call = NoCall
    /\ call' = kind
    /\ inGrace' = FALSE
    /\ owesResponse' = FALSE
    /\ timedOut' = FALSE
    /\ graceExpired' = FALSE
    /\ absent' = FALSE
    /\ UNCHANGED unreported

\* The agent calls `read`, which settles at once: it ends the quiet, and with
\* EndOnAnyCall the grace.
Read ==
    /\ call = NoCall
    /\ inGrace' = IF EndOnAnyCall THEN FALSE ELSE inGrace
    /\ owesResponse' = FALSE
    /\ timedOut' = FALSE
    /\ graceExpired' = FALSE
    /\ absent' = FALSE
    /\ UNCHANGED <<call, unreported>>

\* The agent calls `step`, and the batch is refused at once (rejectBatch,
\* rejectUnanchored), without `block()`: it owes a response to the rejection.
FailRehearsal ==
    /\ call = NoCall
    /\ inGrace' = IF EndOnAnyCall THEN FALSE ELSE inGrace
    /\ owesResponse' = TRUE
    /\ timedOut' = FALSE
    /\ graceExpired' = FALSE
    /\ absent' = FALSE
    /\ UNCHANGED <<call, unreported>>

\* `finishCall` after maxBlockMs, nothing to report: the grace starts.
Timeout ==
    /\ call = "listen"
    /\ ~unreported
    /\ call' = NoCall
    /\ inGrace' = Grace
    /\ timedOut' = TRUE
    /\ UNCHANGED <<owesResponse, unreported, graceExpired, absent>>

\* `finishCall` with a report the agent has to act on: the programmer's input,
\* or a step's.
Return ==
    /\ call # NoCall
    /\ (call = "stepOrEnd" \/ unreported)
    /\ call' = NoCall
    /\ inGrace' = FALSE
    /\ owesResponse' = TRUE
    /\ unreported' = FALSE
    /\ UNCHANGED <<timedOut, graceExpired, absent>>

\* A message, an interrupt, an edit of the programmer's, a turn change: an
\* interrupting event.
Interrupt ==
    /\ ~unreported
    /\ unreported' = TRUE
    /\ UNCHANGED <<call, inGrace, owesResponse, timedOut, graceExpired, absent>>

\* listenGraceMs pass: the grace timer fires.
Expire ==
    /\ timedOut
    /\ ~graceExpired
    /\ inGrace' = FALSE
    /\ graceExpired' = TRUE
    /\ UNCHANGED <<call, owesResponse, unreported, timedOut, absent>>

\* absentMs pass with no call open: the panel says the agent isn't listening
\* (#149), once any grace is over.
GoAbsent ==
    /\ ShowAbsent
    /\ call = NoCall
    /\ ~absent
    /\ absent' = TRUE
    /\ UNCHANGED <<call, inGrace, owesResponse, unreported, timedOut,
                   graceExpired>>

Next ==
    \/ \E kind \in Calls : Call(kind)
    \/ Read
    \/ FailRehearsal
    \/ Timeout
    \/ Return
    \/ Interrupt
    \/ Expire
    \/ GoAbsent

\* The grace timer and the quiet timer fire once armed, whether or not the
\* agent calls again.
Fairness == WF_vars(Expire) /\ WF_vars(GoAbsent)

Spec == Init /\ [][Next]_vars /\ Fairness

--------------------------------------------------------------------------------

\* "Your move" never shows while the agent has something to act on.
NoFalseYourMove == owesResponse => (Status # "listening")

\* After the programmer acts, "Your move" waits for the agent's next listen.
NoYourMoveAfterInterrupt ==
    (unreported /\ call = NoCall) => (Status # "listening")

\* A step or an end call is the agent at work.
NoYourMoveInOtherCall == (call = "stepOrEnd") => (Status = "thinking")

\* Between a listen that timed out empty and the agent's next call, the status
\* stays "listening" until the grace expires or the programmer acts.
NoFlicker == (timedOut /\ ~graceExpired
              /\ ~unreported) => (Status = "listening")

\* The grace ends, whether or not the agent calls again. Code whose grace never
\* ended would fail it, so it says something must happen.
GraceEnds == inGrace ~> ~inGrace

\* "Agent isn't listening" shows only while no call is open (#149).
AbsentWithoutCall == (Status = "absent") => (call = NoCall)

\* With no call open, the panel says the agent isn't listening, unless it calls
\* first (#149). Code that never said so would fail it, so it says something
\* must happen.
AbsentShows == (call = NoCall) ~> (call # NoCall \/ Status = "absent")

================================================================================
