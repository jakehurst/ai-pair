---- MODULE PanelReplay --------------------------------------------------------
(******************************************************************************)
(* The panel's event log and its replay: `post` and `ready` in                *)
(* packages/vscode/src/panel.ts, and how the page sets its session state from *)
(* them (`setActive` for a `session` event, in webview/panel.ts). Panel in    *)
(* #19: a view created afterwards shows what the live view did. Events are a  *)
(* session starting, a session ending, or anything else (say, state, a        *)
(* reply...).                                                                 *)
(******************************************************************************)
EXTENDS Naturals, Sequences

CONSTANTS
    MaxLog,         \* MAX_LOG, scaled down
    MaxPosts,       \* how many events the model posts
    KeepSession     \* TRUE: cutting the log keeps its last `session` event
                    \* (the fix for #54)

ASSUME AssumeMaxLog == MaxLog \in Nat \ {0}
ASSUME AssumeMaxPosts == MaxPosts \in Nat
ASSUME AssumeKeepSession == KeepSession \in BOOLEAN

\* The events: a session starting or ending, or anything else.
SessionEvents == {"start", "end"}
Events == SessionEvents \cup {"other"}

\* No session event yet. Any value that is not a session event will do, so
\* the config makes it a model value (6.20).
NoSession == CHOOSE v : v \notin SessionEvents

VARIABLES
    log,     \* NarrationPanel.log
    live,    \* the session state of a view that saw every event: the last
             \* session event, or NoSession
    posts    \* events posted so far

vars == <<log, live, posts>>

--------------------------------------------------------------------------------

\* The values each variable can hold.
TypeOK ==
    /\ log \in Seq(Events)
    /\ live \in SessionEvents \cup {NoSession}
    /\ posts \in Nat

IsSession(e) == e \in SessionEvents

\* The last session event in `s`, or NoSession if it has none. CHOOSE takes
\* the largest index that holds one, and there is exactly one largest.
LastSession(s) ==
    LET sessions == {i \in 1..Len(s) : IsSession(s[i])}
    IN  IF sessions = {}
        THEN NoSession
        ELSE s[CHOOSE i \in sessions : \A j \in sessions : j <= i]

--------------------------------------------------------------------------------

Init ==
    /\ log = <<>>
    /\ live = NoSession
    /\ posts = 0

\* post(): the event goes on the log, and the oldest are cut beyond MaxLog.
\* With KeepSession, a cut that takes the log's last session event puts it
\* back at the front.
Post(e) ==
    LET appended == Append(log, e)
        cut ==
            IF Len(appended) > MaxLog
            THEN SubSeq(appended, Len(appended) - MaxLog + 1, Len(appended))
            ELSE appended
        dropped == SubSeq(appended, 1, Len(appended) - Len(cut))
        restore ==
            /\ KeepSession
            /\ LastSession(cut) = NoSession
            /\ LastSession(dropped) # NoSession
    IN  /\ log' = IF restore THEN <<LastSession(dropped)>> \o cut ELSE cut
        /\ live' = IF IsSession(e) THEN e ELSE live
        /\ posts' = posts + 1

Next == \E e \in Events : Post(e)

Spec == Init /\ [][Next]_vars

--------------------------------------------------------------------------------

\* A view created now replays the log: its session state is the log's
\* last session event.
ReplayShowsSession == LastSession(log) = live

\* The log stays bounded: at most one event beyond MaxLog.
Bounded == Len(log) <= MaxLog + 1

\* Something must happen: once an event is posted, the log holds one.
LogsPosts == posts > 0 => log # <<>>

\* Posts run out only so that the model is finite (6.8).
Constraint == posts <= MaxPosts

================================================================================
