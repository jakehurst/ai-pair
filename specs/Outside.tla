---- MODULE Outside ------------------------------------------------------------
(******************************************************************************)
(* Marking a file changed on disk outside the protocol, for #15: DESIGN.md    *)
(* "Changes outside the protocol", in packages/vscode/src/outside.ts and its  *)
(* wiring in outside_watch.ts. One file. VS Code writes it when a document is *)
(* saved (by the player after a batch, or by the programmer); the extension   *)
(* writes it when `show` creates it; and anything else may write it: the      *)
(* agent's own tools, git, a formatter run in a terminal. A file watcher      *)
(* reports writes late, and may report several as one event; when it reports, *)
(* the code reads the file and decides. Opening the file is the programmer    *)
(* seeing it: the mark clears. A write to an open file also reaches the       *)
(* controller as VS Code's document change: EditorAdapter attributes it, and  *)
(* Rehearsal's `EditAsOther` interrupts or follows it. That path is not here. *)
(******************************************************************************)
EXTENDS Naturals

CONSTANTS
    Rule,       \* "content": mark if the file differs from the text we know;
                \* "every": mark every event; "afterSave": skip an event
                \* that comes after a save
    Settle,     \* TRUE: decide only once a group of writes has settled, after
                \* timings.groupMs without one, by which time VS Code has
                \* told the code of its save
    MaxWrites   \* how many edits and outside writes the model makes

ASSUME AssumeRule == Rule \in {"content", "every", "afterSave"}
ASSUME AssumeSettle == Settle \in BOOLEAN
ASSUME AssumeMaxWrites == MaxWrites \in Nat

\* The file's contents: each write makes a fresh number.
Contents == Nat \ {0}

\* No text: nothing is known, or no save is being told.
\* Any value that is not a content will do, so the config makes it a model
\* value (6.20).
NoText == CHOOSE v : v \notin Contents

\* No document: the file isn't open. Any value that is not a content will do,
\* so the config makes it a model value (6.20).
NoDocument == CHOOSE v : v \notin Contents

VARIABLES
    disk,             \* the file's content on disk
    documentText,     \* the open document's text, or NoDocument if not open
    knownText,        \* the last text VS Code saved or the programmer saw, or
                      \* NoText
    saved,            \* afterSave: a save happened since the last watcher event
    unreportedWrites, \* the watcher has writes it hasn't reported yet
    unreportedSave,   \* the text VS Code saved and hasn't yet told the code of
                      \* (onDidSaveTextDocument), or NoText
    badged,           \* the file's badge shows
    writtenOutside,   \* an outside write happened since the programmer last saw
                      \* it
    writes            \* contents so far; each new content is a fresh number

vars == <<disk, documentText, knownText, saved, unreportedWrites,
          unreportedSave, badged, writtenOutside, writes>>

--------------------------------------------------------------------------------

\* The values each variable can hold.
TypeOK ==
    /\ disk \in Contents
    /\ documentText \in Contents \cup {NoDocument}
    /\ knownText \in Contents \cup {NoText}
    /\ saved \in BOOLEAN
    /\ unreportedWrites \in BOOLEAN
    /\ unreportedSave \in Contents \cup {NoText}
    /\ badged \in BOOLEAN
    /\ writtenOutside \in BOOLEAN
    /\ writes \in Contents

\* The next fresh content.
Fresh == writes + 1

\* A timing assumption: VS Code tells of a save within milliseconds, so
\* nothing the programmer does (open, close, edit, save) falls between a save
\* and its notification; an outside write can.
Idle == unreportedSave = NoText

--------------------------------------------------------------------------------

Init ==
    /\ disk = 1
    /\ documentText = NoDocument
    /\ knownText = NoText
    /\ saved = FALSE
    /\ unreportedWrites = FALSE
    /\ unreportedSave = NoText
    /\ badged = FALSE
    /\ writtenOutside = FALSE
    /\ writes = 1

\* The programmer opens the file: it shows what's on disk, and the mark clears.
OpenDocument ==
    /\ Idle
    /\ documentText = NoDocument
    /\ documentText' = disk
    /\ knownText' = disk
    /\ badged' = FALSE
    /\ writtenOutside' = FALSE
    /\ UNCHANGED <<disk, saved, unreportedWrites, unreportedSave, writes>>

\* The programmer closes the file.
CloseDocument ==
    /\ Idle
    /\ documentText # NoDocument
    /\ documentText' = NoDocument
    /\ UNCHANGED <<disk, knownText, saved, unreportedWrites, unreportedSave,
                   badged, writtenOutside, writes>>

\* An edit in the editor: the agent's through the protocol, or the
\* programmer's.
Edit ==
    /\ Idle
    /\ documentText # NoDocument
    /\ documentText' = Fresh
    /\ writes' = Fresh
    /\ UNCHANGED <<disk, knownText, saved, unreportedWrites, unreportedSave,
                   badged, writtenOutside>>

\* VS Code saves the document: it writes its text; onDidSaveTextDocument tells
\* the code after.
Save ==
    /\ Idle
    /\ documentText # NoDocument
    /\ disk' = documentText
    /\ saved' = TRUE
    /\ unreportedWrites' = TRUE
    /\ unreportedSave' = documentText
    /\ UNCHANGED <<documentText, knownText, badged, writtenOutside, writes>>

\* onDidSaveTextDocument: the code learns the text VS Code saved.
NotifySave ==
    /\ unreportedSave # NoText
    /\ knownText' = unreportedSave
    /\ unreportedSave' = NoText
    /\ UNCHANGED <<disk, documentText, saved, unreportedWrites, badged,
                   writtenOutside, writes>>

\* The extension writes the file itself: `show` creating a missing one, empty.
\* It records the text. A missing file has no document, and no save of it is
\* on its way.
Show ==
    /\ Idle
    /\ documentText = NoDocument
    /\ disk' = Fresh
    /\ knownText' = Fresh
    /\ unreportedWrites' = TRUE
    /\ writes' = Fresh
    /\ UNCHANGED <<documentText, saved, unreportedSave, badged, writtenOutside>>

\* Something else writes the file. An open document with no unsaved changes
\* reloads it.
WriteOutside ==
    /\ disk' = Fresh
    /\ documentText' = IF documentText = disk THEN Fresh ELSE documentText
    /\ unreportedWrites' = TRUE
    /\ writtenOutside' = TRUE
    /\ writes' = Fresh
    /\ UNCHANGED <<knownText, saved, unreportedSave, badged>>

\* The watcher reports what it hasn't yet, as one event; the code decides by
\* its rule. Settled, it decides after the save's notification (a timing
\* assumption: timings.groupMs, half a second). The CASE needs no OTHER: its
\* arms cover every Rule that AssumeRule allows.
WatcherReports ==
    /\ unreportedWrites
    /\ Settle => (unreportedSave = NoText)
    /\ saved' = FALSE
    /\ unreportedWrites' = FALSE
    /\ badged' = CASE Rule = "content" -> badged \/ (disk # knownText)
                   [] Rule = "every" -> TRUE
                   [] Rule = "afterSave" -> badged \/ ~saved
    /\ UNCHANGED <<disk, documentText, knownText, unreportedSave,
                   writtenOutside, writes>>

Next ==
    \/ OpenDocument
    \/ CloseDocument
    \/ Edit
    \/ Save
    \/ NotifySave
    \/ Show
    \/ WriteOutside
    \/ WatcherReports

\* The watcher reports, and VS Code tells of its saves.
Fairness ==
    /\ WF_vars(WatcherReports)
    /\ WF_vars(NotifySave)

Spec == Init /\ [][Next]_vars /\ Fairness

--------------------------------------------------------------------------------

\* No badge without an outside write since the programmer last saw the file.
NoFalseMark == badged => writtenOutside

\* A file left changed outside, unlike anything we know, gets its badge:
\* something must happen.
Marks ==
    (writtenOutside /\ disk # knownText) ~> (badged \/ ~(writtenOutside
                                                         /\ disk # knownText))

\* Writes run out only so that the model is finite (6.8). It prunes exactly the
\* states a guard `writes < MaxWrites` on Edit, Show, and WriteOutside never
\* reached, so the behaviors, and Marks' result, are the guard's (8.6).
Constraint == writes <= MaxWrites

================================================================================
