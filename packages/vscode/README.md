# AI Pair

Command reports distinguish approval from waiting for completion, and retain
commands left in the background after the wait limit. A later observed finish
reports the original run ID, exit status and bounded output tail. A timeout
means completion was not observed; it does not prove the command is still
alive or succeeded. **Show terminal** opens that run's owned terminal.

For terminals identified as Bash, multi-line commands use a one-line encoded
submission to avoid a reproduced VS Code shell-integration failure with
heredocs and pipes. Approval and reports show your original command. Other
shells keep their original submission behavior. If the shell is not yet known,
a multi-line command waits up to 500 ms for identification. If it remains
unknown, Pair submits the original command. Bash trap/debug context and
error line numbers can differ; normal shell state and exit status are kept.

Use the hand button to the left of Reply to request a chance to interject. The agent
finishes the current speech and safe action before handing you the floor. Press
it again while waiting to lower your hand; once the floor is yours, press it
to focus Reply. The panel shows "What's up?" and, when speech is available,
plays the same cue. Other pauses still apply.

The fixed voice prompt is generated on first use and cached in memory, without
conversation history. Relevant voice, synthesis, privacy or credential changes
invalidate it; the next use creates a new clip. Replays make no new synthesis
request. Generating a cloud clip may use account credits.

The guided `/ai-pair-demo` demonstrates the hand control and cleans up verified
temporary files after you agree to end, unless you ask to keep them. If cleanup
cannot run, it reports the retained paths.

Navigator mode reports your edits and cursor when you select **My turn**,
including a current Pair file in a temporary directory outside the workspace.
Reports identify typing pauses and idle timeouts. Ask the agent to "comment as
I write" for more active commentary. A reply cancels queued observations, so
the guide asks for one point per batch.

A plain **Hand back** without a reply or attached selection preserves queued
navigator observations. A reply, attached selection, takeover or hand request
keeps its interruption behavior. A plain turn change keeps manual **Pause**
active until **Resume**. Typing then undoing to the last reported text
does not create a new typing-pause report; meaningful edits already reported
by an idle timeout still receive their later pause acknowledgement.
Visible new-side lines in the numbered diff can be pointed at without another
read, subject to the existing line-staleness and exact-text checks. Deleted
and omitted lines do not count as seen.

In Pair Settings, **Navigator commentary** controls how much the agent comments
while you take a turn: **Quiet** for important issues and direct answers,
**Helpful** (default) for a first-pause acknowledgement and useful observations,
or **Coach** for more explanation and connections to earlier work. The choice
persists. Changing it wakes a waiting MCP `listen` immediately; if the agent
is busy, its next `listen` returns with the update. Current speech and queued
actions keep playing. Explicit conversation requests take precedence for that
session. This guides
both text and spoken comments; the speaker control independently enables or
mutes audio. The model still decides whether an observation is useful.

Pair narration connects relevant choices to earlier verified work; ask for a
teaching style for more concept explanations without compulsory exercises.

Optional **Speech context and delivery cues** can be enabled in Pair Settings.
For supported models, the provider receives up to three previously completed
agent utterances, bounded to 500 Unicode code points, to improve continuity.
Previous context requires OpenRouter Zero Data Retention; ordinary narration
and supported delivery cues remain available without it.
This is plain previous agent narration, not chat history; it is held only for
the current session. OpenRouter ElevenLabs v4 supports previous text and
delivery cues; v3, v3 conversational and v4 turbo support delivery cues only.
Other models use ordinary speech. This does not enable speech, change the
provider, add a microphone, or create a voice chat.
AI Pair lets a coding agent work in your editor at a pace you can follow. You
can interrupt, ask questions, or take the keyboard while the agent navigates.
This fork builds on the [original project](https://github.com/faiface/ai-pair).

Install AI Pair and AI Pair Local Audio VSIX files from the same
[GitHub release](https://github.com/mattyv/ai-pair/releases/latest), with the
companion on the computer running the VS Code window. Reload the window, run
**AI Pair: Set Up Agent**, and restart the agent to reload its MCP settings.
For a remote workspace, install AI Pair in the workspace and the companion
locally. See the [full guide](https://github.com/mattyv/ai-pair#readme) for
installation, setup, controls, and limitations.

Speech is optional and off by default. Kokoro uses a pinned local model;
ElevenLabs and OpenRouter use separately saved keys and account credits.
OpenRouter discovers eligible models and voices from the account; its ZDR
filter requests the ZDR routing policy, subject to account Safety Retention
settings. A listed model can reject a format, voice, or text input. The
companion's Kokoro requires a Linux x64 desktop with glibc; Mac users can use
local main-extension Kokoro without the companion. Remote speech requires the
companion. Experimental GPU support has limited hardware validation.

**Listening speed** changes local playback independently of synthesis speed;
rates other than 1 remain experimental. Agents can use `speech_mode: "continue"`
to speak over subsequent work or the default `"wait"` before the next action.
A question still needs `listen` and an answer. The voice button mutes narration;
readiness does not establish audibility. The OpenRouter toolbar subtotal is
based on confirmed costs and can be incomplete.

The command prompt offers **Run once**, **Allow this command**,
**Allow all for session**, and **Skip**. **Require command approval** clears
session grants. When a task is complete, the agent summarizes in Pair and
listens until you end the session.
