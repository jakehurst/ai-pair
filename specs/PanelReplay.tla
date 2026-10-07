----------------------------- MODULE PanelReplay -----------------------------
\* The panel's event log and its replay: `post` and `ready` in packages/vscode/src/panel.ts, and
\* how the page sets its session state from them (`setActive` for a `session` event, in
\* panelHtml.ts). Panel in #19: a view created afterwards shows what the live view did.
\* Events are a session starting, a session ending, or anything else (say, state, a reply...).
EXTENDS Naturals, Sequences

CONSTANTS
    MaxLog,       \* MAX_LOG, scaled down
    Posts,        \* how many events are posted in a run
    KeepSession   \* TRUE: cutting the log keeps its last `session` event (fix for #54)

VARIABLES
    log,     \* NarrationPanel.log
    live,    \* the session state of a view that saw every event: the last `session` event's
    posts    \* events posted so far

vars == <<log, live, posts>>

Init == log = <<>> /\ live = "none" /\ posts = 0

IsSession(e) == e \in {"start", "end"}

\* The last session event in a sequence, or "none".
RECURSIVE LastSession(_)
LastSession(s) ==
    IF s = <<>> THEN "none"
    ELSE IF IsSession(s[Len(s)]) THEN s[Len(s)] ELSE LastSession(SubSeq(s, 1, Len(s) - 1))

\* post(): the event goes on the log, and the oldest are cut beyond MaxLog. With KeepSession, a
\* cut that takes the log's last session event puts it back at the front.
Post(e) ==
    /\ posts < Posts /\ posts' = posts + 1
    /\ live' = IF IsSession(e) THEN e ELSE live
    /\ LET appended == Append(log, e)
           cut == IF Len(appended) > MaxLog THEN SubSeq(appended, Len(appended) - MaxLog + 1, Len(appended)) ELSE appended
           dropped == SubSeq(appended, 1, Len(appended) - Len(cut))
       IN log' = IF KeepSession /\ LastSession(cut) = "none" /\ LastSession(dropped) # "none"
                    THEN <<LastSession(dropped)>> \o cut
                    ELSE cut

Next == \E e \in {"start", "end", "other"} : Post(e)

Spec == Init /\ [][Next]_vars

\* A view created now replays the log: its session state is the log's last session event.
ReplayShowsSession == LastSession(log) = live

\* The log stays bounded: at most one event beyond MaxLog.
Bounded == Len(log) <= MaxLog + 1

=============================================================================
