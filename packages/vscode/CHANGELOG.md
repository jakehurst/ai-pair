# Changelog

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
