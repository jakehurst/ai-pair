# Nonverbal pairing feedback: design

AI Pair's side of nonverbal feedback (#83), refining the
[nonverbal feedback proposal](nonverbal-pairing-feedback.md). Perception
itself (the camera, the models and the classifier) is described in the
[perception service concept](nonverbal-perception-service.md), of which AI Pair
is one client. It is a design only; nothing is built, and the spec-first
process still applies.

## Decisions that stand

Decided with the programmer on 2026-11-15.

-   macOS and Linux from the start, not a Mac-only first version.
-   Not tied to audio. It works with text-only narration and on the
    programmer's turn, independently of `SpeechService` and the audio
    companion.
-   No timestamps for the agent. Each observation is keyed by batch and says
    what Pair was doing and what the programmer was doing, because the agent
    cannot correlate wall-clock times.
-   The camera stays on for the whole session while enabled, so the camera
    light does not blink on and off.
-   The camera control is independent of the narration mute. Muting either
    does not mute the other. The panel sends each owner its intent and draws
    that owner's snapshot.
-   AI Pair's agent sees cues only in `pair` reports. Only Pair knows what
    was shown when, and the agent is blocked in `listen` when a reaction
    happens.
-   A cue never approves a command or any other action, and explicit words
    always win.

## Decisions under review

The perception service concept proposes otherwise for each of these. They
stand as recorded until the programmer decides; the reasons are under
[departures from the recorded design](nonverbal-perception-service.md#departures-from-the-recorded-design).

-   Pacing is advisory: a cue never changes speed or holds playback.
-   Each batch carries a qualitative line and the model's numbers, including
    emotion estimates.
-   Every batch can produce an entry, not only a grounding beat.
-   Gaze is calibrated against the screen layout.

## What AI Pair adds as a client

The service reports reactions. AI Pair adds what only it knows.

-   **What Pair was doing:** typing code, showing a message to read, speaking,
    running a command, waiting, paused, the programmer's turn, or just after a
    question.
-   **What the programmer was doing,** from an activity tracker in the VS Code
    adapter that needs no camera: watching the editor, typing in a file,
    typing a reply, in another file, scrolled away, or VS Code not focused.
-   **The batch,** or the programmer's turn when there is no batch.

VS Code can report window focus, typing in a file (with Pair's own edits told
apart), the active file, selection and scrolling, and typing a reply. It cannot
report the mouse position outside the panel or which other app has focus. It
knows about another VS Code window only when that window runs AI Pair.

## What reaches the agent

An entry in the `listen` or `step` result, as a report field, not an
interrupting event. Whether a strong cue may wake a pending `listen` is part
of the review above.

-   **Never sent:** images or frames, landmark coordinates, identity,
    timestamps, other apps' windows, or the mouse position. Nothing from the
    camera is sent while it is muted, disabled, or not set up.
-   **A new session never receives an old session's cues.** Muting the camera
    or revoking consent discards queued camera cues.
-   **The agent guide gets one rule:** explicit words always win, a cue never
    approves anything, and a cue can prompt a check-in or a change of pace but
    is never stated back as a fact about the person.
-   **The consent text says plainly** which derived cues go to the cloud
    model.

## Attention and pacing

The strongest signals are what the programmer does: pausing, scrolling back
during playback, interrupting, changing speed. Editor facts come next, such as
the window being unfocused or typing elsewhere while code plays. The camera
corroborates them. There is never an attention score.

## Open questions

1. Can the activity context ship first on its own, before any camera?
1. Does the camera mute carry over between sessions, or reset at each `start`?
