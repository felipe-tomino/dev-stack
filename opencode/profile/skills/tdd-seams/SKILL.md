---
name: tdd-seams
description: Use ONLY for observable behavior with an independent oracle; guides one public test seam through red, minimum green, and vertical slices.
metadata:
  source: https://github.com/mattpocock/skills
  adaptation: Original lean adaptation inspired by Matt Pocock's AI Hero workflow
---

# TDD Seams

Source inspiration: https://github.com/mattpocock/skills

Use this only when the requested behavior is externally observable and a test can decide correctness independently of the implementation. It is not mandatory for configuration, glue, documentation, dependency metadata, or mechanical edits.

1. Name the observable behavior and its independent oracle.
2. Choose one public seam: a public function, command, endpoint, component interaction, or other supported boundary. Avoid testing private implementation details.
3. Add one failing test that proves the next smallest behavior slice. Confirm it fails for the intended reason.
4. Write the minimum implementation that makes that test pass.
5. Refactor only while green, then repeat with the next vertical slice.

Prefer end-to-end vertical behavior over broad horizontal scaffolding. Stop using this workflow when no independent oracle exists; explain the alternate verification instead.
