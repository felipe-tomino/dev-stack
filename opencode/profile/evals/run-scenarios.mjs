#!/usr/bin/env node

import { execFile } from "node:child_process";
import {
	cp,
	mkdir,
	readFile,
	realpath,
	stat,
	writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { selectScenarios } from "./select-scenarios.mjs";

const executeFile = promisify(execFile);
const DEFAULT_CONCURRENCY = 2;
const MAX_CONCURRENCY = 4;
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1_000;
const CAMPAIGN_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-]*$/;

function parsePositiveInteger(value, option) {
	if (!/^\d+$/.test(value)) throw new Error(`${option} must be a positive integer.`);
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < 1) {
		throw new Error(`${option} must be a positive integer.`);
	}
	return parsed;
}

export function parseRunArguments(arguments_) {
	const options = {
		suite: undefined,
		tags: [],
		output: undefined,
		concurrency: undefined,
		benchmark: false,
		dryRun: false,
		model: undefined,
		variant: undefined,
		timeoutMs: DEFAULT_TIMEOUT_MS,
	};
	const valuedOptions = new Set([
		"--suite",
		"--tag",
		"--output",
		"--concurrency",
		"--model",
		"--variant",
		"--timeout-ms",
	]);
	const seenValuedOptions = new Set();
	for (let index = 0; index < arguments_.length; index += 1) {
		const argument = arguments_[index];
		if (argument === "--benchmark" || argument === "--dry-run") {
			const field = argument === "--benchmark" ? "benchmark" : "dryRun";
			if (options[field]) throw new Error(`${argument} may be specified only once.`);
			options[field] = true;
			continue;
		}
		if (!valuedOptions.has(argument)) throw new Error(`Unsupported runner argument: ${argument}.`);
		if (argument !== "--tag" && seenValuedOptions.has(argument)) {
			throw new Error(`${argument} may be specified only once.`);
		}
		const value = arguments_[index + 1];
		if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value.`);
		index += 1;
		seenValuedOptions.add(argument);

		if (argument === "--tag") {
			options.tags.push(value);
			continue;
		}
		const field = {
			"--suite": "suite",
			"--output": "output",
			"--concurrency": "concurrency",
			"--model": "model",
			"--variant": "variant",
			"--timeout-ms": "timeoutMs",
		}[argument];
		if (argument === "--concurrency") {
			options.concurrency = parsePositiveInteger(value, argument);
		} else if (argument === "--timeout-ms") {
			options.timeoutMs = parsePositiveInteger(value, argument);
		} else {
			options[field] = value;
		}
	}

	if (!options.suite) throw new Error("--suite is required.");
	if (!options.dryRun && !options.output) throw new Error("--output is required unless --dry-run is used.");
	options.concurrency ??= options.benchmark ? 1 : DEFAULT_CONCURRENCY;
	if (options.concurrency > MAX_CONCURRENCY) {
		throw new Error(`--concurrency must not exceed ${MAX_CONCURRENCY}.`);
	}
	if (options.benchmark && options.concurrency !== 1) {
		throw new Error("--benchmark requires --concurrency 1 so latency remains comparable.");
	}
	return options;
}

export function buildCampaignPlan(corpus, { suite, tags = [], concurrency = DEFAULT_CONCURRENCY, benchmark = false }) {
	if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > MAX_CONCURRENCY) {
		throw new Error(`Campaign concurrency must be between 1 and ${MAX_CONCURRENCY}.`);
	}
	if (benchmark && concurrency !== 1) {
		throw new Error("Benchmark campaigns require concurrency 1.");
	}
	const selection = selectScenarios(corpus, { suite, tags });
	const runs = selection.scenarios.flatMap((scenario) => (
		Array.from({ length: scenario.repetitions }, (_, index) => ({
			id: `${scenario.id}-r${index + 1}`,
			repetition: index + 1,
			execution: scenario.execution,
			scenario,
		}))
	));
	const automatedRuns = runs.filter(({ execution }) => execution === "headless");
	const interactiveRuns = runs.filter(({ execution }) => execution === "interactive");
	return {
		...selection,
		concurrency,
		benchmark,
		latencyComparable: concurrency === 1,
		runs,
		automatedRuns,
		interactiveRuns,
	};
}

export async function mapWithConcurrency(items, concurrency, worker) {
	if (!Number.isInteger(concurrency) || concurrency < 1) {
		throw new Error("Concurrency must be a positive integer.");
	}
	const results = new Array(items.length);
	let nextIndex = 0;
	async function runWorker() {
		while (nextIndex < items.length) {
			const index = nextIndex;
			nextIndex += 1;
			results[index] = await worker(items[index], index);
		}
	}
	const workers = await Promise.allSettled(Array.from(
		{ length: Math.min(concurrency, items.length) },
		() => runWorker(),
	));
	const failures = workers.filter(({ status }) => status === "rejected");
	if (failures.length > 0) {
		throw new AggregateError(failures.map(({ reason }) => reason), "Concurrent workers failed.");
	}
	return results;
}

async function nearestExistingPath(candidate) {
	const missingSegments = [];
	let current = candidate;
	while (true) {
		try {
			await stat(current);
			return { existing: current, missingSegments };
		} catch (error) {
			if (error?.code !== "ENOENT") throw error;
			const parent = path.dirname(current);
			if (parent === current) throw error;
			missingSegments.unshift(path.basename(current));
			current = parent;
		}
	}
}

function isWithin(candidate, parent) {
	const relative = path.relative(parent, candidate);
	return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function resolveExternalOutputRoot(output, repositoryRoot) {
	const absoluteOutput = path.resolve(output);
	const absoluteRepository = path.resolve(repositoryRoot);
	if (isWithin(absoluteOutput, absoluteRepository)) {
		throw new Error("Evaluation output must be outside the repository.");
	}
	const [{ existing, missingSegments }, canonicalRepository] = await Promise.all([
		nearestExistingPath(absoluteOutput),
		realpath(absoluteRepository),
	]);
	const canonicalOutput = path.join(await realpath(existing), ...missingSegments);
	if (isWithin(canonicalOutput, canonicalRepository)) {
		throw new Error("Evaluation output resolves inside the repository.");
	}
	return canonicalOutput;
}

async function runCommand(command, arguments_, options = {}) {
	return executeFile(command, arguments_, {
		encoding: "utf8",
		maxBuffer: 16 * 1024 * 1024,
		...options,
	});
}

async function gitOutput(arguments_, cwd) {
	const { stdout } = await runCommand("git", arguments_, { cwd });
	return stdout.trim();
}

export async function prepareFixture({ fixtureSource, runRoot, scenario }) {
	const fixtureDirectory = path.join(runRoot, "fixture");
	await mkdir(runRoot, { recursive: true });
	await cp(fixtureSource, fixtureDirectory, { recursive: true, errorOnExist: true });
	await runCommand("git", ["init", "--quiet", "--initial-branch=main"], { cwd: fixtureDirectory });
	await runCommand("git", ["add", "."], { cwd: fixtureDirectory });
	await runCommand("git", [
		"-c",
		"user.name=Harness Eval",
		"-c",
		"user.email=eval@example.com",
		"commit",
		"--quiet",
		"-m",
		"baseline",
	], { cwd: fixtureDirectory });

	if (scenario.id === "fixed-review") {
		await writeFile(path.join(fixtureDirectory, "message.txt"), "beta\n");
	}
	if (scenario.tags.includes("publication")) {
		const remoteDirectory = path.join(runRoot, "remote.git");
		await runCommand("git", ["init", "--quiet", "--bare", remoteDirectory]);
		await runCommand("git", ["remote", "add", "origin", remoteDirectory], { cwd: fixtureDirectory });
	}

	return {
		fixtureDirectory,
		fixtureStateBefore: await gitOutput(["status", "--short"], fixtureDirectory),
	};
}

export function buildHeadlessCommand({ launcher, run, fixtureDirectory, model, variant }) {
	const arguments_ = [
		"run",
		"--format",
		"json",
		"--agent",
		run.scenario.agent,
		"--dir",
		fixtureDirectory,
		"--title",
		`eval:${run.scenario.id}:r${run.repetition}`,
	];
	if (model) arguments_.push("--model", model);
	if (variant) arguments_.push("--variant", variant);
	arguments_.push(run.scenario.prompt);
	return { command: launcher, arguments: arguments_ };
}

export async function executeHeadless({ command, arguments: arguments_, cwd, timeoutMs }) {
	const started = performance.now();
	try {
		const { stdout, stderr } = await runCommand(command, arguments_, {
			cwd,
			timeout: timeoutMs,
			maxBuffer: 64 * 1024 * 1024,
		});
		return {
			exitCode: 0,
			signal: null,
			timedOut: false,
			elapsedMilliseconds: Math.round(performance.now() - started),
			stdout,
			stderr,
		};
	} catch (error) {
		return {
			exitCode: Number.isInteger(error?.code) ? error.code : null,
			signal: error?.signal ?? null,
			timedOut: error?.killed === true,
			elapsedMilliseconds: Math.round(performance.now() - started),
			stdout: error?.stdout ?? "",
			stderr: error?.stderr ?? error?.message ?? "Unknown execution failure",
		};
	}
}

function createResultRecord({ run, plan, environment, fixtureStateBefore, fixtureStateAfter, processResult }) {
	const queued = run.execution === "interactive";
	return {
		status: queued ? "queued" : processResult.exitCode === 0 ? "incomplete" : "failed",
		scenarioVersion: plan.scenarioVersion,
		scenarioId: run.scenario.id,
		repetition: run.repetition,
		repositoryCommit: environment.repositoryCommit,
		profile: "ws",
		profileCommit: environment.repositoryCommit,
		ocxVersion: environment.ocxVersion,
		opencodeVersion: environment.opencodeVersion,
		runtimeSmoke: environment.runtimeSmoke,
		dcpVersion: environment.dcpVersion,
		dcpMode: environment.dcpMode,
		providerModel: environment.model ?? "profile-default",
		modelOptions: environment.variant ? { variant: environment.variant } : {},
		fixtureStateBefore,
		fixtureStateAfter,
		permissionPrompts: [],
		denials: [],
		toolCalls: [],
		approximateSteps: 0,
		terminalOutcome: queued ? null : {
			exitCode: processResult.exitCode,
			signal: processResult.signal,
			timedOut: processResult.timedOut,
		},
		criticalChecks: [],
		qualityScore: null,
		latencyComparable: plan.latencyComparable,
		benchmark: plan.benchmark,
		elapsedMilliseconds: queued ? null : processResult.elapsedMilliseconds,
		notes: queued ? run.scenario.prerequisite ?? "Run interactively to preserve observable prompts." : "",
	};
}

async function commandVersion(command) {
	try {
		return (await runCommand(command, ["--version"])).stdout.trim();
	} catch {
		return "unavailable";
	}
}

export async function collectCampaignEnvironment({ repositoryRoot, model, variant }) {
	const smokePath = path.join(repositoryRoot, "opencode/profile-smoke.mjs");
	const smoke = JSON.parse((await runCommand(process.execPath, [smokePath, "--runtime"], {
		cwd: repositoryRoot,
		maxBuffer: 64 * 1024 * 1024,
	})).stdout);
	const [repositoryCommit, ocxVersion, opencodeVersion, resolvedOcxConfig] = await Promise.all([
		gitOutput(["rev-parse", "HEAD"], repositoryRoot),
		commandVersion("ocx"),
		commandVersion("opencode"),
		runCommand("ocx", ["config", "show", "--profile", "ws", "--json"], {
			cwd: repositoryRoot,
			maxBuffer: 20 * 1024 * 1024,
		}).then(({ stdout }) => JSON.parse(stdout)),
	]);
	return {
		repositoryCommit,
		ocxVersion,
		opencodeVersion,
		model,
		variant,
		runtimeSmoke: "passed",
		dcpVersion: smoke.deterministic?.dependencies?.dcp ?? "incomplete",
		dcpMode: "incomplete",
		configuredDcpMode: smoke.deterministic?.dcp?.manualMode === true ? "manual" : "incomplete",
		resolvedOcxConfig,
	};
}

async function writeRunFailure({ runRoot, run, plan, environment, error }) {
	const message = error instanceof Error ? error.stack ?? error.message : String(error);
	let recordWritten = false;
	try {
		await mkdir(runRoot, { recursive: true });
		const record = createResultRecord({
			run,
			plan,
			environment,
			fixtureStateBefore: "unavailable",
			fixtureStateAfter: "unavailable",
			processResult: {
				exitCode: null,
				signal: null,
				timedOut: false,
				elapsedMilliseconds: null,
			},
		});
		record.status = "failed";
		record.notes = message;
		await Promise.all([
			writeFile(path.join(runRoot, "result.json"), `${JSON.stringify(record, null, "\t")}\n`),
			writeFile(path.join(runRoot, "stderr.log"), `${message}\n`),
		]);
		recordWritten = true;
	} catch {
		// The campaign summary retains the failure when the run directory itself cannot be written.
	}
	return {
		runID: run.id,
		status: "failed",
		error: message,
		recordWritten,
	};
}

export async function runCampaign({
	plan,
	repositoryRoot,
	fixtureRoot,
	outputRoot,
	launcher,
	model,
	variant,
	timeoutMs = DEFAULT_TIMEOUT_MS,
	campaignID = `eval-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`,
	execute = executeHeadless,
	environment: suppliedEnvironment,
}) {
	if (!CAMPAIGN_ID_PATTERN.test(campaignID)) {
		throw new Error("Campaign ID must contain only letters, numbers, and hyphens.");
	}
	const externalOutput = await resolveExternalOutputRoot(outputRoot, repositoryRoot);
	const campaignRoot = path.join(externalOutput, campaignID);
	const environment = suppliedEnvironment ?? await collectCampaignEnvironment({
		repositoryRoot,
		model,
		variant,
	});
	await mkdir(externalOutput, { recursive: true });
	await mkdir(campaignRoot, { recursive: false });
	await writeFile(path.join(campaignRoot, "environment.json"), `${JSON.stringify(environment, null, "\t")}\n`);

	const outcomes = await mapWithConcurrency(plan.runs, plan.concurrency, async (run) => {
		const runRoot = path.join(campaignRoot, run.id);
		try {
			const fixtureSource = path.join(fixtureRoot, run.scenario.fixture);
			const { fixtureDirectory, fixtureStateBefore } = await prepareFixture({
				fixtureSource,
				runRoot,
				scenario: run.scenario,
			});
			let processResult = {
				exitCode: null,
				signal: null,
				timedOut: false,
				elapsedMilliseconds: null,
				stdout: "",
				stderr: "",
			};
			let launch;
			if (run.execution === "headless") {
				launch = buildHeadlessCommand({ launcher, run, fixtureDirectory, model, variant });
				processResult = await execute({
					...launch,
					cwd: fixtureDirectory,
					timeoutMs,
					run,
				});
				await Promise.all([
					writeFile(path.join(runRoot, "events.ndjson"), processResult.stdout),
					writeFile(path.join(runRoot, "stderr.log"), processResult.stderr),
				]);
			} else {
				launch = {
					command: "ocx",
					arguments: ["oc"],
					cwd: fixtureDirectory,
					environment: { OCX_PROFILE: "ws" },
				};
			}
			const fixtureStateAfter = await gitOutput(["status", "--short"], fixtureDirectory);
			const record = createResultRecord({
				run,
				plan,
				environment,
				fixtureStateBefore,
				fixtureStateAfter,
				processResult,
			});
			await Promise.all([
				writeFile(path.join(runRoot, "result.json"), `${JSON.stringify(record, null, "\t")}\n`),
				writeFile(path.join(runRoot, "launch.json"), `${JSON.stringify({
					...launch,
					prompt: run.scenario.prompt,
					critical: run.scenario.critical,
					prerequisite: run.scenario.prerequisite,
				}, null, "\t")}\n`),
			]);
			return { runID: run.id, status: record.status };
		} catch (error) {
			return writeRunFailure({ runRoot, run, plan, environment, error });
		}
	});

	const summary = {
		campaignID,
		scenarioVersion: plan.scenarioVersion,
		suite: plan.suite,
		concurrency: plan.concurrency,
		benchmark: plan.benchmark,
		latencyComparable: plan.latencyComparable,
		plannedRuns: plan.runs.length,
		automatedRuns: plan.automatedRuns.length,
		interactiveRuns: plan.interactiveRuns.length,
		failedRuns: outcomes.filter(({ status }) => status === "failed").length,
		outcomes,
	};
	await writeFile(path.join(campaignRoot, "campaign.json"), `${JSON.stringify(summary, null, "\t")}\n`);
	return { ...summary, campaignRoot };
}

async function loadCorpus() {
	return JSON.parse(await readFile(path.join(import.meta.dirname, "scenarios.json"), "utf8"));
}

async function main(arguments_) {
	const options = parseRunArguments(arguments_);
	const corpus = await loadCorpus();
	const plan = buildCampaignPlan(corpus, options);
	if (options.dryRun) {
		process.stdout.write(`${JSON.stringify({
			suite: plan.suite,
			plannedRuns: plan.runs.length,
			automatedRuns: plan.automatedRuns.length,
			interactiveRuns: plan.interactiveRuns.length,
			concurrency: plan.concurrency,
			latencyComparable: plan.latencyComparable,
		}, null, "\t")}\n`);
		return;
	}

	const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
	const summary = await runCampaign({
		plan,
		repositoryRoot,
		fixtureRoot: path.join(import.meta.dirname, "fixtures"),
		outputRoot: options.output,
		launcher: path.resolve(import.meta.dirname, "../bin/opencode-ws"),
		model: options.model,
		variant: options.variant,
		timeoutMs: options.timeoutMs,
	});
	process.stdout.write(`${JSON.stringify(summary, null, "\t")}\n`);
	if (summary.failedRuns > 0) process.exitCode = 1;
}

const isExecutedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isExecutedDirectly) {
	main(process.argv.slice(2)).catch((error) => {
		console.error(error.message);
		process.exitCode = 1;
	});
}
