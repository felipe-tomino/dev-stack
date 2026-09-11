---
name: testing-philosophy
description: Decide whether, where, and how to test meaningful behavior proportionately.
metadata:
  source: https://github.com/matthewmorek/ocx-profile-workcell/blob/77e6c5fef1941d113b21f63f4c4f7d74d2e086b5/files/agents/coder.md
  adaptation: Compact test-design adaptation; see THIRD_PARTY_NOTICES.md
---

# Proportional test design

Load this skill when deciding whether or how tests should change. Merely running existing checks does not require it. Load `tdd-seams` separately only when observable behavior has an independent oracle and a red-green-refactor loop will improve the implementation.

## Choose the evidence

1. Name the behavior or contract that could regress.
2. Use the nearest stable public seam and the repository's existing test style.
3. Prefer deterministic evidence for logic, schemas, permissions, security boundaries, persistence invariants, and integrations with controlled substitutes.
4. Use repeated behavioral evaluation for model behavior or other outcomes without a stable deterministic oracle.
5. Match the test depth to failure impact, change risk, and maintenance cost.

Add or change a test when it protects meaningful behavior, reproduces a defect, checks a trust boundary, preserves persisted state, or verifies an integration contract. Avoid tests that only freeze incidental markup, CSS values, prop plumbing, private implementation details, framework behavior, or a coverage target.

A change may need no new test when existing checks cover the contract, the edit is mechanical or documentary, or the only available assertion would be brittle and low-value. Record the verification rationale instead of manufacturing a test.

## Test quality

- Keep setup smaller than the behavior it proves.
- Make failures identify the broken contract.
- Control time, randomness, network access, and external state.
- Assert observable outcomes rather than internal call choreography unless the calls are the contract.
- Cover the highest-risk success, boundary, and failure paths without multiplying equivalent cases.

## Verification checklist

- [ ] The test protects a named contract or regression.
- [ ] The seam and oracle are stable and independent.
- [ ] The evidence type matches deterministic or model-driven behavior.
- [ ] The test avoids incidental implementation detail.
- [ ] Omitting a new test, when appropriate, has a concrete verification rationale.
