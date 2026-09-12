# Workcell profile comparison and decision ledger

This document records the comparison between this repository's `ws` OpenCode profile and Matthew Morek's public [Workcell profile](https://github.com/matthewmorek/ocx-profile-workcell). It preserves the original findings separately from the decisions that follow.

## Status and ownership

- **Status:** Accepted source and deterministic integrations implemented; repeated live evaluation pending
- **Decision owner:** Repository maintainer
- **Comparison date:** 2026-09-11
- **Local baseline:** `daecebe3a5dac3f19ada8848fb543df3c71c3fe6` on `main`, plus the two pre-existing working-tree changes named below
- **Remote comparison point:** Workcell PR 19 head `c36ee1aaa06ca0dd57c5fcdbbcfe1d812d72589d`, merged as `77e6c5fef1941d113b21f63f4c4f7d74d2e086b5`
- **Pre-existing local changes:** `.opencode/opencode.jsonc` and `opencode/profile/permissions.test.mjs`

## Implementation progress

| Slice | Findings | State |
| --- | --- | --- |
| Policy and methodology foundation | `KEEP-03`, `ADOPT-01`–`ADOPT-05`, `ADOPT-07`, `ADOPT-08`, `CHANGE-02`, `CHANGE-03`, `REJECT-06` | Profile source and deterministic contracts implemented; repeated live evaluation pending |
| Session-local work-spec persistence | `OPTION-03`, `REJECT-03` | Root-scoped atomic storage, child reads, compaction injection, cleanup, permissions, and deterministic tests implemented; live compaction run pending |
| Installed-profile smoke and semantic fingerprints | `ADOPT-06`, `ADOPT-10` | Temporary-profile install smoke and opt-in OCX/OpenCode runtime fingerprints implemented and passing |
| Immutable GitHub source reads | `CHANGE-01` | Incompatible inherited MCP disabled; narrow commit, tree, and file-at-SHA plugin plus deterministic boundaries implemented; live tool run pending |
| OpenCode-to-Herdr worktree orchestration | `KEEP-04`, `REJECT-02` | Dedicated lifecycle design, typed Herdr routing, work-spec prefill, focus/removal/failure policy, and deterministic tests implemented; disposable Herdr run pending |
| DCP integration | `OPTION-04` | Exact `3.1.15` server/TUI pin, AGPL notice, conservative manual policy, package identity check, and server runtime smoke implemented; TUI retention run pending |
| Hybrid role result contracts | `ADOPT-09` | Single first-line Outcome contract and role-shaped reporting implemented; repeated child runs pending |
| Broader deterministic and behavioral evaluation | `KEEP-05` | Scenario corpus version 7 covers the accepted integrations; coordinated three-run evaluation pending |

Deferred model and role findings remain unchanged until the dedicated study. This table tracks implementation evidence without changing the accepted decision states below.

The Workcell evidence came from its README, pull-request inventory, and relevant profile diffs, especially PRs [6](https://github.com/matthewmorek/ocx-profile-workcell/pull/6), [8](https://github.com/matthewmorek/ocx-profile-workcell/pull/8), [12](https://github.com/matthewmorek/ocx-profile-workcell/pull/12), [14](https://github.com/matthewmorek/ocx-profile-workcell/pull/14), [15](https://github.com/matthewmorek/ocx-profile-workcell/pull/15), [17](https://github.com/matthewmorek/ocx-profile-workcell/pull/17), and [19](https://github.com/matthewmorek/ocx-profile-workcell/pull/19).

The Review role could freeze pull-request SHAs and inspect pull-request diffs, but its GitHub permissions did not expose a repository tree or file-content API. This was therefore a profile and architecture comparison, not a byte-for-byte comparison of both trees.

## Decision protocol

Each finding starts as `Pending`. Discuss findings individually and change the state only after an explicit decision.

| State | Meaning |
| --- | --- |
| `Pending` | Not decided |
| `Keep` | Preserve our current direction |
| `Change` | Adopt or adapt the finding; record the intended outcome |
| `Defer` | Revisit after the named evidence or condition exists |
| `Reject` | Deliberately decline the proposed direction |

For every resolved finding, replace the empty decision notes with the reason, resulting action, dependencies, and expected verification. Copying substantial Workcell text requires MIT attribution and an update to `THIRD_PARTY_NOTICES.md`.

The completed decision pass contains 18 changes, 5 retained directions, 9 deferred decisions, and 3 rejected directions. Deferred model and role decisions preserve the current configuration until their named study is complete.

## Comparison summary

The original assessment was to keep our architecture and import selected parts of Workcell's methodology. Our profile is stronger at lean ownership, private/public evidence boundaries, permission safety, behavior evaluation, and Herdr/Hunk integration. Workcell is stronger at engineering philosophy, risk-based review, proportional testing guidance, installed-profile verification, and reproducible distribution.

| Area | Our profile | Workcell | Original assessment |
| --- | --- | --- | --- |
| Implementation | One direct Build owner | Build delegates implementation, debugging, testing, documentation, and Git work | Keep direct ownership for normal work |
| Privileges | Trusted Build with constrained read-only helpers | Write and shell access split across specialist roles | Workcell isolates more privileges; ours loses less context |
| Research | Separate local, private, and public evidence zones | Internal Explore and external Researcher | Keep our stronger privacy boundary |
| Planning | Durable specs only for cross-session or handoff work | Shared persisted plans with provenance and compaction support | Keep the lean trigger; consider provenance ideas |
| Verification | Owner-run checks, optional review, permission tests, and manual behavior evaluations | Independent Tester/Reviewer flow and deep install/runtime smoke checks | Combine selectively according to risk |
| Review | Frozen baselines, Standards/Acceptance axes, and Hunk | Detailed risk- and design-based review methodology | Combine both approaches |
| Worktrees | Herdr owns lifecycle | Custom plugin, terminal integration, and state database | Keep Herdr as the owner |
| Distribution | Personal snapshot composed with upstream OCX components | Self-contained versioned OCX registry | Reconsider only if distribution becomes a goal |
| Runtime surface | Small repository-owned plugin set | Several bundled plugins and pinned dependencies | Keep the smaller surface unless evidence warrants growth |
| Models | Central model selection with per-role effort and verbosity | Explicit per-agent models and tested fingerprints | Keep central selection; test the resolved result |

## Current strengths to preserve

### KEEP-01 — Direct Build ownership

- **Finding:** Build owns contained work from inspection through editing and validation. Delegation starts at zero and remains bounded.
- **Evidence:** `agents/build.md:27-45` and `tools/lean-workflow.md:3-20`.
- **Why it matters:** One owner avoids context translation, extra model calls, latency, and ambiguous write ownership.
- **Workcell contrast:** Workcell's Build is an orchestrator that routes work to Coder, Debugger, Tester, Scribe, Reviewer, and Committer.
- **Original recommendation:** Preserve direct Build ownership rather than adopting an orchestrator-only default.
- **Decision:** `Defer`
- **Decision notes:** Keep direct Build ownership unchanged for now, but revisit the architecture during the dedicated Sol/Luna/Terra/Astra model-routing study recorded under `OPTION-07`. The study should test whether any model and role combination makes delegated implementation materially better than a direct primary owner after accounting for quality, context transfer, latency, cost, verification, and write ownership. Until that evidence exists, Build remains the sole normal implementation owner.

### KEEP-02 — Private and public evidence zones

- **Finding:** Explore reads the current repository, Researcher reads local/private sources, and Web Researcher reads public web sources. Public research cannot read private material.
- **Evidence:** `agents/explore.md`, `agents/researcher.md:68-74`, `agents/web-researcher.md:18-22`, and the `private-public-boundary` evaluation in `evals/scenarios.json`.
- **Why it matters:** Permission and prompt boundaries both reduce accidental disclosure of local or connected private data.
- **Workcell contrast:** Workcell separates internal Explore from external Researcher but has a less explicit prompt-sanitization protocol.
- **Original recommendation:** Preserve our evidence-zone architecture.
- **Decision:** `Defer`
- **Decision notes:** Preserve all three evidence roles for now, including Explore's narrow current-workspace permissions and evidence-backed step ceiling and the critical Researcher/Web Researcher disclosure boundary. Reopen the exact role split during the complete model and agent-architecture study. Any redesign must preserve private-to-public prompt sanitization and least-privilege evidence access even if Explore and Researcher are later merged or remapped.

### KEEP-03 — Frozen, two-axis review with Hunk support

- **Finding:** Review freezes its target, separates Standards findings from Acceptance findings, can use named private acceptance evidence, and supports constrained Hunk pair review.
- **Evidence:** `agents/review.md:96-104`, `agents/reviewer.md:88-94`, `skills/two-axis-review/SKILL.md`, and `skills/hunk-review/SKILL.md`.
- **Why it matters:** Review quality and requirement fidelity remain distinct, and interactive review does not grant source-editing power.
- **Workcell contrast:** Workcell has a stronger Standards methodology but no equivalent two-axis or Hunk architecture.
- **Original recommendation:** Preserve the architecture and replace only the Standards methodology.
- **Decision:** `Keep`
- **Decision notes:** Preserve the complete review architecture: freeze the exact local diff or remote SHA, assess engineering Standards, compare against a named Acceptance source only when one exists, and keep constrained Hunk pair-review separate from source edits and remote submission. Integrate the revised Standards methodology from `ADOPT-03` and the conventional command from `ADOPT-04` without weakening these boundaries.

### KEEP-04 — Herdr-owned worktree lifecycle

- **Finding:** Herdr owns workspace and worktree lifecycle while the repository provides profile refresh and Hunk integration.
- **Evidence:** `profile-sync.mjs`, `../tui-plugins/herdr-tui.js`, and `../tui-plugins/hunk-review.js`.
- **Why it matters:** Worktree state stays with the product already responsible for workspace lifecycle instead of being duplicated in OpenCode plugins.
- **Workcell contrast:** Workcell implements branch creation, deletion, terminal launch, SQLite state, session forking, plan copying, and cleanup itself.
- **Original recommendation:** Keep Herdr as the lifecycle owner and do not copy Workcell's worktree plugin.
- **Decision:** `Change`
- **Decision notes:** Move to OpenCode-led worktree orchestration while retaining Herdr as the lifecycle primitive and presentation owner. Add typed agent-facing operations that validate intent, repository, branch, base, isolation, and confirmation; persist or connect the session work spec; and call `herdr worktree create`, `open`, `list`, or `remove`. Herdr continues to create, display, and remove worktree workspaces. Do not run raw `git worktree` lifecycle commands or maintain a second worktree database in the profile. Define launch/prefill, focus, removal, failure, and non-Herdr behavior in a dedicated design before implementation.

### KEEP-05 — Permission tests and behavioral safety evaluations

- **Finding:** The profile tests effective permission ordering, Git and Hunk escape prevention, write ownership, external roots, delegation contracts, and public/private separation. Live evaluations add repeated behavioral safety checks.
- **Evidence:** `permissions.test.mjs`, `evals/README.md`, and `evals/scenarios.json`.
- **Why it matters:** Static policy assertions and model-behavior evaluation cover different failure modes.
- **Workcell contrast:** Workcell has deeper install/runtime automation but less explicit repeated behavior evaluation.
- **Original recommendation:** Keep these tests and combine them with a smaller form of Workcell's runtime smoke coverage.
- **Decision:** `Keep`
- **Decision notes:** Keep and expand the current combination of deterministic permission/runtime tests and repeated manually scored behavior evaluations. Add deterministic contracts for schemas, permission ordering, session-local persistence, semantic fingerprints, immutable GitHub reads, and OpenCode-to-Herdr routing. Add focused repeated scenarios for risk-based confirmation, compaction continuity, revised philosophy and review quality, DCP behavior under context pressure, and worktree orchestration. Use live evaluation only where no stable independent unit-test oracle exists, record runtime versions in external run evidence, and retain `incomplete` rather than treating missing evidence as a pass.

### KEEP-06 — Small custom runtime and dependency surface

- **Finding:** The main repository-owned profile plugin has a narrow Bash payload and directory-safety responsibility and uses Node built-ins.
- **Evidence:** `plugins/tool-execution-guard.js` and `tool-execution-guard.test.js`.
- **Why it matters:** A smaller runtime is easier to inspect, test, and maintain and introduces fewer supply-chain and compatibility concerns.
- **Workcell contrast:** Workcell bundles background delegation, plan persistence, notifications, worktrees, DCP, formatters, guards, and several dependencies.
- **Original recommendation:** Keep the smaller surface and add machinery only for an observed need.
- **Decision:** `Keep`
- **Decision notes:** Preserve the small-surface principle while adding the accepted capabilities. Each addition must have observed evidence, a narrow coherent interface, one clear owner, and focused deterministic or behavioral verification. Retain the Bash guard; prefer an existing trustworthy GitHub read integration; add a coherent session-work-spec owner; route worktrees through Herdr rather than raw Git; and integrate DCP explicitly. Do not copy Workcell's background-agent, metadata, notification, worktree-state, or broad workspace plugin graph. Avoid both shallow wrapper proliferation and a monolithic catch-all plugin.

### KEEP-07 — Central model selection

- **Finding:** The profile selects primary and small models centrally while role files tune reasoning effort, verbosity, and temperature.
- **Evidence:** `opencode.jsonc:3-6` and the agent frontmatter under `agents/`.
- **Why it matters:** Model changes do not require duplicated edits across every agent definition.
- **Workcell contrast:** Workcell pins models per agent and tests their fingerprints.
- **Original recommendation:** Keep central inheritance, but verify the resolved agent identities and options at runtime.
- **Decision:** `Defer`
- **Decision notes:** Preserve the current central Sol primary model and Luna small model until the dedicated model-routing study resolves this finding together with `OPTION-07`. Do not assign per-agent models before comparing Sol, Luna, Terra, and Astra across the current roles. After that study, retain central defaults unless an evaluated role-specific exception materially improves quality, context behavior, latency, or cost.

## Recommended adaptations

### ADOPT-01 — Repository-led code philosophy

- **Finding:** Workcell replaced the original five-law checklist with guidance centered on local repository conventions, contracts, complexity, information hiding, state ownership, effects, recovery, and change discipline.
- **Evidence:** Workcell PR 17, `files/skills/code-philosophy/SKILL.md`.
- **Why it matters:** Absolute rules such as always flattening control flow or preferring pure functions do not fit every transaction, lifecycle, cleanup, state-management, or integration problem.
- **Original recommendation:** Adapt Workcell's current code philosophy as a local override while preserving our mandatory loading mechanism.
- **Decision:** `Change`
- **Decision notes:** Adapt Workcell's repository-led complexity model into a shorter local skill rather than copying the full document. Preserve the useful five-law ideas as contextual heuristics, not universal rules. Add MIT attribution, keep the mandatory philosophy-loading mechanism, and verify the final skill against representative implementation scenarios before replacing the inherited version.

### ADOPT-02 — Repository-led frontend philosophy

- **Finding:** Workcell's revised frontend philosophy follows the existing product language first and emphasizes semantics, accessibility, interaction states, responsive behavior, recovery, and restrained reuse.
- **Evidence:** Workcell PR 17, `files/skills/frontend-philosophy/SKILL.md`.
- **Why it matters:** The original visual philosophy can push novelty, custom typography, motion, and decoration even when an established product needs consistency.
- **Original recommendation:** Adapt the revised frontend philosophy alongside the code philosophy.
- **Decision:** `Change`
- **Decision notes:** Adapt Workcell's repository-first frontend principles into a shorter local skill. Make product consistency, semantic controls, accessibility, responsive behavior, recovery, and relevant interaction states primary. Retain intentional, non-generic visual design as a subordinate principle used only when the product or task supports it. Add MIT attribution and verify the skill through representative frontend scenarios before replacing the inherited version.

### ADOPT-03 — Risk-based, design-aware Standards review

- **Finding:** Workcell's current review skill establishes scope, contract, and risk first; treats complexity as a defect category; and separates confirmed findings, strong concerns, investigation questions, suggestions, and nits.
- **Evidence:** Workcell PR 12, `files/skills/code-review/SKILL.md`.
- **Why it matters:** It produces fewer generic checklist comments and ties blocking findings to observed behavior, impact, reasoning, and a resolution direction.
- **Original recommendation:** Use this as our Standards axis while retaining frozen baselines, Acceptance review, private evidence rules, confidence, and Hunk.
- **Decision:** `Change`
- **Decision notes:** Adopt a hybrid review method. Replace the generic four-layer Standards checklist with a concise Workcell-derived risk and design assessment, including contract, complexity, information-hiding, resilience, security, and operational concerns. Preserve our frozen baseline, separate Acceptance axis, exact evidence, private-source controls, confidence judgment, and Hunk workflow. Use categorical confidence by default, block only confirmed Major or Critical findings, and do not require invented positive observations. Add attribution and compare the revised method against existing review scenarios.

### ADOPT-04 — Conventional review command

- **Finding:** Workcell provides a `/review` command that resolves staged changes, the latest commit, initial commits, revisions, paths, and directories into explicit review scopes.
- **Evidence:** Workcell PR 15, `files/commands/review.md`.
- **Why it matters:** Hunk is useful for interactive review, but a conventional command gives users a direct non-Hunk entry point.
- **Original recommendation:** Add an adapted command that uses safe Git flags, freezes its target, and loads both review axes.
- **Decision:** `Change`
- **Decision notes:** Add an adapted `/review` command for staged changes, the latest or initial commit, revisions and ranges, paths, and directories. The command must resolve and freeze its target, use the existing Review/Reviewer permission boundary and two-axis method, and avoid embedding a second review methodology. Keep `/hunk-review` and `/hunk-review-branch` as separate interactive entry points. Inspect current OpenCode command routing before choosing whether the command selects Review directly or instructs the active primary to delegate.

### ADOPT-05 — Proportional test-design guidance

- **Finding:** Workcell tells Coder to test meaningful contracts, regressions, security boundaries, persistence invariants, and integrations while avoiding tests for incidental markup, CSS, prop plumbing, framework behavior, and coverage targets.
- **Evidence:** Workcell `files/agents/coder.md`, especially its test-decision workflow.
- **Why it matters:** Our `tdd-seams` explains how to use a valid test seam but does not fully explain when adding tests is worthwhile.
- **Original recommendation:** Add compact testing philosophy guidance while keeping `tdd-seams` separate and optional.
- **Decision:** `Change`
- **Decision notes:** Add a separate compact `testing-philosophy` skill for deciding whether, where, and how to add or change tests. Load it for test design, not for merely running existing checks. Keep `tdd-seams` as the optional red-green-refactor workflow for observable behavior with an independent oracle. The new guidance should favor meaningful contracts and existing seams, reject coverage-driven or framework-detail tests, address deterministic versus model-driven behavior, and permit proportionate verification without a new test.

### ADOPT-06 — Lightweight installed-profile smoke verification

- **Finding:** Workcell builds and installs its profile in an isolated environment, verifies the installed files and dependencies, launches OpenCode, probes tool and agent identities, checks process liveness, and redacts diagnostics.
- **Evidence:** Workcell PRs 13, 14, and 16, especially `scripts/smoke-install.ts` and `tests/registry.test.ts`.
- **Why it matters:** Source-level permission tests cannot prove that the installed profile exposes the intended agents, tools, skills, and configuration.
- **Original recommendation:** Add a smaller smoke test for the resolved `ws` profile and stable launcher rather than copying the full release harness.
- **Decision:** `Change`
- **Decision notes:** Add two verification tiers. An always-available deterministic smoke test will synchronize the repository snapshot into a temporary profile and verify installed files, stable launcher behavior, agent definitions, skills, and configuration without credentials. An explicit opt-in runtime tier will use installed OCX/OpenCode binaries to inspect the resolved profile and verify expected agent, tool, model, and permission identities. Missing runtime prerequisites may skip only the default tier; an explicit runtime requirement must fail. Neither tier should depend on provider login or model-generated output.

### ADOPT-07 — Provenance and operational sections in durable work specs

- **Finding:** Workcell records whether a decision came from the user, repository evidence, or delegated research and includes interfaces, migration, rollback, risks, and assumptions in substantial plans.
- **Evidence:** Workcell PR 19, `files/skills/plan-protocol/SKILL.md` and the Plan prompt.
- **Why it matters:** It preserves the basis of consequential decisions without manufacturing research citations.
- **Original recommendation:** Add compact, conditional provenance and operational fields to `work-spec` without requiring durable plans for contained work.
- **Decision:** `Change`
- **Decision notes:** Expand work specs with `Decisions and provenance`, `Affected components and interfaces`, and `Migration, rollback, risks, and assumptions`, allowing `None` when genuinely inapplicable. Create a concise work spec for every implementation task, not only cross-session or handoff work, and scale its detail with scope and risk. The spec does not create an extra approval turn for clear low-risk work; risk-based confirmation still governs execution. Draft and accepted-state semantics must distinguish the user's request from unresolved design choices.

### ADOPT-08 — Selected communication guidance

- **Finding:** Workcell's profile guidance favors direct answers, reasoned disagreement, material assumption checks, cause-to-fix failure reporting, and one useful question when evidence blocks progress.
- **Evidence:** Workcell PR 8, `files/profiles/workcell/AGENTS.md`.
- **Why it matters:** These rules complement our Writing and No AI Slop skills and discourage empty agreement and repeated speculative debugging.
- **Original recommendation:** Adapt only the useful principles; do not import its arbitrary presentation constraints.
- **Decision:** `Change`
- **Decision notes:** Add one concise profile-wide communication instruction for all agents. It should start with the answer, action, or blocking question; challenge only material assumptions and explain why; avoid generic praise and superficial agreement; ask one focused question only when a missing decision blocks progress; report failures as cause and corrective direction; and request discriminating evidence after repeated failed debugging. Keep role-specific instructions local and retain Writing and No AI Slop for their existing jobs. Exclude mandatory time estimates, list-length limits, and forced recommendation menus.

### ADOPT-09 — Role-specific terminal evidence contracts

- **Finding:** Workcell's Coder, Debugger, Tester, Reviewer, and Committer return role-specific status, changed scope, exact commands and exit codes, failures, artifacts, limitations, and risks.
- **Evidence:** Workcell `files/agents/*.md`, with refinements in PR 19.
- **Why it matters:** Our common child outcome line is easy to route, but role-specific fields can make verification and blocker evidence more precise.
- **Original recommendation:** Preserve our canonical outcome prefix and selectively add fields where the parent needs stronger evidence.
- **Decision:** `Change`
- **Decision notes:** Use hybrid result contracts. Preserve exactly one canonical `Outcome` line for every child. Keep Explore and Researcher reports shaped by the bounded deliverable, and let Reviewer follow the review skill's structured output. Require exact commands, exit codes, decisive failures, artifacts, limitations, and confidence from any future Tester. Require changed scope and verification evidence from any future write-capable child. Do not force empty fields on roles that do not need them, and cover any machine-parsed contract with deterministic tests.

### ADOPT-10 — Resolved profile fingerprints

- **Finding:** Workcell tests resolved agent identities, models, options, prompts, permissions, tool availability, and profile ownership rather than relying only on source files.
- **Evidence:** Workcell `tests/registry.test.ts`, including the agent and tool probes expanded in PR 14.
- **Why it matters:** Central inheritance is easier to maintain, but it still needs tests proving the final merged configuration.
- **Original recommendation:** Add semantic assertions for our resolved profile. Avoid brittle whole-file hashes unless they protect a deliberate immutable contract.
- **Decision:** `Change`
- **Decision notes:** Add semantic fingerprints to the two-tier smoke design. Assert expected agent names and modes, inherited model and role-specific options, allowed and denied tool classes, required skills and instructions, external-directory boundaries, plugin discovery, and launcher identity. Avoid whole-prompt and whole-permission hashes unless a small contract is intentionally immutable. Continue verifying prompt behavior through the versioned evaluation corpus.

## Current profile changes to consider

### CHANGE-01 — Read-only GitHub tree and content access for Review

- **Finding:** Review says authenticated GitHub is an allowed evidence source, but its command permissions cannot retrieve a repository tree or file at a frozen commit and cannot delegate that lookup to Researcher.
- **Evidence:** `agents/review.md:16-44` and `agents/review.md:102`; this limitation prevented a byte-for-byte remote comparison.
- **Impact:** A remote repository review can be incomplete even when the policy says the evidence source is permitted.
- **Original recommendation:** Add a narrow read-only capability for commit lookup, tree listing, and file contents at a named SHA. Do not broadly allow arbitrary `gh api` calls or output redirection.
- **Decision:** `Change`
- **Decision notes:** Add immutable GitHub source access through a dedicated typed read-only tool rather than broad `gh api` permissions. First investigate whether a trustworthy existing GitHub integration provides commit lookup, tree listing, and file-at-SHA reads with the required boundary. Build a narrow local plugin only if necessary. Reject branch-only reads, arbitrary endpoints, non-GET methods, request bodies, file output, redirects, and service writes. Make frozen commit identity explicit in every operation and cover the permission and data-flow boundary with deterministic tests.

### CHANGE-02 — Mandatory Build approach confirmation

- **Finding:** Build must ask for confirmation before every implementation, including a clear and low-risk request that already states the desired change.
- **Evidence:** `agents/build.md:31-35`, compared with the direct-owner principle in `tools/lean-workflow.md:3-5`.
- **Impact:** The rule forces an extra turn for the routine work that Build is intended to handle directly.
- **Original recommendation:** Require confirmation for consequential ambiguity, destructive or externally visible actions, material scope changes, and real design alternatives. Treat a clear low-risk request as implementation authorization while keeping commit, push, and publication authorization separate.
- **Decision:** `Change`
- **Decision notes:** Replace unconditional confirmation with risk-based confirmation. A clear, low-risk implementation request authorizes the requested workspace changes, so Build may proceed after enough inspection to understand them. Stop for consequential ambiguity, destructive or irreversible actions, external side effects, material architecture choices, scope expansion, changed assumptions or risk, or when the user asks to review the approach first. Commit, push, pull-request, publication, and non-declared external-path authorization remain separate. Add evaluation cases for direct execution and required confirmation.

### CHANGE-03 — Project `CLAUDE.md` composition

- **Finding:** Our OCX profile excludes project `CLAUDE.md` files, while Workcell changed to include them as project guidance.
- **Evidence:** `ocx.jsonc:7-10` and Workcell PR 8, `files/profiles/workcell/ocx.jsonc`.
- **Impact:** Repositories that keep important instructions only in `CLAUDE.md` will not contribute them to our composed profile. Including them may also introduce duplicate or conflicting instructions.
- **Original recommendation:** Decide intentionally based on the repositories we use; do not copy Workcell's choice automatically.
- **Decision:** `Change`
- **Decision notes:** Include project `CLAUDE.md` by default as OpenCode's fallback when no project `AGENTS.md` exists. Current OpenCode behavior selects the first available instruction-file type rather than loading both as ranked layers: `AGENTS.md` is selected before `CLAUDE.md`. Profile and selected project instructions are combined, but textual order is not a dependable conflict-resolution mechanism, so guidance must remain complementary. Remove the global `CLAUDE.md` exclusion and add fixtures proving lone-`CLAUDE.md` loading, `AGENTS.md` selection when both exist, and continued profile-instruction loading. Treat this behavior as version-sensitive and cover the pinned or tested OCX/OpenCode baseline.

### CHANGE-04 — Supported toolchain baseline

- **Finding:** Our snapshot records selected models but intentionally does not pin application versions. Workcell names and tests a supported Apple Silicon macOS, Bun, OpenCode, and OCX baseline.
- **Evidence:** `../../README.md:21-24` and Workcell README's support-baseline section.
- **Impact:** The snapshot has lower maintenance obligations but weaker reproducibility and less precise failure diagnosis after upstream changes.
- **Original recommendation:** Consider documenting a tested baseline or recording versions in smoke evidence without promising a fully supported installer.
- **Decision:** `Keep`
- **Decision notes:** Keep OCX and OpenCode unpinned and do not publish a supported or last-tested version baseline in the repository. The profile remains a current upstream-tracking snapshot rather than a reproducible installer contract. Runtime smoke and evaluation records should capture the versions they actually exercised so failures remain diagnosable, but those run records stay outside the public snapshot as currently documented. Version-sensitive behavior such as instruction discovery must be tested semantically against the active runtime rather than assumed from a pinned version.

## Optional architecture

### OPTION-01 — Independent Tester for high-risk work

- **Finding:** Workcell requires an independent Tester after implementation; our Build validates its own work and can request an independent Reviewer according to risk.
- **Benefit:** Independent execution separates implementation claims from command evidence.
- **Cost:** More handoffs, model calls, latency, permission design, and result-routing logic.
- **Original recommendation:** Consider a constrained Tester only for high-risk work or after evaluations show repeated self-verification failures.
- **Decision:** `Defer`
- **Decision notes:** Do not add a Tester yet. Reopen it as part of the complete model and agent-architecture study, which must evaluate independent command execution, shell and artifact boundaries, false-completion detection, latency, cost, and coordination overhead. The two-tier smoke and behavior evaluations should preserve evidence relevant to that comparison.

### OPTION-02 — Specialist Committer

- **Finding:** Workcell isolates staging, atomic commit construction, push, and pull-request creation in a Committer agent with separate authorization for each Git action.
- **Benefit:** The role has focused history-building rules and cannot edit source.
- **Cost:** It must receive enough context to classify mixed changes and may repeat Git inspection that Build already performs.
- **Original recommendation:** Copy useful authorization and staging rules into Build unless observed commit-quality problems justify a separate role.
- **Decision:** `Defer`
- **Decision notes:** Keep commit and publication ownership with Build for now, while refining its durable Git rules for separate authorization, explicit staging, unrelated-change preservation, cached-diff inspection, atomic intent, and truthful verification evidence. Reopen the Committer role during the complete model and agent-architecture study and compare history quality, permission isolation, context handoff, latency, and cost.

### OPTION-03 — Shared plan persistence and compaction injection

- **Finding:** Workcell stores one root-session plan for child sessions, injects it during compaction, and references task sections rather than copying the plan into every handoff.
- **Benefit:** Long orchestration sessions retain an accepted design reference with less prompt duplication.
- **Cost:** A plugin, storage lifecycle, schema, synchronization rules, and failure handling are required.
- **Original recommendation:** Keep conversational or explicit-file work specs unless plans are demonstrably being lost or repeatedly recopied.
- **Decision:** `Change`
- **Decision notes:** Add session-local work-spec persistence outside the repository, scoped to the project and root session. Child sessions should read the same accepted spec, and compaction should inject it so task context survives without copying the full artifact into prompts. Repository spec files remain explicit user-requested artifacts rather than the default. The implementation must define storage lifecycle, root-session resolution, atomic writes, missing or invalid state behavior, compaction behavior, and cleanup without weakening direct Build ownership.

### OPTION-04 — DCP context pruning

- **Finding:** Workcell pins DCP in both profile and TUI configuration and verifies its exact runtime source.
- **Benefit:** It may reduce context growth during long sessions.
- **Cost:** It adds an AGPL runtime dependency, package resolution, TUI precedence concerns, compatibility work, and smoke-test obligations.
- **Original recommendation:** Evaluate only against measured context pressure, latency, cost, and answer quality.
- **Decision:** `Change`
- **Decision notes:** Adopt DCP now. The decision is based on observed hallucinations when sessions approach roughly half of the available context, rather than on Workcell's use alone. Integrate DCP without displacing the existing Herdr and Hunk TUI plugins; select and review an exact compatible DCP release and its license during implementation; verify the effective profile/TUI source and runtime loading; and add smoke coverage for installation, precedence, and failure diagnostics. Add repeated near-context-pressure evaluation scenarios so continued use depends on factual retention and safety rather than installation success alone.

### OPTION-05 — Background metadata enrichment

- **Finding:** Workcell can generate model-written delegation titles and descriptions, but PR 19 changed this to an explicit opt-in while retaining deterministic fallback metadata.
- **Benefit:** Richer labels may help when many background delegations exist.
- **Cost:** Extra model calls, result disclosure to the metadata model, asynchronous state, and failure handling.
- **Original recommendation:** Do not add it for our bounded delegation volume.
- **Decision:** `Defer`
- **Decision notes:** Keep deterministic delegation identifiers and task-derived labels for now. Reopen the Metadata role during the complete model and agent-architecture study so the full topology is evaluated consistently. Any proposal must justify additional model calls, excerpt disclosure, asynchronous state, failure handling, and cost against a demonstrated navigation or coordination benefit.

### OPTION-06 — Self-contained OCX registry

- **Finding:** Workcell publishes a versioned profile registry with pinned dependencies, installation, update, rollback, CI, smoke tests, and releases. Our repository is explicitly a personal snapshot composed partly from upstream OCX components.
- **Benefit:** Reproducible external installation and controlled releases.
- **Cost:** Packaging, release automation, compatibility support, dependency updates, provenance management, and migration obligations.
- **Original recommendation:** Reconsider only if distributing and supporting the profile becomes a product goal.
- **Decision:** `Keep`
- **Decision notes:** Keep the repository as a personal upstream-tracking snapshot rather than a self-contained OCX registry. Improve local synchronization, restoration, semantic fingerprints, and smoke verification without adding public packaging, versioning, release, migration, rollback, or support obligations. Reopen only if reproducible distribution to other users becomes an explicit product goal.

### OPTION-07 — Explicit per-agent model pins

- **Finding:** Workcell declares models on individual agents and tests their fingerprints; our agents inherit the central profile model unless they need different execution options.
- **Benefit:** Every role's model identity is explicit and independently pinned.
- **Cost:** Model changes are duplicated and can drift across files.
- **Original recommendation:** Keep central inheritance and test the resolved result unless a role needs a genuinely different model.
- **Decision:** `Defer`
- **Decision notes:** Defer changes to a dedicated model and agent-architecture study using OpenAI's current public model documentation. The current profile centrally configures Sol as `model` and Luna as `small_model`; no tracked agent explicitly selects Luna, and Terra and Astra are not represented in the profile. The study must compare Sol, Luna, Terra, and Astra across both model routing and the complete role topology, including current and potential primary, research, implementation, debugging, testing, review, documentation, Git, and metadata roles. Evaluate capability, quality, context behavior, latency, cost, permission isolation, and coordination. Do not add a third central model concept without confirming OpenCode supports and needs it.

## Directions originally recommended against

### REJECT-01 — Orchestrator-only Build by default

- **Finding:** Workcell's primary Build cannot inspect files, edit, or run shell commands and must route implementation through specialist children.
- **Reason against:** It adds context translation and coordination overhead to contained work and conflicts with our single-owner philosophy.
- **Original recommendation:** Reject as the default; retain bounded delegation for missing evidence and independent review.
- **Decision:** `Defer`
- **Decision notes:** Prohibit orchestrator-only Build for now, but defer permanent rejection until the Sol/Luna/Terra/Astra model study evaluates it against direct ownership. Any change must show materially better implementation quality or safety after accounting for context transfer, latency, cost, verification, permission boundaries, and coordination failures. Direct Build remains the active architecture until that evidence exists.

### REJECT-02 — Duplicate worktree/session lifecycle plugin

- **Finding:** Workcell owns worktrees, terminal launch, session state, and cleanup inside OpenCode plugins.
- **Reason against:** Herdr already owns this concern in our stack, so another implementation would duplicate policy and state.
- **Original recommendation:** Reject unless Herdr cannot provide a required lifecycle operation.
- **Decision:** `Reject`
- **Decision notes:** Reject a profile-owned raw Git worktree implementation and second lifecycle database. OpenCode may orchestrate validated typed operations, but Herdr remains responsible for worktree creation, opening, presentation, and removal. Reopen only if a concrete required operation cannot be expressed through Herdr and the benefit justifies owning branch, path, recovery, reconciliation, terminal, and deletion semantics.

### REJECT-03 — Mandatory plans for contained work

- **Finding:** A plan-first workflow can create durable artifacts and coordination steps for changes one owner can complete directly.
- **Reason against:** The artifact can cost more to create and maintain than the task itself.
- **Original recommendation:** Keep durable work specs limited to cross-session, handoff, or independently sliced work.
- **Decision:** `Change`
- **Decision notes:** Supersede the original recommendation against mandatory plans. Every implementation task should receive a concise session-local work spec so its accepted scope and decisions survive compaction. Contained work gets a minimal spec rather than a repository artifact or a multi-phase planning ceremony. Clear low-risk requests may proceed under the risk-based confirmation decision without asking the user to approve the persisted wording separately.

### REJECT-04 — Mandatory Tester and Reviewer for every change

- **Finding:** Workcell normally routes ready implementation through independent verification and review.
- **Reason against:** Configuration, documentation, glue, and mechanical edits do not always justify two additional agents.
- **Original recommendation:** Apply independent verification and review according to risk or explicit request.
- **Decision:** `Reject`
- **Decision notes:** Reject a universal Tester and Reviewer mandate. The session-local work spec should name verification and independent-review needs according to observable behavior, risk, failure impact, and explicit user requests. Configuration, documentation, glue, and mechanical edits do not automatically require extra agents. Preserve risk-based independent review and the deferred evidence trigger for any future Tester.

### REJECT-05 — All specialist agents without observed need

- **Finding:** Workcell defines separate Coder, Debugger, Tester, Scribe, Committer, Metadata, Explore, Researcher, and Reviewer roles.
- **Reason against:** Each role adds permissions, prompts, routing rules, tests, maintenance, and handoff failure modes.
- **Original recommendation:** Add a role only when a repeated workflow problem gives it a clear boundary and measurable benefit.
- **Decision:** `Defer`
- **Decision notes:** Defer the complete role architecture to the Sol/Luna/Terra/Astra study rather than permanently rejecting specialist agents now. Preserve the current role set and deterministic metadata in the meantime. Reopen every role boundary in the study, including Build, Plan, Research, Review, Explore, Researcher, Web Researcher, Reviewer, Coder, Debugger, Tester, Scribe, Committer, Metadata, and any proposed replacement. Evaluate each boundary and the combined orchestration cost rather than assuming the Workcell set should be adopted together.

### REJECT-06 — Mandatory Gitmoji commit policy

- **Finding:** Workcell's Committer requires a Gitmoji and conventional type/scope format for every commit.
- **Reason against:** This is a repository taste choice, not a general correctness or safety improvement.
- **Original recommendation:** Follow the current repository's commit style unless the maintainer deliberately adopts another convention.
- **Decision:** `Change`
- **Decision notes:** Adopt Conventional Commits without Gitmoji. Use a standard `type(scope): description` header, with scope optional, the breaking-change marker and footer when applicable, and a body only for durable rationale, migration, risk, or non-obvious trade-offs. Keep subjects concise and imperative and preserve atomic intent. Update Build's commit guidance and future commit-related evaluations to follow the new convention; do not import Workcell's emoji requirement or project-specific type list without separate justification.

### REJECT-07 — Arbitrary communication constraints

- **Finding:** Workcell's communication guidance asks for concrete time estimates, limits lists to five items, and often asks the user to choose from a recommendation outline before expansion.
- **Reason against:** These rules can force inaccurate estimates, split naturally coherent material, and add questions when a safe direct action exists.
- **Original recommendation:** Reject these constraints while considering Workcell's directness and anti-sycophancy principles under `ADOPT-08`.
- **Decision:** `Reject`
- **Decision notes:** Reject mandatory time estimates, fixed list-length limits, forced recommendation outlines or menus, and required sub-two-minute closing actions. Let response structure and length follow the task. Implement only the shared directness, reasoned disagreement, focused-question, cause-to-fix, and evidence-request guidance accepted under `ADOPT-08`.

## Discussion order

The default order starts with the changes most likely to improve every implementation and review without altering the runtime architecture:

1. `ADOPT-01` through `ADOPT-05`
2. `ADOPT-06`, `ADOPT-10`, and `CHANGE-01`
3. `CHANGE-02` through `CHANGE-04`
4. `ADOPT-07` through `ADOPT-09`
5. `OPTION-01` through `OPTION-07`
6. `KEEP-01` through `KEEP-07`
7. `REJECT-01` through `REJECT-07`

Accepted changes will be grouped into separate implementation slices only after the relevant decisions are recorded. This ledger does not itself authorize profile edits, commits, pushes, or publication.
