import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import SessionWorkSpec from "./plugins/session-work-spec.js";
import {
	createSessionWorkSpecToolHandlers,
	createSessionWorkSpecRuntime,
	formatCompactionContext,
	MAX_WORK_SPEC_BYTES,
	resolveRootSession,
} from "./plugins/session-work-spec/core.js";

test("work-spec tools identify themselves as direct OpenCode tools", async () => {
	const plugin = await SessionWorkSpec({
		client: {},
		project: { id: "project-1" },
		worktree: "/repo",
	});

	assert.match(plugin.tool.work_spec_write.description, /Call this OpenCode tool directly/);
	assert.match(plugin.tool.work_spec_write.description, /not a shell command/);
	assert.match(plugin.tool.work_spec_read.description, /Call this OpenCode tool directly/);
});

async function createFixture(t) {
	const stateDirectory = await mkdtemp(path.join(os.tmpdir(), "session-work-spec-"));
	t.after(() => rm(stateDirectory, { recursive: true, force: true }));

	const sessions = new Map([
		["root-session", { id: "root-session", projectID: "project-1", directory: "/repo" }],
		[
			"child-session",
			{
				id: "child-session",
				parentID: "root-session",
				projectID: "project-1",
				directory: "/repo",
			},
		],
	]);
	const client = {
		session: {
			get: async ({ path: { id } }) => ({ data: sessions.get(id) }),
		},
	};
	const runtime = createSessionWorkSpecRuntime({
		client,
		projectID: "project-1",
		worktree: "/repo",
		getStateDirectory: async () => stateDirectory,
	});
	return { runtime, sessions, stateDirectory };
}

test("a child and its root share one persisted work spec through compaction", async (t) => {
	const { runtime } = await createFixture(t);
	const content = "## Goal\nPersist one accepted session work spec.";

	const written = await runtime.write("child-session", content);
	const readFromRoot = await runtime.read("root-session");
	const output = { context: [] };
	await runtime.compact("child-session", output);

	assert.equal(written.rootSessionID, "root-session");
	assert.equal(readFromRoot.content, content);
	assert.deepEqual(output.context, [formatCompactionContext(content)]);
});

test("root resolution fails closed for missing, cross-project, and cyclic ancestry", async () => {
	const sessions = new Map([
		["cross-project", { id: "cross-project", projectID: "another-project" }],
		["cycle-a", { id: "cycle-a", projectID: "project-1", parentID: "cycle-b" }],
		["cycle-b", { id: "cycle-b", projectID: "project-1", parentID: "cycle-a" }],
	]);
	const client = {
		session: { get: async ({ path: { id } }) => ({ data: sessions.get(id) }) },
	};

	await assert.rejects(resolveRootSession(client, "missing", "project-1"), /Unable to retrieve session/);
	await assert.rejects(resolveRootSession(client, "cross-project", "project-1"), /active project/);
	await assert.rejects(resolveRootSession(client, "cycle-a", "project-1"), /parent cycle/);
});

test("work spec writes reject blank and oversized content", async (t) => {
	const { runtime } = await createFixture(t);

	await assert.rejects(runtime.write("root-session", "  \n"), /cannot be blank/);
	await assert.rejects(
		runtime.write("root-session", "x".repeat(MAX_WORK_SPEC_BYTES + 1)),
		/exceeds 32768 bytes/,
	);
});

test("invalid persisted state fails loudly instead of disappearing", async (t) => {
	const { runtime, stateDirectory } = await createFixture(t);
	await runtime.write("root-session", "## Goal\nPersist valid state first.");
	const storageRoot = path.join(stateDirectory, "ws-work-specs");
	const entries = await readdir(storageRoot, { recursive: true });
	const recordPath = entries.find((entry) => entry.endsWith(".json"));
	assert.ok(recordPath, "the persisted record must exist");
	await writeFile(path.join(storageRoot, recordPath), "not-json\n");

	await assert.rejects(runtime.read("child-session"), /Stored work spec is not valid JSON/);
});

test("only deleting the root session removes its work spec", async (t) => {
	const { runtime } = await createFixture(t);
	await runtime.write("child-session", "## Goal\nKeep this until the root is deleted.");

	await runtime.deleted({ id: "child-session", parentID: "root-session", projectID: "project-1" });
	assert.ok(await runtime.read("root-session"));

	await runtime.deleted({ id: "other-root", projectID: "another-project" });
	assert.ok(await runtime.read("root-session"));

	await runtime.deleted({ id: "root-session", projectID: "project-1" });
	assert.equal(await runtime.read("root-session"), undefined);
});

test("cleanup failures are logged without blocking session deletion", async () => {
	const records = [];
	const runtime = createSessionWorkSpecRuntime({
		client: { session: { get: async () => ({ data: undefined }) } },
		projectID: "project-1",
		worktree: "/repo",
		getStateDirectory: async () => {
			throw new Error("state unavailable");
		},
		log: async (record) => records.push(record),
	});

	await runtime.deleted({ id: "root-session", projectID: "project-1" });

	assert.deepEqual(records, [
		{
			event: "work_spec_cleanup_failed",
			sessionID: "root-session",
			reason: "state unavailable",
		},
	]);
});

test("OpenCode tool handlers return strings and publish metadata separately", async () => {
	const metadata = [];
	const context = { sessionID: "child-session", metadata: (value) => metadata.push(value) };
	const handlers = createSessionWorkSpecToolHandlers({
		read: async () => ({
			rootSessionID: "root-session",
			updatedAt: "2026-09-11T12:00:00.000Z",
			content: "## Goal\nKeep the contract.\n",
		}),
		write: async (_sessionID, content) => ({
			rootSessionID: "root-session",
			updatedAt: "2026-09-11T12:01:00.000Z",
			content,
		}),
	});

	assert.equal(await handlers.read(context), "## Goal\nKeep the contract.\n");
	assert.equal(
		await handlers.write("## Goal\nReplace it.\n", context),
		"Persisted the complete work spec for this root session and its children.",
	);
	assert.equal(metadata.length, 2);
	assert.equal(metadata[0].metadata.found, true);
	assert.equal(metadata[1].metadata.rootSessionID, "root-session");

	const missingHandlers = createSessionWorkSpecToolHandlers({ read: async () => undefined });
	assert.equal(
		await missingHandlers.read(context),
		"No work spec has been persisted for this root session.",
	);
	assert.equal(metadata.at(-1).metadata.found, false);
});
