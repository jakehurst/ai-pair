---
name: reload-extension
description: Use when asked to reload, rebuild, reinstall, or refresh the AI Pair extension in VS Code so a change in this working copy takes effect, including "pull in the new code" or "try the fix in the editor".
---

# Reload the extension

The installed extension is the packaged `.vsix`, not this working copy. A change here reaches VS Code only after a rebuild and reinstall.

Run, from the repo root:

```sh
sh .claude/skills/reload-extension/scripts/reload.sh
```

It runs the unit tests, deletes any `ai-pair-*.vsix` already at the repo root, packages `ai-pair-<version>.vsix` at the repo root, and installs it with `code --install-extension --force`. It stops at the first failure: a failing test is never installed.

After it finishes, tell the programmer the two steps that cannot be scripted:

1. Run *Developer: Reload Window* from the VS Code command palette.
2. Restart the agent (Claude Code), so it picks up the new `pair-mcp` relay.

If the tests fail, report the failures and stop; do not install.

