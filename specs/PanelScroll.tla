---- MODULE PanelScroll --------------------------------------------------------
(******************************************************************************)
(* The scroll position of the Pair panel's history: add and addYou in         *)
(* packages/vscode/src/webview/panel.ts. Issue #139. The history is newest    *)
(* first, and the browser's scroll anchoring keeps the programmer's place     *)
(* when an entry goes in above it.                                            *)
(******************************************************************************)
EXTENDS Naturals, Sequences

CONSTANTS
    MaxEvents, \* how many entries the model adds
    ScrollOn   \* which entries scroll the history to its top: "none", "you", or
               \* "all"

ASSUME AssumeMaxEvents == MaxEvents \in Nat
ASSUME AssumeScrollOn == ScrollOn \in {"none", "you", "all"}

\* The events the view reacts to: an entry added, the You marker, a scroll.
EventKinds == {"entry", "you", "scroll"}

\* No entry, and no event yet. Any value that is not a time, and not an event,
\* will do, so the config makes each a model value (6.20).
NoEntry == CHOOSE v : v \notin Nat
NoEvent == CHOOSE v : v \notin EventKinds

VARIABLES
    time,             \* the time of the last entry: 1, 2, 3, ...
    history,          \* the history, top first: the times of its entries
    entriesAboveView, \* how many entries are scrolled out of view, above the
                      \* view
    lastEvent,        \* the last event: "entry", "you", "scroll", or NoEvent
    topBefore         \* the entry at the view's top before the last event, or
                      \* NoEntry if the view was at the top

vars == <<time, history, entriesAboveView, lastEvent, topBefore>>

--------------------------------------------------------------------------------

\* The values each variable can hold.
TypeOK ==
    /\ time \in Nat
    /\ history \in Seq(Nat \ {0})
    /\ entriesAboveView \in Nat
    /\ lastEvent \in {"entry", "you", "scroll", NoEvent}
    /\ topBefore \in (Nat \ {0}) \cup {NoEntry}

\* The entry at the view's top, or NoEntry for an empty history.
ViewTop == IF entriesAboveView < Len(history)
           THEN history[entriesAboveView + 1] ELSE NoEntry

--------------------------------------------------------------------------------

Init ==
    /\ time = 0
    /\ history = <<>>
    /\ entriesAboveView = 0
    /\ lastEvent = NoEvent
    /\ topBefore = NoEntry

\* An entry goes in at the top. Scrolled down, anchoring keeps the same entry at
\* the view's top. At the top, a browser may show the new entry or keep the old
\* one, so the model allows both.
Prepend(kind) ==
    /\ time' = time + 1
    /\ history' = <<time + 1>> \o history
    /\ IF ScrollOn = "all" \/ (ScrollOn = "you" /\ kind = "you")
       THEN entriesAboveView' = 0
       ELSE IF history = <<>>
            THEN entriesAboveView' = 0
            ELSE IF entriesAboveView > 0
                 THEN entriesAboveView' = entriesAboveView + 1
                 ELSE entriesAboveView' \in {0, 1}
    /\ lastEvent' = kind
    /\ topBefore' = IF entriesAboveView > 0 THEN ViewTop ELSE NoEntry

\* The agent's message filed, a run, a divider, a change outside the editor:
\* add.
AddEntry == Prepend("entry")

\* The programmer's message: addYou.
AddYours == Prepend("you")

\* The programmer scrolls the history.
Scroll ==
    /\ history # <<>>
    /\ entriesAboveView' \in 0..(Len(history) - 1)
    /\ lastEvent' = "scroll"
    /\ topBefore' = NoEntry
    /\ UNCHANGED <<time, history>>

Next ==
    \/ AddEntry
    \/ AddYours
    \/ Scroll

Spec == Init /\ [][Next]_vars

--------------------------------------------------------------------------------

\* The view starts at an entry, or at the top of an empty history.
ViewAtEntry == entriesAboveView = 0 \/ entriesAboveView < Len(history)

\* The programmer's message is in view as soon as it is in the history. A panel
\* that never scrolled would fail it, so it says something must happen.
YoursInView == (lastEvent = "you") => (entriesAboveView = 0)

\* An entry from the agent keeps the programmer's place in the history.
KeepsPlace == (lastEvent = "entry"
               /\ topBefore # NoEntry) => (ViewTop = topBefore)

\* Entries run out only so that the model is finite (6.8).
Constraint == time <= MaxEvents

================================================================================
