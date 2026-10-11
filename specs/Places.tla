---- MODULE Places -------------------------------------------------------------
(******************************************************************************)
(* resolveSpot and resolveSpan in packages/core/src/places.ts, checked over   *)
(* every small text. Characters are "x", "y", and "n" (a line feed); "m" is   *)
(* the cursor marker in a spot. Offsets count from 0. Places in #19: a        *)
(* resolved spot or span lies on the given line, and an ambiguous or missing  *)
(* text never resolves.                                                       *)
(******************************************************************************)
EXTENDS Integers, Sequences, FiniteSets

CONSTANTS
    MaxLen,     \* the longest text the check covers
    MaxNeedle   \* the longest needle: a spot's two halves together, a span's
                \* text, `from`, or `through`

ASSUME AssumeMaxLen == MaxLen \in Nat
ASSUME AssumeMaxNeedle == MaxNeedle \in Nat

\* No offset: what resolving gives when it finds no single match. Any value
\* that is not an offset will do, so the config makes it a model value (6.20).
NoOffset == CHOOSE v : v \notin Int

--------------------------------------------------------------------------------

\* The characters: "x", "y", and "n" for a line feed.
Chars == {"x", "y", "n"}

\* Every sequence of up to n characters from cs.
Seqs(cs, n) == UNION {[1..m -> cs] : m \in 0..n}

\* The line, from 1, of offset o: one more than the line feeds before it
\* (position in text.ts).
LineOf(t, o) == Cardinality({i \in 1..o : t[i] = "n"}) + 1

LineCount(t) == LineOf(t, Len(t))

\* Every offset where `needle` starts in `t` (findAll; none for an empty
\* needle).
Starts(t, needle) ==
    IF needle = <<>>
    THEN {}
    ELSE {o \in 0..(Len(t) - Len(needle)) :
              SubSeq(t, o + 1, o + Len(needle)) = needle}

\* A spot `before` m `after`: the marker's offset in each match of
\* before \o after.
SpotOffsets(t, before, after) ==
    {o + Len(before) : o \in Starts(t, before \o after)}

\* The marker offsets on `line`.
SpotsOnLine(t, before, after, line) ==
    {o \in SpotOffsets(t, before, after) : LineOf(t, o) = line}

\* resolveSpot: the marker offset on `line` when exactly one match puts it
\* there, which the CHOOSE then takes; else NoOffset.
ResolveSpot(t, before, after, line) ==
    LET here == SpotsOnLine(t, before, after, line)
    IN  IF Cardinality(here) = 1 THEN CHOOSE o \in here : TRUE ELSE NoOffset

\* resolveSpan with `text`: the start on `line` when exactly one match starts
\* there, which the CHOOSE then takes; else NoOffset.
ResolveText(t, needle, line) ==
    LET here == {o \in Starts(t, needle) : LineOf(t, o) = line}
    IN  IF Cardinality(here) = 1 THEN CHOOSE o \in here : TRUE ELSE NoOffset

\* No range: what resolving `from` and `through` gives when either is missing.
NoRange == [start |-> NoOffset, end |-> NoOffset]

\* With `from` and `through`: the first `through` at or after the end of
\* `from`. The CHOOSE takes the smallest such start; there is one smallest.
ResolveRange(t, from, through, line) ==
    LET s == ResolveText(t, from, line)
        ends ==
            IF through = <<>>
            THEN {}
            ELSE {o \in Starts(t, through) : o >= s + Len(from)}
        first == CHOOSE o \in ends : \A p \in ends : o <= p
    IN  IF s = NoOffset \/ ends = {}
        THEN NoRange
        ELSE [start |-> s, end |-> first + Len(through)]

\* Every text and every needle the check covers.
Texts == Seqs(Chars, MaxLen)
Needles == Seqs(Chars, MaxNeedle)

--------------------------------------------------------------------------------

\* A resolved spot is on its line, between the two halves of its text.
SpotOK ==
    \A t \in Texts, before \in Needles, after \in Needles :
        (Len(before) + Len(after) <= MaxNeedle) =>
            \A line \in 1..LineCount(t) :
                LET o == ResolveSpot(t, before, after, line)
                IN  o # NoOffset =>
                        /\ LineOf(t, o) = line
                        /\ SubSeq(t, o - Len(before) + 1, o) = before
                        /\ SubSeq(t, o + 1, o + Len(after)) = after

\* A spot resolves exactly when one match has its marker on the line:
\* ambiguous or missing, never. A resolver that never resolved would fail it,
\* so it says something must happen.
SpotOnlyWhenUnique ==
    \A t \in Texts, before \in Needles, after \in Needles :
        (Len(before) + Len(after) <= MaxNeedle) =>
            \A line \in 1..LineCount(t) :
                (ResolveSpot(t, before, after, line) # NoOffset)
                    <=> (Cardinality(SpotsOnLine(t, before, after, line)) = 1)

\* A resolved span starts on its line and is exactly its text.
SpanOK ==
    \A t \in Texts, needle \in Needles, line \in 1..(MaxLen + 1) :
        LET s == ResolveText(t, needle, line)
        IN  s # NoOffset =>
                /\ LineOf(t, s) = line
                /\ SubSeq(t, s + 1, s + Len(needle)) = needle

\* A range starts with `from` on its line and ends with the first `through`
\* after it.
RangeOK ==
    \A t \in Texts, from \in Needles, through \in Needles,
       line \in 1..(MaxLen + 1) :
        LET r == ResolveRange(t, from, through, line)
        IN  r # NoRange =>
                /\ LineOf(t, r.start) = line
                /\ SubSeq(t, r.end - Len(through) + 1, r.end) = through
                /\ r.end - Len(through) >= r.start + Len(from)
                /\ ~\E o \in Starts(t, through) :
                        r.start + Len(from) <= o /\ o < r.end - Len(through)

ASSUME AssumeSpotOK == SpotOK
ASSUME AssumeSpotOnlyWhenUnique == SpotOnlyWhenUnique
ASSUME AssumeSpanOK == SpanOK
ASSUME AssumeRangeOK == RangeOK

================================================================================
