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
LineKinds == {"absent", "number", "zero", "fraction", "text"}

\* A `move`'s `at`: none, a spot (one marker, with text around it), a text
\* with no marker, one with two, the marker alone, or a number.
AtKinds ==
    {"absent", "spot", "unmarked", "twoMarkers", "markerOnly", "number"}

\* A `move`'s `to`: none, `line_end`, or another text.
ToKinds == {"absent", "line_end", "other"}

\* A field a `move` does not take but the check names: none, or `before`.
MoveOldKinds == {"none", "before"}

\* Every `move` place, by the kind of value in each field.
Moves == [line : LineKinds, at : AtKinds, to : ToKinds, old : MoveOldKinds]

\* A span's `text`, `from`, or `through`: none, code, the empty text, or a
\* number.
CodeKinds == {"absent", "code", "empty", "number"}

\* A field a span does not take but the check names: none, `near_line`, or
\* `to`.
SpanOldKinds == {"none", "near_line", "to"}

\* Every `select` or `point` place, by the kind of value in each field.
Spans ==
    [line : LineKinds, text : CodeKinds, from : CodeKinds,
     through : CodeKinds, old : SpanOldKinds]

\* What a check answers when nothing is wrong, and when it throws instead of
\* answering.
None == "none"
Throws == "throws"

--------------------------------------------------------------------------------

\* A place's `line` is one a check accepts: none, or a line number from 1.
LineOK(k) == k \in {"absent", "number"}

\* spotProblem: what's wrong with a spot's text. It splits the text on the
\* marker, so a number makes it throw.
SpotProblem(k) ==
    IF k = "number" THEN Throws
    ELSE IF k = "spot" THEN None
    ELSE k

\* moveProblem, in the order the code checks: an old field, the line, `to`,
\* both places or neither, then `at`. Each message is named for its problem.
MoveProblem(p) ==
    IF p.old = "before" THEN "oldSpot"
    ELSE IF ~LineOK(p.line) THEN "line"
    ELSE IF p.to = "other" THEN "to"
    ELSE IF p.at # "absent" /\ p.to # "absent" THEN "bothPlaces"
    ELSE IF p.at = "absent" /\ p.to = "absent" THEN "noPlace"
    ELSE IF p.at = "number" /\ CheckAtText THEN "atIsText"
    ELSE IF p.at # "absent" THEN SpotProblem(p.at)
    ELSE None

\* A valid move, defined apart from the check: no old field, a line or none,
\* and one place, a spot or the end of the line.
ValidMove(p) ==
    /\ p.old = "none"
    /\ LineOK(p.line)
    /\ \/ p.at = "spot" /\ p.to = "absent"
       \/ p.at = "absent" /\ p.to = "line_end"

\* A span's field holds a text: code, or the empty text.
IsText(k) == k \in {"code", "empty"}

\* spanProblem, in the order the code checks: an old field, the line, both
\* forms, a range whose ends are not texts, no code, then empty code.
SpanProblem(p) ==
    LET range == p.from # "absent" \/ p.through # "absent"
    IN  IF p.old = "near_line" THEN "nearLine"
        ELSE IF p.old = "to" THEN "rangeEnd"
        ELSE IF ~LineOK(p.line) THEN "line"
        ELSE IF p.text # "absent" /\ range THEN "bothForms"
        ELSE IF range /\ ~(IsText(p.from) /\ IsText(p.through))
             THEN "rangeTexts"
        ELSE IF ~range /\ ~IsText(p.text) THEN "noCode"
        ELSE IF \E k \in {p.text, p.from, p.through} : k = "empty"
             THEN "emptyCode"
        ELSE None

\* A valid span, defined apart from the check: no old field, a line or none,
\* and code, as its text or as a range from one text through another.
ValidSpan(p) ==
    /\ p.old = "none"
    /\ LineOK(p.line)
    /\ \/ p.text = "code" /\ p.from = "absent" /\ p.through = "absent"
       \/ p.text = "absent" /\ p.from = "code" /\ p.through = "code"

--------------------------------------------------------------------------------

\* A move gets no problem exactly when it is valid: a check that accepted
\* every move, or none, would fail it, so it says something must happen.
ASSUME MoveExactly ==
    \A p \in Moves : (MoveProblem(p) = None) <=> ValidMove(p)

\* The same for a span.
ASSUME SpanExactly ==
    \A p \in Spans : (SpanProblem(p) = None) <=> ValidSpan(p)

\* No place makes a check throw: every invalid one gets a message the agent
\* can act on, not an internal error.
ASSUME NeverThrows ==
    /\ \A p \in Moves : MoveProblem(p) # Throws
    /\ \A p \in Spans : SpanProblem(p) # Throws

================================================================================
