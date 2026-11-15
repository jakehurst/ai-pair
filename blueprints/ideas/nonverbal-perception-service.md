# Nonverbal perception service: revised concept

The perception half of nonverbal feedback, worked out with the programmer on
2026-11-15 and tracked on #83. Perception moves into a standalone local
service that any tool can use, and AI Pair becomes one of its clients;
[AI Pair's side](nonverbal-pairing-feedback-design.md) is a separate file.
Nothing here is built, and the spec-first process still applies.

## Goal

Pairing with the agent should feel like pairing with a person: Pair picks up
how the programmer is reacting and adjusts its pace or checks in, without the
programmer stopping to type or speak. The goal is unchanged from the
[original proposal](nonverbal-pairing-feedback.md). What changes is the
mechanism.

## Status of each part

Agreed by the programmer in discussion:

-   Perception is a standalone local service, for better calibration and for
    use beyond AI Pair.
-   Each client embellishes the service's output with its own data.
-   Grounding beats.
-   Four states to gauge: agreement, disagreement, engagement, annoyance.
-   Voice backchannel and tone of voice come later.

Proposed, and not yet decided:

-   The personal classifier and its context predictor.
-   The local reflex tier, which contradicts a recorded decision (see
    [Departures from the recorded design](#departures-from-the-recorded-design)).
-   What the agent receives.
-   OpenFace as an optional input to the classifier.

## Problems this revision answers

A review of the recorded design found these weaknesses in the concept:

-   **Timing.** A human partner reacts within half a second. The agent sees a
    cue only at a report boundary, then takes a model round trip to respond.
-   **Faces do not map reliably to states.** A furrowed brow is what
    concentration looks like. Generic emotion models are trained on broad
    categories, mostly from photographs.
-   **Lopsided error cost.** A missed cue costs nothing. A false one produces
    an unprompted check-in, which irritates and makes the programmer feel
    watched.
-   **An agent over-reads raw numbers.** Given "anger .52", a language model
    acts on it, whatever the header says about calibration.
-   **No ground truth.** Whether a nod was detected can be measured; whether
    the person understood cannot.
-   **Licences.** The only emotion source considered, OpenFace 3.0, is
    licensed for noncommercial research only.

## The perception service

A local process, separate from any editor or agent.

-   **Owns:** the camera, the face model (MediaPipe Face Landmarker), the
    personal classifier, calibration, and the consent and off controls.
-   **Knows nothing about** sessions, batches, editors or agents.
-   **Shows** its own camera-in-use indicator, and on macOS takes the camera
    permission prompt itself.
-   **Emits** reactions over a local event API to clients that subscribe.
-   **Accepts** two kinds of message from a client: context, such as "a
    question was just asked" or "a pause starts", and outcomes, such as "the
    user interrupted". It needs context for its predictor and outcomes for
    labelling.
-   **Keeps frames local.** No image leaves the process. It stores numbers
    only.

One process holding the device removes the cross-window camera lease from the
recorded design, and the question of which extension host owns the camera. It
runs on the machine that has the camera, so a remote workspace is not a
special case.

## Clients

A client subscribes to reactions and adds what only it knows.

-   **AI Pair.** Adds what the recorded design already describes: the batch,
    what Pair was doing, and what the programmer was doing in the editor. Its
    agent still sees cues only in `pair` reports, for the reasons the recorded
    design gives. Its core is also the subscriber for the reflex tier.
-   **An MCP adapter,** for agents with nothing else. MCP is pull: the agent
    must call a tool to learn anything. A blocking `wait_for_reaction` tool
    with a short timeout fits that shape and is itself a grounding beat: the
    agent asks something, calls the tool, and gets a nod, a shake, or nothing.

A client must be approved before it can subscribe, because any local program
that connects can otherwise read the programmer's reactions.

## Grounding beats

Pair leaves a short beat after a concept or a question and looks for a
reaction in that window, as a speaker does at the end of an utterance.

-   The context is known: Pair knows whether it just explained or just
    proposed something.
-   The window is short, so a false detection has little time to occur.
    Continuous watching at a 5 percent false-positive rate per frame is about
    one false frame a second.
-   Positive evidence lets Pair continue. Negative evidence holds and hands
    over to the agent. No evidence means carry on after the beat; a reaction
    is never demanded.

## The four states

| State | What labels it afterwards | What Pair does with it |
|---|---|---|
| Agreement | A nod at a beat, a "yes" reply, the code Pair wrote is kept | Carries on without asking |
| Disagreement | A shake at a beat, an objecting reply, Pair's code rewritten or undone | Holds at the next beat and asks what to change |
| Engagement | Facing the code and answering quickly; the opposite is unwatched batches or an unfocused window | Holds or recaps when it drops |
| Annoyance | Interrupting mid-sentence, speeding Pair up, terse replies, muting | Backs off: shorter narration, fewer check-ins |

Build them in that order. Annoyance is the rarest, so the slowest to learn,
and it is the one that is plainly an emotion, which matters for the legal
question under [Unknowns](#unknowns).

## The personal classifier

A small classifier on top of the face model. It is not a language model and
not a second face model.

1.  **Frames become numbers.** The face model gives about 60 numbers a frame:
    52 blendshapes, head pitch, yaw and roll, and face size, which indicates
    lean. The frame is then discarded.
1.  **A window is summarised.** Once a second, the last few seconds of each
    signal are reduced to an average, a peak, a slope, and an oscillation
    rate, with the session's resting baseline subtracted.
1.  **The window is labelled by what happened next,** per state, as yes, no,
    or unknown, from the outcomes clients report.
1.  **A plain model is trained** on the programmer's own windows: logistic
    regression first, with one readable weight per input. It retrains after a
    session in seconds.
1.  **A separate context predictor** scores how likely a reaction is, from
    what the client reported: at a beat, after a question, time since the
    agent stopped. Its score is combined with the vision score.
1.  **A score counts only above a cut-off,** set from sessions held out of
    training. A state that cannot beat guessing stays off.

Before there is enough of one person's data, nod, shake and facing the screen
work from generic rules, and the model adapts from there.

## The reflex tier

Small, reversible adjustments made locally by the client, with no model round
trip: ease the typing speed, hold at the next line or sentence boundary while
the programmer looks away, resume when they return. A wrong guess of this kind
is nearly invisible, which answers the lopsided error cost. With an
explanation, the agent can supply a one-line simpler restatement for the
client to play at once if the programmer looks lost. A strong signal wakes the
agent through the existing `hand_raised` wake and `attention` pause.

A cue still never approves a command or any other action.

## Models and licences

The licences were read from each repository's licence file on 2026-11-15. The
weights are the binding constraint: most action unit, emotion, and gaze weights
are trained on research-only datasets such as BP4D, DISFA, AffectNet,
Aff-Wild2, and Gaze360.

| Project | Gives | Code | Weights | Use |
|---|---|---|---|---|
| [MediaPipe](https://github.com/google-ai-edge/mediapipe) Face Landmarker | Head pose, 478 landmarks, 52 blendshapes | Apache-2.0 | Google's own; the cards point to Apache-2.0, but two are image-only and still need reading | Default |
| [Nodding Pigeon](https://github.com/bhky/nodding-pigeon) | Nod, turn, or still | MIT | Trained by its author on MediaPipe features | Candidate nod detector |
| [OpenFace 3.0](https://github.com/CMU-MultiComp-Lab/OpenFace-3.0) | Landmarks, action units, gaze, 8 emotions | CMU noncommercial research only, no distribution | Same | Bring your own |
| [py-feat](https://github.com/cosanlab/py-feat) | Action units, emotion, gaze, pose | MIT | Noncommercial research | No |
| [EmotiEffLib](https://github.com/sb-ai-lab/EmotiEffLib) | Emotion, engagement | Apache-2.0 | AffectNet-trained; terms unread | Not yet |
| [OpenGraphAU](https://github.com/lingjivoo/OpenGraphAU) | Action units | Apache-2.0 | BP4D and DISFA | No |
| [LibreFace](https://github.com/ihp-lab/LibreFace) | Action units, expressions | Educational, research, and non-profit only | Same | No |
| [L2CS-Net](https://github.com/Ahmednull/L2CS-Net) | Gaze | MIT | Gaze360 and MPIIGaze, noncommercial | No |

Nod and shake may need no second model: the oscillation of head pitch and yaw
from the face model may be enough. The recorder can compare that with Nodding
Pigeon on the same traces.

OpenFace 3.0 adds proper gaze, action units, and a generic first guess at
annoyance. Its emotion classes are not the four states. It is never bundled,
and installing it separately does not grant commercial-use rights. If the
programmer installs it, its outputs are extra inputs to the personal
classifier; its raw emotion scores do not reach the agent. Whether it earns
its place can be measured: record sessions with and without it and compare how
well each predicts the programmer's actual reactions.

## Platforms

The service captures frames with AVFoundation on macOS and V4L2 on Linux, for
`darwin-arm64`, `darwin-x64`, `linux-x64`, and `linux-arm64`. Support for the
four targets is a goal, not a verified claim. On macOS the service needs the
camera entitlement and takes the permission prompt itself (untested). On
Linux, access comes from the `video` group or seat ACL with no prompt, so the
service's own indicator matters more.

## Gates carried over

These held for the recorded design and hold for the service.

-   **Retirement before reuse.** The camera is not reopened until the previous
    capture is confirmed closed. Lost contact is unavailable, not proof that
    the device closed.
-   **The camera closes when the service dies,** and the service does not
    outlive the last client that needs it without the programmer knowing.
-   **Licences are a release gate.** Code, weights, training data and intended
    use are verified for every model that ships.
-   **Spec first.** The camera lifecycle, consent and client subscription are
    modelled before code, and platform claims are tested on real devices.

## What the literature supports

The papers and what was read of each are in the
[literature comment on #83](https://github.com/mattyv/ai-pair/issues/83#issuecomment-6894324059).
In short:

-   A plain classifier matched or beat sequence models in every comparison
    read; time belongs in the features.
-   Context about what the agent just did gave the largest gain: nods from 75
    to 90 percent, shakes from 84 to 100 percent.
-   More than half of participants nodded at a talking robot that could not
    see them.
-   Engagement was mostly readable from still frames: head roll, head pitch
    and eye closure.
-   Per-person patterns were clear and vanished when averaged across people.
-   Shakes were rare: 14 against 274 nods.

These are small studies of tutoring, debates and robots, not of developers
pairing.

## Departures from the recorded design

Each needs the programmer's decision before the recorded design, the Archi
views and the brief are revised.

-   **"Pacing is advisory."** The recorded design says a cue never holds
    playback or changes speed. The reflex tier does both.
-   **What the agent receives.** The recorded design sends labels and raw
    model numbers, emotion scores included. This sends the four states from
    the personal classifier.
-   **Continuous reporting.** The recorded design reports on every batch.
    This looks mainly at beats.
-   **Calibrated gaze and the calibration store.** Nothing found needs them
    for the four states.
-   **"No second, agent-facing MCP server."** It holds for AI Pair's own
    agent. The MCP adapter is for other agents.

## Unknowns

-   Whether a developer watching code produces enough reactions to learn
    from.
-   Whether annoyance is readable from this programmer's face at all.
-   How many sessions the personal classifier needs.
-   The generic vocabulary for context and outcome messages.
-   Whether the service lives in this repository or its own.
-   Whether Linux arm64 is required from the start, and how hard the
    four-target native build is.
-   Whether inferring annoyance at work falls under the EU AI Act's rule on
    emotion inference in the workplace. This is from memory, not a legal
    reading.

## First step

A recorder: the seed of the service. It owns the camera, logs the face
model's numbers alongside a client's context and outcome events for a few
real sessions, stores numbers only, and sends nothing to an agent. It answers
the first two unknowns before the classifier, the event API or any design
revision is built.
