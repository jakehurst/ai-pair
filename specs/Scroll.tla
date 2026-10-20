---- MODULE Scroll -------------------------------------------------------------
(******************************************************************************)
(* Follow mode's scrolling: `follow`, `keepInView`, `scroll`, `glide` and     *)
(* `renderCursor` in packages/vscode/src/editor.ts, with the arithmetic of    *)
(* view.ts. One file of NumLines lines, a view of ViewHeight lines whose top  *)
(* is `viewTop`, and the target line follow mode keeps in view. `follow`      *)
(* starts a scroll when the target is out of the view's middle half, unless   *)
(* one is under way; the scroll glides a line per frame to its landing, and   *)
(* stops early when the state stops following (a command running, a pause,    *)
(* the programmer's turn); afterwards it follows again if the target moved. A *)
(* pause ends in `resume`, which reveals the target; a command's end has to   *)
(* pick up a glide it cut short. The programmer's turn outranks a pause and a *)
(* command, and drops a glide cut before it: the turn is theirs to look where *)
(* they like, so follow mode waits for the next move. Line numbers from 0.    *)
(******************************************************************************)
EXTENDS Integers

CONSTANTS
    NumLines,          \* the file's lines
    ViewHeight,        \* the view's height, in lines
    MaxMoves,          \* how many times the model moves the target
    MaxFollowSwitches, \* how many times the model stops or starts following
    CatchUp            \* TRUE: a glide a command cut short goes on when the
                       \* state follows again

ASSUME AssumeNumLines == NumLines \in Nat \ {0}
ASSUME AssumeViewHeight == ViewHeight \in 1..NumLines
ASSUME AssumeMaxMoves == MaxMoves \in Nat
ASSUME AssumeMaxFollowSwitches == MaxFollowSwitches \in Nat
ASSUME AssumeCatchUp == CatchUp \in BOOLEAN

\* The file's line numbers.
Lines == 0..(NumLines - 1)

\* Why the state does not follow: the programmer paused, a command runs, or it
\* is the programmer's turn ("navigator").
AwayReasons == {"pause", "running", "navigator"}

\* Not away: the state follows. Any value that is not a reason will do, so the
\* config makes it a model value (6.20).
NotAway == CHOOSE v : v \notin AwayReasons

VARIABLES
    targetLine,          \* the target's line
    viewTop,             \* the view's top line
    scrolling,           \* a scroll is under way
    landing,             \* its landing
    targetAtStart,       \* the target's line when it started
    awayReason,          \* NotAway: the view follows; "pause", "running": a
                         \* command runs, or "navigator": the programmer's
                         \* turn; any of them, it does not
    glideCut,            \* a glide stopped short, as the state stopped
                         \* following
    moves,               \* target moves so far
    followSwitches,      \* stops and starts of following so far
    scrollBeyondLastLine, \* editor.scrollBeyondLastLine, on by default
    turnSinceFollow      \* the programmer's turn began after follow mode
                         \* last followed the target

vars ==
    <<targetLine, viewTop, scrolling, landing, targetAtStart, awayReason,
      glideCut, moves, followSwitches, scrollBeyondLastLine, turnSinceFollow>>

--------------------------------------------------------------------------------

\* The values each variable can hold.
TypeOK ==
    /\ targetLine \in Lines
    /\ viewTop \in Lines
    /\ scrolling \in BOOLEAN
    /\ landing \in Lines
    /\ targetAtStart \in Lines
    /\ awayReason \in {NotAway} \cup AwayReasons
    /\ glideCut \in BOOLEAN
    /\ moves \in Nat
    /\ followSwitches \in Nat
    /\ scrollBeyondLastLine \in BOOLEAN
    /\ turnSinceFollow \in BOOLEAN

Max(a, b) == IF a > b THEN a ELSE b

Min(a, b) == IF a < b THEN a ELSE b

\* view.ts's `comfortable`: target line t is out of the top and bottom
\* quarters of a view whose top is line v.
Comfortable(t, v) ==
    LET at == t - v
    IN  4 * at >= ViewHeight /\ 4 * at < 3 * ViewHeight

\* As far as the editor scrolls: the last line at the top, or with
\* scrollBeyondLastLine off, at the bottom.
MaxTop == IF scrollBeyondLastLine THEN NumLines - 1 ELSE NumLines - ViewHeight

\* view.ts's `landing`: the top that puts target line t a third of the way
\* down, as far as the editor scrolls.
Landing(t) == Max(0, Min(MaxTop, t - ViewHeight \div 3))

\* The view is as it should be for target line t: t in its middle half, or
\* the view as near that as the editor scrolls.
InPlace(t) == Comfortable(t, viewTop) \/ Landing(t) = viewTop

\* A scroll starts, for target line t.
StartScroll(t) ==
    /\ scrolling' = TRUE
    /\ landing' = Landing(t)
    /\ targetAtStart' = t

\* keepInView for target line t: a scroll, unless one is under way or the
\* view is as it should be.
KeepInView(t) ==
    IF ~scrolling /\ ~InPlace(t)
    THEN StartScroll(t)
    ELSE UNCHANGED <<scrolling, landing, targetAtStart>>

--------------------------------------------------------------------------------

Init ==
    /\ targetLine \in Lines
    /\ scrollBeyondLastLine \in BOOLEAN
    /\ viewTop \in 0..MaxTop
    /\ scrolling = FALSE
    /\ landing = 0
    /\ targetAtStart = 0
    /\ awayReason = NotAway
    /\ glideCut = FALSE
    /\ moves = 0
    /\ followSwitches = 0
    /\ turnSinceFollow = FALSE

\* The target moves to line t, and the player calls follow(): keepInView,
\* when following. An action moves it, or the programmer's edit above it
\* while paused; while a command runs, the player waits for it.
Move(t) ==
    /\ awayReason # "running"
    /\ targetLine' = t
    /\ IF awayReason = NotAway
       THEN /\ KeepInView(t)
            /\ turnSinceFollow' = FALSE
       ELSE UNCHANGED <<scrolling, landing, targetAtStart, turnSinceFollow>>
    /\ moves' = moves + 1
    /\ UNCHANGED <<viewTop, awayReason, glideCut, followSwitches,
                   scrollBeyondLastLine>>

\* The state stops following, for reason why: the programmer pauses, a
\* command runs (no actions meanwhile), or the turn passes to the programmer,
\* which outranks a pause or a command (the controller's state()).
\* renderCursor drops a glide cut before the turn; a frame of one still
\* under way can cut it after.
Leave(why) ==
    /\ \/ awayReason = NotAway
       \/ why = "navigator" /\ awayReason # "navigator"
    /\ awayReason' = why
    /\ followSwitches' = followSwitches + 1
    /\ IF why = "navigator"
       THEN /\ glideCut' = FALSE
            /\ turnSinceFollow' = TRUE
       ELSE UNCHANGED <<glideCut, turnSinceFollow>>
    /\ UNCHANGED <<targetLine, viewTop, scrolling, landing, targetAtStart,
                   moves, scrollBeyondLastLine>>

\* It follows again. `resume` reveals the target, so follows; the command's
\* end, or the turn's, only renders, which with CatchUp follows if a glide
\* was cut short.
Follow ==
    /\ awayReason # NotAway
    /\ IF awayReason = "pause" \/ (CatchUp /\ glideCut)
       THEN /\ KeepInView(targetLine)
            /\ glideCut' = FALSE
            /\ turnSinceFollow' = FALSE
       ELSE UNCHANGED <<scrolling, landing, targetAtStart, glideCut,
                        turnSinceFollow>>
    /\ awayReason' = NotAway
    /\ followSwitches' = followSwitches + 1
    /\ UNCHANGED <<targetLine, viewTop, moves, scrollBeyondLastLine>>

\* A frame of the glide: a line nearer; or it stops, done or not following.
\* Done, it follows again if the target is on another line than it started
\* for.
Glide ==
    /\ scrolling
    /\ IF awayReason = NotAway /\ viewTop # landing
       THEN /\ viewTop' = viewTop + (IF landing > viewTop THEN 1 ELSE -1)
            /\ UNCHANGED <<scrolling, landing, targetAtStart, glideCut>>
       ELSE /\ IF /\ awayReason = NotAway
                   /\ targetLine # targetAtStart
                   /\ ~InPlace(targetLine)
               THEN StartScroll(targetLine)
               ELSE /\ scrolling' = FALSE
                    /\ UNCHANGED <<landing, targetAtStart>>
            /\ glideCut' = (glideCut \/ (awayReason # NotAway))
            /\ UNCHANGED viewTop
    /\ UNCHANGED <<targetLine, awayReason, moves, followSwitches,
                   scrollBeyondLastLine, turnSinceFollow>>

Next ==
    \/ \E t \in Lines : Move(t)
    \/ \E why \in AwayReasons : Leave(why)
    \/ Follow
    \/ Glide

\* A glide under way goes on; moves and changes come when they do.
Fairness == WF_vars(Glide)

Spec == Init /\ [][Next]_vars /\ Fairness

--------------------------------------------------------------------------------

\* The target is in the view's middle half, or as near it as the editor
\* scrolls.
InView == InPlace(targetLine)

\* The view's top, and a glide's landing, are lines the editor scrolls to.
InRange == viewTop \in 0..MaxTop /\ landing \in 0..MaxTop

\* Once the state follows for good, and the target stays, the view settles on
\* it, unless the programmer's turn came since follow mode last followed: the
\* turn is theirs to look where they like, and the next move follows. The
\* target stays once the model's moves have run out. Code that never scrolled
\* would fail it, so it says something must happen.
ComesInView ==
    <>[](awayReason = NotAway /\ moves = MaxMoves /\ ~turnSinceFollow)
        => <>[]InView

\* Moves and switches run out only so that the model is finite (6.8). It prunes
\* exactly the states guards `moves < MaxMoves` on Move and
\* `followSwitches < MaxFollowSwitches` on Leave and Follow never reached, so
\* the behaviors, and ComesInView's result, are the guards' (8.6).
Constraint == moves <= MaxMoves /\ followSwitches <= MaxFollowSwitches

================================================================================
