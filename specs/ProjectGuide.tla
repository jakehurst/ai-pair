---- MODULE ProjectGuide -------------------------------------------------------
(******************************************************************************)
(* Which project guides `start` reads, for #23: `projectGuides` in            *)
(* packages/relay/src/guide.ts. A directory is a path, a sequence of names;   *)
(* the workspace folder `root` is a prefix of the agent's working directory   *)
(* `cwd`. The code walks up from `cwd` to `root`, collecting each directory   *)
(* that has `.ai-pair/GUIDE.md` git doesn't ignore (a file checked in is      *)
(* never ignored), and returns them outer first. Checked over every small     *)
(* tree: the walk gives exactly the guides between `root` and `cwd` git       *)
(* doesn't ignore, outer first, never one above `root`, and none outside the  *)
(* path from `root` to `cwd`.                                                 *)
(******************************************************************************)
EXTENDS Naturals, Sequences, FiniteSets

CONSTANTS
    Names,      \* the directory names a path is made of
    MaxDepth    \* the deepest path the check covers

ASSUME AssumeMaxDepth == MaxDepth \in Nat

--------------------------------------------------------------------------------

\* Every path up to MaxDepth names deep.
Paths == UNION {[1..n -> Names] : n \in 0..MaxDepth}

\* p is q or a directory above it.
IsPrefix(p, q) == Len(p) <= Len(q) /\ SubSeq(q, 1, Len(p)) = p

\* The code: from cwd, up one directory at a time; it stops once it has looked
\* in root. A function over the finite set Paths, defined for this root and
\* these guides; each step recurs on a shorter path, so it ends (6.16).
Walk(cwd, root, guides, ignored) ==
    LET up[dir \in Paths] ==
            (IF dir \in (guides \ ignored) THEN <<dir>> ELSE <<>>)
                \o (IF Len(dir) <= Len(root)
                    THEN <<>>
                    ELSE up[SubSeq(dir, 1, Len(dir) - 1)])
    IN  up[cwd]

\* s from its last element to its first.
Reverse(s) == [i \in 1..Len(s) |-> s[Len(s) - i + 1]]

\* The guides the code returns for a case, outer first.
Found(x) == Reverse(Walk(x.cwd, x.root, x.guides, x.ignored))

\* The elements of s.
Range(s) == {s[i] : i \in 1..Len(s)}

\* Where guides may be: on the path to cwd, or one step off it at any depth (a
\* sibling directory).
Prefixes(c) == {SubSeq(c, 1, n) : n \in 0..Len(c)}
Siblings(c) == {Append(p, x) : p \in Prefixes(c), x \in Names} \ Prefixes(c)

\* The cases for working directory c and workspace folder r: any guides on the
\* path or one step off it, with any of them ignored by git (ignoring a
\* directory without a guide changes nothing).
CasesAt(c, r) ==
    LET case(g, i) == [cwd |-> c, root |-> r, guides |-> g, ignored |-> i]
        withIgnored(g) == {case(g, i) : i \in SUBSET g}
    IN  UNION {withIgnored(g) : g \in SUBSET (Prefixes(c) \cup Siblings(c))}

\* Every case: a working directory, its workspace folder at or above it, the
\* guides, and the ones git ignores.
Cases ==
    UNION {(IF IsPrefix(r, c) THEN CasesAt(c, r) ELSE {}) : c, r \in Paths}

--------------------------------------------------------------------------------

\* Exactly the guides git doesn't ignore on the path from root down to cwd,
\* both included. A walk that found nothing would fail it, so it says
\* something must happen.
Exactly(x) ==
    Range(Found(x)) =
        {d \in x.guides \ x.ignored : IsPrefix(x.root, d) /\ IsPrefix(d, x.cwd)}

\* Outer first, each once: a later guide is deeper than every one before it.
OuterFirst(x) ==
    LET f == Found(x)
    IN  \A i, j \in 1..Len(f) : (i < j) => (Len(f[i]) < Len(f[j]))

\* Never one above the workspace folder, nor one off the path to cwd, nor one
\* git ignores.
Contained(x) ==
    \A d \in Range(Found(x)) :
        /\ IsPrefix(x.root, d)
        /\ IsPrefix(d, x.cwd)
        /\ d \notin x.ignored

ASSUME AssumeExactly == \A x \in Cases : Exactly(x)
ASSUME AssumeOuterFirst == \A x \in Cases : OuterFirst(x)
ASSUME AssumeContained == \A x \in Cases : Contained(x)

================================================================================
