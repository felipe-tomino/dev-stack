---
name: code-review
description: Risk-based Standards review for correctness, security, design, and long-term code health.
metadata:
  source: https://github.com/matthewmorek/ocx-profile-workcell/blob/77e6c5fef1941d113b21f63f4c4f7d74d2e086b5/files/skills/code-review/SKILL.md
  adaptation: Compact Standards-axis adaptation; see THIRD_PARTY_NOTICES.md
---

# Risk-based Standards review

Use this skill only for the Standards axis. `two-axis-review` owns baseline freezing, Acceptance comparison, evidence boundaries, and the combined report.

## Establish the review

1. Freeze and state the supplied scope.
2. Identify the intended contract and affected users or systems.
3. Rank the material risks before inspecting details.
4. Read enough surrounding code, tests, and repository guidance to evaluate the change in context.

## Review by risk

Prioritize the areas the change can materially affect:

1. Contract and behavior: correctness, compatibility, invariants, edge cases, and migration.
2. Design and complexity: change amplification, information hiding, state ownership, coupling, and unnecessary indirection.
3. Resilience: failure propagation, recovery, cleanup, concurrency, partial state, and observability.
4. Security and privacy: trust boundaries, authorization, injection, secrets, sensitive data, and dependency exposure.
5. Performance and operations: bounded work, resource use, latency, rollout, rollback, and diagnostics.
6. Tests, documentation, and naming where they affect confidence or maintainability.

Do not force every category onto every diff. Follow evidence and risk rather than a generic checklist.

## Finding classes

- **Confirmed finding:** Evidence establishes a defect or material risk. Assign `Critical`, `Major`, `Minor`, or `Nit` severity and `High`, `Medium`, or `Low` confidence. Only confirmed Critical or Major findings block approval.
- **Strong concern:** Evidence points to material risk but one fact remains unresolved. State the missing fact and how to verify it.
- **Investigation question:** Ask only when the answer can change the verdict or implementation direction.
- **Suggestion:** A non-defect improvement with a concrete benefit.
- **Nit:** An optional local polish item. Do not inflate it into a maintainability claim.

Each confirmed finding needs an exact anchor, observed behavior, impact, reasoning, and resolution direction. Keep uncertainty out of the confirmed list. Do not invent positive observations or fill empty sections.

## Standards output

Report:

1. Scope and material risk.
2. Standards verdict: `Approve`, `Changes requested`, or `Needs investigation`.
3. Confirmed findings, ordered by severity.
4. Strong concerns or investigation questions, when present.
5. Suggestions or nits, only when useful.
6. Short design assessment covering repository fit and complexity.

Review remains read-only unless the user separately requests implementation.
