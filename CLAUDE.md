# Working rules for agents in this repository

Rules for a coding agent working on this codebase, decided with Justine in earlier sessions. Read them at the start of every session so she does not have to repeat them. Add a rule here whenever she sets one. This is not the guide the extension sends to pairing agents; that is `AGENT_GUIDE.md`, which ships to every user.

## GitHub issues

Issues for this work live on the fork, `jakehurst/ai-pair` (the `jakehurst` remote). `origin` is the upstream repository, `faiface/ai-pair`; do not file issues or push there.

- **Add what you find to the open issue it belongs to.** When work turns up a detail that is relevant to an open issue, add it as a comment on that issue, without asking first, so all discovered context is in one place when the issue is worked on. Say how each detail was verified (reproduced, measured, or from reading the code), and tell Justine which issues got a comment.
- This covers comments on existing open issues only. Closing an issue, changing its labels, or editing its body waits for Justine's word. Creating one follows the finding rule under Governance below (set by Justine on 2026-10-08; before that, creating one also waited for her word).
- **New issues** reference code as permalinks pinned to a commit, and carry one of the severity labels (`severity: critical`, `high`, `medium`, `low`) when they are findings, or `enhancement` when they are requests. An issue's body opens with one plain sentence saying what it is.
- **The issues are the knowledge surface.** Decisions, findings, and working notes live in the issues, not in a knowledge base in the repository (set by Justine on 2026-10-08, when asked whether to carry over the homelab repository's `kb/` bundle: "we're keeping knowledge in issues").

## Working notes while fixing an issue

- Keep notes as you work in `blueprints/notes/issue-<N>-<slug>.md`: the bug, the change and why, the test, every verification run with its result, the review, and anything noticed about the tool itself.
- The notes file is working memory while the issue is being worked: draw the commit message and the PR description from it. The issue is where the notes are kept for good. Once the fix is merged, or work on the issue stops, post the file verbatim as a comment on the issue (`gh issue comment <N> -R jakehurst/ai-pair --body-file <file>`), without asking first, then delete the local file (set by Justine on 2026-10-07).
- Never stage or commit the notes file, and do not mention it in the commit message.

## Findings from the TLA+ specs (#19)

Set by Justine on 2026-10-07.

- **Rule out a false positive first.** When TLC finds a violation, check the spec against the code before reporting it: every action and variable in the counterexample trace must match what the code does.
- **A finding that holds gets its own issue,** without asking first. Write the detailed findings, and say how it was found: the spec, the property, the config and bounds, and the counterexample trace.
- **Fix it spec first, then code.** First correct the spec until TLC passes both the safety and the liveness checks. Then change the code to match the corrected spec. Then confirm the code is fixed with unit and integration test coverage.

## New features

- **Spec first.** For a new feature, write its TLA+ spec first, so the mechanics are right, and check it with TLC; then write the code that follows the spec (set by Justine on 2026-10-07).

## Problems found along the way

- **Fix them inline.** A problem found while fixing or testing another one is fixed with it, in the same branch and PR, and described in its commit message; it doesn't get an issue of its own (set by Justine on 2026-10-07). This takes precedence over filing TLA+ findings separately, while a fix is under way.

## Code

- In test files, write the cursor marker as the escape `"\u{258c}"`, not as the literal character. Justine prefers the escape to a special character encoded in the file (2026-10-06).

## Versioning

Set by Justine on 2026-10-08. The extension's version is `version` in `packages/vscode/package.json`, and every change that ships bumps it, following semantic versioning as it applies to VS Code extensions:

- **Enhancement** (a new feature, or a feature extended): bump the second number (minor), and reset the third to 0.
- **Bug fix** (behavior corrected, nothing new): bump the third number (patch).
- **Major change to a feature** (a feature removed, or changed so that what users did before no longer works the same way): the first number (major) is Justine's call, not the agent's (set by Justine on 2026-10-09: "we're not 1.0.0 yet. I'll make the call on a major number"). Bump the minor number instead, and tell her the change would be major under these rules.
- **Changes forced by a VS Code upgrade:** if the code changes but the extension still runs on the same VS Code versions and behaves the same, it is a patch. If the change raises the minimum VS Code version (`engines.vscode`), it is a minor bump, since users on the older VS Code can no longer install it but nothing else changes for anyone. If it drops a feature that the old VS Code supported, it would be a major bump, which is Justine's call, as above.
- The `CHANGELOG.md` in `packages/vscode` gets a section for the new version with the change, in the same PR.

## Governance

Carried over from the homelab repository's governance (`~/workspace/homelab`, its `CLAUDE.md` and `kb/conventions/`), applied here by Justine on 2026-10-08: "I get to define the quality bar, not you." The agent does not lower any bar below; a step that looks heavy is done, or she is asked, never skipped on the agent's own judgment.

- **The issue exists first, and the branch is named for it:** `<type>/<issue>-<slug>`, with `<type>` one of `feat`, `fix`, `docs`, `chore`. Work found mid-branch that is not the issue's gets its own issue and branch, unless it is small (see findings below).
- **Naming an issue is the authorization for the whole cycle:** "fix 107", "take 107", or picking it from a list means the branch, the spec, the change, the tests, the docs, the version bump, the changelog, the PR, CI green, the squash-merge, the branch deleted, and the issue closed with the notes posted. Report once at the end, naming the merge commit and the closed issue. The one gate that holds is the global safety line: the push, the merge, and the branch deletion still happen on Justine's explicit word, asked for once, in one line, when the PR is ready.
- **Every change ships with its docs in the same PR:** `README.md`, `ARCHITECTURE.md`, `DESIGN.md`, `AGENT_GUIDE.md`, `specs/README.md`, and `specs/COVERAGE.md` as they apply, plus the changelog section and version bump under Versioning. Never "docs later".
- **Worktree per branch,** outside a pairing session: work on a branch happens in a worktree under `.claude/worktrees/<slug>/`, and the main checkout stays on `main`, moved only by fast-forward. In a pairing session the edits happen in the checkout the window has open, because the relay finds the window by its workspace folder; the branch is still named for the issue.
- **The spec bar,** for every TLA+ spec written or changed:
  1. The spec is written and checked before the code, per New features above. When code was written first by mistake, the spec is written next, before anything else, and the code is then changed to match it.
  2. **Every invariant is proved to bite.** For each invariant, change the model to the wrong design, confirm TLC produces a counterexample, then discard the mutation. The mutations and what each broke are listed in the spec's section of `specs/README.md`. A mutation that passes means the model does not cover the case: extend the model, or say so in the table.
  3. **At least one invariant says something must happen,** so a model of code that does nothing cannot pass.
  4. **Every invariant names the test that proves the code obeys it,** in a table in `specs/README.md`, and the test's name says which invariant it stands for. "Nothing yet" is allowed in the table, never left unsaid.
  5. The code that implements a spec's action carries a comment naming the spec and the action.
  6. The TLC run's result (config, bounds, distinct states, pass or violation) goes in the PR description, and in the results table of `specs/README.md`.
- **A finding is fixed where it is found, or filed.** Small (a stale line, a wrong path, a comment that no longer matches, a bug of a few lines in code the branch touches): fixed in the same branch and listed in the PR. Significant (needs its own tests or design, or sits in code the branch does not otherwise touch): an issue filed in the session that finds it, labeled, with a one-sentence summary, before the closing report. Filing is never offered back to Justine as a choice; a finding that is hers to decide is filed as a question.
- **Questions are questions.** A question from Justine, even one that seems to endorse an option, is answered, not executed. Work starts on a verb-first instruction.
- **Checkpoint commits:** uncommitted state found at the start of a session is committed untouched before the first change; each coherent change is committed on its own; an unrelated fix is never folded into a checkpoint.
