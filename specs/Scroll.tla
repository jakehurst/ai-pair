-------------------------------- MODULE Scroll --------------------------------
\* Follow mode's scrolling: `follow`, `keepInView`, `scroll`, `glide` and `renderCursor` in
\* packages/vscode/src/editor.ts, with the arithmetic of view.ts. One file of L lines, a view of H
\* lines whose top is `top`, and the target line follow mode keeps in view. `follow` starts a
\* scroll when the target is out of the view's middle half, unless one is under way; the scroll
\* glides a line per frame to its landing, and stops early when the state stops following (a
\* command running, a pause); afterwards it follows again if the target moved. A pause ends in
\* `resume`, which reveals the target; a command's end has to pick up a glide it cut short.
\* Line numbers from 0.
EXTENDS Integers

CONSTANTS
    L, H,             \* the file's lines, the view's height
    Moves, Changes,   \* how many target moves, and state changes, in a run
    CatchUp           \* TRUE: a glide a command cut short goes on when the state follows again

VARIABLES
    target,     \* the target's line
    top,        \* the view's top line
    scrolling,  \* a scroll is under way
    goal,       \* its landing
    from,       \* the target's line when it started
    away,       \* "no": the state follows; "paused", or "running" a command: it doesn't
    cut,        \* a glide stopped short, as the state stopped following
    moves, changes

vars == <<target, top, scrolling, goal, from, away, cut, moves, changes>>

Max(a, b) == IF a > b THEN a ELSE b
Min(a, b) == IF a < b THEN a ELSE b

\* view.ts: comfortable, landing (no scrolling beyond the end).
Comfortable(t, v) == LET at == t - v IN 4 * at >= H /\ 4 * at < 3 * H
Landing(t) == Max(0, Min(L - H, t - H \div 3))

Init ==
    /\ target \in 0..(L - 1) /\ top \in 0..(L - H) /\ scrolling = FALSE /\ goal = 0 /\ from = 0
    /\ away = "no" /\ cut = FALSE /\ moves = 0 /\ changes = 0

\* keepInView for target line t: a scroll, unless one is under way or the view is as it should be.
Keep(t) ==
    IF ~scrolling /\ ~Comfortable(t, top) /\ Landing(t) # top
        THEN scrolling' = TRUE /\ goal' = Landing(t) /\ from' = t
        ELSE UNCHANGED <<scrolling, goal, from>>

\* The target moves, and the player calls follow(): keepInView, when following. An action moves it,
\* or the programmer's edit above it while paused; while a command runs, the player waits for it.
Move ==
    /\ moves < Moves /\ moves' = moves + 1 /\ away # "running"
    /\ \E t \in 0..(L - 1) : target' = t /\ IF away = "no" THEN Keep(t) ELSE UNCHANGED <<scrolling, goal, from>>
    /\ UNCHANGED <<top, away, cut, changes>>

\* The state stops following: the programmer pauses, or a command runs (no actions meanwhile).
Leave ==
    /\ away = "no" /\ changes < Changes /\ changes' = changes + 1
    /\ \E why \in {"paused", "running"} : away' = why
    /\ UNCHANGED <<target, top, scrolling, goal, from, cut, moves>>

\* It follows again. `resume` reveals the target, so follows; the command's end only renders,
\* which with CatchUp follows if a glide was cut short.
Return ==
    /\ away # "no" /\ changes < Changes /\ changes' = changes + 1 /\ away' = "no"
    /\ IF away = "paused" \/ (CatchUp /\ cut)
          THEN Keep(target) /\ cut' = FALSE
          ELSE UNCHANGED <<scrolling, goal, from, cut>>
    /\ UNCHANGED <<target, top, moves>>

\* A frame of the glide: a line nearer; or it stops, done or not following. Done, it follows
\* again if the target is on another line than it started for.
Frame ==
    /\ scrolling
    /\ IF away = "no" /\ top # goal
          THEN top' = top + (IF goal > top THEN 1 ELSE -1) /\ UNCHANGED <<scrolling, goal, from, cut>>
          ELSE /\ UNCHANGED top
               /\ cut' = (cut \/ away # "no")
               /\ IF away = "no" /\ target # from /\ ~Comfortable(target, top) /\ Landing(target) # top
                     THEN scrolling' = TRUE /\ goal' = Landing(target) /\ from' = target
                     ELSE scrolling' = FALSE /\ UNCHANGED <<goal, from>>
    /\ UNCHANGED <<target, away, moves, changes>>

Next == Move \/ Leave \/ Return \/ Frame

Spec == Init /\ [][Next]_vars /\ WF_vars(Frame)

\* Settled: the target is in the view's middle half, or as near it as the editor scrolls.
Settled == Comfortable(target, top) \/ Landing(target) = top

\* One scroll at a time, to a landing the editor can reach.
InRange == top \in 0..(L - H) /\ goal \in 0..(L - H)

\* Once the state follows for good, and the target stays, the view settles on it.
Settles == <>[](away = "no" /\ moves = Moves) => <>[]Settled

=============================================================================
