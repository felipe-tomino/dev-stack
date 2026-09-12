import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export const WORK_SPEC_VERSION = 1;
export const MAX_WORK_SPEC_BYTES = 32 * 1024;
const MAX_SESSION_DEPTH = 64;

function hash(value) {
	return createHash("sha256").update(value).digest("hex");
}

function requireNonEmptyString(value, name) {
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`${name} must be a non-empty string.`);
	}
	return value;
}

function parseWorkSpecRecord(contents, expected) {
	let record;
	try {
		record = JSON.parse(contents);
	} catch (error) {
		throw new Error(`Stored work spec is not valid JSON: ${error.message}`);
	}

	if (record === null || typeof record !== "object" || Array.isArray(record)) {
		throw new Error("Stored work spec must be an object.");
	}
	if (record.version !== WORK_SPEC_VERSION) {
		throw new Error(`Stored work spec has unsupported version ${String(record.version)}.`);
	}
	for (const [field, value] of Object.entries(expected)) {
		if (record[field] !== value) throw new Error(`Stored work spec has an invalid ${field}.`);
	}
	if (typeof record.updatedAt !== "string" || Number.isNaN(Date.parse(record.updatedAt))) {
		throw new Error("Stored work spec has an invalid updatedAt.");
	}
	if (
		typeof record.content !== "string" ||
		record.content.trim().length === 0 ||
		Buffer.byteLength(record.content, "utf8") > MAX_WORK_SPEC_BYTES
	) {
		throw new Error("Stored work spec has invalid content.");
	}
	return record;
}

export async function resolveRootSession(client, sessionID, projectID) {
	requireNonEmptyString(sessionID, "Session ID");
	requireNonEmptyString(projectID, "Project ID");
	const seen = new Set();
	let currentID = sessionID;

	for (let depth = 0; depth < MAX_SESSION_DEPTH; depth += 1) {
		if (seen.has(currentID)) throw new Error(`Session parent cycle detected at ${currentID}.`);
		seen.add(currentID);

		const response = await client.session.get({ path: { id: currentID } });
		const session = response?.data;
		if (!session || session.id !== currentID) {
			throw new Error(`Unable to retrieve session ${currentID}.`);
		}
		if (session.projectID !== projectID) {
			throw new Error(`Session ${currentID} does not belong to the active project.`);
		}
		if (!session.parentID) return session;
		currentID = requireNonEmptyString(session.parentID, "Parent session ID");
	}

	throw new Error(`Session parent depth exceeds ${MAX_SESSION_DEPTH}.`);
}

export function createSessionWorkSpecStore({ stateDirectory, projectID, worktree, now = () => new Date() }) {
	requireNonEmptyString(stateDirectory, "State directory");
	requireNonEmptyString(projectID, "Project ID");
	requireNonEmptyString(worktree, "Worktree");
	const storageDirectory = path.join(
		stateDirectory,
		"ws-work-specs",
		hash(`${projectID}\0${worktree}`),
	);

	function filePath(rootSessionID) {
		return path.join(storageDirectory, `${hash(requireNonEmptyString(rootSessionID, "Root session ID"))}.json`);
	}

	return {
		async read(rootSessionID) {
			try {
				const contents = await readFile(filePath(rootSessionID), "utf8");
				return parseWorkSpecRecord(contents, { projectID, worktree, rootSessionID });
			} catch (error) {
				if (error?.code === "ENOENT") return undefined;
				throw error;
			}
		},
		async write(rootSessionID, content) {
			requireNonEmptyString(content, "Work spec content");
			if (content.trim().length === 0) throw new Error("Work spec content cannot be blank.");
			if (Buffer.byteLength(content, "utf8") > MAX_WORK_SPEC_BYTES) {
				throw new Error(`Work spec content exceeds ${MAX_WORK_SPEC_BYTES} bytes.`);
			}

			const record = {
				version: WORK_SPEC_VERSION,
				projectID,
				worktree,
				rootSessionID,
				updatedAt: now().toISOString(),
				content,
			};
			await mkdir(storageDirectory, { recursive: true, mode: 0o700 });
			const target = filePath(rootSessionID);
			const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
			try {
				await writeFile(temporary, `${JSON.stringify(record)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
				await rename(temporary, target);
			} finally {
				await rm(temporary, { force: true });
			}
			return record;
		},
		async remove(rootSessionID) {
			await rm(filePath(rootSessionID), { force: true });
		},
	};
}

export function formatCompactionContext(content) {
	return [
		"## Session work spec",
		"Treat this as the accepted implementation scope and current resume state. Do not silently change its decisions.",
		content,
	].join("\n\n");
}

export function createSessionWorkSpecRuntime({
	client,
	projectID,
	worktree,
	getStateDirectory,
	now,
	log = async () => {},
}) {
	requireNonEmptyString(projectID, "Project ID");
	requireNonEmptyString(worktree, "Worktree");
	if (typeof getStateDirectory !== "function") {
		throw new Error("Session work spec runtime requires a state-directory provider.");
	}

	async function scope(sessionID) {
		const [rootSession, stateDirectory] = await Promise.all([
			resolveRootSession(client, sessionID, projectID),
			getStateDirectory(),
		]);
		return {
			rootSession,
			store: createSessionWorkSpecStore({ stateDirectory, projectID, worktree, now }),
		};
	}

	async function read(sessionID) {
		const { rootSession, store } = await scope(sessionID);
		return store.read(rootSession.id);
	}

	return {
		read,
		async write(sessionID, content) {
			const { rootSession, store } = await scope(sessionID);
			return store.write(rootSession.id, content);
		},
		async compact(sessionID, output) {
			if (!Array.isArray(output?.context)) {
				throw new Error("Compaction output must provide a context array.");
			}
			const record = await read(sessionID);
			if (record) output.context.push(formatCompactionContext(record.content));
		},
		async deleted(session) {
			if (
				session?.parentID ||
				typeof session?.id !== "string" ||
				session.projectID !== projectID
			) {
				return;
			}
			try {
				const stateDirectory = await getStateDirectory();
				const store = createSessionWorkSpecStore({ stateDirectory, projectID, worktree, now });
				await store.remove(session.id);
			} catch (error) {
				await log({
					event: "work_spec_cleanup_failed",
					sessionID: session.id,
					reason: error instanceof Error ? error.message : "cleanup failed",
				});
			}
		},
	};
}

export function createSessionWorkSpecToolHandlers(runtime) {
	return {
		async read(context) {
			const record = await runtime.read(context.sessionID);
			if (!record) {
				context.metadata({
					title: "No session work spec",
					metadata: { found: false },
				});
				return "No work spec has been persisted for this root session.";
			}
			context.metadata({
				title: "Session work spec",
				metadata: {
					found: true,
					rootSessionID: record.rootSessionID,
					updatedAt: record.updatedAt,
				},
			});
			return record.content;
		},

		async write(content, context) {
			const record = await runtime.write(context.sessionID, content);
			context.metadata({
				title: "Session work spec saved",
				metadata: {
					rootSessionID: record.rootSessionID,
					updatedAt: record.updatedAt,
				},
			});
			return "Persisted the complete work spec for this root session and its children.";
		},
	};
}
