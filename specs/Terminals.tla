------------------------------- MODULE Terminals -------------------------------
\* The agent's `run` commands in packages/vscode/src/terminal.ts: which terminal each gets
\* (`acquire`), waiting for shell integration, the command running, and what ends each wait.
\* L6 and Terminals in #19. One run() call at a time, as the player makes them.
EXTENDS Naturals

CONSTANTS
    T,      \* how many terminals there can be
    Runs    \* how many run() calls in a run

Terms == 1..T

VARIABLES
    state,    \* each terminal: "unused", "open", "closed" (by the programmer)
    busy,     \* Owned.busy
    cmd,      \* each terminal's command: "none", "running", "ended"
    call,     \* the run() call: "idle", "integration", "running", "returned"
    at,       \* the terminal the call has, or 0
    aborted,  \* the playback signal fired
    runs,     \* how many run() calls have started
    reused    \* a call took a terminal that was busy

vars == <<state, busy, cmd, call, at, aborted, runs, reused>>

Init ==
    /\ state = [t \in Terms |-> "unused"] /\ busy = [t \in Terms |-> FALSE] /\ cmd = [t \in Terms |-> "none"]
    /\ call = "idle" /\ at = 0 /\ aborted = FALSE /\ runs = 0 /\ reused = FALSE

Set(f, x, v) == [f EXCEPT ![x] = v]

\* acquire(): an open terminal that isn't busy, else a new one (createTerminal); then busy = true.
\* Its signal is the one confirm() checked, synchronously, so it hasn't fired yet.
Start ==
    /\ call \in {"idle", "returned"} /\ runs < Runs
    /\ \E t \in Terms :
          /\ \/ state[t] = "open" /\ ~busy[t]
             \/ state[t] = "unused" /\ ~\E u \in Terms : state[u] = "open" /\ ~busy[u]
          /\ reused' = (reused \/ busy[t])
          /\ state' = Set(state, t, "open") /\ busy' = Set(busy, t, TRUE) /\ cmd' = Set(cmd, t, "none")
          /\ at' = t
    /\ call' = "integration" /\ aborted' = FALSE /\ runs' = runs + 1

\* Shell integration arrives, or its 5 s timer fires with it present: the command starts.
Integrated ==
    /\ call = "integration" /\ state[at] = "open"
    /\ call' = "running" /\ cmd' = Set(cmd, at, "running")
    /\ UNCHANGED <<state, busy, at, aborted, runs, reused>>

\* Interrupted while waiting for integration: run() returns notStarted, and the terminal is free.
AbortBeforeStart ==
    /\ call = "integration" /\ ~aborted
    /\ aborted' = TRUE /\ call' = "returned" /\ busy' = Set(busy, at, FALSE)
    /\ UNCHANGED <<state, cmd, at, runs, reused>>

\* A command ends (onDidEndTerminalShellExecution): `ended` frees its terminal.
End(t) ==
    /\ cmd[t] = "running" /\ cmd' = Set(cmd, t, "ended") /\ busy' = Set(busy, t, FALSE)
    /\ call' = IF call = "running" /\ at = t THEN "returned" ELSE call
    /\ UNCHANGED <<state, at, aborted, runs, reused>>

\* stopWaiting: the wait elapses, or playback is interrupted; run() returns with the command running.
StopWaiting ==
    /\ call = "running" /\ cmd[at] = "running"
    /\ call' = "returned" /\ \E a \in BOOLEAN : aborted' = (aborted \/ a)
    /\ UNCHANGED <<state, busy, cmd, at, runs, reused>>

\* The programmer closes a terminal: onDidCloseTerminal forgets it and ends the call's wait.
Close(t) ==
    /\ state[t] = "open" /\ state' = Set(state, t, "closed") /\ busy' = Set(busy, t, FALSE)
    /\ cmd' = IF cmd[t] = "running" THEN Set(cmd, t, "ended") ELSE cmd
    /\ call' = IF call = "running" /\ at = t THEN "returned" ELSE call
    /\ UNCHANGED <<at, aborted, runs, reused>>

\* Closed while waiting for integration: the timer fires with none, the text goes to a closed
\* terminal, VS Code throws, and run() rejects, which the player reports as the action's error.
ClosedWhileWaiting ==
    /\ call = "integration" /\ state[at] = "closed"
    /\ call' = "returned"
    /\ UNCHANGED <<state, busy, cmd, at, aborted, runs, reused>>

Next ==
    \/ Start \/ Integrated \/ AbortBeforeStart \/ StopWaiting \/ ClosedWhileWaiting
    \/ \E t \in Terms : End(t) \/ Close(t)

\* Integration or its timer comes, commands end, and waits elapse.
Spec == Init /\ [][Next]_vars /\ WF_vars(Integrated \/ ClosedWhileWaiting) /\ WF_vars(StopWaiting)
        /\ \A t \in Terms : WF_vars(End(t))

\* A busy terminal is never given to another command.
NoReuseWhileBusy == ~reused

\* L6, for the command: every run() call returns.
RunReturns == call \in {"integration", "running"} ~> call = "returned"

\* A terminal whose command ended, or that was closed, is free.
FreedAfterEnd == \A t \in Terms : (cmd[t] = "ended" \/ state[t] = "closed") => ~busy[t]

=============================================================================
