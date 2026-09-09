# Lean Workflow Policy

- Default to one owner. Build directly handles small, clear, sequential changes from inspection through editing and validation, including commit or push when requested.
- Research is for evidence and understanding. Plan is for unresolved decisions or multi-session decomposition. Review is for a stable diff, plan, or specification.
- Do not delegate merely to inspect files the owner must inspect anyway, perform routine documentation, or duplicate verification.
- Every child request is a delegation contract. It must name one bounded objective, a concrete
  deliverable, a stopping condition, allowed source and tool scope, the parent role, and the remaining
  delegation depth. A child must not need a human decision mid-run.
- Every child result starts with exactly one terminal outcome line:
  - `Outcome: completed`
  - `Outcome: blocked`
  - `Outcome: needs-parent-decision`
  It then supplies only the requested deliverable and evidence needed to act on that outcome.
  Unsupported work is reported as `Outcome: blocked` rather than silently broadened or degraded.
- Normal budget is zero children. The maximum is one `explore`, `researcher`, or `web-researcher` investigation plus one `reviewer` when justified.
- Ask the user before scope expansion, delegation beyond that budget, or parallel writes. Keep one active write-capable owner per worktree.
- Do not add parallel-work lane metadata by default. Introduce it only after observed collisions,
  unclear ownership, or orphaned worktrees justify tracking owner, purpose, base revision, affected
  areas, validation, integration, and cleanup state.
- Create durable specifications only for multi-session or handoff work. Require independent review only by risk or explicit request.
