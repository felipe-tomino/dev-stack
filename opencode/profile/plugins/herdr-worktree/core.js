const MAX_WORK_SPEC_BYTES = 32 * 1024;
const WORKSPACE_ID = /^w[A-Za-z0-9]+$/;

function requireHerdr(environment) {
	if (
		environment.HERDR_ENV !== "1" ||
		!environment.HERDR_SOCKET_PATH ||
		!environment.HERDR_WORKSPACE_ID ||
		!environment.HERDR_PANE_ID
	) {
		throw new Error("Worktree orchestration must run inside a Herdr-managed pane.");
	}
}

function validateRef(value, label) {
	if (
		typeof value !== "string" ||
		value.length === 0 ||
		value.length > 255 ||
		value.startsWith("-") ||
		value.startsWith("/") ||
		value.endsWith("/") ||
		value.endsWith(".") ||
		value.includes("..") ||
		value.includes("@{") ||
		value.includes("//") ||
		/[\x00-\x20~^:?*[\\]/.test(value) ||
		value.split("/").some((segment) => segment.endsWith(".lock"))
	) {
		throw new Error(`${label} is an invalid Git ref.`);
	}
	return value;
}

function validateLabel(value) {
	if (value === undefined) return undefined;
	if (typeof value !== "string" || value.length === 0 || value.length > 80 || /[\x00-\x1f\x7f]/.test(value)) {
		throw new Error("Worktree label must be 1 to 80 printable characters.");
	}
	return value;
}

function validateWorkSpec(value) {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error("A complete accepted work spec is required to launch Build in a worktree.");
	}
	if (Buffer.byteLength(value, "utf8") > MAX_WORK_SPEC_BYTES) {
		throw new Error(`Work spec exceeds the ${MAX_WORK_SPEC_BYTES}-byte limit.`);
	}
	return value;
}

function validateWorkspaceID(value) {
	if (typeof value !== "string" || !WORKSPACE_ID.test(value)) {
		throw new Error("Herdr workspace ID is invalid.");
	}
	return value;
}

function parseWorktreeList(response, worktree) {
	const source = response?.result?.source;
	const entries = response?.result?.worktrees;
	if (
		source?.repo_root !== worktree ||
		source?.source_checkout_path !== worktree ||
		typeof source?.source_workspace_id !== "string" ||
		!Array.isArray(entries)
	) {
		throw new Error("Herdr returned an unreadable or cross-repository worktree list.");
	}
	return {
		sourceWorkspaceID: source.source_workspace_id,
		worktrees: entries.map((entry) => ({
			branch: entry.branch,
			path: entry.path,
			workspaceID: entry.open_workspace_id,
			isLinked: entry.is_linked_worktree === true,
			isBare: entry.is_bare === true,
			isDetached: entry.is_detached === true,
			isPrunable: entry.is_prunable === true,
			label: entry.label,
		})),
	};
}

function requireOpenWorktree(worktrees, branch) {
	const matches = worktrees.filter((entry) => entry.branch === branch);
	if (matches.length !== 1) {
		throw new Error(`Herdr did not return exactly one worktree for branch ${branch}.`);
	}
	const [entry] = matches;
	if (
		!entry.isLinked ||
		typeof entry.path !== "string" ||
		!entry.path.startsWith("/") ||
		typeof entry.workspaceID !== "string" ||
		!WORKSPACE_ID.test(entry.workspaceID)
	) {
		throw new Error(`Herdr returned an incomplete linked worktree for branch ${branch}.`);
	}
	return entry;
}

function requireCommandResponse(response, operation) {
	if (!response || typeof response !== "object" || !response.result || typeof response.result !== "object") {
		throw new Error(`Herdr returned an unreadable ${operation} response.`);
	}
}

function quoteShellArgument(value) {
	return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function launchPrompt(workSpec) {
	return [
		"Continue the accepted implementation in this isolated worktree.",
		"Before editing, persist this exact accepted work spec with work_spec_write:",
		"",
		workSpec,
	].join("\n");
}

export function createHerdrWorktreeOrchestrator({
	worktree,
	environment,
	runHerdr,
	launcherPath,
	ensureLauncher,
	waitForShell,
}) {
	if (typeof worktree !== "string" || !worktree.startsWith("/")) {
		throw new Error("Current worktree path is invalid.");
	}
	if (
		typeof runHerdr !== "function" ||
		typeof ensureLauncher !== "function" ||
		typeof waitForShell !== "function"
	) {
		throw new Error("Herdr worktree orchestration dependencies are invalid.");
	}

	async function listInternal() {
		return parseWorktreeList(
			await runHerdr(["worktree", "list", "--cwd", worktree]),
			worktree,
		);
	}

	async function list() {
		requireHerdr(environment);
		return listInternal();
	}

	async function launch(entry, workSpec) {
		await ensureLauncher(launcherPath);
		const response = await runHerdr(["pane", "list", "--workspace", entry.workspaceID]);
		const panes = response?.result?.panes;
		if (!Array.isArray(panes)) throw new Error("Herdr returned an unreadable pane list.");
		const candidates = panes.filter((pane) => pane.cwd === entry.path && !pane.agent);
		if (candidates.length !== 1 || panes.length !== 1 || typeof candidates[0].pane_id !== "string") {
			throw new Error("The worktree workspace does not contain exactly one available shell pane.");
		}
		const paneID = candidates[0].pane_id;
		await waitForShell(paneID);
		const command = [
			launcherPath,
			"--agent",
			"build",
			"--prompt",
			launchPrompt(validateWorkSpec(workSpec)),
		].map(quoteShellArgument).join(" ");
		await runHerdr(["pane", "run", paneID, command]);
	}

	async function create({ branch, base, label, focus = false, workSpec }) {
		requireHerdr(environment);
		const checkedBranch = validateRef(branch, "Branch");
		const checkedBase = validateRef(base, "Base");
		const checkedLabel = validateLabel(label);
		const checkedWorkSpec = validateWorkSpec(workSpec);
		await ensureLauncher(launcherPath);
		const before = await listInternal();
		if (before.worktrees.some((entry) => entry.branch === checkedBranch)) {
			throw new Error(`A Herdr worktree for branch ${checkedBranch} already exists.`);
		}

		const createArguments = [
			"worktree", "create", "--cwd", worktree,
			"--branch", checkedBranch, "--base", checkedBase,
		];
		if (checkedLabel) createArguments.push("--label", checkedLabel);
		createArguments.push(focus ? "--focus" : "--no-focus");
		requireCommandResponse(await runHerdr(createArguments), "create");

		let entry;
		try {
			entry = requireOpenWorktree((await listInternal()).worktrees, checkedBranch);
			await launch(entry, checkedWorkSpec);
		} catch (error) {
			const path = entry?.path || "unknown path";
			const workspaceID = entry?.workspaceID || "unknown workspace";
			throw new Error(
				`Herdr created the worktree but launch failed; the worktree was retained: branch ${checkedBranch}, path ${path}, workspace ${workspaceID}. ${error instanceof Error ? error.message : String(error)}`,
				{ cause: error },
			);
		}

		return {
			branch: checkedBranch,
			path: entry.path,
			workspaceID: entry.workspaceID,
			focused: focus,
			launched: true,
		};
	}

	async function open({ branch, focus = false, workSpec }) {
		requireHerdr(environment);
		const checkedBranch = validateRef(branch, "Branch");
		if (workSpec !== undefined) {
			validateWorkSpec(workSpec);
			await ensureLauncher(launcherPath);
		}
		requireCommandResponse(await runHerdr([
			"worktree", "open", "--cwd", worktree,
			"--branch", checkedBranch, focus ? "--focus" : "--no-focus",
		]), "open");
		const entry = requireOpenWorktree((await listInternal()).worktrees, checkedBranch);
		if (workSpec === undefined) {
			return {
				branch: checkedBranch,
				path: entry.path,
				workspaceID: entry.workspaceID,
				focused: focus,
				launched: false,
			};
		}

		await launch(entry, workSpec);
		return {
			branch: checkedBranch,
			path: entry.path,
			workspaceID: entry.workspaceID,
			focused: focus,
			launched: true,
		};
	}

	async function remove({ workspaceID, confirmation, force = false }) {
		requireHerdr(environment);
		const checkedWorkspaceID = validateWorkspaceID(workspaceID);
		if (confirmation !== checkedWorkspaceID) {
			throw new Error("Removal confirmation must repeat the exact workspace ID.");
		}
		const current = await listInternal();
		if (
			checkedWorkspaceID === current.sourceWorkspaceID ||
			checkedWorkspaceID === environment.HERDR_WORKSPACE_ID
		) {
			throw new Error("Worktree removal refuses the source or current workspace.");
		}
		const matches = current.worktrees.filter((entry) => entry.workspaceID === checkedWorkspaceID);
		if (matches.length !== 1 || !matches[0].isLinked) {
			throw new Error("Herdr did not return one linked worktree for that workspace ID.");
		}
		const args = ["worktree", "remove", "--workspace", checkedWorkspaceID];
		if (force) args.push("--force");
		requireCommandResponse(await runHerdr(args), "remove");
		const after = await listInternal();
		if (after.worktrees.some((entry) => entry.workspaceID === checkedWorkspaceID)) {
			throw new Error(`Herdr still reports workspace ${checkedWorkspaceID} after removal.`);
		}
		return {
			branch: matches[0].branch,
			path: matches[0].path,
			workspaceID: checkedWorkspaceID,
			forced: force,
			removed: true,
		};
	}

	return { list, create, open, remove };
}
