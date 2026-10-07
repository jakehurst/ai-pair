----------------------------- MODULE LineIdentity -----------------------------
\* `applyChange` in packages/core/src/lines.ts, checked over every small text and change.
\* Texts are sequences of "x" (any other character), "n" (a line feed) and "r" (a carriage
\* return). Offsets count from 0, as in the code. Old identities are 1, 2, ...; the ones a
\* change makes are 100, 101, ..., in the order the code calls `fresh`.
\* S10 in #19 rests on it: a line number is accepted only while the line it was shown at
\* still has the identity it had, so identities must name one line each, and follow the rules
\* in applyChange's comment.
EXTENDS Naturals, Sequences, FiniteSets

CONSTANTS MaxLen, MaxInsert

Chars == {"x", "n", "r"}
Texts(n) == UNION {[1..m -> Chars] : m \in 0..n}

\* t[from+1 .. to], the characters at offsets from .. to - 1.
Slice(t, from, to) == SubSeq(t, from + 1, to)
\* text.indexOf("\n", from) counted up to `to`.
Newlines(t, from, to) == Cardinality({i \in (from + 1)..to : t[i] = "n"})
LineCount(t) == Newlines(t, 0, Len(t)) + 1

\* The code, step by step.
Apply(t, ids, start, del, ins) ==
    LET end == start + del
        after == Slice(t, 0, start) \o ins \o Slice(t, end, Len(t))
        a == Newlines(t, 0, start)
        b == a + Newlines(t, start, end)
        k == Newlines(ins, 0, Len(ins))
        \* text.lastIndexOf("\n", start - 1) + 1, or 0 at the start of the text.
        lineStart == IF start = 0 THEN 0
                     ELSE LET nl == {i \in 1..start : t[i] = "n"}
                          IN IF nl = {} THEN 0 ELSE CHOOSE i \in nl : \A j \in nl : j <= i
        \* text.indexOf("\n", end), or the text's length; before a "\r" that ends the line.
        nlAfter == {i \in (end + 1)..Len(t) : t[i] = "n"}
        rawEnd == IF nlAfter = {} THEN Len(t) ELSE (CHOOSE i \in nlAfter : \A j \in nlAfter : i <= j) - 1
        lineEnd == IF rawEnd > end /\ t[rawEnd] = "r" THEN rawEnd - 1 ELSE rawEnd
        prefix == start > lineStart
        suffix == end < lineEnd
        fresh == [i \in 1..(k + 1) |-> 99 + i]
        \* ids[0] = v.ids[a] with a prefix, or ids[suffix ? k : 0] = v.ids[a] within one line...
        keepsA(i) == IF prefix THEN i = 1 ELSE a = b /\ i = (IF suffix THEN k + 1 ELSE 1)
        \* ...and ids[k] = v.ids[b] when the change ends inside a later line.
        keepsB(i) == i = k + 1 /\ b > a /\ suffix /\ (k > 0 \/ ~prefix)
        made == [i \in 1..(k + 1) |-> IF keepsB(i) THEN ids[b + 1] ELSE IF keepsA(i) THEN ids[a + 1] ELSE fresh[i]]
    IN IF a = b /\ k = 0
          THEN [text |-> after, ids |-> ids]
          ELSE [text |-> after, ids |-> SubSeq(ids, 1, a) \o made \o SubSeq(ids, b + 2, Len(ids))]

Cases == {<<t, start, del, ins>> :
            t \in Texts(MaxLen), start \in 0..MaxLen, del \in 0..MaxLen, ins \in Texts(MaxInsert)}
Valid(c) == c[2] + c[3] <= Len(c[1])
Result(c) == Apply(c[1], [i \in 1..LineCount(c[1]) |-> i], c[2], c[3], c[4])

\* One identity per line of the text after the change.
OnePerLine(c) == Len(Result(c).ids) = LineCount(Result(c).text)

\* No identity names two lines.
Distinct(c) == LET ids == Result(c).ids IN \A i, j \in 1..Len(ids) : ids[i] = ids[j] => i = j

\* The lines wholly before the change, and wholly after it, keep their identities, in place
\* before it and shifted by the change's line count after it.
Untouched(c) ==
    LET t == c[1]  start == c[2]  end == c[2] + c[3]
        a == Newlines(t, 0, start)  b == a + Newlines(t, start, end)
        r == Result(c).ids
        shift == Newlines(c[4], 0, Len(c[4])) - (b - a)
    IN /\ \A i \in 1..a : r[i] = i
       /\ \A i \in (b + 2)..LineCount(t) : r[i + shift] = i

\* Within one line, nothing changes identity.
WithinALine(c) ==
    LET t == c[1]  start == c[2]  end == c[2] + c[3]
    IN Newlines(t, start, end) = 0 /\ Newlines(c[4], 0, Len(c[4])) = 0 =>
           Result(c).ids = [i \in 1..LineCount(t) |-> i]

\* A line keeps its identity wherever its text goes: typing a line break at the end of a line
\* leaves it where it is, and one at the start of a line moves it down. For a line with text:
\* of two empty lines (a lone "r" is how an empty line of a CRLF file ends), either may keep it.
BreakAtEnd(c) ==
    LET t == c[1]  start == c[2]
        a == Newlines(t, 0, start)
    IN (c[3] = 0 /\ c[4] = <<"n">> /\ start > 0 /\ (start = Len(t) \/ t[start + 1] = "n") /\ t[start] = "x") =>
           Result(c).ids[a + 1] = a + 1
BreakAtStart(c) ==
    LET t == c[1]  start == c[2]
        a == Newlines(t, 0, start)
    IN (c[3] = 0 /\ c[4] = <<"n">> /\ (start = 0 \/ t[start] = "n") /\ start < Len(t) /\ t[start + 1] = "x") =>
           Result(c).ids[a + 2] = a + 1

ASSUME \A c \in Cases : Valid(c) => OnePerLine(c)
ASSUME \A c \in Cases : Valid(c) => Distinct(c)
ASSUME \A c \in Cases : Valid(c) => Untouched(c)
ASSUME \A c \in Cases : Valid(c) => WithinALine(c)
ASSUME \A c \in Cases : Valid(c) => BreakAtEnd(c)
ASSUME \A c \in Cases : Valid(c) => BreakAtStart(c)

\* Nothing to explore: the ASSUMEs are the checks.
VARIABLE unused
Spec == unused = 0 /\ [][FALSE]_unused

=============================================================================
