# Changelog

## 0.38.3

-   Report command approval and pending completion during MCP waits, including
    background commands and later observed exits with bounded output.
-   Submit multi-line Bash commands as one encoded line to preserve shell
    integration capture for heredoc pipelines. Keep original approval text.
-   Update the editor-relay wire contract; reconnect Pair after updating.

## 0.38.2

-   Deliver changed navigator commentary preferences immediately through a
    waiting MCP listen, without interrupting speech or consuming edit and
    batch reports. Retain updates for the next listen and canceled retries.

## 0.38.1

-   Recognize visible navigator diff lines under the existing line-staleness
    rules. Preserve queued observations on a plain handback without a message.
-   Suppress net-zero navigator change reports and typing-pause wakes while
    retaining meaningful activity already reported by a timeout.

## 0.38.0

-   Add persistent Quiet, Helpful and Coach navigator commentary preferences.
    Apply changes on the next report in active sessions and synchronize the
    local companion. Keep speech enablement independent.

## 0.35.0

-   Add optional bounded narration context and model-supported delivery cues.

-   Keep the companion version aligned with the main extension.

## 0.34.0

-   Share the compact OpenRouter cost subtotal, detailed cost explanations,
    finer listening-speed control and narration mute with the main extension.
-   Forward session command approvals and their explicit reset through the
    existing local companion connection.
-   Keep asynchronous narration ordered and admit a successor only after the
    previous remote speech unit has retired, with bounded unavailable fallback.
-   Preserve safe cost ownership across restored sessions and panel recreation.
-   Update both extensions together for the current audio protocol and controls.

## 0.32.0

-   Add OpenRouter speech with secure credentials, account-filtered model and
    voice choices, and a ZDR policy filter.
-   Keep previews and narration on the existing speech output route and
    cancellation path.

## 0.31.0

- Publish under the `mattyv` publisher, matching the main extension.

## 0.30.0

-   Keep the Local Audio companion version aligned with the main extension
    through its 0.28.0 to 0.30.0 releases; the companion itself is unchanged.

## 0.27.0

-   Keep the Local Audio companion version aligned with the guided demo release.
    The optional programmer-edit segment uses the existing speech setting.

## 0.26.0

-   Prepare enabled Kokoro speech before pairing starts, using the speech
    lifecycle manager for startup, switching and shutdown.
-   Show an orange pulsing voice indicator while the local model starts, with
    a static indicator when reduced motion is requested.

## 0.25.2

-   Keep speech setup, CPU/GPU switches and restart recovery coordinated while
    prior proof and workers finish shutting down.

## 0.25.1

-   Switch local speech between CPU and GPU after the previous worker exits,
    and distinguish model setup from live worker readiness.

## 0.25.0

-   Show cached voice readiness beside the toolbar controls, with explanatory
    tooltips and direct access to speech settings.

## 0.24.2

-   Give Local Audio activation its own bounded startup interval and record
    activation and prepare timings for connection diagnosis.

## 0.24.1

-   Restore a saved speech output device on startup without opening Settings,
    while preserving missing-device reporting and shutdown safety.

-   Clarify speech model and compute settings, with technical details collapsed.

## 0.24.0

-   Provide read-only audio status for AI Pair diagnostics without exposing
    keys or narration.

## 0.23.2

-   Correct distorted GPU voice output by routing one affected model operation
    through the CPU while keeping the remaining GPU checks and computation.

## 0.23.1

-   Fix GPU worker communication when VS Code and its bundled worker use
    different Node and V8 versions.

## 0.23.0

-   Add experimental local Kokoro GPU setup with a separate pinned model,
    physical-device checks, and a guarded isolated inference worker. CPU
    remains the default. Physical AMD hardware validation is pending.

## 0.22.1

-   Show a more specific, safe reason when ElevenLabs narration fails and
    include its failure category in copied speech diagnostics.

## 0.22.0

-   Show queued work alongside the current pairing status.
-   Require compatible private connection versions for the panel and audio.
    Update both extensions and reload after upgrading.

## 0.20.1

-   Verify local Kokoro platform support using bounded evidence from the running
    process when Node's system report is unavailable. Keep unsupported or
    unverified hosts blocked, with a more specific diagnostic reason.

## 0.20.0

-   Pipeline local Kokoro narration as bounded sentence parts while retaining
    one displayed message, reading clock and concrete output route. Hold unit
    completion until the final playback process retires. ElevenLabs retains
    one synthesis request per narration.
-   Add an experimental **Listening speed** (0.75 to 1.5, default 1) processed
    in a local worker before playback, with no extra cloud request and no change
    to the audio at 1. Listening quality at other rates has not been validated
    by people. The companion packages the tempo worker for every platform.
-   Run local Kokoro behind a versioned warm-worker protocol: the model stays
    loaded between narrations, stale or late worker responses are rejected,
    canceled narrations are never replayed, and a replacement worker starts only
    after the previous one has exited.

## 0.19.0

-   Add the optional UI-local panel and audio companion for AI Pair.
-   Keep speech credentials and output selection on the local client, including
    when the workspace runs remotely.
