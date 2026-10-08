------------------------------- MODULE Actions -------------------------------
\* What an interrupted batch reports as unplayed, in `actions` and `perform` in
\* packages/core/src/player.ts: S14 in #19, the unplayed actions come back in order, and
\* resubmitting them plays nothing twice. Each action is the steps between its awaits, from the
\* code; an interrupt can come at any await. The timeline stays interrupted until the next batch.
\*   "await"    an await: `show`, `getText`, `eol`, `save`, a sleep whose result is ignored
\*   "check"    the result of a sleep, `confirm`, or `notStarted`: stop here if interrupted
\*   "effect"   something the programmer sees: a keystroke, a delete, a command, a move
\*   "consumed" `run`: interrupted while its command runs on, the command counts as played
EXTENDS Naturals, Sequences

CONSTANTS
    MaxLen,      \* how many actions a batch has, at most
    RestOnly,    \* TRUE: a `type` cut after a chunk returns only what's left of it
    ConsumeRun   \* TRUE: a `run` interrupted while its command runs counts as played

Kinds == {"say", "move", "select", "point", "type", "type0", "delete", "run"}

Steps(k) ==
    CASE k = "say"    -> <<"effect", "await">>
      [] k = "move"   -> <<"await", "check", "await", "await", "effect", "await">>
      [] k = "select" -> <<"await", "check", "await", "await", "effect", "await">>
      [] k = "point"  -> <<"await", "await", "effect", "await">>
      \* Two chunks: show, getText, eol; then a delay before each chunk.
      [] k = "type"   -> <<"await", "await", "await", "await", "check", "effect", "await", "check", "effect">>
      \* Nothing to type (only the cursor marker, no selection): show, getText, eol, and no chunks.
      [] k = "type0"  -> <<"await", "await", "await">>
      [] k = "delete" -> <<"await", "await", "check", "effect", "await">>
      \* save, confirm, shellIntegration (`notStarted`), the command, then still running.
      [] k = "run"    -> <<"await", "await", "check", "await", "check", "effect", "await", "consumed">>

Full(k) == LET s == Steps(k) IN Len(SelectSeq(s, LAMBDA x : x = "effect"))

Batches == UNION {[1..n -> Kinds] : n \in 1..MaxLen}

VARIABLES
    batch,       \* the batch's actions
    i,           \* the action playing
    pc,          \* the step of it next
    effects,     \* each action: how many of its effects took place
    interrupted, \* the timeline was interrupted
    result       \* the outcome: [status ("playing" until done), from (first unplayed), rest (a cut type's chunks left)]

vars == <<batch, i, pc, effects, interrupted, result>>

Playing == [status |-> "playing", from |-> 0, rest |-> 0]

Init ==
    /\ batch \in Batches /\ i = 1 /\ pc = 1
    /\ effects = [j \in 1..Len(batch) |-> 0] /\ interrupted = FALSE /\ result = Playing

Any(n) == \E j \in 1..n : effects[j] > 0

\* stopped(id, unplayed, effect). `effect`: an earlier action changed something on screen, or this
\* one typed some of its text, or left its command running.
Stopped(from, rest, effect) ==
    result' = [status |-> IF effect THEN "interrupted" ELSE "discarded", from |-> from, rest |-> rest]

Next1 ==
    /\ result = Playing
    /\ IF i > Len(batch)
          THEN result' = [status |-> "completed", from |-> Len(batch) + 1, rest |-> 0]
               /\ UNCHANGED <<i, pc, effects>>
       \* The loop checks for an interrupt before each action.
       ELSE IF pc = 1 /\ interrupted
          THEN Stopped(i, 0, Any(i - 1)) /\ UNCHANGED <<i, pc, effects>>
       ELSE IF pc > Len(Steps(batch[i]))
          THEN i' = i + 1 /\ pc' = 1 /\ UNCHANGED <<effects, result>>
       ELSE LET step == Steps(batch[i])[pc] IN
          CASE step = "effect" ->
                 effects' = [effects EXCEPT ![i] = @ + 1] /\ pc' = pc + 1 /\ UNCHANGED <<i, result>>
            [] step = "check" /\ interrupted ->
                 \* With something typed: what's left, or (mutation) all of it.
                 /\ IF effects[i] > 0 /\ RestOnly THEN Stopped(i, Full(batch[i]) - effects[i], TRUE) ELSE Stopped(i, 0, Any(i - 1))
                 /\ UNCHANGED <<i, pc, effects>>
            [] step = "consumed" /\ interrupted ->
                 /\ IF ConsumeRun THEN Stopped(i + 1, 0, TRUE) ELSE Stopped(i, 0, Any(i - 1))
                 /\ UNCHANGED <<i, pc, effects>>
            [] OTHER -> pc' = pc + 1 /\ UNCHANGED <<i, effects, result>>
    /\ UNCHANGED <<batch, interrupted>>

\* The programmer interrupts, at any await (between steps).
Interrupt == result = Playing /\ ~interrupted /\ interrupted' = TRUE /\ UNCHANGED <<batch, i, pc, effects, result>>

Next == Next1 \/ Interrupt

Spec == Init /\ [][Next]_vars

Done == result # Playing

\* S14: the actions before the unplayed ones played in full; the unplayed ones never started,
\* except a cut `type`, whose rest is exactly the chunks it didn't type.
PlaysNothingTwice ==
    Done =>
        /\ \A j \in 1..(result.from - 1) : effects[j] = Full(batch[j])
        /\ \A j \in result.from..Len(batch) :
              IF j = result.from /\ result.rest > 0
                 THEN effects[j] + result.rest = Full(batch[j])
                 ELSE effects[j] = 0

\* A stopped batch is discarded exactly when nothing the programmer could see took place.
DiscardedMeansNothing == Done /\ result.status # "completed" => ((result.status = "discarded") = (\A j \in 1..Len(batch) : effects[j] = 0))

=============================================================================
