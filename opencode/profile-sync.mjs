#!/usr/bin/env node

import { execFile } from "node:child_process";
import { chmod, cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

import { executeHerdr, quoteShellArgument, waitForPaneShell } from "./tui-plugins/herdr-tui.js";

const executeFile = promisify(execFile);
const PROFILE_NAME = "ws";
const DCP_PACKAGE = "@tarquinen/opencode-dcp@3.1.15";
const TUI_PLUGIN_FILES = ["herdr-tui.js", "hunk-review.js"];

function parseJsonDocument(contents, filePath) {
	try {
		return JSON.parse(contents);
	} catch (error) {
		throw new Error(`${filePath} must contain JSON-compatible JSONC: ${error.message}`);
	}
}

async function readJsonDocument(filePath) {
	return parseJsonDocument(await readFile(filePath, "utf8"), filePath);
}

export function createInstalledProfileConfig(sourceConfig, targetProfileDir) {
	if (
		sourceConfig.instructions !== undefined &&
		(!Array.isArray(sourceConfig.instructions) || sourceConfig.instructions.some((entry) => typeof entry !== "string"))
	) {
		throw new Error("Profile instructions must be an array of paths or URLs.");
	}
	if (
		sourceConfig.plugin !== undefined &&
		(!Array.isArray(sourceConfig.plugin) || sourceConfig.plugin.some((entry) => typeof entry !== "string"))
	) {
		throw new Error("Profile plugins must be an array of package specifications.");
	}

	return {
		...sourceConfig,
		...(sourceConfig.instructions === undefined ? {} : { instructions: sourceConfig.instructions.map((entry) => {
			if (path.isAbsolute(entry) || entry.startsWith("~") || /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(entry)) {
				return entry;
			}
			return path.resolve(targetProfileDir, entry);
		}) }),
		...(sourceConfig.plugin === undefined ? {} : { plugin: sourceConfig.plugin.map((entry) => (
			entry === DCP_PACKAGE
				? pathToFileURL(path.join(targetProfileDir, "node_modules/@tarquinen/opencode-dcp/dist/index.js")).href
				: entry
		)) }),
	};
}

export function createInstalledTuiConfig(sourceConfig, targetProfileDir) {
	if (
		sourceConfig.plugin !== undefined &&
		(!Array.isArray(sourceConfig.plugin) || sourceConfig.plugin.some((entry) => typeof entry !== "string"))
	) {
		throw new Error("TUI plugins must be an array of package specifications.");
	}
	return {
		...sourceConfig,
		...(sourceConfig.plugin === undefined ? {} : { plugin: sourceConfig.plugin.map((entry) => (
			entry === DCP_PACKAGE
				? pathToFileURL(path.join(targetProfileDir, "node_modules/@tarquinen/opencode-dcp/tui.tsx")).href
				: entry
		)) }),
	};
}

async function mirrorDirectory(sourceDirectory, targetDirectory) {
	const targetParent = path.dirname(targetDirectory);
	await mkdir(targetParent, { recursive: true });
	const stagingDirectory = await mkdtemp(path.join(targetParent, ".profile-sync-"));
	const stagedDirectory = path.join(stagingDirectory, "next");
	const previousDirectory = path.join(stagingDirectory, "previous");
	let previousDirectoryExists = false;

	try {
		await cp(sourceDirectory, stagedDirectory, { recursive: true, force: true });
		try {
			await rename(targetDirectory, previousDirectory);
			previousDirectoryExists = true;
		} catch (error) {
			if (error?.code !== "ENOENT") throw error;
		}

		try {
			await rename(stagedDirectory, targetDirectory);
		} catch (error) {
			if (previousDirectoryExists) await rename(previousDirectory, targetDirectory);
			throw error;
		}
	} finally {
		await rm(stagingDirectory, { recursive: true, force: true });
	}
}

export async function syncProfile({ sourceProfileDir, targetProfileDir }) {
	const sourceConfigPath = path.join(sourceProfileDir, "opencode.jsonc");
	const targetConfigPath = path.join(targetProfileDir, "opencode.jsonc");
	const sourceConfig = await readJsonDocument(sourceConfigPath);
	const sourceAgentDirectory = path.join(sourceProfileDir, "agents");
	const sourceDependencyDirectory = path.join(sourceProfileDir, "node_modules");
	const targetAgentDirectory = path.join(targetProfileDir, "agents");

	await mkdir(targetProfileDir, { recursive: true });
	await cp(sourceProfileDir, targetProfileDir, {
		recursive: true,
		force: true,
		filter: (sourcePath) =>
			!([
				sourceAgentDirectory,
				sourceDependencyDirectory,
			].some((excludedDirectory) => (
				sourcePath === excludedDirectory || sourcePath.startsWith(`${excludedDirectory}${path.sep}`)
			))),
	});
	await writeFile(
		targetConfigPath,
		`${JSON.stringify(createInstalledProfileConfig(sourceConfig, targetProfileDir), null, "\t")}\n`,
	);
	await mirrorDirectory(sourceAgentDirectory, targetAgentDirectory);

	const launcherPath = path.join(targetProfileDir, "bin/opencode-ws");
	await chmod(launcherPath, 0o755);
	return { launcherPath };
}

export async function installProfileDependencies({
	profileDirectory,
	execute = executeFile,
}) {
	await execute(
		"npm",
		["ci", "--ignore-scripts", "--no-audit", "--no-fund"],
		{
			cwd: profileDirectory,
			encoding: "utf8",
			maxBuffer: 2 * 1024 * 1024,
		},
	);
}

export function planIdleSessionRefresh(agents, { currentPaneID, profileName = PROFILE_NAME } = {}) {
	if (!Array.isArray(agents)) throw new Error("Herdr returned an invalid agent list.");

	const refreshable = [];
	const deferred = [];
	for (const agent of agents) {
		if (agent?.agent !== "opencode" || agent.profile !== profileName) continue;

		const paneID = agent.pane_id;
		if (typeof paneID !== "string" || paneID.length === 0) continue;
		if (paneID === currentPaneID) {
			deferred.push({ paneID, reason: "current pane" });
			continue;
		}
		if (agent.agent_status !== "idle" && agent.agent_status !== "done") {
			deferred.push({ paneID, reason: agent.agent_status ?? "unknown state" });
			continue;
		}

		const sessionID = agent.agent_session?.value;
		if (typeof sessionID !== "string" || sessionID.length === 0) {
			deferred.push({ paneID, reason: "missing session ID" });
			continue;
		}
		refreshable.push({ paneID, sessionID });
	}
	return { refreshable, deferred };
}

export async function refreshIdleSessions({
	sessions,
	launcherPath,
	sendInterrupt,
	waitForShell,
	runInPane,
}) {
	const refreshed = [];
	const failed = [];
	for (const { paneID, sessionID } of sessions) {
		try {
			await sendInterrupt(paneID);
			await waitForShell(paneID);
			const command = `${quoteShellArgument(launcherPath)} --session ${quoteShellArgument(sessionID)}`;
			await runInPane(paneID, command);
			refreshed.push(paneID);
		} catch (error) {
			failed.push({
				paneID,
				reason: error instanceof Error ? error.message : "refresh failed",
			});
		}
	}
	return { refreshed, failed };
}

async function syncTuiFiles({ repositoryRoot, openCodeConfigDir, targetProfileDir }) {
	const sourcePluginDirectory = path.join(repositoryRoot, "opencode/tui-plugins");
	const targetPluginDirectory = path.join(openCodeConfigDir, "tui-plugins");
	await mkdir(targetPluginDirectory, { recursive: true });
	for (const fileName of TUI_PLUGIN_FILES) {
		await cp(path.join(sourcePluginDirectory, fileName), path.join(targetPluginDirectory, fileName), {
			force: true,
		});
	}
	const sourceTuiConfig = await readJsonDocument(path.join(repositoryRoot, "opencode/tui.jsonc"));
	const installedTuiConfig = createInstalledTuiConfig(sourceTuiConfig, targetProfileDir);
	await writeFile(
		path.join(openCodeConfigDir, "tui.jsonc"),
		`${JSON.stringify(installedTuiConfig, null, "  ")}\n`,
	);
}

async function listHerdrAgents() {
	const response = await executeHerdr(["agent", "list"]);
	return response?.result?.agents;
}

async function profileForOpenCodeAgent(agent, targetProfileDir) {
	if (agent?.agent !== "opencode") return undefined;

	try {
		const response = await executeHerdr(["pane", "process-info", "--pane", agent.pane_id]);
		const foregroundProcesses = response?.result?.process_info?.foreground_processes;
		if (!Array.isArray(foregroundProcesses)) return undefined;

		const openCodeProcess = foregroundProcesses.find((process) => process?.name === "opencode");
		if (!Number.isInteger(openCodeProcess?.pid)) return undefined;

		const { stdout } = await executeFile(
			"ps",
			["eww", "-p", String(openCodeProcess.pid), "-o", "command="],
			{ encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
		);
		const profileMatch = stdout.match(/(?:^|\s)OCX_PROFILE=([^\s]+)/);
		if (profileMatch) return profileMatch[1];

		const configDirectoryMatch = stdout.match(/(?:^|\s)OPENCODE_CONFIG_DIR=([^\s]+)/);
		if (configDirectoryMatch && path.resolve(configDirectoryMatch[1]) === path.resolve(targetProfileDir)) {
			return PROFILE_NAME;
		}
		return undefined;
	} catch {
		return undefined;
	}
}

async function annotateAgentProfiles(agents, targetProfileDir) {
	return Promise.all(
		agents.map(async (agent) => ({
			...agent,
			profile: await profileForOpenCodeAgent(agent, targetProfileDir),
		})),
	);
}

function formatRefreshSummary({ refreshed, deferred, failed }) {
	const lines = ["OpenCode profile synchronized."];
	lines.push(`Refreshed idle sessions: ${refreshed.length}.`);
	if (deferred.length > 0) {
		lines.push(`Deferred sessions: ${deferred.map(({ paneID, reason }) => `${paneID} (${reason})`).join(", ")}.`);
	}
	if (failed.length > 0) {
		lines.push(`Failed refreshes: ${failed.map(({ paneID, reason }) => `${paneID} (${reason})`).join(", ")}.`);
	}
	return lines.join("\n");
}

export async function main({ environment = process.env } = {}) {
	const repositoryRoot = path.resolve(import.meta.dirname, "..");
	const openCodeConfigDir = path.join(os.homedir(), ".config/opencode");
	const targetProfileDir = path.join(openCodeConfigDir, "profiles", PROFILE_NAME);
	const { launcherPath } = await syncProfile({
		sourceProfileDir: path.join(repositoryRoot, "opencode/profile"),
		targetProfileDir,
	});
	await installProfileDependencies({ profileDirectory: targetProfileDir });
	await syncTuiFiles({ repositoryRoot, openCodeConfigDir, targetProfileDir });

	let refreshed = [];
	let deferred = [];
	let failed = [];
	if (environment.HERDR_ENV === "1") {
		const agents = await annotateAgentProfiles(await listHerdrAgents(), targetProfileDir);
		const refreshPlan = planIdleSessionRefresh(agents, {
			currentPaneID: environment.HERDR_PANE_ID,
		});
		deferred = refreshPlan.deferred;
		({ refreshed, failed } = await refreshIdleSessions({
			sessions: refreshPlan.refreshable,
			launcherPath,
			sendInterrupt: (paneID) => executeHerdr(["agent", "send-keys", paneID, "ctrl+c"]),
			waitForShell: (paneID) => waitForPaneShell(executeHerdr, paneID),
			runInPane: (paneID, command) => executeHerdr(["pane", "run", paneID, command]),
		}));
	}

	process.stdout.write(`${formatRefreshSummary({ refreshed, deferred, failed })}\n`);
}

const isExecutedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isExecutedDirectly) {
	main().catch((error) => {
		process.stderr.write(`Profile sync failed: ${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	});
}
