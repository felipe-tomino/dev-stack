import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { readRuntimeCatalog } from "../profile-smoke.mjs";

const profileDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(profileDirectory, "../..");
const workcellRevision = "77e6c5fef1941d113b21f63f4c4f7d74d2e086b5";
const requireRuntime = process.env.REQUIRE_OCX_RUNTIME === "1";

async function readProfileFile(relativePath) {
	return readFile(path.join(profileDirectory, relativePath), "utf8");
}

async function readJson(relativePath) {
	return JSON.parse(await readProfileFile(relativePath));
}

function hasRuntimeCommand(command) {
	return !spawnSync(command, ["--version"], { encoding: "utf8" }).error;
}

function openCodeEnvironment() {
	const environment = {
		...process.env,
		OPENCODE_CONFIG_DIR: profileDirectory,
		OPENCODE_CONFIG: path.join(profileDirectory, "opencode.jsonc"),
		OPENCODE_DISABLE_PROJECT_CONFIG: "true",
	};
	delete environment.OCX_CONTEXT;
	delete environment.OPENCODE_CONFIG_CONTENT;
	return environment;
}

function runOpenCodeDebug(args) {
	const result = spawnSync("opencode", ["debug", ...args], {
		cwd: repositoryRoot,
		encoding: "utf8",
		env: openCodeEnvironment(),
		maxBuffer: 16 * 1024 * 1024,
	});
	assert.equal(result.status, 0, result.stderr || `opencode debug ${args.join(" ")} failed`);
	return JSON.parse(result.stdout);
}

test("repository-owned philosophy and review skills use immutable attributed sources", async () => {
	for (const skillName of [
		"code-philosophy",
		"frontend-philosophy",
		"code-review",
		"testing-philosophy",
	]) {
		const skill = await readProfileFile(`skills/${skillName}/SKILL.md`);
		assert.match(skill, new RegExp(`^name: ${skillName}$`, "m"));
		assert.match(skill, new RegExp(workcellRevision));
		assert.match(skill, /THIRD_PARTY_NOTICES\.md/);
	}

	const notices = await readFile(path.join(repositoryRoot, "THIRD_PARTY_NOTICES.md"), "utf8");
	assert.match(notices, new RegExp(workcellRevision));
	assert.match(notices, /75e05a9a3280e5ee16953d7b9d6c42ad4d893697/);
});

test("Build uses risk-based confirmation, work specs, proportional tests, and Conventional Commits", async () => {
	const build = await readProfileFile("agents/build.md");

	for (const skillName of ["testing-philosophy", "work-spec"]) {
		assert.match(build, new RegExp(`^    ${skillName}: allow$`, "m"));
	}
	assert.match(build, /clear, low-risk implementation request as authorization/);
	assert.match(build, /when the user asks to review the approach first/);
	assert.match(build, /destructive, irreversible, externally visible, or high cost/);
	assert.match(build, /explain the concrete irreversible consequences before requesting confirmation/i);
	assert.match(build, /Commit, push, pull-request, publication, and external-path authorization remain separate/);
	assert.match(build, /explicit request to push to a known public repository covers reviewed names/);
	assert.match(build, /required by third-party licenses or needed to identify public sources/);
	assert.match(build, /do not ask again solely because that attribution is present/);
	assert.match(build, /Repository ownership or implementation authorization alone does not authorize publication/);
	assert.match(build, /Do not publish unrelated personal information/);
	for (const protectedCategory of [
		"personal names",
		"company or client identifiers",
		"internal issue identifiers",
		"private URLs",
		"credentials",
		"excerpts from private conversations",
	]) {
		assert.match(build, new RegExp(protectedCategory));
	}
	assert.match(build, /session-local work spec/);
	assert.match(build, /type\(scope\): description/);
	assert.doesNotMatch(build, /ask the user to confirm and wait.*every implementation task/);
});

test("work specs preserve decisions, interfaces, operations, verification, and resume state", async () => {
	const workSpec = await readProfileFile("skills/work-spec/SKILL.md");

	for (const heading of [
		"## Decisions and provenance",
		"## Affected components and interfaces",
		"## Migration, rollback, risks, and assumptions",
		"## Verification",
		"## Current state",
	]) {
		assert.match(workSpec, new RegExp(`^${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"));
	}
	assert.match(workSpec, /Never create a repository file as an automatic fallback/);
	assert.match(workSpec, /Use `work_spec_read` when answering a request for persisted exact values/);
	assert.match(workSpec, /Copy persisted literals and commands verbatim; do not reconstruct or correct them/);
});

test("session work-spec tools preserve one writer and the private evidence boundary", async () => {
	const profile = await readJson("opencode.jsonc");
	assert.equal(profile.permission.work_spec_read, "deny");
	assert.equal(profile.permission.work_spec_write, "deny");

	for (const agentName of ["build", "plan", "research", "review", "explore", "researcher", "reviewer"]) {
		const agent = await readProfileFile(`agents/${agentName}.md`);
		assert.match(agent, /^  work_spec_read: allow$/m, `${agentName} cannot read the session work spec`);
	}

	const build = await readProfileFile("agents/build.md");
	assert.match(build, /^  work_spec_write: allow$/m);
	assert.match(build, /do not make the first edit until `work_spec_write` succeeds/);
	for (const agentName of ["plan", "research", "review", "explore", "researcher", "reviewer", "web-researcher"]) {
		const agent = await readProfileFile(`agents/${agentName}.md`);
		assert.doesNotMatch(agent, /^  work_spec_write: allow$/m, `${agentName} must not write work specs`);
	}
	const webResearcher = await readProfileFile("agents/web-researcher.md");
	assert.doesNotMatch(webResearcher, /^  work_spec_read: allow$/m);
});

test("typed GitHub source reads require immutable commits and stay private", async () => {
	const profile = await readJson("opencode.jsonc");
	assert.equal(profile.permission["github_source_*"], "deny");
	assert.equal(profile.mcp["github-read"].enabled, false);

	for (const agentName of ["research", "review", "researcher", "reviewer"]) {
		const agent = await readProfileFile(`agents/${agentName}.md`);
		assert.match(agent, /^  "github_source_\*": allow$/m);
		assert.match(agent, /full commit SHA/);
		assert.match(agent, /branch/i);
	}
	for (const agentName of ["build", "plan", "explore", "web-researcher"]) {
		const agent = await readProfileFile(`agents/${agentName}.md`);
		assert.doesNotMatch(agent, /^  "github_source_\*": allow$/m);
	}

	const plugin = await readProfileFile("plugins/github-source-read.js");
	assert.match(plugin, /github_source_commit/);
	assert.match(plugin, /github_source_tree/);
	assert.match(plugin, /github_source_file/);
	assert.doesNotMatch(plugin, /tool\.schema\.string\(\).*method|tool\.schema\.string\(\).*url/);
});

test("typed worktree orchestration keeps Herdr as lifecycle and state owner", async () => {
	const profile = await readJson("opencode.jsonc");
	assert.equal(profile.permission["herdr_worktree_*"], "deny");
	const build = await readProfileFile("agents/build.md");
	assert.match(build, /^  herdr_worktree_list: allow$/m);
	for (const operation of ["create", "open", "remove"]) {
		assert.match(build, new RegExp(`^  herdr_worktree_${operation}: ask$`, "m"));
	}
	for (const agentName of ["plan", "research", "review", "explore", "researcher", "reviewer", "web-researcher"]) {
		const agent = await readProfileFile(`agents/${agentName}.md`);
		assert.doesNotMatch(agent, /^  herdr_worktree_/m);
	}

	const policy = await readProfileFile("tools/herdr-worktrees.md");
	assert.match(policy, /Herdr chooses the path and owns the workspace/);
	assert.match(policy, /never auto-remove after a partial create or launch failure/);
	assert.match(policy, /Do not fall back to Git/);
	const plugin = await readProfileFile("plugins/herdr-worktree.js");
	assert.match(plugin, /herdr_worktree_create/);
	assert.match(plugin, /herdr_worktree_open/);
	assert.match(plugin, /herdr_worktree_list/);
	assert.match(plugin, /herdr_worktree_remove/);
	assert.doesNotMatch(plugin, /git worktree|execFile\("git"/);
});

test("the review command routes to Review and preserves the two-axis boundary", async () => {
	const command = await readProfileFile("commands/review.md");

	assert.match(command, /^agent: review$/m);
	assert.match(command, /^subtask: false$/m);
	assert.match(command, /`\$ARGUMENTS`/);
	assert.match(command, /git diff --no-ext-diff --no-textconv --cached/);
	assert.match(command, /git show --no-ext-diff --no-textconv/);
	assert.match(command, /code-review` only for the Standards method/);
	assert.match(command, /Never modify files/);
});

test("profile-wide communication and CLAUDE fallback are composed", async () => {
	const openCode = await readJson("opencode.jsonc");
	const ocx = await readJson("ocx.jsonc");
	const communication = await readProfileFile("tools/communication.md");

	assert.ok(openCode.instructions.includes("./tools/communication.md"));
	assert.ok(!ocx.exclude.includes("**/CLAUDE.md"));
	assert.ok(ocx.exclude.includes("**/CONTEXT.md"));
	assert.match(communication, /Start with the answer, action, decision, or blocking question/);
	assert.match(communication, /WS_PROFILE_POLICY_ACTIVE/);
	assert.match(communication, /known cause and corrective direction/);
	assert.match(communication, /Do not invent time estimates or force a fixed number of options/);
});

test("OpenCode resolves the local foundation components", async (t) => {
	if (!hasRuntimeCommand("opencode")) {
		if (requireRuntime) assert.fail("opencode is required when REQUIRE_OCX_RUNTIME=1");
		t.skip("opencode is not installed");
		return;
	}

	const config = runOpenCodeDebug(["config"]);
	assert.equal(config.command?.review?.agent, "review");
	assert.equal(config.command?.review?.subtask, false);
	assert.ok(
		config.plugin.some((plugin) => plugin.endsWith("/plugins/session-work-spec.js")),
		"OpenCode must discover the session work-spec plugin",
	);

	const { skills } = await readRuntimeCatalog({
		launcher: "opencode",
		executionOptions: {
			cwd: repositoryRoot,
			env: openCodeEnvironment(),
		},
		directory: repositoryRoot,
	});
	for (const skillName of ["code-philosophy", "frontend-philosophy", "code-review", "testing-philosophy"]) {
		const skill = skills.find(({ name }) => name === skillName);
		assert.ok(skill, `${skillName} must resolve`);
		assert.ok(skill.location.startsWith(profileDirectory), `${skillName} must resolve from the repository profile`);
	}

	const build = runOpenCodeDebug(["agent", "build"]);
	for (const skillName of ["testing-philosophy", "work-spec"]) {
		assert.ok(
			build.permission.some(
				(rule) => rule.permission === "skill" && rule.pattern === skillName && rule.action === "allow",
			),
			`Build cannot load ${skillName}`,
		);
	}
});
