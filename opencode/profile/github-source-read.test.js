import assert from "node:assert/strict";
import test from "node:test";

import { createGitHubSourceReader } from "./plugins/github-source/core.js";

const commit = "0123456789abcdef0123456789abcdef01234567";

function response(status, body, headers = {}) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json", ...headers },
	});
}

test("all operations reject mutable or abbreviated revisions before making a request", async () => {
	let requests = 0;
	const reader = createGitHubSourceReader({
		fetch: async () => {
			requests += 1;
			throw new Error("unexpected request");
		},
		getToken: async () => undefined,
	});

	for (const revision of ["main", "v1.0.0", commit.slice(0, 12), `${commit}00`]) {
		await assert.rejects(
			reader.readFile({ owner: "example", repository: "project", commit: revision, path: "README.md" }),
			/40-character commit SHA/,
		);
	}
	assert.equal(requests, 0);
});

test("commit lookup fails closed when GitHub resolves another identity", async () => {
	const reader = createGitHubSourceReader({
		fetch: async () => response(200, {
			sha: "fedcba9876543210fedcba9876543210fedcba98",
			commit: { tree: { sha: "a".repeat(40) } },
		}),
		getToken: async () => undefined,
	});

	await assert.rejects(
		reader.getCommit({ owner: "example", repository: "project", commit }),
		/does not match the requested commit/,
	);
});

test("directory listing verifies the commit and reads one path at that exact SHA", async () => {
	const requests = [];
	const reader = createGitHubSourceReader({
		fetch: async (url, options) => {
			requests.push({ url: String(url), options });
			if (requests.length === 1) {
				return response(200, { sha: commit, commit: { tree: { sha: "a".repeat(40) } } });
			}
			return response(200, [
				{ name: "core.js", path: "src/core.js", sha: "b".repeat(40), size: 120, type: "file" },
				{ name: "tests", path: "src/tests", sha: "c".repeat(40), size: 0, type: "dir" },
			]);
		},
		getToken: async () => "secret-token",
	});

	const result = await reader.listTree({ owner: "example", repository: "project", commit, path: "src" });

	assert.equal(result.commit, commit);
	assert.deepEqual(result.entries.map(({ path: entryPath, type }) => [entryPath, type]), [
		["src/core.js", "file"],
		["src/tests", "dir"],
	]);
	assert.equal(requests[0].url, `https://api.github.com/repos/example/project/commits/${commit}`);
	assert.equal(requests[1].url, `https://api.github.com/repos/example/project/contents/src?ref=${commit}`);
	assert.equal(requests[0].options.method, "GET");
	assert.equal(requests[0].options.redirect, "manual");
	assert.equal(requests[0].options.headers.authorization, "Bearer secret-token");
});

test("file reads return bounded UTF-8 content without branch fallback", async () => {
	const encoded = Buffer.from("immutable content\n").toString("base64");
	let requests = 0;
	const reader = createGitHubSourceReader({
		fetch: async () => {
			requests += 1;
			if (requests === 1) {
				return response(200, { sha: commit, commit: { tree: { sha: "a".repeat(40) } } });
			}
			return response(200, {
				name: "README.md",
				path: "README.md",
				sha: "b".repeat(40),
				size: 18,
				type: "file",
				encoding: "base64",
				content: encoded,
			});
		},
		getToken: async () => undefined,
	});

	const result = await reader.readFile({ owner: "example", repository: "project", commit, path: "README.md" });
	assert.equal(result.commit, commit);
	assert.equal(result.content, "immutable content\n");
	assert.equal(requests, 2);
});

test("file reads reject redirects, non-files, binary data, LFS pointers, and oversized files", async () => {
	async function rejectsContent(fileResponse, expected) {
		let requests = 0;
		const reader = createGitHubSourceReader({
			fetch: async () => {
				requests += 1;
				if (requests === 1) {
					return response(200, { sha: commit, commit: { tree: { sha: "a".repeat(40) } } });
				}
				return fileResponse;
			},
			getToken: async () => undefined,
		});
		await assert.rejects(
			reader.readFile({ owner: "example", repository: "project", commit, path: "asset" }),
			expected,
		);
	}

	await rejectsContent(response(302, {}, { location: "https://example.com" }), /redirect/);
	await rejectsContent(response(200, { type: "dir" }), /not a regular file/);
	await rejectsContent(response(200, {
		type: "file", encoding: "base64", size: 3, content: Buffer.from([0, 1, 2]).toString("base64"),
	}), /binary/);
	const lfsPointer = "version https://git-lfs.github.com/spec/v1\noid sha256:abc\n";
	await rejectsContent(response(200, {
		type: "file", encoding: "base64", size: Buffer.byteLength(lfsPointer),
		content: Buffer.from(lfsPointer).toString("base64"),
	}), /Git LFS pointer/);
	await rejectsContent(response(200, {
		type: "file", encoding: "base64", size: 300_000, content: "",
	}), /maximum size/);
});

test("not-found errors remain explicit and never retry against a default branch", async () => {
	let requests = 0;
	const reader = createGitHubSourceReader({
		fetch: async () => {
			requests += 1;
			return response(404, { message: "Not Found" });
		},
		getToken: async () => undefined,
	});

	await assert.rejects(
		reader.listTree({ owner: "example", repository: "private-project", commit }),
		/not found or is not visible/,
	);
	assert.equal(requests, 1);
});
