------------------------------- MODULE Wire -------------------------------
\* The relay's side of the WebSocket link in packages/relay/src/link.ts, with
\* the editor's replies from packages/core/src/bridge.ts. Issues #3, #4, #29 and #59.
EXTENDS Naturals

CONSTANTS
    S,            \* how many sockets the relay may open in a run
    C,            \* how many calls the agent makes
    PerSocket,    \* TRUE: a close rejects only its own socket's calls (fix for #3)
    GuardedParse, \* TRUE: a frame that is not a message (not JSON, or no string `type`) is dropped (#4)
    CheckAbort,   \* TRUE: call() checks signal.aborted after connect(), before sending
    WaitCancelled \* TRUE: call() sends only once the socket's cancelled calls are answered (#59)

Sockets == 1..S
Calls == 1..C

VARIABLES
    sock,       \* each socket: "unused", "connecting", "open", "closing", "closed"
    cur,        \* this.ws: the open socket calls go out on, or 0
    call,       \* each call's state: see CallStates
    on,         \* the socket each call was sent on, or 0
    pending,    \* this.pending: the calls waiting for an answer
    rejectedBy, \* the socket whose close rejected the call, or 0
    garbage,    \* whether the frame that is not JSON has been sent yet
    relayUp     \* FALSE once an uncaught exception has ended the relay

vars == <<sock, cur, call, on, pending, rejectedBy, garbage, relayUp>>

Set(f, x, v) == [f EXCEPT ![x] = v]

\* A call is "idle", then "requested" while call() awaits connect(); then sent, in one of Sent;
\* then answered: "result", "returned" (handed back with `return`), "void" (handed to a request
\* the agent cancelled), or "rejected" (by a close). One aborted before it was sent and never
\* sent is "cancelled".
Sent == {"pending", "pendingNoticed", "pendingMissed"}
CallStates == {"idle", "requested", "requestedAborted", "cancelled", "result", "returned", "void", "rejected"} \cup Sent

TypeOK ==
    /\ sock \in [Sockets -> {"unused", "connecting", "open", "closing", "closed"}]
    /\ cur \in Sockets \cup {0}
    /\ call \in [Calls -> CallStates]
    /\ on \in [Calls -> Sockets \cup {0}]
    /\ pending \subseteq Calls
    /\ rejectedBy \in [Calls -> Sockets \cup {0}]
    /\ garbage \in BOOLEAN
    /\ relayUp \in BOOLEAN

Init ==
    /\ sock = [s \in Sockets |-> "unused"]
    /\ cur = 0
    /\ call = [c \in Calls |-> "idle"]
    /\ on = [c \in Calls |-> 0]
    /\ pending = {}
    /\ rejectedBy = [c \in Calls |-> 0]
    /\ garbage = FALSE
    /\ relayUp = TRUE

Open(s) ==
    /\ relayUp /\ cur = 0
    /\ \A t \in Sockets : sock[t] # "connecting"
    /\ sock[s] = "unused" /\ \A t \in 1..(s - 1) : sock[t] # "unused"
    /\ sock' = Set(sock, s, "connecting")
    /\ UNCHANGED <<cur, call, on, pending, rejectedBy, garbage, relayUp>>

Welcome(s) ==
    /\ relayUp /\ sock[s] = "connecting"
    /\ sock' = Set(sock, s, "open")
    /\ cur' = s
    /\ UNCHANGED <<call, on, pending, rejectedBy, garbage, relayUp>>

\* The agent calls a tool: call() starts, and awaits connect().
Request(c) ==
    /\ relayUp /\ call[c] = "idle" /\ call' = Set(call, c, "requested")
    /\ UNCHANGED <<sock, cur, on, pending, rejectedBy, garbage, relayUp>>

\* The agent cancels. Once the call is sent, the abort listener marks it; before, nothing does.
Abort(c) ==
    /\ relayUp /\ call[c] \in {"requested", "pending"}
    /\ call' = Set(call, c, IF call[c] = "requested" THEN "requestedAborted" ELSE "pendingNoticed")
    /\ UNCHANGED <<sock, cur, on, pending, rejectedBy, garbage, relayUp>>

\* call() sends the call on the open socket that connect() returned, once no cancelled call on
\* it waits for its answer: then a `return` for it went out first.
Send(c) ==
    /\ relayUp /\ cur # 0 /\ call[c] \in {"requested", "requestedAborted"}
    /\ WaitCancelled => ~\E d \in pending : on[d] = cur /\ call[d] = "pendingNoticed"
    /\ IF call[c] = "requestedAborted" /\ CheckAbort
          THEN /\ call' = Set(call, c, "cancelled")
               /\ UNCHANGED <<on, pending>>
          ELSE /\ call' = Set(call, c, IF call[c] = "requested" THEN "pending" ELSE "pendingMissed")
               /\ on' = Set(on, c, cur)
               /\ pending' = pending \cup {c}
    /\ UNCHANGED <<sock, cur, rejectedBy, garbage, relayUp>>

Close(s) ==
    /\ relayUp /\ sock[s] = "open"
    /\ sock' = Set(sock, s, "closing")
    /\ cur' = IF cur = s THEN 0 ELSE cur
    /\ UNCHANGED <<call, on, pending, rejectedBy, garbage, relayUp>>

Victims(s) == IF PerSocket THEN {c \in pending : on[c] = s} ELSE pending

Closed(s) ==
    /\ relayUp /\ sock[s] = "closing"
    /\ sock' = Set(sock, s, "closed")
    /\ call' = [c \in Calls |-> IF c \in Victims(s) THEN "rejected" ELSE call[c]]
    /\ rejectedBy' = [c \in Calls |-> IF c \in Victims(s) THEN s ELSE rejectedBy[c]]
    /\ pending' = pending \ Victims(s)
    /\ UNCHANGED <<cur, on, garbage, relayUp>>

Reply(c) ==
    /\ relayUp /\ c \in pending /\ sock[on[c]] = "open"
    /\ call' = Set(call, c, CASE call[c] = "pendingNoticed" -> "returned" [] call[c] = "pendingMissed" -> "void" [] OTHER -> "result")
    /\ pending' = pending \ {c}
    /\ UNCHANGED <<sock, cur, on, rejectedBy, garbage, relayUp>>

Garbage(s) ==
    /\ relayUp /\ ~garbage /\ sock[s] \in {"connecting", "open"}
    /\ garbage' = TRUE
    /\ relayUp' = GuardedParse
    /\ sock' = IF GuardedParse /\ sock[s] = "connecting" THEN Set(sock, s, "closing") ELSE sock
    /\ UNCHANGED <<cur, call, on, pending, rejectedBy>>

Next ==
    \/ \E s \in Sockets :
          Open(s) \/ Welcome(s) \/ Close(s) \/ Closed(s) \/ Garbage(s)
    \/ \E c \in Calls : Request(c) \/ Abort(c) \/ Send(c) \/ Reply(c)

Fairness ==
    /\ \A s \in Sockets : WF_vars(Welcome(s)) /\ WF_vars(Closed(s))
    /\ \A c \in Calls : WF_vars(Reply(c))

Spec == Init /\ [][Next]_vars /\ Fairness

\* S8: a call is rejected by a socket's close only if it was sent on that socket.
OwnCloseOnly == \A c \in Calls : rejectedBy[c] \in {0, on[c]}

\* S9: no frame from the other side ends the relay.
RelayStaysUp == relayUp

\* L7: a call sent by the relay eventually gets a result or a rejection.
CallsAnswered == \A c \in Calls :
    call[c] \in Sent ~> call[c] \in {"result", "returned", "void", "rejected"}

\* S1 at the relay: no report is handed to a request the agent already cancelled.
NoReportLost == \A c \in Calls : call[c] # "void"

=============================================================================
