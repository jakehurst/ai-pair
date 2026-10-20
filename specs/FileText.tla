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
    MaxChanges, \* how many changes the model makes
    PreferDirty \* TRUE: the code as #88 and #89 fix it

ASSUME AssumeMaxChanges == MaxChanges \in Nat
ASSUME AssumePreferDirty == PreferDirty \in BOOLEAN

\* The file's texts, as numbers; 0 is the empty text.
Contents == 0..2

\* No file on disk, no document, and getText's two failures: the file doesn't
\* exist, or something else is thrown (`internal`, as #89 saw). Each is any
\* value that is not a text and not one defined before it; the config makes
\* each a model value (6.20).
Absent == CHOOSE v : v \notin Contents
NoDocument == CHOOSE v : v \notin Contents \cup {Absent}
NoSuchFile == CHOOSE v : v \notin Contents \cup {Absent, NoDocument}
Internal == CHOOSE v : v \notin Contents \cup {Absent, NoDocument, NoSuchFile}

VARIABLES
    diskText,     \* the file on disk: a text, or Absent
    documentText, \* the document's text, or NoDocument
    dirty,        \* the document has unsaved changes
    created,      \* `show` just created the file, and nothing has changed it
                  \* since
    changes       \* changes so far

vars == <<diskText, documentText, dirty, created, changes>>

--------------------------------------------------------------------------------

\* The values each variable can hold.
TypeOK ==
    /\ diskText \in Contents \cup {Absent}
    /\ documentText \in Contents \cup {NoDocument}
    /\ dirty \in BOOLEAN
    /\ created \in BOOLEAN
    /\ changes \in Nat

\* What getText returns.
GetText ==
    IF PreferDirty
    THEN IF documentText # NoDocument /\ dirty
         THEN documentText
         ELSE IF diskText = Absent
              THEN NoSuchFile
              ELSE IF documentText # NoDocument
                   THEN documentText
                   ELSE diskText
    ELSE IF documentText # NoDocument
         THEN documentText
         ELSE IF diskText = Absent
              THEN Internal
              ELSE diskText

--------------------------------------------------------------------------------

Init ==
    /\ diskText \in Contents
    /\ documentText = NoDocument
    /\ dirty = FALSE
    /\ created = FALSE
    /\ changes = 0

\* Something opens a document for the file: the programmer, or another
\* extension.
OpenDocument ==
    /\ documentText = NoDocument
    /\ diskText # Absent
    /\ documentText' = diskText
    /\ dirty' = FALSE
    /\ UNCHANGED <<diskText, created, changes>>

\* VS Code drops a document no one holds any more.
CloseDocument ==
    /\ documentText # NoDocument
    /\ ~dirty
    /\ documentText' = NoDocument
    /\ UNCHANGED <<diskText, dirty, created, changes>>

\* The file is written on disk by anything.
Write ==
    /\ diskText' \in Contents
    /\ created' = FALSE
    /\ changes' = changes + 1
    /\ UNCHANGED <<documentText, dirty>>

\* The file is deleted on disk by anything.
Delete ==
    /\ diskText # Absent
    /\ diskText' = Absent
    /\ created' = FALSE
    /\ changes' = changes + 1
    /\ UNCHANGED <<documentText, dirty>>

\* An edit in the document.
Edit ==
    /\ documentText # NoDocument
    /\ documentText' \in Contents
    /\ dirty' = TRUE
    /\ created' = FALSE
    /\ changes' = changes + 1
    /\ UNCHANGED diskText

\* A save writes the document to disk, recreating a deleted file.
Save ==
    /\ documentText # NoDocument
    /\ dirty
    /\ diskText' = documentText
    /\ dirty' = FALSE
    /\ UNCHANGED <<documentText, created, changes>>

\* VS Code reloads a document without unsaved changes from the file on disk.
Reload ==
    /\ documentText # NoDocument
    /\ ~dirty
    /\ diskText # Absent
    /\ documentText # diskText
    /\ documentText' = diskText
    /\ UNCHANGED <<diskText, dirty, created, changes>>

\* `show` on a missing file creates it, empty. Before the fix, `fs.stat` found
\* no file, the file is written empty on disk, and the document keeps its text
\* until a reload. PreferDirty: getText says the file is missing, so unsaved
\* text is kept, and a document for it without unsaved changes is emptied and
\* saved, which creates the file through VS Code, so the two agree at once.
Show ==
    /\ IF PreferDirty THEN GetText = NoSuchFile ELSE diskText = Absent
    /\ diskText' = 0
    /\ IF PreferDirty /\ documentText # NoDocument
       THEN /\ documentText' = 0
            /\ dirty' = FALSE
       ELSE UNCHANGED <<documentText, dirty>>
    /\ created' = TRUE
    /\ UNCHANGED changes

Next ==
    \/ OpenDocument
    \/ CloseDocument
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
    (diskText = Absent /\ ~(documentText # NoDocument
                            /\ dirty)) => (GetText = NoSuchFile)

\* #89: a missing file is reported as missing, never as another failure.
MissingIsReported == GetText # Internal

\* A file `show` just created reads as empty, until something changes it.
CreatedIsEmpty == created => (GetText = 0)

\* The programmer's unsaved text changes only by their own edits.
KeepsUnsavedProp == [][(dirty /\ documentText' # documentText) => dirty']_vars

\* Changes run out only so that the model is finite (6.8).
Constraint == changes <= MaxChanges

================================================================================
