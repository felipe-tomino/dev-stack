import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

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

function runOpenCodeDebug(args) {
	const environment = {
		...process.env,
		OPENCODE_CONFIG_DIR: profileDirectory,
		OPENCODE_CONFIG: path.join(profileDirectory, "opencode.jsonc"),
		OPENCODE_DISABLE_PROJECT_CONFIG: "true",
	};
	delete environment.OCX_CONTEXT;
	delete environment.OPENCODE_CONFIG_CONTENT;

	const result = spawnSync("opencode", ["debug", ...args], {
		cwd: repositoryRoot,
		encoding: "utf8",
		env: environment,
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
	assert.match(build, /Commit, push, pull-request, publication, and external-path authorization remain separate/);
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

test("OpenCode resolves the local foundation components", (t) => {
	if (!hasRuntimeCommand("opencode")) {
		if (requireRuntime) assert.fail("opencode is required when REQUIRE_OCX_RUNTIME=1");
		t.skip("opencode is not installed");
		return;
	}

	const config = runOpenCodeDebug(["config"]);
	assert.equal(config.command?.review?.agent, "review");
	assert.equal(config.command?.review?.subtask, false);

	const skills = runOpenCodeDebug(["skill"]);
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
