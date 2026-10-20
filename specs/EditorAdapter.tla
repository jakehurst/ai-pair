---- MODULE EditorAdapter ------------------------------------------------------
(******************************************************************************)
(* Who a change to a document is attributed to: `edit`, `save`, `onChange`    *)
(* and `byProgrammer` in packages/vscode/src/editor.ts, which call the        *)
(* controller's userEdit (the programmer's: it interrupts) or otherEdit (a    *)
(* tool's).                                                                   *)
(*                                                                            *)
(* VS Code delivers a change event before the call that made it resolves:     *)
(* both travel from the main thread over the same RPC channel, in order. A    *)
(* programmer's change that is exactly the agent's edit in flight isn't       *)
(* modeled: the two can't be told apart, and swapping who each is attributed  *)
(* to changes nothing that gets reported.                                     *)
(******************************************************************************)
EXTENDS Naturals, Sequences

CONSTANTS
    MaxChanges,     \* how many changes the model makes
    FlushBeforeSave \* TRUE: save() makes a round trip to the main thread
                    \* before it sets `saving` (#40)

ASSUME AssumeMaxChanges == MaxChanges \in Nat
ASSUME AssumeFlushBeforeSave == FlushBeforeSave \in BOOLEAN

\* Who makes a change: the agent, the programmer, a save participant, or a
\* reload from disk. A keystroke while our save runs is told apart here only
\* so that its one allowed wrong attribution can be named (see OK).
Authors ==
    {"agent", "programmer", "programmerDuringSave", "participant", "disk"}

\* Who a change is attributed to: the agent's own edit, otherEdit (a tool's),
\* or userEdit (the programmer's).
Attributions == {"agent", "other", "programmer"}

VARIABLES
    ownEdit,          \* the agent's edit in flight: "idle", "awaiting"
                      \* (applying), "handled" (its event handled), or
                      \* "rejected" (refused: no event comes)
    saving,           \* our save: "idle", "participants" (save participants
                      \* run), or "writing" (they're done)
    creating,         \* TRUE while create() saves the document it emptied,
                      \* without `saving`
    inbox,            \* change events not yet handled, oldest first: who made
                      \* each, and whether during our save
    changes,          \* how many changes have happened
    wrongAttributions \* attributions that don't match who made the change:
                      \* [author, as]

vars == <<ownEdit, saving, creating, inbox, changes, wrongAttributions>>

--------------------------------------------------------------------------------

\* The values each variable can hold.
TypeOK ==
    /\ ownEdit \in {"idle", "awaiting", "handled", "rejected"}
    /\ saving \in {"idle", "participants", "writing"}
    /\ creating \in BOOLEAN
    /\ inbox \in Seq(Authors)
    /\ changes \in Nat
    /\ wrongAttributions \subseteq [author : Authors,
                                    attribution : Attributions]

\* A right attribution. A participant's change taken for the programmer's is
\* the safe side: "Anything unsure counts as the programmer's, so it
\* interrupts" (byProgrammer's comment). A programmer's change made while our
\* save runs can't be told from a participant's: VS Code doesn't say who made
\* a change, and the participants (format on save) run in that time. Taking it
\* for a tool's is the one wrong attribution allowed, and it is called out by
\* name.
RightAttribution(author, attribution) ==
    \/ author = attribution
    \/ author = "participant" /\ attribution \in {"other", "programmer"}
    \/ author = "programmerDuringSave" /\ attribution \in {"other",
                                                           "programmer"}
    \/ author = "disk" /\ attribution = "other"

\* The attribution of a change, as a set to add to `wrongAttributions`: empty
\* when it is right.
WrongAttribution(author, attribution) ==
    IF RightAttribution(author, attribution) THEN {}
    ELSE {[author |-> author, attribution |-> attribution]}

--------------------------------------------------------------------------------

Init ==
    /\ ownEdit = "idle"
    /\ saving = "idle"
    /\ creating = FALSE
    /\ inbox = <<>>
    /\ changes = 0
    /\ wrongAttributions = {}

\* edit(): the entry goes into `ownEdit`, VS Code applies the edit, and its
\* event is queued.
EditAsAgent ==
    /\ ownEdit = "idle"
    /\ saving = "idle"
    /\ creating = FALSE
    /\ ownEdit' = "awaiting"
    /\ inbox' = Append(inbox, "agent")
    /\ changes' = changes + 1
    /\ UNCHANGED <<saving, creating, wrongAttributions>>

\* edit(): the entry goes into `ownEdit`, and VS Code refuses the edit, or the
\* document can't be read: no change, so no event; edit() throws.
RejectEdit ==
    /\ ownEdit = "idle"
    /\ saving = "idle"
    /\ creating = FALSE
    /\ ownEdit' = "rejected"
    /\ UNCHANGED <<saving, creating, inbox, changes, wrongAttributions>>

\* edit() resolves after its event, or throws; `finally` drops the entry if
\* it's still there.
ResolveEdit ==
    /\ ownEdit \in {"handled", "rejected"}
    /\ ownEdit' = "idle"
    /\ UNCHANGED <<saving, creating, inbox, changes, wrongAttributions>>

\* The programmer types: the change event is queued for the extension host.
EditAsProgrammer ==
    LET author == IF saving = "idle"
                  THEN "programmer"
                  ELSE "programmerDuringSave"
    IN  /\ inbox' = Append(inbox, author)
        /\ changes' = changes + 1
        /\ UNCHANGED <<ownEdit, saving, creating, wrongAttributions>>

\* A file replaced on disk while open, as a git checkout does: VS Code reloads
\* the document, and the change event is queued (Reload.tla has the lines).
Reload ==
    /\ inbox' = Append(inbox, "disk")
    /\ changes' = changes + 1
    /\ UNCHANGED <<ownEdit, saving, creating, wrongAttributions>>

\* save(): `saving` is set, participants such as format on save may change the
\* document, the file is written, and save() resolves after every event before
\* it. With FlushBeforeSave, the round trip's answer comes after every change
\* event VS Code sent before it, so those are handled first.
StartSave ==
    /\ saving = "idle"
    /\ ownEdit = "idle"
    /\ creating = FALSE
    /\ FlushBeforeSave => (inbox = <<>>)
    /\ saving' = "participants"
    /\ UNCHANGED <<ownEdit, creating, inbox, changes, wrongAttributions>>

\* create(), in show(), for a file deleted while VS Code kept its document:
\* once its edit emptied the document, it saves it with doc.save(), without
\* `saving` and without the round trip.
StartCreateSave ==
    /\ saving = "idle"
    /\ ownEdit = "idle"
    /\ creating = FALSE
    /\ creating' = TRUE
    /\ UNCHANGED <<ownEdit, saving, inbox, changes, wrongAttributions>>

\* A save participant changes the document while our save runs, or create's.
RunParticipant ==
    /\ saving = "participants" \/ creating
    /\ inbox' = Append(inbox, "participant")
    /\ changes' = changes + 1
    /\ UNCHANGED <<ownEdit, saving, creating, wrongAttributions>>

\* The save participants are done, and the file is written.
FinishParticipants ==
    /\ saving = "participants"
    /\ saving' = "writing"
    /\ UNCHANGED <<ownEdit, creating, inbox, changes, wrongAttributions>>

\* save() resolves after every event before it, which came over the same
\* channel.
FinishSave ==
    /\ saving = "writing"
    /\ inbox = <<>>
    /\ saving' = "idle"
    /\ UNCHANGED <<ownEdit, creating, inbox, changes, wrongAttributions>>

\* create's doc.save() resolves; nothing waits on its events.
FinishCreateSave ==
    /\ creating
    /\ creating' = FALSE
    /\ UNCHANGED <<ownEdit, saving, inbox, changes, wrongAttributions>>

\* onChange: an event while the agent's edit is in flight is that edit (events
\* come in order, and the agent's is the one its entry matches); otherwise
\* byProgrammer: during our save, a tool's (`this.saving.has(file)`); a reload
\* from disk, a tool's (a clean document reading what is on disk); and
\* otherwise the programmer's. A rejected edit's entry stays until `finally`,
\* but matches no event: no change is the edit it refused.
Handle ==
    /\ inbox # <<>>
    /\ LET author == Head(inbox)
           mine == ownEdit = "awaiting" /\ author = "agent"
           attribution == IF mine
                 THEN "agent"
                 ELSE IF saving # "idle" \/ author = "disk"
                      THEN "other"
                      ELSE "programmer"
       IN  /\ ownEdit' = IF mine THEN "handled" ELSE ownEdit
           /\ inbox' = Tail(inbox)
           /\ wrongAttributions' =
                   wrongAttributions \cup WrongAttribution(author, attribution)
    /\ UNCHANGED <<saving, creating, changes>>

Next ==
    \/ EditAsAgent
    \/ RejectEdit
    \/ ResolveEdit
    \/ EditAsProgrammer
    \/ Reload
    \/ StartSave
    \/ StartCreateSave
    \/ RunParticipant
    \/ FinishParticipants
    \/ FinishSave
    \/ FinishCreateSave
    \/ Handle

\* onChange runs for every event VS Code delivers, and edit()'s `finally`
\* runs once VS Code answers.
Fairness == WF_vars(Handle) /\ WF_vars(ResolveEdit)

Spec == Init /\ [][Next]_vars /\ Fairness

--------------------------------------------------------------------------------

\* A change is attributed to the agent only if the agent made it, and a
\* change the programmer made is attributed to the programmer, so it
\* interrupts.
RightAuthor == wrongAttributions = {}

\* Every change made is handled: the nth change is attributed to someone once
\* n changes are made. Code that never handled one would fail it, so it says
\* something must happen.
ChangesHandled ==
    \A n \in 1..MaxChanges : (changes >= n) ~> (changes - Len(inbox) >= n)

\* Every edit of the agent's ends, applied or refused, with its entry gone:
\* an entry left behind would stand first in `own` for the next edit.
EditsEnd == (ownEdit # "idle") ~> (ownEdit = "idle")

\* Changes run out only so that the model is finite (6.8).
Constraint == changes <= MaxChanges

================================================================================
