import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
	parseCliArguments,
	selectScenarios,
	validateCorpus,
} from "./select-scenarios.mjs";

const corpus = JSON.parse(await readFile(path.join(import.meta.dirname, "scenarios.json"), "utf8"));

test("smoke selects one representative run per primary role", () => {
	const plan = selectScenarios(corpus, { suite: "smoke" });

	assert.equal(plan.scenarioVersion, 8);
	assert.equal(plan.repetitions, 1);
	assert.equal(plan.scenarioCount, 7);
	assert.equal(plan.plannedRuns, 7);
	assert.equal(plan.failFastOnCriticalFailure, true);
	assert.deepEqual(new Set(plan.scenarios.map(({ agent }) => agent)), new Set([
		"build",
		"plan",
		"research",
		"review",
	]));
	assert.ok(plan.scenarios.every(({ cost, prerequisite }) => cost !== "high" && !prerequisite));
});

test("affected selects the union of matching tags with full repetitions", () => {
	const plan = selectScenarios(corpus, {
		suite: "affected",
		tags: ["work-spec", "dcp"],
	});

	assert.equal(plan.repetitions, 3);
	assert.deepEqual(plan.tags, ["work-spec", "dcp"]);
	assert.deepEqual(plan.scenarios.map(({ id }) => id), [
		"direct-build",
		"contained-plan",
		"work-spec-compaction-continuity",
		"dcp-context-retention",
		"herdr-worktree-orchestration",
	]);
	assert.equal(plan.plannedRuns, 15);
});

test("full retains the complete three-repetition regression gate", () => {
	const plan = selectScenarios(corpus, { suite: "full" });

	assert.equal(plan.scenarioCount, 18);
	assert.equal(plan.repetitions, 3);
	assert.equal(plan.plannedRuns, 54);
	assert.deepEqual(
		plan.scenarios.map(({ id }) => id),
		corpus.scenarios.map(({ id }) => id),
	);
});

test("extended contains only high-cost manual scenarios", () => {
	const plan = selectScenarios(corpus, { suite: "extended" });

	assert.equal(plan.scenarioCount, 6);
	assert.equal(plan.plannedRuns, 18);
	assert.ok(plan.scenarios.every(({ cost, prerequisite }) => cost === "high" && prerequisite));
});

test("selector arguments require an explicit valid suite shape", () => {
	assert.deepEqual(
		parseCliArguments(["--suite", "affected", "--tag", "work-spec", "--tag", "dcp", "--json"]),
		{ suite: "affected", tags: ["work-spec", "dcp"], json: true },
	);
	assert.throws(() => parseCliArguments([]), /--suite is required/);
	assert.throws(() => parseCliArguments(["--suite"]), /--suite requires a value/);
	assert.throws(() => parseCliArguments(["--unknown"]), /Unsupported selector argument/);
	assert.throws(
		() => selectScenarios(corpus, { suite: "smoke", tags: ["work-spec"] }),
		/--tag may be used only with the affected suite/,
	);
	assert.throws(
		() => selectScenarios(corpus, { suite: "affected" }),
		/requires at least one --tag/,
	);
	assert.throws(
		() => selectScenarios(corpus, { suite: "affected", tags: ["not-a-known-tag"] }),
		/Unknown scenario tags/,
	);
});

test("corpus validation fails closed for ambiguous selection metadata", () => {
	const duplicate = structuredClone(corpus);
	duplicate.scenarios[1].id = duplicate.scenarios[0].id;
	assert.throws(() => validateCorpus(duplicate), /Duplicate scenario ID/);

	const highCostSmoke = structuredClone(corpus);
	highCostSmoke.scenarios[0].cost = "high";
	assert.throws(() => validateCorpus(highCostSmoke), /must not require high-cost or manual setup/);

	const invalidSuite = structuredClone(corpus);
	invalidSuite.scenarios[0].suites = ["unknown"];
	assert.throws(() => validateCorpus(invalidSuite), /invalid suite/);
});

test("CLI emits the selected plan as JSON", () => {
	const result = spawnSync(process.execPath, [
		path.join(import.meta.dirname, "select-scenarios.mjs"),
		"--suite",
		"smoke",
		"--json",
	], { encoding: "utf8" });

	assert.equal(result.status, 0, result.stderr);
	const plan = JSON.parse(result.stdout);
	assert.equal(plan.suite, "smoke");
	assert.equal(plan.plannedRuns, 7);
});
