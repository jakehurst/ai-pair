# 0.39.0 local candidate smoke test

Install both candidate VSIX files (`mattyv.ai-pair` and
`mattyv.ai-pair-local-audio`, both 0.39.0), reload the VS Code window, and reconnect
Pair MCP. Enable speech with your usual provider and output. Start a fresh
Pair session if you want to test a subtotal without unknown earlier costs.

Paste this request into your coding agent:

> Run an AI Pair 0.39.0 smoke test in a new scratch text file inside this
> workspace. Do not overwrite an existing file. First use a short `say` with
> `speech_mode: "continue"`, then type a few short lines while it speaks.
> Keep the normal reading pause. Next send a short question using the default
> wait mode, and call `listen` for my answer. Do not continue until I answer.
> Keep Pair open throughout; do not return a final conversational answer or
> call `end` unless I explicitly ask you to end the session.

Check these observable behaviors:

1.  Typing starts after the normal reading pause and before the first voiceover
    ends. The next spoken question starts after that voiceover ends, and its
    answer is received by the agent.
2.  Muting narration stops the voice without taking your turn or stopping the
    editing session. Re-enable it and ask for another short spoken message.
3.  During another continued voiceover, send an interruption or pause playback.
    No old narration should restart after you resume or start a fresh session.
4.  In Settings, inspect Commands. If you choose Allow all for session for a
    harmless command, Require command approval must clear that permission and
    make the next command prompt again. A command already running continues.
5.  With OpenRouter, check the compact subtotal beside the voice icon. Hover or
    focus it for the precise amount and missing-cost reasons. An asterisk means
    the subtotal is incomplete; previews are excluded.
6.  Ask to end the session while a continued voiceover is playing. Remaining
    audio should stop. Pair must not end itself at an earlier natural pause.

7.  In an active session, press Alt+Q to pause and again to resume. Press
    Alt+W to raise and lower your hand while it is waiting; once granted,
    Alt+W focuses Reply. Ctrl+Alt+Space also focuses Reply. In Pair Settings,
    open Keyboard Shortcuts and verify that you can remap these commands.
    Desktop shortcuts, keyboard layouts and terminal shell routing can
    intercept the defaults; check those if a key does not reach VS Code.

These are human candidate checks; listing them does not mean they have been
performed for this release.

If a step fails, copy diagnostics before changing speech settings, and note
the step, provider, selected output and whether the session was restored.
The checks above require human observation; automated readiness does not
prove that audio was heard.
