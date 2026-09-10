import assert from "node:assert/strict";
import test from "node:test";

import { createHunkReviewPlugin } from "./hunk-review.js";

function createApi() {
    let layer;
    const toasts = [];
    return {
        api: {
            keymap: {
                registerLayer: (registeredLayer) => {
                    layer = registeredLayer;
                },
            },
            ui: {
                toast: (toast) => toasts.push(toast),
            },
        },
        bindings: () => layer.bindings,
        commands: () => layer.commands,
        toasts,
    };
}

function createHerdrRunner(calls) {
    return async (args) => {
        calls.push(args);
        if (args[0] === "tab" && args[1] === "create") {
            return {
                result: {
                    tab: { tab_id: "w14:t2" },
                    root_pane: { pane_id: "w14:p2" },
                },
            };
        }
        if (args[0] === "pane" && args[1] === "process-info") {
            return {
                result: {
                    process_info: {
                        shell_pid: 101,
                        foreground_processes: [{ pid: 101, name: "zsh" }],
                    },
                },
            };
        }
        return { result: { type: "ok" } };
    };
}

const environment = {
    HERDR_ENV: "1",
    HERDR_PANE_ID: "w14:p1",
    HERDR_SOCKET_PATH: "/tmp/herdr.sock",
    HERDR_WORKSPACE_ID: "w14",
};

async function waitForShell(runHerdr, paneID) {
    await runHerdr(["pane", "process-info", "--pane", paneID]);
    await runHerdr(["pane", "process-info", "--pane", paneID]);
}

test("registers working-tree and branch review commands", async () => {
    const harness = createApi();
    const plugin = createHunkReviewPlugin({
        checkHunk: async () => {},
        environment,
        cwd: "/repo",
        runHerdr: createHerdrRunner([]),
        waitForShell,
    });

    await plugin.tui(harness.api);

    assert.deepEqual(harness.bindings(), [
        {
            key: "<leader>shift+h",
            cmd: "review.hunk.working-tree",
            desc: "Review working tree in Hunk",
        },
    ]);
    assert.deepEqual(
        harness.commands().map(({ name, slashName }) => ({ name, slashName })),
        [
            { name: "review.hunk.working-tree", slashName: "hunk-review" },
            { name: "review.hunk.branch", slashName: "hunk-review-branch" },
        ],
    );
});

test("opens the working tree in a focused Herdr tab", async () => {
    const calls = [];
    const harness = createApi();
    const plugin = createHunkReviewPlugin({
        checkHunk: async () => {},
        environment: {
            ...environment,
            HUNK_BIN: "/opt/Hunk tools/hunk's-safe;bin",
        },
        cwd: "/repo with spaces",
        runHerdr: createHerdrRunner(calls),
        waitForShell,
    });

    await plugin.tui(harness.api);
    await harness.commands().find(({ name }) => name === "review.hunk.working-tree").run();

    assert.deepEqual(calls, [
        [
            "tab",
            "create",
            "--workspace",
            "w14",
            "--cwd",
            "/repo with spaces",
            "--no-focus",
        ],
        ["pane", "process-info", "--pane", "w14:p2"],
        ["pane", "process-info", "--pane", "w14:p2"],
        [
            "pane",
            "run",
            "w14:p2",
            "'/opt/Hunk tools/hunk'\"'\"'s-safe;bin' 'diff'",
        ],
        ["tab", "focus", "w14:t2"],
    ]);
    assert.deepEqual(harness.toasts, [
        {
            variant: "success",
            title: "Hunk review",
            message: "Working-tree review opened in Hunk.",
        },
    ]);
});

test("reviews branch changes from the merge base of the only remote default", async () => {
    const herdrCalls = [];
    const gitCalls = [];
    const runGit = async (args) => {
        gitCalls.push(args);
        if (args[0] === "remote") return "upstream\n";
        if (args[0] === "symbolic-ref") return "upstream/trunk\n";
        if (args[0] === "merge-base") return "abc1234000000000000000000000000000000000\n";
        throw new Error(`Unexpected Git call: ${args.join(" ")}`);
    };
    const harness = createApi();
    const plugin = createHunkReviewPlugin({
        checkHunk: async () => {},
        environment,
        cwd: "/repo",
        runGit,
        runHerdr: createHerdrRunner(herdrCalls),
        waitForShell,
    });

    await plugin.tui(harness.api);
    await harness.commands().find(({ name }) => name === "review.hunk.branch").run();

    assert.deepEqual(gitCalls, [
        ["remote"],
        ["symbolic-ref", "--quiet", "--short", "refs/remotes/upstream/HEAD"],
        ["merge-base", "HEAD", "upstream/trunk"],
    ]);
    assert.equal(herdrCalls[3][3], "'hunk' 'diff' 'abc1234000000000000000000000000000000000'");
    assert.deepEqual(harness.toasts, [
        {
            variant: "success",
            title: "Hunk review",
            message: "Branch review opened from upstream/trunk.",
        },
    ]);
});

test("refuses to guess when multiple remotes advertise default branches", async () => {
    const herdrCalls = [];
    const harness = createApi();
    const runGit = async (args) => {
        if (args[0] === "remote") return "origin\nupstream\n";
        const remote = args[args.length - 1].split("/").at(-2);
        return `${remote}/main\n`;
    };
    const plugin = createHunkReviewPlugin({
        checkHunk: async () => {},
        environment,
        cwd: "/repo",
        runGit,
        runHerdr: createHerdrRunner(herdrCalls),
        waitForShell,
    });

    await plugin.tui(harness.api);
    await harness.commands().find(({ name }) => name === "review.hunk.branch").run();

    assert.deepEqual(herdrCalls, []);
    assert.deepEqual(harness.toasts, [
        {
            variant: "error",
            title: "Hunk review",
            message: "Multiple remote default branches found: origin/main, upstream/main.",
        },
    ]);
});

test("does not open a review tab outside Herdr", async () => {
    const calls = [];
    const harness = createApi();
    const plugin = createHunkReviewPlugin({
        checkHunk: async () => {},
        environment: {},
        cwd: "/repo",
        runHerdr: createHerdrRunner(calls),
        waitForShell,
    });

    await plugin.tui(harness.api);
    await harness.commands().find(({ name }) => name === "review.hunk.working-tree").run();

    assert.deepEqual(calls, []);
    assert.deepEqual(harness.toasts, [
        {
            variant: "warning",
            title: "Hunk review",
            message: "Hunk review tabs require OpenCode to run inside Herdr.",
        },
    ]);
});

test("reports a missing Hunk executable before creating a tab", async () => {
    const calls = [];
    const harness = createApi();
    const plugin = createHunkReviewPlugin({
        checkHunk: async () => {
            throw new Error("Hunk is not installed or is not executable.");
        },
        environment,
        cwd: "/repo",
        runHerdr: createHerdrRunner(calls),
        waitForShell,
    });

    await plugin.tui(harness.api);
    await harness.commands().find(({ name }) => name === "review.hunk.working-tree").run();

    assert.deepEqual(calls, []);
    assert.deepEqual(harness.toasts, [
        {
            variant: "error",
            title: "Hunk review",
            message: "Hunk is not installed or is not executable.",
        },
    ]);
});
