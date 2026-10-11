---- MODULE Start --------------------------------------------------------------
(******************************************************************************)
(* The Start a session button in the panel's idle view (#107):                *)
(* packages/vscode/src/panel.ts (`ready`, `start`, Starter), setup.ts         *)
(* (claudeStarter), and webview/panel.ts (`canStart`, the click). A page asks *)
(* once, as it loads, whether a session can be started from here; the answer  *)
(* comes later, from Claude Code's configuration (read at once) and whether   *)
(* its CLI is here (read when the promise resolves). A click runs Claude      *)
(* Code's CLI in a terminal with the prompt. Pages come and go: the view is   *)
(* disposed, or its page reloads. The start keeps the Pair panel in front,    *)
(* leaves Claude Code's `preferredLocation` setting as the programmer chose   *)
(* it, runs one agent at a time, and its terminal closes when the agent exits *)
(* (#115). The click shows a note on the page, Starting a session with Claude *)
(* Code, until the agent's `start` lands or its terminal closes (#118).       *)
(******************************************************************************)
EXTENDS Naturals

CONSTANTS
    MaxPages,       \* how many pages the model loads
    MaxFlips,       \* how often the model changes the environment: Set Up
                    \* Agent, Claude Code installed or removed
    MaxClicks,      \* how many clicks the model makes
    DropStale,      \* TRUE: an answer reaches only the page that asked (the
                    \* fix)
    ReaskOnSetUp,   \* TRUE: Set Up Agent setting Claude Code up asks the live
                    \* page again (the fix)
    InTerminal,     \* TRUE: the CLI runs in a terminal never shown; FALSE:
                    \* Claude Code's open command (#115)
    OneAgent,       \* TRUE: no start while the last one's agent still runs
                    \* (the fix)
    NoteOnClick,    \* TRUE: the click shows the note on the page at once (the
                    \* fix)
    ClearOnExit     \* TRUE: the note goes when the agent's terminal closes,
                    \* session or not (the fix)

ASSUME AssumeMaxPages == MaxPages \in Nat \ {0}
ASSUME AssumeMaxFlips == MaxFlips \in Nat
ASSUME AssumeMaxClicks == MaxClicks \in Nat
ASSUME AssumeDropStale == DropStale \in BOOLEAN
ASSUME AssumeReaskOnSetUp == ReaskOnSetUp \in BOOLEAN
ASSUME AssumeInTerminal == InTerminal \in BOOLEAN
ASSUME AssumeOneAgent == OneAgent \in BOOLEAN
ASSUME AssumeNoteOnClick == NoteOnClick \in BOOLEAN
ASSUME AssumeClearOnExit == ClearOnExit \in BOOLEAN

\* The values of Claude Code's `preferredLocation` setting.
Locations == {"sidebar", "panel"}

\* No page: the button is hidden, so no page's answer set it. Any value that is
\* not a page number will do, so the config makes it a model value (6.20).
NoPage == CHOOSE v : v \notin Nat

VARIABLES
    page,       \* the webview's page: "live", "gone"
    pages,      \* pages loaded so far; the live page's number
    shown,      \* the button is visible
    shownFor,   \* the page whose check's answer last set `shown`; NoPage when
                \* hidden
    setUp,      \* Claude Code's configuration runs the pair server
    cmd,        \* Claude Code's CLI is here, and a folder is open
    pending,    \* checks asked and not yet answered: [for: the page, setUp:
                \* Claude Code was set up when asked]
    flips,      \* environment changes so far
    clicks,     \* clicks on the button
    runs,       \* times the starter ran
    location,   \* Claude Code's `preferredLocation` setting: "sidebar",
                \* "panel"
    chosen,     \* the location the programmer last chose
    front,      \* what the sidebar shows: "pair", "claude"
    agents,     \* agents started from the button and still running, each in
                \* its own terminal
    note,       \* the page shows the note: a session is starting
    session     \* the agent's `start` has landed, and no `end` since

vars ==
    <<page, pages, shown, shownFor, setUp, cmd, pending, flips, clicks, runs,
      location, chosen, front, agents, note, session>>

\* What a start changes: the setting, the sidebar, and the agents.
startVars == <<location, chosen, front, agents>>

--------------------------------------------------------------------------------

\* The values each variable can hold.
TypeOK ==
    /\ page \in {"live", "gone"}
    /\ pages \in Nat \ {0}
    /\ shown \in BOOLEAN
    /\ shownFor \in (1..pages) \cup {NoPage}
    /\ setUp \in BOOLEAN
    /\ cmd \in BOOLEAN
    /\ pending \subseteq [for: 1..pages, setUp: BOOLEAN]
    /\ flips \in Nat
    /\ clicks \in Nat
    /\ runs \in Nat
    /\ location \in Locations
    /\ chosen \in Locations
    /\ front \in {"pair", "claude"}
    /\ agents \in Nat
    /\ note \in BOOLEAN
    /\ session \in BOOLEAN

--------------------------------------------------------------------------------

Init ==
    /\ page = "live"
    /\ pages = 1
    /\ shown = FALSE
    /\ shownFor = NoPage
    /\ setUp \in BOOLEAN
    /\ cmd \in BOOLEAN
    /\ pending = {[for |-> 1, setUp |-> setUp]}
    /\ flips = 0
    /\ clicks = 0
    /\ runs = 0
    /\ location \in Locations
    /\ chosen = location
    /\ front = "pair"
    /\ agents = 0
    /\ note = FALSE
    /\ session = FALSE

\* `ready`: a page loads with its button hidden, and asks once; isSetUp is read
\* now, the CLI later.
LoadPage ==
    /\ page' = "live"
    /\ pages' = pages + 1
    /\ shown' = FALSE
    /\ shownFor' = NoPage
    /\ pending' = pending \cup {[for |-> pages + 1, setUp |-> setUp]}
    /\ note' = FALSE
    /\ UNCHANGED <<setUp, cmd, flips, clicks, runs, startVars, session>>

\* onDidDispose: the view closes, and its page with it.
Dispose ==
    /\ page = "live"
    /\ page' = "gone"
    /\ shown' = FALSE
    /\ shownFor' = NoPage
    /\ note' = FALSE
    /\ UNCHANGED <<pages, setUp, cmd, pending, flips, clicks, runs, startVars,
                   session>>

\* `available()` resolves for one check, in any order; the panel posts canStart
\* to its view, if any. With DropStale, only to the page that asked.
Answer(c) ==
    LET value == c.setUp /\ cmd
        answered == IF value THEN c.for ELSE NoPage
        deliver == page = "live" /\ (~DropStale \/ c.for = pages)
    IN  /\ c \in pending
        /\ shown' = IF deliver THEN value ELSE shown
        /\ shownFor' = IF deliver THEN answered ELSE shownFor
        /\ pending' = pending \ {c}
        /\ UNCHANGED <<page, pages, setUp, cmd, flips, clicks, runs, startVars,
                       note, session>>

\* Set Up Agent run or undone. With ReaskOnSetUp, setting Claude Code up asks
\* the live page again.
FlipSetUp ==
    /\ setUp' = ~setUp
    /\ pending' =
           IF ReaskOnSetUp /\ ~setUp /\ page = "live"
           THEN pending \cup {[for |-> pages, setUp |-> TRUE]}
           ELSE pending
    /\ flips' = flips + 1
    /\ UNCHANGED <<page, pages, shown, shownFor, cmd, clicks, runs, startVars,
                   note, session>>

\* Claude Code's CLI installed or removed, or the folder closed.
FlipCmd ==
    /\ cmd' = ~cmd
    /\ flips' = flips + 1
    /\ UNCHANGED <<page, pages, shown, shownFor, setUp, pending, clicks, runs,
                   startVars, note, session>>

\* The click posts `start`; the panel runs the starter. In a terminal: the CLI
\* starts with the prompt, sent at once, and nothing is shown. Through Claude
\* Code's open command: Claude Code comes to the front with the prompt in its
\* input, and writes "panel" to the setting. A start while an agent from the
\* last one runs is refused, with OneAgent; the click still counts as a run of
\* the starter.
Click ==
    /\ page = "live"
    /\ shown
    /\ ~session
    /\ clicks' = clicks + 1
    /\ runs' = runs + 1
    /\ location' = IF InTerminal THEN location ELSE "panel"
    /\ front' = IF InTerminal THEN front ELSE "claude"
    /\ agents' = IF OneAgent /\ agents > 0 THEN agents ELSE agents + 1
    /\ note' = IF NoteOnClick THEN TRUE ELSE note
    /\ UNCHANGED <<page, pages, shown, shownFor, setUp, cmd, pending, flips,
                   chosen, session>>

\* An agent ends its turn when its session ends; `claude -p` exits, and its
\* terminal closes.
Exit ==
    /\ agents > 0
    /\ agents' = agents - 1
    /\ note' = IF ClearOnExit THEN FALSE ELSE note
    /\ UNCHANGED <<page, pages, shown, shownFor, setUp, cmd, pending, flips,
                   clicks, runs, location, chosen, front, session>>

\* The programmer sets Claude Code's preferred location to l, or Claude Code's
\* own Open in Side Bar does.
Choose(l) ==
    /\ location' = l
    /\ chosen' = l
    /\ UNCHANGED <<page, pages, shown, shownFor, setUp, cmd, pending, flips,
                   clicks, runs, front, agents, note, session>>

\* The agent's `start` lands: the `session` event reaches the page, and the
\* note goes.
StartSession ==
    /\ ~session
    /\ note' = FALSE
    /\ session' = TRUE
    /\ UNCHANGED <<page, pages, shown, shownFor, setUp, cmd, pending, flips,
                   clicks, runs, startVars>>

\* The session ends: the idle view, and its button, are back.
EndSession ==
    /\ session
    /\ session' = FALSE
    /\ UNCHANGED <<page, pages, shown, shownFor, setUp, cmd, pending, flips,
                   clicks, runs, startVars, note>>

Next ==
    \/ LoadPage
    \/ Dispose
    \/ \E c \in pending : Answer(c)
    \/ FlipSetUp
    \/ FlipCmd
    \/ Click
    \/ Exit
    \/ \E l \in Locations : Choose(l)
    \/ StartSession
    \/ EndSession

\* Every check is answered in the end, and every agent exits.
Fairness ==
    /\ WF_vars(\E c \in pending : Answer(c))
    /\ WF_vars(Exit)

Spec == Init /\ [][Next]_vars /\ Fairness

--------------------------------------------------------------------------------

\* The button shows only on a live page, set by that page's own check. A stale
\* answer breaks this.
OwnAnswer == shown => (page = "live" /\ shownFor = pages)

\* A button that appears was earned: set up when asked, and the CLI there when
\* answered.
GroundedProp ==
    [][\A c \in pending :
           (Answer(c) /\ ~shown /\ shown') => (c.setUp /\ cmd)]_vars

\* One run per click, and no run without one.
RunsAreClicks == runs = clicks

\* The page has no button to click while it is hidden.
ClicksNeedButtonProp ==
    [][(clicks' > clicks) => (shown /\ page = "live")]_vars

\* A live page whose own check found Claude Code set up, with the command
\* there, and nothing left to change: the model loads no more pages and makes
\* no more flips.
OfferDue ==
    /\ page = "live"
    /\ pages = MaxPages
    /\ flips = MaxFlips
    /\ cmd
    /\ \E c \in pending : c.for = pages /\ c.setUp

\* Such a page shows the button, unless the page goes first. A page that never
\* showed it would fail this, so it says something must happen.
Offered == OfferDue ~> (shown \/ page = "gone")

\* A start leaves Claude Code's preferred location as the programmer chose it.
KeepsLocation == location = chosen

\* A start leaves the Pair panel in front.
StaysOnPair == front = "pair"

\* At most one agent started from the button runs at a time.
OneAtATime == agents <= 1

\* A start runs an agent: a click with none running starts one.
StartsProp == [][(clicks' > clicks /\ agents = 0) => (agents' = 1)]_vars

\* An agent's terminal closes once it is done.
Closes == (agents > 0) ~> (agents = 0)

\* Set Up Agent setting Claude Code up asks the live page's question again.
ReaskedProp ==
    [][(setUp' /\ ~setUp /\ page = "live") =>
           (\E c \in pending' : c.for = pages)]_vars

\* The click shows the note at once (#118).
AcknowledgedProp == [][(clicks' > clicks) => note']_vars

\* The note shows only on a live page, and never during a session.
NoteUntilSession == note => (page = "live" /\ ~session)

\* The note goes in the end, even when the agent exits without starting a
\* session.
Settles == note ~> ~note

\* Pages, flips, and clicks run out only so that the model is finite (6.8). It
\* prunes exactly the states the guards `pages < MaxPages`, `flips < MaxFlips`,
\* and `clicks < MaxClicks` never reached. Answer and Exit, the actions under
\* fairness, change none of the three, so no step fairness demands is pruned,
\* and the results of Offered, Closes, and Settles are the guards' (8.6).
Constraint ==
    /\ pages <= MaxPages
    /\ flips <= MaxFlips
    /\ clicks <= MaxClicks

================================================================================
