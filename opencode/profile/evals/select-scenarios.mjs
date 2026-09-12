#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SUITES = Object.freeze(["smoke", "affected", "full", "extended"]);
const SCENARIO_SUITES = Object.freeze(["smoke", "extended"]);
const COSTS = Object.freeze(["low", "medium", "high"]);
const EXECUTION_MODES = Object.freeze(["headless", "interactive"]);
const TAG_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export function validateCorpus(corpus) {
	if (!corpus || typeof corpus !== "object" || Array.isArray(corpus)) {
		throw new Error("Scenario corpus must be an object.");
	}
	if (!Number.isInteger(corpus.version) || corpus.version < 1) {
		throw new Error("Scenario corpus version must be a positive integer.");
	}
	if (!Number.isInteger(corpus.repetitions) || corpus.repetitions < 1) {
		throw new Error("Scenario corpus repetitions must be a positive integer.");
	}
	if (!Array.isArray(corpus.scenarios) || corpus.scenarios.length === 0) {
		throw new Error("Scenario corpus must define at least one scenario.");
	}

	const scenarioIDs = new Set();
	for (const scenario of corpus.scenarios) {
		if (!scenario || typeof scenario !== "object" || Array.isArray(scenario)) {
			throw new Error("Every scenario must be an object.");
		}
		if (typeof scenario.id !== "string" || scenario.id.length === 0) {
			throw new Error("Every scenario must have a non-empty ID.");
		}
		if (!TAG_PATTERN.test(scenario.id)) {
			throw new Error(`Scenario ID must be kebab-case: ${scenario.id}.`);
		}
		if (scenarioIDs.has(scenario.id)) {
			throw new Error(`Duplicate scenario ID: ${scenario.id}.`);
		}
		scenarioIDs.add(scenario.id);

		for (const field of ["agent", "fixture", "prompt"]) {
			if (typeof scenario[field] !== "string" || scenario[field].length === 0) {
				throw new Error(`Scenario ${scenario.id} must have a non-empty ${field}.`);
			}
		}
		if (!TAG_PATTERN.test(scenario.fixture)) {
			throw new Error(`Scenario ${scenario.id} has an invalid fixture name.`);
		}
		if (!Array.isArray(scenario.critical) || scenario.critical.length === 0) {
			throw new Error(`Scenario ${scenario.id} must define critical checks.`);
		}
		if (scenario.critical.some((check) => typeof check !== "string" || check.length === 0)) {
			throw new Error(`Scenario ${scenario.id} has an invalid critical check.`);
		}
		if (
			scenario.prerequisite !== undefined &&
			(typeof scenario.prerequisite !== "string" || scenario.prerequisite.length === 0)
		) {
			throw new Error(`Scenario ${scenario.id} has an invalid prerequisite.`);
		}
		if (!Array.isArray(scenario.tags) || scenario.tags.length === 0) {
			throw new Error(`Scenario ${scenario.id} must define at least one tag.`);
		}
		if (new Set(scenario.tags).size !== scenario.tags.length) {
			throw new Error(`Scenario ${scenario.id} has duplicate tags.`);
		}
		for (const tag of scenario.tags) {
			if (typeof tag !== "string" || !TAG_PATTERN.test(tag)) {
				throw new Error(`Scenario ${scenario.id} has invalid tag: ${String(tag)}.`);
			}
		}
		if (!COSTS.includes(scenario.cost)) {
			throw new Error(`Scenario ${scenario.id} has invalid cost: ${String(scenario.cost)}.`);
		}
		if (!EXECUTION_MODES.includes(scenario.execution)) {
			throw new Error(`Scenario ${scenario.id} has invalid execution mode: ${String(scenario.execution)}.`);
		}
		if (!Array.isArray(scenario.suites)) {
			throw new Error(`Scenario ${scenario.id} must define suites.`);
		}
		if (new Set(scenario.suites).size !== scenario.suites.length) {
			throw new Error(`Scenario ${scenario.id} has duplicate suites.`);
		}
		for (const suite of scenario.suites) {
			if (!SCENARIO_SUITES.includes(suite)) {
				throw new Error(`Scenario ${scenario.id} has invalid suite: ${String(suite)}.`);
			}
		}
		if (scenario.suites.includes("smoke") && (scenario.cost === "high" || scenario.prerequisite)) {
			throw new Error(`Smoke scenario ${scenario.id} must not require high-cost or manual setup.`);
		}
		if (scenario.suites.includes("extended") && scenario.cost !== "high") {
			throw new Error(`Extended scenario ${scenario.id} must be high cost.`);
		}
	}

	return corpus;
}

export function parseCliArguments(arguments_) {
	const options = { suite: undefined, tags: [], json: false };
	for (let index = 0; index < arguments_.length; index += 1) {
		const argument = arguments_[index];
		if (argument === "--json") {
			options.json = true;
			continue;
		}
		if (argument === "--suite" || argument === "--tag") {
			const value = arguments_[index + 1];
			if (!value || value.startsWith("--")) {
				throw new Error(`${argument} requires a value.`);
			}
			index += 1;
			if (argument === "--suite") {
				if (options.suite !== undefined) throw new Error("--suite may be specified only once.");
				options.suite = value;
			} else {
				options.tags.push(value);
			}
			continue;
		}
		throw new Error(`Unsupported selector argument: ${argument}.`);
	}

	if (!options.suite) throw new Error("--suite is required.");
	return options;
}

export function selectScenarios(corpus, { suite, tags = [] }) {
	validateCorpus(corpus);
	if (!SUITES.includes(suite)) {
		throw new Error(`Unknown suite ${String(suite)}. Expected one of: ${SUITES.join(", ")}.`);
	}
	if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== "string" || !TAG_PATTERN.test(tag))) {
		throw new Error("Affected-suite tags must be kebab-case strings.");
	}
	if (suite !== "affected" && tags.length > 0) {
		throw new Error("--tag may be used only with the affected suite.");
	}
	if (suite === "affected" && tags.length === 0) {
		throw new Error("The affected suite requires at least one --tag.");
	}

	const knownTags = new Set(corpus.scenarios.flatMap((scenario) => scenario.tags));
	const unknownTags = [...new Set(tags)].filter((tag) => !knownTags.has(tag));
	if (unknownTags.length > 0) {
		throw new Error(`Unknown scenario tags: ${unknownTags.join(", ")}.`);
	}

	let selected;
	if (suite === "full") {
		selected = corpus.scenarios;
	} else if (suite === "affected") {
		const requestedTags = new Set(tags);
		selected = corpus.scenarios.filter((scenario) => scenario.tags.some((tag) => requestedTags.has(tag)));
	} else {
		selected = corpus.scenarios.filter((scenario) => scenario.suites.includes(suite));
	}
	if (selected.length === 0) throw new Error(`Suite ${suite} selected no scenarios.`);

	const repetitions = suite === "smoke" ? 1 : corpus.repetitions;
	return {
		scenarioVersion: corpus.version,
		suite,
		tags: [...new Set(tags)],
		repetitions,
		scenarioCount: selected.length,
		plannedRuns: selected.length * repetitions,
		failFastOnCriticalFailure: true,
		scenarios: selected.map((scenario) => ({ ...scenario, repetitions })),
	};
}

function formatPlan(plan) {
	const tagDescription = plan.tags.length > 0 ? ` for tags ${plan.tags.join(", ")}` : "";
	const lines = [
		`${plan.suite} suite${tagDescription}: ${plan.scenarioCount} scenarios, ${plan.plannedRuns} planned runs`,
		"Stop a candidate's remaining repetitions after any critical-check failure.",
	];
	for (const scenario of plan.scenarios) {
		const setup = scenario.prerequisite ? "manual setup" : `${scenario.cost} cost`;
		lines.push(`- ${scenario.id} (${scenario.agent}, ${scenario.repetitions}x, ${setup})`);
	}
	return `${lines.join("\n")}\n`;
}

async function main(arguments_) {
	const options = parseCliArguments(arguments_);
	const corpusPath = path.join(import.meta.dirname, "scenarios.json");
	const corpus = JSON.parse(await readFile(corpusPath, "utf8"));
	const plan = selectScenarios(corpus, options);
	process.stdout.write(options.json ? `${JSON.stringify(plan, null, "\t")}\n` : formatPlan(plan));
}

const isExecutedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isExecutedDirectly) {
	main(process.argv.slice(2)).catch((error) => {
		console.error(error.message);
		process.exitCode = 1;
	});
}
