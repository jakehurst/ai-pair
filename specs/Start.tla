---- MODULE Start --------------------------------------------------------------
(******************************************************************************)
(* The Start a session button in the panel's idle view (#107):                *)
(* packages/vscode/src/panel.ts (`ready`, `start`, Starter), setup.ts         *)
(* (claudeStarter), and webview/panel.ts (`canStart`, the click). A page asks *)
(* once, as it loads, whether a session can be started from here; the answer  *)
(* comes later, from Claude Code's configuration, whether its CLI is here,    *)
(* and whether a folder is open, all read at once. A click runs Claude        *)
(* Code's CLI in a terminal with the prompt. Pages come and go: the view is   *)
(* disposed, or its page reloads. The start keeps the Pair panel in front,    *)
(* leaves Claude Code's `preferredLocation` setting as the programmer chose   *)
(* it, runs one agent at a time, and its terminal closes when the agent exits *)
(* (#115). The click shows a note on the page, Starting a session with Claude *)
(* Code, until the agent's `start` lands or its terminal closes (#118).       *)
(******************************************************************************)
EXTENDS Naturals, PairDefs

CONSTANTS
    MaxPages,              \* how many pages the model loads
    MaxEnvironmentChanges, \* how often the model changes the environment: Set
                           \* Up Agent, Claude Code installed or removed
    MaxClicks,             \* how many clicks the model makes
    DropStale,             \* TRUE: only the latest question's answer reaches
                           \* the page (the fix)
    ReaskOnSetUp,          \* TRUE: Set Up Agent setting Claude Code up asks the
                           \* live page again (the fix)
    InTerminal,            \* TRUE: the CLI runs in a terminal never shown;
                           \* FALSE: Claude Code's open command (#115)
    OneAgent,              \* TRUE: no start while the last one's agent still
                           \* runs (the fix)
    NoteOnClick,           \* TRUE: the click shows the note on the page at once
                           \* (the fix)
    ClearOnExit            \* TRUE: the note goes when the agent's terminal
                           \* closes, session or not (the fix)

ASSUME AssumeMaxPages == MaxPages \in Nat \ {0}
ASSUME AssumeMaxEnvironmentChanges == MaxEnvironmentChanges \in Nat
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

\* No question: none has been answered on this page, or at all. Any value
\* that is not a question number will do, so the config makes it a model value
\* (6.20).
NoQuestion == CHOOSE v : v \notin Nat

VARIABLES
    page,               \* the webview's page: "loaded", "disposed"
    pages,              \* pages loaded so far; the live page's number
    visible,            \* the button is visible
    visibleFor,         \* the page whose check's answer last set `visible`;
                        \* NoPage when hidden
    setUp,              \* Claude Code's configuration runs the pair server
    cliAndFolder,       \* Claude Code's CLI is here, and a folder is open
    questions,          \* questions asked so far; the latest question's number
    unanswered,         \* checks asked and not yet answered: [q: the question's
                        \* number, for: the page, setUp: Claude Code was set up
                        \* when asked, cli: its CLI was here and a folder open
                        \* when asked]
    deliveredQuestion,  \* the question whose answer last reached the live page;
                        \* NoQuestion when none has since the page loaded
    newestAnswered,     \* the highest-numbered question answered so far;
                        \* NoQuestion when none
    environmentChanges, \* environment changes so far
    clicks,             \* clicks on the button
    starts,             \* times the starter ran
    location,           \* Claude Code's `preferredLocation` setting: "sidebar",
                        \* "panel"
    chosenLocation,     \* the location the programmer last chose
    sidebarShows,       \* what the sidebar shows: "pair", "claude"
    agents,             \* agents started from the button and still running,
                        \* each in its own terminal
    startingNoteShown,  \* the page shows the note: a session is starting
    sessionLive         \* the agent's `start` has landed, and no `end` since

vars ==
    <<page, pages, visible, visibleFor, setUp, cliAndFolder, questions,
      unanswered, deliveredQuestion, newestAnswered, environmentChanges, clicks,
      starts, location, chosenLocation, sidebarShows, agents, startingNoteShown,
      sessionLive>>

\* What a start changes: the setting, the sidebar, and the agents.
startVars == <<location, chosenLocation, sidebarShows, agents>>

--------------------------------------------------------------------------------

\* The values each variable can hold.
TypeOK ==
    /\ page \in PageStates
    /\ pages \in Nat \ {0}
    /\ visible \in BOOLEAN
    /\ visibleFor \in (1..pages) \cup {NoPage}
    /\ setUp \in BOOLEAN
    /\ cliAndFolder \in BOOLEAN
    /\ questions \in Nat \ {0}
    /\ unanswered \subseteq [question: 1..questions, page: 1..pages,
                             setUp: BOOLEAN,
                         cliAndFolder: BOOLEAN]
    /\ deliveredQuestion \in (1..questions) \cup {NoQuestion}
    /\ newestAnswered \in (1..questions) \cup {NoQuestion}
    /\ environmentChanges \in Nat
    /\ clicks \in Nat
    /\ starts \in Nat
    /\ location \in Locations
    /\ chosenLocation \in Locations
    /\ sidebarShows \in {"pair", "claude"}
    /\ agents \in Nat
    /\ startingNoteShown \in BOOLEAN
    /\ sessionLive \in BOOLEAN

--------------------------------------------------------------------------------

Init ==
    /\ page = "loaded"
    /\ pages = 1
    /\ visible = FALSE
    /\ visibleFor = NoPage
    /\ setUp \in BOOLEAN
    /\ cliAndFolder \in BOOLEAN
    /\ questions = 1
    /\ unanswered = {[question |-> 1, page |-> 1, setUp |-> setUp,
                      cliAndFolder |-> cliAndFolder]}
    /\ deliveredQuestion = NoQuestion
    /\ newestAnswered = NoQuestion
    /\ environmentChanges = 0
    /\ clicks = 0
    /\ starts = 0
    /\ location \in Locations
    /\ chosenLocation = location
    /\ sidebarShows = "pair"
    /\ agents = 0
    /\ startingNoteShown = FALSE
    /\ sessionLive = FALSE

\* `ready`: a page loads with its button hidden, and asks once. `askStart`
\* numbers the question, and `available()` reads the configuration and the CLI
\* at once; the answer comes when the promise resolves.
LoadPage ==
    /\ page' = "loaded"
    /\ pages' = pages + 1
    /\ visible' = FALSE
    /\ visibleFor' = NoPage
    /\ questions' = questions + 1
    /\ unanswered' =
           unanswered \cup {[question |-> questions + 1, page |-> pages + 1,
                            setUp |-> setUp, cliAndFolder |-> cliAndFolder]}
    /\ deliveredQuestion' = NoQuestion
    /\ startingNoteShown' = FALSE
    /\ UNCHANGED <<setUp, cliAndFolder, newestAnswered, environmentChanges,
                   clicks, starts, startVars, sessionLive>>

\* onDidDispose: the view closes, and its page with it.
Dispose ==
    /\ page = "loaded"
    /\ page' = "disposed"
    /\ visible' = FALSE
    /\ visibleFor' = NoPage
    /\ startingNoteShown' = FALSE
    /\ UNCHANGED <<pages, setUp, cliAndFolder, questions, unanswered,
                   deliveredQuestion, newestAnswered, environmentChanges,
                   clicks, starts, startVars, sessionLive>>

\* `available()` resolves for one check, in any order, with what it read when
\* asked; the panel posts canStart to its view, if any. With DropStale, only
\* the latest question's answer.
AnswerCheck(c) ==
    LET value == c.setUp /\ c.cliAndFolder
        answered == IF value THEN c.page ELSE NoPage
        deliver == page = "loaded" /\ (~DropStale \/ c.question = questions)
    IN  /\ c \in unanswered
        /\ visible' = IF deliver THEN value ELSE visible
        /\ visibleFor' = IF deliver THEN answered ELSE visibleFor
        /\ deliveredQuestion' = IF deliver THEN c.question
                                ELSE deliveredQuestion
        /\ newestAnswered' =
               IF newestAnswered = NoQuestion \/ c.question > newestAnswered
               THEN c.question
               ELSE newestAnswered
        /\ unanswered' = unanswered \ {c}
        /\ UNCHANGED <<page, pages, setUp, cliAndFolder, questions,
                       environmentChanges, clicks, starts, startVars,
                       startingNoteShown, sessionLive>>

\* Set Up Agent run or undone. With ReaskOnSetUp, setting Claude Code up asks
\* the live page again.
FlipSetUp ==
    /\ setUp' = ~setUp
    /\ \/ /\ ReaskOnSetUp /\ ~setUp /\ page = "loaded"
          /\ questions' = questions + 1
          /\ unanswered' =
                 unanswered \cup {[question |-> questions + 1, page |-> pages,
                                  setUp |-> TRUE,
                                  cliAndFolder |-> cliAndFolder]}
       \/ /\ ~(ReaskOnSetUp /\ ~setUp /\ page = "loaded")
          /\ UNCHANGED <<questions, unanswered>>
    /\ environmentChanges' = environmentChanges + 1
    /\ UNCHANGED <<page, pages, visible, visibleFor, cliAndFolder,
                   deliveredQuestion, newestAnswered, clicks, starts, startVars,
                   startingNoteShown, sessionLive>>

\* Claude Code's CLI installed or removed, or the folder closed.
FlipCliAndFolder ==
    /\ cliAndFolder' = ~cliAndFolder
    /\ environmentChanges' = environmentChanges + 1
    /\ UNCHANGED <<page, pages, visible, visibleFor, setUp, questions,
                   unanswered, deliveredQuestion, newestAnswered, clicks,
                   starts, startVars, startingNoteShown, sessionLive>>

\* The click posts `start`; the panel runs the starter. In a terminal: the CLI
\* starts with the prompt, sent at once, and nothing is shown. Through Claude
\* Code's open command: Claude Code comes to the front with the prompt in its
\* input, and writes "panel" to the setting. A start while an agent from the
\* last one runs is refused, with OneAgent; the click still counts as a run of
\* the starter.
Click ==
    /\ page = "loaded"
    /\ visible
    /\ ~sessionLive
    /\ clicks' = clicks + 1
    /\ starts' = starts + 1
    /\ location' = IF InTerminal THEN location ELSE "panel"
    /\ sidebarShows' = IF InTerminal THEN sidebarShows ELSE "claude"
    /\ agents' = IF OneAgent /\ agents > 0 THEN agents ELSE agents + 1
    /\ startingNoteShown' = IF NoteOnClick THEN TRUE ELSE startingNoteShown
    /\ UNCHANGED <<page, pages, visible, visibleFor, setUp, cliAndFolder,
                   questions, unanswered, deliveredQuestion, newestAnswered,
                   environmentChanges, chosenLocation, sessionLive>>

\* An agent ends its turn when its session ends; `claude -p` exits, and its
\* terminal closes.
AgentExits ==
    /\ agents > 0
    /\ agents' = agents - 1
    /\ startingNoteShown' = IF ClearOnExit THEN FALSE ELSE startingNoteShown
    /\ UNCHANGED <<page, pages, visible, visibleFor, setUp, cliAndFolder,
                   questions, unanswered, deliveredQuestion, newestAnswered,
                   environmentChanges, clicks, starts, location, chosenLocation,
                   sidebarShows, sessionLive>>

\* The programmer sets Claude Code's preferred location to l, or Claude Code's
\* own Open in Side Bar does.
Choose(l) ==
    /\ location' = l
    /\ chosenLocation' = l
    /\ UNCHANGED <<page, pages, visible, visibleFor, setUp, cliAndFolder,
                   questions, unanswered, deliveredQuestion, newestAnswered,
                   environmentChanges, clicks, starts, sidebarShows, agents,
                   startingNoteShown, sessionLive>>

\* The agent's `start` lands: the `session` event reaches the page, and the
\* note goes.
StartSession ==
    /\ ~sessionLive
    /\ startingNoteShown' = FALSE
    /\ sessionLive' = TRUE
    /\ UNCHANGED <<page, pages, visible, visibleFor, setUp, cliAndFolder,
                   questions, unanswered, deliveredQuestion, newestAnswered,
                   environmentChanges, clicks, starts, startVars>>

\* The session ends: the idle view, and its button, are back.
EndSession ==
    /\ sessionLive
    /\ sessionLive' = FALSE
    /\ UNCHANGED <<page, pages, visible, visibleFor, setUp, cliAndFolder,
                   questions, unanswered, deliveredQuestion, newestAnswered,
                   environmentChanges, clicks, starts, startVars,
                   startingNoteShown>>

Next ==
    \/ LoadPage
    \/ Dispose
    \/ \E c \in unanswered : AnswerCheck(c)
    \/ FlipSetUp
    \/ FlipCliAndFolder
    \/ Click
    \/ AgentExits
    \/ \E l \in Locations : Choose(l)
    \/ StartSession
    \/ EndSession

\* Every check is answered in the end, and every agent exits.
Fairness ==
    /\ WF_vars(\E c \in unanswered : AnswerCheck(c))
    /\ WF_vars(AgentExits)

Spec == Init /\ [][Next]_vars /\ Fairness

--------------------------------------------------------------------------------

\* The button shows only on a live page, set by that page's own check. A stale
\* answer breaks this.
OwnAnswer == visible => (page = "loaded" /\ visibleFor = pages)

\* A button that appears was earned: set up, and the CLI there, when asked.
GroundedProp ==
    [][\A c \in unanswered :
           (AnswerCheck(c) /\ ~visible /\ visible') => (c.setUp
                                                        /\ c.cliAndFolder)]_vars

\* An earlier question's answer never overrides a later one's on the live
\* page: the answer that last reached it is the newest answered since it
\* loaded. An answer that lands after the reask's breaks this.
LatestAnswer == (page = "loaded" /\ deliveredQuestion # NoQuestion)
    => deliveredQuestion = newestAnswered

\* One run per click, and no run without one.
StartsAreClicks == starts = clicks

\* The page has no button to click while it is hidden.
ClicksNeedButtonProp ==
    [][(clicks' > clicks) => (visible /\ page = "loaded")]_vars

\* A live page whose latest check, still unanswered, found Claude Code set up,
\* with the command there, and nothing left to change: the model loads no
\* more pages and makes no more flips.
OfferDue ==
    /\ page = "loaded"
    /\ pages = MaxPages
    /\ environmentChanges = MaxEnvironmentChanges
    /\ \E c \in unanswered : c.question = questions /\ c.setUp /\ c.cliAndFolder

\* Such a page shows the button, unless the page goes first. A page that never
\* showed it would fail this, so it says something must happen.
Offered == OfferDue ~> (visible \/ page = "disposed")

\* A start leaves Claude Code's preferred location as the programmer chose it.
KeepsLocation == location = chosenLocation

\* A start leaves the Pair panel in front.
StaysOnPair == sidebarShows = "pair"

\* At most one agent started from the button runs at a time.
OneAtATime == agents <= 1

\* A start runs an agent: a click with none running starts one.
StartsProp == [][(clicks' > clicks /\ agents = 0) => (agents' = 1)]_vars

\* An agent's terminal closes once it is done.
Closes == (agents > 0) ~> (agents = 0)

\* Set Up Agent setting Claude Code up asks the live page's question again.
ReaskedProp ==
    [][(setUp' /\ ~setUp /\ page = "loaded") =>
           (\E c \in unanswered' : c.page = pages)]_vars

\* The click shows the note at once (#118).
AcknowledgedProp == [][(clicks' > clicks) => startingNoteShown']_vars

\* The note shows only on a live page, and never during a session.
NoteUntilSession == startingNoteShown => (page = "loaded" /\ ~sessionLive)

\* The note goes in the end, even when the agent exits without starting a
\* session.
NoteGoes == startingNoteShown ~> ~startingNoteShown

\* Pages, flips, and clicks run out only so that the model is finite (6.8). It
\* prunes exactly the states the guards `pages < MaxPages`,
\* `environmentChanges < MaxEnvironmentChanges`, and `clicks < MaxClicks` never
\* reached. AnswerCheck and AgentExits, the actions under fairness, change none
\* of the three, so no step fairness demands is pruned, and the results of
\* Offered, Closes, and NoteGoes are the guards' (8.6).
Constraint ==
    /\ pages <= MaxPages
    /\ environmentChanges <= MaxEnvironmentChanges
    /\ clicks <= MaxClicks

================================================================================
