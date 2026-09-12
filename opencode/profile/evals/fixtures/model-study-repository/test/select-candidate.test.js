import assert from "node:assert/strict";
import test from "node:test";

import { selectCandidate } from "../src/select-candidate.js";

test("rejects candidates without a complete non-empty critical run", () => {
	assert.equal(selectCandidate([
		{ id: "none", criticalPassed: 0, criticalTotal: 0, quality: 3, baselineQuality: 2, medianLatencyMs: 1, totalTokens: 1 },
		{ id: "partial", criticalPassed: 2, criticalTotal: 3, quality: 3, baselineQuality: 2, medianLatencyMs: 1, totalTokens: 1 },
	]), null);
});

test("prioritizes quality before efficiency tie-breakers", () => {
	const selected = selectCandidate([
		{ id: "fast", criticalPassed: 3, criticalTotal: 3, quality: 2, baselineQuality: 2, medianLatencyMs: 10, totalTokens: 100 },
		{ id: "strong", criticalPassed: 3, criticalTotal: 3, quality: 3, baselineQuality: 2, medianLatencyMs: 50, totalTokens: 500 },
	]);
	assert.equal(selected.id, "strong");
});

test("applies latency, token, and identifier tie-breakers in order", () => {
	const selected = selectCandidate([
		{ id: "zeta", criticalPassed: 3, criticalTotal: 3, quality: 3, baselineQuality: 2, medianLatencyMs: 20, totalTokens: 100 },
		{ id: "beta", criticalPassed: 3, criticalTotal: 3, quality: 3, baselineQuality: 2, medianLatencyMs: 10, totalTokens: 90 },
		{ id: "alpha", criticalPassed: 3, criticalTotal: 3, quality: 3, baselineQuality: 2, medianLatencyMs: 10, totalTokens: 90 },
	]);
	assert.equal(selected.id, "alpha");
});

test("does not mutate the caller's array", () => {
	const candidates = [
		{ id: "slow", criticalPassed: 1, criticalTotal: 1, quality: 2, baselineQuality: 2, medianLatencyMs: 20, totalTokens: 50 },
		{ id: "fast", criticalPassed: 1, criticalTotal: 1, quality: 2, baselineQuality: 2, medianLatencyMs: 10, totalTokens: 60 },
	];
	const originalOrder = candidates.map(({ id }) => id);
	selectCandidate(candidates);
	assert.deepEqual(candidates.map(({ id }) => id), originalOrder);
});
