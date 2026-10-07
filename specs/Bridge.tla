-------------------------------- MODULE Bridge --------------------------------
\* Which socket drives the window's session: `dispatch` and the `close` handler in
\* packages/core/src/bridge.ts, with the session in packages/core/src/controller.ts.
\* S5 in #19: a window has at most one active session, and only its owner's socket
\* can drive it.
EXTENDS Naturals

CONSTANTS
    S,          \* how many relay sockets connect to the window
    CheckOpen   \* TRUE: start() gives up the new session if its socket closed meanwhile

Sockets == 1..S

VARIABLES
    sock,     \* each socket: "open" or "closed"
    starting, \* the sockets whose `start` is awaiting controller.start()
    owner,    \* this.owner: the socket that drives the session, or 0
    session   \* the controller's session: "none", "active", "ended" (by the programmer)

vars == <<sock, starting, owner, session>>

Init == sock = [s \in Sockets |-> "open"] /\ starting = {} /\ owner = 0 /\ session = "none"

\* dispatch("start"): refused while another socket's session is active, else controller.start().
BeginStart(s) ==
    /\ sock[s] = "open" /\ s \notin starting
    /\ ~(session = "active" /\ owner # s)
    /\ starting' = starting \cup {s}
    /\ UNCHANGED <<sock, owner, session>>

\* controller.start() returns. It throws `session_active` if a session is active, which only
\* the owner's own second start can meet here. Then `this.owner = ws`.
FinishStart(s) ==
    /\ s \in starting
    /\ starting' = starting \ {s}
    /\ IF session = "active"
          THEN UNCHANGED <<owner, session>>
          ELSE IF CheckOpen /\ sock[s] = "closed"
                  THEN UNCHANGED <<owner, session>>   \* the session is closed again, unowned
                  ELSE owner' = s /\ session' = "active"
    /\ UNCHANGED sock

\* A socket closes: its calls are aborted, and if it owns the session, disconnect() closes it.
Close(s) ==
    /\ sock[s] = "open"
    /\ sock' = [sock EXCEPT ![s] = "closed"]
    /\ IF owner = s THEN owner' = 0 /\ session' = "none" ELSE UNCHANGED <<owner, session>>
    /\ UNCHANGED starting

\* The programmer ends the session from the panel; then its last report closes it.
EndSession == session = "active" /\ session' = "ended" /\ UNCHANGED <<sock, starting, owner>>
Closed == session = "ended" /\ session' = "none" /\ UNCHANGED <<sock, starting, owner>>

Next == \/ \E s \in Sockets : BeginStart(s) \/ FinishStart(s) \/ Close(s)
        \/ EndSession \/ Closed

Spec == Init /\ [][Next]_vars

\* S5: an active session is owned by a socket that is open, so some agent can drive it.
OwnedByOpenSocket == session = "active" => owner # 0 /\ sock[owner] = "open"

=============================================================================
