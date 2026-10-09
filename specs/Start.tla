-------------------------------- MODULE Start --------------------------------
\* The Start a session button in the panel's idle view (#107): packages/vscode/src/panel.ts (`ready`,
\* `start`, Starter), setup.ts (claudeStarter), and webview/panel.ts (`canStart`, the click). A page
\* asks once, as it loads, whether a session can be started from here; the answer comes later, from
\* Claude Code's configuration (read at once) and VS Code's command list (awaited). A click runs Claude
\* Code's open command with the prompt. Pages come and go: the view is disposed, or its page reloads.
EXTENDS Naturals

CONSTANTS
    Pages,     \* how many pages may load
    Flips,     \* how often the environment may change: Set Up Agent, Claude Code installed or removed
    Clicks,    \* how many clicks
    ReaskOnSetUp, \* TRUE: Set Up Agent setting Claude Code up asks the live page again (the fix)
    DropStale  \* TRUE: an answer reaches only the page that asked (the fix)

VARIABLES
    page,      \* the webview's page: "live", "gone"
    pages,     \* pages loaded so far; the live page's number
    shown,     \* the button is visible
    shownFor,  \* the page whose check's answer last set `shown`; 0 when hidden
    pending,   \* checks asked and not yet answered: [for: the page, setUp: Claude Code was set up when asked]
    setUp,     \* Claude Code's configuration runs the pair server
    cmd,       \* Claude Code's extension is here: its open command is registered
    flips,     \* environment changes so far
    clicks,    \* clicks on the button
    runs       \* times the open command ran

vars == <<page, pages, shown, shownFor, pending, setUp, cmd, flips, clicks, runs>>

Check == [for: 1..Pages, setUp: BOOLEAN]

Init ==
    /\ page = "live" /\ pages = 1 /\ shown = FALSE /\ shownFor = 0
    /\ setUp \in BOOLEAN /\ cmd \in BOOLEAN
    /\ pending = {[for |-> 1, setUp |-> setUp]}
    /\ flips = 0 /\ clicks = 0 /\ runs = 0

\* `ready`: a page loads, hidden button, and asks once; isSetUp is read now, the command list later.
Ready ==
    /\ pages < Pages /\ pages' = pages + 1 /\ page' = "live"
    /\ shown' = FALSE /\ shownFor' = 0
    /\ pending' = pending \cup {[for |-> pages', setUp |-> setUp]}
    /\ UNCHANGED <<setUp, cmd, flips, clicks, runs>>

\* onDidDispose: the view closes, and its page with it.
Dispose ==
    /\ page = "live" /\ page' = "gone" /\ shown' = FALSE /\ shownFor' = 0
    /\ UNCHANGED <<pages, pending, setUp, cmd, flips, clicks, runs>>

\* getCommands resolves for one check, in any order; the panel posts canStart to its view, if any.
Answer(c) ==
    /\ c \in pending /\ pending' = pending \ {c}
    /\ LET value == c.setUp /\ cmd
           deliver == page = "live" /\ (~DropStale \/ c.for = pages)
       IN /\ shown' = IF deliver THEN value ELSE shown
          /\ shownFor' = IF deliver THEN (IF value THEN c.for ELSE 0) ELSE shownFor
    /\ UNCHANGED <<page, pages, setUp, cmd, flips, clicks, runs>>

\* Set Up Agent run or undone; Claude Code's extension installed or removed.
Flip ==
    /\ flips < Flips /\ flips' = flips + 1
    /\ \/ /\ setUp' = ~setUp /\ UNCHANGED cmd
          /\ pending' = IF ReaskOnSetUp /\ setUp' /\ page = "live"
                        THEN pending \cup {[for |-> pages, setUp |-> TRUE]}
                        ELSE pending
       \/ cmd' = ~cmd /\ UNCHANGED <<setUp, pending>>
    /\ UNCHANGED <<page, pages, shown, shownFor, clicks, runs>>

\* The click posts `start`; the panel runs the starter: Claude Code opens with the prompt.
Click ==
    /\ page = "live" /\ shown /\ clicks < Clicks
    /\ clicks' = clicks + 1 /\ runs' = runs + 1
    /\ UNCHANGED <<page, pages, shown, shownFor, pending, setUp, cmd, flips>>

Answering == \E c \in pending : Answer(c)

Next == Ready \/ Dispose \/ Answering \/ Flip \/ Click

Spec == Init /\ [][Next]_vars /\ WF_vars(Answering)

TypeOK ==
    /\ page \in {"live", "gone"} /\ pages \in 1..Pages
    /\ shown \in BOOLEAN /\ shownFor \in 0..Pages
    /\ pending \subseteq Check
    /\ setUp \in BOOLEAN /\ cmd \in BOOLEAN
    /\ flips \in 0..Flips /\ clicks \in 0..Clicks /\ runs \in 0..Clicks

\* The button shows only on a live page, set by that page's own check. A stale answer breaks this.
OwnAnswer == shown => page = "live" /\ shownFor = pages

\* A button that appears was earned: set up when asked, and the command there when answered.
Grounded == [][\A c \in pending : Answer(c) /\ ~shown /\ shown' => c.setUp /\ cmd]_vars

\* One run per click, and no run without one.
RunsAreClicks == runs = clicks

\* The page has no button to click while it is hidden.
ClicksNeedButton == [][clicks' > clicks => shown /\ page = "live"]_vars

\* A live page whose own check found Claude Code set up, with the command there and nothing left to
\* change, shows the button, unless the page goes first.
Offered ==
    (page = "live" /\ pages = Pages /\ flips = Flips /\ cmd /\ \E c \in pending : c.for = pages /\ c.setUp) ~> (shown \/ page = "gone")

\* Set Up Agent setting Claude Code up asks the live page's question again.
Reasked == [][setUp' /\ ~setUp /\ page = "live" => \E c \in pending' : c.for = pages]_vars

=============================================================================
