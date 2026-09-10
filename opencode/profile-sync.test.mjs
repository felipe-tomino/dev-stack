import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import {
	planIdleSessionRefresh,
	refreshIdleSessions,
	syncProfile,
} from "./profile-sync.mjs";

const execFileAsync = promisify(execFile);
const launcherPath = path.join(import.meta.dirname, "profile/bin/opencode-ws");

async function temporaryDirectory(t, prefix) {
	const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
	t.after(() => rm(directory, { recursive: true, force: true }));
	return directory;
}

async function writeJson(filePath, value) {
	await mkdir(path.dirname(filePath), { recursive: true });
	await writeFile(filePath, `${JSON.stringify(value, null, "\t")}\n`);
}

test("profile sync mirrors repository config and agents while preserving non-agent components", async (t) => {
	const root = await temporaryDirectory(t, "profile-sync-");
	const sourceProfileDir = path.join(root, "source");
	const targetProfileDir = path.join(root, "target");

	await writeJson(path.join(sourceProfileDir, "opencode.jsonc"), {
		$schema: "https://opencode.ai/config.json",
		default_agent: "build",
	});
	await mkdir(path.join(sourceProfileDir, "agents"), { recursive: true });
	await writeFile(path.join(sourceProfileDir, "agents/build.md"), "current build\n");
	await mkdir(path.join(sourceProfileDir, "bin"), { recursive: true });
	await writeFile(path.join(sourceProfileDir, "bin/opencode-ws"), "#!/bin/sh\n");
	await writeJson(path.join(targetProfileDir, "opencode.jsonc"), {
		$schema: "https://opencode.ai/config.json",
		model: "provider/local-model",
		small_model: "provider/local-small-model",
		default_agent: "old-build",
	});
	await mkdir(path.join(targetProfileDir, "agents"), { recursive: true });
	await writeFile(path.join(targetProfileDir, "agents/personal.md"), "keep me\n");
	for (const agentName of ["dwight-attm", "george", "workspace-manager", "writer"]) {
		await writeFile(path.join(targetProfileDir, `agents/${agentName}.md`), "retired\n");
	}
	await writeFile(path.join(targetProfileDir, "agents/george.md.backup-20260910"), "retired backup\n");
	await mkdir(path.join(targetProfileDir, "plugins"), { recursive: true });
	await writeFile(path.join(targetProfileDir, "plugins/vendor.ts"), "keep me\n");

	await syncProfile({ sourceProfileDir, targetProfileDir });

	const installedConfig = JSON.parse(await readFile(path.join(targetProfileDir, "opencode.jsonc"), "utf8"));
	assert.deepEqual(installedConfig, {
		$schema: "https://opencode.ai/config.json",
		default_agent: "build",
	});
	assert.deepEqual(await readdir(path.join(targetProfileDir, "agents")), ["build.md"]);
	assert.equal(await readFile(path.join(targetProfileDir, "agents/build.md"), "utf8"), "current build\n");
	for (const agentName of ["dwight-attm", "george", "personal", "workspace-manager", "writer"]) {
		await assert.rejects(readFile(path.join(targetProfileDir, `agents/${agentName}.md`)), (error) => error?.code === "ENOENT");
	}
	await assert.rejects(
		readFile(path.join(targetProfileDir, "agents/george.md.backup-20260910")),
		(error) => error?.code === "ENOENT",
	);
	assert.equal(await readFile(path.join(targetProfileDir, "plugins/vendor.ts"), "utf8"), "keep me\n");
});

test("repository profile tracks the selected models", async () => {
	const profileConfig = JSON.parse(
		await readFile(path.join(import.meta.dirname, "profile/opencode.jsonc"), "utf8"),
	);

	assert.equal(profileConfig.model, "openai/gpt-5.6-sol");
	assert.equal(profileConfig.small_model, "openai/gpt-5.6-luna");
});

test("idle refresh planning requires an OpenCode session ID and never selects the caller", () => {
	const agents = [
		{
			agent: "opencode",
			agent_status: "idle",
			profile: "ws",
			pane_id: "w1:p1",
			agent_session: { value: "ses_idle" },
		},
		{
			agent: "opencode",
			agent_status: "done",
			profile: "ws",
			pane_id: "w2:p1",
			agent_session: { value: "ses_done" },
		},
		{ agent: "opencode", agent_status: "idle", profile: "ws", pane_id: "w3:p1" },
		{
			agent: "opencode",
			agent_status: "working",
			profile: "ws",
			pane_id: "w4:p1",
			agent_session: { value: "ses_working" },
		},
		{
			agent: "codex",
			agent_status: "idle",
			pane_id: "w5:p1",
			agent_session: { value: "ses_other" },
		},
		{
			agent: "opencode",
			agent_status: "idle",
			profile: "another-profile",
			pane_id: "w6:p1",
			agent_session: { value: "ses_other_profile" },
		},
	];

	assert.deepEqual(planIdleSessionRefresh(agents, { currentPaneID: "w2:p1" }), {
		refreshable: [{ paneID: "w1:p1", sessionID: "ses_idle" }],
		deferred: [
			{ paneID: "w2:p1", reason: "current pane" },
			{ paneID: "w3:p1", reason: "missing session ID" },
			{ paneID: "w4:p1", reason: "working" },
		],
	});
});

test("idle refresh resumes the same session through the stable launcher", async () => {
	const calls = [];
	const result = await refreshIdleSessions({
		sessions: [{ paneID: "w1:p1", sessionID: "ses_idle" }],
		launcherPath: "/profile/bin/opencode-ws",
		sendInterrupt: async (paneID) => calls.push(["interrupt", paneID]),
		waitForShell: async (paneID) => calls.push(["wait", paneID]),
		runInPane: async (paneID, command) => calls.push(["run", paneID, command]),
	});

	assert.deepEqual(calls, [
		["interrupt", "w1:p1"],
		["wait", "w1:p1"],
		["run", "w1:p1", "'/profile/bin/opencode-ws' --session 'ses_idle'"],
	]);
	assert.deepEqual(result, { refreshed: ["w1:p1"], failed: [] });
});

test("stable launcher replaces stale OCX configuration and forwards arguments", async (t) => {
	const home = await temporaryDirectory(t, "profile-launcher-");
	const profileDirectory = path.join(home, ".config/opencode/profiles/ws");
	const capturePath = path.join(home, "capture.txt");
	const fakeOpenCode = path.join(home, "fake-opencode");
	await writeJson(path.join(profileDirectory, "opencode.jsonc"), { default_agent: "build" });
	await writeFile(
		fakeOpenCode,
		`#!/bin/sh\nprintf '%s\\n' "$OPENCODE_CONFIG_DIR" "$OPENCODE_CONFIG" "${"${OPENCODE_CONFIG_CONTENT-unset}"}" "${"${OPENCODE_DISABLE_PROJECT_CONFIG-unset}"}" "$@" > "$CAPTURE_PATH"\n`,
	);
	await chmod(fakeOpenCode, 0o755);

	await execFileAsync(launcherPath, ["--session", "ses_123"], {
		env: {
			HOME: home,
			PATH: process.env.PATH,
			CAPTURE_PATH: capturePath,
			OPENCODE_REAL_BIN: fakeOpenCode,
			OPENCODE_CONFIG_CONTENT: "stale-inline-config",
			OPENCODE_CONFIG_DIR: "/tmp/stale-snapshot",
			OPENCODE_DISABLE_PROJECT_CONFIG: "true",
		},
	});

	assert.deepEqual((await readFile(capturePath, "utf8")).trimEnd().split("\n"), [
		profileDirectory,
		path.join(profileDirectory, "opencode.jsonc"),
		"unset",
		"unset",
		"--session",
		"ses_123",
	]);
});
