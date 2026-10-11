---- MODULE FileText -----------------------------------------------------------
(******************************************************************************)
(* The text the session takes for a file: `getText` and `show` in             *)
(* packages/vscode/src/editor.ts, for #88 and #89. One file. It is on disk or *)
(* absent, and VS Code may hold a document for it, with or without a tab: one *)
(* the programmer opened, or another extension (Claude Code's file tools open *)
(* documents without tabs). VS Code keeps a document after its file is        *)
(* deleted, with its text, and reloads a document without unsaved changes     *)
(* from disk some time after the file changes. `show` (a `move` to a file)    *)
(* creates a missing file, empty.                                             *)
(******************************************************************************)
EXTENDS Naturals

CONSTANTS
    MaxSteps,   \* how many changes the model makes
    Fixed       \* TRUE: the code as #88 and #89 fix it

ASSUME AssumeMaxSteps == MaxSteps \in Nat
ASSUME AssumeFixed == Fixed \in BOOLEAN

\* The file's texts, as numbers; 0 is the empty text.
Texts == 0..2

\* No file on disk, no document, and getText's two failures: the file doesn't
\* exist, or something else is thrown (`internal`, as #89 saw). Each is any
\* value that is not a text and not one defined before it; the config makes
\* each a model value (6.20).
Absent == CHOOSE v : v \notin Texts
NoDocument == CHOOSE v : v \notin Texts \cup {Absent}
Missing == CHOOSE v : v \notin Texts \cup {Absent, NoDocument}
Error == CHOOSE v : v \notin Texts \cup {Absent, NoDocument, Missing}

VARIABLES
    disk,     \* the file on disk: a text, or Absent
    doc,      \* the document's text, or NoDocument
    dirty,    \* the document has unsaved changes
    created,  \* `show` just created the file, and nothing has changed it since
    steps     \* changes so far

vars == <<disk, doc, dirty, created, steps>>

--------------------------------------------------------------------------------

\* The values each variable can hold.
TypeOK ==
    /\ disk \in Texts \cup {Absent}
    /\ doc \in Texts \cup {NoDocument}
    /\ dirty \in BOOLEAN
    /\ created \in BOOLEAN
    /\ steps \in Nat

\* What getText returns.
GetText ==
    IF Fixed
    THEN IF doc # NoDocument /\ dirty
         THEN doc
         ELSE IF disk = Absent
              THEN Missing
              ELSE IF doc # NoDocument
                   THEN doc
                   ELSE disk
    ELSE IF doc # NoDocument
         THEN doc
         ELSE IF disk = Absent
              THEN Error
              ELSE disk

--------------------------------------------------------------------------------

Init ==
    /\ disk \in Texts
    /\ doc = NoDocument
    /\ dirty = FALSE
    /\ created = FALSE
    /\ steps = 0

\* Something opens a document for the file: the programmer, or another
\* extension.
Open ==
    /\ doc = NoDocument
    /\ disk # Absent
    /\ doc' = disk
    /\ dirty' = FALSE
    /\ UNCHANGED <<disk, created, steps>>

\* VS Code drops a document no one holds any more.
Close ==
    /\ doc # NoDocument
    /\ ~dirty
    /\ doc' = NoDocument
    /\ UNCHANGED <<disk, dirty, created, steps>>

\* The file is written on disk by anything.
Write ==
    /\ disk' \in Texts
    /\ created' = FALSE
    /\ steps' = steps + 1
    /\ UNCHANGED <<doc, dirty>>

\* The file is deleted on disk by anything.
Delete ==
    /\ disk # Absent
    /\ disk' = Absent
    /\ created' = FALSE
    /\ steps' = steps + 1
    /\ UNCHANGED <<doc, dirty>>

\* An edit in the document.
Edit ==
    /\ doc # NoDocument
    /\ doc' \in Texts
    /\ dirty' = TRUE
    /\ created' = FALSE
    /\ steps' = steps + 1
    /\ UNCHANGED disk

\* A save writes the document to disk, recreating a deleted file.
Save ==
    /\ doc # NoDocument
    /\ dirty
    /\ disk' = doc
    /\ dirty' = FALSE
    /\ UNCHANGED <<doc, created, steps>>

\* VS Code reloads a document without unsaved changes from the file on disk.
Reload ==
    /\ doc # NoDocument
    /\ ~dirty
    /\ disk # Absent
    /\ doc # disk
    /\ doc' = disk
    /\ UNCHANGED <<disk, dirty, created, steps>>

\* `show` on a missing file creates it, empty. Before the fix, `fs.stat` found
\* no file, the file is written empty on disk, and the document keeps its text
\* until a reload. Fixed: getText says the file is missing, so unsaved text is
\* kept, and a document for it without unsaved changes is emptied and saved,
\* which creates the file through VS Code, so the two agree at once.
Show ==
    /\ IF Fixed THEN GetText = Missing ELSE disk = Absent
    /\ disk' = 0
    /\ IF Fixed /\ doc # NoDocument
       THEN /\ doc' = 0
            /\ dirty' = FALSE
       ELSE UNCHANGED <<doc, dirty>>
    /\ created' = TRUE
    /\ UNCHANGED steps

Next ==
    \/ Open
    \/ Close
    \/ Write
    \/ Delete
    \/ Edit
    \/ Save
    \/ Reload
    \/ Show

Spec == Init /\ [][Next]_vars

--------------------------------------------------------------------------------

\* #88: a deleted file, with no unsaved changes for it, isn't read with the
\* text it had. A getText that returned the document as it was would fail it,
\* so it says something must happen.
NotStale ==
    (disk = Absent /\ ~(doc # NoDocument /\ dirty)) => (GetText = Missing)

\* #89: a missing file is reported as missing, never as another failure.
MissingIsReported == GetText # Error

\* A file `show` just created reads as empty, until something changes it.
CreatedIsEmpty == created => (GetText = 0)

\* The programmer's unsaved text changes only by their own edits.
KeepsUnsavedProp == [][(dirty /\ doc' # doc) => dirty']_vars

\* Changes run out only so that the model is finite (6.8).
Constraint == steps <= MaxSteps

================================================================================
