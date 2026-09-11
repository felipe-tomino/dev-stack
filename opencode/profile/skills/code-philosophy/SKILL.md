---
name: code-philosophy
description: Repository-led code design guidance for preserving contracts and reducing complexity.
metadata:
  source: https://github.com/matthewmorek/ocx-profile-workcell/blob/77e6c5fef1941d113b21f63f4c4f7d74d2e086b5/files/skills/code-philosophy/SKILL.md
  adaptation: Compact repository-specific adaptation; see THIRD_PARTY_NOTICES.md
---

# Repository-led code design

Use the repository's own contracts, architecture, naming, dependencies, tests, and nearby patterns as the default design language. Depart from them only to address a material correctness, security, operational, or complexity problem, and explain the trade-off.

## Design order

1. Establish the observable contract and the smallest affected boundary.
2. Inspect the nearest applicable repository guidance and implementation patterns.
3. Compare consequential designs with at least one credible alternative.
4. Choose the design that limits change amplification, cognitive load, and unknown behavior.
5. Verify the contract at the strongest practical seam.

## Complexity and boundaries

- Prefer coherent modules that hide decisions and expose a small stable interface. Reject pass-through wrappers and abstractions that only move code.
- Parse untrusted input at boundaries. Keep internal state valid by construction where practical, without forcing a new type or abstraction when the repository has a clearer convention.
- Make state and side-effect ownership explicit. Pure transformations are useful, but transactions, lifecycle work, cleanup, and integration boundaries may need local mutation or structured control flow.
- Use guards when they clarify exceptional paths. Do not flatten control flow when nesting expresses an atomic operation or required cleanup more clearly.
- Recover only where the caller can make a meaningful decision. Otherwise propagate a precise failure with enough context to diagnose it. Do not hide invalid state behind a fallback.
- Name domain concepts directly. Comment contracts, invariants, and non-obvious rationale rather than narrating syntax.

## Change discipline

- Keep the patch tied to the requested outcome. Avoid speculative reuse, opportunistic cleanup, and new dependencies without evidence.
- Preserve compatibility unless the accepted change explicitly includes migration or breakage.
- Test meaningful behavior, regressions, and boundaries. Follow the repository's existing seams before inventing a new one.

## Verification checklist

- [ ] Repository guidance and nearby patterns were inspected.
- [ ] The observable contract and affected boundary are explicit.
- [ ] Complexity is hidden rather than redistributed.
- [ ] State, effects, errors, cleanup, and recovery have clear owners.
- [ ] New abstractions or dependencies have a concrete benefit.
- [ ] Verification covers the requested behavior at an appropriate seam.
