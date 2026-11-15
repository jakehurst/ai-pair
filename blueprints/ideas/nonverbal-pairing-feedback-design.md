# Nonverbal pairing feedback: design

The design that refines the [nonverbal feedback proposal](nonverbal-pairing-feedback.md).
It was decided with the programmer on 2026-11-15 and is tracked on #83. It is a
design only; nothing is built, and the spec-first process still applies.

## Decisions

-   macOS and Linux from the start, not a Mac-only first version.
-   Not tied to audio. It works with text-only narration and on the
    programmer's turn, independently of `SpeechService` and the audio
    companion.
-   No timestamps for the agent. Each observation is keyed by batch and says
    what Pair was doing and what the programmer was doing, because the agent
    cannot correlate wall-clock times.
-   The camera stays on for the whole session while enabled, so the camera
    light does not blink on and off.
-   Two independent mute controls: one for narration and one for the camera.
    Each has its own owner and snapshot; muting either does not mute the other.
-   Each batch carries both a qualitative line and the model's numbers,
    including emotion estimates.
-   Pacing is advisory. Cues help the agent recap, check in once, or suggest
    slowing down; they never change speed, hold playback, interrupt, or approve
    anything.
-   Models: MediaPipe Face Landmarker and Nodding Pigeon by default. OpenFace
    3.0 is an optional install the user brings themselves.

## Owners

There is no second, agent-facing MCP server; the agent sees cues only in `pair`
reports. Only Pair knows what was shown when, the agent is blocked in `listen`
when a reaction happens, an MCP server lives for the whole conversation rather
than the session, and the camera indicator and off switch belong in the panel.

| Owner | Owns |
|---|---|
| Perception helper, a native child process | Camera and models. Emits head pose, face presence, gestures, expression signals, emotion estimates when available, and a quality level. No frames leave it, and it knows nothing about sessions. |
| Perception lifecycle, in the local extension host | Spawning and retiring the helper: `disabled`, `loading`, `observing`, `unavailable`, `stopping`. |
| Activity tracker, in the VS Code adapter | What the programmer is doing, from editor facts. It needs no camera. |
| Core, through a new `PerceptionPort` beside `NarrationPort` | Labels each observation with Pair's state, scopes it to the session, expires it, and adds the report field. |
| Relay | Fixed wording only. |

The main extension runs where the workspace is, so the first version is local
only and reports `unavailable` over SSH.

VS Code can report window focus, typing in a file (with Pair's own edits told
apart), the active file, selection and scrolling, and typing a reply. It cannot
report the mouse position outside the panel or which other app has focus. It
knows about another VS Code window only when that window runs AI Pair.

## Camera and independent mute controls

The camera opens when it is opted in, not muted, and a session is active. It
stays on through pauses, the programmer's turn, and window blur. It closes on
`end`, suspend, disable, camera mute, or reload. A reopen waits for the
helper to confirm it has exited.

There are two persisted opt-ins, `speech.enabled` and a new `camera.enabled`
(off by default, set in Settings with consent text). Voice and camera each
have an independent mute state and owner; the panel sends each owner its own
toggle and draws the resulting snapshot. Muting voice does not close the
camera, and muting the camera does not mute voice. A "camera in use" icon
shows in the panel and the status bar, driven by the device actually being
open, not by the setting.

## Proposed gaze and screen-layout calibration

With explicit camera consent, investigate calibration that maps eye features to
an estimated screen region. [WebGazer](https://webgazer.cs.brown.edu/)
documents calibrated webcam estimates in viewport coordinates; it demonstrates
the approach, not reliable multi-monitor accuracy. WebGazer is GPLv3 and is
not a chosen dependency.

Keep estimated gaze separate from known layout and focus facts. A native adapter
spike must establish what screen geometry, window locations and focus facts are
available on each platform, what permissions they require, and whether a
calibrated estimate can be mapped to a useful broad region. Multiple displays,
layout changes, calibration drift and occlusion can make the estimate uncertain
or unavailable; never claim exact gaze. Capture timing and phase association
may be retained internally to match observations to activity, but reports do
not expose wall-clock timestamps to the agent.

## What reaches the agent

Each eligible batch or programmer-turn phase can produce an entry in the
`listen` or `step` result: a qualitative line first, then available numbers.
It is a report field, not an interrupting event.

```text
Nonverbal (camera; calibrated estimate; never an answer or approval):
- Batch 14, while Pair typed code in server.ts; editor focused, estimated task-facing gaze.
  Facing the screen, possible head shake, furrowed brow, possible anger.
  [face .98 | pitch -8..+4 yaw -3..+2 | shake score .71 |
  anger score .52, neutral score .25 | good]
```

-   **Context, in words:** the batch; what Pair was doing (typing code, a
    message to read, speaking, running a command, waiting, paused, the
    programmer's turn, after a question); and what the programmer was doing
    (editor focused, estimated task-facing gaze, typing in a file, typing a reply,
    in another file,
    scrolled away, VS Code not focused).
-   **Qualitative line:** face toward the screen, away, or not in view; a
    possible nod or shake; notable expressions; and the leading emotion as
    `possible <emotion>` when it clearly leads. A label appears only when its
    number crosses a threshold tuned in the evaluation, so words and numbers
    cannot disagree, and the wording never claims what the person feels.
-   **Numbers:** the share of frames with a face, head pose and gaze ranges,
    gesture counts and probabilities, blink rate, the top action units or
    MediaPipe blendshapes, emotion probabilities, valence and arousal, the
    model name, and the tracking quality. Only the values that moved are sent,
    about 40 to 80 tokens a batch.
-   **Never sent:** images or frames, landmark coordinates, identity,
    timestamps, other apps' windows, or the mouse position. Nothing at all is
    sent while the camera is muted, disabled, or not set up.

The agent guide gets one rule: explicit words always win, a cue never approves
anything, and emotion numbers can prompt a check-in or a change of pace but are
never stated back as a fact about the person. The camera consent text says
plainly that these estimates, emotions included, go to the cloud model.

## Attention and pacing

The strongest signals are what the programmer does: pausing, scrolling back
during playback, interrupting, changing speed. Editor facts come next, such as
the window being unfocused or typing elsewhere while code plays. The camera
corroborates them. The output is a per-batch description and at most one
pacing suggestion, never an attention score.

## Models and licences

The licences were read from each repository's licence file on 2026-11-15. The
weights are the binding constraint: most action unit, emotion, and gaze weights
are trained on research-only datasets such as BP4D, DISFA, AffectNet,
Aff-Wild2, and Gaze360.

| Project | Gives | Code | Weights | Use |
|---|---|---|---|---|
| [MediaPipe](https://github.com/google-ai-edge/mediapipe) Face Landmarker | Head pose, 478 landmarks, 52 blendshapes | Apache-2.0 | Google's own; the cards point to Apache-2.0, but two are image-only and still need reading | Default |
| [Nodding Pigeon](https://github.com/bhky/nodding-pigeon) | Nod, turn, or still | MIT | Trained by its author on MediaPipe features | Default gestures |
| [OpenFace 3.0](https://github.com/CMU-MultiComp-Lab/OpenFace-3.0) | Landmarks, action units, gaze, 8 emotions | CMU noncommercial research only, no distribution | Same | Bring your own |
| [py-feat](https://github.com/cosanlab/py-feat) | Action units, emotion, gaze, pose | MIT | Noncommercial research | No |
| [EmotiEffLib](https://github.com/sb-ai-lab/EmotiEffLib) | Emotion, engagement | Apache-2.0 | AffectNet-trained; terms unread | Not yet |
| [OpenGraphAU](https://github.com/lingjivoo/OpenGraphAU) | Action units | Apache-2.0 | BP4D and DISFA | No |
| [LibreFace](https://github.com/ihp-lab/LibreFace) | Action units, expressions | Educational, research, and non-profit only | Same | No |
| [L2CS-Net](https://github.com/Ahmednull/L2CS-Net) | Gaze | MIT | Gaze360 and MPIIGaze, noncommercial | No |

Emotions come from OpenFace, because MediaPipe gives none and every emotion
model with permissive weights checked so far is research-restricted. A command,
*AI Pair: Set up OpenFace (optional)*, shows CMU's licence and proposed
intended-use gate before any download of OpenFace and its weights. Separate
installation does not grant commercial-use rights.
Any optional backend must retain frames within its complete local helper
boundary; redistribution and use require independent licence verification.
Without it, the default models are used and the emotion
and action unit fields are absent. A request to CMU for a redistribution
exception is still open.

Longer term, a small classifier trained on MediaPipe blendshapes and head pose,
labelled from the panel's Right and Wrong buttons and the programmer's actions,
can replace research-licensed models. It records numbers only, never images.

## Helper and platforms

One helper captures frames with AVFoundation on macOS and V4L2 on Linux, and
runs the MediaPipe models with LiteRT, or `onnxruntime-node` as a fallback. It
ships for `darwin-arm64`, `darwin-x64`, `linux-x64`, and `linux-arm64`,
packaged like the audio helpers with fixed names and SHA-256 manifests. On
macOS the camera prompt is attributed to VS Code (untested) and a notarised
helper needs the camera entitlement. On Linux, access comes from the `video`
group or seat ACL with no prompt, so the panel and status bar indicators matter
more; a Flatpak VS Code needs device access.

## First version, in order

1.  Spikes: a Python MediaPipe and Nodding Pigeon trace recorder on macOS and
    Linux, the macOS camera prompt from a child of VS Code, and calibrated
    gaze against screen layout, native adapter access and permissions.
1.  Activity context without a camera: the tracker, the context labels, the
    report field, and the guide rule.
1.  A TLA+ spec for the perception lifecycle and independent mutes, before any code.
1.  The independent mute controls and the indicators.
1.  The native helper for the four targets.
1.  The detector, tested on recorded traces, with panel chips and Right and
    Wrong buttons; display only.
1.  The camera fields in the report, behind `camera.enabled`.
1.  The pacing line, then the proposal's scripted evaluation, comparing labels
    alone with labels and numbers.
1.  The bring-your-own OpenFace setup command.

## Risks

1.  The four-target native build. The Python spike comes first, and the
    choice between LiteRT and `onnxruntime-node` waits for one target to build.
1.  False readings turning into pacing changes, such as looking at the keyboard
    reading as a nod. The activity context ships first, and the agent's
    reaction to hand-written report lines is tested before any camera exists.
1.  Permissions and placement: the macOS prompt, Flatpak, and remote hosts.
    The spikes and a local-only first version cover these.

## Open questions

1. Does mute carry over between sessions, or reset at each `start`?
1. Is local-only acceptable for the first version?
1. Can the activity context ship first on its own?
1. Is Linux arm64 required from the start?

## Proposed architecture and implementation gates

This section and the Archi view are a proposal, not a description of shipped
behavior. The two independently controlled, consent-based inputs are speech
and camera. A local camera lifecycle owner alone starts and retires the helper;
voice mute remains with the existing narration owner. Camera disable, mute,
session end, mode change, reload or crash invalidates the current generation.
No replacement may open the camera until physical retirement is confirmed;
crash or lost contact is unavailable, not proof that the device has closed.
Recovery must establish retirement before reuse. The panel displays each owner's
snapshot and actual camera use without owning either lifecycle.

The local helper owns camera capture and inference. Raw frames remain local and
never enter the editor relay, agent report or cloud provider. An optional
calibration/training store is local, bounded, separately opted in and revocable;
its retention and deletion controls must be established before use. Consent
must describe which derived cues can reach a cloud model. A local adapter may
supply known display geometry and editor focus separately from estimated gaze;
access, permissions, multi-monitor mapping and accuracy require platform spikes.
No gaze result implies exact gaze or proves what a person understood.

Core owns session generation, internal capture intervals and activity phases.
It associates a bounded observation with a batch when one exists, or with the
programmer-turn phase when no batch exists. Narration context is optional:
text-only and programmer-turn observations do not depend on speech. Internal
time supports association and expiry; agent-facing reports contain no wall-clock
timestamps. The report path is noninterrupting and must define wake behavior,
expiry, canceled-delivery replay and rate-limited check-ins before shipping.
It must not steal turn ownership, approve actions or change playback speed.

The proposed bounded wire schema includes signal name, units and ranges where
applicable, sample/quality information, model identity and version, calibration
state and bounded qualitative and numeric estimates. Numbers called scores or
probabilities must not be represented as calibrated probabilities without
measured evidence. Emotion descriptions are tentative, and qualitative plus
numeric emotion estimates remain a desired feature: enable them only after
per-user calibration, trials and evaluation establish acceptable behavior.
The user can disable or recalibrate them. Testing informs thresholds and
uncertainty rather than asserting that emotion inference is already reliable.

Licence and feasibility checks are release gates, not solved by local install:
OpenFace's noncommercial terms do not grant commercial use merely because the
user brings it. Before choosing or distributing any model, verify code, weights,
training-data and intended-use rights. Independently validate capture,
permissions, retirement and packaging for `darwin-arm64`, `darwin-x64`,
`linux-x64` and `linux-arm64`; support is a goal, not a verified claim.

Before implementation, specify and model camera lifecycle and physical
retirement; independent mute/consent transitions; session, phase and report
replay/expiry; and calibration and feature gates. Validate the model against
meaningful failure mutations, then use real-device tests for platform claims.

A device lease must cover competing local VS Code windows: the proposed local
owner requests exclusive use for one active window and session generation.
Another window receives busy/unavailable, never another session's observations.
A handoff waits for confirmed retirement; the cross-window arbitration and
failure behavior require a platform design and lifecycle model before coding.
Changing camera, model or display layout invalidates the relevant calibration;
reaction labels for per-user training require their own explicit opt-in.

The schema identifies a signal's capability and representation: raw logits,
blendshapes, action units and probabilities are distinct, with applicable units,
ranges and model version. A nonverbal report field is not an automatic core
interrupt. A bounded cue may wake a pending listen under the specified delivery
policy; the agent decides whether to check in, subject to rate limits.

Each cue has a session-scoped identity. A canceled delivery may replay that
identity within the same session, but replay does not authorize a second
check-in. Camera mute or consent revocation discards queued unsent camera cues;
new sessions cannot receive old cues. Exact expiry and wake bounds remain
prospective specification work.
