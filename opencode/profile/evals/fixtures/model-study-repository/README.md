# Candidate selection contract

`selectCandidate(candidates)` chooses an evaluation candidate without mutating the input array.

A candidate is eligible only when:

- it has at least one critical check;
- every critical check passed; and
- its median quality is no lower than its baseline quality.

Choose the eligible candidate with the highest median quality. Break ties by lower median latency,
then lower total tokens, then lexicographically smaller `id`. Return `null` when no candidate is
eligible.
