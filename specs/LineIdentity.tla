---- MODULE LineIdentity -------------------------------------------------------
(******************************************************************************)
(* `applyChange` in packages/core/src/lines.ts, checked over every small text *)
(* and change. Texts are sequences of Letter, LineFeed, and CarriageReturn,   *)
(* named in PairDefs. Offsets count from 0, as in the code.                   *)
(* Old identities are 1, 2, ...; the ones a change makes are 100, 101, ...,   *)
(* in the order the code calls `fresh`. The agent's line numbers rest on it:  *)
(* a line number is accepted only while the line it was shown at still has    *)
(* the identity it had, so identities must name one line each, and follow the *)
(* rules in applyChange's comment.                                            *)
(******************************************************************************)
EXTENDS Naturals, Sequences, FiniteSets, PairDefs

CONSTANTS
    MaxChars,     \* the longest text the check covers
    MaxInsert   \* the longest inserted text it covers

ASSUME AssumeMaxChars == MaxChars \in Nat
ASSUME AssumeMaxInsert == MaxInsert \in Nat

--------------------------------------------------------------------------------

\* The characters: any other, a line feed, and a carriage return.
Chars == {Letter, LineFeed, CarriageReturn}

\* Every text up to n characters.
Texts(n) == Seqs(Chars, n)

\* t[from + 1 .. to], the characters at offsets from .. to - 1.
Slice(t, from, to) == SubSeq(t, from + 1, to)

\* text.indexOf("\n", from) counted up to `to`.
LineFeeds(t, from, to) == Cardinality({i \in (from + 1)..to : t[i] = LineFeed})

LineCount(t) == LineFeeds(t, 0, Len(t)) + 1

\* text.lastIndexOf("\n", start - 1) + 1: where the line holding offset `offset`
\* begins, 0 on the first line. The CHOOSE takes the largest offset of a line
\* feed before `offset`; there is one largest.
LineStart(t, offset) ==
    LET lineFeedsBefore == {i \in 1..offset : t[i] = LineFeed}
    IN  IF lineFeedsBefore = {} THEN 0 ELSE CHOOSE i \in lineFeedsBefore
        : \A j \in lineFeedsBefore : j <= i

\* text.indexOf("\n", end), or the text's length, and before a "\r" that ends
\* the line: where the line holding offset `end` ends. The CHOOSE takes the
\* smallest offset of a line feed after `end`; there is one smallest.
LineEnd(t, end) ==
    LET lineFeedsAfter == {i \in (end + 1)..Len(t) : t[i] = LineFeed}
        rawEnd ==
            IF lineFeedsAfter = {}
            THEN Len(t)
            ELSE (CHOOSE i \in lineFeedsAfter : \A j \in lineFeedsAfter
                  : i <= j) - 1
    IN  IF rawEnd > end /\ t[rawEnd] = CarriageReturn
        THEN rawEnd - 1
        ELSE rawEnd

\* The code, step by step. As applyChange's comment puts it: ids[0] = v.ids[a]
\* with a prefix, or ids[suffix ? k : 0] = v.ids[a] within one line (keepsA),
\* and ids[k] = v.ids[b] when the change ends inside a later line (keepsB).
ApplyChange(t, ids, offset, deleteLength, inserted) ==
    LET end == offset + deleteLength
        textAfter == Slice(t, 0, offset) \o inserted \o Slice(t, end, Len(t))
        a == LineFeeds(t, 0, offset)
        b == a + LineFeeds(t, offset, end)
        k == LineFeeds(inserted, 0, Len(inserted))
        prefix == offset > LineStart(t, offset)
        suffix == end < LineEnd(t, end)
        fresh == [i \in 1..(k + 1) |-> 99 + i]
        keepsA(i) ==
            IF prefix
            THEN i = 1
            ELSE a = b /\ i = (IF suffix THEN k + 1 ELSE 1)
        keepsB(i) == i = k + 1 /\ b > a /\ suffix /\ (k > 0 \/ ~prefix)
        changedIds ==
            [i \in 1..(k + 1) |->
                IF keepsB(i)
                THEN ids[b + 1]
                ELSE IF keepsA(i)
                     THEN ids[a + 1]
                     ELSE fresh[i]]
    IN  IF a = b /\ k = 0
        THEN [text |-> textAfter, ids |-> ids]
        ELSE [text |-> textAfter,
              ids |-> SubSeq(ids, 1, a) \o changedIds \o SubSeq(ids, b + 2,
                                                                Len(ids))]

\* Every change within its text: a record for each, read by field (6.15).
Cases ==
    {c \in [text : Texts(MaxChars), offset : 0..MaxChars,
            deleteLength : 0..MaxChars,
            inserted : Texts(MaxInsert)] :
        c.offset + c.deleteLength <= Len(c.text)}

\* The case run through the code, from identities 1, 2, ... for the lines.
Result(c) ==
    ApplyChange(c.text, [i \in 1..LineCount(c.text) |-> i], c.offset,
                c.deleteLength,
                c.inserted)

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
    LET a == LineFeeds(c.text, 0, c.offset)
        b == a + LineFeeds(c.text, c.offset, c.offset + c.deleteLength)
        r == Result(c).ids
        shift == LineFeeds(c.inserted, 0, Len(c.inserted)) - (b - a)
    IN  /\ \A i \in 1..a : r[i] = i
        /\ \A i \in (b + 2)..LineCount(c.text) : r[i + shift] = i

\* Within one line, nothing changes identity.
WithinALine(c) ==
    LET oneLine ==
            /\ LineFeeds(c.text, c.offset, c.offset + c.deleteLength) = 0
            /\ LineFeeds(c.inserted, 0, Len(c.inserted)) = 0
    IN  oneLine => (Result(c).ids = [i \in 1..LineCount(c.text) |-> i])

\* A line keeps its identity wherever its text goes: typing a line break at
\* the end of a line leaves it where it is, and one at the start of a line
\* moves it down. For a line with text: of two empty lines (a lone "r" is how
\* an empty line of a CRLF file ends), either may keep it.
BreakAtEnd(c) ==
    LET t == c.text
        a == LineFeeds(t, 0, c.offset)
        atEnd ==
            /\ c.deleteLength = 0
            /\ c.inserted = <<LineFeed>>
            /\ c.offset > 0
            /\ (c.offset = Len(t) \/ t[c.offset + 1] = LineFeed)
            /\ t[c.offset] = Letter
    IN  atEnd => (Result(c).ids[a + 1] = a + 1)

\* See BreakAtEnd.
BreakAtStart(c) ==
    LET t == c.text
        a == LineFeeds(t, 0, c.offset)
        atStart ==
            /\ c.deleteLength = 0
            /\ c.inserted = <<LineFeed>>
            /\ (c.offset = 0 \/ t[c.offset] = LineFeed)
            /\ c.offset < Len(t)
            /\ t[c.offset + 1] = Letter
    IN  atStart => (Result(c).ids[a + 2] = a + 1)

ASSUME AssumeOnePerLine == \A c \in Cases : OnePerLine(c)
ASSUME AssumeDistinct == \A c \in Cases : Distinct(c)
ASSUME AssumeUntouched == \A c \in Cases : Untouched(c)
ASSUME AssumeWithinALine == \A c \in Cases : WithinALine(c)
ASSUME AssumeBreakAtEnd == \A c \in Cases : BreakAtEnd(c)
ASSUME AssumeBreakAtStart == \A c \in Cases : BreakAtStart(c)

================================================================================
