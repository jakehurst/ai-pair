---- MODULE Panel --------------------------------------------------------------
(******************************************************************************)
(* The panel's history in packages/vscode/src/webview/panel.ts, newest first. *)
(* Issue #18. Each event is stamped with the time it happened: 1, 2, 3, ...   *)
(******************************************************************************)
EXTENDS Naturals, Sequences

CONSTANTS
    MaxEvents,  \* how many events the model has
    Fix         \* 0: the code at 57ac07f. 1 and 2: the two fixes proposed in
                \* #18.

ASSUME AssumeMaxEvents == MaxEvents \in Nat
ASSUME AssumeFix == Fix \in {0, 1, 2}

\* No message in the band. Any value that is not a time will do, so the config
\* makes it a model value (6.20).
NoMessage == CHOOSE v : v \notin Nat

VARIABLES
    time,     \* the time of the last event
    band,     \* the agent's current message, shown in the band, or NoMessage
    flag,     \* Fix 1: the current message is already in the history
    added,    \* Fix 2: how many entries were added while the current message
              \* was current
    history   \* the history, top first: the times of its entries

vars == <<time, band, flag, added, history>>

--------------------------------------------------------------------------------

\* The values each variable can hold.
TypeOK ==
    /\ time \in Nat
    /\ band \in (Nat \ {0}) \cup {NoMessage}
    /\ flag \in BOOLEAN
    /\ added \in Nat
    /\ history \in Seq(Nat \ {0})

\* `s` with `x` inserted after its first `n` elements.
InsertAfter(s, n, x) == SubSeq(s, 1, n) \o <<x>> \o SubSeq(s, n + 1, Len(s))

\* The history once the band's message is filed into it, under each fix.
Flushed ==
    CASE band = NoMessage -> history
      [] Fix = 1 /\ flag -> history
      [] Fix = 2 -> InsertAfter(history, added, band)
      [] OTHER -> <<band>> \o history

--------------------------------------------------------------------------------

Init ==
    /\ time = 0
    /\ band = NoMessage
    /\ flag = FALSE
    /\ added = 0
    /\ history = <<>>

\* setNow: the agent's message replaces the one in the band, which is filed.
Say ==
    /\ time' = time + 1
    /\ band' = time + 1
    /\ flag' = FALSE
    /\ added' = 0
    /\ history' = Flushed

\* add(): an entry, such as the programmer's message, a run, or a divider,
\* goes on top; under Fix 1 the band's message is filed first.
AddEntry ==
    /\ time' = time + 1
    /\ flag' = (Fix = 1 /\ band # NoMessage)
    /\ added' = IF Fix = 2 THEN added + 1 ELSE added
    /\ history' = <<time + 1>> \o (IF Fix = 1 THEN Flushed ELSE history)
    /\ UNCHANGED band

\* A session starts or ends: its divider goes on top of the filed band, and
\* the band empties.
ChangeSession ==
    /\ time' = time + 1
    /\ band' = NoMessage
    /\ flag' = FALSE
    /\ added' = 0
    /\ history' = <<time + 1>> \o Flushed

\* A `session` event repeating a suspension the page already shows (#138):
\* the band is filed and empties, and no divider is added.
RepeatSession ==
    /\ band' = NoMessage
    /\ flag' = FALSE
    /\ added' = 0
    /\ history' = Flushed
    /\ UNCHANGED time

Next ==
    \/ Say
    \/ AddEntry
    \/ ChangeSession
    \/ RepeatSession

Spec == Init /\ [][Next]_vars

--------------------------------------------------------------------------------

\* The history is in reverse order of when things happened.
NewestFirst == \A i \in 1..(Len(history) - 1) : history[i] > history[i + 1]

\* Every event is in the band or in the history. A panel that ignored events
\* would lose them, so this says something must happen.
NoneLost ==
    \A k \in 1..time :
        \/ k = band
        \/ \E i \in 1..Len(history) : history[i] = k

\* No entry is in the history twice.
NoDuplicates ==
    \A i, j \in 1..Len(history) : (history[i] = history[j]) => (i = j)

\* Events run out only so that the model is finite (6.8).
Constraint == time <= MaxEvents

================================================================================
