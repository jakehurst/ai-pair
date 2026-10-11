----------------------------- MODULE PanelScroll -----------------------------
\* The scroll position of the Pair panel's history: add and addYou in
\* packages/vscode/src/webview/panel.ts. Issue #139. The history is newest first, and the
\* browser's scroll anchoring keeps the programmer's place when an entry goes in above it.
EXTENDS Naturals, Sequences

CONSTANTS
    N,        \* how many entries in a run
    ScrollOn  \* which entries scroll the history to its top: none, you, or all

VARIABLES
    t,        \* the time of the last entry: 1, 2, 3, ...
    history,  \* the history, top first: the times of its entries
    above,    \* how many entries are scrolled out of view, above the view
    last,     \* the last event: none, entry, you, or scroll
    before    \* the entry at the view's top before the last event, or 0 if the view was at the top

vars == <<t, history, above, last, before>>

\* The entry at the view's top, or 0 for an empty history.
ViewTop == IF above < Len(history) THEN history[above + 1] ELSE 0

Init == t = 0 /\ history = <<>> /\ above = 0 /\ last = "none" /\ before = 0

\* An entry goes in at the top. Scrolled down, anchoring keeps the same entry at the view's top.
\* At the top, a browser may show the new entry or keep the old one, so the model allows both.
Prepend(kind) ==
    /\ t < N /\ t' = t + 1
    /\ history' = <<t + 1>> \o history
    /\ before' = IF above > 0 THEN ViewTop ELSE 0
    /\ last' = kind
    /\ IF ScrollOn = "all" \/ (ScrollOn = "you" /\ kind = "you")
          THEN above' = 0
          ELSE IF history = <<>> THEN above' = 0
          ELSE IF above > 0 THEN above' = above + 1
          ELSE above' \in {0, 1}

\* The agent's message filed, a run, a divider, a change outside the editor: add.
Entry == Prepend("entry")

\* The programmer's message: addYou.
You == Prepend("you")

\* The programmer scrolls the history.
Scroll ==
    /\ history # <<>>
    /\ above' \in 0..(Len(history) - 1)
    /\ last' = "scroll" /\ before' = 0
    /\ UNCHANGED <<t, history>>

Next == Entry \/ You \/ Scroll

Spec == Init /\ [][Next]_vars

\* The view starts at an entry, or at the top of an empty history.
InRange == above = 0 \/ above < Len(history)

\* The programmer's message is in view as soon as it is in the history.
YoursInView == last = "you" => above = 0

\* An entry from the agent keeps the programmer's place in the history.
KeepsPlace == last = "entry" /\ before # 0 => ViewTop = before

==============================================================================
