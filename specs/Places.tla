-------------------------------- MODULE Places --------------------------------
\* resolveSpot and resolveSpan in packages/core/src/places.ts, checked over every small text.
\* Characters are "x", "y", and "n" (a line feed); "m" is the cursor marker in a spot.
\* Offsets count from 0. Places in #19: a resolved spot or span lies on the given line, and an
\* ambiguous or missing text never resolves.
EXTENDS Integers, Sequences, FiniteSets

CONSTANTS MaxLen, MaxNeedle

Chars == {"x", "y", "n"}
Seqs(cs, n) == UNION {[1..m -> cs] : m \in 0..n}

\* The line (from 1) of offset o: one more than the line feeds before it (position in text.ts).
LineOf(t, o) == Cardinality({i \in 1..o : t[i] = "n"}) + 1
LineCount(t) == LineOf(t, Len(t))
\* Every offset where `needle` starts in `t` (findAll; none for an empty needle).
Starts(t, needle) ==
    IF needle = <<>> THEN {}
    ELSE {o \in 0..(Len(t) - Len(needle)) : SubSeq(t, o + 1, o + Len(needle)) = needle}

\* A spot `before` m `after`: the marker's offset in each match of before \o after.
SpotOffsets(t, before, after) == {o + Len(before) : o \in Starts(t, before \o after)}

\* resolveSpot: the one marker offset on `line`, or none.
ResolveSpot(t, before, after, line) ==
    LET here == {o \in SpotOffsets(t, before, after) : LineOf(t, o) = line}
    IN IF Cardinality(here) = 1 THEN CHOOSE o \in here : TRUE ELSE -1

\* resolveSpan with `text`: the one start on `line`, or none.
ResolveText(t, needle, line) ==
    LET here == {o \in Starts(t, needle) : LineOf(t, o) = line}
    IN IF Cardinality(here) = 1 THEN CHOOSE o \in here : TRUE ELSE -1

\* With `from` and `through`: the first `through` at or after the end of `from`.
ResolveRange(t, from, through, line) ==
    LET s == ResolveText(t, from, line)
        ends == IF through = <<>> THEN {} ELSE {o \in Starts(t, through) : o >= s + Len(from)}
    IN IF s = -1 \/ ends = {} THEN <<-1, -1>>
       ELSE <<s, (CHOOSE o \in ends : \A p \in ends : o <= p) + Len(through)>>

Texts == Seqs(Chars, MaxLen)
Needles == Seqs(Chars, MaxNeedle)

\* A resolved spot is on its line, between the two halves of its text.
SpotOK ==
    \A t \in Texts, before \in Needles, after \in Needles :
        Len(before) + Len(after) <= MaxNeedle =>
        \A line \in 1..LineCount(t) :
            LET o == ResolveSpot(t, before, after, line) IN
            o # -1 =>
                /\ LineOf(t, o) = line
                /\ SubSeq(t, o - Len(before) + 1, o) = before
                /\ SubSeq(t, o + 1, o + Len(after)) = after

\* A spot resolves exactly when one match has its marker on the line: ambiguous or missing, never.
SpotOnlyWhenUnique ==
    \A t \in Texts, before \in Needles, after \in Needles :
        Len(before) + Len(after) <= MaxNeedle =>
        \A line \in 1..LineCount(t) :
            (ResolveSpot(t, before, after, line) # -1) <=>
                Cardinality({o \in SpotOffsets(t, before, after) : LineOf(t, o) = line}) = 1

\* A resolved span starts on its line and is exactly its text.
SpanOK ==
    \A t \in Texts, needle \in Needles, line \in 1..MaxLen + 1 :
        LET s == ResolveText(t, needle, line) IN
        s # -1 => LineOf(t, s) = line /\ SubSeq(t, s + 1, s + Len(needle)) = needle

\* A range starts with `from` on its line and ends with the first `through` after it.
RangeOK ==
    \A t \in Texts, from \in Needles, through \in Needles, line \in 1..MaxLen + 1 :
        LET r == ResolveRange(t, from, through, line) IN
        r[1] # -1 =>
            /\ LineOf(t, r[1]) = line
            /\ SubSeq(t, r[2] - Len(through) + 1, r[2]) = through
            /\ r[2] - Len(through) >= r[1] + Len(from)
            /\ ~\E o \in Starts(t, through) : r[1] + Len(from) <= o /\ o < r[2] - Len(through)

ASSUME SpotOK
ASSUME SpotOnlyWhenUnique
ASSUME SpanOK
ASSUME RangeOK

\* Nothing to explore: the ASSUMEs are the checks.
VARIABLE unused
Spec == unused = 0 /\ [][FALSE]_unused

=============================================================================
