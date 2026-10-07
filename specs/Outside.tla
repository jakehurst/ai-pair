-------------------------------- MODULE Outside --------------------------------
\* Marking a file changed on disk outside the protocol, for #15: DESIGN.md "Changes outside the
\* protocol", in packages/vscode/src/outside.ts and its wiring in extension.ts. One file. VS Code
\* writes it when a document is saved (by the player after a batch, or by the programmer); the
\* extension writes it when `show` creates it; and anything else may write it: the agent's own
\* tools, git, a formatter run in a terminal. A file watcher reports writes late, and may report
\* several as one event; when it reports, the code reads the file and decides. Opening the file is
\* the programmer seeing it: the mark clears.
EXTENDS Naturals

CONSTANTS
    Rule,       \* "content": mark if the file differs from the text we know; "every": mark every
                \* event; "afterSave": skip an event that comes after a save
    Settle,     \* TRUE: decide only once a group of writes has settled, after GROUP_MS without one,
                \* by which time VS Code has told the code of its save
    MaxWrites   \* how many edits and outside writes in a run

None == 0

VARIABLES
    disk,       \* the file's content on disk
    doc,        \* the open document's text, or None if the file isn't open
    known,      \* the last text VS Code saved or the programmer saw, or None
    saved,      \* afterSave: a save happened since the last watcher event
    pending,    \* the watcher has writes it hasn't reported yet
    notify,     \* VS Code saved, and hasn't yet told the code (onDidSaveTextDocument)
    marked,     \* the file's badge shows
    outside,    \* an outside write happened since the programmer last saw the file
    writes      \* contents so far; each new content is a fresh number

vars == <<disk, doc, known, saved, pending, notify, marked, outside, writes>>

Init ==
    /\ disk = 1 /\ doc = None /\ known = None /\ saved = FALSE
    /\ pending = FALSE /\ notify = None /\ marked = FALSE /\ outside = FALSE /\ writes = 1

Fresh == writes + 1

\* A timing assumption: VS Code tells of a save within milliseconds, so nothing the programmer does
\* (open, close, edit, save) falls between a save and its notification; an outside write can.
Idle == notify = None

\* The programmer opens the file: it shows what's on disk, and the mark clears.
Open ==
    /\ Idle /\ doc = None /\ doc' = disk /\ known' = disk /\ marked' = FALSE /\ outside' = FALSE
    /\ UNCHANGED <<disk, saved, pending, notify, writes>>

Close == Idle /\ doc # None /\ doc' = None /\ UNCHANGED <<disk, known, saved, pending, notify, marked, outside, writes>>

\* An edit in the editor: the agent's through the protocol, or the programmer's.
Edit ==
    /\ Idle /\ doc # None /\ writes < MaxWrites /\ writes' = Fresh /\ doc' = Fresh
    /\ UNCHANGED <<disk, known, saved, pending, notify, marked, outside>>

\* VS Code saves the document: it writes its text; onDidSaveTextDocument tells the code after.
Save ==
    /\ Idle /\ doc # None /\ disk' = doc /\ notify' = doc /\ saved' = TRUE /\ pending' = TRUE
    /\ UNCHANGED <<doc, known, marked, outside, writes>>
Saved == notify # None /\ known' = notify /\ notify' = None /\ UNCHANGED <<disk, doc, saved, pending, marked, outside, writes>>

\* The extension writes the file itself: `show` creating a missing one, empty. It records the text.
\* A missing file has no document, and no save of it is on its way.
Create ==
    /\ Idle /\ doc = None /\ writes < MaxWrites /\ writes' = Fresh /\ disk' = Fresh /\ known' = Fresh /\ pending' = TRUE
    /\ UNCHANGED <<doc, saved, notify, marked, outside>>

\* Something else writes the file. An open document with no unsaved changes reloads it.
Write ==
    /\ writes < MaxWrites /\ writes' = Fresh /\ disk' = Fresh /\ pending' = TRUE /\ outside' = TRUE
    /\ doc' = IF doc = disk THEN Fresh ELSE doc
    /\ UNCHANGED <<known, saved, notify, marked>>

\* The watcher reports what it hasn't yet, as one event; the code decides by its rule. Settled, it
\* decides after the save's notification (a timing assumption: GROUP_MS, half a second).
Report ==
    /\ pending /\ pending' = FALSE /\ saved' = FALSE
    /\ Settle => notify = None
    /\ marked' = CASE Rule = "content" -> marked \/ disk # known
                   [] Rule = "every" -> TRUE
                   [] Rule = "afterSave" -> marked \/ ~saved
    /\ UNCHANGED <<disk, doc, known, notify, outside, writes>>

Next == Open \/ Close \/ Edit \/ Save \/ Saved \/ Create \/ Write \/ Report

Spec == Init /\ [][Next]_vars /\ WF_vars(Report) /\ WF_vars(Saved)

\* No badge without an outside write since the programmer last saw the file.
NoFalseMark == marked => outside

\* A file left changed outside, unlike anything we know, gets its badge.
Marks == (outside /\ disk # known) ~> (marked \/ ~(outside /\ disk # known))

=============================================================================
