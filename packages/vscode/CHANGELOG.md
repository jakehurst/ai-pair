# Changelog

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
- The speed menu sets the pace, from 0.4× to 3.0×.
- **AI Pair: Set Up Agent** connects Claude Code, Codex, OpenCode, Gemini CLI
  and Cursor. GitHub Copilot needs no setup.
- **AI Pair: Play Demo Session** shows what it's like without an agent.
