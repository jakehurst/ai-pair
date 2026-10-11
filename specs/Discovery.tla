---- MODULE Discovery ----------------------------------------------------------
(******************************************************************************)
(* Discovery files and the window a relay picks: writeDiscovery, focused, and *)
(* dispose in packages/core/src/bridge.ts, findWindows and open in            *)
(* packages/relay/src/link.ts. Every window has the agent's folder open.      *)
(* CheckFiles is the fix for #31: findWindows threw on a file that parsed but *)
(* was not a Discovery. AtomicWrite is the fix for #72: a window rewrites its *)
(* file each time it gains focus, and written in place, a relay reading it    *)
(* mid-write skipped it. A window whose write fails runs with no file, and no *)
(* relay can find it; the code reports the failure (`failed`).                *)
(******************************************************************************)
EXTENDS Naturals

CONSTANTS
    NumWindows, \* how many editor windows
    Junk,       \* TRUE: a file with a live pid but no workspaceFolders is in
                \* the folder
    CheckFiles, \* TRUE: findWindows skips a file whose fields are not a
                \* Discovery (the fix for #31)
    AtomicWrite \* TRUE: writeDiscovery replaces the file in one rename, so it
                \* is never half written (the fix for #72)

ASSUME AssumeNumWindows == NumWindows \in Nat
ASSUME AssumeJunk == Junk \in BOOLEAN
ASSUME AssumeCheckFiles == CheckFiles \in BOOLEAN
ASSUME AssumeAtomicWrite == AtomicWrite \in BOOLEAN

\* The windows.
Windows == 1..NumWindows

\* No window: the relay is not connected. Any value that is not a window will
\* do, so the config makes it a model value (6.20).
NoWindow == CHOOSE v : v \notin Windows

VARIABLES
    win,    \* each window: "none" (not started), "open", "writing" (open, its
            \* file truncated and not yet rewritten), "unlisted" (open, its
            \* file not written), "closed" (file removed), "crashed" (file
            \* left, pid dead), "reused" (file left, pid alive again, nothing
            \* on the port)
    relay,  \* "idle", "trying", "connected", "no_editor", "internal"
            \* (findWindows threw)
    tries,  \* the candidates open() has not tried yet
    conn    \* the window the relay connected to, or NoWindow

vars == <<win, relay, tries, conn>>

--------------------------------------------------------------------------------

\* The values each variable can hold.
TypeOK ==
    /\ win \in [Windows ->
                   {"none", "open", "writing", "unlisted", "closed", "crashed",
                    "reused"}]
    /\ relay \in {"idle", "trying", "connected", "no_editor", "internal"}
    /\ tries \subseteq Windows
    /\ conn \in Windows \cup {NoWindow}

\* findWindows lists the window: its file parses, and its pid is alive. A file
\* being written does not parse, and is skipped.
Alive(w) == win[w] \in {"open", "reused"}

\* The window runs, so its port answers.
Running(w) == win[w] \in {"open", "writing", "unlisted"}

\* The window runs and has a file.
HasFile(w) == win[w] \in {"open", "writing"}

--------------------------------------------------------------------------------

Init ==
    /\ win = [w \in Windows |-> "none"]
    /\ relay = "idle"
    /\ tries = {}
    /\ conn = NoWindow

\* A window starts, or reopens with a new pid: writeDiscovery, whose write may
\* fail.
OpenWindow(w) ==
    /\ win[w] \in {"none", "closed"}
    /\ \E s \in {"open", "unlisted"} : win' = [win EXCEPT ![w] = s]
    /\ UNCHANGED <<relay, tries, conn>>

\* A clean close: dispose() removes the file.
CloseWindow(w) ==
    /\ win[w] \in {"open", "unlisted"}
    /\ win' = [win EXCEPT ![w] = "closed"]
    /\ UNCHANGED <<relay, tries, conn>>

\* The window gains focus: focused() -> writeDiscovery. writeFileSync
\* truncates the file, then writes it. With AtomicWrite, a rename replaces it
\* whole, which changes nothing a relay can see, so Focus is not enabled.
Focus(w) ==
    /\ win[w] = "open"
    /\ ~AtomicWrite
    /\ win' = [win EXCEPT ![w] = "writing"]
    /\ UNCHANGED <<relay, tries, conn>>

\* The write that Focus began ends: the file is whole again.
FinishWrite(w) ==
    /\ win[w] = "writing"
    /\ win' = [win EXCEPT ![w] = "open"]
    /\ UNCHANGED <<relay, tries, conn>>

\* A later focus writes the file of a window that has none, and this time the
\* write succeeds.
ListWindow(w) ==
    /\ win[w] = "unlisted"
    /\ win' = [win EXCEPT ![w] = "open"]
    /\ UNCHANGED <<relay, tries, conn>>

\* A crash: the file stays behind, and its pid is dead.
Crash(w) ==
    /\ win[w] = "open"
    /\ win' = [win EXCEPT ![w] = "crashed"]
    /\ UNCHANGED <<relay, tries, conn>>

\* Another process gets the crashed window's pid, so alive(pid) says yes.
Reuse(w) ==
    /\ win[w] = "crashed"
    /\ win' = [win EXCEPT ![w] = "reused"]
    /\ UNCHANGED <<relay, tries, conn>>

\* The relay calls start: locate -> findWindows lists the candidates, or
\* throws on the junk file without CheckFiles.
Start ==
    /\ relay \in {"idle", "no_editor", "internal"}
    /\ IF Junk /\ ~CheckFiles
       THEN /\ relay' = "internal"
            /\ tries' = {}
       ELSE LET found == {w \in Windows : Alive(w)}
            IN  /\ relay' = IF found = {} THEN "no_editor" ELSE "trying"
                /\ tries' = found
    /\ UNCHANGED <<win, conn>>

\* open() tries one candidate: openWindow connects if the window runs, and
\* otherwise the next candidate is tried, until none is left.
Try(w) ==
    /\ relay = "trying"
    /\ w \in tries
    /\ IF Running(w)
       THEN /\ relay' = "connected"
            /\ tries' = {}
            /\ conn' = w
       ELSE /\ relay' = IF (tries \ {w}) = {} THEN "no_editor" ELSE "trying"
            /\ tries' = tries \ {w}
            /\ UNCHANGED conn
    /\ UNCHANGED win

\* The window the relay connected to stops running: the socket closes, and
\* the next call opens again.
Disconnect ==
    /\ relay = "connected"
    /\ ~Running(conn)
    /\ relay' = "idle"
    /\ conn' = NoWindow
    /\ UNCHANGED <<win, tries>>

Next ==
    \/ \E w \in Windows : OpenWindow(w)
    \/ \E w \in Windows : CloseWindow(w)
    \/ \E w \in Windows : Focus(w)
    \/ \E w \in Windows : FinishWrite(w)
    \/ \E w \in Windows : ListWindow(w)
    \/ \E w \in Windows : Crash(w)
    \/ \E w \in Windows : Reuse(w)
    \/ Start
    \/ \E w \in Windows : Try(w)
    \/ Disconnect

\* The relay keeps calling start, goes on through its candidates, and notices
\* a closed socket; a write that began ends. Windows open, close, and crash
\* when they do.
Fairness ==
    /\ WF_vars(Start)
    /\ WF_vars(Disconnect)
    /\ \A w \in Windows : WF_vars(Try(w))
    /\ \A w \in Windows : WF_vars(FinishWrite(w))

Spec == Init /\ [][Next]_vars /\ Fairness

--------------------------------------------------------------------------------

\* #31: looking up the windows never throws.
NoInternal == relay # "internal"

\* A window that is running is found: findWindows never says there is none
\* while one with a file runs. One without (its write failed) cannot be; the
\* code tells the programmer so (`failed`).
FindsRunningProp ==
    [][(Start /\ relay' = "no_editor") => ~(\E w \in Windows : HasFile(w))]_vars

\* The relay connects only to a window that answered.
ConnectedToOpen == (relay = "connected") => (conn # NoWindow)

\* While one window stays open, a relay that keeps calling start keeps
\* finding one. A relay that never connected would fail it, so it says
\* something must happen. The <>[] sits under \E because the window that
\* stays open is any one of them (6.29).
FindsOpen ==
    (\E w \in Windows : <>[](win[w] = "open")) => []<>(relay = "connected")

================================================================================
