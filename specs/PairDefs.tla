---- MODULE PairDefs -----------------------------------------------------------
(******************************************************************************)
(* The vocabulary the specs share: the kinds of action, a session's phases,   *)
(* the agent's calls, and the reasons playback pauses. A spec that models one *)
(* of them EXTENDS this module, so that two specs always mean the same thing  *)
(* by the same word, and could be put together without a clash. The module    *)
(* has no state and no Spec, as 5.2 of the style guide allows for Defs.       *)
(******************************************************************************)
EXTENDS Naturals

\* The kinds of action a batch may hold (packages/protocol/src/schemas.ts).
ActionKinds ==
    {"say", "move", "select", "point", "type", "type_fast", "delete", "run"}

\* A session's phases: "active"; "suspended", its agent gone; "ended", by the
\* programmer, until its last report closes it.
SessionPhases == {"active", "suspended", "ended"}

\* No session: none started yet, or the last one closed. Any value that is not
\* a phase will do, so the config makes it a model value (6.20).
NoSession == CHOOSE v : v \notin SessionPhases

\* What the panel shows of the session: no session, a live one, or a suspended
\* one, which the agent can resume.
Views == {"off", "live", "suspended"}

\* A webview's page: loaded, or disposed with its view. A page that is
\* disposed never comes back; the next one is a new page.
PageStates == {"loaded", "disposed"}

\* The calls the agent makes: a `listen`, or another (a `step` or `end`).
Calls == {"listen", "stepOrEnd"}

\* No call open. Any value that is not a call will do, so the config makes it
\* a model value (6.20).
NoCall == CHOOSE v : v \notin Calls

\* Why playback is paused: the Pause button, a draft in the reply box,
\* looking away, and a reading speed calibration (#109).
PauseReasons == {"programmer", "reply", "away", "calibrate"}

\* The files a view spec names: the agent cursor's, a second one, and any
\* other.
Files == {"sourceFile", "destinationFile", "otherFile"}

\* No file: no cursor before the first move, no point, no editor open, or no
\* file named. Any value that is not a file will do, so the config makes it a
\* model value (6.20).
NoFile == CHOOSE v : v \notin Files

\* The characters a text spec spells: any other character, a second such
\* character, a space or tab, a line feed, and a carriage return. A spec's
\* alphabet takes the ones it tells apart.
Letter == "x"
OtherLetter == "y"
Space == "s"
LineFeed == "n"
CarriageReturn == "r"

\* Every sequence of up to n characters from cs.
Seqs(cs, n) == UNION {[1..m -> cs] : m \in 0..n}

================================================================================
