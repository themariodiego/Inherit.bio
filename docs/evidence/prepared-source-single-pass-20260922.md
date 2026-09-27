# One final source merge · 22 September 2026

The preparation pipeline used to consume the final source merge to obtain its
summary, then consume those same runs again during normalization. The change
removes the first consumption. Original-file scanning, parser verification and
intermediate merge generations are unchanged.

The expected final merge counts now come from the verified parser receipt and
the exact reduced run envelopes. Those expectations are not evidence that a
merge completed. The unchanged canonicalizer verifies each streamed record,
the actual matching merge terminal and actual end of input. The canonical run
writer then verifies its terminal, end of input and final artifact acknowledgements.
Only after all of those steps does the pipeline save the completed source-merge
checkpoint, followed by the canonical-runs checkpoint.

Both checkpoints carry the complete canonical receipt and run handles. A
same-attempt interruption at the first checkpoint therefore does not repeat
completed canonical writes. The hosted worker still refuses to adopt an
attempt with a nonzero starting checkpoint revision. No cross-attempt recovery
or new retry path is added.

## Integrity and failure scope

Canonical scratch may now be acknowledged before the last source container is
read. It remains provisional. A late integrity or authority failure cannot
produce a completed phase checkpoint or publication. Existing exact attempt
identity, artifact accounting and cleanup own those provisional writes.

The tests exercise one provider read per final source container, interruption
at the completed source checkpoint, late hash and provider EOF failure,
cancellation, conflicting expected counts and a refused canonical write.
An additional test corrupts the last source container after a canonical run
has already been acknowledged. It requires the acknowledged scratch to remain
provisional and prevents a completed checkpoint.

All 244 targeted tests across nine suites passed. Running the two new
read-count and completed-checkpoint tests against the baseline pipeline failed
for the intended reasons: two container reads instead of one, and a null
canonical receipt in the completed source checkpoint. The baseline comparison
used an isolated temporary copy and did not replace worktree source.

## Local benchmark method

`scripts/benchmark-preparation-source-pass.mts` compares the baseline pipeline
at `a2399df4cb05a8d324d175f659dc6c1e6e5a43a2` with the candidate. Both use the
same current dependencies and 144,001 reverse-sorted synthetic variants,
compressed as a VCF. Ten initial source runs require an intermediate merge.
The benchmark uses deterministic artifact identities, in-memory byte storage,
the real parser, codecs, merge engines, materializers and publication preflight.
It checks identical complete result and artifact hashes for every run.

One warmup pair is excluded. Three measured pairs alternate execution order.
The receipt includes each elapsed and CPU time, reads, bytes, artifact totals
and checkpoint times. No provider, database or hosted request is made.
Only whole-pipeline timings are comparable: the candidate's source-merge
checkpoint now includes completed canonical-run generation. The in-memory store
retains every artifact and its authority callback does nothing, so this harness
does not measure bounded process memory, live expiry, revocation or provider cost.

The final reduced runs in this fixture each fit in one cached container. Both
versions therefore make the same number of provider callback reads: the old
second pass reuses those containers, while still decoding and merging again.
The separate multi-container test proves the avoided rereads. Neither local
measurement establishes their share of elapsed time on the hosted stack.

The complete receipt is `prepared-source-single-pass-20260922.json`. All eight
runs, including warmups, produced the same 92 artifacts, 13,987,890 artifact
bytes, artifact hash and complete-result hash. Both versions read 12 source
containers totaling 1,231,551 bytes in this cached fixture.

| Measured pair | Baseline elapsed | Candidate elapsed |
| --- | --- | --- |
| 1 | 42.793 s | 40.421 s |
| 2 | 42.387 s | 42.797 s |
| 3 | 63.682 s | 43.923 s |
| Median | 42.793 s | 42.797 s |

Median process CPU time was 48.215 s before and 48.080 s after. The elapsed
medians are effectively equal; one candidate pair is slower, and the slow last
baseline is retained. This benchmark does not establish an overall speedup.
The verified benefit is one consumption of the final source merge, including
one read per final source container when a run spans multiple containers.

This change does not establish a larger supported file size, completion within
the one-hour hosted deadline, or cleanup within its deadline. Upload transport,
lease duration, artifact counts and byte limits remain unchanged. It has not
been deployed to the preview worker.
