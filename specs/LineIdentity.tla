---- MODULE LineIdentity -------------------------------------------------------
(******************************************************************************)
(* `applyChange` in packages/core/src/lines.ts, checked over every small text *)
(* and change. Texts are sequences of "x" (any other character), "n" (a line  *)
(* feed) and "r" (a carriage return). Offsets count from 0, as in the code.   *)
(* Old identities are 1, 2, ...; the ones a change makes are 100, 101, ...,   *)
(* in the order the code calls `fresh`. The agent's line numbers rest on it:  *)
(* a line number is accepted only while the line it was shown at still has    *)
(* the identity it had, so identities must name one line each, and follow the *)
(* rules in applyChange's comment.                                            *)
(******************************************************************************)
EXTENDS Naturals, Sequences, FiniteSets

CONSTANTS
    MaxLen,     \* the longest text the check covers
    MaxInsert   \* the longest inserted text it covers

ASSUME AssumeMaxLen == MaxLen \in Nat
ASSUME AssumeMaxInsert == MaxInsert \in Nat

--------------------------------------------------------------------------------

\* The characters: "x" for any other, "n" for a line feed, "r" for a carriage
\* return.
Chars == {"x", "n", "r"}

\* Every text up to n characters.
Texts(n) == UNION {[1..m -> Chars] : m \in 0..n}

\* t[from + 1 .. to], the characters at offsets from .. to - 1.
Slice(t, from, to) == SubSeq(t, from + 1, to)

\* text.indexOf("\n", from) counted up to `to`.
Newlines(t, from, to) == Cardinality({i \in (from + 1)..to : t[i] = "n"})

LineCount(t) == Newlines(t, 0, Len(t)) + 1

\* text.lastIndexOf("\n", start - 1) + 1: where the line holding offset `start`
\* begins, 0 on the first line. The CHOOSE takes the largest offset of a line
\* feed before `start`; there is one largest.
LineStart(t, start) ==
    LET nl == {i \in 1..start : t[i] = "n"}
    IN  IF nl = {} THEN 0 ELSE CHOOSE i \in nl : \A j \in nl : j <= i

\* text.indexOf("\n", end), or the text's length, and before a "\r" that ends
\* the line: where the line holding offset `end` ends. The CHOOSE takes the
\* smallest offset of a line feed after `end`; there is one smallest.
LineEnd(t, end) ==
    LET nlAfter == {i \in (end + 1)..Len(t) : t[i] = "n"}
        rawEnd ==
            IF nlAfter = {}
            THEN Len(t)
            ELSE (CHOOSE i \in nlAfter : \A j \in nlAfter : i <= j) - 1
    IN  IF rawEnd > end /\ t[rawEnd] = "r" THEN rawEnd - 1 ELSE rawEnd

\* The code, step by step. As applyChange's comment puts it: ids[0] = v.ids[a]
\* with a prefix, or ids[suffix ? k : 0] = v.ids[a] within one line (keepsA),
\* and ids[k] = v.ids[b] when the change ends inside a later line (keepsB).
Apply(t, ids, start, del, ins) ==
    LET end == start + del
        after == Slice(t, 0, start) \o ins \o Slice(t, end, Len(t))
        a == Newlines(t, 0, start)
        b == a + Newlines(t, start, end)
        k == Newlines(ins, 0, Len(ins))
        prefix == start > LineStart(t, start)
        suffix == end < LineEnd(t, end)
        fresh == [i \in 1..(k + 1) |-> 99 + i]
        keepsA(i) ==
            IF prefix
            THEN i = 1
            ELSE a = b /\ i = (IF suffix THEN k + 1 ELSE 1)
        keepsB(i) == i = k + 1 /\ b > a /\ suffix /\ (k > 0 \/ ~prefix)
        made ==
            [i \in 1..(k + 1) |->
                IF keepsB(i)
                THEN ids[b + 1]
                ELSE IF keepsA(i)
                     THEN ids[a + 1]
                     ELSE fresh[i]]
    IN  IF a = b /\ k = 0
        THEN [text |-> after, ids |-> ids]
        ELSE [text |-> after,
              ids |-> SubSeq(ids, 1, a) \o made \o SubSeq(ids, b + 2, Len(ids))]

\* Every change within its text: a record for each, read by field (6.15).
Cases ==
    {c \in [text : Texts(MaxLen), start : 0..MaxLen, del : 0..MaxLen,
            ins : Texts(MaxInsert)] :
        c.start + c.del <= Len(c.text)}

\* The case run through the code, from identities 1, 2, ... for the lines.
Result(c) ==
    Apply(c.text, [i \in 1..LineCount(c.text) |-> i], c.start, c.del, c.ins)

--------------------------------------------------------------------------------

\* One identity per line of the text after the change. A code that kept the
\* identities as they were would fail it, so it says something must happen.
OnePerLine(c) == Len(Result(c).ids) = LineCount(Result(c).text)

\* No identity names two lines.
Distinct(c) ==
    LET ids == Result(c).ids
    IN  \A i, j \in 1..Len(ids) : (ids[i] = ids[j]) => (i = j)

\* The lines wholly before the change, and wholly after it, keep their
\* identities, in place before it and shifted by the change's line count
\* after it.
Untouched(c) ==
    LET a == Newlines(c.text, 0, c.start)
        b == a + Newlines(c.text, c.start, c.start + c.del)
        r == Result(c).ids
        shift == Newlines(c.ins, 0, Len(c.ins)) - (b - a)
    IN  /\ \A i \in 1..a : r[i] = i
        /\ \A i \in (b + 2)..LineCount(c.text) : r[i + shift] = i

\* Within one line, nothing changes identity.
WithinALine(c) ==
    LET oneLine ==
            /\ Newlines(c.text, c.start, c.start + c.del) = 0
            /\ Newlines(c.ins, 0, Len(c.ins)) = 0
    IN  oneLine => (Result(c).ids = [i \in 1..LineCount(c.text) |-> i])

\* A line keeps its identity wherever its text goes: typing a line break at
\* the end of a line leaves it where it is, and one at the start of a line
\* moves it down. For a line with text: of two empty lines (a lone "r" is how
\* an empty line of a CRLF file ends), either may keep it.
BreakAtEnd(c) ==
    LET t == c.text
        a == Newlines(t, 0, c.start)
        atEnd ==
            /\ c.del = 0
            /\ c.ins = <<"n">>
            /\ c.start > 0
            /\ (c.start = Len(t) \/ t[c.start + 1] = "n")
            /\ t[c.start] = "x"
    IN  atEnd => (Result(c).ids[a + 1] = a + 1)

\* See BreakAtEnd.
BreakAtStart(c) ==
    LET t == c.text
        a == Newlines(t, 0, c.start)
        atStart ==
            /\ c.del = 0
            /\ c.ins = <<"n">>
            /\ (c.start = 0 \/ t[c.start] = "n")
            /\ c.start < Len(t)
            /\ t[c.start + 1] = "x"
    IN  atStart => (Result(c).ids[a + 2] = a + 1)

ASSUME AssumeOnePerLine == \A c \in Cases : OnePerLine(c)
ASSUME AssumeDistinct == \A c \in Cases : Distinct(c)
ASSUME AssumeUntouched == \A c \in Cases : Untouched(c)
ASSUME AssumeWithinALine == \A c \in Cases : WithinALine(c)
ASSUME AssumeBreakAtEnd == \A c \in Cases : BreakAtEnd(c)
ASSUME AssumeBreakAtStart == \A c \in Cases : BreakAtStart(c)

================================================================================
