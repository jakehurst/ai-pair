# Nonverbal feedback during pairing

Deferred product proposal, recorded 2026-11-14. The programmer wants Pair to
notice conversational feedback much as a human pairing partner would, without
requiring every response to be typed or spoken. This document records an idea
and research assessment; it does not authorize implementation or select a model.

## Intended experience

Pair can ask whether an explanation makes sense, notice a possible nod or head
shake, and respond in context. It can also notice spontaneous feedback while
the programmer watches code being written, without asking a question first.

-   A nod after a check-in may let the explanation continue.
-   A head shake may prompt another explanation or a clarifying question.
-   An uncertain expression during an explanation may prompt "Want me to unpack
    that bit?" It must not become a factual claim that the user is confused.
-   Looking at the code can mean following the explanation. Eye contact with
    the camera or Pair panel is not required.
-   A reaction while looking down at a phone or toward another screen may be
    unrelated to Pair. Ignore or discount it when the target is uncertain.
-   Briefly looking away can mean thinking. Do not equate it with disengagement
    or automatically pause on every glance.

The goal is conversational feedback and considerate pacing, not an attention
score, comprehension assessment, or user monitoring report.

## Proposed interaction policy

Keep observations separate from interpretations. A local perception component
could report a possible nod, head shake, gaze region, or facial movement, with
timestamps and an indication of tracking quality. A classifier score must not
be presented as a calibrated probability unless validated as such.

Associate observations with the narration actually heard and code actually
displayed, not merely with text the agent generated. Include whether Pair was
asking a question, explaining a concept, waiting, or listening. A nod after a
question has different significance from a similar movement at another time.

An illustrative agent-facing event might say:

```text
Possible head shake during explanation 42, while facing the task screen.
Tracking quality: moderate. Whether this was a response to Pair is uncertain.
```

Prefer explicit words and controls over inferred cues. Missing tracking means
unknown, not disagreement. Do not require affirmative feedback after every
sentence. Debounce observations, expire stale cues, and limit check-ins so the
feature does not become irritating. Exact thresholds need user trials.

An initial prototype should observe and display proposed reactions without
controlling playback. Automatic holds, resume, or elaboration should follow only
if testing shows they help. A nod must never approve a command or other action
that requires explicit approval.

## Local processing and architecture proposal

-   Opt in explicitly; show when the camera is in use and provide an immediate
    off control. No camera startup while disabled.
-   Process frames locally, without recording video or retaining face images
    by default. Avoid identity recognition and unrelated personal attributes.
-   Explain separately that sending derived cue events to a cloud LLM also
    discloses behavioral information; local video processing alone does not
    make the entire feature local.
-   Calibrate task-screen directions where useful. Test multiple monitors,
    phone glances, glasses, lighting, movement and camera placement. Head pose
    alone cannot reliably identify a phone or the exact screen being viewed.
-   Give camera/model resources one lifecycle owner. Keep disabled, loading,
    observing, unavailable and stopping states explicit, including retirement.
-   Feed validated observations through the existing session/state ownership
    boundaries. Do not add independent pause or turn flags in the camera/UI.
-   Scope cues to session and narration identities. Delayed events from an old
    session must not affect a new one. Device loss must leave ordinary pairing
    usable, and regaining tracking must not automatically resume manual pause.

These are design proposals, not implemented architecture. Before implementation,
follow the existing manifesto and spec/test process; update architecture and
decision records when concrete choices are made.

## Research assessment

Sources were reviewed on 2026-11-14. Papers, project claims and suggested
applications to Pair are different kinds of evidence. No model was installed,
benchmarked or tested on a webcam during this assessment.

1.  [MIT face-to-face grounding paper](https://aclanthology.org/P03-1070.pdf):
    the strongest interaction-design reference. It associates gaze and nods
    with individual utterances and distinguishes looking at the speaker,
    shared task, and elsewhere. Human observations support context-dependent
    interpretation; its agent evaluation was preliminary, with two subjects
    and human-operated speech recognition. Do not generalize its rules into
    proof of comprehension. The linked full Reinstein thesis was inaccessible;
    the associated nine-page paper was read instead.
1.  [GenECA paper](https://www.isca-archive.org/interspeech_2025/patapati25_interspeech.pdf):
    useful modular sensing, cue interpretation, dialogue and output design.
    It combines nonverbal cues with conversation history, but the two-page
    paper does not report a user evaluation. Main conversational segmentation
    uses a speaking button. It is not evidence that continuous confusion
    detection works reliably.
1.  [MICA paper](https://arxiv.org/html/2505.01578v1): gaze and speech improve
    contextual assistance from recorded demonstrations. Its evaluation used
    10 participants, 32 demonstrations and 415 questions. Borrow the temporal
    association and multimodal-context ideas, not a claim that it recognizes
    live listener confusion. HoloLens eye tracking differs from a webcam.
1.  [OpenSense](https://github.com/ihp-lab/OpenSense): learn from synchronized
    behavioral streams and component integration. Its documentation identifies
    a USC Research License and separate third-party licenses; it is not a
    drop-in dependency with unrestricted reuse.
1.  [LibreFace](https://github.com/ihp-lab/LibreFace): possible local facial
    movement/expression and gaze components, including ONNX options. Facial
    analysis benchmarks do not establish conversational understanding.
    Its [license](https://github.com/ihp-lab/LibreFace/blob/main/LICENSE.rst)
    permits educational, research and nonprofit uses; commercial use requires
    permission. Check code and weight terms separately before adoption.
1.  [WebGazer](https://github.com/brownhci/WebGazer): local browser webcam gaze
    estimation and calibration are useful feasibility references. Official
    maintenance ended in February 2026; current code differs from the original
    published implementation. Licensing is GPLv3 with stated alternative
    arrangements, so review compatibility before embedding. Browser viewport
    estimates do not establish reliable multi-monitor or phone detection.

## Smallest useful evaluation

1.  Start with presence, coarse task-facing direction and explicit nod/head
    shake observations. Evaluate subtler expressions separately.
1.  Align observations with narration start/end and question boundaries.
1.  Display proposed interpretations for the programmer to confirm or correct,
    without changing playback automatically.
1.  Compare scripted cases and natural sessions: nod after a question, thinking
    glance, code on another monitor, phone reaction, habitual movement, no face,
    camera loss and rapid session changes.
1.  Measure false triggers, missed gestures, latency, resource use and perceived
    helpfulness. Agree acceptance thresholds before enabling control effects.

Open questions include which locally runnable model has suitable reuse terms,
how calibration survives monitor changes, how much cue detail reaches the LLM,
whether users prefer check-ins or holds, and whether the benefit outweighs
camera setup and false interpretations. No implementation ETA is committed.
