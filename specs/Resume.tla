---- MODULE Resume -------------------------------------------------------------
(******************************************************************************)
(* Resuming a session after the agent disconnects or the window reloads       *)
(* (#25). A session the agent disconnects from is suspended, not ended: it    *)
(* keeps its turn, cursor, directory, and history, in memory, and in the      *)
(* workspace's storage for a reload. A `start` from its directory resumes it; *)
(* a `start` from another directory ends it, and starts a new one. Otherwise  *)
(* it waits until the programmer ends it from the panel, which closes it at   *)
(* once. Each step saves the session as it leaves it, where the code saves    *)
(* 200 ms after the last change and again as the window goes.                 *)
(******************************************************************************)
EXTENDS Naturals, PairDefs

CONSTANTS
    Directories, \* the directories an agent may start from
    MaxSessions, \* how many sessions the model starts
    PostOnRevive \* TRUE: `revive` tells the panel the session is suspended (the
                 \* fix of #138)

ASSUME AssumeDirectories == Directories # {}
ASSUME AssumeMaxSessions == MaxSessions \in Nat
ASSUME AssumePostOnRevive == PostOnRevive \in BOOLEAN

\* No directory: no session has started. Any value that is not a directory
\* will do, so the config makes it a model value (6.20).
NoDirectory == CHOOSE v : v \notin Directories

VARIABLES
    session,        \* the window's session, one of SessionPhases, or NoSession
    id,             \* which session it is: a new one gets a new id
    directory,      \* its working directory, or NoDirectory
    connected,      \* an agent's relay is connected, and drives the session if
                    \* one is active
    messageWaiting, \* a message from the programmer the agent hasn't been sent
                    \* yet
    shown,          \* what the panel shows, one of Views
    stored          \* what the workspace's storage holds: the session as of its
                    \* last change

vars == <<session, id, directory, connected, messageWaiting, shown, stored>>

--------------------------------------------------------------------------------

\* The values each variable can hold.
TypeOK ==
    /\ session \in SessionPhases \cup {NoSession}
    /\ id \in Nat
    /\ directory \in Directories \cup {NoDirectory}
    /\ connected \in BOOLEAN
    /\ messageWaiting \in BOOLEAN
    /\ shown \in Views
    /\ stored \in [session : SessionPhases \cup {NoSession}, id : Nat,
                  directory : Directories \cup {NoDirectory}, messageWaiting
                      : BOOLEAN, shown : Views]

\* The session as the extension writes it to the workspace's storage.
Snapshot(s, i, d, p, v) ==
    [session |-> s, id |-> i, directory |-> d, messageWaiting |-> p,
     shown |-> v]

\* The extension writes the session to the workspace's storage, on every
\* change to it: s, i, d, p, and v are its new phase, id, directory,
\* message, and view.
Store(s, i, d, p, v) == stored' = Snapshot(s, i, d, p, v)

\* What the panel shows for a session in phase s.
Shows(s) ==
    CASE s = "active" -> "live"
      [] s = "suspended" -> "suspended"
      [] OTHER -> "off"

--------------------------------------------------------------------------------

Init ==
    /\ session = NoSession
    /\ id = 0
    /\ directory = NoDirectory
    /\ connected = FALSE
    /\ messageWaiting = FALSE
    /\ shown = "off"
    /\ stored = Snapshot(NoSession, 0, NoDirectory, FALSE, "off")

\* An agent's relay connects.
Connect ==
    /\ ~connected
    /\ connected' = TRUE
    /\ UNCHANGED <<session, id, directory, messageWaiting, shown, stored>>

\* The agent's harness exits and the socket closes. A disconnect suspends an
\* active session: nothing ends it but the programmer, or another session. It
\* closes a session the programmer ended.
Disconnect ==
    LET newSession ==
            CASE session = "active" -> "suspended"
              [] session = "ended" -> NoSession
              [] OTHER -> session
        newShown == IF session = "active" THEN "suspended" ELSE shown
    IN  /\ connected
        /\ session' = newSession
        /\ connected' = FALSE
        /\ shown' = newShown
        /\ Store(newSession, id, directory, messageWaiting, newShown)
        /\ UNCHANGED <<id, directory, messageWaiting>>

\* The window reloads: the extension starts again from the workspace's
\* storage, with no relay connected, and a session it had comes back
\* suspended. With PostOnRevive, the panel is told so.
ReloadWindow ==
    LET newSession ==
            IF stored.session \in {"active", "suspended"}
            THEN "suspended"
            ELSE NoSession
        newShown ==
            IF PostOnRevive /\ newSession = "suspended"
            THEN "suspended"
            ELSE stored.shown
    IN  /\ session' = newSession
        /\ id' = stored.id
        /\ directory' = stored.directory
        /\ connected' = FALSE
        /\ messageWaiting' = stored.messageWaiting
        /\ shown' = newShown
        /\ Store(newSession, stored.id, stored.directory,
                 stored.messageWaiting, newShown)

\* The agent's `start` from directory d, with no session active: a suspended
\* session from d resumes, the same session; any other start starts a new
\* one, ending a suspended one.
Start(d) ==
    LET resumes == session = "suspended" /\ directory = d
        newId == IF resumes THEN id ELSE id + 1
        newMessage == IF resumes THEN messageWaiting ELSE FALSE
    IN  /\ connected
        /\ session # "active"
        /\ session' = "active"
        /\ id' = newId
        /\ directory' = d
        /\ messageWaiting' = newMessage
        /\ shown' = "live"
        /\ Store("active", newId, d, newMessage, "live")
        /\ UNCHANGED connected

\* The programmer ends the session from the panel. An active one ends, and its
\* agent's next call closes it; a suspended one has no agent to tell, so it
\* closes at once.
EndByProgrammer ==
    LET newSession == IF session = "active" THEN "ended" ELSE NoSession
    IN  /\ session \in {"active", "suspended"}
        /\ session' = newSession
        /\ messageWaiting' = FALSE
        /\ shown' = "off"
        /\ Store(newSession, id, directory, FALSE, "off")
        /\ UNCHANGED <<id, directory, connected>>

\* The agent's next call takes the ended session's last report, which closes
\* it.
CloseEnded ==
    /\ connected
    /\ session = "ended"
    /\ session' = NoSession
    /\ Store(NoSession, id, directory, messageWaiting, shown)
    /\ UNCHANGED <<id, directory, connected, messageWaiting, shown>>

\* The agent's `end`.
EndByAgent ==
    /\ connected
    /\ session = "active"
    /\ session' = NoSession
    /\ messageWaiting' = FALSE
    /\ shown' = "off"
    /\ Store(NoSession, id, directory, FALSE, "off")
    /\ UNCHANGED <<id, directory, connected>>

\* A message from the panel, to an active or a suspended session.
SendMessage ==
    /\ session \in {"active", "suspended"}
    /\ ~messageWaiting
    /\ messageWaiting' = TRUE
    /\ Store(session, id, directory, TRUE, shown)
    /\ UNCHANGED <<session, id, directory, connected, shown>>

\* A report takes the message to the agent, once it is back.
Report ==
    /\ connected
    /\ session = "active"
    /\ messageWaiting
    /\ messageWaiting' = FALSE
    /\ Store(session, id, directory, FALSE, shown)
    /\ UNCHANGED <<session, id, directory, connected, shown>>

Next ==
    \/ Connect
    \/ Disconnect
    \/ ReloadWindow
    \/ \E d \in Directories : Start(d)
    \/ EndByProgrammer
    \/ CloseEnded
    \/ EndByAgent
    \/ SendMessage
    \/ Report

\* The agent's next call takes a pending message; the rest come when they do.
Fairness == WF_vars(Report)

Spec == Init /\ [][Next]_vars /\ Fairness

--------------------------------------------------------------------------------

\* The workspace's storage holds the session as it is, so a reload loses
\* nothing.
SavedIsCurrent == stored = Snapshot(session, id, directory, messageWaiting,
                                    shown)

\* The panel shows the session as it is: never a suspended session as live, so
\* no message is sent to an agent that isn't there without the programmer
\* knowing (#138).
ShownIsState == shown = Shows(session)

\* A session the programmer ended waits only for its agent's last report: it
\* always has an agent to take it, or it is closed.
EndedHasAgent == (session = "ended") => connected

\* A start from a suspended session's directory resumes that session: the
\* same id.
ResumesSameProp ==
    [][(session = "suspended" /\ session' = "active"
        /\ directory' = directory) =>
           (id' = id)]_vars

\* A suspended session waits: it leaves that phase only to resume, to close
\* when the programmer ends it, or for a session from another directory. Only
\* EndByProgrammer leaves it for no session, so the property names it: no
\* state tells the programmer's end from a session lost some other way.
WaitsProp ==
    [][(session = "suspended" /\ session' # "suspended") =>
           \/ EndByProgrammer
           \/ session' = "active" /\ (id' = id \/ directory' # directory)]_vars

\* A message is dropped only with its session: not while it's suspended, nor
\* across a reload.
NotLostProp ==
    [][(messageWaiting /\ ~messageWaiting') =>
           \/ session = "active" /\ connected
           \/ session' \in {"ended", NoSession}
           \/ id' # id]_vars

\* A message the agent can be sent, while the session is active with a relay,
\* reaches it. Code that never sent it would fail it, so it says something
\* must happen.
Arrives ==
    (messageWaiting /\ connected /\ session = "active") ~>
        (~messageWaiting \/ ~connected \/ session # "active")

\* Sessions run out only so that the model is finite (6.8). It prunes exactly
\* the states a guard `id < MaxSessions` on a new session never reached, so the
\* behaviors, and Arrives' result, are the guard's (8.6).
Constraint == id <= MaxSessions

================================================================================
