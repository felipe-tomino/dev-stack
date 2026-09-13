import { lstat, realpath, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const APPROVED_DIRECTORY_ALIASES = Object.freeze([
	"workspace",
	"app",
	"functions",
	"rapid-public",
	"temp",
]);

const BASH_FIELDS = new Set(["command", "directory", "timeout"]);
const WORKSPACE_DIRECTORIES = Object.freeze({
	workspace: ".",
	app: "app",
	functions: "functions",
	"rapid-public": "rapid-public",
});
const FAILURE_MESSAGES = Object.freeze({
	INVALID_COMMAND: "Submit one complete command without placeholders or corruption artifacts.",
	INVALID_PAYLOAD: "Submit only command, directory, and timeout with valid types.",
	INVALID_WORKDIR: "Use an approved directory alias.",
	RETRY_REQUIRES_APPROVED_DIRECTORY:
		"After a malformed payload, omit directory or use an approved directory alias.",
});

class ToolPayloadError extends Error {
	constructor(code) {
		const result = { ok: false, code, message: FAILURE_MESSAGES[code] };
		super(JSON.stringify(result));
		this.name = "ToolPayloadError";
		this.result = result;
	}
}

function isPlainObject(value) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function hasStandaloneCorruptionArtifact(command) {
	if (/(?:^|\s)<(?:workspace|app|functions|rapid-public|temp|placeholder)>(?=\s|$)/iu.test(command)) {
		return true;
	}
	if (/(?:^|\s)and more\?(?=\s|$)/iu.test(command)) return true;
	if (/\(close\?\)(?=\s|$)/iu.test(command)) return true;
	if (/\bgh\s+pr\s+(?:create|edit)\b[\s\S]*?--body(?:=|\s+)["']?(?:TODO|TBD|PLACEHOLDER)(?=["']?(?:\s|$))/u.test(command)) {
		return true;
	}

	const gitSubcommand = command.match(/^\s*git\s+([^\s;&|]+)/u)?.[1];
	return Boolean(gitSubcommand && !gitSubcommand.startsWith("-") && !/^[a-z][a-z0-9-]*$/u.test(gitSubcommand));
}

function normalizeLegacyWorkspace(payload, workspaceRoot) {
	if (
		!isPlainObject(payload) ||
		!Object.hasOwn(payload, "workdir") ||
		Object.hasOwn(payload, "directory") ||
		payload.workdir !== workspaceRoot
	) {
		return payload;
	}

	const normalized = { ...payload, directory: "workspace" };
	delete normalized.workdir;
	return normalized;
}

function parseBashPayload(payload) {
	if (!isPlainObject(payload)) throw new ToolPayloadError("INVALID_PAYLOAD");
	if (Object.hasOwn(payload, "workdir")) throw new ToolPayloadError("INVALID_WORKDIR");
	if (Object.keys(payload).some((field) => !BASH_FIELDS.has(field))) {
		throw new ToolPayloadError("INVALID_PAYLOAD");
	}
	if (typeof payload.command !== "string" || payload.command.trim().length === 0) {
		throw new ToolPayloadError("INVALID_COMMAND");
	}
	if (/\0|[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(payload.command)) {
		throw new ToolPayloadError("INVALID_COMMAND");
	}
	if (hasStandaloneCorruptionArtifact(payload.command)) {
		throw new ToolPayloadError("INVALID_COMMAND");
	}
	if (
		payload.directory !== undefined &&
		(typeof payload.directory !== "string" ||
			!APPROVED_DIRECTORY_ALIASES.includes(payload.directory))
	) {
		throw new ToolPayloadError("INVALID_WORKDIR");
	}
	if (
		payload.timeout !== undefined &&
		(!Number.isSafeInteger(payload.timeout) || payload.timeout <= 0)
	) {
		throw new ToolPayloadError("INVALID_PAYLOAD");
	}

	return {
		command: payload.command,
		directory: payload.directory ?? "workspace",
		...(payload.timeout === undefined ? {} : { timeout: payload.timeout }),
	};
}

function isWithin(root, candidate) {
	const relative = path.relative(root, candidate);
	return (
		relative === "" ||
		(!path.isAbsolute(relative) && !relative.startsWith(`..${path.sep}`) && relative !== "..")
	);
}

async function canonicalDirectory(candidate, { rejectFinalSymlink = false } = {}) {
	if (!path.isAbsolute(candidate)) throw new ToolPayloadError("INVALID_WORKDIR");
	if (rejectFinalSymlink && (await lstat(candidate)).isSymbolicLink()) {
		throw new ToolPayloadError("INVALID_WORKDIR");
	}
	const canonicalPath = await realpath(candidate);
	const details = await stat(canonicalPath);
	if (!details.isDirectory()) throw new ToolPayloadError("INVALID_WORKDIR");
	return canonicalPath;
}

async function resolveDirectoryAlias(alias, workspaceRoot, tempRoot) {
	try {
		const canonicalWorkspace = await canonicalDirectory(workspaceRoot);
		if (alias === "temp") {
			const canonicalSystemTemp = await canonicalDirectory(os.tmpdir());
			const canonicalTemp = await canonicalDirectory(tempRoot, { rejectFinalSymlink: true });
			if (!isWithin(canonicalSystemTemp, canonicalTemp)) {
				throw new ToolPayloadError("INVALID_WORKDIR");
			}
			return canonicalTemp;
		}

		const relativeDirectory = WORKSPACE_DIRECTORIES[alias];
		if (relativeDirectory === undefined) throw new ToolPayloadError("INVALID_WORKDIR");
		const canonicalCandidate = await canonicalDirectory(
			path.join(canonicalWorkspace, relativeDirectory),
		);
		if (!isWithin(canonicalWorkspace, canonicalCandidate)) {
			throw new ToolPayloadError("INVALID_WORKDIR");
		}
		return canonicalCandidate;
	} catch (error) {
		if (error instanceof ToolPayloadError) throw error;
		throw new ToolPayloadError("INVALID_WORKDIR");
	}
}

function bashToolParameters(parameters) {
	const fields = parameters?.fields;
	if (!isPlainObject(fields) || typeof parameters.mapFields !== "function") {
		throw new Error("OpenCode returned an unsupported Bash parameter schema.");
	}
	const { command, timeout, workdir } = fields;
	if (!command || !timeout || !workdir) {
		throw new Error("OpenCode's Bash parameter schema is incomplete.");
	}
	const directory = typeof workdir.annotate === "function"
		? workdir.annotate({
			description: "Approved directory alias. Omit to use the workspace root.",
		})
		: workdir;
	return parameters.mapFields(() => ({ command, directory, timeout }));
}

function retryFailureCode(error, retryRequiresApprovedDirectory) {
	if (!retryRequiresApprovedDirectory) return error.result.code;
	if (error.result.code !== "INVALID_WORKDIR") return error.result.code;
	return "RETRY_REQUIRES_APPROVED_DIRECTORY";
}

export function createToolExecutionGuard({
	workspaceRoot,
	tempRoot = path.join(os.tmpdir(), "opencode"),
	audit = () => {},
}) {
	if (typeof workspaceRoot !== "string" || !path.isAbsolute(workspaceRoot)) {
		throw new Error("Tool execution guard requires an absolute workspace root.");
	}
	if (typeof tempRoot !== "string" || !path.isAbsolute(tempRoot)) {
		throw new Error("Tool execution guard requires an absolute temporary root.");
	}

	const sessionsRequiringSafeRetry = new Set();

	async function rejectPayload(input, error) {
		const code = retryFailureCode(
			error,
			sessionsRequiringSafeRetry.has(input.sessionID),
		);
		sessionsRequiringSafeRetry.add(input.sessionID);
		try {
			await audit({
				event: "tool_payload_rejected",
				tool: "bash",
				code,
				sessionID: input.sessionID,
				callID: input.callID,
			});
		} catch {
			// Diagnostics must never turn a rejected payload into an executable one.
		}
		throw new ToolPayloadError(code);
	}

	return {
		"tool.definition": async (input, output) => {
			if ((input.toolID ?? input.tool) !== "bash") return;
			output.description = [
				"Run one complete shell command in an approved project directory.",
				"Omit directory to use workspace; never submit an absolute working directory.",
			].join(" ");
			output.parameters = bashToolParameters(output.parameters);
		},
		"tool.execute.before": async (input, output) => {
			if (input.tool !== "bash") return;

			let payload;
			try {
				payload = parseBashPayload(normalizeLegacyWorkspace(output.args, workspaceRoot));
			} catch (error) {
				if (error instanceof ToolPayloadError) return rejectPayload(input, error);
				throw error;
			}

			let workdir;
			try {
				workdir = await resolveDirectoryAlias(
					payload.directory,
					workspaceRoot,
					tempRoot,
				);
			} catch (error) {
				if (error instanceof ToolPayloadError) return rejectPayload(input, error);
				throw error;
			}

			for (const field of Object.keys(output.args)) delete output.args[field];
			Object.assign(output.args, {
				command: payload.command,
				...(payload.timeout === undefined ? {} : { timeout: payload.timeout }),
				workdir,
			});
			sessionsRequiringSafeRetry.delete(input.sessionID);
		},
		event: async ({ event }) => {
			if (event.type !== "session.deleted") return;
			const sessionID = event.properties?.info?.id ?? event.properties?.sessionID;
			if (typeof sessionID === "string") sessionsRequiringSafeRetry.delete(sessionID);
		},
	};
}
