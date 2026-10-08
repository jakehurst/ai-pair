-------------------------------- MODULE Resume --------------------------------
\* Resuming a session after the agent disconnects or the window reloads (#25). A session the
\* agent disconnects from is suspended, not ended: it keeps its turn, cursor, directory, and
\* history, in memory, and in the workspace's storage for a reload. A `start` from its directory
\* resumes it; a `start` from another directory ends it, and starts a new one. Otherwise it waits
\* until the programmer ends it from the panel.
EXTENDS Naturals

CONSTANTS
    Dirs,      \* the directories an agent may start from
    MaxIds     \* how many sessions a run starts, at most

VARIABLES
    state,     \* the window's session: "none", "active", "suspended", "ended" (by the programmer)
    id,        \* which session it is: a new one gets a new id
    dir,       \* its working directory
    conn,      \* an agent's relay is connected, and drives the session if one is active
    pending,   \* a message from the programmer the agent hasn't been sent yet
    saved      \* what the workspace's storage holds: the session as of its last change

vars == <<state, id, dir, conn, pending, saved>>

\* The session as the extension writes it to the workspace's storage, on every change to it.
Snapshot(s, i, d, p) == [state |-> s, id |-> i, dir |-> d, pending |-> p]
Save == saved' = Snapshot(state', id', dir', pending')

Init ==
    /\ state = "none" /\ id = 0 /\ dir = "none" /\ conn = FALSE /\ pending = FALSE
    /\ saved = Snapshot("none", 0, "none", FALSE)

\* An agent's relay connects, or its harness exits and the socket closes. A disconnect suspends
\* the session: nothing ends it but the programmer, or another session.
Connect == ~conn /\ conn' = TRUE /\ UNCHANGED <<state, id, dir, pending, saved>>
Disconnect ==
    /\ conn /\ conn' = FALSE
    /\ state' = IF state = "active" THEN "suspended" ELSE state
    /\ UNCHANGED <<id, dir, pending>> /\ Save

\* The window reloads: the extension starts again from the workspace's storage, with no relay
\* connected, and a session it had comes back suspended.
Reload ==
    /\ conn' = FALSE
    /\ state' = IF saved.state \in {"active", "suspended"} THEN "suspended" ELSE "none"
    /\ id' = saved.id /\ dir' = saved.dir /\ pending' = saved.pending
    /\ Save

\* The agent's `start` from directory d: a suspended session from d resumes, the same session; any
\* other start, with no session active, starts a new one, ending a suspended one.
Start(d) ==
    /\ conn /\ state # "active"
    /\ IF state = "suspended" /\ dir = d
          THEN state' = "active" /\ UNCHANGED <<id, dir, pending>>
          ELSE id < MaxIds /\ id' = id + 1 /\ dir' = d /\ state' = "active" /\ pending' = FALSE
    /\ UNCHANGED conn /\ Save

\* The programmer ends the session from the panel, active or suspended; or the agent's `end`.
ProgrammerEnd ==
    /\ state \in {"active", "suspended"} /\ state' = "ended" /\ pending' = FALSE
    /\ UNCHANGED <<id, dir, conn>> /\ Save
AgentEnd ==
    /\ conn /\ state = "active" /\ state' = "none" /\ pending' = FALSE
    /\ UNCHANGED <<id, dir, conn>> /\ Save

\* A message from the panel, to an active or a suspended session; a report takes it to the agent.
Message ==
    /\ state \in {"active", "suspended"} /\ ~pending /\ pending' = TRUE
    /\ UNCHANGED <<state, id, dir, conn>> /\ Save
Report ==
    /\ conn /\ state = "active" /\ pending /\ pending' = FALSE
    /\ UNCHANGED <<state, id, dir, conn>> /\ Save

Next ==
    \/ Connect \/ Disconnect \/ Reload \/ \E d \in Dirs : Start(d)
    \/ ProgrammerEnd \/ AgentEnd \/ Message \/ Report

Spec == Init /\ [][Next]_vars /\ WF_vars(Report)

\* The workspace's storage holds the session as it is, so a reload loses nothing.
SavedIsCurrent == saved = Snapshot(state, id, dir, pending)

\* A start from a suspended session's directory resumes that session: the same id.
ResumesSame == [][state = "suspended" /\ state' = "active" /\ dir' = dir => id' = id]_vars

\* A suspended session waits: it leaves that state only to resume, to end by the programmer, or
\* for a session from another directory.
Waits == [][
    state = "suspended" /\ state' # "suspended" =>
        state' = "ended" \/ (state' = "active" /\ (id' = id \/ dir' # dir))]_vars

\* A message is dropped only with its session: not while it's suspended, nor across a reload.
NotLost == [][
    pending /\ ~pending' => (state = "active" /\ conn) \/ state' \in {"ended", "none"} \/ id' # id]_vars

\* A message the agent can be sent, while the session is active with a relay, reaches it.
Arrives == (pending /\ conn /\ state = "active") ~> (~pending \/ ~conn \/ state # "active")

=============================================================================
