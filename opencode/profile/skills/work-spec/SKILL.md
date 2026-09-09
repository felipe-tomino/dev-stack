---
name: work-spec
description: Use ONLY for multi-session, multi-person, or independently sliced work that needs a compact durable handoff specification.
metadata:
  source: https://github.com/mattpocock/skills
  adaptation: Original compact adaptation inspired by Matt Pocock's AI Hero workflow
---

# Work Spec

Source inspiration: https://github.com/mattpocock/skills

Create a durable work spec only when work crosses sessions or people, needs handoff, or contains independently executable slices. Do not create one for contained work and do not build artifact graphs, lifecycle states, or an OpenSpec-style process.

Use exactly these sections:

## Goal
One measurable outcome.

## Non-goals
Explicit exclusions.

## Decided behavior / acceptance
Observable behavior and acceptance evidence already decided.

## Constraints
Technical, safety, compatibility, and ownership boundaries.

## Test seam
The public seam and independent oracle, or `None` with the verification rationale.

## Ordered vertical slices
Small end-to-end outcomes in dependency order; each slice should be independently verifiable where practical.

## Verification
Exact checks that establish completion.

Keep unresolved decisions visible instead of disguising them as tasks. Return the spec in the conversation unless the user explicitly requests a file.

## Cross-session handoff

A spec is a handoff only after the user accepts it as final. Keep drafts in conversation. A finalized
handoff names its source identifier, owner, and the repository state or date against which it was
accepted.

Use one explicit transport:

- include the finalized spec verbatim in a user-requested workspace prefill; or
- when the user explicitly requests a repository artifact, place it at the repository's documented
  specification location.

Do not summarize, merge, or silently refresh a finalized spec during transport. If issue metadata or
repository state contradicts it, stop for a user decision. A replacement supersedes an earlier spec
only when the user identifies and accepts the replacement explicitly.
