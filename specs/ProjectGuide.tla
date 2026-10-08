----------------------------- MODULE ProjectGuide -----------------------------
\* Which project guides `start` reads, for #23: `projectGuides` in packages/relay/src/guide.ts.
\* A directory is a path, a sequence of names; the workspace folder `root` is a prefix of the
\* agent's working directory `cwd`. The code walks up from `cwd` to `root`, collecting each
\* directory that has `.ai-pair/GUIDE.md` git doesn't ignore (a file checked in is never ignored),
\* and returns them outer first. Checked over every small tree: the walk gives exactly the guides
\* between `root` and `cwd` git doesn't ignore, outer first, never one above `root`, and none
\* outside the path from `root` to `cwd`.
EXTENDS Naturals, Sequences, FiniteSets

CONSTANTS Names, MaxDepth

Paths == UNION {[1..n -> Names] : n \in 0..MaxDepth}

IsPrefix(p, q) == Len(p) <= Len(q) /\ SubSeq(q, 1, Len(p)) = p

\* The code: from cwd, up one directory at a time; it stops once it has looked in root.
RECURSIVE Walk(_, _, _, _)
Walk(dir, root, guides, ignored) ==
    (IF dir \in guides /\ dir \notin ignored THEN <<dir>> ELSE <<>>)
        \o (IF Len(dir) <= Len(root) THEN <<>> ELSE Walk(SubSeq(dir, 1, Len(dir) - 1), root, guides, ignored))

RECURSIVE Reverse(_)
Reverse(s) == IF s = <<>> THEN <<>> ELSE Reverse(Tail(s)) \o <<Head(s)>>

Found(cwd, root, guides, ignored) == Reverse(Walk(cwd, root, guides, ignored))

Range(s) == {s[i] : i \in 1..Len(s)}

\* Exactly the guides git doesn't ignore on the path from root down to cwd, both included.
Exactly(cwd, root, guides, ignored) ==
    Range(Found(cwd, root, guides, ignored)) = {d \in guides \ ignored : IsPrefix(root, d) /\ IsPrefix(d, cwd)}

\* Outer first, each once: a later guide is deeper than every one before it.
OuterFirst(cwd, root, guides, ignored) ==
    LET f == Found(cwd, root, guides, ignored) IN \A i, j \in 1..Len(f) : i < j => Len(f[i]) < Len(f[j])

\* Never one above the workspace folder, nor one off the path to cwd.
Contained(cwd, root, guides, ignored) ==
    \A d \in Range(Found(cwd, root, guides, ignored)) : IsPrefix(root, d) /\ IsPrefix(d, cwd) /\ d \notin ignored

\* Where guides may be: on the path to cwd, or one step off it at any depth (a sibling directory).
Prefixes(c) == {SubSeq(c, 1, n) : n \in 0..Len(c)}
Siblings(c) == {Append(p, x) : p \in Prefixes(c), x \in Names} \ Prefixes(c)
\* The guides git ignores are any of them (ignoring a directory without a guide changes nothing).
Cases ==
    UNION {UNION {{<<c, r, g, i>> : i \in SUBSET g} : g \in SUBSET (Prefixes(c) \cup Siblings(c))}
           : <<c, r>> \in {<<c, r>> \in Paths \X Paths : IsPrefix(r, c)}}

ASSUME \A x \in Cases : Exactly(x[1], x[2], x[3], x[4])
ASSUME \A x \in Cases : OuterFirst(x[1], x[2], x[3], x[4])
ASSUME \A x \in Cases : Contained(x[1], x[2], x[3], x[4])

\* Nothing to explore: the ASSUMEs are the checks.
VARIABLE unused
Spec == unused = 0 /\ [][FALSE]_unused

=============================================================================
