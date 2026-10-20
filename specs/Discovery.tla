---- MODULE Discovery ----------------------------------------------------------
(******************************************************************************)
(* Discovery files and the window a relay picks: writeDiscovery, focused, and *)
(* dispose in packages/core/src/bridge.ts, findWindows and open in            *)
(* packages/relay/src/link.ts. Every window has the agent's folder open.      *)
(* CheckFiles is the fix for #31: findWindows threw on a file that parsed but *)
(* was not a Discovery. AtomicWrite is the fix for #72: a window rewrites its *)
(* file each time it gains focus, and written in place, a relay reading it    *)
(* mid-write skipped it. A window whose write fails runs with no file, and no *)
(* relay can find it; the code reports the failure (`failed`). A window that  *)
(* runs may still refuse the relay's hello: an older extension (`rejected`),  *)
(* or another program on its port answering with garbage. open() then tries   *)
(* the next window.                                                           *)
(******************************************************************************)
EXTENDS Naturals

CONSTANTS
    NumWindows, \* how many editor windows
    JunkFile,   \* TRUE: a file with a live pid but no workspaceFolders is in
                \* the folder
    CheckFiles, \* TRUE: findWindows skips a file whose fields are not a
                \* Discovery, by its schema (the fix for #31; #163)
    AtomicWrite \* TRUE: writeDiscovery replaces the file in one rename, so it
                \* is never half written (the fix for #72)

ASSUME AssumeNumWindows == NumWindows \in Nat
ASSUME AssumeJunkFile == JunkFile \in BOOLEAN
ASSUME AssumeCheckFiles == CheckFiles \in BOOLEAN
ASSUME AssumeAtomicWrite == AtomicWrite \in BOOLEAN

\* The windows.
Windows == 1..NumWindows

\* No window: the relay is not connected. Any value that is not a window will
\* do, so the config makes it a model value (6.20).
NoWindow == CHOOSE v : v \notin Windows

VARIABLES
    windowState, \* each window: "unstarted", "open", "writing" (open, its file
                 \* truncated and not yet rewritten), "unlisted" (open, its file
                 \* not written), "closed" (file removed), "crashed" (file left,
                 \* pid dead), "pidReused" (file left, pid alive again, nothing
                 \* on the port)
    phase,       \* "idle", "trying", "connected", "no_editor", "internal"
                 \* (findWindows threw)
    untried,     \* the candidates open() has not tried yet
    connectedTo, \* the window the relay connected to, or NoWindow
    refuses      \* each window: TRUE if it refuses the relay's hello, as
                 \* chosen when it opens

vars == <<windowState, phase, untried, connectedTo, refuses>>

--------------------------------------------------------------------------------

\* The values each variable can hold.
TypeOK ==
    /\ windowState \in [Windows ->
                   {"unstarted", "open", "writing", "unlisted", "closed",
                     "crashed", "pidReused"}]
    /\ phase \in {"idle", "trying", "connected", "no_editor", "internal"}
    /\ untried \subseteq Windows
    /\ connectedTo \in Windows \cup {NoWindow}
    /\ refuses \in [Windows -> BOOLEAN]

\* findWindows lists the window: its file parses, and its pid is alive. A file
\* being written does not parse, and is skipped.
Alive(w) == windowState[w] \in {"open", "pidReused"}

\* The window runs, so its port answers.
Running(w) == windowState[w] \in {"open", "writing", "unlisted"}

\* The window runs and has a file.
HasFile(w) == windowState[w] \in {"open", "writing"}

--------------------------------------------------------------------------------

Init ==
    /\ windowState = [w \in Windows |-> "unstarted"]
    /\ phase = "idle"
    /\ untried = {}
    /\ connectedTo = NoWindow
    /\ refuses = [w \in Windows |-> FALSE]

\* A window starts, or reopens with a new pid: writeDiscovery, whose write may
\* fail. It runs our extension or an older one, which refuses our hello.
OpenWindow(w) ==
    /\ windowState[w] \in {"unstarted", "closed"}
    /\ \E s \in {"open",
                 "unlisted"} : windowState' = [windowState EXCEPT ![w] = s]
    /\ \E r \in BOOLEAN : refuses' = [refuses EXCEPT ![w] = r]
    /\ UNCHANGED <<phase, untried, connectedTo>>

\* A clean close: dispose() removes the file.
CloseWindow(w) ==
    /\ windowState[w] \in {"open", "unlisted"}
    /\ windowState' = [windowState EXCEPT ![w] = "closed"]
    /\ UNCHANGED <<phase, untried, connectedTo, refuses>>

\* The window gains focus: focused() -> writeDiscovery. writeFileSync
\* truncates the file, then writes it. With AtomicWrite, a rename replaces it
\* whole, which changes nothing a relay can see, so Focus is not enabled.
Focus(w) ==
    /\ windowState[w] = "open"
    /\ ~AtomicWrite
    /\ windowState' = [windowState EXCEPT ![w] = "writing"]
    /\ UNCHANGED <<phase, untried, connectedTo, refuses>>

\* The write that Focus began ends: the file is whole again.
FinishWrite(w) ==
    /\ windowState[w] = "writing"
    /\ windowState' = [windowState EXCEPT ![w] = "open"]
    /\ UNCHANGED <<phase, untried, connectedTo, refuses>>

\* A later focus writes the file of a window that has none, and this time the
\* write succeeds.
ListWindow(w) ==
    /\ windowState[w] = "unlisted"
    /\ windowState' = [windowState EXCEPT ![w] = "open"]
    /\ UNCHANGED <<phase, untried, connectedTo, refuses>>

\* A crash: the file stays behind, and its pid is dead.
Crash(w) ==
    /\ windowState[w] = "open"
    /\ windowState' = [windowState EXCEPT ![w] = "crashed"]
    /\ UNCHANGED <<phase, untried, connectedTo, refuses>>

\* Another process gets the crashed window's pid, so alive(pid) says yes.
Reuse(w) ==
    /\ windowState[w] = "crashed"
    /\ windowState' = [windowState EXCEPT ![w] = "pidReused"]
    /\ UNCHANGED <<phase, untried, connectedTo, refuses>>

\* The relay calls start: locate -> findWindows lists the candidates, or
\* throws on the junk file without CheckFiles.
Start ==
    /\ phase \in {"idle", "no_editor", "internal"}
    /\ IF JunkFile /\ ~CheckFiles
       THEN /\ phase' = "internal"
            /\ untried' = {}
       ELSE LET found == {w \in Windows : Alive(w)}
            IN  /\ phase' = IF found = {} THEN "no_editor" ELSE "trying"
                /\ untried' = found
    /\ UNCHANGED <<windowState, connectedTo, refuses>>

\* open() tries one candidate: openWindow connects if the window runs and
\* welcomes the hello, and otherwise the next candidate is tried, until none
\* is left.
Try(w) ==
    /\ phase = "trying"
    /\ w \in untried
    /\ IF Running(w) /\ ~refuses[w]
       THEN /\ phase' = "connected"
            /\ untried' = {}
            /\ connectedTo' = w
       ELSE /\ phase' = IF (untried \ {w}) = {} THEN "no_editor" ELSE "trying"
            /\ untried' = untried \ {w}
            /\ UNCHANGED connectedTo
    /\ UNCHANGED <<windowState, refuses>>

\* The window the relay connected to stops running: the socket closes, and
\* the next call opens again.
Disconnect ==
    /\ phase = "connected"
    /\ ~Running(connectedTo)
    /\ phase' = "idle"
    /\ connectedTo' = NoWindow
    /\ UNCHANGED <<windowState, untried, refuses>>

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
NoInternal == phase # "internal"

\* A window that is running is found: findWindows never says there is none
\* while one with a file runs. One without (its write failed) cannot be; the
\* code tells the programmer so (`failed`).
FindsRunningProp ==
    [][(Start /\ phase' = "no_editor") => ~(\E w \in Windows : HasFile(w))]_vars

\* The relay connects only to a window that answered.
ConnectedToOpen == (phase = "connected") => (connectedTo # NoWindow)

\* While one window that welcomes the relay stays open, a relay that keeps
\* calling start keeps finding one, past any window that refuses it. A relay
\* that never connected would fail it, so it says something must happen. The
\* <>[] sits under \E because the window that stays open is any one of them
\* (6.29).
FindsOpen ==
    (\E w \in Windows : <>[](windowState[w] = "open" /\ ~refuses[w]))
        => []<>(phase = "connected")

================================================================================
