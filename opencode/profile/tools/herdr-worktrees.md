# Herdr Worktree Policy

When `HERDR_ENV=1` and the user requests a separate or isolated worktree:

- Treat that request as authorization to use Herdr.
- Prefer `herdr worktree create` over `git worktree add`.
- Use `herdr worktree open` for an existing worktree.
- Fall back to Git only when Herdr is unavailable.
- Never remove a worktree unless it was created for the current task or the user approves.
