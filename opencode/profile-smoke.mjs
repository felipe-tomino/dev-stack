#!/usr/bin/env node

import { execFile, spawn } from "node:child_process";
import { access, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
	createInstalledProfileConfig,
	installProfileDependencies,
	syncProfile,
} from "./profile-sync.mjs";

const executeFile = promisify(execFile);
const DCP_PACKAGE = "@tarquinen/opencode-dcp@3.1.15";
const DCP_DEPENDENCY = "@tarquinen/opencode-dcp";
const DCP_VERSION = "3.1.15";
const OPENCODE_PLUGIN_VERSION = "1.4.3";
const ZOD_VERSION = "4.1.8";
const EXPECTED_RUNTIME_TOOL_IDS = Object.freeze([
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
]);
const EXPECTED_AGENTS = Object.freeze([
	"build",
	"explore",
	"plan",
	"research",
	"researcher",
	"review",
	"reviewer",
	"web-researcher",
]);
const EXPECTED_AGENT_FINGERPRINTS = Object.freeze({
	build: { mode: "primary", reasoningEffort: "high", textVerbosity: "low" },
	explore: { mode: "subagent", reasoningEffort: "medium", textVerbosity: "medium" },
	plan: { mode: "primary", reasoningEffort: "high", textVerbosity: "low" },
	research: { mode: "primary", reasoningEffort: "medium", textVerbosity: "medium" },
	researcher: { mode: "subagent", reasoningEffort: "medium", textVerbosity: "medium" },
	review: { mode: "primary", reasoningEffort: "high", textVerbosity: "medium" },
	reviewer: { mode: "subagent", reasoningEffort: "high", textVerbosity: "medium" },
	"web-researcher": { mode: "subagent", reasoningEffort: "medium", textVerbosity: "medium" },
});
const REPOSITORY_OWNED_SKILLS = Object.freeze([
	"code-philosophy",
	"code-review",
	"frontend-philosophy",
	"testing-philosophy",
]);

async function readJson(filePath) {
	return JSON.parse(await readFile(filePath, "utf8"));
}

async function listRelativeFiles(directory, relativeDirectory = "") {
	const entries = await readdir(path.join(directory, relativeDirectory), { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		if (relativeDirectory === "" && entry.name === "node_modules") continue;
		const relativePath = path.join(relativeDirectory, entry.name);
		if (entry.isDirectory()) {
			files.push(...await listRelativeFiles(directory, relativePath));
			continue;
		}
		if (entry.isFile()) files.push(relativePath);
	}
	return files.sort();
}

async function componentNames(directory, extension) {
	const entries = await readdir(directory, { withFileTypes: true });
	return entries
		.filter((entry) => entry.isFile() && entry.name.endsWith(extension))
		.map((entry) => entry.name.slice(0, -extension.length))
		.sort();
}

async function skillNames(directory) {
	const entries = await readdir(directory, { withFileTypes: true });
	const names = [];
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		try {
			await access(path.join(directory, entry.name, "SKILL.md"));
			names.push(entry.name);
		} catch (error) {
			if (error?.code !== "ENOENT") throw error;
		}
	}
	return names.sort();
}

async function compareInstalledFiles(sourceProfileDirectory, targetProfileDirectory) {
	const [sourceFiles, targetFiles] = await Promise.all([
		listRelativeFiles(sourceProfileDirectory),
		listRelativeFiles(targetProfileDirectory),
	]);
	if (sourceFiles.length !== targetFiles.length) {
		throw new Error("Installed profile file count does not match the repository profile.");
	}

	let mismatched = 0;
	for (let index = 0; index < sourceFiles.length; index += 1) {
		if (sourceFiles[index] !== targetFiles[index]) {
			throw new Error(`Installed profile inventory differs at ${sourceFiles[index]}.`);
		}
		const [source, target] = await Promise.all([
			readFile(path.join(sourceProfileDirectory, sourceFiles[index])),
			readFile(path.join(targetProfileDirectory, targetFiles[index])),
		]);
		if (sourceFiles[index] === "opencode.jsonc") {
			const sourceConfig = JSON.parse(source.toString("utf8"));
			const targetConfig = JSON.parse(target.toString("utf8"));
			if (JSON.stringify(targetConfig) !== JSON.stringify(createInstalledProfileConfig(
				sourceConfig,
				targetProfileDirectory,
			))) {
				mismatched += 1;
			}
			continue;
		}
		if (!source.equals(target)) mismatched += 1;
	}
	if (mismatched > 0) throw new Error(`${mismatched} installed profile files differ from source.`);
	return { source: sourceFiles.length, installed: targetFiles.length, mismatched };
}

export async function runDeterministicSmoke({ repositoryRoot, temporaryRoot }) {
	const sourceProfileDirectory = path.join(repositoryRoot, "opencode/profile");
	const targetProfileDirectory = path.join(temporaryRoot, "profiles/ws");
	const { launcherPath } = await syncProfile({
		sourceProfileDir: sourceProfileDirectory,
		targetProfileDir: targetProfileDirectory,
	});

	const [profile, profilePackage, dcp, tui, agents, skills, commands, plugins, launcherDetails, files] = await Promise.all([
		readJson(path.join(targetProfileDirectory, "opencode.jsonc")),
		readJson(path.join(targetProfileDirectory, "package.json")),
		readJson(path.join(targetProfileDirectory, "dcp.jsonc")),
		readJson(path.join(repositoryRoot, "opencode/tui.jsonc")),
		componentNames(path.join(targetProfileDirectory, "agents"), ".md"),
		skillNames(path.join(targetProfileDirectory, "skills")),
		componentNames(path.join(targetProfileDirectory, "commands"), ".md"),
		componentNames(path.join(targetProfileDirectory, "plugins"), ".js"),
		stat(launcherPath),
		compareInstalledFiles(sourceProfileDirectory, targetProfileDirectory),
	]);
	if (profilePackage.dependencies?.zod !== ZOD_VERSION) {
		throw new Error(`The profile must pin zod to ${ZOD_VERSION}.`);
	}
	if (profilePackage.dependencies?.[DCP_DEPENDENCY] !== DCP_VERSION) {
		throw new Error(`The profile must install ${DCP_DEPENDENCY} at ${DCP_VERSION}.`);
	}
	if (profilePackage.dependencies?.["@opencode-ai/plugin"] !== OPENCODE_PLUGIN_VERSION) {
		throw new Error(`The profile must install @opencode-ai/plugin at ${OPENCODE_PLUGIN_VERSION}.`);
	}

	if (JSON.stringify(agents) !== JSON.stringify(EXPECTED_AGENTS)) {
		throw new Error(`Installed agents differ from the expected profile: ${agents.join(", ")}.`);
	}
	const dcpServerEntry = pathToFileURL(path.join(
		targetProfileDirectory,
		"node_modules/@tarquinen/opencode-dcp/dist/index.js",
	)).href;
	if (
		profile.plugin?.at(-1) !== dcpServerEntry ||
		tui.plugin?.at(-1) !== DCP_PACKAGE ||
		dcp.enabled !== true ||
		dcp.manualMode?.enabled !== true ||
		dcp.manualMode?.automaticStrategies !== false
	) {
		throw new Error("DCP registration or conservative startup policy differs from the profile contract.");
	}

	return {
		tier: "deterministic",
		profile: {
			defaultAgent: profile.default_agent,
			model: profile.model,
			smallModel: profile.small_model,
			subagentDepth: profile.subagent_depth,
			instructions: profile.instructions,
		},
		agents,
		skills,
		commands,
		plugins,
		dependencies: {
			dcp: profilePackage.dependencies[DCP_DEPENDENCY],
			openCodePlugin: profilePackage.dependencies["@opencode-ai/plugin"],
			zod: profilePackage.dependencies.zod,
		},
		dcp: {
			package: DCP_PACKAGE,
			serverRegistration: dcpServerEntry,
			tuiRegistration: tui.plugin.at(-1),
			manualMode: dcp.manualMode.enabled,
			automaticStrategies: dcp.manualMode.automaticStrategies,
		},
		launcher: {
			path: launcherPath,
			executable: (launcherDetails.mode & 0o111) !== 0,
		},
		files,
		targetProfileDirectory,
	};
}

function parseCommandJson(commandName, stdout) {
	try {
		return JSON.parse(stdout);
	} catch (error) {
		throw new Error(`${commandName} did not return valid JSON.`, { cause: error });
	}
}

function hasPermission(agent, permission, action) {
	const matching = agent.permission?.filter((rule) => (
		rule.permission === permission &&
		rule.pattern === "*"
	));
	return matching?.at(-1)?.action === action;
}

function isInstalledDcpServerEntry(entry) {
	return (
		typeof entry === "string" &&
		entry.startsWith("file://") &&
		entry.endsWith("/node_modules/@tarquinen/opencode-dcp/dist/index.js")
	);
}

async function availablePort() {
	const server = createServer();
	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	const address = server.address();
	await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
	if (!address || typeof address === "string") throw new Error("Could not reserve a local port for OpenCode.");
	return address.port;
}

function delay(milliseconds) {
	return new Promise((resolve) => {
		const timer = setTimeout(resolve, milliseconds);
		timer.unref();
	});
}

function waitForExit(child) {
	return new Promise((resolve) => child.once("exit", resolve));
}

async function stopServer(child) {
	if (child.exitCode !== null || child.signalCode !== null) return;
	const exited = waitForExit(child);
	child.kill("SIGTERM");
	await Promise.race([exited, delay(2_000)]);
	if (child.exitCode !== null || child.signalCode !== null) return;
	child.kill("SIGKILL");
	await exited;
}

function parseToolIDs(value) {
	if (!Array.isArray(value) || value.some((toolID) => typeof toolID !== "string")) {
		throw new Error("OpenCode returned an invalid tool ID catalog.");
	}
	return value;
}

function parseSkills(value) {
	if (
		!Array.isArray(value) ||
		value.some((skill) => (
			!skill ||
			typeof skill !== "object" ||
			typeof skill.name !== "string" ||
			typeof skill.location !== "string"
		))
	) {
		throw new Error("OpenCode returned an invalid skill catalog.");
	}
	return value;
}

export async function readRuntimeCatalog({ launcher, executionOptions, directory, spawnProcess = spawn }) {
	const port = await availablePort();
	const serverUsername = "profile-smoke";
	const serverPassword = `profile-smoke-${process.pid}-${port}`;
	const child = spawnProcess(
		launcher,
		["serve", "--hostname", "127.0.0.1", "--port", String(port)],
		{
			cwd: executionOptions.cwd,
			env: {
				...executionOptions.env,
				OPENCODE_SERVER_USERNAME: serverUsername,
				OPENCODE_SERVER_PASSWORD: serverPassword,
			},
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
	let diagnostics = "";
	let spawnError;
	child.once("error", (error) => { spawnError = error; });
	child.stdout?.on("data", (chunk) => { diagnostics += chunk.toString(); });
	child.stderr?.on("data", (chunk) => { diagnostics += chunk.toString(); });
	const endpoint = new URL("/experimental/tool/ids", `http://127.0.0.1:${port}`);
	endpoint.searchParams.set("directory", directory);
	const skillEndpoint = new URL("/skill", endpoint);
	skillEndpoint.searchParams.set("directory", directory);
	const headers = {
		Authorization: `Basic ${Buffer.from(`${serverUsername}:${serverPassword}`).toString("base64")}`,
	};
	const deadline = Date.now() + 20_000;

	try {
		while (Date.now() < deadline) {
			if (spawnError) throw spawnError;
			if (child.exitCode !== null || child.signalCode !== null) {
				throw new Error("OpenCode exited before publishing its tools.");
			}
			try {
				const response = await fetch(endpoint, { headers });
				if (!response.ok) throw new Error(`HTTP ${response.status}`);
				const toolIDs = parseToolIDs(await response.json());
				const skillResponse = await fetch(skillEndpoint, { headers });
				if (!skillResponse.ok) throw new Error(`Skill catalog HTTP ${skillResponse.status}`);
				const skills = parseSkills(await skillResponse.json());
				if (/failed to load plugin/iu.test(diagnostics)) {
					throw new Error("OpenCode reported a plugin load failure.");
				}
				return { toolIDs, skills };
			} catch (error) {
				if (Date.now() >= deadline) throw error;
				await delay(100);
			}
		}
		throw new Error("OpenCode did not publish its tool catalog within 20 seconds.");
	} catch (error) {
		const detail = diagnostics.trim().slice(-4_000);
		throw new Error(`Could not read OpenCode's tool catalog: ${error.message}.${detail ? ` ${detail}` : ""}`);
	} finally {
		await stopServer(child);
	}
}

export async function runRuntimeSmoke({
	deterministicResult,
	repositoryRoot,
	execute = executeFile,
	installDependencies = installProfileDependencies,
	readCatalog = readRuntimeCatalog,
	opencodeExecutable = "opencode",
	ocxExecutable = "ocx",
}) {
	await installDependencies({ profileDirectory: deterministicResult.targetProfileDirectory });
	const launcher = deterministicResult.launcher.path;
	const executionOptions = {
		cwd: path.resolve(deterministicResult.targetProfileDirectory, "../.."),
		env: {
			...process.env,
			OPENCODE_REAL_BIN: opencodeExecutable,
			OPENCODE_PROFILE_DIR: deterministicResult.targetProfileDirectory,
		},
		maxBuffer: 20 * 1024 * 1024,
	};
	const outputs = await Promise.all([
		execute(launcher, ["debug", "config"], executionOptions),
		...EXPECTED_AGENTS.map((agentName) => (
			execute(launcher, ["debug", "agent", agentName], executionOptions)
		)),
		execute(ocxExecutable, ["config", "show", "--profile", "ws", "--json"], {
			cwd: repositoryRoot,
			maxBuffer: 20 * 1024 * 1024,
		}),
	]);
	const configOutput = outputs[0];
	const agentOutputs = outputs.slice(1, 1 + EXPECTED_AGENTS.length);
	const ocxOutput = outputs.at(-1);

	const config = parseCommandJson("opencode debug config", configOutput.stdout);
	const resolvedAgents = Object.fromEntries(EXPECTED_AGENTS.map((agentName, index) => [
		agentName,
		parseCommandJson(`opencode debug agent ${agentName}`, agentOutputs[index].stdout),
	]));
	const buildAgent = resolvedAgents.build;
	const reviewAgent = resolvedAgents.review;
	const ocxConfig = parseCommandJson("ocx config show", ocxOutput.stdout);
	const { toolIDs, skills } = await readCatalog({
		launcher,
		executionOptions,
		directory: repositoryRoot,
	});
	const missingRuntimeToolIDs = EXPECTED_RUNTIME_TOOL_IDS.filter((toolID) => !toolIDs.includes(toolID));
	if (missingRuntimeToolIDs.length > 0) {
		throw new Error(`OpenCode did not publish expected runtime tools: ${missingRuntimeToolIDs.join(", ")}.`);
	}
	const customToolsPublished = true;
	const dcpToolPublished = toolIDs.includes("compress");
	const profile = deterministicResult.profile;
	if (
		config.default_agent !== profile.defaultAgent ||
		config.model !== profile.model ||
		config.small_model !== profile.smallModel ||
		JSON.stringify(config.instructions) !== JSON.stringify(profile.instructions) ||
		config.command?.review?.agent !== "review" ||
		config.command?.review?.subtask !== false ||
		config.permission?.external_directory !== undefined
	) {
		throw new Error("Resolved OpenCode profile identity differs from the repository fingerprint.");
	}
	for (const [agentName, expected] of Object.entries(EXPECTED_AGENT_FINGERPRINTS)) {
		const agent = resolvedAgents[agentName];
		if (
			agent.name !== agentName ||
			agent.mode !== expected.mode ||
			agent.options?.reasoningEffort !== expected.reasoningEffort ||
			agent.options?.textVerbosity !== expected.textVerbosity ||
			(agent.model !== undefined && agent.model !== profile.model)
		) {
			throw new Error(`Resolved ${agentName} identity, mode, model, or options differ from the fingerprint.`);
		}
	}

	const pluginLoaded = config.plugin?.some((plugin) => (
		typeof plugin === "string" && plugin.endsWith("/plugins/session-work-spec.js")
	));
	const dcpLoaded = config.plugin?.includes(deterministicResult.dcp.serverRegistration);
	const githubSourcePluginLoaded = config.plugin?.some((plugin) => (
		typeof plugin === "string" && plugin.endsWith("/plugins/github-source-read.js")
	));
	const herdrWorktreePluginLoaded = config.plugin?.some((plugin) => (
		typeof plugin === "string" && plugin.endsWith("/plugins/herdr-worktree.js")
	));
	const inheritedGitHubMcpDisabled = config.mcp?.["github-read"]?.enabled === false;
	const buildCanReadWorkSpec = hasPermission(buildAgent, "work_spec_read", "allow");
	const buildCanWriteWorkSpec = hasPermission(buildAgent, "work_spec_write", "allow");
	const buildAsksToCompress = hasPermission(buildAgent, "compress", "ask");
	const buildCanListWorktrees = hasPermission(buildAgent, "herdr_worktree_list", "allow");
	const buildAsksForWorktreeLifecycle = ["create", "open", "remove"].every((operation) => (
		hasPermission(buildAgent, `herdr_worktree_${operation}`, "ask")
	));
	const reviewCanReadGitHubSource = hasPermission(reviewAgent, "github_source_*", "allow");
	const testingPhilosophyLoaded = skills.some((skill) => skill.name === "testing-philosophy");
	const expectedSkillsLoaded = deterministicResult.skills.every((skillName) => (
		skills.some((skill) => skill.name === skillName)
	));
	const ownedSkillsUseInstalledProfile = REPOSITORY_OWNED_SKILLS.every((skillName) => (
		skills.some((skill) => (
			skill.name === skillName && skill.location.startsWith(deterministicResult.targetProfileDirectory)
		))
	));
	const pluginInventoryLoaded = deterministicResult.plugins.every((pluginName) => (
		config.plugin?.some((plugin) => (
			typeof plugin === "string" && plugin.endsWith(`/plugins/${pluginName}.js`)
		))
	));
	const dcpCommandLoaded = (
		config.command?.["dcp-compress"]?.template === "" &&
		config.command?.["dcp-compress"]?.description === "Trigger DCP manual compression with: /dcp-compress [focus]"
	);
	const childModesAreReadOnly = ["explore", "researcher", "reviewer", "web-researcher"].every((agentName) => (
		resolvedAgents[agentName].tools?.edit !== true &&
		resolvedAgents[agentName].tools?.apply_patch !== true &&
		resolvedAgents[agentName].tools?.task === false
	));
	const webResearcherIsLocallyIsolated = (
		resolvedAgents["web-researcher"].tools?.read === false &&
		!hasPermission(resolvedAgents["web-researcher"], "github_source_*", "allow") &&
		!hasPermission(resolvedAgents["web-researcher"], "work_spec_read", "allow")
	);
	if (
		!pluginLoaded ||
		!dcpLoaded ||
		!dcpToolPublished ||
		!githubSourcePluginLoaded ||
		!herdrWorktreePluginLoaded ||
		!inheritedGitHubMcpDisabled ||
		!buildCanReadWorkSpec ||
		!buildCanWriteWorkSpec ||
		!buildAsksToCompress ||
		!buildCanListWorktrees ||
		!buildAsksForWorktreeLifecycle ||
		!reviewCanReadGitHubSource ||
		!testingPhilosophyLoaded ||
		!expectedSkillsLoaded ||
		!ownedSkillsUseInstalledProfile ||
		!pluginInventoryLoaded ||
		!dcpCommandLoaded ||
		!childModesAreReadOnly ||
		!webResearcherIsLocallyIsolated
	) {
		throw new Error(`Resolved OpenCode components differ from the repository profile contract: ${JSON.stringify({
			pluginLoaded,
			dcpLoaded,
			dcpToolPublished,
			githubSourcePluginLoaded,
			herdrWorktreePluginLoaded,
			inheritedGitHubMcpDisabled,
			buildCanReadWorkSpec,
			buildCanWriteWorkSpec,
			buildAsksToCompress,
			buildCanListWorktrees,
			buildAsksForWorktreeLifecycle,
			reviewCanReadGitHubSource,
			testingPhilosophyLoaded,
			expectedSkillsLoaded,
			ownedSkillsUseInstalledProfile,
			pluginInventoryLoaded,
			dcpCommandLoaded,
			customToolsPublished,
			childModesAreReadOnly,
			webResearcherIsLocallyIsolated,
		})}.`);
	}

	const installedPolicyMatched = (
		ocxConfig.opencode?.plugin?.some(isInstalledDcpServerEntry) &&
		ocxConfig.opencode?.permission?.work_spec_read === "deny" &&
		ocxConfig.opencode?.permission?.work_spec_write === "deny" &&
		ocxConfig.opencode?.permission?.["github_source_*"] === "deny" &&
		ocxConfig.opencode?.permission?.["herdr_worktree_*"] === "deny" &&
		ocxConfig.opencode?.mcp?.["github-read"]?.enabled === false
	);
	if (
		ocxConfig.profileName !== "ws" ||
		ocxConfig.opencode?.default_agent !== profile.defaultAgent ||
		ocxConfig.opencode?.model !== profile.model ||
		ocxConfig.opencode?.small_model !== profile.smallModel ||
		!installedPolicyMatched
	) {
		throw new Error("Resolved OCX profile identity differs from the repository fingerprint.");
	}

	return {
		tier: "runtime",
		openCode: {
			pluginLoaded,
			dcpLoaded,
			dcpToolPublished,
			githubSourcePluginLoaded,
			herdrWorktreePluginLoaded,
			inheritedGitHubMcpDisabled,
			buildCanReadWorkSpec,
			buildCanWriteWorkSpec,
			buildAsksToCompress,
			buildCanListWorktrees,
			buildAsksForWorktreeLifecycle,
			reviewCanReadGitHubSource,
			testingPhilosophyLoaded,
			expectedSkillsLoaded,
			ownedSkillsUseInstalledProfile,
			pluginInventoryLoaded,
			dcpCommandLoaded,
			customToolsPublished,
			childModesAreReadOnly,
			webResearcherIsLocallyIsolated,
		},
		ocx: {
			profileName: ocxConfig.profileName,
			policyMatched: installedPolicyMatched,
			defaultAgent: ocxConfig.opencode.default_agent,
			model: ocxConfig.opencode.model,
			smallModel: ocxConfig.opencode.small_model,
		},
	};
}

async function main() {
	const runtime = process.argv.slice(2).includes("--runtime");
	const unsupportedArguments = process.argv.slice(2).filter((argument) => argument !== "--runtime");
	if (unsupportedArguments.length > 0) {
		throw new Error(`Unsupported smoke arguments: ${unsupportedArguments.join(", ")}.`);
	}
	const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
	const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "profile-smoke-"));
	try {
		const deterministicResult = await runDeterministicSmoke({ repositoryRoot, temporaryRoot });
		const result = runtime
			? {
				deterministic: deterministicResult,
				runtime: await runRuntimeSmoke({ deterministicResult, repositoryRoot }),
			}
			: deterministicResult;
		process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
	} finally {
		await rm(temporaryRoot, { recursive: true, force: true });
	}
}

const isExecutedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isExecutedDirectly) {
	main().catch((error) => {
		process.stderr.write(`Profile smoke failed: ${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	});
}
