import { execFile } from "node:child_process";
import { promisify } from "node:util";

const PLUGIN_ID = "felipe-tomino.session-forks";
const COMMAND_NAMESPACE = "session.forks";
const executeFile = promisify(execFile);

const FORK_ENVIRONMENT_KEYS = [
    "OCX_BIN",
    "OCX_CONTEXT",
    "OCX_PROFILE",
    "OCX_TITLE_CONTEXT",
    "OPENCODE_BIN",
    "OPENCODE_CONFIG",
    "OPENCODE_CONFIG_CONTENT",
    "OPENCODE_CONFIG_DIR",
    "OPENCODE_DISABLE_AUTOUPDATE",
    "OPENCODE_DISABLE_GLOBAL_CONFIG",
    "OPENCODE_DISABLE_PROJECT_CONFIG",
];

function currentSessionID(api) {
    const route = api.route.current;
    const sessionID = route?.name === "session" ? route.params?.sessionID : undefined;
    return typeof sessionID === "string" && sessionID.length > 0 ? sessionID : undefined;
}

function showToast(api, variant, message) {
    api.ui.toast({ variant, title: "Session forks", message });
}

async function sessionForCurrentRoute(api) {
    const sessionID = currentSessionID(api);
    if (!sessionID) {
        showToast(api, "warning", "Open a session before navigating its forks.");
        return undefined;
    }

    const response = await api.client.session.get({ sessionID });
    if (response.error || !response.data) {
        throw new Error("Could not read the active session.");
    }
    return response.data;
}

async function navigateToParent(api) {
    const session = await sessionForCurrentRoute(api);
    if (!session) return;
    if (!session.parentID) {
        showToast(api, "warning", "This session has no parent.");
        return;
    }

    api.route.navigate("session", { sessionID: session.parentID });
}

async function navigateToSibling(api, direction) {
    const session = await sessionForCurrentRoute(api);
    if (!session) return;
    if (!session.parentID) {
        showToast(api, "warning", "This session has no siblings.");
        return;
    }

    const response = await api.client.session.children({ sessionID: session.parentID });
    if (response.error || !response.data) {
        throw new Error("Could not read sibling forks.");
    }

    const siblings = [...response.data].sort((left, right) => left.time.created - right.time.created);
    const currentIndex = siblings.findIndex((sibling) => sibling.id === session.id);
    if (currentIndex < 0) {
        throw new Error("The active session is missing from its parent's fork list.");
    }
    const target = siblings[currentIndex + direction];
    if (!target) {
        showToast(api, "warning", direction < 0 ? "This is the first sibling." : "This is the last sibling.");
        return;
    }

    api.route.navigate("session", { sessionID: target.id });
}

function inheritedForkEnvironment(environment) {
    return FORK_ENVIRONMENT_KEYS.flatMap((key) => {
        const value = environment[key];
        return typeof value === "string" && value.length > 0 ? [`${key}=${value}`] : [];
    });
}

function quoteShellArgument(value) {
    return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function opencodeForkCommand(environment, sessionID) {
    const executable = environment.OPENCODE_BIN || "opencode";
    return `${quoteShellArgument(executable)} --session ${quoteShellArgument(sessionID)} --fork`;
}

function requireCreatedTab(response) {
    const tabID = response?.result?.tab?.tab_id;
    const paneID = response?.result?.root_pane?.pane_id;
    if (typeof tabID !== "string" || typeof paneID !== "string") {
        throw new Error("Herdr created a tab without returning its tab and pane identifiers.");
    }
    return { tabID, paneID };
}

async function executeHerdr(args) {
    let stdout;
    try {
        ({ stdout } = await executeFile("herdr", args, {
            encoding: "utf8",
            maxBuffer: 1024 * 1024,
        }));
    } catch (error) {
        const stderr = typeof error?.stderr === "string" ? error.stderr.trim() : "";
        throw new Error(stderr || "Herdr command failed.");
    }

    const output = stdout.trim();
    if (!output) return undefined;
    try {
        return JSON.parse(output);
    } catch {
        throw new Error("Herdr returned an unreadable response.");
    }
}

async function forkToNewTab(api, dependencies, focus) {
    const { environment, cwd, runHerdr } = dependencies;
    const sessionID = currentSessionID(api);
    if (!sessionID) {
        showToast(api, "warning", "Open a session before creating a tab fork.");
        return;
    }
    if (
        environment.HERDR_ENV !== "1" ||
        !environment.HERDR_SOCKET_PATH ||
        !environment.HERDR_WORKSPACE_ID ||
        !environment.HERDR_PANE_ID
    ) {
        showToast(api, "warning", "New-tab forks require OpenCode to run inside Herdr.");
        return;
    }

    const environmentArguments = inheritedForkEnvironment(environment).flatMap((entry) => ["--env", entry]);
    const created = await runHerdr([
        "tab",
        "create",
        "--workspace",
        environment.HERDR_WORKSPACE_ID,
        "--cwd",
        cwd,
        "--no-focus",
        ...environmentArguments,
    ]);
    const { tabID, paneID } = requireCreatedTab(created);

    await runHerdr(["pane", "run", paneID, opencodeForkCommand(environment, sessionID)]);
    if (focus) await runHerdr(["tab", "focus", tabID]);
    showToast(api, "success", focus ? "Fork started in focused tab." : "Fork started in background tab.");
}

function errorMessage(error) {
    return error instanceof Error ? error.message : "Session fork operation failed.";
}

export function createSessionForkPlugin({
    environment = process.env,
    cwd = process.cwd(),
    runHerdr = executeHerdr,
} = {}) {
    return {
        id: PLUGIN_ID,
        tui: async (api) => {
            let operationInProgress = false;

            const run = (operation) => async () => {
                if (operationInProgress) {
                    showToast(api, "warning", "A session fork operation is already in progress.");
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

            const dependencies = { environment, cwd, runHerdr };
            api.keymap.registerLayer({
                bindings: [
                    {
                        key: "<leader>shift+f",
                        cmd: `${COMMAND_NAMESPACE}.background`,
                        desc: "Fork in background tab",
                    },
                    {
                        key: "<leader>shift+g",
                        cmd: `${COMMAND_NAMESPACE}.focus`,
                        desc: "Fork in focused tab",
                    },
                ],
                commands: [
                    {
                        name: `${COMMAND_NAMESPACE}.background`,
                        title: "Fork in background tab",
                        category: "Sessions",
                        namespace: "palette",
                        desc: "Fork the current session in a new Herdr tab without changing focus.",
                        slashName: "fork-tab",
                        run: run(() => forkToNewTab(api, dependencies, false)),
                    },
                    {
                        name: `${COMMAND_NAMESPACE}.focus`,
                        title: "Fork in focused tab",
                        category: "Sessions",
                        namespace: "palette",
                        desc: "Fork the current session in a new Herdr tab and focus it.",
                        slashName: "fork-tab-focus",
                        run: run(() => forkToNewTab(api, dependencies, true)),
                    },
                    {
                        name: `${COMMAND_NAMESPACE}.parent`,
                        title: "Go to fork parent",
                        category: "Sessions",
                        namespace: "palette",
                        desc: "Open the parent of the current fork.",
                        slashName: "fork-parent",
                        run: run(() => navigateToParent(api)),
                    },
                    {
                        name: `${COMMAND_NAMESPACE}.previous`,
                        title: "Go to previous fork sibling",
                        category: "Sessions",
                        namespace: "palette",
                        desc: "Open the fork created immediately before this one.",
                        slashName: "fork-previous",
                        run: run(() => navigateToSibling(api, -1)),
                    },
                    {
                        name: `${COMMAND_NAMESPACE}.next`,
                        title: "Go to next fork sibling",
                        category: "Sessions",
                        namespace: "palette",
                        desc: "Open the fork created immediately after this one.",
                        slashName: "fork-next",
                        run: run(() => navigateToSibling(api, 1)),
                    },
                ],
            });
        },
    };
}

export default createSessionForkPlugin();
