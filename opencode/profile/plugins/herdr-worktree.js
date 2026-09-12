import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";

import { createHerdrWorktreeOrchestrator } from "./herdr-worktree/core.js";
import { tool } from "./tool-definition/index.js";

const executeFile = promisify(execFile);

function profileLauncher(environment) {
	const profile = environment.OCX_PROFILE || "ws";
	if (!/^[A-Za-z0-9._-]+$/.test(profile)) throw new Error("OCX profile name is invalid.");
	return path.join(os.homedir(), ".config/opencode/profiles", profile, "bin/opencode-ws");
}

async function ensureLauncher(launcherPath) {
	const details = await stat(launcherPath);
	if (!details.isFile() || (details.mode & 0o111) === 0) {
		throw new Error(`Stable OpenCode launcher is unavailable at ${launcherPath}.`);
	}
}

function createHerdrRunner(environment) {
	const executable = environment.HERDR_BIN_PATH || "herdr";
	return async (args) => {
		let stdout;
		try {
			({ stdout } = await executeFile(executable, args, {
				encoding: "utf8",
				maxBuffer: 2 * 1024 * 1024,
				timeout: 30_000,
			}));
		} catch (error) {
			const stderr = typeof error?.stderr === "string" ? error.stderr.trim() : "";
			throw new Error(stderr || "Herdr command failed.", { cause: error });
		}

		const output = stdout.trim();
		if (!output) return undefined;
		try {
			return JSON.parse(output);
		} catch (error) {
			throw new Error("Herdr returned an unreadable response.", { cause: error });
		}
	};
}

function createShellWaiter(runHerdr) {
	return async (paneID) => {
		let idleObserved = false;
		for (let attempt = 0; attempt < 100; attempt += 1) {
			const response = await runHerdr(["pane", "process-info", "--pane", paneID]);
			const processInfo = response?.result?.process_info;
			const processes = processInfo?.foreground_processes;
			const idle = (
				Number.isInteger(processInfo?.shell_pid) &&
				Array.isArray(processes) &&
				processes.length === 1 &&
				processes[0]?.pid === processInfo.shell_pid
			);
			if (idle && idleObserved) return;
			idleObserved = idle;
			await sleep(idle ? 500 : 100);
		}
		throw new Error("Herdr worktree pane did not reach a stable idle shell.");
	};
}

export default async function HerdrWorktreePlugin({ worktree }) {
	const environment = process.env;
	const runHerdr = createHerdrRunner(environment);
	const orchestrator = createHerdrWorktreeOrchestrator({
		worktree,
		environment,
		runHerdr,
		launcherPath: profileLauncher(environment),
		ensureLauncher,
		waitForShell: createShellWaiter(runHerdr),
	});

	return {
		tool: {
			herdr_worktree_list: tool({
				description: "List Herdr-owned worktrees for the current repository without changing focus.",
				args: {},
				async execute() {
					return JSON.stringify(await orchestrator.list(), null, 2);
				},
			}),
			herdr_worktree_create: tool({
				description: "Create a Herdr-owned isolated worktree from an explicit branch and base, then start Build with the complete accepted work spec. Herdr chooses the path; focus is preserved by default.",
				args: {
					branch: tool.schema.string().describe("New branch name"),
					base: tool.schema.string().describe("Explicit base commit or branch"),
					label: tool.schema.string().optional().describe("Optional Herdr workspace label"),
					focus: tool.schema.boolean().optional().describe("Focus the new workspace only when the user requested it"),
					workSpec: tool.schema.string().describe("Complete accepted Markdown work spec to prefill verbatim"),
				},
				async execute(args) {
					return JSON.stringify(await orchestrator.create(args), null, 2);
				},
			}),
			herdr_worktree_open: tool({
				description: "Open an existing Herdr worktree by branch. Optionally start Build with a complete accepted work spec when its workspace has one idle shell pane.",
				args: {
					branch: tool.schema.string().describe("Existing worktree branch"),
					focus: tool.schema.boolean().optional().describe("Focus the workspace only when the user requested it"),
					workSpec: tool.schema.string().optional().describe("Complete accepted Markdown work spec when starting Build"),
				},
				async execute(args) {
					return JSON.stringify(await orchestrator.open(args), null, 2);
				},
			}),
			herdr_worktree_remove: tool({
				description: "Remove one linked Herdr worktree outside the source and current workspaces. Requires the exact workspace ID as confirmation and never removes after a partial launch failure automatically.",
				args: {
					workspaceID: tool.schema.string().describe("Herdr workspace ID returned by herdr_worktree_list"),
					confirmation: tool.schema.string().describe("Repeat the exact workspace ID to confirm removal"),
					force: tool.schema.boolean().optional().describe("Force removal only when the user explicitly approved it"),
				},
				async execute(args) {
					return JSON.stringify(await orchestrator.remove(args), null, 2);
				},
			}),
		},
	};
}
