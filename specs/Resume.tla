---- MODULE Resume -------------------------------------------------------------
(******************************************************************************)
(* Resuming a session after the agent disconnects or the window reloads       *)
(* (#25). A session the agent disconnects from is suspended, not ended: it    *)
(* keeps its turn, cursor, directory, and history, in memory, and in the      *)
(* workspace's storage for a reload. A `start` from its directory resumes it; *)
(* a `start` from another directory ends it, and starts a new one. Otherwise  *)
(* it waits until the programmer ends it from the panel. Each step saves the  *)
(* session as it leaves it, where the code saves 200 ms after the last change *)
(* and again as the window goes.                                              *)
(******************************************************************************)
EXTENDS Naturals

CONSTANTS
    Dirs,           \* the directories an agent may start from
    MaxIds,         \* how many sessions the model starts
    PostOnRevive    \* TRUE: `revive` tells the panel the session is suspended
                    \* (the fix of #138)

ASSUME AssumeDirs == Dirs # {}
ASSUME AssumeMaxIds == MaxIds \in Nat
ASSUME AssumePostOnRevive == PostOnRevive \in BOOLEAN

\* The window's session: none, active, suspended, or ended by the programmer.
States == {"none", "active", "suspended", "ended"}

\* What the panel shows.
Views == {"off", "live", "suspended"}

\* No directory: no session has started. Any value that is not a directory
\* will do, so the config makes it a model value (6.20).
NoDir == CHOOSE v : v \notin Dirs

VARIABLES
    state,      \* the window's session, one of States
    id,         \* which session it is: a new one gets a new id
    dir,        \* its working directory, or NoDir
    conn,       \* an agent's relay is connected, and drives the session if
                \* one is active
    pending,    \* a message from the programmer the agent hasn't been sent yet
    shown,      \* what the panel shows, one of Views
    saved       \* what the workspace's storage holds: the session as of its
                \* last change

vars == <<state, id, dir, conn, pending, shown, saved>>

--------------------------------------------------------------------------------

\* The values each variable can hold.
TypeOK ==
    /\ state \in States
    /\ id \in Nat
    /\ dir \in Dirs \cup {NoDir}
    /\ conn \in BOOLEAN
    /\ pending \in BOOLEAN
    /\ shown \in Views
    /\ saved \in [state : States, id : Nat, dir : Dirs \cup {NoDir},
                  pending : BOOLEAN, shown : Views]

\* The session as the extension writes it to the workspace's storage.
Snapshot(s, i, d, p, v) ==
    [state |-> s, id |-> i, dir |-> d, pending |-> p, shown |-> v]

\* The extension writes the session to the workspace's storage, on every
\* change to it: s, i, d, p, and v are its new state, id, directory, pending
\* message, and view.
Save(s, i, d, p, v) == saved' = Snapshot(s, i, d, p, v)

\* What the panel shows for a session in state s.
Shows(s) ==
    CASE s = "active" -> "live"
      [] s = "suspended" -> "suspended"
      [] OTHER -> "off"

--------------------------------------------------------------------------------

Init ==
    /\ state = "none"
    /\ id = 0
    /\ dir = NoDir
    /\ conn = FALSE
    /\ pending = FALSE
    /\ shown = "off"
    /\ saved = Snapshot("none", 0, NoDir, FALSE, "off")

\* An agent's relay connects.
Connect ==
    /\ ~conn
    /\ conn' = TRUE
    /\ UNCHANGED <<state, id, dir, pending, shown, saved>>

\* The agent's harness exits and the socket closes. A disconnect suspends the
\* session: nothing ends it but the programmer, or another session.
Disconnect ==
    LET newState == IF state = "active" THEN "suspended" ELSE state
        newShown == IF state = "active" THEN "suspended" ELSE shown
    IN  /\ conn
        /\ state' = newState
        /\ conn' = FALSE
        /\ shown' = newShown
        /\ Save(newState, id, dir, pending, newShown)
        /\ UNCHANGED <<id, dir, pending>>

\* The window reloads: the extension starts again from the workspace's
\* storage, with no relay connected, and a session it had comes back
\* suspended. With PostOnRevive, the panel is told so.
Reload ==
    LET newState ==
            IF saved.state \in {"active", "suspended"}
            THEN "suspended"
            ELSE "none"
        newShown ==
            IF PostOnRevive /\ newState = "suspended"
            THEN "suspended"
            ELSE saved.shown
    IN  /\ state' = newState
        /\ id' = saved.id
        /\ dir' = saved.dir
        /\ conn' = FALSE
        /\ pending' = saved.pending
        /\ shown' = newShown
        /\ Save(newState, saved.id, saved.dir, saved.pending, newShown)

\* The agent's `start` from directory d, with no session active: a suspended
\* session from d resumes, the same session; any other start starts a new
\* one, ending a suspended one.
Start(d) ==
    LET resumes == state = "suspended" /\ dir = d
        newId == IF resumes THEN id ELSE id + 1
        newPending == IF resumes THEN pending ELSE FALSE
    IN  /\ conn
        /\ state # "active"
        /\ state' = "active"
        /\ id' = newId
        /\ dir' = d
        /\ pending' = newPending
        /\ shown' = "live"
        /\ Save("active", newId, d, newPending, "live")
        /\ UNCHANGED conn

\* The programmer ends the session from the panel, active or suspended.
EndByProgrammer ==
    /\ state \in {"active", "suspended"}
    /\ state' = "ended"
    /\ pending' = FALSE
    /\ shown' = "off"
    /\ Save("ended", id, dir, FALSE, "off")
    /\ UNCHANGED <<id, dir, conn>>

\* The agent's `end`.
EndByAgent ==
    /\ conn
    /\ state = "active"
    /\ state' = "none"
    /\ pending' = FALSE
    /\ shown' = "off"
    /\ Save("none", id, dir, FALSE, "off")
    /\ UNCHANGED <<id, dir, conn>>

\* A message from the panel, to an active or a suspended session.
SendMessage ==
    /\ state \in {"active", "suspended"}
    /\ ~pending
    /\ pending' = TRUE
    /\ Save(state, id, dir, TRUE, shown)
    /\ UNCHANGED <<state, id, dir, conn, shown>>

\* A report takes the message to the agent, once it is back.
Report ==
    /\ conn
    /\ state = "active"
    /\ pending
    /\ pending' = FALSE
    /\ Save(state, id, dir, FALSE, shown)
    /\ UNCHANGED <<state, id, dir, conn, shown>>

Next ==
    \/ Connect
    \/ Disconnect
    \/ Reload
    \/ \E d \in Dirs : Start(d)
    \/ EndByProgrammer
    \/ EndByAgent
    \/ SendMessage
    \/ Report

\* The agent's next call takes a pending message; the rest come when they do.
Fairness == WF_vars(Report)

Spec == Init /\ [][Next]_vars /\ Fairness

--------------------------------------------------------------------------------

\* The workspace's storage holds the session as it is, so a reload loses
\* nothing.
SavedIsCurrent == saved = Snapshot(state, id, dir, pending, shown)

\* The panel shows the session as it is: never a suspended session as live, so
\* no message is sent to an agent that isn't there without the programmer
\* knowing (#138).
ShownIsState == shown = Shows(state)

\* A start from a suspended session's directory resumes that session: the
\* same id.
ResumesSameProp ==
    [][(state = "suspended" /\ state' = "active" /\ dir' = dir) =>
           (id' = id)]_vars

\* A suspended session waits: it leaves that state only to resume, to end by
\* the programmer, or for a session from another directory.
WaitsProp ==
    [][(state = "suspended" /\ state' # "suspended") =>
           \/ state' = "ended"
           \/ state' = "active" /\ (id' = id \/ dir' # dir)]_vars

\* A message is dropped only with its session: not while it's suspended, nor
\* across a reload.
NotLostProp ==
    [][(pending /\ ~pending') =>
           \/ state = "active" /\ conn
           \/ state' \in {"ended", "none"}
           \/ id' # id]_vars

\* A message the agent can be sent, while the session is active with a relay,
\* reaches it. Code that never sent it would fail it, so it says something
\* must happen.
Arrives ==
    (pending /\ conn /\ state = "active") ~>
        (~pending \/ ~conn \/ state # "active")

\* Sessions run out only so that the model is finite (6.8). It prunes exactly
\* the states a guard `id < MaxIds` on a new session never reached, so the
\* behaviors, and Arrives' result, are the guard's (8.6).
Constraint == id <= MaxIds

================================================================================
