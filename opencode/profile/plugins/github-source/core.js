const API_ROOT = "https://api.github.com";
const COMMIT_SHA = /^[0-9a-f]{40}$/i;
const REPOSITORY_SEGMENT = /^[A-Za-z0-9_.-]+$/;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_DIRECTORY_ENTRIES = 1_000;

function validateRepositorySegment(value, label) {
	if (
		typeof value !== "string" ||
		!REPOSITORY_SEGMENT.test(value) ||
		value === "." ||
		value === ".."
	) {
		throw new Error(`${label} must be one GitHub owner or repository name.`);
	}
	return value;
}

function validateCommit(value) {
	if (typeof value !== "string" || !COMMIT_SHA.test(value)) {
		throw new Error("GitHub source reads require an explicit full 40-character commit SHA.");
	}
	return value.toLowerCase();
}

function validatePath(value, { allowRoot }) {
	if (allowRoot && (value === undefined || value === "")) return "";
	if (typeof value !== "string" || value.length === 0 || value.length > 1_024) {
		throw new Error("GitHub source path is invalid.");
	}
	const segments = value.split("/");
	if (
		value.startsWith("/") ||
		value.endsWith("/") ||
		segments.some((segment) => segment === "" || segment === "." || segment === "..")
	) {
		throw new Error("GitHub source path must be repository-relative without dot segments.");
	}
	return segments.map(encodeURIComponent).join("/");
}

function repositoryPath(owner, repository) {
	return `/repos/${encodeURIComponent(validateRepositorySegment(owner, "Owner"))}/${encodeURIComponent(validateRepositorySegment(repository, "Repository"))}`;
}

function responseError(response) {
	if (response.status >= 300 && response.status < 400) {
		return new Error("GitHub source reads reject redirects.");
	}
	if (response.status === 401) return new Error("GitHub authentication failed.");
	if (response.status === 403 || response.status === 429) {
		return new Error("GitHub denied or rate-limited the source read.");
	}
	if (response.status === 404) {
		return new Error("The GitHub resource was not found or is not visible to the authenticated identity.");
	}
	return new Error(`GitHub source read failed with HTTP ${response.status}.`);
}

function decodeFile(data) {
	if (data.type !== "file") throw new Error("The requested GitHub path is not a regular file.");
	if (data.encoding !== "base64" || typeof data.content !== "string") {
		throw new Error("GitHub did not return inline base64 file content.");
	}
	if (!Number.isSafeInteger(data.size) || data.size < 0 || data.size > MAX_FILE_BYTES) {
		throw new Error(`GitHub file exceeds the ${MAX_FILE_BYTES}-byte maximum size.`);
	}

	const bytes = Buffer.from(data.content.replaceAll("\n", ""), "base64");
	if (bytes.byteLength !== data.size || bytes.byteLength > MAX_FILE_BYTES) {
		throw new Error("GitHub file size does not match the bounded response.");
	}
	if (bytes.includes(0)) throw new Error("GitHub file is binary and cannot be returned as source text.");

	let content;
	try {
		content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch (error) {
		throw new Error("GitHub file is not valid UTF-8 source text.", { cause: error });
	}
	if (content.startsWith("version https://git-lfs.github.com/spec/v1\n")) {
		throw new Error("The requested GitHub path is a Git LFS pointer, not source content.");
	}
	return content;
}

export function createGitHubSourceReader({ fetch: fetchRequest, getToken }) {
	if (typeof fetchRequest !== "function" || typeof getToken !== "function") {
		throw new Error("GitHub source reader requires fetch and token providers.");
	}
	let tokenPromise;

	async function requestJson(endpoint) {
		tokenPromise ??= Promise.resolve().then(getToken).catch(() => undefined);
		const token = await tokenPromise;
		const headers = {
			accept: "application/vnd.github+json",
			"user-agent": "dev-stack-opencode-profile",
			"x-github-api-version": "2022-11-28",
		};
		if (token) headers.authorization = `Bearer ${token}`;

		let response;
		try {
			response = await fetchRequest(`${API_ROOT}${endpoint}`, {
				method: "GET",
				headers,
				redirect: "manual",
				signal: AbortSignal.timeout(30_000),
			});
		} catch (error) {
			throw new Error("GitHub source read failed before receiving a response.", { cause: error });
		}
		if (!response.ok) throw responseError(response);
		try {
			return await response.json();
		} catch (error) {
			throw new Error("GitHub source read returned invalid JSON.", { cause: error });
		}
	}

	async function getCommit({ owner, repository, commit }) {
		const repositoryEndpoint = repositoryPath(owner, repository);
		const requestedCommit = validateCommit(commit);
		const data = await requestJson(`${repositoryEndpoint}/commits/${requestedCommit}`);
		if (typeof data.sha !== "string" || data.sha.toLowerCase() !== requestedCommit) {
			throw new Error("GitHub's resolved commit does not match the requested commit.");
		}
		if (typeof data.commit?.tree?.sha !== "string" || !COMMIT_SHA.test(data.commit.tree.sha)) {
			throw new Error("GitHub commit response is missing a valid tree identity.");
		}
		return {
			owner,
			repository,
			commit: requestedCommit,
			tree: data.commit.tree.sha.toLowerCase(),
		};
	}

	async function listTree({ owner, repository, commit, path = "" }) {
		const identity = await getCommit({ owner, repository, commit });
		const encodedPath = validatePath(path, { allowRoot: true });
		const suffix = encodedPath ? `/contents/${encodedPath}` : "/contents";
		const data = await requestJson(
			`${repositoryPath(owner, repository)}${suffix}?ref=${identity.commit}`,
		);
		if (!Array.isArray(data)) throw new Error("The requested GitHub path is not a directory.");
		if (data.length > MAX_DIRECTORY_ENTRIES) {
			throw new Error(`GitHub directory exceeds the ${MAX_DIRECTORY_ENTRIES}-entry maximum.`);
		}
		return {
			...identity,
			path,
			entries: data.map((entry) => ({
				name: entry.name,
				path: entry.path,
				type: entry.type,
				sha: entry.sha,
				size: entry.size,
			})),
		};
	}

	async function readFile({ owner, repository, commit, path }) {
		const identity = await getCommit({ owner, repository, commit });
		const encodedPath = validatePath(path, { allowRoot: false });
		const data = await requestJson(
			`${repositoryPath(owner, repository)}/contents/${encodedPath}?ref=${identity.commit}`,
		);
		return {
			...identity,
			path: data.path,
			blob: data.sha,
			size: data.size,
			content: decodeFile(data),
		};
	}

	return { getCommit, listTree, readFile };
}

export const GITHUB_SOURCE_LIMITS = Object.freeze({
	maxFileBytes: MAX_FILE_BYTES,
	maxDirectoryEntries: MAX_DIRECTORY_ENTRIES,
});
