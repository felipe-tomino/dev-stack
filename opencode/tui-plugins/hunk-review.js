import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
    executeHerdr,
    quoteShellArgument,
    requireCreatedTab,
    waitForPaneShell,
} from "./herdr-tui.js";

const PLUGIN_ID = "dev-stack.hunk-review";
const COMMAND_NAMESPACE = "review.hunk";
const executeFile = promisify(execFile);

function showToast(api, variant, message) {
    api.ui.toast({ variant, title: "Hunk review", message });
}

function isInsideHerdr(environment) {
    return (
        environment.HERDR_ENV === "1" &&
        Boolean(environment.HERDR_SOCKET_PATH) &&
        Boolean(environment.HERDR_WORKSPACE_ID) &&
        Boolean(environment.HERDR_PANE_ID)
    );
}

function hunkCommand(environment, ...args) {
    const executable = environment.HUNK_BIN || "hunk";
    return [executable, ...args].map(quoteShellArgument).join(" ");
}

function parseLines(output) {
    return output
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
}

function parseSingleLine(output, description) {
    const lines = parseLines(output);
    if (lines.length !== 1) throw new Error(`Git returned an invalid ${description}.`);
    return lines[0];
}

async function remoteDefaultBranches(runGit) {
    const remotes = parseLines(await runGit(["remote"]));
    const defaults = [];

    for (const remote of remotes) {
        let output;
        try {
            output = await runGit([
                "symbolic-ref",
                "--quiet",
                "--short",
                `refs/remotes/${remote}/HEAD`,
            ]);
        } catch {
            continue;
        }

        const defaultBranch = parseSingleLine(output, `default branch for ${remote}`);
        if (!defaultBranch.startsWith(`${remote}/`)) {
            throw new Error(`Git returned an invalid default branch for ${remote}.`);
        }
        defaults.push(defaultBranch);
    }

    return defaults;
}

async function branchReviewTarget(runGit) {
    const defaults = await remoteDefaultBranches(runGit);
    if (defaults.length === 0) {
        throw new Error("No remote default branch is configured for this repository.");
    }
    if (defaults.length > 1) {
        throw new Error(`Multiple remote default branches found: ${defaults.join(", ")}.`);
    }

    const defaultBranch = defaults[0];
    const mergeBase = parseSingleLine(
        await runGit(["merge-base", "HEAD", defaultBranch]),
        `merge base for ${defaultBranch}`,
    );
    if (!/^[0-9a-f]{40,64}$/iu.test(mergeBase)) {
        throw new Error(`Git returned an invalid merge base for ${defaultBranch}.`);
    }
    return { defaultBranch, mergeBase };
}

async function openHunkTab(api, dependencies, args, successMessage) {
    const { checkHunk, cwd, environment, runHerdr, waitForShell } = dependencies;
    await checkHunk();
    const created = await runHerdr([
        "tab",
        "create",
        "--workspace",
        environment.HERDR_WORKSPACE_ID,
        "--cwd",
        cwd,
        "--no-focus",
    ]);
    const { tabID, paneID } = requireCreatedTab(created);

    await waitForShell(runHerdr, paneID);
    await runHerdr(["pane", "run", paneID, hunkCommand(environment, ...args)]);
    await runHerdr(["tab", "focus", tabID]);
    showToast(api, "success", successMessage);
}

async function openWorkingTreeReview(api, dependencies) {
    await openHunkTab(api, dependencies, ["diff"], "Working-tree review opened in Hunk.");
}

async function openBranchReview(api, dependencies) {
    const { defaultBranch, mergeBase } = await branchReviewTarget(dependencies.runGit);
    await openHunkTab(
        api,
        dependencies,
        ["diff", mergeBase],
        `Branch review opened from ${defaultBranch}.`,
    );
}

function errorMessage(error) {
    return error instanceof Error ? error.message : "Hunk review operation failed.";
}

function createGitRunner(cwd) {
    return async (args) => {
        try {
            const { stdout } = await executeFile("git", args, {
                cwd,
                encoding: "utf8",
                maxBuffer: 1024 * 1024,
            });
            return stdout;
        } catch (error) {
            const stderr = typeof error?.stderr === "string" ? error.stderr.trim() : "";
            throw new Error(stderr || "Git command failed.");
        }
    };
}

function createHunkChecker(environment) {
    return async () => {
        try {
            await executeFile(environment.HUNK_BIN || "hunk", ["--version"], {
                encoding: "utf8",
                maxBuffer: 1024 * 1024,
            });
        } catch {
            throw new Error("Hunk is not installed or is not executable.");
        }
    };
}

export function createHunkReviewPlugin({
    environment = process.env,
    checkHunk = createHunkChecker(environment),
    cwd = process.cwd(),
    runGit = createGitRunner(cwd),
    runHerdr = executeHerdr,
    waitForShell = waitForPaneShell,
} = {}) {
    return {
        id: PLUGIN_ID,
        tui: async (api) => {
            let operationInProgress = false;

            const run = (operation) => async () => {
                if (operationInProgress) {
                    showToast(api, "warning", "A Hunk review operation is already in progress.");
                    return;
                }
                if (!isInsideHerdr(environment)) {
                    showToast(api, "warning", "Hunk review tabs require OpenCode to run inside Herdr.");
                    return;
                }

                operationInProgress = true;
                try {
                    await operation();
                } catch (error) {
                    showToast(api, "error", errorMessage(error));
                } finally {
                    operationInProgress = false;
                }
            };

            const dependencies = { checkHunk, cwd, environment, runGit, runHerdr, waitForShell };
            api.keymap.registerLayer({
                bindings: [
                    {
                        key: "<leader>shift+h",
                        cmd: `${COMMAND_NAMESPACE}.working-tree`,
                        desc: "Review working tree in Hunk",
                    },
                ],
                commands: [
                    {
                        name: `${COMMAND_NAMESPACE}.working-tree`,
                        title: "Review working tree in Hunk",
                        category: "Review",
                        namespace: "palette",
                        desc: "Open the active worktree's staged, unstaged, and untracked changes in Hunk.",
                        slashName: "hunk-review",
                        run: run(() => openWorkingTreeReview(api, dependencies)),
                    },
                    {
                        name: `${COMMAND_NAMESPACE}.branch`,
                        title: "Review branch in Hunk",
                        category: "Review",
                        namespace: "palette",
                        desc: "Open branch changes from the merge base of the configured remote default.",
                        slashName: "hunk-review-branch",
                        run: run(() => openBranchReview(api, dependencies)),
                    },
                ],
            });
        },
    };
}

export default createHunkReviewPlugin();
