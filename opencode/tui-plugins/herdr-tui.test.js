import assert from "node:assert/strict";
import test from "node:test";

import { waitForPaneShell } from "./herdr-tui.js";

test("waits until the pane shell is the only foreground process", async () => {
    const calls = [];
    const sleeps = [];
    const responses = [
        {
            result: {
                process_info: {
                    shell_pid: 101,
                    foreground_processes: [
                        { pid: 101, name: "zsh" },
                        { pid: 202, name: "curl" },
                    ],
                },
            },
        },
        {
            result: {
                process_info: {
                    shell_pid: 101,
                    foreground_processes: [{ pid: 101, name: "zsh" }],
                },
            },
        },
        {
            result: {
                process_info: {
                    shell_pid: 101,
                    foreground_processes: [{ pid: 101, name: "zsh" }],
                },
            },
        },
    ];
    const runHerdr = async (args) => {
        calls.push(args);
        return responses.shift();
    };

    await waitForPaneShell(runHerdr, "w14:p2", {
        attempts: 3,
        wait: async (milliseconds) => sleeps.push(milliseconds),
    });

    assert.deepEqual(calls, [
        ["pane", "process-info", "--pane", "w14:p2"],
        ["pane", "process-info", "--pane", "w14:p2"],
        ["pane", "process-info", "--pane", "w14:p2"],
    ]);
    assert.deepEqual(sleeps, [100, 500]);
});

test("fails rather than typing into a pane that never reaches an idle shell", async () => {
    const runHerdr = async () => ({
        result: {
            process_info: {
                shell_pid: 101,
                foreground_processes: [
                    { pid: 101, name: "zsh" },
                    { pid: 202, name: "curl" },
                ],
            },
        },
    });

    await assert.rejects(
        waitForPaneShell(runHerdr, "w14:p2", {
            attempts: 2,
            wait: async () => {},
        }),
        /New Herdr tab did not reach an idle shell prompt/,
    );
});
