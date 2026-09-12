import {
	createSessionWorkSpecToolHandlers,
	createSessionWorkSpecRuntime,
	MAX_WORK_SPEC_BYTES,
} from "./session-work-spec/core.js";
import { tool } from "./tool-definition/index.js";

function requireStateDirectory(response) {
	const stateDirectory = response?.data?.state;
	if (typeof stateDirectory !== "string" || stateDirectory.length === 0) {
		throw new Error("OpenCode did not provide its state directory.");
	}
	return stateDirectory;
}

export default async function SessionWorkSpec({ client, project, worktree }) {
	const runtime = createSessionWorkSpecRuntime({
		client,
		projectID: project.id,
		worktree,
		getStateDirectory: async () => requireStateDirectory(await client.path.get()),
		log: (record) =>
			client.app
				.log({
					body: {
						service: "session-work-spec",
						level: "warn",
						message: JSON.stringify(record),
					},
				})
				.catch(() => {}),
	});
	const handlers = createSessionWorkSpecToolHandlers(runtime);

	return {
		tool: {
			work_spec_read: tool({
				description: "Read the work spec shared by the current root session and its children.",
				args: {},
				async execute(_args, context) {
					return handlers.read(context);
				},
			}),
			work_spec_write: tool({
				description: "Replace the work spec shared by the current root session and its children.",
				args: {
					content: tool.schema
						.string()
						.min(1)
						.max(MAX_WORK_SPEC_BYTES)
						.describe("Complete Markdown work spec to persist."),
				},
				async execute({ content }, context) {
					return handlers.write(content, context);
				},
			}),
		},
		"experimental.session.compacting": async ({ sessionID }, output) => {
			await runtime.compact(sessionID, output);
		},
		event: async ({ event }) => {
			if (event.type !== "session.deleted") return;
			await runtime.deleted(event.properties?.info);
		},
	};
}
