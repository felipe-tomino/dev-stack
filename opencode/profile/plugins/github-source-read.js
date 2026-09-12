import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { createGitHubSourceReader, GITHUB_SOURCE_LIMITS } from "./github-source/core.js";
import { tool } from "./tool-definition/index.js";

const executeFile = promisify(execFile);

async function getGitHubToken() {
	const environmentToken = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
	if (environmentToken) return environmentToken;
	try {
		const { stdout } = await executeFile("gh", ["auth", "token"], {
			encoding: "utf8",
			maxBuffer: 16 * 1024,
			timeout: 10_000,
		});
		return stdout.trim() || undefined;
	} catch {
		return undefined;
	}
}

function sourceIdentityArguments() {
	return {
		owner: tool.schema.string().describe("GitHub organization or user name"),
		repository: tool.schema.string().describe("GitHub repository name without an owner or URL"),
		commit: tool.schema.string().describe("Exact full 40-character commit SHA; branches, tags, and abbreviations are rejected"),
	};
}

export default async function GitHubSourceReadPlugin() {
	const reader = createGitHubSourceReader({ fetch, getToken: getGitHubToken });
	return {
		tool: {
			github_source_commit: tool({
				description: "Verify an exact GitHub commit SHA and return its immutable commit and tree identity.",
				args: sourceIdentityArguments(),
				async execute(args) {
					return JSON.stringify(await reader.getCommit(args), null, 2);
				},
			}),
			github_source_tree: tool({
				description: `List one GitHub directory at an exact full commit SHA. Returns at most ${GITHUB_SOURCE_LIMITS.maxDirectoryEntries} entries and never falls back to a branch.`,
				args: {
					...sourceIdentityArguments(),
					path: tool.schema.string().optional().describe("Repository-relative directory path; omit for the root"),
				},
				async execute(args) {
					return JSON.stringify(await reader.listTree(args), null, 2);
				},
			}),
			github_source_file: tool({
				description: `Read one UTF-8 GitHub source file at an exact full commit SHA. Rejects redirects, binary data, Git LFS pointers, and files over ${GITHUB_SOURCE_LIMITS.maxFileBytes} bytes.`,
				args: {
					...sourceIdentityArguments(),
					path: tool.schema.string().describe("Repository-relative file path"),
				},
				async execute(args) {
					return JSON.stringify(await reader.readFile(args), null, 2);
				},
			}),
		},
	};
}
