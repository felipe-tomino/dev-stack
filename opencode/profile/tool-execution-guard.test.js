import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, realpath, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
	APPROVED_DIRECTORY_ALIASES,
	createToolExecutionGuard,
	default as ToolExecutionGuard,
} from "./plugins/tool-execution-guard.js";

const executeFile = promisify(execFile);

async function createFixture(t) {
	const root = await mkdtemp(path.join(os.tmpdir(), "tool-guard-"));
	const workspaceRoot = path.join(root, "workspace");
	const tempRoot = path.join(root, "temp");
	await Promise.all([
		mkdir(path.join(workspaceRoot, "app"), { recursive: true }),
		mkdir(path.join(workspaceRoot, "functions"), { recursive: true }),
		mkdir(path.join(workspaceRoot, "rapid-public"), { recursive: true }),
		mkdir(tempRoot, { recursive: true }),
	]);
	t.after(() => rm(root, { recursive: true, force: true }));
	return { root, workspaceRoot, tempRoot };
}

function toolCall(sessionID = "session-1") {
	return { tool: "bash", sessionID, callID: "call-1" };
}

async function guardBash(hooks, args, sessionID) {
	await hooks["tool.execute.before"](toolCall(sessionID), { args });
	return args;
}

async function structuredRejection(operation) {
	try {
		await operation();
		assert.fail("Expected the tool payload to be rejected");
	} catch (error) {
		return JSON.parse(error.message);
	}
}

test("publishes a strict Bash schema with approved directory aliases", async (t) => {
	const { workspaceRoot, tempRoot } = await createFixture(t);
	const hooks = createToolExecutionGuard({ workspaceRoot, tempRoot });
	const definition = {};

	await hooks["tool.definition"]({ toolID: "bash" }, definition);

	assert.equal(definition.parameters.additionalProperties, false);
	assert.deepEqual(definition.parameters.required, ["command"]);
	assert.deepEqual(
		definition.parameters.properties.directory.enum,
		APPROVED_DIRECTORY_ALIASES,
	);
	assert.equal(definition.parameters.properties.workdir, undefined);
});

test("resolves every approved directory alias to its canonical directory", async (t) => {
	const { workspaceRoot, tempRoot } = await createFixture(t);
	const hooks = createToolExecutionGuard({ workspaceRoot, tempRoot });
	const expectedDirectories = {
		workspace: await realpath(workspaceRoot),
		app: await realpath(path.join(workspaceRoot, "app")),
		functions: await realpath(path.join(workspaceRoot, "functions")),
		"rapid-public": await realpath(path.join(workspaceRoot, "rapid-public")),
		temp: await realpath(tempRoot),
	};

	for (const [directory, expectedWorkdir] of Object.entries(expectedDirectories)) {
		const args = await guardBash(hooks, { command: "pwd", directory });
		assert.deepEqual(args, { command: "pwd", workdir: expectedWorkdir });
	}
});

test("a valid command can execute in every supported alias directory", async (t) => {
	const { workspaceRoot, tempRoot } = await createFixture(t);
	const hooks = createToolExecutionGuard({ workspaceRoot, tempRoot });

	for (const directory of APPROVED_DIRECTORY_ALIASES) {
		const args = await guardBash(hooks, { command: "pwd", directory });
		const { stdout } = await executeFile(
			process.execPath,
			["-e", "process.stdout.write(process.cwd())"],
			{ cwd: args.workdir, encoding: "utf8" },
		);
		assert.equal(stdout, args.workdir);
	}
});

test("defaults Bash execution to the canonical workspace", async (t) => {
	const { workspaceRoot, tempRoot } = await createFixture(t);
	const hooks = createToolExecutionGuard({ workspaceRoot, tempRoot });

	const args = await guardBash(hooks, { command: "git status --short", timeout: 1_000 });

	assert.deepEqual(args, {
		command: "git status --short",
		timeout: 1_000,
		workdir: await realpath(workspaceRoot),
	});
});

test("rejects malformed, nonexistent, and outside directories before dispatch", async (t) => {
	const { root, workspaceRoot, tempRoot } = await createFixture(t);
	const hooks = createToolExecutionGuard({ workspaceRoot, tempRoot });
	const invalidDirectories = [
		`${workspaceRoot}/: cr}},)`,
		path.join(workspaceRoot, "does-not-exist"),
		root,
	];

	for (const [index, directory] of invalidDirectories.entries()) {
		let dispatched = false;
		const failure = await structuredRejection(async () => {
			await guardBash(hooks, { command: "pwd", directory }, `session-${index}`);
			dispatched = true;
		});

		assert.equal(dispatched, false);
		assert.deepEqual(failure, {
			ok: false,
			code: "INVALID_WORKDIR",
			message: "Use an approved directory alias.",
		});
	}
});

test("rejects an approved alias whose symlink escapes the workspace", async (t) => {
	const { root, workspaceRoot, tempRoot } = await createFixture(t);
	const outside = path.join(root, "outside");
	await mkdir(outside);
	await rm(path.join(workspaceRoot, "app"), { recursive: true });
	await symlink(outside, path.join(workspaceRoot, "app"), "dir");
	const hooks = createToolExecutionGuard({ workspaceRoot, tempRoot });

	const failure = await structuredRejection(() =>
		guardBash(hooks, { command: "pwd", directory: "app" }),
	);

	assert.equal(failure.code, "INVALID_WORKDIR");
});

test("rejects a temporary root that is itself a symlink", async (t) => {
	const { root, workspaceRoot, tempRoot } = await createFixture(t);
	const symlinkedTemp = path.join(root, "temp-link");
	await symlink(tempRoot, symlinkedTemp, "dir");
	const hooks = createToolExecutionGuard({ workspaceRoot, tempRoot: symlinkedTemp });

	const failure = await structuredRejection(() =>
		guardBash(hooks, { command: "pwd", directory: "temp" }),
	);

	assert.equal(failure.code, "INVALID_WORKDIR");
});

test("strictly rejects unknown fields, invalid types, and corrupt commands", async (t) => {
	const { workspaceRoot, tempRoot } = await createFixture(t);
	const hooks = createToolExecutionGuard({ workspaceRoot, tempRoot });
	const payloads = [
		{ command: "pwd", unexpected: true },
		{ command: 42 },
		{ command: "   " },
		{ command: "git status --shortroch --branch && and more?" },
		{ command: "git status --short(close?)" },
		{ command: "git Cheesecake ..." },
		{ command: "gh pr create --body TODO" },
		{ command: "gh pr create --body=\"TBD\"" },
	];

	for (const payload of payloads) {
		const failure = await structuredRejection(() => guardBash(hooks, payload));
		assert.equal(failure.ok, false);
		assert.match(failure.code, /^INVALID_(?:COMMAND|PAYLOAD)$/);
	}
});

test("returns redacted structured failures and redacted audit records", async (t) => {
	const { workspaceRoot, tempRoot } = await createFixture(t);
	const auditRecords = [];
	const secret = "/private/secret/: cr}},)";
	const hooks = createToolExecutionGuard({
		workspaceRoot,
		tempRoot,
		audit: (record) => auditRecords.push(record),
	});

	const failure = await structuredRejection(() =>
		guardBash(hooks, { command: "pwd", directory: secret }),
	);

	assert.equal(JSON.stringify(failure).includes(secret), false);
	assert.equal(JSON.stringify(auditRecords).includes(secret), false);
	assert.deepEqual(auditRecords, [
		{
			event: "tool_payload_rejected",
			tool: "bash",
			code: "INVALID_WORKDIR",
			sessionID: "session-1",
			callID: "call-1",
		},
	]);
});

test("requires a fresh approved directory after a malformed retry", async (t) => {
	const { workspaceRoot, tempRoot } = await createFixture(t);
	const hooks = createToolExecutionGuard({ workspaceRoot, tempRoot });

	const firstFailure = await structuredRejection(() =>
		guardBash(hooks, { command: "pwd", workdir: "/invented" }, "blocked-session"),
	);
	const unrelatedArgs = { path: "/still/allowed" };
	await hooks["tool.execute.before"](
		{ tool: "read", sessionID: "blocked-session", callID: "call-2" },
		{ args: unrelatedArgs },
	);
	const retryFailure = await structuredRejection(() =>
		guardBash(hooks, { command: "pwd", workdir: "/mutated" }, "blocked-session"),
	);
	const recovered = await guardBash(hooks, { command: "pwd" }, "blocked-session");

	assert.equal(firstFailure.code, "INVALID_WORKDIR");
	assert.deepEqual(unrelatedArgs, { path: "/still/allowed" });
	assert.equal(retryFailure.code, "RETRY_REQUIRES_APPROVED_DIRECTORY");
	assert.equal(recovered.workdir, await realpath(workspaceRoot));
	const afterRecovery = await structuredRejection(() =>
		guardBash(hooks, { command: "pwd", workdir: "/invented" }, "blocked-session"),
	);
	assert.equal(afterRecovery.code, "INVALID_WORKDIR");
});

test("clears circuit-breaker state when its session is deleted", async (t) => {
	const { workspaceRoot, tempRoot } = await createFixture(t);
	const hooks = createToolExecutionGuard({ workspaceRoot, tempRoot });

	await structuredRejection(() =>
		guardBash(hooks, { command: "pwd", workdir: "/invented" }, "deleted-session"),
	);
	await hooks.event({
		event: { type: "session.deleted", properties: { info: { id: "deleted-session" } } },
	});
	const failure = await structuredRejection(() =>
		guardBash(hooks, { command: "pwd", workdir: "/invented" }, "deleted-session"),
	);

	assert.equal(failure.code, "INVALID_WORKDIR");
});

test("preserves compatible command and timeout payloads and ignores unrelated tools", async (t) => {
	const { workspaceRoot, tempRoot } = await createFixture(t);
	const hooks = createToolExecutionGuard({ workspaceRoot, tempRoot });
	const bashArgs = {
		command: "printf '%s\\n' 'punctuation: !@#$%^&*() ...'",
		timeout: 250,
	};
	const readArgs = { filePath: "/tmp/example" };

	await guardBash(hooks, bashArgs);
	await hooks["tool.execute.before"](
		{ tool: "read", sessionID: "session-1", callID: "call-2" },
		{ args: readArgs },
	);

	assert.deepEqual(bashArgs, {
		command: "printf '%s\\n' 'punctuation: !@#$%^&*() ...'",
		timeout: 250,
		workdir: await realpath(workspaceRoot),
	});
	assert.deepEqual(readArgs, { filePath: "/tmp/example" });
});

test("the default plugin uses OpenCode hook inputs and redacted application logs", async (t) => {
	const { workspaceRoot } = await createFixture(t);
	const logs = [];
	const hooks = ToolExecutionGuard({
		worktree: workspaceRoot,
		client: { app: { log: async (entry) => logs.push(entry) } },
	});
	const definition = {};

	await hooks["tool.definition"]({ toolID: "bash" }, definition);
	await structuredRejection(() =>
		hooks["tool.execute.before"](toolCall(), {
			args: { command: "pwd", workdir: "/private/secret" },
		}),
	);

	assert.deepEqual(definition.parameters.properties.directory.enum, APPROVED_DIRECTORY_ALIASES);
	assert.equal(JSON.stringify(logs).includes("/private/secret"), false);
});
