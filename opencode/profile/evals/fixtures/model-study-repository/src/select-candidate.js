export function selectCandidate(candidates) {
	const eligible = candidates.filter((candidate) => (
		candidate.criticalPassed >= candidate.criticalTotal &&
		candidate.quality >= candidate.baselineQuality
	));

	return eligible.sort((left, right) => (
		left.medianLatencyMs - right.medianLatencyMs ||
		right.quality - left.quality ||
		left.totalTokens - right.totalTokens ||
		left.id.localeCompare(right.id)
	))[0] ?? null;
}
