---- MODULE Terminals ----------------------------------------------------------
(******************************************************************************)
(* The agent's `run` commands in packages/vscode/src/terminal.ts: which       *)
(* terminal each gets (`acquire`), waiting for shell integration, the command *)
(* running, and what ends each wait. Every run() call returns (#19). One      *)
(* run() call at a time, as the player makes them.                            *)
(******************************************************************************)
EXTENDS Naturals

CONSTANTS
    NumTerminals,   \* how many terminals the model has room for
    MaxRuns,        \* how many run() calls the model makes
    Directories            \* the directories a run may ask for

ASSUME AssumeNumTerminals == NumTerminals \in Nat \ {0}
ASSUME AssumeMaxRuns == MaxRuns \in Nat
ASSUME AssumeDirs == Directories # {}

\* The terminals.
TerminalIds == 1..NumTerminals

\* What a terminal can be: not created yet, open, its shell exited, or closed
\* by the programmer.
TerminalStates == {"unused", "open", "exited", "closed"}

\* A terminal's command: running, ended, or typed in without shell integration,
\* so nothing tracks it.
CommandStates == {"running", "ended", "untracked"}

\* Where the run() call is.
RunStates == {"idle", "awaitingIntegration", "running", "settled"}

\* No terminal: before the first call. Any value that is not a terminal will
\* do, so the config makes it a model value (6.20).
NoTerminal == CHOOSE v : v \notin TerminalIds

\* No command: the terminal has none yet. Any value that is not a command state
\* will do, so the config makes it a model value (6.20).
NoCommand == CHOOSE v : v \notin CommandStates

VARIABLES
    state,       \* each terminal's state, one of TerminalStates
    busy,        \* each terminal's Owned.busy
    command,         \* each terminal's command, one of CommandStates, or
                     \* NoCommand
    run,         \* the run() call, one of RunStates
    callTerminal,          \* the terminal the call has, or NoTerminal
    interrupted, \* the playback signal fired (the timeline)
    runs,        \* how many run() calls have started
    busyReused,      \* a call took a terminal that was busy
    directory          \* each terminal's directory (Owned.cwd, or where its
                       \* shell is)

vars == <<state, busy, command, run, callTerminal, interrupted, runs,
          busyReused, directory>>

--------------------------------------------------------------------------------

\* The values each variable can hold.
TypeOK ==
    /\ state \in [TerminalIds -> TerminalStates]
    /\ busy \in [TerminalIds -> BOOLEAN]
    /\ command \in [TerminalIds -> CommandStates \cup {NoCommand}]
    /\ run \in RunStates
    /\ callTerminal \in TerminalIds \cup {NoTerminal}
    /\ interrupted \in BOOLEAN
    /\ runs \in Nat
    /\ busyReused \in BOOLEAN
    /\ directory \in [TerminalIds -> Directories]

\* acquire() may reuse terminal t for directory d: it isn't busy, its shell is
\* alive, and it is in d.
Reusable(t, d) ==
    /\ state[t] = "open"
    /\ ~busy[t]
    /\ directory[t] = d

--------------------------------------------------------------------------------

\* An unused terminal's directory is never read, since Acquire sets it, so any
\* directory will do for the CHOOSE.
Init ==
    /\ state = [t \in TerminalIds |-> "unused"]
    /\ busy = [t \in TerminalIds |-> FALSE]
    /\ command = [t \in TerminalIds |-> NoCommand]
    /\ run = "idle"
    /\ callTerminal = NoTerminal
    /\ interrupted = FALSE
    /\ runs = 0
    /\ busyReused = FALSE
    /\ directory = [t \in TerminalIds |-> CHOOSE d \in Directories : TRUE]

\* acquire() for a run in directory d: terminal t, one that is reusable, else a
\* new one there (createTerminal); then busy = true. The signal may have fired
\* already: an interrupt during the save before it, with confirmation off.
Acquire(d, t) ==
    /\ run \in {"idle", "settled"}
    /\ \/ Reusable(t, d)
       \/ /\ state[t] = "unused"
          /\ ~\E u \in TerminalIds : Reusable(u, d)
    /\ state' = [state EXCEPT ![t] = "open"]
    /\ busy' = [busy EXCEPT ![t] = TRUE]
    /\ command' = [command EXCEPT ![t] = NoCommand]
    /\ run' = "awaitingIntegration"
    /\ callTerminal' = t
    /\ interrupted' \in BOOLEAN
    /\ runs' = runs + 1
    /\ busyReused' = (busyReused \/ busy[t])
    /\ directory' = [directory EXCEPT ![t] = d]

\* Shell integration arrives, or its 5 s timer fires with it present: the
\* command starts (executeCommand).
ExecuteCommand ==
    /\ run = "awaitingIntegration"
    /\ state[callTerminal] = "open"
    /\ ~interrupted
    /\ command' = [command EXCEPT ![callTerminal] = "running"]
    /\ run' = "running"
    /\ UNCHANGED <<state, busy, callTerminal, interrupted, runs, busyReused,
                   directory>>

\* The 5 s timer fires without integration: the command is typed in
\* (sendText), and run() returns. Nothing tells when it ends, so the terminal
\* stays busy, and is never reused.
SendText ==
    /\ run = "awaitingIntegration"
    /\ state[callTerminal] = "open"
    /\ ~interrupted
    /\ command' = [command EXCEPT ![callTerminal] = "untracked"]
    /\ run' = "settled"
    /\ UNCHANGED <<state, busy, callTerminal, interrupted, runs, busyReused,
                   directory>>

\* Interrupted while waiting for integration: run() returns notStarted, and the
\* terminal is free.
AbortBeforeStart ==
    /\ run = "awaitingIntegration"
    /\ ~interrupted
    /\ busy' = [busy EXCEPT ![callTerminal] = FALSE]
    /\ run' = "settled"
    /\ interrupted' = TRUE
    /\ UNCHANGED <<state, command, callTerminal, runs, busyReused, directory>>

\* The signal fired before the run: shellIntegration() returns at once, and
\* run() returns notStarted.
SkipAborted ==
    /\ run = "awaitingIntegration"
    /\ interrupted
    /\ busy' = [busy EXCEPT ![callTerminal] = FALSE]
    /\ run' = "settled"
    /\ UNCHANGED <<state, command, callTerminal, interrupted, runs, busyReused,
                   directory>>

\* Terminal t's command ends (onDidEndTerminalShellExecution): `ended` frees
\* the terminal.
End(t) ==
    /\ command[t] = "running"
    /\ busy' = [busy EXCEPT ![t] = FALSE]
    /\ command' = [command EXCEPT ![t] = "ended"]
    /\ run' = IF run = "running" /\ callTerminal = t THEN "settled" ELSE run
    /\ UNCHANGED <<state, callTerminal, interrupted, runs, busyReused,
                   directory>>

\* stopWaiting: the wait elapses, or playback is interrupted; run() returns
\* with the command running.
StopWaiting ==
    /\ run = "running"
    /\ command[callTerminal] = "running"
    /\ run' = "settled"
    /\ interrupted' \in {interrupted, TRUE}
    /\ UNCHANGED <<state, busy, command, callTerminal, runs, busyReused,
                   directory>>

\* The programmer closes terminal t: onDidCloseTerminal forgets it and ends
\* the call's wait.
CloseTerminal(t) ==
    /\ state[t] \in {"open", "exited"}
    /\ state' = [state EXCEPT ![t] = "closed"]
    /\ busy' = [busy EXCEPT ![t] = FALSE]
    /\ command' = IF command[t] = "running"
                  THEN [command EXCEPT ![t] = "ended"] ELSE command
    /\ run' = IF run = "running" /\ callTerminal = t THEN "settled" ELSE run
    /\ UNCHANGED <<callTerminal, interrupted, runs, busyReused, directory>>

\* Terminal t's shell exits (`exit` typed in it): the terminal stays open, but
\* isn't reused (exitStatus). Not while its command runs, or while a run waits
\* for its integration.
Exit(t) ==
    /\ state[t] = "open"
    /\ command[t] # "running"
    /\ ~(run = "awaitingIntegration" /\ callTerminal = t)
    /\ state' = [state EXCEPT ![t] = "exited"]
    /\ UNCHANGED <<busy, command, run, callTerminal, interrupted, runs,
                   busyReused, directory>>

\* Closed while waiting for integration: the timer fires with none, the text
\* goes to a closed terminal, VS Code throws, and run() rejects, which the
\* player reports as the action's error.
RejectClosed ==
    /\ run = "awaitingIntegration"
    /\ state[callTerminal] = "closed"
    /\ ~interrupted
    /\ run' = "settled"
    /\ UNCHANGED <<state, busy, command, callTerminal, interrupted, runs,
                   busyReused, directory>>

Next ==
    \/ \E d \in Directories, t \in TerminalIds : Acquire(d, t)
    \/ ExecuteCommand
    \/ SendText
    \/ AbortBeforeStart
    \/ SkipAborted
    \/ StopWaiting
    \/ RejectClosed
    \/ \E t \in TerminalIds : End(t)
    \/ \E t \in TerminalIds : CloseTerminal(t)
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
NoReuseWhileBusy == ~busyReused

\* A terminal whose command ended, or that was closed, is free.
FreedAfterEnd ==
    \A t \in TerminalIds : (command[t] = "ended"
                            \/ state[t] = "closed") => ~busy[t]

\* For the command: every run() call returns. Code whose call waited
\* forever would fail it, so it says something must happen.
RunReturns == (run \in {"awaitingIntegration", "running"}) ~> (run = "settled")

\* Runs run out only so that the model is finite (6.8). It prunes exactly the
\* states a guard `runs < MaxRuns` on Acquire never reached, so the behaviors,
\* and RunReturns' result, are the guard's (8.6).
Constraint == runs <= MaxRuns

================================================================================
