-------------------------------- MODULE Typing --------------------------------
\* How planTyping in packages/core/src/typing.ts splits text into chunks, each inserted in one
\* edit, checked over every small text. Delays aren't modeled: only the splitting. Characters
\* are "x" (any other), "s" (a space or tab) and "n" (a line feed). Typing in #19: the chunks of
\* a plan concatenate to the input text.
EXTENDS Naturals, Sequences

CONSTANT MaxLen

Chars == {"x", "s", "n"}
Texts == UNION {[1..m -> Chars] : m \in 0..MaxLen}

\* The indentation at the start of cs (takeIndent).
RECURSIVE IndentOf(_)
IndentOf(cs) == IF cs # <<>> /\ Head(cs) = "s" THEN <<"s">> \o IndentOf(Tail(cs)) ELSE <<>>

Drop(cs, n) == SubSeq(cs, n + 1, Len(cs))

\* The loop: a line feed goes with the indentation after it; anything else goes alone.
RECURSIVE Loop(_)
Loop(cs) ==
    IF cs = <<>> THEN <<>>
    ELSE IF Head(cs) = "n"
         THEN LET ind == IndentOf(Tail(cs)) IN <<<<"n">> \o ind>> \o Loop(Drop(Tail(cs), Len(ind)))
         ELSE <<<<Head(cs)>>>> \o Loop(Tail(cs))

\* With atLineStart, indentation at the very start is one chunk first.
Plan(cs, atLineStart) ==
    LET ind == IndentOf(cs) IN
    IF atLineStart /\ ind # <<>> THEN <<ind>> \o Loop(Drop(cs, Len(ind))) ELSE Loop(cs)

RECURSIVE Concat(_)
Concat(chunks) == IF chunks = <<>> THEN <<>> ELSE Head(chunks) \o Concat(Tail(chunks))

AllSpaces(c) == \A i \in 1..Len(c) : c[i] = "s"

\* The chunks concatenate to the text.
ConcatenatesToText == \A t \in Texts, s \in BOOLEAN : Concat(Plan(t, s)) = t

\* Each chunk is one character that isn't a line feed, a line feed with the indentation after
\* it, or (first, at a line's start) the indentation there; none is empty.
ChunksAreUnits ==
    \A t \in Texts, s \in BOOLEAN :
        LET p == Plan(t, s) IN
        \A i \in 1..Len(p) :
            \/ Len(p[i]) = 1 /\ p[i][1] # "n"
            \/ p[i][1] = "n" /\ AllSpaces(Tail(p[i]))
            \/ i = 1 /\ s /\ p[i] # <<>> /\ AllSpaces(p[i])

ASSUME ConcatenatesToText
ASSUME ChunksAreUnits

\* Nothing to explore: the ASSUMEs are the checks.
VARIABLE unused
Spec == unused = 0 /\ [][FALSE]_unused

=============================================================================
