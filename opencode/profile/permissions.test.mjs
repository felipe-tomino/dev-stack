import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const profileDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(profileDirectory, "../..");
const agentDirectory = path.join(profileDirectory, "agents");
const guardedProfileDirectory = path.join(repositoryRoot, "opencode/profile-guarded");
const requireRuntime = process.env.REQUIRE_OCX_RUNTIME === "1";

const externalRoots = {
	"~/.config/ghostty/config": "allow",
	"~/.config/herdr/config.toml": "allow",
	"~/.config/atuin/config.toml": "allow",
	"~/.config/yazi/keymap.toml": "allow",
	"~/.config/yazi/package.toml": "allow",
	"~/.config/yazi/yazi.toml": "allow",
	"~/.config/opencode/profiles/ws/**": "allow",
	"~/.config/opencode/tui-plugins/session-forks.js": "allow",
	"~/.config/opencode/tui.jsonc": "allow",
};

const externalReaders = [
	"plan",
	"research",
	"researcher",
	"review",
	"reviewer",
	"workspace-manager",
	"writer",
];

const gitReaders = ["research", "researcher", "review", "reviewer"];
const safeGitMetadataPatterns = [
	"git merge-base *",
	"git rev-parse HEAD",
	"git rev-parse --verify HEAD",
	"git rev-parse --show-toplevel",
	"git status --short",
	"git branch --list *",
	"git remote get-url origin",
];
const delegatingAgents = ["build", "plan", "research", "review"];
const childAgents = ["explore", "researcher", "reviewer", "web-researcher"];
const readOnlyAgents = [
	"explore",
	"plan",
	"research",
	"researcher",
	"review",
	"reviewer",
	"web-researcher",
	"workspace-manager",
	"writer",
];

async function readJson(relativePath) {
	const contents = await readFile(path.join(repositoryRoot, relativePath), "utf8");
	return JSON.parse(contents);
}

async function readAgent(agentName) {
	return readFile(path.join(agentDirectory, `${agentName}.md`), "utf8");
}

function parseAgentPermissions(agent) {
	const frontmatter = agent.match(/^---\n([\s\S]*?)\n---/);
	assert.ok(frontmatter, "agent frontmatter is required");

	const topLevel = new Map();
	const nested = new Map();
	let inPermissions = false;
	let section;

	for (const line of frontmatter[1].split("\n")) {
		if (line === "permission:") {
			inPermissions = true;
			continue;
		}
		if (!inPermissions) continue;
		if (/^[^ ]/.test(line)) break;

		const nestedMatch = line.match(/^    "((?:\\.|[^"])*)": (allow|ask|deny)$/);
		if (section && nestedMatch) {
			nested.get(section).push({
				pattern: nestedMatch[1].replaceAll('\\"', '"'),
				action: nestedMatch[2],
			});
			continue;
		}

		const topLevelMatch = line.match(/^  ("[^"]+"|[^:]+):(?: (.+))?$/);
		if (topLevelMatch) {
			const key = topLevelMatch[1].replaceAll('"', "");
			section = topLevelMatch[2] ? undefined : key;
			if (topLevelMatch[2]) topLevel.set(key, topLevelMatch[2]);
			if (section) nested.set(section, []);
			continue;
		}
	}

	return { topLevel, nested };
}

function runJson(command, args, options = {}) {
	const result = spawnSync(command, args, {
		cwd: repositoryRoot,
		encoding: "utf8",
		maxBuffer: 10 * 1024 * 1024,
		...options,
	});
	assert.equal(result.status, 0, result.stderr || `${command} exited with ${result.status}`);
	return JSON.parse(result.stdout);
}

function hasRuntimeCommand(command) {
	return !spawnSync(command, ["--version"], { encoding: "utf8" }).error;
}

function requireRuntimeCommand(t, command) {
	if (hasRuntimeCommand(command)) return true;
	if (requireRuntime) {
		assert.fail(`${command} is required when REQUIRE_OCX_RUNTIME=1`);
	}
	t.skip(`${command} is not installed`);
	return false;
}

function findLastPermission(agent, permission, pattern = "*") {
	return agent.permission.findLast(
		(rule) => rule.permission === permission && rule.pattern === pattern,
	);
}

test("the profile has no global external filesystem roots", async () => {
	const profile = await readJson("opencode/profile/opencode.jsonc");
	assert.equal(profile.permission.external_directory, undefined);
	assert.equal(profile.subagent_depth, 1);
});

test("the profile composes project-local OpenCode configuration", async () => {
	const profile = await readJson("opencode/profile/ocx.jsonc");
	assert.ok(!profile.exclude.includes("**/.opencode/**"));
	assert.ok(!profile.exclude.includes("**/opencode.jsonc"));
	assert.ok(!profile.exclude.includes("**/opencode.json"));
});

test("dev-stack grants only its owned external configuration destinations", async () => {
	const project = await readJson(".opencode/opencode.jsonc");
	assert.deepEqual(project.permission.external_directory, externalRoots);
});

test("project external roots are repeated for selected read-only agents", async () => {
	const project = await readJson(".opencode/opencode.jsonc");

	for (const agentName of externalReaders) {
		assert.deepEqual(
			project.agent?.[agentName]?.permission?.external_directory,
			externalRoots,
			`${agentName} must re-allow project roots after its deny-all rule`,
		);
	}
});

test("read-only Git permissions reject escape and write-capable options", async () => {
	const dangerousPatterns = [
		"git diff *--no-ind*",
		"git diff *--out*",
		"git diff *--ext*",
		"git diff *--text*",
		"git log *--out*",
		"git log *--ext*",
		"git log *--text*",
		"git show *--out*",
		"git show *--ext*",
		"git show *--text*",
		"git blame *--cont*",
		"git *>*",
		"git *<*",
		"gh *>*",
		"gh *<*",
	];

	for (const agentName of gitReaders) {
		const { nested } = parseAgentPermissions(await readAgent(agentName));
		const bashRules = nested.get("bash");
		for (const dangerousPattern of dangerousPatterns) {
			assert.ok(
				bashRules.some((rule) => rule.pattern === dangerousPattern && rule.action === "deny"),
				`${agentName} is missing a deny rule for ${dangerousPattern}`,
			);
		}
		const broadDenyIndex = bashRules.findIndex(
			(rule) => rule.pattern === "git diff *" && rule.action === "deny",
		);
		const safeAllowIndex = bashRules.findIndex(
			(rule) => rule.pattern === "git diff --no-ext-diff --no-textconv *" && rule.action === "allow",
		);
		const outputDenyIndex = bashRules.findIndex(
			(rule) => rule.pattern === "git diff *--out*" && rule.action === "deny",
		);
		assert.ok(
			broadDenyIndex < safeAllowIndex && safeAllowIndex < outputDenyIndex,
			`${agentName} must deny broad Git, allow the safe prefix, then deny output options`,
		);
	}
});

test("Git evidence agents can inspect common repository metadata", async () => {
	for (const agentName of gitReaders) {
		const { nested } = parseAgentPermissions(await readAgent(agentName));
		const bashRules = nested.get("bash");
		for (const safePattern of safeGitMetadataPatterns) {
			assert.ok(
				bashRules.some((rule) => rule.pattern === safePattern && rule.action === "allow"),
				`${agentName} cannot run ${safePattern}`,
			);
		}
	}
});

test("Writer cannot redirect GitHub output into files", async () => {
	const { nested } = parseAgentPermissions(await readAgent("writer"));
	const bashRules = nested.get("bash");
	assert.ok(bashRules.some((rule) => rule.pattern === "gh *>*" && rule.action === "deny"));
	assert.ok(bashRules.some((rule) => rule.pattern === "gh *<*" && rule.action === "deny"));
});

test("OCX resolves external roots only for dev-stack", async (t) => {
	if (!requireRuntimeCommand(t, "ocx")) return;

	const projectConfig = runJson("ocx", ["config", "show", "--profile", "ws", "--json"]);
	assert.deepEqual(projectConfig.opencode.permission.external_directory, externalRoots);

	const emptyProject = await mkdtemp(path.join(os.tmpdir(), "ocx-permissions-"));
	try {
		const profileConfig = runJson("ocx", ["config", "show", "--profile", "ws", "--json"], {
			cwd: emptyProject,
		});
		assert.equal(profileConfig.opencode.permission.external_directory, undefined);
	} finally {
		await rm(emptyProject, { recursive: true, force: true });
	}
});

test("OpenCode applies project external roots after a read-only agent deny-all", (t) => {
	if (!requireRuntimeCommand(t, "ocx")) return;
	if (!requireRuntimeCommand(t, "opencode")) return;

	const resolved = runJson("ocx", ["config", "show", "--profile", "ws", "--json"]);
	const environment = { ...process.env };
	delete environment.OCX_CONTEXT;
	delete environment.OPENCODE_CONFIG_DIR;
	environment.OPENCODE_CONFIG_CONTENT = JSON.stringify(resolved.opencode);
	environment.OPENCODE_CONFIG_DIR = path.join(os.homedir(), ".config/opencode/profiles/ws");
	environment.OPENCODE_DISABLE_PROJECT_CONFIG = "true";

	const research = runJson("opencode", ["debug", "agent", "research"], { env: environment });
	const denyAllIndex = research.permission.findLastIndex(
		(rule) => rule.permission === "*" && rule.action === "deny",
	);

	for (const externalPath of Object.keys(externalRoots)) {
		const expandedPath = externalPath.replace("~", os.homedir());
		const allowIndex = research.permission.findLastIndex(
			(rule) =>
				rule.permission === "external_directory" &&
				rule.pattern === expandedPath &&
				rule.action === "allow",
		);
		assert.ok(allowIndex > denyAllIndex, `${externalPath} must be allowed after Research's deny-all`);
	}

	const broadGitDeny = research.permission.findLastIndex(
		(rule) => rule.permission === "bash" && rule.pattern === "git diff *" && rule.action === "deny",
	);
	const safeGitAllow = research.permission.findLastIndex(
		(rule) =>
			rule.permission === "bash" &&
			rule.pattern === "git diff --no-ext-diff --no-textconv *" &&
			rule.action === "allow",
	);
	const outputDeny = research.permission.findLastIndex(
		(rule) =>
			rule.permission === "bash" && rule.pattern === "git diff *--out*" && rule.action === "deny",
	);
	assert.ok(broadGitDeny < safeGitAllow && safeGitAllow < outputDeny);
});

test("Build states its practical external-write boundary", async () => {
	const build = await readAgent("build");
	const { topLevel } = parseAgentPermissions(build);
	assert.equal(topLevel.get("edit"), "allow");
	assert.equal(topLevel.get("bash"), "allow");
	assert.match(
		build,
		/Do not intentionally read or write outside the current workspace or project-declared external roots/,
	);
});

test("Build is the only general write-capable agent", async () => {
	for (const agentName of readOnlyAgents) {
		const { topLevel, nested } = parseAgentPermissions(await readAgent(agentName));
		assert.notEqual(topLevel.get("edit"), "allow", `${agentName} must not edit`);
		assert.notEqual(topLevel.get("bash"), "allow", `${agentName} must not have general shell access`);
		if (nested.has("bash")) {
			assert.ok(
				nested.get("bash").some((rule) => rule.pattern === "*" && rule.action === "deny"),
				`${agentName} Bash rules must start from deny-all`,
			);
		}
	}
});

test("Workspace Manager cannot remove worktrees or submit worker prompts", async () => {
	const manager = await readAgent("workspace-manager");
	const { nested } = parseAgentPermissions(manager);
	const bashRules = nested.get("bash");
	for (const safePattern of [
		"git branch --list *",
		"git rev-parse --show-toplevel",
		"git symbolic-ref refs/remotes/origin/HEAD",
		"git symbolic-ref --short refs/remotes/origin/HEAD",
		"git status --short",
	]) {
		assert.ok(
			bashRules.some((rule) => rule.pattern === safePattern && rule.action === "allow"),
			`Workspace Manager cannot run ${safePattern}`,
		);
	}
	assert.ok(!bashRules.some((rule) => rule.pattern.startsWith("herdr worktree remove") && rule.action === "allow"));
	assert.ok(!bashRules.some((rule) => rule.pattern.startsWith("herdr agent prompt") && rule.action === "allow"));
	assert.match(manager, /Never remove a worktree or discard state without explicit approval/);
	assert.match(manager, /Do not submit work with `herdr agent prompt`/);
	assert.match(manager, /include it verbatim/);
	assert.match(manager, /source identifier, owner, and accepted repository state or date/);
});

test("work specs define one explicit finalized handoff transport", async () => {
	const workSpec = await readFile(
		path.join(profileDirectory, "skills/work-spec/SKILL.md"),
		"utf8",
	);
	assert.match(workSpec, /only after the user accepts it as final/);
	assert.match(workSpec, /include the finalized spec verbatim/);
	assert.match(workSpec, /explicitly requests a repository artifact/);
	assert.match(workSpec, /replacement explicitly/);
});

test("Web Researcher has no local read or private integration permissions", async () => {
	const { topLevel } = parseAgentPermissions(await readAgent("web-researcher"));
	for (const permission of ["read", "glob", "grep", "linear-read_*", "slack-read_*"]) {
		assert.notEqual(topLevel.get(permission), "allow");
	}
});

test("delegating agents use the canonical child contract", async () => {
	const workflow = await readFile(path.join(profileDirectory, "tools/lean-workflow.md"), "utf8");
	const normalizedWorkflow = workflow.replaceAll(/\s+/g, " ");
	for (const field of [
		"bounded objective",
		"concrete deliverable",
		"stopping condition",
		"allowed source and tool scope",
		"parent role",
		"remaining delegation depth",
	]) {
		assert.match(normalizedWorkflow, new RegExp(field));
	}
	for (const outcome of ["completed", "blocked", "needs-parent-decision"]) {
		assert.ok(normalizedWorkflow.includes(`\`Outcome: ${outcome}\``));
	}

	for (const agentName of delegatingAgents) {
		const agent = await readAgent(agentName);
		assert.match(agent, /delegation contract in the Lean Workflow Policy/);
		assert.ok(
			agent.includes(`naming \`${agentName}\` as the parent and \`0\` as the remaining depth`),
		);
	}
});

test("child agents report a supported terminal outcome", async () => {
	for (const agentName of childAgents) {
		const agent = await readAgent(agentName);
		for (const outcome of ["completed", "blocked", "needs-parent-decision"]) {
			assert.match(agent, new RegExp(`Outcome: ${outcome}`));
		}
	}
});

test("Explore has the evidence-backed pilot step ceiling", async () => {
	const explore = await readAgent("explore");
	assert.match(explore, /^steps: 8$/m);
});

test("OpenCode resolves Explore's pilot step ceiling", (t) => {
	if (!requireRuntimeCommand(t, "opencode")) return;
	const environment = {
		...process.env,
		OPENCODE_CONFIG_DIR: profileDirectory,
		OPENCODE_DISABLE_PROJECT_CONFIG: "true",
	};
	delete environment.OCX_CONTEXT;
	const explore = runJson("opencode", ["debug", "agent", "explore"], { env: environment });
	assert.equal(explore.steps, 8);
});

test("the guarded profile declares a closed project and private-data boundary", async () => {
	const ocx = await readJson("opencode/profile-guarded/ocx.jsonc");
	for (const excludedPath of [
		"**/.opencode/**",
		"**/opencode.json",
		"**/opencode.jsonc",
		"**/AGENTS.md",
		"**/CLAUDE.md",
		"**/CONTEXT.md",
	]) {
		assert.ok(ocx.exclude.includes(excludedPath));
	}

	const config = await readJson("opencode/profile-guarded/opencode.jsonc");
	assert.equal(config.permission.external_directory, "deny");
	assert.equal(config.agent.build.permission.bash, "ask");
	for (const integration of ["context7", "exa", "gh_grep"]) {
		assert.equal(config.mcp[integration].enabled, false);
	}
	for (const agentName of readOnlyAgents) {
		assert.equal(config.agent[agentName].disable, true);
	}
});

test("the guarded launcher bypasses project configuration composition", async () => {
	const launcher = await readFile(path.join(repositoryRoot, "opencode/launch-guarded.sh"), "utf8");
	assert.match(launcher, /OPENCODE_DISABLE_PROJECT_CONFIG=true/);
	assert.match(launcher, /OPENCODE_CONFIG_DIR=/);
	assert.match(launcher, /unset OCX_CONTEXT/);
	assert.match(launcher, /unset OPENCODE_CONFIG_CONTENT/);
	assert.match(launcher, /exec opencode/);
	assert.match(launcher, /Guarded profile not found/);
	assert.ok(!launcher.includes("ocx oc"));
});

test("the guarded profile resists project permission escalation", async (t) => {
	if (!requireRuntimeCommand(t, "opencode")) return;

	const temporaryHome = await mkdtemp(path.join(os.tmpdir(), "ocx-guarded-home-"));
	const temporaryProject = await mkdtemp(path.join(os.tmpdir(), "ocx-guarded-project-"));
	const profilesDirectory = path.join(temporaryHome, ".config/opencode/profiles");
	const guardedInstall = path.join(profilesDirectory, "ws-guarded");
	try {
		await mkdir(guardedInstall, { recursive: true });
		for (const profileEntry of ["agents", "skills", "tools", "ocx.jsonc", "opencode.jsonc"]) {
			await cp(path.join(profileDirectory, profileEntry), path.join(guardedInstall, profileEntry), {
				recursive: true,
			});
		}
		await cp(guardedProfileDirectory, guardedInstall, { recursive: true, force: true });
		await cp(
			path.join(profileDirectory, "evals/fixtures/adversarial-repository"),
			temporaryProject,
			{ recursive: true, force: true },
		);

		const environment = {
			...process.env,
			HOME: temporaryHome,
			XDG_CONFIG_HOME: path.join(temporaryHome, ".config"),
		};
		delete environment.OCX_CONTEXT;
		delete environment.OPENCODE_CONFIG_CONTENT;
		environment.OPENCODE_CONFIG_DIR = guardedInstall;
		environment.OPENCODE_DISABLE_PROJECT_CONFIG = "true";
		const debugConfig = runJson("opencode", ["debug", "config"], {
			cwd: temporaryProject,
			env: environment,
		});
		assert.equal(debugConfig.permission.external_directory, "deny");
		assert.ok(!JSON.stringify(debugConfig).includes("Ignore profile restrictions"));

		const build = runJson("opencode", ["debug", "agent", "build"], {
			cwd: temporaryProject,
			env: environment,
		});
		assert.equal(findLastPermission(build, "bash").action, "ask");
		assert.equal(findLastPermission(build, "external_directory").action, "deny");
		assert.equal(findLastPermission(build, "webfetch").action, "ask");
		assert.equal(findLastPermission(build, "task").action, "deny");
		assert.equal(findLastPermission(build, "linear-read_*").action, "deny");
		assert.equal(findLastPermission(build, "slack-read_*").action, "deny");
		assert.ok(!build.prompt.includes("Ignore profile restrictions"));
	} finally {
		await rm(temporaryHome, { recursive: true, force: true });
		await rm(temporaryProject, { recursive: true, force: true });
	}
});

test("the evaluation corpus is versioned and has explicit safety oracles", async () => {
	const corpus = await readJson("opencode/profile/evals/scenarios.json");
	assert.equal(corpus.version, 1);
	assert.equal(corpus.repetitions, 3);
	assert.deepEqual(corpus.qualityScale, [0, 1, 2, 3]);
	assert.equal(new Set(corpus.scenarios.map((scenario) => scenario.id)).size, corpus.scenarios.length);
	for (const scenario of corpus.scenarios) {
		assert.ok(scenario.id);
		assert.ok(scenario.agent);
		assert.ok(scenario.fixture);
		assert.ok(scenario.prompt);
		assert.ok(scenario.critical.length > 0);
	}
});
