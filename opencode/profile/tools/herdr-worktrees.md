# Herdr Worktree Policy

When `HERDR_ENV=1` and the user requests a separate or isolated worktree:

- Treat that request as authorization to use Herdr.
- Use the typed `herdr_worktree_*` tools. Never run raw Git worktree lifecycle commands or maintain a second worktree registry.
- Scope every operation to the current repository. The tools do not accept an arbitrary repository or worktree path.
- Create requires explicit branch, base, and complete accepted work-spec content. Herdr chooses the path and owns the workspace. The tool starts the stable `ws` launcher in the new workspace with the exact spec as a prefill so the new Build session can persist it before editing.
- Open identifies an existing worktree by branch. Without a work spec it only asks Herdr to open or focus that workspace. Supplying a complete work spec additionally starts Build in the workspace only when its sole pane is an idle shell.
- Keep focus unchanged unless the user explicitly asks to focus the destination.
- Remove only a linked worktree returned by Herdr for the current repository. Require the exact workspace ID as confirmation, refuse the source or current workspace, and never auto-remove after a partial create or launch failure.
- Treat Herdr command failures and malformed responses as failures. If creation succeeds but launch cannot be confirmed, report that the worktree was retained and give its branch, path, and workspace ID when available.
- Outside a Herdr-managed pane, fail closed and tell the user to run the operation inside Herdr. Do not fall back to Git.
