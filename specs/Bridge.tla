---- MODULE Bridge -------------------------------------------------------------
(******************************************************************************)
(* Which socket drives the window's session: `dispatch` and the `close`       *)
(* handler in packages/core/src/bridge.ts, with the session in                *)
(* packages/core/src/controller.ts. A window has at most one active session,  *)
(* and only its owner's socket can drive it.                                  *)
(******************************************************************************)
EXTENDS Naturals, PairDefs

CONSTANTS
    NumSockets, \* how many relay sockets connect to the window
    CheckOpen   \* TRUE: start() gives up the new session if its socket closed
                \* meanwhile (the fix for #42)

ASSUME AssumeNumSockets == NumSockets \in Nat \ {0}
ASSUME AssumeCheckOpen == CheckOpen \in BOOLEAN

\* The relay sockets.
Sockets == 1..NumSockets

\* No socket: the session has no owner. Any value that is not a socket will
\* do, so the config makes it a model value (6.20).
NoSocket == CHOOSE v : v \notin Sockets

VARIABLES
    socketState, \* each socket: "open" or "closed"
    starting,    \* the sockets whose `start` is awaiting controller.start()
    owner,       \* this.owner: the socket that drives the session, or NoSocket
    session,     \* the controller's session: one of SessionPhases, or NoSession
    restorable   \* this.closed: TRUE when a last report closed the session, and
                 \* a `return` can bring it back

vars == <<socketState, starting, owner, session, restorable>>

--------------------------------------------------------------------------------

\* The values each variable can hold.
TypeOK ==
    /\ socketState \in [Sockets -> {"open", "closed"}]
    /\ starting \subseteq Sockets
    /\ owner \in Sockets \cup {NoSocket}
    /\ session \in SessionPhases \cup {NoSession}
    /\ restorable \in BOOLEAN

--------------------------------------------------------------------------------

Init ==
    /\ socketState = [s \in Sockets |-> "open"]
    /\ starting = {}
    /\ owner = NoSocket
    /\ session = NoSession
    /\ restorable = FALSE

\* dispatch("start"): refused while another socket's session is active, else
\* controller.start().
BeginStart(s) ==
    /\ socketState[s] = "open"
    /\ s \notin starting
    /\ ~(session = "active" /\ owner # s)
    /\ starting' = starting \cup {s}
    /\ UNCHANGED <<socketState, owner, session, restorable>>

\* controller.start() returns. It throws `session_active` if a session is
\* active: the owner's own second start, or a start that began before another
\* socket's session did. Else `this.owner = ws`; with CheckOpen, a socket that
\* closed meanwhile does not take the session, and disconnect() suspends it.
FinishStart(s) ==
    /\ s \in starting
    /\ starting' = starting \ {s}
    /\ IF session = "active"
       THEN UNCHANGED <<owner, session, restorable>>
       ELSE IF CheckOpen /\ socketState[s] = "closed"
            THEN /\ owner' = NoSocket
                 /\ session' = "suspended"
                 /\ restorable' = FALSE
            ELSE /\ owner' = s
                 /\ session' = "active"
                 /\ restorable' = FALSE
    /\ UNCHANGED socketState

\* A socket closes: its calls are aborted, and if it owns the session,
\* disconnect() suspends it, or closes an ended one (#25).
CloseSocket(s) ==
    /\ socketState[s] = "open"
    /\ socketState' = [socketState EXCEPT ![s] = "closed"]
    /\ IF owner = s
       THEN /\ owner' = NoSocket
            /\ session' = IF session = "active" THEN "suspended" ELSE NoSession
            /\ restorable' = FALSE
       ELSE UNCHANGED <<owner, session, restorable>>
    /\ UNCHANGED starting

\* The programmer ends the session from the panel.
EndByProgrammer ==
    /\ session = "active"
    /\ session' = "ended"
    /\ UNCHANGED <<socketState, starting, owner, restorable>>

\* The ended session's last report, to its owner's next call, closes it.
CloseEnded ==
    /\ session = "ended"
    /\ session' = NoSession
    /\ restorable' = TRUE
    /\ UNCHANGED <<socketState, starting, owner>>

\* The programmer ends a suspended session: no agent is there to tell, so it
\* closes at once.
EndSuspended ==
    /\ session = "suspended"
    /\ session' = NoSession
    /\ UNCHANGED <<socketState, starting, owner, restorable>>

\* The agent ends the session (`end`): its report closes it.
EndByAgent ==
    /\ session = "active"
    /\ session' = NoSession
    /\ restorable' = TRUE
    /\ UNCHANGED <<socketState, starting, owner>>

\* A `return` from the owner's socket: restore() brings the closed session
\* back, as ended (#60). The relay sends it from Wire's `Abort` and `Reply`, and
\* the report itself lands in Controller's `Restore`.
Restore(s) ==
    /\ owner = s
    /\ socketState[s] = "open"
    /\ session = NoSession
    /\ restorable
    /\ session' = "ended"
    /\ restorable' = FALSE
    /\ UNCHANGED <<socketState, starting, owner>>

\* Every socket closed, with no session and no start under way: nothing is left
\* to happen until a socket the model does not make connects.
Finished ==
    /\ \A s \in Sockets : socketState[s] = "closed"
    /\ starting = {}
    /\ session = NoSession
    /\ UNCHANGED vars

Next ==
    \/ \E s \in Sockets : BeginStart(s)
    \/ \E s \in Sockets : FinishStart(s)
    \/ \E s \in Sockets : CloseSocket(s)
    \/ \E s \in Sockets : Restore(s)
    \/ EndByProgrammer
    \/ CloseEnded
    \/ EndSuspended
    \/ EndByAgent
    \/ Finished

\* A start under way returns; the other steps come when they do.
Fairness == \A s \in Sockets : WF_vars(FinishStart(s))

Spec == Init /\ [][Next]_vars /\ Fairness

--------------------------------------------------------------------------------

\* An active session is owned by a socket that is open, so some agent can
\* drive it.
OwnedByOpenSocket ==
    (session = "active") => (owner # NoSocket /\ socketState[owner] = "open")

\* An ended session has an owner, whose next call takes its report and closes
\* it.
EndedOwned == (session = "ended") => (owner # NoSocket)

\* A suspended session has no owner: only a `start` takes it up again (#25).
SuspendedUnowned == (session = "suspended") => (owner = NoSocket)

\* A start leaves the window with a session: the one it started, active or,
\* its socket closed meanwhile, suspended; or one already active. Code that
\* never started a session would fail it, so it says something must happen.
StartOpensSession ==
    \A s \in Sockets :
        (s \in starting) ~> (session \in {"active", "suspended"})

================================================================================
