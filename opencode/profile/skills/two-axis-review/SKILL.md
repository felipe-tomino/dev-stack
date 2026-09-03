---
name: two-axis-review
description: Use for a fixed diff, plan, or spec to separate standards quality from acceptance fidelity with evidence and confidence.
metadata:
  source: https://github.com/mattpocock/skills
  adaptation: Original two-axis adaptation inspired by Matt Pocock's AI Hero workflow
---

# Two-Axis Review

Source inspiration: https://github.com/mattpocock/skills

Freeze the review baseline and scope before analysis. Do not edit or delegate.

## Standards axis

Evaluate correctness, security, performance, maintainability, and applicable project philosophy. Every finding needs exact evidence, impact, severity, and confidence.

## Acceptance axis

Compare the change against a named source of truth such as an accepted specification, issue, contract, or user-stated acceptance criteria. Report omissions, contradictions, and unsupported additions separately from Standards findings. Skip this axis explicitly when no source of truth exists; do not invent requirements.

Report only findings supported by the fixed baseline. Mark uncertainty as a question or investigation prompt rather than a defect. Never modify code, broaden scope, or start another agent.
