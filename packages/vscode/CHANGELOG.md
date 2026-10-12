# Changelog

## 0.7.0

-   Every coverage run now fails when a file drops below its measured
    coverage, held in `coverage_thresholds.json` at the root (#161): vitest
    holds each file's unit numbers, `scripts/coverage_report.ts --check` the
    integration, Swift, shell, and CSS columns, and `specs/check.sh --coverage`
    fails on an action that never fired unless the spec's section of
    `specs/README.md` says it never fires. CI keeps COVERAGE.md and the reports
    as artifacts on a failed run too. The extension works the same.

## 0.6.11

-   Every TypeScript file now follows Google's TypeScript Style Guide, not
    only the scripts, and CI checks all of it with oxlint and Prettier (#133).
    Three source files are renamed to snake_case (`outside_watch.ts`,
    `panel_messages.ts`, `panel_html.ts`). The code targets ES2025. The
    extension works the same.
-   The extension says what it needs in its manifest, as VS Code asks: it
    stays off in Restricted Mode and in a virtual workspace, since the agent
    edits files and runs commands; each setting has its scope; the session
    commands (pause, interrupt, turn, end, reply) are in the Command Palette
    only during a session; the Marketplace listing has its categories and
    keywords.

## 0.6.10

-   The repository's scripts are TypeScript now, to Google's TypeScript Style
    Guide, and CI checks them against it with oxlint and Prettier (#134).
    `npm run lint:web` runs Stylelint itself, with its config in
    `scripts/stylelint.config.ts`. The extension works the same.

## 0.6.9

-   When the agent has made no call for a listen's timeout (45 seconds), the
    panel says *Agent isn't listening*, so you can tell it has stopped,
    instead of seeing *Agent is thinking* (#149).
-   When playback is paused, every report says so and why (you pressed
    Pause, you're typing a reply, you're looking at another file, or a
    calibration), so the agent knows its batches are waiting (#149).
-   A very long edit, over 200 lines of diff, reaches the agent as the line
    ranges it changed, and the agent reads the file, so a report stays small
    enough for it to read (#149).
-   The **AI Pair** output logs each session's interactions at the Info level:
    statuses, batches, pauses and their reasons, interrupts, edits, and each
    report with its size, so a log shows where a session went wrong (#149).

## 0.6.8

-   Fixed: `npm run test:integration` failed at once when run from a terminal
    inside VS Code that sets `ELECTRON_RUN_AS_NODE`, such as Claude Code's. The
    script now unsets it before starting VS Code (#152).

## 0.6.7

-   The `Rehearsal` spec now covers a batch that is already playing when a
    change by someone else interrupts the queue, such as a formatter on save:
    the batch plays on and may complete, and `adopt` keeps its line identities
    off the changed text (#151). A new test checks that `adopt` does. The specs
    and their README say each property in words, not by its ID in #19. The
    extension works the same.

## 0.6.6

-   The `Serialize` spec says when a step returns as the code does: once its
    batch is done, or plays next, so a step returns as soon as the one before
    it has (#150). TLC checks the new `ReadyAtHead` invariant. The extension
    works the same.

## 0.6.5

-   Fixed: when the agent's connection closed while its `start` was still
    running, a different agent whose session had ended could keep control of
    the new, suspended session and drive it. The suspended session now has no
    owner until an agent starts again. Found by the `Bridge` spec's model
    checking (#148).
-   The TLA+ specs follow the TLA+ style guide in `specs/`, and CI checks the
    rules a script can check (`npm run lint:tla`). Every spec now has a type
    invariant, a property that says something must happen, a mutation that
    proves each property can fail, and a test named for each property it
    proves. Every test writes the agent's cursor marker by name.

## 0.6.4

-   The repository's Markdown, this changelog and the Marketplace README
    included, follows Google's Markdown style guide, and CI checks it with
    markdownlint (`npm run lint:md`). The README gains a title and headings over
    its animations; the words are unchanged.

## 0.6.3

-   The Pair panel's page and stylesheet follow Google's HTML/CSS Style Guide,
    and the page is valid HTML5. CI checks both (`npm run lint:web`). The panel
    looks and works the same.

## 0.6.2

-   The repository's shell scripts follow Google's Shell Style Guide, and CI
    checks them with ShellCheck, shfmt, and the guide's shebang, file name, and
    length rules (`npm run lint:sh`). `npm run test:integration` now runs its
    script with `bash`. Nothing changes in the extension.

## 0.6.1

-   The Swift script that draws the icon, `scripts/icon.swift`, follows Google's
    Swift Style Guide, and CI checks it with swift-format and a
    warnings-as-errors type check on macOS (`npm run lint:swift`,
    `npm run typecheck:swift`). The icon it draws is unchanged.

## 0.6.0

-   The editor's scroll to follow the agent now takes its time from the playback
    speed, like typing and pauses: at 1.0x it is half a second for a short jump,
    10 ms more for each line, up to 1.5 s, and the speed divides that. Before,
    it was half a second at any speed and any distance. `aiPair.timing` sets the
    three numbers: `glideMs`, `glidePerLineMs`, and `glideMaxMs`. With
    `editor.smoothScrolling` on, VS Code still animates the scroll at its own
    pace.

## 0.5.1

-   After a window reload, a session in progress shows as suspended in the Pair
    panel, with the divider and the status "Suspended: waiting for the agent".
    Before, it looked live, and messages sent then seemed to go nowhere. When
    the reload cuts off the agent mid-call, it is told to call `start` again to
    resume the session, not to start a new one.

## 0.5.0

-   Sending a message in the Pair panel scrolls the history back to its top, so
    your message is in view even when you had scrolled down to read older
    entries. Entries from the agent still leave the history where you scrolled
    it.

## 0.4.4

-   A command's output, as the agent sees it, no longer runs a tool's progress
    lines together. Prettier's file list and npm's spinner, which redraw one
    line in place, now show only what the line ends with.
-   The panel's styles load from a stylesheet of their own, so the panel no
    longer allows inline styles.

## 0.4.3

-   The status no longer flashes "Agent is thinking" every 45 seconds while the
    agent is only waiting for you. It stays "Your move" between the agent's
    waits, and changes as soon as you do something or the agent starts working.

## 0.4.2

-   Sending a reply no longer moves the editor: a file you closed stays closed,
    and the tab you switched to stays in front, with the selection you made. The
    agent's next edit still shows its file, and **Resume** still brings you back
    to the agent's cursor.

## 0.4.1

-   The panel and the editor show plain ASCII where they showed symbols: the
    speed menus read `1.0x`, the agent's cursor label reads `Claude - running`,
    line ranges read `12-20`, a file changed outside the editor is badged `*`,
    and a command's outcome reads `exit 0`, `exit 1`, `stopped`, or `skipped`,
    without a symbol in front.
-   The Pair view has an icon, shown when it's moved into a container of its
    own.

## 0.4.0

-   **Start a session** now starts Claude Code's CLI in a hidden terminal with
    the request already sent, so the Pair panel stays in front and you never
    press Enter in Claude Code. The terminal closes when the session ends. It
    needs the `claude` CLI on your PATH or in `~/.local/bin`, and a folder open.
-   Start a session no longer changes Claude Code's preferred location to
    `panel`.
-   After you click **Start a session**, the panel says a session is starting
    until the agent starts it, or until Claude Code exits without one.

## 0.3.0

-   **Start a session** in the Pair panel's idle view opens a Claude Code tab
    with the request typed in, when the Claude Code extension is installed and
    set up for the pair server: one click and Enter, without leaving the editor.

## 0.2.0

-   A reading menu sets the pause after each message on its own, from 0.4x to
    3.0x; the pause grows with the message's length, with no cap.
-   **AI Pair: Calibrate Reading Speed** times you on a passage and sets the
    pause after each message to your own pace. The agent can supply another
    passage with its `calibrate` tool.
-   A reply after you looked away no longer reopens a file the agent pointed at
    earlier; the view comes back to the agent's cursor instead.

## 0.1.0

The first release.

-   Your coding agent gets its own cursor in the editor, types at a human pace,
    and explains what it's doing in the **Pair** panel.
-   Reply, interrupt, or edit the code at any moment, and the agent's next move
    takes it into account. Select some code to ask about it.
-   **My turn** lets you write a part yourself while the agent navigates.
-   The agent's commands play in an *AI Pair* terminal, after you allow them.
-   The speed menu sets the pace, from 0.4x to 3.0x.
-   **AI Pair: Set Up Agent** connects Claude Code, Codex, OpenCode, Gemini CLI
    and Cursor. GitHub Copilot needs no setup.
-   **AI Pair: Play Demo Session** shows what it's like without an agent.
