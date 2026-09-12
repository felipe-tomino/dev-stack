import assert from "node:assert/strict";
import test from "node:test";

import { createHerdrWorktreeOrchestrator } from "./plugins/herdr-worktree/core.js";

const environment = {
	HERDR_ENV: "1",
	HERDR_SOCKET_PATH: "/tmp/herdr.sock",
	HERDR_WORKSPACE_ID: "w1A",
	HERDR_PANE_ID: "w1A:p1",
};

function worktreeList(worktrees = []) {
	return {
		result: {
			source: {
				repo_root: "/repo",
				source_checkout_path: "/repo",
				source_workspace_id: "w1A",
			},
			worktrees,
		},
	};
}

test("worktree operations fail closed outside Herdr", async () => {
	let calls = 0;
	const orchestrator = createHerdrWorktreeOrchestrator({
		worktree: "/repo",
		environment: {},
		runHerdr: async () => { calls += 1; },
		launcherPath: "/profile/bin/opencode-ws",
		ensureLauncher: async () => {},
		waitForShell: async () => {},
	});

	await assert.rejects(orchestrator.list(), /inside a Herdr-managed pane/);
	assert.equal(calls, 0);
});

test("list is fixed to the current repository and validates Herdr's source", async () => {
	const calls = [];
	const orchestrator = createHerdrWorktreeOrchestrator({
		worktree: "/repo",
		environment,
		runHerdr: async (args) => {
			calls.push(args);
			return worktreeList([{ branch: "main", path: "/repo", open_workspace_id: "w1A" }]);
		},
		launcherPath: "/profile/bin/opencode-ws",
		ensureLauncher: async () => {},
		waitForShell: async () => {},
	});

	const result = await orchestrator.list();
	assert.deepEqual(calls, [["worktree", "list", "--cwd", "/repo"]]);
	assert.equal(result.sourceWorkspaceID, "w1A");
	assert.equal(result.worktrees[0].branch, "main");
});

test("create delegates lifecycle to Herdr then launches Build with the exact work spec", async () => {
	const calls = [];
	let listCount = 0;
	const workSpec = "## Goal\nShip the isolated change.\n";
	const orchestrator = createHerdrWorktreeOrchestrator({
		worktree: "/repo",
		environment,
		runHerdr: async (args) => {
			calls.push(args);
			if (args[0] === "worktree" && args[1] === "list") {
				listCount += 1;
				return listCount === 1
					? worktreeList([{ branch: "main", path: "/repo", open_workspace_id: "w1A" }])
					: worktreeList([
						{ branch: "main", path: "/repo", open_workspace_id: "w1A" },
						{
							branch: "feature/safe-change",
							path: "/worktrees/safe-change",
							open_workspace_id: "w2B",
							is_linked_worktree: true,
						},
					]);
			}
			if (args[0] === "pane" && args[1] === "list") {
				return { result: { panes: [{ pane_id: "w2B:p1", cwd: "/worktrees/safe-change" }] } };
			}
			if (args[0] === "pane" && args[1] === "run") return undefined;
			return { result: {} };
		},
		launcherPath: "/profile/bin/opencode-ws",
		ensureLauncher: async () => {},
		waitForShell: async (paneID) => calls.push(["wait", paneID]),
	});

	const result = await orchestrator.create({
		branch: "feature/safe-change",
		base: "origin/main",
		label: "Safe change",
		focus: false,
		workSpec,
	});

	assert.deepEqual(calls[1], [
		"worktree", "create", "--cwd", "/repo", "--branch", "feature/safe-change",
		"--base", "origin/main", "--label", "Safe change", "--no-focus",
	]);
	assert.deepEqual(calls[4], ["wait", "w2B:p1"]);
	assert.equal(calls[5][0], "pane");
	assert.equal(calls[5][1], "run");
	assert.equal(calls[5][2], "w2B:p1");
	assert.match(calls[5][3], /^'\/profile\/bin\/opencode-ws' '--agent' 'build' '--prompt' /);
	assert.match(calls[5][3], /Ship the isolated change/);
	assert.deepEqual(result, {
		branch: "feature/safe-change",
		path: "/worktrees/safe-change",
		workspaceID: "w2B",
		focused: false,
		launched: true,
	});
});

test("create rejects unsafe refs and an existing branch before mutation", async () => {
	let calls = 0;
	const orchestrator = createHerdrWorktreeOrchestrator({
		worktree: "/repo",
		environment,
		runHerdr: async () => {
			calls += 1;
			return worktreeList([{ branch: "feature/existing", path: "/worktrees/existing" }]);
		},
		launcherPath: "/profile/bin/opencode-ws",
		ensureLauncher: async () => {},
		waitForShell: async () => {},
	});

	await assert.rejects(
		orchestrator.create({ branch: "feature/../escape", base: "main", workSpec: "accepted" }),
		/invalid Git ref/,
	);
	assert.equal(calls, 0);
	await assert.rejects(
		orchestrator.create({ branch: "feature/existing", base: "main", workSpec: "accepted" }),
		/already exists/,
	);
	assert.equal(calls, 1);
});

test("a post-create launch failure retains the Herdr worktree and reports its identity", async () => {
	let listCount = 0;
	const calls = [];
	const orchestrator = createHerdrWorktreeOrchestrator({
		worktree: "/repo",
		environment,
		runHerdr: async (args) => {
			calls.push(args);
			if (args[0] === "worktree" && args[1] === "list") {
				listCount += 1;
				return listCount === 1 ? worktreeList() : worktreeList([{
					branch: "feature/retained",
					path: "/worktrees/retained",
					open_workspace_id: "w2B",
					is_linked_worktree: true,
				}]);
			}
			if (args[0] === "pane" && args[1] === "list") return { result: { panes: [] } };
			return { result: {} };
		},
		launcherPath: "/profile/bin/opencode-ws",
		ensureLauncher: async () => {},
		waitForShell: async () => {},
	});

	await assert.rejects(
		orchestrator.create({ branch: "feature/retained", base: "main", workSpec: "accepted" }),
		/worktree was retained.*feature\/retained.*\/worktrees\/retained.*w2B/i,
	);
	assert.ok(!calls.some((args) => args[0] === "worktree" && args[1] === "remove"));
});

test("open keeps focus by default and launches only when a work spec is supplied", async () => {
	const calls = [];
	const orchestrator = createHerdrWorktreeOrchestrator({
		worktree: "/repo",
		environment,
		runHerdr: async (args) => {
			calls.push(args);
			if (args[0] === "worktree" && args[1] === "list") {
				return worktreeList([{
					branch: "feature/existing",
					path: "/worktrees/existing",
					open_workspace_id: "w2B",
					is_linked_worktree: true,
				}]);
			}
			return { result: {} };
		},
		launcherPath: "/profile/bin/opencode-ws",
		ensureLauncher: async () => {},
		waitForShell: async () => {},
	});

	const result = await orchestrator.open({ branch: "feature/existing" });
	assert.deepEqual(calls, [
		["worktree", "open", "--cwd", "/repo", "--branch", "feature/existing", "--no-focus"],
		["worktree", "list", "--cwd", "/repo"],
	]);
	assert.deepEqual(result, {
		branch: "feature/existing",
		path: "/worktrees/existing",
		workspaceID: "w2B",
		focused: false,
		launched: false,
	});
});

test("remove requires exact confirmation and refuses source or current workspaces", async () => {
	const calls = [];
	let removed = false;
	const orchestrator = createHerdrWorktreeOrchestrator({
		worktree: "/repo",
		environment,
		runHerdr: async (args) => {
			calls.push(args);
			if (args[0] === "worktree" && args[1] === "remove") {
				removed = true;
				return { result: {} };
			}
			if (removed) return worktreeList();
			return worktreeList([{
				branch: "feature/remove",
				path: "/worktrees/remove",
				open_workspace_id: "w2B",
				is_linked_worktree: true,
			}]);
		},
		launcherPath: "/profile/bin/opencode-ws",
		ensureLauncher: async () => {},
		waitForShell: async () => {},
	});

	await assert.rejects(
		orchestrator.remove({ workspaceID: "w2B", confirmation: "w9Z" }),
		/exact workspace ID/,
	);
	await assert.rejects(
		orchestrator.remove({ workspaceID: "w1A", confirmation: "w1A" }),
		/refuses the source or current workspace/,
	);
	await orchestrator.remove({ workspaceID: "w2B", confirmation: "w2B", force: true });
	assert.deepEqual(calls.at(-2), ["worktree", "remove", "--workspace", "w2B", "--force"]);
	assert.deepEqual(calls.at(-1), ["worktree", "list", "--cwd", "/repo"]);
});

test("open and remove reject parseable no-op responses", async () => {
	const entry = {
		branch: "feature/no-op",
		path: "/worktrees/no-op",
		open_workspace_id: "w2B",
		is_linked_worktree: true,
	};
	const orchestrator = createHerdrWorktreeOrchestrator({
		worktree: "/repo",
		environment,
		runHerdr: async (args) => {
			if (args[0] === "worktree" && args[1] === "open") return { unrelated: true };
			return worktreeList([entry]);
		},
		launcherPath: "/profile/bin/opencode-ws",
		ensureLauncher: async () => {},
		waitForShell: async () => {},
	});

	await assert.rejects(orchestrator.open({ branch: "feature/no-op" }), /unreadable open response/);
	await assert.rejects(
		orchestrator.remove({ workspaceID: "w2B", confirmation: "w2B" }),
		/still reports workspace w2B/,
	);
});
