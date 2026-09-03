import assert from "node:assert/strict";
import test from "node:test";

import { createSessionForkPlugin } from "./session-forks.js";

function createApi() {
    let layer;
    const toasts = [];
    return {
        api: {
            route: {
                current: { name: "session", params: { sessionID: "ses_parent" } },
                navigate: () => {},
            },
            keymap: {
                registerLayer: (registeredLayer) => {
                    layer = registeredLayer;
                },
            },
            ui: {
                toast: (toast) => toasts.push(toast),
            },
        },
        commands: () => layer.commands,
        bindings: () => layer.bindings,
        toasts,
    };
}

function createRunner(calls) {
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
        return { result: { type: "ok" } };
    };
}

const environment = {
    HERDR_ENV: "1",
    HERDR_PANE_ID: "w14:p1",
    HERDR_SOCKET_PATH: "/tmp/herdr.sock",
    HERDR_WORKSPACE_ID: "w14",
    OPENCODE_BIN: "/opt/opencode/bin/opencode",
    OPENCODE_CONFIG_DIR: "/tmp/ocx profile",
    OPENCODE_DISABLE_PROJECT_CONFIG: "true",
    OPENCODE_PID: "1234",
    OCX_PROFILE: "ws",
};

test("registers one binding for each new-tab fork behavior", async () => {
    const harness = createApi();
    const plugin = createSessionForkPlugin({
        environment,
        cwd: "/repo",
        runHerdr: createRunner([]),
    });

    await plugin.tui(harness.api);

    assert.deepEqual(harness.bindings(), [
        {
            key: "<leader>shift+f",
            cmd: "session.forks.background",
            desc: "Fork in background tab",
        },
        {
            key: "<leader>shift+g",
            cmd: "session.forks.focus",
            desc: "Fork in focused tab",
        },
    ]);
    assert.deepEqual(
        harness.commands().map(({ name, slashName }) => ({ name, slashName })),
        [
            { name: "session.forks.background", slashName: "fork-tab" },
            { name: "session.forks.focus", slashName: "fork-tab-focus" },
            { name: "session.forks.parent", slashName: "fork-parent" },
            { name: "session.forks.previous", slashName: "fork-previous" },
            { name: "session.forks.next", slashName: "fork-next" },
        ],
    );
});

test("starts a fork in a background Herdr tab with the active profile environment", async () => {
    const calls = [];
    const harness = createApi();
    const plugin = createSessionForkPlugin({
        environment,
        cwd: "/repo with spaces",
        runHerdr: createRunner(calls),
    });

    await plugin.tui(harness.api);
    await harness.commands().find(({ name }) => name === "session.forks.background").run();

    assert.deepEqual(calls, [
        [
            "tab",
            "create",
            "--workspace",
            "w14",
            "--cwd",
            "/repo with spaces",
            "--no-focus",
            "--env",
            "OCX_PROFILE=ws",
            "--env",
            "OPENCODE_BIN=/opt/opencode/bin/opencode",
            "--env",
            "OPENCODE_CONFIG_DIR=/tmp/ocx profile",
            "--env",
            "OPENCODE_DISABLE_PROJECT_CONFIG=true",
        ],
        [
            "pane",
            "run",
            "w14:p2",
            "'/opt/opencode/bin/opencode' --session 'ses_parent' --fork",
        ],
    ]);
    assert.deepEqual(harness.toasts, [
        {
            variant: "success",
            title: "Session forks",
            message: "Fork started in background tab.",
        },
    ]);
});

test("focuses a new tab only after its fork command starts", async () => {
    const calls = [];
    const harness = createApi();
    const plugin = createSessionForkPlugin({
        environment,
        cwd: "/repo",
        runHerdr: createRunner(calls),
    });

    await plugin.tui(harness.api);
    await harness.commands().find(({ name }) => name === "session.forks.focus").run();

    assert.deepEqual(
        calls.map((args) => args.slice(0, 2)),
        [
            ["tab", "create"],
            ["pane", "run"],
            ["tab", "focus"],
        ],
    );
    assert.deepEqual(calls[1], [
        "pane",
        "run",
        "w14:p2",
        "'/opt/opencode/bin/opencode' --session 'ses_parent' --fork",
    ]);
    assert.deepEqual(calls[2], ["tab", "focus", "w14:t2"]);
});

test("does not report a focused fork as successful when focusing fails", async () => {
    const harness = createApi();
    const runHerdr = async (args) => {
        if (args[0] === "tab" && args[1] === "create") {
            return {
                result: {
                    tab: { tab_id: "w14:t2" },
                    root_pane: { pane_id: "w14:p2" },
                },
            };
        }
        if (args[0] === "tab" && args[1] === "focus") throw new Error("Could not focus the tab.");
        return { result: { type: "ok" } };
    };
    const plugin = createSessionForkPlugin({ environment, cwd: "/repo", runHerdr });

    await plugin.tui(harness.api);
    await harness.commands().find(({ name }) => name === "session.forks.focus").run();

    assert.deepEqual(harness.toasts, [
        {
            variant: "error",
            title: "Session forks",
            message: "Could not focus the tab.",
        },
    ]);
});

test("shell-quotes the OpenCode executable used in the new pane", async () => {
    const calls = [];
    const harness = createApi();
    const plugin = createSessionForkPlugin({
        environment: {
            ...environment,
            OPENCODE_BIN: "/opt/open code's/opencode; unsafe",
        },
        cwd: "/repo",
        runHerdr: createRunner(calls),
    });

    await plugin.tui(harness.api);
    await harness.commands().find(({ name }) => name === "session.forks.background").run();

    assert.equal(
        calls[1][3],
        "'/opt/open code'\"'\"'s/opencode; unsafe' --session 'ses_parent' --fork",
    );
});

test("does not create a tab outside Herdr", async () => {
    const calls = [];
    const harness = createApi();
    const plugin = createSessionForkPlugin({
        environment: {},
        cwd: "/repo",
        runHerdr: createRunner(calls),
    });

    await plugin.tui(harness.api);
    await harness.commands().find(({ name }) => name === "session.forks.background").run();

    assert.deepEqual(calls, []);
    assert.deepEqual(harness.toasts, [
        {
            variant: "warning",
            title: "Session forks",
            message: "New-tab forks require OpenCode to run inside Herdr.",
        },
    ]);
});

test("keeps fork graph navigation available in the current tab", async () => {
    const navigations = [];
    const harness = createApi();
    harness.api.route.navigate = (name, params) => navigations.push([name, params]);
    harness.api.client = {
        session: {
            get: async () => ({
                data: { id: "ses_parent", parentID: "ses_root" },
            }),
            children: async () => ({
                data: [
                    { id: "ses_previous", time: { created: 1 } },
                    { id: "ses_parent", time: { created: 2 } },
                    { id: "ses_next", time: { created: 3 } },
                ],
            }),
        },
    };
    const plugin = createSessionForkPlugin({
        environment,
        cwd: "/repo",
        runHerdr: createRunner([]),
    });

    await plugin.tui(harness.api);
    await harness.commands().find(({ name }) => name === "session.forks.parent").run();
    await harness.commands().find(({ name }) => name === "session.forks.previous").run();
    await harness.commands().find(({ name }) => name === "session.forks.next").run();

    assert.deepEqual(navigations, [
        ["session", { sessionID: "ses_root" }],
        ["session", { sessionID: "ses_previous" }],
        ["session", { sessionID: "ses_next" }],
    ]);
});

test("reports an inconsistent fork graph instead of navigating to the wrong sibling", async () => {
    const navigations = [];
    const harness = createApi();
    harness.api.route.navigate = (name, params) => navigations.push([name, params]);
    harness.api.client = {
        session: {
            get: async () => ({
                data: { id: "ses_missing", parentID: "ses_root" },
            }),
            children: async () => ({
                data: [
                    { id: "ses_first", time: { created: 1 } },
                    { id: "ses_second", time: { created: 2 } },
                ],
            }),
        },
    };
    const plugin = createSessionForkPlugin({
        environment,
        cwd: "/repo",
        runHerdr: createRunner([]),
    });

    await plugin.tui(harness.api);
    await harness.commands().find(({ name }) => name === "session.forks.next").run();

    assert.deepEqual(navigations, []);
    assert.deepEqual(harness.toasts, [
        {
            variant: "error",
            title: "Session forks",
            message: "The active session is missing from its parent's fork list.",
        },
    ]);
});
