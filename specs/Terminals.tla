---- MODULE Terminals ----------------------------------------------------------
(******************************************************************************)
(* The agent's `run` commands in packages/vscode/src/terminal.ts: which       *)
(* terminal each gets (`acquire`), waiting for shell integration, the command *)
(* running, and what ends each wait. L6 and Terminals in #19. One run() call  *)
(* at a time, as the player makes them.                                       *)
(******************************************************************************)
EXTENDS Naturals

CONSTANTS
    MaxTerminals,   \* how many terminals the model has room for
    MaxRuns,        \* how many run() calls the model makes
    Dirs            \* the directories a run may ask for

ASSUME AssumeMaxTerminals == MaxTerminals \in Nat \ {0}
ASSUME AssumeMaxRuns == MaxRuns \in Nat
ASSUME AssumeDirs == Dirs # {}

\* The terminals.
TerminalIds == 1..MaxTerminals

\* What a terminal can be: not created yet, open, its shell exited, or closed
\* by the programmer.
TerminalStates == {"unused", "open", "exited", "closed"}

\* A terminal's command: running, ended, or typed in without shell integration,
\* so nothing tracks it.
CommandStates == {"running", "ended", "untracked"}

\* Where the run() call is.
CallStates == {"idle", "integration", "running", "returned"}

\* No terminal: before the first call. Any value that is not a terminal will
\* do, so the config makes it a model value (6.20).
NoTerminal == CHOOSE v : v \notin TerminalIds

\* No command: the terminal has none yet. Any value that is not a command state
\* will do, so the config makes it a model value (6.20).
NoCommand == CHOOSE v : v \notin CommandStates

VARIABLES
    state,    \* each terminal's state, one of TerminalStates
    busy,     \* each terminal's Owned.busy
    cmd,      \* each terminal's command, one of CommandStates, or NoCommand
    call,     \* the run() call, one of CallStates
    at,       \* the terminal the call has, or NoTerminal
    aborted,  \* the playback signal fired
    runs,     \* how many run() calls have started
    reused,   \* a call took a terminal that was busy
    dir       \* each terminal's directory (Owned.cwd, or where its shell is)

vars == <<state, busy, cmd, call, at, aborted, runs, reused, dir>>

--------------------------------------------------------------------------------

\* The values each variable can hold.
TypeOK ==
    /\ state \in [TerminalIds -> TerminalStates]
    /\ busy \in [TerminalIds -> BOOLEAN]
    /\ cmd \in [TerminalIds -> CommandStates \cup {NoCommand}]
    /\ call \in CallStates
    /\ at \in TerminalIds \cup {NoTerminal}
    /\ aborted \in BOOLEAN
    /\ runs \in Nat
    /\ reused \in BOOLEAN
    /\ dir \in [TerminalIds -> Dirs]

\* acquire() may reuse terminal t for directory d: it isn't busy, its shell is
\* alive, and it is in d.
Reusable(t, d) ==
    /\ state[t] = "open"
    /\ ~busy[t]
    /\ dir[t] = d

--------------------------------------------------------------------------------

\* An unused terminal's directory is never read, since Start sets it, so any
\* directory will do for the CHOOSE.
Init ==
    /\ state = [t \in TerminalIds |-> "unused"]
    /\ busy = [t \in TerminalIds |-> FALSE]
    /\ cmd = [t \in TerminalIds |-> NoCommand]
    /\ call = "idle"
    /\ at = NoTerminal
    /\ aborted = FALSE
    /\ runs = 0
    /\ reused = FALSE
    /\ dir = [t \in TerminalIds |-> CHOOSE d \in Dirs : TRUE]

\* acquire() for a run in directory d: terminal t, one that is reusable, else a
\* new one there (createTerminal); then busy = true. The signal may have fired
\* already: an interrupt during the save before it, with confirmation off.
Start(d, t) ==
    /\ call \in {"idle", "returned"}
    /\ \/ Reusable(t, d)
       \/ /\ state[t] = "unused"
          /\ ~\E u \in TerminalIds : Reusable(u, d)
    /\ state' = [state EXCEPT ![t] = "open"]
    /\ busy' = [busy EXCEPT ![t] = TRUE]
    /\ cmd' = [cmd EXCEPT ![t] = NoCommand]
    /\ call' = "integration"
    /\ at' = t
    /\ aborted' \in BOOLEAN
    /\ runs' = runs + 1
    /\ reused' = (reused \/ busy[t])
    /\ dir' = [dir EXCEPT ![t] = d]

\* Shell integration arrives, or its 5 s timer fires with it present: the
\* command starts (executeCommand).
ExecuteCommand ==
    /\ call = "integration"
    /\ state[at] = "open"
    /\ ~aborted
    /\ cmd' = [cmd EXCEPT ![at] = "running"]
    /\ call' = "running"
    /\ UNCHANGED <<state, busy, at, aborted, runs, reused, dir>>

\* The 5 s timer fires without integration: the command is typed in
\* (sendText), and run() returns. Nothing tells when it ends, so the terminal
\* stays busy, and is never reused.
SendText ==
    /\ call = "integration"
    /\ state[at] = "open"
    /\ ~aborted
    /\ cmd' = [cmd EXCEPT ![at] = "untracked"]
    /\ call' = "returned"
    /\ UNCHANGED <<state, busy, at, aborted, runs, reused, dir>>

\* Interrupted while waiting for integration: run() returns notStarted, and the
\* terminal is free.
AbortBeforeStart ==
    /\ call = "integration"
    /\ ~aborted
    /\ busy' = [busy EXCEPT ![at] = FALSE]
    /\ call' = "returned"
    /\ aborted' = TRUE
    /\ UNCHANGED <<state, cmd, at, runs, reused, dir>>

\* The signal fired before the run: shellIntegration() returns at once, and
\* run() returns notStarted.
SkipAborted ==
    /\ call = "integration"
    /\ aborted
    /\ busy' = [busy EXCEPT ![at] = FALSE]
    /\ call' = "returned"
    /\ UNCHANGED <<state, cmd, at, aborted, runs, reused, dir>>

\* Terminal t's command ends (onDidEndTerminalShellExecution): `ended` frees
\* the terminal.
End(t) ==
    /\ cmd[t] = "running"
    /\ busy' = [busy EXCEPT ![t] = FALSE]
    /\ cmd' = [cmd EXCEPT ![t] = "ended"]
    /\ call' = IF call = "running" /\ at = t THEN "returned" ELSE call
    /\ UNCHANGED <<state, at, aborted, runs, reused, dir>>

\* stopWaiting: the wait elapses, or playback is interrupted; run() returns
\* with the command running.
StopWaiting ==
    /\ call = "running"
    /\ cmd[at] = "running"
    /\ call' = "returned"
    /\ aborted' \in {aborted, TRUE}
    /\ UNCHANGED <<state, busy, cmd, at, runs, reused, dir>>

\* The programmer closes terminal t: onDidCloseTerminal forgets it and ends
\* the call's wait.
Close(t) ==
    /\ state[t] \in {"open", "exited"}
    /\ state' = [state EXCEPT ![t] = "closed"]
    /\ busy' = [busy EXCEPT ![t] = FALSE]
    /\ cmd' = IF cmd[t] = "running" THEN [cmd EXCEPT ![t] = "ended"] ELSE cmd
    /\ call' = IF call = "running" /\ at = t THEN "returned" ELSE call
    /\ UNCHANGED <<at, aborted, runs, reused, dir>>

\* Terminal t's shell exits (`exit` typed in it): the terminal stays open, but
\* isn't reused (exitStatus). Not while its command runs, or while a run waits
\* for its integration.
Exit(t) ==
    /\ state[t] = "open"
    /\ cmd[t] # "running"
    /\ ~(call = "integration" /\ at = t)
    /\ state' = [state EXCEPT ![t] = "exited"]
    /\ UNCHANGED <<busy, cmd, call, at, aborted, runs, reused, dir>>

\* Closed while waiting for integration: the timer fires with none, the text
\* goes to a closed terminal, VS Code throws, and run() rejects, which the
\* player reports as the action's error.
RejectClosed ==
    /\ call = "integration"
    /\ state[at] = "closed"
    /\ ~aborted
    /\ call' = "returned"
    /\ UNCHANGED <<state, busy, cmd, at, aborted, runs, reused, dir>>

Next ==
    \/ \E d \in Dirs, t \in TerminalIds : Start(d, t)
    \/ ExecuteCommand
    \/ SendText
    \/ AbortBeforeStart
    \/ SkipAborted
    \/ StopWaiting
    \/ RejectClosed
    \/ \E t \in TerminalIds : End(t)
    \/ \E t \in TerminalIds : Close(t)
    \/ \E t \in TerminalIds : Exit(t)

\* Integration or its timer comes, commands end, and waits elapse.
Fairness ==
    /\ WF_vars(ExecuteCommand)
    /\ WF_vars(SendText)
    /\ WF_vars(SkipAborted)
    /\ WF_vars(RejectClosed)
    /\ WF_vars(StopWaiting)
    /\ \A t \in TerminalIds : WF_vars(End(t))

Spec == Init /\ [][Next]_vars /\ Fairness

--------------------------------------------------------------------------------

\* A busy terminal is never given to another command.
NoReuseWhileBusy == ~reused

\* A terminal whose command ended, or that was closed, is free.
FreedAfterEnd ==
    \A t \in TerminalIds : (cmd[t] = "ended" \/ state[t] = "closed") => ~busy[t]

\* L6, for the command: every run() call returns. Code whose call waited
\* forever would fail it, so it says something must happen.
RunReturns == (call \in {"integration", "running"}) ~> (call = "returned")

\* Runs run out only so that the model is finite (6.8). It prunes exactly the
\* states a guard `runs < MaxRuns` on Start never reached, so the behaviors,
\* and RunReturns' result, are the guard's (8.6).
Constraint == runs <= MaxRuns

================================================================================
