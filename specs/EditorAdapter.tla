---------------------------- MODULE EditorAdapter ----------------------------
\* Who a change to a document is attributed to: `edit`, `save`, `onChange` and
\* `byProgrammer` in packages/vscode/src/editor.ts, which call the controller's
\* userEdit (the programmer's: it interrupts) or otherEdit (a tool's).
\*
\* VS Code delivers a change event before the call that made it resolves: both travel
\* from the main thread over the same RPC channel, in order. A programmer's change that
\* is exactly the agent's edit in flight isn't modeled: the two can't be told apart, and
\* swapping who each is attributed to changes nothing that gets reported.
EXTENDS Naturals, Sequences

CONSTANTS
    N,                \* how many changes happen in a run
    FlushBeforeSave   \* TRUE: save() makes a round trip to the main thread before it sets `saving`

VARIABLES
    own,     \* the agent's edit in flight: "none", "sent" (applying), "seen" (its event handled)
    saving,  \* our save: "no", "participants" (save participants run), "writing" (they're done)
    inbox,   \* change events not yet handled, oldest first: who made each, and whether during our save
    made,    \* how many changes have happened
    wrong    \* attributions that don't match who made the change: [author, as]

vars == <<own, saving, inbox, made, wrong>>

\* A right attribution. A participant's change taken for the programmer's is the safe side:
\* "Anything unsure counts as the programmer's, so it interrupts" (byProgrammer's comment).
\* A programmer's change made while our save runs can't be told from a participant's: VS Code
\* doesn't say who made a change, and the participants (format on save) run in that time.
\* Taking it for a tool's is the one wrong attribution allowed, and it is called out by name.
OK(author, as) ==
    \/ author = as
    \/ author = "participant" /\ as \in {"other", "programmer"}
    \/ author = "programmer during save" /\ as \in {"other", "programmer"}

Note(author, as) == IF OK(author, as) THEN {} ELSE {[author |-> author, as |-> as]}

Init ==
    /\ own = "none" /\ saving = "no" /\ inbox = <<>> /\ made = 0 /\ wrong = {}

\* edit(): the entry goes into `own`, VS Code applies the edit, and its event is queued.
AgentEdit ==
    /\ made < N /\ own = "none" /\ saving = "no"
    /\ own' = "sent" /\ made' = made + 1 /\ inbox' = Append(inbox, "agent")
    /\ UNCHANGED <<saving, wrong>>

\* edit() resolves after its event; `finally` drops the entry if it's still there.
AgentResolved ==
    /\ own = "seen" /\ own' = "none"
    /\ UNCHANGED <<saving, inbox, made, wrong>>

Programmer ==
    /\ made < N /\ made' = made + 1
    /\ inbox' = Append(inbox, IF saving = "no" THEN "programmer" ELSE "programmer during save")
    /\ UNCHANGED <<own, saving, wrong>>

\* save(): `saving` is set, participants such as format on save may change the document,
\* the file is written, and save() resolves after every event before it.
\* With FlushBeforeSave, the round trip's answer comes after every change event VS Code sent
\* before it, so those are handled first.
SaveStart ==
    /\ saving = "no" /\ own = "none" /\ (FlushBeforeSave => inbox = <<>>) /\ saving' = "participants"
    /\ UNCHANGED <<own, inbox, made, wrong>>

Participant ==
    /\ made < N /\ saving = "participants" /\ made' = made + 1 /\ inbox' = Append(inbox, "participant")
    /\ UNCHANGED <<own, saving, wrong>>

ParticipantsDone ==
    /\ saving = "participants" /\ saving' = "writing"
    /\ UNCHANGED <<own, inbox, made, wrong>>

\* save() resolves after every event before it, which came over the same channel.
SaveDone ==
    /\ saving = "writing" /\ inbox = <<>> /\ saving' = "no"
    /\ UNCHANGED <<own, inbox, made, wrong>>

\* onChange: an event while the agent's edit is in flight is that edit (events come in order,
\* and the agent's is the one its entry matches); otherwise byProgrammer: during our save, a
\* tool's (`this.saving.has(file)`), and otherwise the programmer's.
Handle ==
    /\ inbox # <<>>
    /\ LET author == Head(inbox)
           mine == own = "sent" /\ author = "agent"
           as == IF mine THEN "agent" ELSE IF saving # "no" THEN "other" ELSE "programmer"
       IN /\ inbox' = Tail(inbox)
          /\ own' = IF mine THEN "seen" ELSE own
          /\ wrong' = wrong \cup Note(author, as)
    /\ UNCHANGED <<saving, made>>

Next ==
    \/ AgentEdit \/ AgentResolved \/ Programmer \/ SaveStart \/ Participant
    \/ ParticipantsDone \/ SaveDone \/ Handle

Spec == Init /\ [][Next]_vars

\* S12: a change is attributed to the agent only if the agent made it, and a change the
\* programmer made is attributed to the programmer, so it interrupts.
RightAuthor == wrong = {}

=============================================================================
