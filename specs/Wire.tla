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
    WaitCancelled, \* TRUE: call() sends only once the socket's cancelled calls are answered (#59)
    HandBackAnswered, \* TRUE: a cancel that reaches the relay after it answered hands the report back (#67)
    MarkRepeats      \* TRUE: ...marked as possibly seen, so its next delivery says it may repeat

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
    relayUp,    \* FALSE once an uncaught exception has ended the relay
    aborted,    \* the agent's MCP client cancelled the call: it drops any answer from then on
    noticed,    \* the relay has handled the client's `notifications/cancelled` for it
    answered,   \* the relay's answer reached the client: "no", "taken", "dropped"
    marked      \* the report was handed back as possibly seen (`mayRepeat`)

vars == <<sock, cur, call, on, pending, rejectedBy, garbage, relayUp, aborted, noticed, answered, marked>>
relay == <<sock, cur, call, on, pending, rejectedBy, garbage, relayUp>>

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
    /\ aborted \in [Calls -> BOOLEAN] /\ noticed \in [Calls -> BOOLEAN]
    /\ answered \in [Calls -> {"no", "taken", "dropped"}] /\ marked \in [Calls -> BOOLEAN]

Init ==
    /\ sock = [s \in Sockets |-> "unused"]
    /\ cur = 0
    /\ call = [c \in Calls |-> "idle"]
    /\ on = [c \in Calls |-> 0]
    /\ pending = {}
    /\ rejectedBy = [c \in Calls |-> 0]
    /\ garbage = FALSE
    /\ relayUp = TRUE
    /\ aborted = [c \in Calls |-> FALSE] /\ noticed = [c \in Calls |-> FALSE]
    /\ answered = [c \in Calls |-> "no"] /\ marked = [c \in Calls |-> FALSE]

Open(s) ==
    /\ relayUp /\ cur = 0
    /\ \A t \in Sockets : sock[t] # "connecting"
    /\ sock[s] = "unused" /\ \A t \in 1..(s - 1) : sock[t] # "unused"
    /\ sock' = Set(sock, s, "connecting")
    /\ UNCHANGED <<cur, call, on, pending, rejectedBy, garbage, relayUp>>
    /\ UNCHANGED <<aborted, noticed, answered, marked>>

Welcome(s) ==
    /\ relayUp /\ sock[s] = "connecting"
    /\ sock' = Set(sock, s, "open")
    /\ cur' = s
    /\ UNCHANGED <<call, on, pending, rejectedBy, garbage, relayUp>>
    /\ UNCHANGED <<aborted, noticed, answered, marked>>

\* The agent calls a tool: call() starts, and awaits connect().
Request(c) ==
    /\ relayUp /\ call[c] = "idle" /\ call' = Set(call, c, "requested")
    /\ UNCHANGED <<sock, cur, on, pending, rejectedBy, garbage, relayUp>>
    /\ UNCHANGED <<aborted, noticed, answered, marked>>

\* The agent's client cancels: from now on it drops any answer to the call (the SDK deletes its
\* response handler), and it sends `notifications/cancelled`. The SDK never removes its abort
\* listener, so a signal aborted after the answer was taken sends one too (protocol.js, request()).
ClientAbort(c) ==
    /\ relayUp /\ call[c] # "idle" /\ ~aborted[c]
    /\ aborted' = [aborted EXCEPT ![c] = TRUE]
    /\ UNCHANGED <<relay, noticed, answered, marked>>

\* The relay handles the notification: the abort listener marks a sent call; before it is sent,
\* nothing does. After the relay answered, the SDK has nothing to abort; with HandBackAnswered the
\* relay hands the report back with `return`.
Abort(c) ==
    /\ relayUp /\ aborted[c] /\ ~noticed[c]
    /\ noticed' = [noticed EXCEPT ![c] = TRUE]
    /\ call' = CASE call[c] = "requested" -> Set(call, c, "requestedAborted")
                [] call[c] = "pending" -> Set(call, c, "pendingNoticed")
                [] call[c] = "result" /\ HandBackAnswered /\ sock[on[c]] = "open" -> Set(call, c, "returned")
                [] OTHER -> call
    /\ marked' = IF call[c] = "result" /\ HandBackAnswered /\ MarkRepeats /\ sock[on[c]] = "open"
                 THEN [marked EXCEPT ![c] = TRUE] ELSE marked
    /\ UNCHANGED <<sock, cur, on, pending, rejectedBy, garbage, relayUp, aborted, answered>>

\* The relay's answer reaches the client, which takes it unless it cancelled the call.
Deliver(c) ==
    /\ call[c] \in {"result", "returned", "void", "rejected"} /\ answered[c] = "no"
    /\ answered' = [answered EXCEPT ![c] = IF aborted[c] THEN "dropped" ELSE "taken"]
    /\ UNCHANGED <<relay, aborted, noticed, marked>>

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
    /\ UNCHANGED <<aborted, noticed, answered, marked>>

Close(s) ==
    /\ relayUp /\ sock[s] = "open"
    /\ sock' = Set(sock, s, "closing")
    /\ cur' = IF cur = s THEN 0 ELSE cur
    /\ UNCHANGED <<call, on, pending, rejectedBy, garbage, relayUp>>
    /\ UNCHANGED <<aborted, noticed, answered, marked>>

Victims(s) == IF PerSocket THEN {c \in pending : on[c] = s} ELSE pending

Closed(s) ==
    /\ relayUp /\ sock[s] = "closing"
    /\ sock' = Set(sock, s, "closed")
    /\ call' = [c \in Calls |-> IF c \in Victims(s) THEN "rejected" ELSE call[c]]
    /\ rejectedBy' = [c \in Calls |-> IF c \in Victims(s) THEN s ELSE rejectedBy[c]]
    /\ pending' = pending \ Victims(s)
    /\ UNCHANGED <<cur, on, garbage, relayUp>>
    /\ UNCHANGED <<aborted, noticed, answered, marked>>

Reply(c) ==
    /\ relayUp /\ c \in pending /\ sock[on[c]] = "open"
    /\ call' = Set(call, c, CASE call[c] = "pendingNoticed" -> "returned" [] call[c] = "pendingMissed" -> "void" [] OTHER -> "result")
    /\ pending' = pending \ {c}
    /\ UNCHANGED <<sock, cur, on, rejectedBy, garbage, relayUp>>
    /\ UNCHANGED <<aborted, noticed, answered, marked>>

Garbage(s) ==
    /\ relayUp /\ ~garbage /\ sock[s] \in {"connecting", "open"}
    /\ garbage' = TRUE
    /\ relayUp' = GuardedParse
    /\ sock' = IF GuardedParse /\ sock[s] = "connecting" THEN Set(sock, s, "closing") ELSE sock
    /\ UNCHANGED <<cur, call, on, pending, rejectedBy>>
    /\ UNCHANGED <<aborted, noticed, answered, marked>>

Next ==
    \/ \E s \in Sockets :
          Open(s) \/ Welcome(s) \/ Close(s) \/ Closed(s) \/ Garbage(s)
    \/ \E c \in Calls : Request(c) \/ ClientAbort(c) \/ Abort(c) \/ Send(c) \/ Reply(c) \/ Deliver(c)

Fairness ==
    /\ \A s \in Sockets : WF_vars(Welcome(s)) /\ WF_vars(Closed(s))
    /\ \A c \in Calls : WF_vars(Reply(c)) /\ WF_vars(Abort(c)) /\ WF_vars(Deliver(c))

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

\* S1 at the agent, at least once: a report the client took and that is handed back again says,
\* when delivered again, that it may repeat one already seen.
RepeatsMarked == \A c \in Calls : (answered[c] = "taken" /\ call[c] = "returned") => marked[c]

\* S1 at the agent: a report the client dropped is handed back to the editor, unless the socket
\* closed first, which ends the session (bridge.ts). (A `read` takes no report; every call here is a report.)
DroppedHandedBack ==
    \A c \in Calls : answered[c] = "dropped" /\ call[c] # "rejected" ~> call[c] = "returned" \/ (on[c] # 0 /\ sock[on[c]] # "open")

=============================================================================
