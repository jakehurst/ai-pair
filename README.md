# AI Pair Programmer

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

On Windows and Linux, the default shortcuts are **Alt+Q** to pause or
resume, **Alt+W** to raise or lower your hand, and
**Ctrl+Alt+Space** to focus Reply. Once your hand is granted, its shortcut
focuses Reply. On macOS, the defaults are **Ctrl+Shift+Q**, **Ctrl+Shift+W**,
and **Ctrl+Shift+Space**, respectively. Pair Settings opens VS Code's
Keyboard Shortcuts editor to customize these bindings. Desktop shortcuts and
keyboard layouts can reserve these combinations. In a focused terminal, VS Code
may send them to the shell;
its `terminal.integrated.commandsToSkipShell` setting can route the Pair
commands to VS Code instead.

The fixed voice prompt is generated on first use and cached in memory, without
conversation history. Relevant voice, synthesis, privacy or credential changes
invalidate it; the next use creates a new clip. Replays make no new synthesis
request. Generating a cloud clip may use account credits.

Pair narration connects relevant choices to earlier verified work; ask for a
teaching style for more concept explanations without compulsory exercises.

AI Pair lets a coding agent work in your editor at a pace you can follow,
while you interrupt, ask questions, or take over the keyboard. This fork adds
speech, local audio routing, and additional controls to the original project.

## Get started

Install **AI Pair** (`mattyv.ai-pair`) and **AI Pair Local Audio**
(`mattyv.ai-pair-local-audio`) as VSIX files from the same
[GitHub release](https://github.com/mattyv/ai-pair/releases/latest). For a
development build, use both artifacts from the same [Build VSIX workflow run](https://github.com/mattyv/ai-pair/actions/workflows/build-vsix.yml).
Install AI Pair in the workspace and the audio companion locally on the
computer with your speakers. In an SSH or container window, install the
companion on the local side. Reload the VS Code window after installing or
updating both extensions.

AI Pair was published as `michalstrba.ai-pair` before. VS Code treats that as a
different extension, so uninstall it when you install `mattyv.ai-pair`; AI Pair
warns while both are installed and offers to uninstall the old one. Speech API
keys stay with the extension that saved them, so add your ElevenLabs or
OpenRouter key again afterwards.

Run **AI Pair: Set Up Agent** in the command palette, select your agent, then
restart it so it reloads its MCP configuration. Open a project in VS Code,
start the agent in that folder, and ask it to pair. See [Connect your
agent](#connect-your-agent) for supported agents and configuration details.

## Speech and audio

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

Speech is off by default. Enable narration in Pair Settings or with the toolbar
speaker button. The speaker status shows off, unchecked, starting, ready, or
unavailable; hover for details. Ready reflects available cached checks, not
proof that you can hear audio or that a cloud account is available. The toolbar
button also mutes narration. Use **Preview voice** to test your selected voice
and output; only you can confirm audibility.

Choose a provider in Settings:

-   **Kokoro** is local and needs no API key. Run **Download Kokoro model**
    to install the pinned CPU model (about 94 MB), then preview a voice.
    The local companion's Kokoro requires a Linux x64 desktop with glibc.
    On a Mac, use the main extension without the companion for local Kokoro;
    remote speech requires the companion. Mac main-extension builds support
    Intel and Apple silicon, and play speech on the system default output
    through a bundled CoreAudio helper, so no click in the Pair panel is needed
    first. On a Linux desktop the main extension plays the system default
    output through PipeWire the same way, when `pw-play`, `pw-dump` and
    `setpriv` are installed. If neither can run, speech plays in the panel
    instead, which waits for a first click there.
    Enabled Kokoro prepares at extension load without downloading, speaking,
    or making a cloud request.
-   **Kokoro GPU** is experimental on supported Linux x64 systems with the
    companion, and on Apple silicon Macs with the main extension. Select
    **Auto** or **GPU**, then **Set up GPU**. On Linux, setup requires the CPU
    model and can download a pinned GPU model (about 326 MB); one AMD system has
    been tested. On an Apple silicon Mac, GPU runs the same CPU model on Core ML
    with no extra download. Its first load takes 15 to 35 seconds and it is not
    faster than the CPU. Auto may fall back to CPU; GPU mode fails closed. Other
    computers, including Intel Macs and Windows, offer only CPU.
-   **ElevenLabs** uses a key saved through the secure VS Code prompt. Load
    account voices, select one, and preview it. Available voices depend on the
    account. Narration and previews use account credits.
-   **OpenRouter** uses its own securely saved key. Load the account's eligible
    speech models and advertised voices dynamically, then choose PCM or MP3.
    The **ZDR** filter narrows the eligible models and requests OpenRouter's
    ZDR routing policy; account Safety Retention settings still apply. The
    catalog does not establish format, voice, or standard text-input
    compatibility, so a listed model can reject a request. Provider-specific
    parameters are not inferred. Previews and narration use account credits;
    there is no automatic provider fallback.

The companion stores its keys and models locally; generated audio and keys are
not sent to the workspace extension. Saving a key does not enable speech. Choose
**Speech output** for the system default or an explicit local device. Linux
playback requires `pw-play`, `pw-dump`, and `setpriv`; native playback helpers
ship for macOS and Windows. Device availability and audible output depend on the
local environment.

**Listening speed** adjusts local playback without changing pitch, separately
from a provider's synthesis speed and from code and reading pace. It applies to
the next narration or preview and makes no additional provider request. Rates
other than 1 are experimental and have only been checked with synthetic
signals, not human listening.

By default, playback waits for spoken narration before the next action. Agents
can choose `speech_mode: "continue"` to let commentary play over subsequent
work; later spoken messages remain ordered. Questions that need an answer use
`"wait"` followed by `listen`: audio finishing is not an answer. Ending the
session stops outstanding speech. Short messages are eligible for narration;
messages over 45 words or 280 characters are displayed without speech, and the
agent can choose silence.

OpenRouter's compact toolbar subtotal uses provider-confirmed speech costs.
It is approximate when compactly displayed and may be incomplete when costs
are missing or still being retrieved. Hover or focus it for precise confirmed
amounts and details; it is not a complete account bill.

## Pair controls

The panel offers **Run once**, **Allow this command**, **Allow all for
session**, and **Skip**. The middle choices grant session approval for that
command or for all commands, respectively.
**Require command approval** clears session grants and restores confirmation;
an optional approval sound uses the system default output. The programmer can
interrupt by replying or editing, take the keyboard with **My turn**, and hand
it back. The agent can comment as navigator when useful and should build on
user edits. At task completion it summarizes in Pair and listens until the
programmer explicitly ends the session.

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

In Claude Code, `/pair:demo` runs a guided Pair session and `/pair:diagnose`
checks connection, command, speech, and audio status. The legacy
`/mcp__pair__demo` and `/mcp__pair__diagnose` forms also work. The extension
includes `skills/ai-pair-demo/SKILL.md` and `skills/ai-pair-diagnose/SKILL.md`;
copy their directories to your Claude `.claude/skills` directory to use
`/ai-pair-demo` and `/ai-pair-diagnose`. No skill is installed automatically.
The demo follows your speech setting, demonstrates raising a hand, and cleans up
verified temporary files when it ends unless you ask to keep them. If cleanup
cannot run, it reports the retained paths. Diagnostics do not run a paid preview.

## Original project README

The following introduction is from the [original AI Pair project](https://github.com/faiface/ai-pair).

## For those of us who want, need, or love to stay close to the code

> A **mirror neuron** is a neuron that fires both when an animal acts and when
> the animal observes the same action performed by another.
>
> — [Wikipedia](https://en.wikipedia.org/wiki/Mirror_neuron)

### Be there for every keystroke

![The agent explains the update method in the Pair panel, then types it in the
editor](media/every-keystroke.gif)

Some of us, at least some of the time, want to understand our code at a deep
level. For that, handing a task to an agent and reviewing the diff that comes
back can be exhausting. With *AI Pair Programmer*, you're there for every
keystroke instead, and you end up knowing the code almost as if you'd typed it
yourself.

It's pair programming where your coding agent has the keyboard. It types in your
editor slowly enough to follow and explains what it's doing. Interrupt it
whenever you like, or take over and let it watch you for a change.

### Interrupt and steer

![The programmer asks the agent to fix its imports, and it adds them at the top
of the file](media/interrupt-and-steer.gif)

### Watch it change its mind in real time

![The agent writes a comment, reconsiders, deletes it, and documents the type
differently](media/change-its-mind.gif)

It's also a good way to learn a new technology, or to have the agent walk you
through code you don't know yet.

### Ask it to explain code line by line

![The agent walks through a function line by line, highlighting each line and
explaining it in the Pair panel](media/explain-line-by-line.gif)

It works in VS Code, with the coding agent you already use. Setup is built in
for Claude Code, Codex, OpenCode, Gemini CLI and Cursor, and any agent that
supports MCP can be connected by hand.

**Note:** It works best with strong models; weaker ones tend to struggle with
this way of working.

## How to use it

Once the extension is [installed](#install) and [connected to your
agent](#connect-your-agent), keep using your agent as usual. When you want to
pair:

1.  Open the project in VS Code, and start your agent **in the same folder** (or
    a subfolder of it).
2.  Ask it to pair: *"Let's pair on adding a settings page."* In Claude Code,
    you can also run `/mcp__pair__start`. If you want to learn the technology
    too, say so: *"...I'm new to Svelte, explain as you go."* With Claude Code's
    CLI installed and set up, the **Pair** panel also offers **Start a
    session**: it starts Claude Code in a hidden terminal with the request
    already sent, and the Pair panel stays in front. The terminal closes when
    the session ends. Until the agent starts, the panel says a session is
    starting.
3.  The **Pair** panel opens in the secondary side bar, and the agent's cursor
    appears in your editor.

Anything you say or edit interrupts the agent, so its next move takes it into
account. While you pair:

| To... | Do this |
|---|---|
| say something to the agent | type in the reply box, press Enter. Typing pauses playback. In Settings, choose **Finish current action first** to wait for the action boundary; long commands can delay replies and Stop remains immediate. |
| ask about some code | select it in the editor, then reply: the selection goes along (**x** leaves it out) |
| let it run a command | **Run once**, **Allow this command**, **Allow all for session**, or **Skip**; **Show terminal** reveals the command's terminal |
| stop it right now | **Interrupt**, or just edit the code: any edit interrupts |
| look around | scroll or switch files. Playback pauses until you **Resume**, which brings you back to the agent's cursor |
| write a part yourself | **My turn**. The agent becomes the navigator and comments as you type. **Hand back** returns the turn, with your reply if you typed one |
| change the pace or code display | the speed menu (**1.0x**) sets the pace and chooses Typing, Lines, or Blocks for the next typing action |
| manage the reading pause | click the ring to finish; hold it to pause the countdown until release. Focus it and use Space for the same behavior |
| finish | **End**, or tell the agent you're done. You can pair again anytime |

Lines and Blocks show code in groups with a reading pause and highlight for
each group. Reading speed and the main pace adjust those pauses; click or hold
the reading ring to finish or pause one. Typing remains the default.

The status shows when playback is **Paused** or **Playing**. Reading pauses,
command confirmations, your turn and suspended sessions remain distinct. A
ready count shows accepted work that has not started, and completed command
results promptly reach a waiting agent. The cursor is yellow and pulsing when
the agent has just spoken and is waiting for you to read.

**Try it without an agent:** *AI Pair: Play Demo Session* plays a scripted
session that adds a small API to an Express app, which it creates in
`ai-pair-demo/`.

## How it works under the hood

```text
agent (Claude Code, ...) ── stdio MCP ──▶ pair-mcp ── local WebSocket ──▶ VS Code extension
```

The agent submits small batches of actions: say, move, select, type, newline,
delete, point, run. The extension plays them at a human pace and reports back exactly
what happened, including everything you did in the meantime. The agent plans its
next batch while you watch the current one, which hides most of its thinking
time. And it's never more than one batch ahead, so your interruptions land
immediately. Typing handles CRLF line endings consistently and preserves a
standalone carriage return. Structural newlines and single-close moves are
explicit choices; other typing remains literal.

The design is written up in:

-   [PROTOCOL.md](PROTOCOL.md): the tools and their exact semantics, as the
    agent sees them.
-   [AGENT_GUIDE.md](AGENT_GUIDE.md): how the agent should pair, returned to it
    when a session starts.
-   [DESIGN.md](DESIGN.md): what you see: the cursor, the panel, the timing.
-   [ARCHITECTURE.md](ARCHITECTURE.md): the components and how they connect.

## Install

You need **VS Code 1.106 or newer**. Install the paired VSIX artifacts from
the same release as described in [Get started](#get-started). Reload the
window and restart the agent. Settings shows the running version and build ID.
**Copy diagnostics** explicitly copies bounded connection, session, request,
pause, and command status metadata; it does not include chat, code, paths,
command text, or output.

To build it from source instead, you also need **Node.js 22.19 or newer**:

```sh
git clone https://github.com/mattyv/ai-pair.git
cd ai-pair
npm install
npm run package
code --install-extension ai-pair-*.vsix
```

## Connect your agent

1.  **Open a project folder in VS Code.** The extension installs the MCP server
    your agent runs, at `~/.ai-pair/bin/pair-mcp`
    (`%USERPROFILE%\.ai-pair\bin\pair-mcp.cmd` on Windows). It runs on VS Code's
    own runtime, so it doesn't need Node.js.
2.  **Run *AI Pair: Set Up Agent*** from the command palette (VS Code also
    offers this the first time the extension starts). Pick your agents; the ones
    it finds installed are already checked. For each one, it adds a server named
    `pair` to that agent's user-wide MCP configuration, leaving everything else
    in the file as it was:

    | Agent | Where |
    |---|---|
    | **Claude Code** (the CLI, the IDE extensions, the Claude desktop app's Code tab) | `claude mcp add --scope user`, or `~/.claude.json` without the `claude` command |
    | **Codex** (the CLI, the IDE extension, the app) | `~/.codex/config.toml` (or in `$CODEX_HOME`) |
    | **OpenCode** | `~/.config/opencode/opencode.json` (`.jsonc` if you have one), on Windows too |
    | **Gemini CLI** | `~/.gemini/settings.json` |
    | **Cursor** | `~/.cursor/mcp.json` |
    | **Another agent** | copies an MCP server configuration to the clipboard: a stdio server named `pair` running the launcher |

3.  **Restart your agent** so it picks up the new server.

## Calibrate your reading speed

The pause after each of the agent's messages is sized to the message, at a rate
per character. To set that rate to your own pace, run *AI Pair: Calibrate
Reading Speed*: the Pair panel shows a passage when you type `go`, you read it,
and you type `x` the moment you finish. The rate goes into `aiPair.timing` in
your settings. Asking the agent for another passage ("use the Rainbow Passage")
has it fetch the text and start the calibration with it.

## Settings

Commands use quiet terminals by default; **Show terminal** reveals one. If shell
integration is unavailable, the terminal opens so you can see the command.
Hidden terminals are not restored when the workspace is reopened.

The Pair panel's **Settings** button lets you choose the chat order. The default
shows the newest messages at the top; choose **Oldest first** to put new messages
and the reply box at the bottom. Your choice is saved across reloads.

| Setting | |
|---|---|
| `aiPair.showTerminalsAutomatically` | Show Pair command terminals automatically (default off); also available in Pair Settings. |
| `aiPair.codePlayback` | `typing` (default), `lines`, or `blocks`; also in the code display dropdown and Settings. Applies to the next typing action. |
| `aiPair.chatOrder` | `newestFirst` (default) or `oldestFirst`; also available in the Pair panel settings. |
| `aiPair.speed` | Overall playback speed, the follow scroll's glide included (the panel's speed menu offers 0.4x to 3.0x). |
| `aiPair.readingSpeed` | Reading speed: divides the reading pauses after narration and grouped code (the panel's reading menu offers 0.4x to 3.0x). |
| `aiPair.calibrationPassage` | The passage *AI Pair: Calibrate Reading Speed* times you on, as `{ "title": ..., "text": ..., "notice": ... }`; empty, the built-in one. The agent's `calibrate` tool writes it. |
| `aiPair.agentName` | The name on the agent's cursor. |
| `aiPair.timing` | Fine-tune any typing, pause, or glide duration, e.g. `{ "afterSelectMs": 900, "type": { "wordStartMs": 140 } }`. Every key is in [`timing.ts`](packages/core/src/timing.ts). |
| `aiPair.confirmCommands` | Ask before each command the agent runs in the terminal (default on). Turned off, the agent's commands run without any prompt, not even its own. |

## Rules for the agent

Rules you and the agent settle on can live in a file, so you don't repeat them
every session. When a session starts, the agent gets them after the pairing
guide, and the panel's "Session started" line names the files it was given:

-   `~/.ai-pair/GUIDE.md`: rules for every project.
-   `.ai-pair/GUIDE.md` in a project: rules for that project. Every one from the
    workspace folder down to the agent's working directory is read, outer first,
    and none above the workspace folder. One that git ignores is left out; one
    checked in always counts.

Later files take precedence over earlier ones, and all of them over the pairing
guide. Each is plain markdown, read up to 20,000 characters. A project's file
goes into the agent's instructions, the same trust an agent's own `CLAUDE.md` or
`AGENTS.md` gets.

## Troubleshooting

-   **The agent says `no_editor`.** Its working directory isn't inside a folder
    that's open in VS Code. Open that folder in VS Code, or start the agent in
    it.
-   **The agent doesn't have the pair tools.** Restart the agent after setting
    it up. *AI Pair: Set Up Agent* marks the agents that are set up. With Claude
    Code, `claude mcp list` should show `pair`.
-   **After updating the extension,** reload the VS Code window and restart the
    agent. A session in progress waits, suspended, and the agent's next `start`
    from the same folder resumes it.

## Development

```text
packages/
  protocol/   types shared by everything
  core/       editor-agnostic sessions, playback, and the local WebSocket server
  relay/      pair-mcp, the MCP server the agent runs
  vscode/     the extension, which ships the relay
scripts/      the repository's checks and its release, in TypeScript that Node runs as is
```

```sh
npm install
npm test                  # unit and end-to-end tests
npm run typecheck         # the packages and the scripts
npm run lint              # oxlint; the scripts also to Google's TypeScript Style Guide
npm run format:check      # Prettier
npm run check:ascii       # every tracked file is ASCII, apart from scripts/check_ascii.ts's allowlist
npm run lint:swift        # Swift to Google's Swift Style Guide, with Xcode's swift-format (macOS)
npm run typecheck:swift   # the Swift icon script compiles without warnings (macOS)
npm run lint:sh           # shell scripts to Google's Shell Style Guide (needs ShellCheck and shfmt)
npm run lint:web          # the panel's HTML and CSS to Google's HTML/CSS Style Guide, and valid HTML5 (needs Java)
npm run lint:md           # Markdown to Google's Markdown style guide
npm run build             # development build of the extension
npm run test:integration  # plays a session inside a real, isolated VS Code (macOS; VSCODE_BIN for another)
npm run test:shell        # the shell scripts, with bats, against fake tlc, Code, npm, and code commands
npm run test:swift        # the icon's Swift package: its drawing, and that media/ holds what it writes (macOS)
npm run test:visual       # the panel's page in Chromium against its screenshots; test:visual:update records them
npm run test:coverage     # the unit tests, with coverage, in coverage/unit/
npm run test:integration:coverage  # the integration test, with coverage of the bundle mapped to the sources, in coverage/integration/
npm run coverage:tla      # every spec, with TLC counting how often each action fired, in coverage/tla/; an action that never fired fails it
npm run test:shell:coverage  # the shell tests under kcov, in coverage/shell/ (Linux; on macOS kcov records nothing under bats)
npm run test:swift:coverage  # the Swift tests with llvm-cov, in coverage/swift/ (macOS)
npm run coverage          # all of them; each rewrites its column of COVERAGE.md, and fails below coverage_thresholds.json
npm run package           # production build -> ai-pair-<version>.vsix
```

For a packaged functional check, unpack the VSIX to a writable temporary
directory and set `EXTENSION_PATH` to its `extension` directory. The harness
puts each fixture under its owning extension so VS Code supplies the correct
API facade, and removes the generated fixture directory afterward. Use the
development build for source-mapped integration coverage; production VSIX files
do not include the main bundle's source map.

To run your working copy, open the repository in VS Code and press F5, or:

```sh
code --extensionDevelopmentPath="$PWD/packages/vscode" <a project folder>
```

### Releasing

Follow the [release checklist](RELEASE.md), including the README and
architecture review, paired artifacts, and verification evidence. Each change
bumps the version in its pull request. On `main`, `npm run release` tags that
version and pushes the tag; the
[Publish workflow](.github/workflows/publish.yml) then publishes both
extensions to the VS Code Marketplace and makes the GitHub release. The
platform assets need separate checks.

## License

[MIT](LICENSE)

### Checking specifications locally

`npm run coverage:tla` checks all TLC configurations and aggregates action
coverage. It runs two configurations at a time with one TLC worker each; set
`TLC_JOBS` from 1 to 8 to change that limit for the available memory and CPU.
