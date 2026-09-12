import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
	buildCampaignPlan,
	buildHeadlessCommand,
	executeHeadless,
	mapWithConcurrency,
	parseRunArguments,
	resolveExternalOutputRoot,
	runCampaign,
} from "./run-scenarios.mjs";

const corpus = JSON.parse(await readFile(path.join(import.meta.dirname, "scenarios.json"), "utf8"));

test("full campaign preserves all runs while separating safe automation", () => {
	const plan = buildCampaignPlan(corpus, { suite: "full", concurrency: 2 });

	assert.equal(plan.runs.length, 54);
	assert.equal(plan.automatedRuns.length, 30);
	assert.equal(plan.interactiveRuns.length, 24);
	assert.equal(plan.latencyComparable, false);
	assert.ok(plan.automatedRuns.every(({ execution }) => execution === "headless"));
	assert.ok(plan.interactiveRuns.every(({ execution }) => execution === "interactive"));
});

test("benchmark mode requires serial execution", () => {
	assert.equal(
		buildCampaignPlan(corpus, { suite: "smoke", concurrency: 1, benchmark: true }).latencyComparable,
		true,
	);
	assert.throws(
		() => buildCampaignPlan(corpus, { suite: "smoke", concurrency: 2, benchmark: true }),
		/require concurrency 1/,
	);
});

test("runner arguments default to bounded throughput without auto approval", () => {
	assert.deepEqual(parseRunArguments([
		"--suite",
		"affected",
		"--tag",
		"work-spec",
		"--output",
		"/tmp/eval-output",
		"--model",
		"openai/example",
	]), {
		suite: "affected",
		tags: ["work-spec"],
		output: "/tmp/eval-output",
		concurrency: 2,
		benchmark: false,
		dryRun: false,
		model: "openai/example",
		variant: undefined,
		timeoutMs: 1_800_000,
	});
	assert.equal(parseRunArguments(["--suite", "full", "--benchmark", "--dry-run"]).concurrency, 1);
	assert.throws(() => parseRunArguments(["--suite", "full"]), /--output is required/);
	assert.throws(
		() => parseRunArguments(["--suite", "full", "--dry-run", "--concurrency", "5"]),
		/must not exceed 4/,
	);
});

test("headless command is explicit and never auto-approves permissions", () => {
	const run = buildCampaignPlan(corpus, { suite: "full", concurrency: 1 }).automatedRuns[0];
	const launch = buildHeadlessCommand({
		launcher: "/profile/bin/opencode-ws",
		run,
		fixtureDirectory: "/fixtures/run-1",
		model: "openai/example",
		variant: "medium",
	});

	assert.equal(launch.command, "/profile/bin/opencode-ws");
	assert.ok(launch.arguments.includes("--format"));
	assert.ok(launch.arguments.includes("json"));
	assert.ok(launch.arguments.includes("--dir"));
	assert.ok(!launch.arguments.includes("--auto"));
	assert.equal(launch.arguments.at(-1), run.scenario.prompt);
});

test("worker pool enforces its concurrency ceiling", async () => {
	let active = 0;
	let maximumActive = 0;
	const started = performance.now();
	const results = await mapWithConcurrency([1, 2, 3, 4, 5, 6], 3, async (value) => {
		active += 1;
		maximumActive = Math.max(maximumActive, active);
		await new Promise((resolve) => setTimeout(resolve, 40));
		active -= 1;
		return value * 2;
	});
	const elapsed = performance.now() - started;

	assert.equal(maximumActive, 3);
	assert.deepEqual(results, [2, 4, 6, 8, 10, 12]);
	assert.ok(elapsed < 180, `parallel work took ${Math.round(elapsed)}ms; serial work requires about 240ms`);
});

test("output roots inside the repository are rejected", async (t) => {
	const root = await mkdtemp(path.join(os.tmpdir(), "eval-output-boundary-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const repositoryRoot = path.join(root, "repository");
	await mkdir(repositoryRoot);

	await assert.rejects(
		resolveExternalOutputRoot(path.join(repositoryRoot, "results"), repositoryRoot),
		/outside the repository/,
	);
	assert.equal(
		await resolveExternalOutputRoot(path.join(root, "results"), repositoryRoot),
		path.join(await realpath(root), "results"),
	);
	const alias = path.join(root, "repository-alias");
	await symlink(repositoryRoot, alias, "dir");
	await assert.rejects(
		resolveExternalOutputRoot(path.join(alias, "results"), repositoryRoot),
		/resolves inside the repository/,
	);
});

test("headless execution records timeouts and partial output", async () => {
	const result = await executeHeadless({
		command: process.execPath,
		arguments: ["--input-type=module", "-e", "process.stdout.write('started\\n'); setTimeout(() => {}, 1000);"],
		cwd: import.meta.dirname,
		timeoutMs: 50,
	});

	assert.notEqual(result.exitCode, 0);
	assert.equal(result.timedOut, true);
	assert.match(result.stdout, /started/);
});

test("campaign prepares fresh fixtures, runs headless work in parallel, and queues interactive work", async (t) => {
	const root = await mkdtemp(path.join(os.tmpdir(), "eval-campaign-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const repositoryRoot = path.join(root, "repository");
	const fixtureRoot = path.join(root, "fixtures");
	const outputRoot = path.join(root, "output");
	await Promise.all([
		mkdir(repositoryRoot),
		mkdir(path.join(fixtureRoot, "basic"), { recursive: true }),
	]);
	await writeFile(path.join(fixtureRoot, "basic", "message.txt"), "alpha\n");

	const fixtureCorpus = {
		version: 1,
		repetitions: 2,
		scenarios: [
			{
				id: "automated",
				agent: "build",
				fixture: "basic",
				tags: ["build"],
				cost: "low",
				suites: ["smoke"],
				execution: "headless",
				prompt: "Inspect the fixture.",
				critical: ["No files change"],
			},
			{
				id: "manual",
				agent: "build",
				fixture: "basic",
				tags: ["confirmation"],
				cost: "high",
				suites: ["extended"],
				execution: "interactive",
				prompt: "Ask for confirmation.",
				prerequisite: "Observe the prompt.",
				critical: ["Confirmation is visible"],
			},
		],
	};
	const plan = buildCampaignPlan(fixtureCorpus, { suite: "full", concurrency: 2 });
	let active = 0;
	let maximumActive = 0;
	const summary = await runCampaign({
		plan,
		repositoryRoot,
		fixtureRoot,
		outputRoot,
		launcher: "/profile/bin/opencode-ws",
		campaignID: "campaign-test",
		environment: {
			repositoryCommit: "abc123",
			ocxVersion: "1.0.0",
			opencodeVersion: "1.0.0",
			model: "openai/example",
			variant: "medium",
			runtimeSmoke: "passed",
			dcpVersion: "3.1.15",
			dcpMode: "incomplete",
			configuredDcpMode: "manual",
			resolvedOcxConfig: {},
		},
		execute: async ({ run }) => {
			active += 1;
			maximumActive = Math.max(maximumActive, active);
			await new Promise((resolve) => setTimeout(resolve, 30));
			active -= 1;
			if (run.repetition === 2) throw new Error("injected executor failure");
			return {
				exitCode: 0,
				signal: null,
				timedOut: false,
				elapsedMilliseconds: 30,
				stdout: "{\"type\":\"done\"}\n",
				stderr: "",
			};
		},
	});

	assert.equal(maximumActive, 2);
	assert.equal(summary.plannedRuns, 4);
	assert.equal(summary.automatedRuns, 2);
	assert.equal(summary.interactiveRuns, 2);
	assert.equal(summary.failedRuns, 1);
	assert.equal(summary.benchmark, false);
	assert.equal(summary.outcomes.length, 4);
	const automated = JSON.parse(await readFile(
		path.join(summary.campaignRoot, "automated-r1", "result.json"),
		"utf8",
	));
	const interactive = JSON.parse(await readFile(
		path.join(summary.campaignRoot, "manual-r1", "result.json"),
		"utf8",
	));
	assert.equal(automated.status, "incomplete");
	assert.equal(automated.latencyComparable, false);
	const failed = JSON.parse(await readFile(
		path.join(summary.campaignRoot, "automated-r2", "result.json"),
		"utf8",
	));
	assert.equal(failed.status, "failed");
	assert.match(failed.notes, /injected executor failure/);
	assert.equal(interactive.status, "queued");
	assert.match(interactive.notes, /Observe the prompt/);
	const interactiveLaunch = JSON.parse(await readFile(
		path.join(summary.campaignRoot, "manual-r1", "launch.json"),
		"utf8",
	));
	assert.equal(interactiveLaunch.command, "ocx");
	assert.deepEqual(interactiveLaunch.arguments, ["oc"]);
	assert.deepEqual(interactiveLaunch.environment, { OCX_PROFILE: "ws" });
	assert.equal(
		await readFile(path.join(summary.campaignRoot, "automated-r1", "events.ndjson"), "utf8"),
		"{\"type\":\"done\"}\n",
	);
});
