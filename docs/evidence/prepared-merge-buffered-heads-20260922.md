# Buffered merge heads · 22 September 2026

The source and canonical merge engines previously awaited an async head lookup
for each input on each emitted record, including heads already decoded and
verified in memory. The candidate reads those buffered heads directly. A missing
head still enters the same async block acquisition and validation path.

The change retains the eight-input ceiling, one decoded block per input, exact
hash/schema/EOF/order/count checks, downstream backpressure, cancellation and
terminal summaries. It adds no prefetch, source pass, artifact or authority.
The existing extra source merge pass remains in place. No worker deployment or
hosted capacity measurement was performed for this change.

## Reproduction

Run from this checkout with Node 22 and the installed, locked dependencies:

```sh
node --conditions=react-server --import ./scripts/server-only-shim.mjs \
  --import tsx scripts/benchmark-prepared-merge.mts \
  --baseline 3af31bf5945dc30e7ab069a5dfc54366f6a7897c
```

The script loads only the two baseline merge engines from that commit. Both
versions use the current, unchanged codecs, schemas and synthetic fixtures.
It prepares eight interleaved runs of 16,000 artificial variant records each,
with 2,000 records per real gzip block. Block reads come from memory. Fixture
encoding is outside the timed region; decoding, merging and output hashing are
inside it. There is one excluded warmup followed by six pairs with alternating
baseline/candidate order. The script fails if any output count, block read count,
output hash or complete terminal summary differs.

## Observation

The [raw receipt](prepared-merge-buffered-heads-20260922.json) was recorded at
14:50:55 UTC on Node 22.17.0, macOS arm64. All 28 iterations, including warmups,
produced 128,000 records and exactly 64 block reads per engine. Each engine's
output hash and terminal summary matched its baseline on every iteration.

| Engine | Baseline median wall time | Candidate median wall time | Reduction | Baseline wall range | Candidate wall range |
| --- | ---: | ---: | ---: | --- | --- |
| Source | 0.9000 s | 0.7365 s | 18.17% | 0.8647–0.9862 s | 0.7114–0.7898 s |
| Canonical | 1.4328 s | 1.2721 s | 11.22% | 1.3946–1.5796 s | 1.2524–1.5177 s |

Median process CPU time fell from 0.9799 to 0.8260 seconds for source and from
1.6848 to 1.5033 seconds for canonical. These are descriptive local results,
without a timing assertion. Background load was not controlled. In the first
measured canonical pair the candidate was slower (1.5177 versus 1.4245 seconds),
so the median does not describe every pair. This benchmark does not measure
Storage/R2 latency, the full preparation pipeline, hosted deadlines or a larger
accepted upload capacity.

## Regression coverage

The added source and canonical tests exercise all eight buffered inputs, compare
the emitted order, pause downstream to require no extra block reads, then abort
and require refusal before another buffered record or read. Existing merge
integrity, EOF, ordering, receipt and terminal tests remain unchanged. The
preparation pipeline suite also exercises the existing real multi-pass path.

Local validation passed: 87 tests across the two merge suites and preparation
pipeline suite, ESLint on all changed TypeScript files, full typecheck, and the
readability gate (2,681 blocks). The paired benchmark is observational and adds
no CI timing threshold.
