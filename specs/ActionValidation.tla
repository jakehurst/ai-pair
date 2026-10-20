---- MODULE ActionValidation ---------------------------------------------------
(******************************************************************************)
(* moveProblem and spanProblem in packages/protocol/src/index.ts, checked     *)
(* over every place an agent can send, by the kind of value in each field.   *)
(* The relay's schema and the player both ask these checks (#45), so what    *)
(* they answer is what both accept: a place is accepted exactly when it is   *)
(* valid, and every other place gets a message, never an internal error      *)
(* (#163: `{ move: { line: 1, at: 5 } }` made moveProblem throw).            *)
(******************************************************************************)
EXTENDS Naturals

CONSTANTS
    CheckAtText \* TRUE: moveProblem says `at` is a text before it reads it
                \* as a spot (the fix in #163)

ASSUME AssumeCheckAtText == CheckAtText \in BOOLEAN

--------------------------------------------------------------------------------

\* A place's `line`: none, a line number, 0, a fraction, or a text.
LineKinds == {"missing", "number", "zero", "fraction", "text"}

\* A `move`'s `at`: none, a spot (one marker, with text around it), a text
\* with no marker, one with two, the marker alone, or a number.
AtKinds ==
    {"missing", "spot", "unmarked", "twoMarkers", "markerOnly", "number"}

\* A `move`'s `to`: none, `line_end`, or another text.
ToKinds == {"missing", "line_end", "otherText"}

\* A field a `move` does not take but the check names: absent, or `before`.
MoveOldKinds == {"missing", "before"}

\* Every `move` place, by the kind of value in each field.
Moves == [line : LineKinds, at : AtKinds, to : ToKinds, old : MoveOldKinds]

\* A span's `text`, `from`, or `through`: none, code, the empty text, or a
\* number.
CodeKinds == {"missing", "code", "empty", "number"}

\* A field a span does not take but the check names: absent, `near_line`, or
\* `to`.
SpanOldKinds == {"missing", "near_line", "to"}

\* Every `select` or `point` place, by the kind of value in each field.
Spans ==
    [line : LineKinds, text : CodeKinds, from : CodeKinds,
     through : CodeKinds, old : SpanOldKinds]

\* Everything a check can answer when something is wrong, each named for its
\* problem.
Problems ==
    {"oldSpot", "line", "to", "bothPlaces", "noPlace", "atIsText", "unmarked",
     "twoMarkers", "markerOnly", "nearLine", "rangeEnd", "bothForms",
     "rangeTexts", "noCode", "emptyCode"}

\* What a check answers when nothing is wrong. Any value that is not a problem
\* will do, so the config makes it a model value (6.20).
NoProblem == CHOOSE v : v \notin Problems

\* What a check answers when it throws instead of answering. Any value that
\* is not a problem, and not NoProblem, will do, so the config makes it a model
\* value (6.20).
Throws == CHOOSE v : v \notin Problems \cup {NoProblem}

--------------------------------------------------------------------------------

\* A place's `line` is one a check accepts: none, or a line number from 1.
LineOK(k) == k \in {"missing", "number"}

\* spotProblem: what's wrong with a spot's text. It splits the text on the
\* marker, so a number makes it throw.
SpotProblem(k) ==
    IF k = "number" THEN Throws
    ELSE IF k = "spot" THEN NoProblem
    ELSE k

\* moveProblem, in the order the code checks: an old field, the line, `to`,
\* both places or neither, then `at`. Each message is named for its problem.
MoveProblem(p) ==
    IF p.old = "before" THEN "oldSpot"
    ELSE IF ~LineOK(p.line) THEN "line"
    ELSE IF p.to = "otherText" THEN "to"
    ELSE IF p.at # "missing" /\ p.to # "missing" THEN "bothPlaces"
    ELSE IF p.at = "missing" /\ p.to = "missing" THEN "noPlace"
    ELSE IF p.at = "number" /\ CheckAtText THEN "atIsText"
    ELSE IF p.at # "missing" THEN SpotProblem(p.at)
    ELSE NoProblem

\* A valid move, defined apart from the check: no old field, a line or none,
\* and one place, a spot or the end of the line.
ValidMove(p) ==
    /\ p.old = "missing"
    /\ LineOK(p.line)
    /\ \/ p.at = "spot" /\ p.to = "missing"
       \/ p.at = "missing" /\ p.to = "line_end"

\* A span's field holds a text: code, or the empty text.
IsText(k) == k \in {"code", "empty"}

\* spanProblem, in the order the code checks: an old field, the line, both
\* forms, a range whose ends are not texts, no code, then empty code.
SpanProblem(p) ==
    LET range == p.from # "missing" \/ p.through # "missing"
    IN  IF p.old = "near_line" THEN "nearLine"
        ELSE IF p.old = "to" THEN "rangeEnd"
        ELSE IF ~LineOK(p.line) THEN "line"
        ELSE IF p.text # "missing" /\ range THEN "bothForms"
        ELSE IF range /\ ~(IsText(p.from) /\ IsText(p.through))
             THEN "rangeTexts"
        ELSE IF ~range /\ ~IsText(p.text) THEN "noCode"
        ELSE IF \E k \in {p.text, p.from, p.through} : k = "empty"
             THEN "emptyCode"
        ELSE NoProblem

\* A valid span, defined apart from the check: no old field, a line or none,
\* and code, as its text or as a range from one text through another.
ValidSpan(p) ==
    /\ p.old = "missing"
    /\ LineOK(p.line)
    /\ \/ p.text = "code" /\ p.from = "missing" /\ p.through = "missing"
       \/ p.text = "missing" /\ p.from = "code" /\ p.through = "code"

--------------------------------------------------------------------------------

\* A move gets no problem exactly when it is valid: a check that accepted
\* every move, or none, would fail it, so it says something must happen.
ASSUME MoveExactly ==
    \A p \in Moves : (MoveProblem(p) = NoProblem) <=> ValidMove(p)

\* The same for a span.
ASSUME SpanExactly ==
    \A p \in Spans : (SpanProblem(p) = NoProblem) <=> ValidSpan(p)

\* No place makes a check throw: every invalid one gets a message the agent
\* can act on, not an internal error.
ASSUME NeverThrows ==
    /\ \A p \in Moves : MoveProblem(p) # Throws
    /\ \A p \in Spans : SpanProblem(p) # Throws

================================================================================
