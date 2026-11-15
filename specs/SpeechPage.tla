---- MODULE SpeechPage ---------------------------------------------------------
(******************************************************************************)
(* Webview audio is bounded to the live unit and current page.                *)
(* A browser that wants a gesture can refuse to start an eligible clip; the  *)
(* page keeps that clip blocked and starts it from the next gesture (#77).   *)
(******************************************************************************)
EXTENDS Naturals

CONSTANTS MaxId
ASSUME MaxId \in Nat \ {0}

VARIABLES page, nextId, current, playing, paused, copied, expected, blocked
vars == <<page, nextId, current, playing, paused, copied, expected, blocked>>

TypeOK == /\ page \in 1..2 /\ nextId \in 1..(MaxId + 1)
          /\ current \in 0..MaxId /\ playing \in 0..MaxId
          /\ paused \in BOOLEAN /\ copied \in BOOLEAN /\ expected \in BOOLEAN
          /\ blocked \in BOOLEAN
Init == /\ page = 1 /\ nextId = 1 /\ current = 0 /\ playing = 0
        /\ paused = FALSE /\ copied = FALSE /\ expected = FALSE
        /\ blocked = FALSE
Begin == /\ current = 0 /\ nextId <= MaxId
         /\ current' = nextId /\ nextId' = nextId + 1
         /\ playing' = 0 /\ copied' = FALSE /\ expected' = FALSE
         /\ blocked' = FALSE
             /\ UNCHANGED <<page, paused>>
\* `allowed` is the browser's answer to play(): FALSE before any gesture.
Audio(id, target, allowed) ==
    /\ id \in 1..MaxId /\ target \in 1..2
    \* The page ignores a stale unit, a stale page, a paused page, and a
    \* second clip for a unit that already holds one.
    /\ LET eligible == id = current /\ target = page /\ ~paused /\ ~copied IN
       IF eligible
       THEN /\ playing' = IF allowed THEN id ELSE playing
            /\ blocked' = ~allowed
            /\ copied' = TRUE
            /\ expected' = TRUE
       ELSE UNCHANGED <<playing, blocked, copied, expected>>
    /\ UNCHANGED <<page, nextId, current, paused>>
\* A click or keypress in the panel starts the blocked clip.
Gesture == /\ blocked /\ ~paused /\ current # 0
           /\ playing' = current /\ blocked' = FALSE
           /\ UNCHANGED <<page, nextId, current, paused, copied, expected>>
Pause == /\ ~paused /\ paused' = TRUE /\ playing' = 0
         /\ copied' = FALSE /\ expected' = FALSE /\ blocked' = FALSE
             /\ UNCHANGED <<page, nextId, current>>
Resume == /\ paused /\ paused' = FALSE /\ copied' = FALSE /\ expected' = FALSE
          /\ UNCHANGED <<page, nextId, current, playing, blocked>>
\* Interrupt also stands for the host's start timeout giving up on the unit.
Interrupt == /\ current # 0 /\ current' = 0 /\ playing' = 0
             /\ copied' = FALSE /\ expected' = FALSE /\ blocked' = FALSE
             /\ UNCHANGED <<page, nextId, paused>>
Replace == /\ page' = IF page = 1 THEN 2 ELSE 1
           /\ current' = 0 /\ playing' = 0
           /\ copied' = FALSE /\ expected' = FALSE /\ blocked' = FALSE
           /\ UNCHANGED <<nextId, paused>>
Finish == /\ current # 0 /\ playing # 0 /\ current' = 0 /\ playing' = 0
          /\ copied' = FALSE /\ expected' = FALSE /\ blocked' = FALSE
             /\ UNCHANGED <<page, nextId, paused>>
Next == Begin
        \/ (\E id \in 1..MaxId, p \in 1..2, a \in BOOLEAN : Audio(id, p, a))
        \/ Gesture \/ Pause \/ Resume \/ Interrupt \/ Replace \/ Finish
Spec == Init /\ [][Next]_vars /\ WF_vars(Interrupt)
PlayingIsCurrent == playing # 0 => playing = current /\ ~paused
BlockedIsCurrent == blocked => current # 0 /\ playing = 0 /\ ~paused
AcceptedStarts == expected =>
    copied /\ current # 0 /\ ~paused /\ (playing = current \/ blocked)
\* A refused clip is not lost silently: it starts, or the unit is given up.
BlockedResolves == blocked ~> (playing # 0 \/ current = 0)
================================================================================
