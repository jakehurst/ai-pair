------------------------------ MODULE Discovery ------------------------------
\* Discovery files and window choice: writeDiscovery and dispose in
\* packages/core/src/bridge.ts, findWindows and open in packages/relay/src/link.ts.
EXTENDS Naturals

CONSTANTS
    W,           \* how many editor windows, all with the agent's folder open
    Junk,        \* TRUE: a file with a live pid but no workspaceFolders is in the folder
    CheckFiles,  \* TRUE: findWindows skips a file whose fields aren't a Discovery (fix for #31)
    AtomicWrite  \* TRUE: writeDiscovery replaces the file in one rename, so it is never half written

Windows == 1..W

VARIABLES
    win,     \* each window: "none", "open", "writing" (open, its file truncated and not yet
             \* rewritten), "closed" (file removed), "crashed" (file left, pid dead), "reused"
             \* (file left, pid alive again, nothing on the port)
    relay,   \* "idle", "trying", "connected", "no_editor", "internal" (findWindows threw)
    tries,   \* the candidates open() hasn't tried yet
    conn     \* the window the relay connected to, or 0

vars == <<win, relay, tries, conn>>

Set(f, x, v) == [f EXCEPT ![x] = v]

Init ==
    /\ win = [w \in Windows |-> "none"]
    /\ relay = "idle" /\ tries = {} /\ conn = 0

\* findWindows reads it: a file being written doesn't parse, and is skipped.
Alive(w) == win[w] \in {"open", "reused"}
Running(w) == win[w] \in {"open", "writing"}

\* A window starts, or reopens with a new pid: writeDiscovery.
OpenW(w) == win[w] \in {"none", "closed"} /\ win' = Set(win, w, "open") /\ UNCHANGED <<relay, tries, conn>>

\* A clean close: dispose() removes the file.
CloseW(w) == win[w] = "open" /\ win' = Set(win, w, "closed") /\ UNCHANGED <<relay, tries, conn>>

\* The window gains focus: focused() → writeDiscovery. writeFileSync truncates the file, then
\* writes it; a rename replaces it whole.
Focus(w) ==
    /\ win[w] = "open" /\ ~AtomicWrite /\ win' = Set(win, w, "writing")
    /\ UNCHANGED <<relay, tries, conn>>
Written(w) == win[w] = "writing" /\ win' = Set(win, w, "open") /\ UNCHANGED <<relay, tries, conn>>

\* A crash: the file stays behind, and its pid is dead.
Crash(w) == win[w] = "open" /\ win' = Set(win, w, "crashed") /\ UNCHANGED <<relay, tries, conn>>

\* Another process gets the crashed window's pid, so alive(pid) says yes.
Reuse(w) == win[w] = "crashed" /\ win' = Set(win, w, "reused") /\ UNCHANGED <<relay, tries, conn>>

Start ==
    /\ relay \in {"idle", "no_editor", "internal"}
    /\ IF Junk /\ ~CheckFiles
          THEN relay' = "internal" /\ tries' = {}
          ELSE LET cand == {w \in Windows : Alive(w)} IN
               /\ relay' = IF cand = {} THEN "no_editor" ELSE "trying"
               /\ tries' = cand
    /\ UNCHANGED <<win, conn>>

Try(w) ==
    /\ relay = "trying" /\ w \in tries
    /\ IF Running(w)
          THEN relay' = "connected" /\ conn' = w /\ tries' = {}
          ELSE /\ tries' = tries \ {w}
               /\ relay' = IF tries \ {w} = {} THEN "no_editor" ELSE "trying"
               /\ UNCHANGED conn
    /\ UNCHANGED win

Disconnect ==
    /\ relay = "connected" /\ ~Running(conn)
    /\ relay' = "idle" /\ conn' = 0
    /\ UNCHANGED <<win, tries>>

Next ==
    \/ \E w \in Windows : OpenW(w) \/ CloseW(w) \/ Crash(w) \/ Reuse(w) \/ Try(w) \/ Focus(w) \/ Written(w)
    \/ Start \/ Disconnect

Fairness ==
    /\ WF_vars(Start) /\ WF_vars(Disconnect) /\ \A w \in Windows : WF_vars(Try(w)) /\ WF_vars(Written(w))

Spec == Init /\ [][Next]_vars /\ Fairness

\* #31: looking up the windows never throws.
NoInternal == relay # "internal"

\* A window that is running is found: findWindows never says there is none while one runs.
FindsRunning == [][Start /\ relay' = "no_editor" => ~\E w \in Windows : Running(w)]_vars

\* The relay connects only to a window that answered: one that was open.
ConnectedToOpen == relay = "connected" => conn # 0

\* L-Discovery: while one window stays open, a relay that keeps calling start keeps finding one.
FindsOpen == (\E w \in Windows : <>[](win[w] = "open")) => []<>(relay = "connected")

==============================================================================
