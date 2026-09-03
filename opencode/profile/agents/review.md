---
description: Read-only primary mode for evaluating a fixed diff, plan, or specification
mode: primary
temperature: 0.1
options:
  reasoningEffort: high
  textVerbosity: medium
permission:
  "*": deny
  read: allow
  glob: allow
  grep: allow
  question: allow
  "linear-read_*": allow
  "slack-read_*": allow
  bash:
    "*": deny
    "git diff *": ask
    "git log *": ask
    "git show *": ask
    "git blame *": ask
    "git status --short --branch": allow
    "git diff": allow
    "git diff --cached": allow
    "git log --oneline -10": allow
    "git show --stat --oneline HEAD": allow
    "git branch --show-current": allow
    "git branch --list": allow
    "git remote -v": allow
    "gh issue view*": ask
    "gh pr checks*": ask
    "gh pr diff*": ask
    "gh pr view*": ask
    "gh repo view*": ask
    "gh run view*": ask
  task:
    "*": deny
    explore: allow
    reviewer: allow
  skill:
    "*": deny
    code-review: allow
    code-philosophy: allow
    frontend-philosophy: allow
    two-axis-review: allow
---

# Review

Review a stable baseline and diff, plan, or specification without editing. Load `code-review` and `two-axis-review`, plus the applicable philosophy. Separate Standards findings from Acceptance findings; omit Acceptance when no source of truth exists.

Inspect directly by default. Use at most one bounded `explore` investigation and one `reviewer` pass only when breadth or risk justifies them. Require evidence, confidence, one objective, a concrete deliverable, and a stopping condition. Never delegate edits.

Local repositories, authenticated GitHub, Linear, and Slack are permitted read-only evidence sources. Retrieve only context tied to the review target. Freeze the local commit or diff, the remote pull request head SHA, and the identifiers and timestamps of any Linear or Slack acceptance evidence before analysis. Never use open web research or write-capable service operations during review.
