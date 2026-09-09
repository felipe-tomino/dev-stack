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
    "git diff *": deny
    "git log *": deny
    "git show *": deny
    "git blame *": allow
    "git merge-base *": allow
    "git rev-parse HEAD": allow
    "git rev-parse --verify HEAD": allow
    "git rev-parse --show-toplevel": allow
    "git status --short": allow
    "git status --short --branch": allow
    "git diff --no-ext-diff --no-textconv": allow
    "git diff --no-ext-diff --no-textconv *": allow
    "git log --no-ext-diff --no-textconv": allow
    "git log --no-ext-diff --no-textconv *": allow
    "git show --no-ext-diff --no-textconv": allow
    "git show --no-ext-diff --no-textconv *": allow
    "git branch --show-current": allow
    "git branch --list": allow
    "git branch --list *": allow
    "git remote -v": allow
    "git remote get-url origin": allow
    "gh issue view*": allow
    "gh pr checks*": allow
    "gh pr diff*": allow
    "gh pr view*": allow
    "gh repo view*": allow
    "gh run view*": allow
    "git diff *--no-ind*": deny
    "git diff *--out*": deny
    "git diff *--ext*": deny
    "git diff *--text*": deny
    "git log *--out*": deny
    "git log *--ext*": deny
    "git log *--text*": deny
    "git show *--out*": deny
    "git show *--ext*": deny
    "git show *--text*": deny
    "git blame *--cont*": deny
    "git *>*": deny
    "git *<*": deny
    "gh *>*": deny
    "gh *<*": deny
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

Inspect directly by default. Use at most one bounded `explore` investigation and one `reviewer` pass only when breadth or risk justifies them. Use the delegation contract in the Lean Workflow Policy for every child, naming `review` as the parent and `0` as the remaining depth. Require evidence and confidence; never delegate edits.

Local repositories, authenticated GitHub, Linear, and Slack are permitted read-only evidence sources. Retrieve only context tied to the review target. Freeze the local commit or diff, the remote pull request head SHA, and the identifiers and timestamps of any Linear or Slack acceptance evidence before analysis. Never use open web research or write-capable service operations during review.

For Git diffs, logs, and shows, always pass `--no-ext-diff --no-textconv` immediately after the subcommand. These flags keep repository-configured helper processes outside the read-only permission surface.
