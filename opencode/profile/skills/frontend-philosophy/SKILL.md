---
name: frontend-philosophy
description: Repository-led UI guidance for accessible, state-complete interfaces that fit the product.
metadata:
  source: https://github.com/matthewmorek/ocx-profile-workcell/blob/77e6c5fef1941d113b21f63f4c4f7d74d2e086b5/files/skills/frontend-philosophy/SKILL.md
  adaptation: Compact repository-specific adaptation; see THIRD_PARTY_NOTICES.md
---

# Repository-led frontend design

Build interfaces in the product's existing visual and interaction language. Distinctive design supports the user task and product character; it does not override established patterns for novelty.

## Decision order

1. Identify the user task, context, and success or recovery path.
2. Inspect the local design system, components, tokens, layout patterns, accessibility utilities, and tests.
3. Choose native semantics and established components before creating a new primitive.
4. Define relevant loading, empty, error, disabled, success, destructive, and partial-data states.
5. Verify keyboard, assistive-technology, responsive, zoom, contrast, and reduced-motion behavior.
6. Refine visual hierarchy and character within those constraints.

## Interaction and composition

- Make system status visible and actions predictable. Preserve user control, cancellation, undo, or recovery where the workflow needs it.
- Use semantic controls with correct names, labels, focus order, and focus restoration. Do not replace a native control with a styled container.
- Treat shared components as behavior and accessibility contracts, not visual wrappers. Reuse them when the contract fits; avoid forcing unrelated behavior through one component.
- Design for narrow and wide viewports, content growth, localization, zoom, and input methods represented by the product.
- Use motion to explain state or continuity. Respect reduced-motion settings and avoid decorative movement that obscures feedback.
- Add typography, color, spacing, and depth through existing tokens first. Introduce a new visual direction only when the task or product language calls for it.

## Verification checklist

- [ ] The UI follows nearby product patterns or documents a necessary departure.
- [ ] Semantic controls, keyboard behavior, labels, and focus are correct.
- [ ] Relevant interaction, failure, empty, loading, and destructive states are complete.
- [ ] Layouts work at supported widths, zoom levels, and content sizes.
- [ ] Contrast and reduced-motion behavior are appropriate.
- [ ] Repository-standard UI checks pass.
