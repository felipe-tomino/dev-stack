---
name: work-spec
description: Keep a proportionate session-local implementation contract with decisions, interfaces, risks, and verification.
metadata:
  source: https://github.com/mattpocock/skills
  adaptation: Original compact adaptation inspired by Matt Pocock's AI Hero workflow
---

# Work Spec

Source inspiration: https://github.com/mattpocock/skills

Create a concise session-local work spec for every implementation. Its job is to preserve accepted scope and decisions through execution and compaction, not to add ceremony. Scale detail with ambiguity, risk, duration, and the number of affected interfaces.

Use these sections when applicable. Write `None` with a short reason instead of manufacturing content.

## Goal
One measurable outcome.

## Non-goals
Explicit exclusions.

## Decisions and provenance
Record consequential decisions and whether each came from the user, repository evidence, or named research. Do not invent citations. User requests and explicit answers are accepted inputs; unresolved agent proposals remain draft decisions.

## Affected components and interfaces
Name files, modules, schemas, commands, permissions, external systems, and compatibility boundaries that may change.

## Decided behavior / acceptance
Observable behavior and acceptance evidence already decided.

## Constraints
Technical, safety, compatibility, and ownership boundaries.

## Migration, rollback, risks, and assumptions
State operational consequences proportionately. Keep unresolved assumptions visible.

## Test seam
The public seam and independent oracle, or `None` with the verification rationale.

## Ordered vertical slices
Small end-to-end outcomes in dependency order; each slice should be independently verifiable where practical.

## Verification
Exact checks that establish completion.

## Current state
Mark the active slice, completed evidence, blockers, and exact resume point.

Keep unresolved decisions visible instead of disguising them as tasks. Call these model-facing OpenCode tools directly: Build persists the complete current Markdown spec with `work_spec_write`, and `work_spec_read` returns the same root-session record to permitted primary and private/local child roles. Never probe for them with Bash or substitute a file. Update the record instead of appending partial fragments. Compaction injects the current record automatically. Never create a repository file as an automatic fallback.

Use `work_spec_read` when answering a request for persisted exact values, even when compacted context appears to contain them. Copy persisted literals and commands verbatim; do not reconstruct or correct them.

## Cross-session handoff

A cross-session or cross-owner handoff names its source identifier, owner, and the repository state or date against which it was accepted. Do not ask the user to approve the persisted wording separately when a clear low-risk request already authorizes implementation. Ask when unresolved decisions meet the profile's risk-based confirmation threshold.

Use one explicit transport:

- include the finalized spec verbatim in a user-requested workspace prefill; or
- when the user explicitly requests a repository artifact, place it at the repository's documented
  specification location.

Do not silently change accepted decisions during transport or compaction. Update implementation state and repository evidence without rewriting the user's intent. If repository state contradicts an accepted consequential decision, stop for a user decision.
