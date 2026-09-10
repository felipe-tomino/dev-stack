---
name: hunk-review
description: Pair with the user through an already-open Hunk review without changing source or submitting the review.
---

# Hunk Pair Review

Use this skill only when the user wants to pair through a live Hunk session. Hunk is the user's review surface; your findings are evidence, not approval.

## Connect to the intended review

1. Freeze the review target as required by the Review role.
2. Run `hunk session get --repo . --json` from the current project.
3. Confirm the returned repository is the current review target.
4. If multiple sessions match, ask the user to leave only the intended Hunk window open for this worktree. Session IDs and global session listing are intentionally unavailable because they could cross the project's repository boundary.
5. If no session exists, ask the user to run `/hunk-review` for working-tree changes or `/hunk-review-branch` for branch changes.

Never guess which Hunk window or repository the user means.

## Inspect progressively

Start with structure and notes, then request patch text only where evidence requires it:

```text
hunk session review --repo . --include-notes --json
hunk session context --repo . --json
hunk session review --repo . --include-patch --include-notes --json
hunk session comment list --repo . --type all --json
```

Use repository reads and safe Git commands to inspect surrounding code. Keep Standards findings separate from Acceptance findings as required by the Review role.

## Pair with the user

- Discuss a finding before changing the shared Hunk view.
- In primary Review only, navigate or add one clearly attributed agent comment with `--repo .` after the user approves the exact action. These commands require interactive permission confirmation.
- Keep each comment focused on one evidenced defect, risk, or question. Include why it matters; do not narrate obvious syntax.
- The independent Reviewer subagent reports findings to its parent and never changes Hunk session state.
- Never reload the session, batch-apply comments, remove or clear notes, edit source, stage changes, commit, or submit a remote review.

Conclude with agreed findings, unresolved questions, and checks the user should make before submitting their review to the author.
