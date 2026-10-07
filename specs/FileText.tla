------------------------------- MODULE FileText -------------------------------
\* The text the session takes for a file: `getText` and `show` in packages/vscode/src/editor.ts,
\* for #88 and #89. One file. It is on disk or absent, and VS Code may hold a document for it, with
\* or without a tab: one the programmer opened, or another extension (Claude Code's file tools open
\* documents without tabs). VS Code keeps a document after its file is deleted, with its text, and
\* reloads a document without unsaved changes from disk some time after the file changes. `show`
\* (a `move` to a file) creates a missing file, empty.
EXTENDS Integers

CONSTANT Fixed   \* TRUE: the code as #88 and #89 fix it

Texts == 0..2    \* 0 is the empty text
Absent == -1     \* no file on disk
Missing == -2    \* getText says the file doesn't exist
Error == -3      \* getText throws something else (`internal`, as #89 saw)
None == -1       \* no document

VARIABLES
    disk,     \* the file on disk: a text, or Absent
    doc,      \* the document's text, or None
    dirty,    \* the document has unsaved changes
    created,  \* `show` just created the file, and nothing has changed it since
    steps     \* changes so far, to bound the run

vars == <<disk, doc, dirty, created, steps>>

Init == disk \in Texts /\ doc = None /\ dirty = FALSE /\ created = FALSE /\ steps = 0

Bound == steps < 4 /\ steps' = steps + 1

\* What getText returns.
GetText ==
    IF Fixed
        THEN IF doc # None /\ dirty THEN doc
             ELSE IF disk = Absent THEN Missing
             ELSE IF doc # None THEN doc
             ELSE disk
        ELSE IF doc # None THEN doc
             ELSE IF disk = Absent THEN Error
             ELSE disk

\* Something opens a document for the file: the programmer, or another extension.
Open == doc = None /\ disk # Absent /\ doc' = disk /\ dirty' = FALSE /\ UNCHANGED <<disk, created, steps>>

\* VS Code drops a document no one holds any more.
Close == doc # None /\ ~dirty /\ doc' = None /\ UNCHANGED <<disk, dirty, created, steps>>

\* The file is written, or deleted, on disk by anything.
Write == Bound /\ \E t \in Texts : disk' = t /\ UNCHANGED <<doc, dirty>> /\ created' = FALSE
Delete == Bound /\ disk # Absent /\ disk' = Absent /\ created' = FALSE /\ UNCHANGED <<doc, dirty>>

\* An edit in the document; a save writes it to disk (recreating a deleted file).
Edit == Bound /\ doc # None /\ \E t \in Texts : doc' = t /\ dirty' = TRUE /\ created' = FALSE /\ UNCHANGED disk
Save == doc # None /\ dirty /\ disk' = doc /\ dirty' = FALSE /\ UNCHANGED <<doc, created, steps>>

\* VS Code reloads a document without unsaved changes from the file on disk.
Reload == doc # None /\ ~dirty /\ disk # Absent /\ doc # disk /\ doc' = disk /\ UNCHANGED <<disk, dirty, created, steps>>

\* `show` on a missing file creates it, empty. Fixed: a document for it, without unsaved changes,
\* is emptied and saved, which creates the file through VS Code, so the two agree at once.
\* Before: the file is written empty on disk, and the document keeps its text until a reload.
Show ==
    \* Before, `fs.stat` found no file. Fixed: getText says it's missing, so unsaved text is kept.
    /\ IF Fixed THEN GetText = Missing ELSE disk = Absent
    /\ disk' = 0 /\ created' = TRUE
    /\ IF Fixed /\ doc # None THEN doc' = 0 /\ dirty' = FALSE ELSE UNCHANGED <<doc, dirty>>
    /\ UNCHANGED steps

Next == Open \/ Close \/ Write \/ Delete \/ Edit \/ Save \/ Reload \/ Show

Spec == Init /\ [][Next]_vars

\* #88: a deleted file, with no unsaved changes for it, isn't read with the text it had.
NotStale == (disk = Absent /\ ~(doc # None /\ dirty)) => GetText = Missing

\* #89: a missing file is reported as missing, never as another failure.
MissingIsReported == GetText # Error

\* A file `show` just created reads as empty, until something changes it.
CreatedIsEmpty == created => GetText = 0

\* The programmer's unsaved text changes only by their own edits.
KeepsUnsaved == [][(dirty /\ doc' # doc) => dirty']_vars

=============================================================================
