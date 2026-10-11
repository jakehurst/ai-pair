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

\* Who makes a change. A keystroke while our save runs is told apart here only
\* so that its one allowed wrong attribution can be named (see OK).
Authors == {"agent", "programmer", "programmer during save", "participant"}

\* Who a change is attributed to: the agent's own edit, otherEdit (a tool's),
\* or userEdit (the programmer's).
Attributions == {"agent", "other", "programmer"}

VARIABLES
    own,    \* the agent's edit in flight: "idle", "sent" (applying), or
            \* "seen" (its event handled)
    saving, \* our save: "idle", "participants" (save participants run), or
            \* "writing" (they're done)
    inbox,  \* change events not yet handled, oldest first: who made each, and
            \* whether during our save
    made,   \* how many changes have happened
    wrong   \* attributions that don't match who made the change: [author, as]

vars == <<own, saving, inbox, made, wrong>>

--------------------------------------------------------------------------------

\* The values each variable can hold.
TypeOK ==
    /\ own \in {"idle", "sent", "seen"}
    /\ saving \in {"idle", "participants", "writing"}
    /\ inbox \in Seq(Authors)
    /\ made \in Nat
    /\ wrong \subseteq [author : Authors, as : Attributions]

\* A right attribution. A participant's change taken for the programmer's is
\* the safe side: "Anything unsure counts as the programmer's, so it
\* interrupts" (byProgrammer's comment). A programmer's change made while our
\* save runs can't be told from a participant's: VS Code doesn't say who made
\* a change, and the participants (format on save) run in that time. Taking it
\* for a tool's is the one wrong attribution allowed, and it is called out by
\* name.
OK(author, as) ==
    \/ author = as
    \/ author = "participant" /\ as \in {"other", "programmer"}
    \/ author = "programmer during save" /\ as \in {"other", "programmer"}

\* The attribution of a change, as a set to add to `wrong`: empty when it is
\* right.
Note(author, as) ==
    IF OK(author, as) THEN {} ELSE {[author |-> author, as |-> as]}

--------------------------------------------------------------------------------

Init ==
    /\ own = "idle"
    /\ saving = "idle"
    /\ inbox = <<>>
    /\ made = 0
    /\ wrong = {}

\* edit(): the entry goes into `own`, VS Code applies the edit, and its event
\* is queued.
Edit ==
    /\ own = "idle"
    /\ saving = "idle"
    /\ own' = "sent"
    /\ inbox' = Append(inbox, "agent")
    /\ made' = made + 1
    /\ UNCHANGED <<saving, wrong>>

\* edit() resolves after its event; `finally` drops the entry if it's still
\* there.
ResolveEdit ==
    /\ own = "seen"
    /\ own' = "idle"
    /\ UNCHANGED <<saving, inbox, made, wrong>>

\* The programmer types: the change event is queued for the extension host.
Type ==
    LET author == IF saving = "idle"
                  THEN "programmer"
                  ELSE "programmer during save"
    IN  /\ inbox' = Append(inbox, author)
        /\ made' = made + 1
        /\ UNCHANGED <<own, saving, wrong>>

\* save(): `saving` is set, participants such as format on save may change the
\* document, the file is written, and save() resolves after every event before
\* it. With FlushBeforeSave, the round trip's answer comes after every change
\* event VS Code sent before it, so those are handled first.
StartSave ==
    /\ saving = "idle"
    /\ own = "idle"
    /\ FlushBeforeSave => (inbox = <<>>)
    /\ saving' = "participants"
    /\ UNCHANGED <<own, inbox, made, wrong>>

\* A save participant changes the document while our save runs.
RunParticipant ==
    /\ saving = "participants"
    /\ inbox' = Append(inbox, "participant")
    /\ made' = made + 1
    /\ UNCHANGED <<own, saving, wrong>>

\* The save participants are done, and the file is written.
FinishParticipants ==
    /\ saving = "participants"
    /\ saving' = "writing"
    /\ UNCHANGED <<own, inbox, made, wrong>>

\* save() resolves after every event before it, which came over the same
\* channel.
FinishSave ==
    /\ saving = "writing"
    /\ inbox = <<>>
    /\ saving' = "idle"
    /\ UNCHANGED <<own, inbox, made, wrong>>

\* onChange: an event while the agent's edit is in flight is that edit (events
\* come in order, and the agent's is the one its entry matches); otherwise
\* byProgrammer: during our save, a tool's (`this.saving.has(file)`), and
\* otherwise the programmer's.
Handle ==
    /\ inbox # <<>>
    /\ LET author == Head(inbox)
           mine == own = "sent" /\ author = "agent"
           as == IF mine
                 THEN "agent"
                 ELSE IF saving # "idle" THEN "other" ELSE "programmer"
       IN  /\ own' = IF mine THEN "seen" ELSE own
           /\ inbox' = Tail(inbox)
           /\ wrong' = wrong \cup Note(author, as)
    /\ UNCHANGED <<saving, made>>

Next ==
    \/ Edit
    \/ ResolveEdit
    \/ Type
    \/ StartSave
    \/ RunParticipant
    \/ FinishParticipants
    \/ FinishSave
    \/ Handle

\* onChange runs for every event VS Code delivers.
Fairness == WF_vars(Handle)

Spec == Init /\ [][Next]_vars /\ Fairness

--------------------------------------------------------------------------------

\* S12: a change is attributed to the agent only if the agent made it, and a
\* change the programmer made is attributed to the programmer, so it
\* interrupts.
RightAuthor == wrong = {}

\* Every change made is handled: the nth change is attributed to someone once
\* n changes are made. Code that never handled one would fail it, so it says
\* something must happen.
ChangesHandled ==
    \A n \in 1..MaxChanges : (made >= n) ~> (made - Len(inbox) >= n)

\* Changes run out only so that the model is finite (6.8).
Constraint == made <= MaxChanges

================================================================================
