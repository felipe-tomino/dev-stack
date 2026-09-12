import { createToolExecutionGuard } from "./tool-execution-guard/core.js";

export default function ToolExecutionGuard({ client, worktree }) {
	return createToolExecutionGuard({
		workspaceRoot: worktree,
		audit: (record) =>
			client.app
				.log({
					body: {
						service: "tool-execution-guard",
						level: "warn",
						message: JSON.stringify(record),
					},
				})
				.catch(() => {}),
	});
}
