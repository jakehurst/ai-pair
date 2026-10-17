# Changelog

## 0.7.5

-   The Copilot server provider is gone (#182): the extension no longer
    offers the pair server to VS Code's own chat agent. A Copilot user sets
    it up with Set Up Agent's **Another agent**.
-   The unit tests are solitary (#176, in part): each tests one source file,
    with what it imports mocked, and covers it 100 percent by itself. Core's
    tests are all solitary, with `session.e2e.test.ts` for the properties
    that hold only where the controller and the player meet; in the vscode
    package, so are the tests of `passage`, `output`, `outside`, `view`,
    `calibration`, `panel_html`, `outside_watch`, `terminal`, `agents`, and
    `setup`. Tests that need several real files are `*.e2e.test.ts`.
-   No test leaves files behind: `agents.test.ts` and `setup.test.ts` use an
    in-memory disk, `coverage_report.e2e.test.ts` removes its fixtures, and
    `integration.sh` removes its temporary folder when it ends.
-   The integration run covers Set Up Agent: its picker closed, Another
    agent's configuration copied, and Claude Code and Codex picked. Code runs
    with the agents' configuration folders in the run's own folder and only
    the system's programs on its PATH, so the run changes no real
    configuration.
-   Code no run reaches is gone: two fallbacks in the controller's report of
    edits (an edit event now carries its own texts), and a check in the
    terminal's wait for a signal that can't have fired yet. Nothing changes
    for anyone using the extension.

## 0.7.4

-   Code no real run of the extension and relay reaches is gone (#180).
    `wire.ts` takes a frame as the one Buffer `ws` hands over, not an
    ArrayBuffer or an array of Buffers, since nothing sets `binaryType`.
    `bridge.ts` drops checks for a report whose parts aren't arrays, a
    server address that isn't a port, a server not made yet, and a thrown
    value that isn't an Error. `link.ts` drops the try/catch around a send
    on an open socket, the abort listener's check for an answered call,
    `handBack`'s check for a value that isn't an object, and `workspace()`'s
    fallback for a real path that moved between two reads: `findWindows`
    gives the root it matched. Nothing changes for anyone using the
    extension.
-   `bridge.ts`, `link.ts`, and `wire.ts` are at 100 percent in both the
    unit and the integration run, on macOS and Linux. The integration run
    drives the bridge over raw sockets, and the relay against fake windows:
    a dead pid, a junk file, a refused port, a rejected hello, a slow
    welcome, a cancel, and a shutdown mid-call. `bridge.test.ts` is
    solitary, and `bridge.discovery.test.ts` is folded into it and the
    integration run.

## 0.7.3

-   The relay now exits when its harness ends its stdin (#163): it closes its
    MCP server, then its link to the editor, which closes its socket and
    opens no other; a call after that is refused with "The relay is shutting
    down." `specs/Wire.tla` models it with `Shutdown` and
    `CloseAfterShutdown`, and `ExitsAfterShutdown` checks it.
-   A `move` whose `at` is not a text, such as `{ move: { at: 5 } }`, is now
    refused by name: "`at` is a text, with the cursor marker where your
    cursor goes." It used to throw a TypeError. `specs/ActionValidation.tla`
    checks that no place makes `moveProblem` or `spanProblem` throw.
-   The protocol's types are zod schemas in `@ai-pair/protocol`, and both ends
    parse whole frames with them: a frame whose fields have the wrong types
    is not a message, as one that isn't JSON already was. The editor drops
    it; the relay drops it after the welcome, and before it fails to
    connect. The relay checks discovery files, reports, and file contents
    the same way.
-   Every relay source file is at 100 percent from its own unit test, and
    each test is solitary: it tests one source file and mocks the rest. The
    unit tests run isolated, each file with its own module cache, so a
    file's mocks always apply; a run takes about a second longer.
    `units.test.ts` and `render.fields.test.ts` are split into the test files
    of the sources they test.
-   The integration run gains three cases: every malformed action the
    checks refuse, sent over a relay link, is refused by name in the editor,
    and a frame that is not a message is dropped; a pause holds a `say` until
    the resume, and an interrupt during a move's `show` cuts the batch; and a
    relay skips a window that answers its hello with something that is not a
    message, and starts without `AI_PAIR_HOME`. `timeline.ts`, the
    protocol's `index.ts`, and `wire.ts` are at 100 percent of lines in it.

## 0.7.2

-   The unit tests now cover every line, branch, and function of
    `packages/core/src` and `packages/protocol/src` (#162); the thresholds in
    `coverage_thresholds.json` are 100 for each of those files. `core`'s
    `index.ts` and `paths.ts` only re-export, so they leave the unit run.
    New tests cover the bridge's WebSocket conversation, the player's refused
    actions and interrupts, the controller's no-session guards, trace, and
    restored reports, the rehearsal, the timeline's pause path, and the
    protocol's frames. Branches no sequence of calls could reach are gone,
    with no change for any state that can occur: a second check where the
    first had already run, an `?? undefined`, a lookup of an event that always
    exists, a `default` after every kind of call, and a queued batch typed as
    maybe lacking its rehearsal. `Player` takes a `PlayerEditor`, an
    `EditorPort` without the three methods only the controller calls.
-   A `move`, `select`, or `point` whose place is not an object, such as
    `{ move: 5 }` or `{ move: [] }`, is now refused by name in
    `fieldsProblem`, with the fields the place takes. The player used to
    refuse it only by accident, with a TypeError, in a check that the unit
    work removed as redundant; the relay's schema already refused it.
    `packages/relay/test/validation.test.ts` gains the cases.
    The extension otherwise works the same.

## 0.7.1

-   Every action of every TLA+ spec now fires in a config CI checks (#169).
    `specs/Discovery_InPlace.cfg` models the write in place that #72 removed,
    so `Focus` and `FinishWrite` fire there; `specs/check.sh --coverage` and
    `scripts/coverage_report.ts` sum an action's fires over a spec's configs
    (`Spec.cfg` and `Spec_<Model>.cfg`), telling the disjuncts of an inline
    `Next` apart by their location, and name only an action that fired in
    none. The extension works the same.

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
