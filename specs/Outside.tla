---- MODULE Outside ------------------------------------------------------------
(******************************************************************************)
(* Marking a file changed on disk outside the protocol, for #15: DESIGN.md    *)
(* "Changes outside the protocol", in packages/vscode/src/outside.ts and its  *)
(* wiring in outsideWatch.ts. One file. VS Code writes it when a document is  *)
(* saved (by the player after a batch, or by the programmer); the extension   *)
(* writes it when `show` creates it; and anything else may write it: the      *)
(* agent's own tools, git, a formatter run in a terminal. A file watcher      *)
(* reports writes late, and may report several as one event; when it reports, *)
(* the code reads the file and decides. Opening the file is the programmer    *)
(* seeing it: the mark clears.                                                *)
(******************************************************************************)
EXTENDS Naturals

CONSTANTS
    Rule,       \* "content": mark if the file differs from the text we know;
                \* "every": mark every event; "afterSave": skip an event
                \* that comes after a save
    Settle,     \* TRUE: decide only once a group of writes has settled, after
                \* GROUP_MS without one, by which time VS Code has told the
                \* code of its save
    MaxWrites   \* how many edits and outside writes the model makes

ASSUME AssumeRule == Rule \in {"content", "every", "afterSave"}
ASSUME AssumeSettle == Settle \in BOOLEAN
ASSUME AssumeMaxWrites == MaxWrites \in Nat

\* The file's contents: each write makes a fresh number.
Contents == Nat \ {0}

\* No text: the file isn't open, nothing is known, or no save is being told.
\* Any value that is not a content will do, so the config makes it a model
\* value (6.20).
NoText == CHOOSE v : v \notin Contents

VARIABLES
    disk,       \* the file's content on disk
    doc,        \* the open document's text, or NoText if the file isn't open
    known,      \* the last text VS Code saved or the programmer saw, or NoText
    saved,      \* afterSave: a save happened since the last watcher event
    pending,    \* the watcher has writes it hasn't reported yet
    notify,     \* the text VS Code saved and hasn't yet told the code of
                \* (onDidSaveTextDocument), or NoText
    marked,     \* the file's badge shows
    outside,    \* an outside write happened since the programmer last saw it
    writes      \* contents so far; each new content is a fresh number

vars == <<disk, doc, known, saved, pending, notify, marked, outside, writes>>

--------------------------------------------------------------------------------

\* The values each variable can hold.
TypeOK ==
    /\ disk \in Contents
    /\ doc \in Contents \cup {NoText}
    /\ known \in Contents \cup {NoText}
    /\ saved \in BOOLEAN
    /\ pending \in BOOLEAN
    /\ notify \in Contents \cup {NoText}
    /\ marked \in BOOLEAN
    /\ outside \in BOOLEAN
    /\ writes \in Contents

\* The next fresh content.
Fresh == writes + 1

\* A timing assumption: VS Code tells of a save within milliseconds, so
\* nothing the programmer does (open, close, edit, save) falls between a save
\* and its notification; an outside write can.
Idle == notify = NoText

--------------------------------------------------------------------------------

Init ==
    /\ disk = 1
    /\ doc = NoText
    /\ known = NoText
    /\ saved = FALSE
    /\ pending = FALSE
    /\ notify = NoText
    /\ marked = FALSE
    /\ outside = FALSE
    /\ writes = 1

\* The programmer opens the file: it shows what's on disk, and the mark clears.
Open ==
    /\ Idle
    /\ doc = NoText
    /\ doc' = disk
    /\ known' = disk
    /\ marked' = FALSE
    /\ outside' = FALSE
    /\ UNCHANGED <<disk, saved, pending, notify, writes>>

\* The programmer closes the file.
Close ==
    /\ Idle
    /\ doc # NoText
    /\ doc' = NoText
    /\ UNCHANGED <<disk, known, saved, pending, notify, marked, outside,
                   writes>>

\* An edit in the editor: the agent's through the protocol, or the
\* programmer's.
Edit ==
    /\ Idle
    /\ doc # NoText
    /\ doc' = Fresh
    /\ writes' = Fresh
    /\ UNCHANGED <<disk, known, saved, pending, notify, marked, outside>>

\* VS Code saves the document: it writes its text; onDidSaveTextDocument tells
\* the code after.
Save ==
    /\ Idle
    /\ doc # NoText
    /\ disk' = doc
    /\ saved' = TRUE
    /\ pending' = TRUE
    /\ notify' = doc
    /\ UNCHANGED <<doc, known, marked, outside, writes>>

\* onDidSaveTextDocument: the code learns the text VS Code saved.
NotifySave ==
    /\ notify # NoText
    /\ known' = notify
    /\ notify' = NoText
    /\ UNCHANGED <<disk, doc, saved, pending, marked, outside, writes>>

\* The extension writes the file itself: `show` creating a missing one, empty.
\* It records the text. A missing file has no document, and no save of it is
\* on its way.
Create ==
    /\ Idle
    /\ doc = NoText
    /\ disk' = Fresh
    /\ known' = Fresh
    /\ pending' = TRUE
    /\ writes' = Fresh
    /\ UNCHANGED <<doc, saved, notify, marked, outside>>

\* Something else writes the file. An open document with no unsaved changes
\* reloads it.
Write ==
    /\ disk' = Fresh
    /\ doc' = IF doc = disk THEN Fresh ELSE doc
    /\ pending' = TRUE
    /\ outside' = TRUE
    /\ writes' = Fresh
    /\ UNCHANGED <<known, saved, notify, marked>>

\* The watcher reports what it hasn't yet, as one event; the code decides by
\* its rule. Settled, it decides after the save's notification (a timing
\* assumption: GROUP_MS, half a second). The CASE needs no OTHER: its arms
\* cover every Rule that AssumeRule allows.
Report ==
    /\ pending
    /\ Settle => (notify = NoText)
    /\ saved' = FALSE
    /\ pending' = FALSE
    /\ marked' = CASE Rule = "content" -> marked \/ (disk # known)
                   [] Rule = "every" -> TRUE
                   [] Rule = "afterSave" -> marked \/ ~saved
    /\ UNCHANGED <<disk, doc, known, notify, outside, writes>>

Next ==
    \/ Open
    \/ Close
    \/ Edit
    \/ Save
    \/ NotifySave
    \/ Create
    \/ Write
    \/ Report

\* The watcher reports, and VS Code tells of its saves.
Fairness ==
    /\ WF_vars(Report)
    /\ WF_vars(NotifySave)

Spec == Init /\ [][Next]_vars /\ Fairness

--------------------------------------------------------------------------------

\* No badge without an outside write since the programmer last saw the file.
NoFalseMark == marked => outside

\* A file left changed outside, unlike anything we know, gets its badge:
\* something must happen.
Marks ==
    (outside /\ disk # known) ~> (marked \/ ~(outside /\ disk # known))

\* Writes run out only so that the model is finite (6.8). It prunes exactly the
\* states a guard `writes < MaxWrites` on Edit, Create, and Write never
\* reached, so the behaviors, and Marks' result, are the guard's (8.6).
Constraint == writes <= MaxWrites

================================================================================
