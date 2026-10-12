---- MODULE Wire ---------------------------------------------------------------
(******************************************************************************)
(* The relay's side of the WebSocket link in packages/relay/src/link.ts, with *)
(* the editor's replies from packages/core/src/bridge.ts. Issues #3, #4, #29, *)
(* #59, and #67. The agent's MCP client is modeled too: it drops an answer    *)
(* once it has canceled, and it sends a cancel even after it took the         *)
(* answer, since the SDK never removes its abort listener. Sockets and calls  *)
(* are finite, so a run ends once the relay has used up its sockets.          *)
(******************************************************************************)
EXTENDS Naturals

CONSTANTS
    MaxSockets,       \* how many sockets the relay may open in a run
    MaxCalls,         \* how many calls the agent makes, at most
    PerSocket,        \* TRUE: a close rejects only its own socket's calls (the
                      \* fix for #3)
    GuardedParse,     \* TRUE: a frame that is not a message (not JSON, or no
                      \* string `type`) is dropped (#4)
    CheckAbort,       \* TRUE: call() checks signal.aborted after connect(),
                      \* before sending (#29)
    WaitCancelled,    \* TRUE: call() sends only once the socket's canceled
                      \* calls are answered (#59)
    HandBackAnswered, \* TRUE: a cancel that reaches the relay after it
                      \* answered hands the report back (#67)
    MarkRepeats       \* TRUE: the report handed back is marked as possibly
                      \* seen, so its next delivery says it may repeat (#67)

ASSUME AssumeMaxSockets == MaxSockets \in Nat \ {0}
ASSUME AssumeMaxCalls == MaxCalls \in Nat \ {0}
ASSUME AssumePerSocket == PerSocket \in BOOLEAN
ASSUME AssumeGuardedParse == GuardedParse \in BOOLEAN
ASSUME AssumeCheckAbort == CheckAbort \in BOOLEAN
ASSUME AssumeWaitCancelled == WaitCancelled \in BOOLEAN
ASSUME AssumeHandBackAnswered == HandBackAnswered \in BOOLEAN
ASSUME AssumeMarkRepeats == MarkRepeats \in BOOLEAN

\* The sockets the relay may open, in the order it opens them.
Sockets == 1..MaxSockets

\* The agent's calls.
Calls == 1..MaxCalls

\* No socket: none open for calls to go out on, or none a call was sent on or
\* rejected by. Any value that is not a socket will do, so the config makes it
\* a model value (6.20).
NoSocket == CHOOSE v : v \notin Sockets

\* The states of a socket.
SocketStates == {"unused", "connecting", "open", "closing", "closed"}

\* A call is "idle", then "requested" while call() awaits connect(), or
\* "requestedAborted" once the relay handled its cancel then; then sent, in
\* one of Sent; then settled, in one of Settled. One canceled before it was
\* sent, and never sent, is "cancelled".
Unsent == {"idle", "requested", "requestedAborted", "cancelled"}

\* The states of a sent call waiting for its answer.
Sent == {"pending", "pendingNoticed", "pendingMissed"}

\* The answers: "result", "returned" (handed back with `return`), "void"
\* (handed to a request the agent canceled), or "rejected" (by a close).
Settled == {"result", "returned", "void", "rejected"}

\* The states of a call.
CallStates == Unsent \cup Sent \cup Settled

VARIABLES
    sock,       \* each socket's state, in SocketStates
    cur,        \* this.ws: the open socket calls go out on, or NoSocket
    call,       \* each call's state, in CallStates
    on,         \* the socket each call was sent on, or NoSocket
    pending,    \* the calls waiting for an answer, each in the `calls` map of
                \* the socket it went out on
    rejectedBy, \* the socket whose close rejected the call, or NoSocket
    garbage,    \* whether the frame that is not a message has been sent yet
    relayUp,    \* FALSE once an uncaught exception has ended the relay
    aborted,    \* the agent's MCP client canceled the call: it drops any
                \* answer from then on
    noticed,    \* the relay has handled the client's
                \* `notifications/cancelled` for it
    answered,   \* the relay's answer reached the client: "no", "taken", or
                \* "dropped"
    marked      \* the report was handed back as possibly seen (`mayRepeat`)

vars ==
    <<sock, cur, call, on, pending, rejectedBy, garbage, relayUp, aborted,
      noticed, answered, marked>>

\* The relay's variables, which the client's own steps leave alone.
relayVars == <<sock, cur, call, on, pending, rejectedBy, garbage, relayUp>>

--------------------------------------------------------------------------------

\* The values each variable can hold.
TypeOK ==
    /\ sock \in [Sockets -> SocketStates]
    /\ cur \in Sockets \cup {NoSocket}
    /\ call \in [Calls -> CallStates]
    /\ on \in [Calls -> Sockets \cup {NoSocket}]
    /\ pending \subseteq Calls
    /\ rejectedBy \in [Calls -> Sockets \cup {NoSocket}]
    /\ garbage \in BOOLEAN
    /\ relayUp \in BOOLEAN
    /\ aborted \in [Calls -> BOOLEAN]
    /\ noticed \in [Calls -> BOOLEAN]
    /\ answered \in [Calls -> {"no", "taken", "dropped"}]
    /\ marked \in [Calls -> BOOLEAN]

\* A call sent on socket s was canceled, the relay sent its cancel, and its
\* answer has not come: a `return` for it may be on its way.
AwaitsReturn(s) == \E d \in pending : on[d] = s /\ call[d] = "pendingNoticed"

\* The calls the close of socket s rejects: with PerSocket, only those sent on
\* it; before #3, every call waiting.
Victims(s) == IF PerSocket THEN {c \in pending : on[c] = s} ELSE pending

--------------------------------------------------------------------------------

Init ==
    /\ sock = [s \in Sockets |-> "unused"]
    /\ cur = NoSocket
    /\ call = [c \in Calls |-> "idle"]
    /\ on = [c \in Calls |-> NoSocket]
    /\ pending = {}
    /\ rejectedBy = [c \in Calls |-> NoSocket]
    /\ garbage = FALSE
    /\ relayUp = TRUE
    /\ aborted = [c \in Calls |-> FALSE]
    /\ noticed = [c \in Calls |-> FALSE]
    /\ answered = [c \in Calls |-> "no"]
    /\ marked = [c \in Calls |-> FALSE]

\* connect() opens a socket when none is open, one attempt at a time. The
\* sockets are alike, so they open in order, which drops only copies of the
\* same runs.
Open(s) ==
    /\ relayUp
    /\ cur = NoSocket
    /\ \A t \in Sockets : sock[t] # "connecting"
    /\ sock[s] = "unused"
    /\ \A t \in 1..(s - 1) : sock[t] # "unused"
    /\ sock' = [sock EXCEPT ![s] = "connecting"]
    /\ UNCHANGED <<cur, call, on, pending, rejectedBy, garbage, relayUp>>
    /\ UNCHANGED <<aborted, noticed, answered, marked>>

\* The editor's `welcome`: the socket is open, and calls go out on it.
Welcome(s) ==
    /\ relayUp
    /\ sock[s] = "connecting"
    /\ sock' = [sock EXCEPT ![s] = "open"]
    /\ cur' = s
    /\ UNCHANGED <<call, on, pending, rejectedBy, garbage, relayUp>>
    /\ UNCHANGED <<aborted, noticed, answered, marked>>

\* The agent calls a tool: call() starts, and awaits connect().
Request(c) ==
    /\ relayUp
    /\ call[c] = "idle"
    /\ call' = [call EXCEPT ![c] = "requested"]
    /\ UNCHANGED <<sock, cur, on, pending, rejectedBy, garbage, relayUp>>
    /\ UNCHANGED <<aborted, noticed, answered, marked>>

\* The agent's client cancels: from now on it drops any answer to the call
\* (the SDK deletes its response handler), and it sends
\* `notifications/cancelled`. The SDK never removes its abort listener, so a
\* signal aborted after the answer was taken sends one too (protocol.js,
\* request()).
AbortInClient(c) ==
    /\ relayUp
    /\ call[c] # "idle"
    /\ ~aborted[c]
    /\ aborted' = [aborted EXCEPT ![c] = TRUE]
    /\ UNCHANGED relayVars
    /\ UNCHANGED <<noticed, answered, marked>>

\* The relay handles the notification: the abort listener marks a sent call;
\* before it is sent, the listener is not there yet, and nothing does. After
\* the relay answered, the SDK has nothing to abort; with HandBackAnswered
\* the relay hands the report back with `return`, and with MarkRepeats marks
\* it as possibly seen. Abort happens once for each call, so marked[c] is
\* FALSE until then.
Abort(c) ==
    LET handBack ==
            call[c] = "result" /\ HandBackAnswered /\ sock[on[c]] = "open"
        noticedState ==
            CASE call[c] = "requested" -> "requestedAborted"
              [] call[c] = "pending" -> "pendingNoticed"
              [] handBack -> "returned"
              [] OTHER -> call[c]
    IN  /\ relayUp
        /\ aborted[c]
        /\ ~noticed[c]
        /\ call' = [call EXCEPT ![c] = noticedState]
        /\ noticed' = [noticed EXCEPT ![c] = TRUE]
        /\ marked' = [marked EXCEPT ![c] = handBack /\ MarkRepeats]
        /\ UNCHANGED <<sock, cur, on, pending, rejectedBy, garbage, relayUp>>
        /\ UNCHANGED <<aborted, answered>>

\* The relay's answer reaches the client, which takes it unless it canceled
\* the call.
Deliver(c) ==
    /\ call[c] \in Settled
    /\ answered[c] = "no"
    /\ answered' =
           [answered EXCEPT ![c] = IF aborted[c] THEN "dropped" ELSE "taken"]
    /\ UNCHANGED relayVars
    /\ UNCHANGED <<aborted, noticed, marked>>

\* call() sends the call on the open socket that connect() returned, once no
\* canceled call on it waits for its answer (#59): then a `return` for it
\* went out first. With CheckAbort, a call canceled meanwhile is not sent
\* (#29); without it, the call goes out with no abort listener to mark it.
Send(c) ==
    LET sentState ==
            IF call[c] = "requested" THEN "pending" ELSE "pendingMissed"
    IN  /\ relayUp
        /\ cur # NoSocket
        /\ call[c] \in {"requested", "requestedAborted"}
        /\ WaitCancelled => ~AwaitsReturn(cur)
        /\ IF call[c] = "requestedAborted" /\ CheckAbort
           THEN /\ call' = [call EXCEPT ![c] = "cancelled"]
                /\ UNCHANGED <<on, pending>>
           ELSE /\ call' = [call EXCEPT ![c] = sentState]
                /\ on' = [on EXCEPT ![c] = cur]
                /\ pending' = pending \cup {c}
        /\ UNCHANGED <<sock, cur, rejectedBy, garbage, relayUp>>
        /\ UNCHANGED <<aborted, noticed, answered, marked>>

\* locate() closes this.ws to switch windows, or the editor's end closes the
\* socket: calls no longer go out on it.
Close(s) ==
    /\ relayUp
    /\ sock[s] = "open"
    /\ sock' = [sock EXCEPT ![s] = "closing"]
    /\ cur' = IF cur = s THEN NoSocket ELSE cur
    /\ UNCHANGED <<call, on, pending, rejectedBy, garbage, relayUp>>
    /\ UNCHANGED <<aborted, noticed, answered, marked>>

\* The socket's `close` handler rejects its Victims.
HandleClose(s) ==
    LET victims == Victims(s)
    IN  /\ relayUp
        /\ sock[s] = "closing"
        /\ sock' = [sock EXCEPT ![s] = "closed"]
        /\ call' =
               [c \in Calls |-> IF c \in victims THEN "rejected" ELSE call[c]]
        /\ pending' = pending \ victims
        /\ rejectedBy' =
               [c \in Calls |-> IF c \in victims THEN s ELSE rejectedBy[c]]
        /\ UNCHANGED <<cur, on, garbage, relayUp>>
        /\ UNCHANGED <<aborted, noticed, answered, marked>>

\* A `result` frame for a call on an open socket: the result, or for a call
\* the relay marked canceled, a `return` that hands the report back. A call
\* sent after its cancel, unmarked, resolves a request the agent canceled.
Reply(c) ==
    LET answer ==
            CASE call[c] = "pendingNoticed" -> "returned"
              [] call[c] = "pendingMissed" -> "void"
              [] OTHER -> "result"
    IN  /\ relayUp
        /\ c \in pending
        /\ sock[on[c]] = "open"
        /\ call' = [call EXCEPT ![c] = answer]
        /\ pending' = pending \ {c}
        /\ UNCHANGED <<sock, cur, on, rejectedBy, garbage, relayUp>>
        /\ UNCHANGED <<aborted, noticed, answered, marked>>

\* The other side sends a frame that is not a message (parseEditorMessage).
\* With GuardedParse it is dropped, and before the welcome the socket is
\* closed, as whatever is on the port is not the editor; without it, the
\* uncaught exception ends the relay (#4).
SendGarbage(s) ==
    /\ relayUp
    /\ ~garbage
    /\ sock[s] \in {"connecting", "open"}
    /\ sock' = IF GuardedParse /\ sock[s] = "connecting"
               THEN [sock EXCEPT ![s] = "closing"]
               ELSE sock
    /\ garbage' = TRUE
    /\ relayUp' = GuardedParse
    /\ UNCHANGED <<cur, call, on, pending, rejectedBy>>
    /\ UNCHANGED <<aborted, noticed, answered, marked>>

\* The run ends once the model's sockets are used up, or the relay has
\* crashed, by design (6.13).
Finished ==
    /\ \/ ~relayUp
       \/ \A s \in Sockets : sock[s] = "closed"
    /\ UNCHANGED vars

Next ==
    \/ \E s \in Sockets : Open(s)
    \/ \E s \in Sockets : Welcome(s)
    \/ \E c \in Calls : Request(c)
    \/ \E c \in Calls : AbortInClient(c)
    \/ \E c \in Calls : Abort(c)
    \/ \E c \in Calls : Deliver(c)
    \/ \E c \in Calls : Send(c)
    \/ \E s \in Sockets : Close(s)
    \/ \E s \in Sockets : HandleClose(s)
    \/ \E c \in Calls : Reply(c)
    \/ \E s \in Sockets : SendGarbage(s)
    \/ Finished

\* The editor welcomes, a closing socket's handler runs, the editor answers,
\* the relay handles each cancel, and each answer reaches the client.
Fairness ==
    /\ \A s \in Sockets : WF_vars(Welcome(s))
    /\ \A s \in Sockets : WF_vars(HandleClose(s))
    /\ \A c \in Calls : WF_vars(Reply(c))
    /\ \A c \in Calls : WF_vars(Abort(c))
    /\ \A c \in Calls : WF_vars(Deliver(c))

Spec == Init /\ [][Next]_vars /\ Fairness

--------------------------------------------------------------------------------

\* A call is rejected by a socket's close only if it was sent on that
\* socket.
OwnCloseOnly == \A c \in Calls : rejectedBy[c] \in {NoSocket, on[c]}

\* No frame from the other side ends the relay.
RelayStaysUp == relayUp

\* A call sent by the relay eventually gets a result or a rejection. A
\* relay that never answered would fail it, so it says something must happen.
CallsAnswered == \A c \in Calls : (call[c] \in Sent) ~> (call[c] \in Settled)

\* At the relay: no report is handed to a request the agent already
\* canceled.
NoReportLost == \A c \in Calls : call[c] # "void"

\* At the agent, at least once: a report the client took and that is
\* handed back says, when delivered again, that it may repeat one already
\* seen.
RepeatsMarked ==
    \A c \in Calls :
        (answered[c] = "taken" /\ call[c] = "returned") => marked[c]

\* The report of call c is handed back to the editor, or the socket it was
\* sent on closed, which ends the session (bridge.ts).
HandedBackOrEnded(c) ==
    \/ call[c] = "returned"
    \/ /\ on[c] # NoSocket
       /\ sock[on[c]] # "open"

\* At the agent: a report the client dropped is handed back to the editor,
\* unless the socket closed first. (A `read` takes no report; every call here
\* is a report.)
DroppedHandedBack ==
    \A c \in Calls :
        (answered[c] = "dropped" /\ call[c] # "rejected")
            ~> HandedBackOrEnded(c)

================================================================================
