import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runDeterministicSmoke, runRuntimeSmoke } from "./profile-smoke.mjs";

test("deterministic smoke installs and fingerprints the repository profile", async (t) => {
	const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "profile-smoke-test-"));
	t.after(() => rm(temporaryRoot, { recursive: true, force: true }));

	const result = await runDeterministicSmoke({
		repositoryRoot: path.resolve(import.meta.dirname, ".."),
		temporaryRoot,
	});

	assert.equal(result.tier, "deterministic");
	assert.equal(result.profile.defaultAgent, "build");
	assert.equal(result.profile.model, "openai/gpt-5.6-sol");
	assert.equal(result.profile.smallModel, "openai/gpt-5.6-luna");
	assert.deepEqual(result.agents, [
		"build",
		"explore",
		"plan",
		"research",
		"researcher",
		"review",
		"reviewer",
		"web-researcher",
	]);
	assert.ok(result.skills.includes("testing-philosophy"));
	assert.ok(result.commands.includes("review"));
	assert.ok(result.plugins.includes("session-work-spec"));
	assert.ok(result.plugins.includes("tool-execution-guard"));
	assert.equal(result.dependencies.dcp, "3.1.15");
	assert.equal(result.dependencies.openCodePlugin, "1.4.3");
	assert.equal(result.dependencies.zod, "4.1.8");
	assert.equal(result.dcp.package, "@tarquinen/opencode-dcp@3.1.15");
	assert.match(result.dcp.serverRegistration, /\/node_modules\/@tarquinen\/opencode-dcp\/dist\/index\.js$/);
	assert.equal(result.dcp.tuiRegistration, result.dcp.package);
	assert.equal(result.dcp.manualMode, true);
	assert.equal(result.dcp.automaticStrategies, false);
	assert.equal(result.launcher.executable, true);
	assert.equal(result.files.mismatched, 0);
});

test("runtime smoke fingerprints resolved OpenCode and OCX semantics", async (t) => {
	const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "profile-runtime-test-"));
	t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
	const deterministicResult = await runDeterministicSmoke({
		repositoryRoot: path.resolve(import.meta.dirname, ".."),
		temporaryRoot,
	});
	const calls = [];
	let dependenciesInstalled = false;
	const execute = async (command, arguments_) => {
		calls.push([command, ...arguments_]);
		if (command === "ocx") {
			return {
				stdout: JSON.stringify({
					profileName: "ws",
					opencode: {
						default_agent: "build",
						model: "openai/gpt-5.6-sol",
						small_model: "openai/gpt-5.6-luna",
						plugin: [deterministicResult.dcp.serverRegistration],
						permission: {
							work_spec_read: "deny",
							work_spec_write: "deny",
							"github_source_*": "deny",
							"herdr_worktree_*": "deny",
						},
						mcp: { "github-read": { enabled: false } },
					},
				}),
			};
		}
		if (arguments_[1] === "config") {
			return {
				stdout: JSON.stringify({
					default_agent: "build",
					model: "openai/gpt-5.6-sol",
					small_model: "openai/gpt-5.6-luna",
					plugin: [
						deterministicResult.dcp.serverRegistration,
						`file://${deterministicResult.targetProfileDirectory}/plugins/github-source-read.js`,
						`file://${deterministicResult.targetProfileDirectory}/plugins/herdr-worktree.js`,
						`file://${deterministicResult.targetProfileDirectory}/plugins/session-work-spec.js`,
						`file://${deterministicResult.targetProfileDirectory}/plugins/tool-execution-guard.js`,
					],
					mcp: { "github-read": { enabled: false } },
					command: {
						"dcp-compress": {
							template: "",
							description: "Trigger DCP manual compression with: /dcp-compress [focus]",
						},
						review: { agent: "review", subtask: false },
					},
					instructions: deterministicResult.profile.instructions,
				}),
			};
		}
		if (arguments_[1] === "agent") {
			const agentName = arguments_[2];
			const fingerprints = {
				build: ["primary", "high", "low"],
				explore: ["subagent", "medium", "medium"],
				plan: ["primary", "high", "low"],
				research: ["primary", "medium", "medium"],
				researcher: ["subagent", "medium", "medium"],
				review: ["primary", "high", "medium"],
				reviewer: ["subagent", "high", "medium"],
				"web-researcher": ["subagent", "medium", "medium"],
			};
			const permission = [];
			if (agentName !== "web-researcher") {
				permission.push({ permission: "work_spec_read", pattern: "*", action: "allow" });
			}
			if (["research", "researcher", "review", "reviewer"].includes(agentName)) {
				permission.push({ permission: "github_source_*", pattern: "*", action: "allow" });
			}
			if (agentName === "build") {
				permission.push(
					{ permission: "compress", pattern: "*", action: "ask" },
					{ permission: "work_spec_write", pattern: "*", action: "allow" },
					{ permission: "herdr_worktree_list", pattern: "*", action: "allow" },
					{ permission: "herdr_worktree_create", pattern: "*", action: "ask" },
					{ permission: "herdr_worktree_open", pattern: "*", action: "ask" },
					{ permission: "herdr_worktree_remove", pattern: "*", action: "ask" },
				);
			}
			const [mode, reasoningEffort, textVerbosity] = fingerprints[agentName];
			return {
				stdout: JSON.stringify({
					name: agentName,
					mode,
					options: { reasoningEffort, textVerbosity },
					permission,
					tools: {
						read: agentName !== "web-researcher",
						edit: agentName === "build",
						task: !["explore", "researcher", "reviewer", "web-researcher"].includes(agentName),
					},
				}),
			};
		}
		return {
			stdout: JSON.stringify(deterministicResult.skills.map((name) => ({
				name,
				location: `${deterministicResult.targetProfileDirectory}/skills/${name}/SKILL.md`,
			}))),
		};
	};

	const result = await runRuntimeSmoke({
		deterministicResult,
		repositoryRoot: path.resolve(import.meta.dirname, ".."),
		execute,
		installDependencies: async ({ profileDirectory }) => {
			assert.equal(profileDirectory, deterministicResult.targetProfileDirectory);
			dependenciesInstalled = true;
		},
		readCatalog: async () => ({
			toolIDs: [
				"compress",
				"github_source_commit",
				"github_source_file",
				"github_source_tree",
				"herdr_worktree_create",
				"herdr_worktree_list",
				"herdr_worktree_open",
				"herdr_worktree_remove",
				"work_spec_read",
				"work_spec_write",
			],
			skills: deterministicResult.skills.map((name) => ({
				name,
				location: `${deterministicResult.targetProfileDirectory}/skills/${name}/SKILL.md`,
			})),
		}),
	});

	assert.equal(result.tier, "runtime");
	assert.equal(dependenciesInstalled, true);
	assert.equal(result.openCode.pluginLoaded, true);
	assert.equal(result.openCode.dcpLoaded, true);
	assert.equal(result.openCode.dcpToolPublished, true);
	assert.equal(result.openCode.githubSourcePluginLoaded, true);
	assert.equal(result.openCode.inheritedGitHubMcpDisabled, true);
	assert.equal(result.openCode.reviewCanReadGitHubSource, true);
	assert.equal(result.openCode.herdrWorktreePluginLoaded, true);
	assert.equal(result.openCode.buildCanListWorktrees, true);
	assert.equal(result.openCode.buildAsksForWorktreeLifecycle, true);
	assert.equal(result.openCode.buildCanReadWorkSpec, true);
	assert.equal(result.openCode.buildCanWriteWorkSpec, true);
	assert.equal(result.openCode.buildAsksToCompress, true);
	assert.equal(result.openCode.expectedSkillsLoaded, true);
	assert.equal(result.openCode.ownedSkillsUseInstalledProfile, true);
	assert.equal(result.openCode.pluginInventoryLoaded, true);
	assert.equal(result.openCode.dcpCommandLoaded, true);
	assert.equal(result.openCode.customToolsPublished, true);
	assert.equal(result.openCode.childModesAreReadOnly, true);
	assert.equal(result.openCode.webResearcherIsLocallyIsolated, true);
	assert.equal(result.ocx.profileName, "ws");
	assert.equal(result.ocx.policyMatched, true);
	assert.equal(calls.length, 10);
});
