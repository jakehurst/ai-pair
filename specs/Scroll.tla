---- MODULE Scroll -------------------------------------------------------------
(******************************************************************************)
(* Follow mode's scrolling: `follow`, `keepInView`, `scroll`, `glide` and     *)
(* `renderCursor` in packages/vscode/src/editor.ts, with the arithmetic of    *)
(* view.ts. One file of NumLines lines, a view of ViewHeight lines whose top  *)
(* is `top`, and the target line follow mode keeps in view. `follow` starts a *)
(* scroll when the target is out of the view's middle half, unless one is     *)
(* under way; the scroll glides a line per frame to its landing, and stops    *)
(* early when the state stops following (a command running, a pause);         *)
(* afterwards it follows again if the target moved. A pause ends in `resume`, *)
(* which reveals the target; a command's end has to pick up a glide it cut    *)
(* short. Line numbers from 0.                                                *)
(******************************************************************************)
EXTENDS Integers

CONSTANTS
    NumLines,       \* the file's lines
    ViewHeight,     \* the view's height, in lines
    MaxMoves,       \* how many times the model moves the target
    MaxChanges,     \* how many times the model stops or starts following
    CatchUp         \* TRUE: a glide a command cut short goes on when the
                    \* state follows again

ASSUME AssumeNumLines == NumLines \in Nat \ {0}
ASSUME AssumeViewHeight == ViewHeight \in 1..NumLines
ASSUME AssumeMaxMoves == MaxMoves \in Nat
ASSUME AssumeMaxChanges == MaxChanges \in Nat
ASSUME AssumeCatchUp == CatchUp \in BOOLEAN

\* The file's line numbers.
Lines == 0..(NumLines - 1)

\* Why the state does not follow: the programmer paused, or a command runs.
Reasons == {"paused", "running"}

VARIABLES
    target,     \* the target's line
    top,        \* the view's top line
    scrolling,  \* a scroll is under way
    goal,       \* its landing
    from,       \* the target's line when it started
    away,       \* "no": the state follows; "paused", or "running" a command:
                \* it doesn't
    cut,        \* a glide stopped short, as the state stopped following
    moves,      \* target moves so far
    changes,    \* stops and starts of following so far
    beyond      \* editor.scrollBeyondLastLine, on by default

vars ==
    <<target, top, scrolling, goal, from, away, cut, moves, changes, beyond>>

--------------------------------------------------------------------------------

\* The values each variable can hold.
TypeOK ==
    /\ target \in Lines
    /\ top \in Lines
    /\ scrolling \in BOOLEAN
    /\ goal \in Lines
    /\ from \in Lines
    /\ away \in {"no"} \cup Reasons
    /\ cut \in BOOLEAN
    /\ moves \in Nat
    /\ changes \in Nat
    /\ beyond \in BOOLEAN

Max(a, b) == IF a > b THEN a ELSE b

Min(a, b) == IF a < b THEN a ELSE b

\* view.ts's `comfortable`: target line t is out of the top and bottom
\* quarters of a view whose top is line v.
Comfortable(t, v) ==
    LET at == t - v
    IN  4 * at >= ViewHeight /\ 4 * at < 3 * ViewHeight

\* As far as the editor scrolls: the last line at the top, or with
\* scrollBeyondLastLine off, at the bottom.
MaxTop == IF beyond THEN NumLines - 1 ELSE NumLines - ViewHeight

\* view.ts's `landing`: the top that puts target line t a third of the way
\* down, as far as the editor scrolls.
Landing(t) == Max(0, Min(MaxTop, t - ViewHeight \div 3))

\* The view is as it should be for target line t: t in its middle half, or
\* the view as near that as the editor scrolls.
InPlace(t) == Comfortable(t, top) \/ Landing(t) = top

\* A scroll starts, for target line t.
StartScroll(t) ==
    /\ scrolling' = TRUE
    /\ goal' = Landing(t)
    /\ from' = t

\* keepInView for target line t: a scroll, unless one is under way or the
\* view is as it should be.
KeepInView(t) ==
    IF ~scrolling /\ ~InPlace(t)
    THEN StartScroll(t)
    ELSE UNCHANGED <<scrolling, goal, from>>

--------------------------------------------------------------------------------

Init ==
    /\ target \in Lines
    /\ beyond \in BOOLEAN
    /\ top \in 0..MaxTop
    /\ scrolling = FALSE
    /\ goal = 0
    /\ from = 0
    /\ away = "no"
    /\ cut = FALSE
    /\ moves = 0
    /\ changes = 0

\* The target moves to line t, and the player calls follow(): keepInView,
\* when following. An action moves it, or the programmer's edit above it
\* while paused; while a command runs, the player waits for it.
Move(t) ==
    /\ away # "running"
    /\ target' = t
    /\ IF away = "no"
       THEN KeepInView(t)
       ELSE UNCHANGED <<scrolling, goal, from>>
    /\ moves' = moves + 1
    /\ UNCHANGED <<top, away, cut, changes, beyond>>

\* The state stops following, for reason why: the programmer pauses, or a
\* command runs (no actions meanwhile).
Leave(why) ==
    /\ away = "no"
    /\ away' = why
    /\ changes' = changes + 1
    /\ UNCHANGED <<target, top, scrolling, goal, from, cut, moves, beyond>>

\* It follows again. `resume` reveals the target, so follows; the command's
\* end only renders, which with CatchUp follows if a glide was cut short.
Return ==
    /\ away # "no"
    /\ IF away = "paused" \/ (CatchUp /\ cut)
       THEN /\ KeepInView(target)
            /\ cut' = FALSE
       ELSE UNCHANGED <<scrolling, goal, from, cut>>
    /\ away' = "no"
    /\ changes' = changes + 1
    /\ UNCHANGED <<target, top, moves, beyond>>

\* A frame of the glide: a line nearer; or it stops, done or not following.
\* Done, it follows again if the target is on another line than it started
\* for.
Glide ==
    /\ scrolling
    /\ IF away = "no" /\ top # goal
       THEN /\ top' = top + (IF goal > top THEN 1 ELSE -1)
            /\ UNCHANGED <<scrolling, goal, from, cut>>
       ELSE /\ IF away = "no" /\ target # from /\ ~InPlace(target)
               THEN StartScroll(target)
               ELSE /\ scrolling' = FALSE
                    /\ UNCHANGED <<goal, from>>
            /\ cut' = (cut \/ (away # "no"))
            /\ UNCHANGED top
    /\ UNCHANGED <<target, away, moves, changes, beyond>>

Next ==
    \/ \E t \in Lines : Move(t)
    \/ \E why \in Reasons : Leave(why)
    \/ Return
    \/ Glide

\* A glide under way goes on; moves and changes come when they do.
Fairness == WF_vars(Glide)

Spec == Init /\ [][Next]_vars /\ Fairness

--------------------------------------------------------------------------------

\* The target is in the view's middle half, or as near it as the editor
\* scrolls.
Settled == InPlace(target)

\* The view's top, and a glide's landing, are lines the editor scrolls to.
InRange == top \in 0..MaxTop /\ goal \in 0..MaxTop

\* Once the state follows for good, and the target stays, the view settles on
\* it. The target stays once the model's moves have run out. Code that never
\* scrolled would fail it, so it says something must happen.
Settles == <>[](away = "no" /\ moves = MaxMoves) => <>[]Settled

\* Moves and changes run out only so that the model is finite (6.8). It prunes
\* exactly the states guards `moves < MaxMoves` on Move and
\* `changes < MaxChanges` on Leave and Return never reached, so the behaviors,
\* and Settles' result, are the guards' (8.6).
Constraint == moves <= MaxMoves /\ changes <= MaxChanges

================================================================================
