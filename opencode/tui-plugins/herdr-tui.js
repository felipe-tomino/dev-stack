import { execFile } from "node:child_process";
import { promisify } from "node:util";

const executeFile = promisify(execFile);
const POLL_INTERVAL_MS = 100;
const SHELL_STABILITY_MS = 500;

function sleep(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function quoteShellArgument(value) {
    return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function requireCreatedTab(response) {
    const tabID = response?.result?.tab?.tab_id;
    const paneID = response?.result?.root_pane?.pane_id;
    if (typeof tabID !== "string" || typeof paneID !== "string") {
        throw new Error("Herdr created a tab without returning its tab and pane identifiers.");
    }
    return { tabID, paneID };
}

function hasIdleForegroundShell(response) {
    const processInfo = response?.result?.process_info;
    const shellPID = processInfo?.shell_pid;
    const foregroundProcesses = processInfo?.foreground_processes;
    if (!Number.isInteger(shellPID) || !Array.isArray(foregroundProcesses)) {
        throw new Error("Herdr returned unreadable pane process information.");
    }

    return foregroundProcesses.length === 1 && foregroundProcesses[0]?.pid === shellPID;
}

export async function waitForPaneShell(
    runHerdr,
    paneID,
    { attempts = 100, wait = sleep } = {},
) {
    let idleShellObserved = false;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
        const response = await runHerdr(["pane", "process-info", "--pane", paneID]);
        if (hasIdleForegroundShell(response)) {
            if (idleShellObserved) return;
            idleShellObserved = true;
            await wait(SHELL_STABILITY_MS);
            continue;
        }

        idleShellObserved = false;
        if (attempt + 1 < attempts) await wait(POLL_INTERVAL_MS);
    }

    throw new Error("New Herdr tab did not reach an idle shell prompt.");
}

export async function executeHerdr(args) {
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
