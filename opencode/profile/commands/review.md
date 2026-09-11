---
description: Review a fixed change, revision, file, or directory
agent: review
subtask: false
---

Review `$ARGUMENTS` as a fixed read-only scope. Load `code-review` and `two-axis-review`, plus the applicable philosophy. Use `two-axis-review` as the authority for baseline freezing, Acceptance evidence, and the combined report; use `code-review` only for the Standards method.

Resolve the scope as follows:

- No arguments: review staged changes using `git diff --no-ext-diff --no-textconv --cached`.
- `recent`: freeze `HEAD` and review that commit with `git show --no-ext-diff --no-textconv`; this also works for an initial commit.
- Revision or range: resolve each endpoint to a commit SHA with safe read-only Git commands, then review only the represented diff.
- File: review its current contents and directly relevant context.
- Directory: review current source files under it, normally excluding generated, vendor, build-output, and lock files.

If the argument is ambiguous, choose the narrowest interpretation tied to the apparent change and state that interpretation. Never modify files or submit review state. Block only on confirmed Critical or Major Standards findings or material Acceptance failures.
