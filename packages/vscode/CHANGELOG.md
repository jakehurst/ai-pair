# Changelog

## 0.6.0

- The editor's scroll to follow the agent now takes its time from the playback speed, like
  typing and pauses: at 1.0x it is half a second for a short jump, 10 ms more for each line,
  up to 1.5 s, and the speed divides that. Before, it was half a second at any speed and any
  distance. `aiPair.timing` sets the three numbers: `glideMs`, `glidePerLineMs`, and
  `glideMaxMs`. With `editor.smoothScrolling` on, VS Code still animates the scroll at its
  own pace.

## 0.5.1

- After a window reload, a session in progress shows as suspended in the Pair panel, with
  the divider and the status "Suspended: waiting for the agent". Before, it looked live, and
  messages sent then seemed to go nowhere. When the reload cuts off the agent mid-call, it is
  told to call `start` again to resume the session, not to start a new one.

## 0.5.0

- Sending a message in the Pair panel scrolls the history back to its top, so your message
  is in view even when you had scrolled down to read older entries. Entries from the agent
  still leave the history where you scrolled it.

## 0.4.4

- A command's output, as the agent sees it, no longer runs a tool's progress lines together.
  Prettier's file list and npm's spinner, which redraw one line in place, now show only what
  the line ends with.
- The panel's styles load from a stylesheet of their own, so the panel no longer allows inline
  styles.

## 0.4.3

- The status no longer flashes "Agent is thinking" every 45 seconds while the agent is only
  waiting for you. It stays "Your move" between the agent's waits, and changes as soon as you
  do something or the agent starts working.

## 0.4.2

- Sending a reply no longer moves the editor: a file you closed stays closed, and the tab you
  switched to stays in front, with the selection you made. The agent's next edit still shows its
  file, and **Resume** still brings you back to the agent's cursor.

## 0.4.1

- The panel and the editor show plain ASCII where they showed symbols: the
  speed menus read `1.0x`, the agent's cursor label reads `Claude - running`,
  line ranges read `12-20`, a file changed outside the editor is badged `*`,
  and a command's outcome reads `exit 0`, `exit 1`, `stopped`, or `skipped`,
  without a symbol in front.
- The Pair view has an icon, shown when it's moved into a container of its own.

## 0.4.0

- **Start a session** now starts Claude Code's CLI in a hidden terminal with
  the request already sent, so the Pair panel stays in front and you never
  press Enter in Claude Code. The terminal closes when the session ends. It
  needs the `claude` CLI on your PATH or in `~/.local/bin`, and a folder open.
- Start a session no longer changes Claude Code's preferred location to
  `panel`.
- After you click **Start a session**, the panel says a session is starting
  until the agent starts it, or until Claude Code exits without one.

## 0.3.0

- **Start a session** in the Pair panel's idle view opens a Claude Code tab
  with the request typed in, when the Claude Code extension is installed and
  set up for the pair server: one click and Enter, without leaving the editor.

## 0.2.0

- A reading menu sets the pause after each message on its own, from 0.4x to
  3.0x; the pause grows with the message's length, with no cap.
- **AI Pair: Calibrate Reading Speed** times you on a passage and sets the
  pause after each message to your own pace. The agent can supply another
  passage with its `calibrate` tool.
- A reply after you looked away no longer reopens a file the agent pointed at
  earlier; the view comes back to the agent's cursor instead.

## 0.1.0

The first release.

- Your coding agent gets its own cursor in the editor, types at a human pace,
  and explains what it's doing in the **Pair** panel.
- Reply, interrupt, or edit the code at any moment, and the agent's next move
  takes it into account. Select some code to ask about it.
- **My turn** lets you write a part yourself while the agent navigates.
- The agent's commands play in an *AI Pair* terminal, after you allow them.
- The speed menu sets the pace, from 0.4x to 3.0x.
- **AI Pair: Set Up Agent** connects Claude Code, Codex, OpenCode, Gemini CLI
  and Cursor. GitHub Copilot needs no setup.
- **AI Pair: Play Demo Session** shows what it's like without an agent.
