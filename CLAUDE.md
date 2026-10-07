# Working rules for agents in this repository

Rules for a coding agent working on this codebase, decided with Justine in earlier sessions. Read them at the start of every session so she does not have to repeat them. Add a rule here whenever she sets one. This is not the guide the extension sends to pairing agents; that is `AGENT_GUIDE.md`, which ships to every user.

## GitHub issues

Issues for this work live on the fork, `jakehurst/ai-pair` (the `jakehurst` remote). `origin` is the upstream repository, `faiface/ai-pair`; do not file issues or push there.

- **Add what you find to the open issue it belongs to.** When work turns up a detail that is relevant to an open issue, add it as a comment on that issue, without asking first, so all discovered context is in one place when the issue is worked on. Say how each detail was verified (reproduced, measured, or from reading the code), and tell Justine which issues got a comment.
- This covers comments on existing open issues only. Creating an issue, closing one, changing labels, or editing an issue's body waits for Justine's word.
- **New issues** reference code as permalinks pinned to a commit, and carry one of the severity labels (`severity: critical`, `high`, `medium`, `low`) when they are findings, or `enhancement` when they are requests.

## Working notes while fixing an issue

- Keep notes as you work in `blueprints/notes/issue-<N>-<slug>.md`: the bug, the change and why, the test, every verification run with its result, the review, and anything noticed about the tool itself.
- The notes file is working memory while the issue is being worked: draw the commit message and the PR description from it. The issue is where the notes are kept for good. Once the fix is merged, or work on the issue stops, post the file verbatim as a comment on the issue (`gh issue comment <N> -R jakehurst/ai-pair --body-file <file>`), without asking first, then delete the local file (set by Justine on 2026-10-07).
- Never stage or commit the notes file, and do not mention it in the commit message.

## Findings from the TLA+ specs (#19)

Set by Justine on 2026-10-07.

- **Rule out a false positive first.** When TLC finds a violation, check the spec against the code before reporting it: every action and variable in the counterexample trace must match what the code does.
- **A finding that holds gets its own issue,** without asking first. Write the detailed findings, and say how it was found: the spec, the property, the config and bounds, and the counterexample trace.
- **Fix it spec first, then code.** First correct the spec until TLC passes both the safety and the liveness checks. Then change the code to match the corrected spec. Then confirm the code is fixed with unit and integration test coverage.

## Code

- In test files, write the cursor marker as the escape `"\u{258c}"`, not as the literal character. Justine prefers the escape to a special character encoded in the file (2026-10-06).
