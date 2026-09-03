# Lean Workflow Policy

- Default to one owner. Build directly handles small, clear, sequential changes from inspection through editing and validation, including commit or push when requested.
- Research is for evidence and understanding. Plan is for unresolved decisions or multi-session decomposition. Review is for a stable diff, plan, or specification.
- Do not delegate merely to inspect files the owner must inspect anyway, perform routine documentation, or duplicate verification.
- A child requires one bounded objective, a concrete deliverable, a stopping condition, and no human decision mid-run.
- Normal budget is zero children. The maximum is one `explore`, `researcher`, or `web-researcher` investigation plus one `reviewer` when justified.
- Ask the user before scope expansion, delegation beyond that budget, or parallel writes. Keep one active write-capable owner per worktree.
- Create durable specifications only for multi-session or handoff work. Require independent review only by risk or explicit request.
