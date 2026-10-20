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
    NumSockets,       \* how many sockets the relay may open in a run
    NumCalls,         \* how many calls the agent makes, at most
    RejectPerSocket,        \* TRUE: a close rejects only its own socket's calls
                            \* (the
                      \* fix for #3)
    GuardedParse,     \* TRUE: a frame that is not a message (not JSON, or no
                      \* message schema fits it, #163) is dropped (#4)
    CheckAbort,       \* TRUE: call() checks signal.aborted after connect(),
                      \* before sending (#29)
    WaitForReturn,    \* TRUE: call() sends only once the socket's canceled
                      \* calls are answered (#59)
    HandBackAnswered, \* TRUE: a cancel that reaches the relay after it
                      \* answered hands the report back (#67)
    MarkRepeats,      \* TRUE: the report handed back is marked as possibly
                      \* seen, so its next delivery says it may repeat (#67)
    CloseAfterShutdown \* TRUE: after the shutdown, the link opens no socket,
                       \* and closes one the editor welcomes then (#163)

ASSUME AssumeMaxSockets == NumSockets \in Nat \ {0}
ASSUME AssumeMaxCalls == NumCalls \in Nat \ {0}
ASSUME AssumePerSocket == RejectPerSocket \in BOOLEAN
ASSUME AssumeGuardedParse == GuardedParse \in BOOLEAN
ASSUME AssumeCheckAbort == CheckAbort \in BOOLEAN
ASSUME AssumeWaitForReturn == WaitForReturn \in BOOLEAN
ASSUME AssumeHandBackAnswered == HandBackAnswered \in BOOLEAN
ASSUME AssumeMarkRepeats == MarkRepeats \in BOOLEAN
ASSUME AssumeCloseAfterShutdown == CloseAfterShutdown \in BOOLEAN

\* The sockets the relay may open, in the order it opens them.
Sockets == 1..NumSockets

\* The agent's calls.
CallIds == 1..NumCalls

\* No socket: none open for calls to go out on, or none a call was sent on or
\* rejected by. Any value that is not a socket will do, so the config makes it
\* a model value (6.20).
NoSocket == CHOOSE v : v \notin Sockets

\* The states of a socket.
SocketStates == {"unused", "connecting", "open", "closing", "closed"}

\* A call is "idle", then "requested" while call() awaits connect(), or
\* "requestedCanceled" once the relay handled its cancel then; then sent, in
\* one of Sent; then settled, in one of Settled. One canceled before it was
\* sent, and never sent, is "canceled".
Unsent == {"idle", "requested", "requestedCanceled", "canceled"}

\* The states of a sent call waiting for its answer.
Sent == {"awaitingAnswer", "pendingNoticed", "pendingMissed"}

\* The answers: "result", "returned" (handed back with `return`), "void"
\* (handed to a request the agent canceled), or "severed" (by a close).
Settled == {"result", "returned", "void", "severed"}

\* The states of a call.
CallStates == Unsent \cup Sent \cup Settled

VARIABLES
    socketState,       \* each socket's state, in SocketStates
    activeSocket,        \* this.ws: the open socket calls go out on, or
                         \* NoSocket
    pc,         \* where each call is, in CallStates
    sentOn,         \* the socket each call was sent on, or NoSocket
    awaitingAnswer,    \* the calls waiting for an answer, each in the `calls`
                       \* map of
                \* the socket it went out on
    severedBy,  \* the socket whose close severed the call, or NoSocket
    garbageSent,    \* whether the frame that is not a message has been sent yet
    relayUp,    \* FALSE once an uncaught exception has ended the relay
    canceled,    \* the agent's MCP client canceled the call: it drops any
                \* answer from then on
    cancelNoticed,    \* the relay has handled the client's
                \* `notifications/cancelled` for it
    answerAtClient,   \* the relay's answer reached the client: "unanswered",
                \* "taken", or "dropped"
    mayRepeat,  \* the report was handed back as possibly seen (`mayRepeat`)
    serving     \* TRUE until the harness ends the relay's stdin (#163)

vars ==
    <<socketState, activeSocket, pc, sentOn, awaitingAnswer, severedBy,
      garbageSent, relayUp, canceled, cancelNoticed, answerAtClient, mayRepeat,
      serving>>

\* The relay's variables, which the client's own steps leave alone.
relayVars ==
    <<socketState, activeSocket, pc, sentOn, awaitingAnswer, severedBy,
      garbageSent, relayUp, serving>>

--------------------------------------------------------------------------------

\* The values each variable can hold.
TypeOK ==
    /\ socketState \in [Sockets -> SocketStates]
    /\ activeSocket \in Sockets \cup {NoSocket}
    /\ pc \in [CallIds -> CallStates]
    /\ sentOn \in [CallIds -> Sockets \cup {NoSocket}]
    /\ awaitingAnswer \subseteq CallIds
    /\ severedBy \in [CallIds -> Sockets \cup {NoSocket}]
    /\ garbageSent \in BOOLEAN
    /\ relayUp \in BOOLEAN
    /\ canceled \in [CallIds -> BOOLEAN]
    /\ cancelNoticed \in [CallIds -> BOOLEAN]
    /\ answerAtClient \in [CallIds -> {"unanswered", "taken", "dropped"}]
    /\ mayRepeat \in [CallIds -> BOOLEAN]
    /\ serving \in BOOLEAN

\* A call sent on socket s was canceled, the relay sent its cancel, and its
\* answer has not come: a `return` for it may be on its way.
AwaitsReturn(s) == \E d \in awaitingAnswer
                   : sentOn[d] = s /\ pc[d] = "pendingNoticed"

\* The calls the close of socket s rejects: with PerSocket, only those sent on
\* it; before #3, every call waiting.
Victims(s) == IF RejectPerSocket THEN {c \in awaitingAnswer : sentOn[c] = s}
              ELSE awaitingAnswer

--------------------------------------------------------------------------------

Init ==
    /\ socketState = [s \in Sockets |-> "unused"]
    /\ activeSocket = NoSocket
    /\ pc = [c \in CallIds |-> "idle"]
    /\ sentOn = [c \in CallIds |-> NoSocket]
    /\ awaitingAnswer = {}
    /\ severedBy = [c \in CallIds |-> NoSocket]
    /\ garbageSent = FALSE
    /\ relayUp = TRUE
    /\ canceled = [c \in CallIds |-> FALSE]
    /\ cancelNoticed = [c \in CallIds |-> FALSE]
    /\ answerAtClient = [c \in CallIds |-> "unanswered"]
    /\ mayRepeat = [c \in CallIds |-> FALSE]
    /\ serving = TRUE

\* connect() opens a socket when none is open, one attempt at a time. The
\* sockets are alike, so they open in order, which drops only copies of the
\* same runs.
OpenSocket(s) ==
    /\ relayUp
    /\ CloseAfterShutdown => serving
    /\ activeSocket = NoSocket
    /\ \A t \in Sockets : socketState[t] # "connecting"
    /\ socketState[s] = "unused"
    /\ \A t \in 1..(s - 1) : socketState[t] # "unused"
    /\ socketState' = [socketState EXCEPT ![s] = "connecting"]
    /\ UNCHANGED <<activeSocket, pc, sentOn, awaitingAnswer, severedBy,
                   garbageSent, relayUp>>
    /\ UNCHANGED <<canceled, cancelNoticed, answerAtClient, mayRepeat, serving>>

\* The editor's `welcome`: the socket is open, and calls go out on it. After
\* the shutdown, with CloseAfterShutdown, the link closes it instead.
Welcome(s) ==
    LET closes == ~serving /\ CloseAfterShutdown
    IN  /\ relayUp
        /\ socketState[s] = "connecting"
        /\ socketState' = [socketState EXCEPT ![s] = IF closes THEN "closing"
                                                     ELSE "open"]
        /\ activeSocket' = IF closes THEN activeSocket ELSE s
        /\ UNCHANGED <<pc, sentOn, awaitingAnswer, severedBy, garbageSent,
                       relayUp>>
        /\ UNCHANGED <<canceled, cancelNoticed, answerAtClient, mayRepeat,
                       serving>>

\* The agent calls a tool: call() starts, and awaits connect().
Request(c) ==
    /\ relayUp
    /\ serving
    /\ pc[c] = "idle"
    /\ pc' = [pc EXCEPT ![c] = "requested"]
    /\ UNCHANGED <<socketState, activeSocket, sentOn, awaitingAnswer,
                   severedBy, garbageSent, relayUp>>
    /\ UNCHANGED <<canceled, cancelNoticed, answerAtClient, mayRepeat, serving>>

\* The agent's client cancels: from now on it drops any answer to the call
\* (the SDK deletes its response handler), and it sends
\* `notifications/cancelled`. The SDK never removes its abort listener, so a
\* signal aborted after the answer was taken sends one too (protocol.js,
\* request()).
AbortInClient(c) ==
    /\ relayUp
    /\ pc[c] # "idle"
    /\ ~canceled[c]
    /\ canceled' = [canceled EXCEPT ![c] = TRUE]
    /\ UNCHANGED relayVars
    /\ UNCHANGED <<cancelNoticed, answerAtClient, mayRepeat>>

\* The relay handles the notification: the abort listener marks a sent call;
\* before it is sent, the listener is not there yet, and nothing does. After
\* the relay answered, the SDK has nothing to abort; with HandBackAnswered
\* the relay hands the report back with `return`, and with MarkRepeats marks
\* it as possibly seen. Abort happens once for each call, so mayRepeat[c] is
\* FALSE until then. The editor's side is Bridge's `Restore` and
\* Controller's `Bounce`, `BounceLate`, and `Restore`.
Abort(c) ==
    LET handBack ==
            /\ pc[c] = "result"
            /\ HandBackAnswered
            /\ socketState[sentOn[c]] = "open"
        noticedState ==
            CASE pc[c] = "requested" -> "requestedCanceled"
              [] pc[c] = "awaitingAnswer" -> "pendingNoticed"
              [] handBack -> "returned"
              [] OTHER -> pc[c]
    IN  /\ relayUp
        /\ canceled[c]
        /\ ~cancelNoticed[c]
        /\ pc' = [pc EXCEPT ![c] = noticedState]
        /\ cancelNoticed' = [cancelNoticed EXCEPT ![c] = TRUE]
        /\ mayRepeat' = [mayRepeat EXCEPT ![c] = handBack /\ MarkRepeats]
        /\ UNCHANGED <<socketState, activeSocket, sentOn, awaitingAnswer,
                       severedBy, garbageSent, relayUp>>
        /\ UNCHANGED <<canceled, answerAtClient, serving>>

\* The relay's answer reaches the client, which takes it unless it canceled
\* the call.
Deliver(c) ==
    /\ pc[c] \in Settled
    /\ answerAtClient[c] = "unanswered"
    /\ answerAtClient' =
           [answerAtClient EXCEPT ![c] = IF canceled[c] THEN "dropped"
                                         ELSE "taken"]
    /\ UNCHANGED relayVars
    /\ UNCHANGED <<canceled, cancelNoticed, mayRepeat>>

\* call() sends the call on the open socket that connect() returned, once no
\* canceled call on it waits for its answer (#59): then a `return` for it
\* went out first. With CheckAbort, a call canceled meanwhile is not sent
\* (#29); without it, the call goes out with no abort listener to mark it.
Send(c) ==
    LET sentState ==
            IF pc[c] = "requested" THEN "awaitingAnswer" ELSE "pendingMissed"
    IN  /\ relayUp
        /\ activeSocket # NoSocket
        /\ pc[c] \in {"requested", "requestedCanceled"}
        /\ WaitForReturn => ~AwaitsReturn(activeSocket)
        /\ IF pc[c] = "requestedCanceled" /\ CheckAbort
           THEN /\ pc' = [pc EXCEPT ![c] = "canceled"]
                /\ UNCHANGED <<sentOn, awaitingAnswer>>
           ELSE /\ pc' = [pc EXCEPT ![c] = sentState]
                /\ sentOn' = [sentOn EXCEPT ![c] = activeSocket]
                /\ awaitingAnswer' = awaitingAnswer \cup {c}
        /\ UNCHANGED <<socketState, activeSocket, severedBy, garbageSent,
                       relayUp>>
        /\ UNCHANGED <<canceled, cancelNoticed, answerAtClient, mayRepeat,
                       serving>>

\* locate() closes this.ws to switch windows, or the editor's end closes the
\* socket: calls no longer go out on it.
CloseSocket(s) ==
    /\ relayUp
    /\ socketState[s] = "open"
    /\ socketState' = [socketState EXCEPT ![s] = "closing"]
    /\ activeSocket' = IF activeSocket = s THEN NoSocket ELSE activeSocket
    /\ UNCHANGED <<pc, sentOn, awaitingAnswer, severedBy, garbageSent, relayUp>>
    /\ UNCHANGED <<canceled, cancelNoticed, answerAtClient, mayRepeat, serving>>

\* The socket's `close` handler rejects its Victims.
HandleClose(s) ==
    LET victims == Victims(s)
    IN  /\ relayUp
        /\ socketState[s] = "closing"
        /\ socketState' = [socketState EXCEPT ![s] = "closed"]
        /\ pc' =
               [c \in CallIds |-> IF c \in victims THEN "severed" ELSE pc[c]]
        /\ awaitingAnswer' = awaitingAnswer \ victims
        /\ severedBy' =
               [c \in CallIds |-> IF c \in victims THEN s ELSE severedBy[c]]
        /\ UNCHANGED <<activeSocket, sentOn, garbageSent, relayUp>>
        /\ UNCHANGED <<canceled, cancelNoticed, answerAtClient, mayRepeat,
                       serving>>

\* A `result` frame for a call on an open socket: the result, or for a call
\* the relay marked canceled, a `return` that hands the report back. A call
\* sent after its cancel, unmarked, resolves a request the agent canceled.
\* The `return` goes to Bridge's `Restore`, and the report to Controller's.
Reply(c) ==
    LET answer ==
            CASE pc[c] = "pendingNoticed" -> "returned"
              [] pc[c] = "pendingMissed" -> "void"
              [] OTHER -> "result"
    IN  /\ relayUp
        /\ c \in awaitingAnswer
        /\ socketState[sentOn[c]] = "open"
        /\ pc' = [pc EXCEPT ![c] = answer]
        /\ awaitingAnswer' = awaitingAnswer \ {c}
        /\ UNCHANGED <<socketState, activeSocket, sentOn, severedBy,
                       garbageSent, relayUp>>
        /\ UNCHANGED <<canceled, cancelNoticed, answerAtClient, mayRepeat,
                       serving>>

\* The other side sends a frame that is not a message: parseEditorMessage
\* finds no message schema in @ai-pair/protocol that it fits (#163).
\* With GuardedParse it is dropped, and before the welcome the socket is
\* closed, as whatever is on the port is not the editor; without it, the
\* uncaught exception ends the relay (#4).
SendGarbage(s) ==
    /\ relayUp
    /\ ~garbageSent
    /\ socketState[s] \in {"connecting", "open"}
    /\ socketState' = IF GuardedParse /\ socketState[s] = "connecting"
               THEN [socketState EXCEPT ![s] = "closing"]
               ELSE socketState
    /\ garbageSent' = TRUE
    /\ relayUp' = GuardedParse
    /\ UNCHANGED <<activeSocket, pc, sentOn, awaitingAnswer, severedBy>>
    /\ UNCHANGED <<canceled, cancelNoticed, answerAtClient, mayRepeat, serving>>

\* The editor answers the hello with `rejected` (a wrong token, or another
\* protocol version) and closes its end (bridge.ts): the connect fails, and
\* the socket closes without a welcome.
RejectHello(s) ==
    /\ relayUp
    /\ socketState[s] = "connecting"
    /\ socketState' = [socketState EXCEPT ![s] = "closing"]
    /\ UNCHANGED <<activeSocket, pc, sentOn, awaitingAnswer, severedBy,
                   garbageSent, relayUp>>
    /\ UNCHANGED <<canceled, cancelNoticed, answerAtClient, mayRepeat, serving>>

\* The harness ends the relay's stdin, which is how it closes the relay:
\* serve() closes the server, so no call comes in, and closes the link, so
\* the open socket closes and no call goes out.
Shutdown ==
    /\ relayUp
    /\ serving
    /\ serving' = FALSE
    /\ socketState' =
           [s \in Sockets |-> IF socketState[s] = "open" THEN "closing"
                              ELSE socketState[s]]
    /\ activeSocket' = NoSocket
    /\ UNCHANGED <<pc, sentOn, awaitingAnswer, severedBy, garbageSent, relayUp>>
    /\ UNCHANGED <<canceled, cancelNoticed, answerAtClient, mayRepeat>>

\* The run ends once the model's sockets are used up, or the relay has
\* crashed, or it shut down and closed the sockets it opened, by design (6.13).
Finished ==
    /\ \/ ~relayUp
       \/ \A s \in Sockets :
              socketState[s] = "closed" \/ (~serving
                                            /\ socketState[s] = "unused")
    /\ UNCHANGED vars

Next ==
    \/ \E s \in Sockets : OpenSocket(s)
    \/ \E s \in Sockets : Welcome(s)
    \/ \E c \in CallIds : Request(c)
    \/ \E c \in CallIds : AbortInClient(c)
    \/ \E c \in CallIds : Abort(c)
    \/ \E c \in CallIds : Deliver(c)
    \/ \E c \in CallIds : Send(c)
    \/ \E s \in Sockets : CloseSocket(s)
    \/ \E s \in Sockets : HandleClose(s)
    \/ \E c \in CallIds : Reply(c)
    \/ \E s \in Sockets : SendGarbage(s)
    \/ \E s \in Sockets : RejectHello(s)
    \/ Shutdown
    \/ Finished

\* The editor welcomes, a closing socket's handler runs, the editor answers,
\* the relay handles each cancel, and each answer reaches the client.
Fairness ==
    /\ \A s \in Sockets : WF_vars(Welcome(s))
    /\ \A s \in Sockets : WF_vars(HandleClose(s))
    /\ \A c \in CallIds : WF_vars(Reply(c))
    /\ \A c \in CallIds : WF_vars(Abort(c))
    /\ \A c \in CallIds : WF_vars(Deliver(c))

Spec == Init /\ [][Next]_vars /\ Fairness

--------------------------------------------------------------------------------

\* A call is rejected by a socket's close only if it was sent on that
\* socket.
OwnCloseOnly == \A c \in CallIds : severedBy[c] \in {NoSocket, sentOn[c]}

\* No frame from the other side ends the relay.
RelayStaysUp == relayUp

\* A call sent by the relay eventually gets a result or a rejection. A
\* relay that never answered would fail it, so it says something must happen.
CallsAnswered == \A c \in CallIds : (pc[c] \in Sent) ~> (pc[c] \in Settled)

\* At the relay: no report is handed to a request the agent already
\* canceled.
NoReportLost == \A c \in CallIds : pc[c] # "void"

\* At the agent, at least once: a report the client took and that is
\* handed back says, when delivered again, that it may repeat one already
\* seen.
RepeatsMarked ==
    \A c \in CallIds :
        (answerAtClient[c] = "taken" /\ pc[c] = "returned") => mayRepeat[c]

\* The report of call c is handed back to the editor, or the socket it was
\* sent on closed, which ends the session (bridge.ts).
HandedBackOrEnded(c) ==
    \/ pc[c] = "returned"
    \/ /\ sentOn[c] # NoSocket
       /\ socketState[sentOn[c]] # "open"

\* At the agent: a report the client dropped is handed back to the editor,
\* unless the socket closed first. (A `read` takes no report; every call here
\* is a report.)
DroppedHandedBack ==
    \A c \in CallIds :
        (answerAtClient[c] = "dropped" /\ pc[c] # "severed")
            ~> HandedBackOrEnded(c)

\* After the harness ends the relay's stdin, every socket the relay opened
\* closes, so nothing keeps the process alive and it exits (#163). A relay
\* that left a socket open would fail it, so it says something must happen.
ExitsAfterShutdown ==
    ~serving ~> \A s \in Sockets : socketState[s] \in {"unused", "closed"}

================================================================================
