import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const profileDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(profileDirectory, "../..");
const agentDirectory = path.join(profileDirectory, "agents");
const requireRuntime = process.env.REQUIRE_OCX_RUNTIME === "1";

const externalRoots = {
	"~/.config/ghostty/config": "allow",
	"~/.config/herdr/config.toml": "allow",
	"~/.config/atuin/config.toml": "allow",
	"~/.config/yazi/keymap.toml": "allow",
	"~/.config/yazi/package.toml": "allow",
	"~/.config/yazi/yazi.toml": "allow",
	"~/.config/opencode/profiles/ws": "allow",
	"~/.config/opencode/profiles/ws/**": "allow",
	"~/.config/opencode/tui-plugins": "allow",
	"~/.config/opencode/tui-plugins/herdr-tui.js": "allow",
	"~/.config/opencode/tui-plugins/hunk-review.js": "allow",
	"~/.config/opencode/tui.jsonc": "allow",
};

const externalReaders = [
	"plan",
	"research",
	"researcher",
	"review",
	"reviewer",
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
const hunkReadPatterns = [
	"hunk session get --repo . --json",
	"hunk session context --repo . --json",
	"hunk session review --repo . --json",
	"hunk session review --repo . --include-notes --json",
	"hunk session review --repo . --include-patch --json",
	"hunk session review --repo . --include-patch --include-notes --json",
	"hunk session comment list --repo . --type all --json",
];
const hunkStateMutationPatterns = [
	"hunk session reload *",
	"hunk session comment apply *",
	"hunk session comment rm *",
	"hunk session comment clear *",
];
const readOnlyAgents = [
	"explore",
	"plan",
	"research",
	"researcher",
	"review",
	"reviewer",
	"web-researcher",
];

async function readJson(relativePath) {
	const contents = await readFile(path.join(repositoryRoot, relativePath), "utf8");
	return JSON.parse(contents);
}

async function readAgent(agentName) {
	return readFile(path.join(agentDirectory, `${agentName}.md`), "utf8");
}

async function listPrimaryAgentNames() {
	const agentFiles = (await readdir(agentDirectory)).filter((file) => file.endsWith(".md"));
	const agents = await Promise.all(
		agentFiles.map(async (file) => ({
			name: file.slice(0, -3),
			definition: await readFile(path.join(agentDirectory, file), "utf8"),
		})),
	);
	return agents.filter(({ definition }) => /^mode: primary$/m.test(definition)).map(({ name }) => name);
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

		const nestedMatch = line.match(/^    (?:"((?:\\.|[^"])*)"|([^:]+)): (allow|ask|deny)$/);
		if (section && nestedMatch) {
			nested.get(section).push({
				pattern: (nestedMatch[1] ?? nestedMatch[2]).replaceAll('\\"', '"'),
				action: nestedMatch[3],
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

test("the profile has no global external filesystem roots", async () => {
	const profile = await readJson("opencode/profile/opencode.jsonc");
	assert.equal(profile.permission.external_directory, undefined);
	assert.equal(profile.subagent_depth, 1);
	assert.ok(profile.instructions.includes("./tools/tool-execution.md"));
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

test("Review roles can read only the current repository's live Hunk session", async () => {
	for (const agentName of ["review", "reviewer"]) {
		const { nested } = parseAgentPermissions(await readAgent(agentName));
		const bashRules = nested.get("bash");
		const broadDenyIndex = bashRules.findIndex(
			(rule) => rule.pattern === "hunk *" && rule.action === "deny",
		);
		assert.ok(broadDenyIndex >= 0, `${agentName} must deny broad Hunk commands`);

		for (const safePattern of hunkReadPatterns) {
			const allowIndex = bashRules.findIndex(
				(rule) => rule.pattern === safePattern && rule.action === "allow",
			);
			assert.ok(allowIndex > broadDenyIndex, `${agentName} cannot run ${safePattern}`);
		}
		assert.ok(!bashRules.some((rule) => rule.pattern === "hunk session list --json" && rule.action === "allow"));
		assert.ok(!bashRules.some((rule) => /hunk session (?:get|context|review) \*/.test(rule.pattern)));

		const skillRules = nested.get("skill");
		assert.ok(
			skillRules.some((rule) => rule.pattern === "hunk-review" && rule.action === "allow"),
			`${agentName} cannot load hunk-review`,
		);
	}
});

test("only primary Review may request non-destructive Hunk annotations", async () => {
	const reviewRules = parseAgentPermissions(await readAgent("review")).nested.get("bash");
	for (const pattern of ["hunk session navigate --repo . *", "hunk session comment add --repo . *"]) {
		assert.ok(
			reviewRules.some((rule) => rule.pattern === pattern && rule.action === "ask"),
			`Review must ask before ${pattern}`,
		);
	}

	const reviewerRules = parseAgentPermissions(await readAgent("reviewer")).nested.get("bash");
	assert.ok(!reviewerRules.some((rule) => rule.action !== "deny" && /navigate|comment add/.test(rule.pattern)));

	for (const agentName of ["review", "reviewer"]) {
		const bashRules = parseAgentPermissions(await readAgent(agentName)).nested.get("bash");
		for (const pattern of hunkStateMutationPatterns) {
			assert.ok(
				bashRules.some((rule) => rule.pattern === pattern && rule.action === "deny"),
				`${agentName} must deny ${pattern}`,
			);
		}
		for (const pattern of ["hunk *>*", "hunk *<*", "hunk *|*", "hunk *&*", "hunk *;*", "hunk *$(*", "hunk *`*"]) {
			assert.ok(
				bashRules.some((rule) => rule.pattern === pattern && rule.action === "deny"),
				`${agentName} must deny shell escape pattern ${pattern}`,
			);
		}
	}
});

test("primary agents share writing guidance for communication used outside chat", async () => {
	const workflow = await readFile(path.join(profileDirectory, "tools/lean-workflow.md"), "utf8");
	const writing = await readFile(path.join(profileDirectory, "skills/writing/SKILL.md"), "utf8");

	assert.match(workflow, /communication intended for use outside the current chat/);
	assert.match(writing, /any communication intended for use outside the current chat/);

	const primaryAgents = await listPrimaryAgentNames();
	assert.ok(primaryAgents.length > 0, "the profile must define at least one primary agent");

	for (const agentName of primaryAgents) {
		const { nested } = parseAgentPermissions(await readAgent(agentName));
		const skillRules = nested.get("skill");
		for (const skillName of ["writing", "no-ai-slop"]) {
			assert.ok(
				skillRules.some((rule) => rule.pattern === skillName && rule.action === "allow"),
				`${agentName} cannot load ${skillName}`,
			);
		}
	}
});

test("retired primary agents stay removed", async () => {
	for (const agentName of ["writer", "workspace-manager"]) {
		await assert.rejects(readAgent(agentName), (error) => error?.code === "ENOENT");
	}
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

	const effectiveConfig = runJson("opencode", ["debug", "config"], { env: environment });
	assert.ok(
		effectiveConfig.plugin.some((plugin) => plugin.endsWith("/plugins/tool-execution-guard.js")),
		"OpenCode must discover the installed tool execution guard",
	);
	assert.ok(effectiveConfig.instructions.includes("./tools/tool-execution.md"));

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

test("work specs separate accepted intent from draft decisions and explicit handoff transport", async () => {
	const workSpec = await readFile(
		path.join(profileDirectory, "skills/work-spec/SKILL.md"),
		"utf8",
	);
	assert.match(workSpec, /User requests and explicit answers are accepted inputs/);
	assert.match(workSpec, /unresolved agent proposals remain draft decisions/);
	assert.match(workSpec, /include the finalized spec verbatim/);
	assert.match(workSpec, /explicitly requests a repository artifact/);
	assert.match(workSpec, /Do not silently change accepted decisions/);
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

test("the evaluation corpus is versioned and has explicit safety oracles", async () => {
	const corpus = await readJson("opencode/profile/evals/scenarios.json");
	assert.equal(corpus.version, 4);
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
