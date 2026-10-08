-------------------------------- MODULE Panel --------------------------------
\* The panel's history in packages/vscode/src/webview/panel.ts, newest first. Issue #18.
\* Each event is stamped with the time it happened: 1, 2, 3, ...
EXTENDS Naturals, Sequences

CONSTANTS
    N,    \* how many events in a run
    Fix   \* 0: the code at 57ac07f. 1 and 2: the two fixes proposed in #18.

VARIABLES
    t,        \* the time of the last event
    band,     \* the agent's current message, shown in the band, or 0
    flag,     \* Fix 1: the current message is already in the history
    added,    \* Fix 2: how many entries were added while the current message was current
    history   \* the history, top first: the times of its entries

vars == <<t, band, flag, added, history>>

Init == t = 0 /\ band = 0 /\ flag = FALSE /\ added = 0 /\ history = <<>>

Flushed ==
    CASE band = 0 -> history
      [] Fix = 1 /\ flag -> history
      [] Fix = 2 -> SubSeq(history, 1, added) \o <<band>> \o SubSeq(history, added + 1, Len(history))
      [] OTHER -> <<band>> \o history

Say ==
    /\ t < N /\ t' = t + 1
    /\ history' = Flushed
    /\ band' = t + 1 /\ flag' = FALSE /\ added' = 0

Entry ==
    /\ t < N /\ t' = t + 1
    /\ history' = <<t + 1>> \o (IF Fix = 1 THEN Flushed ELSE history)
    /\ flag' = (Fix = 1 /\ band # 0)
    /\ added' = IF Fix = 2 THEN added + 1 ELSE added
    /\ UNCHANGED band

Edge ==
    /\ t < N /\ t' = t + 1
    /\ history' = <<t + 1>> \o Flushed
    /\ band' = 0 /\ flag' = FALSE /\ added' = 0

Next == Say \/ Entry \/ Edge

Spec == Init /\ [][Next]_vars

\* S13: the history is in reverse order of when things happened.
NewestFirst == \A i \in 1..(Len(history) - 1) : history[i] > history[i + 1]

\* Every event is in the band or in the history.
NoneLost == \A k \in 1..t : k = band \/ \E i \in 1..Len(history) : history[i] = k

\* No entry is in the history twice.
NoDuplicates == \A i, j \in 1..Len(history) : history[i] = history[j] => i = j

==============================================================================
