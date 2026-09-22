# Optional preparation metrics

The operator entry accepts `pnpm worker:prepared --once --metrics`. Without
`--metrics`, its output and work remain unchanged. This change does not enable
metrics in the hosted container, deploy anything, or change log retention.
It adds no requests. It is measurement code, with no claim of a speed or
capacity gain.

One `preparation_metrics_v1` JSON event is emitted when a claim attempt returns
or throws. The event contains fixed labels, booleans and numbers only. It has
no source data, paths, URLs, hashes, object keys, account or upload identities,
tokens, timestamps, or error text. It cannot join a person to a trace. An
operator who needs to compare this event with a job checkpoint must keep that
comparison outside the event, within the authorized test environment.

## Work phases and checkpoints

`activePhase` is the last region entered. A phase's `completed` flag means the
worker left that region normally, or finished the attempt successfully. It
does not mean publication succeeded. Unentered regions have `entered: false`;
their zero values are not measured work.

`lastCompletedCheckpoint` is separate. It changes only after the existing
checkpoint call returns the exact expected acknowledgement. Its fixed labels
are the pipeline's existing checkpoint names. `completedCheckpoints` counts
those acknowledgements, including intermediate merge generations. No journal
content or revision number is emitted. The publication RPC is a separate
phase after the final preflight checkpoint.

| Phase | Work included |
| --- | --- |
| `claim` | Initial queue claim and validation. |
| `setup` | Claim, chain and checkpoint setup before source work. |
| `source_scan` | First original-file pass and scan checkpoint. |
| `source_runs` | Second original pass, parse, initial runs and checkpoint. |
| `source_merge` | Intermediate source merges and final input run metadata. |
| `canonical_runs` | Final source merge, canonical conversion, initial canonical runs and their checkpoints. |
| `canonical_merge` | Intermediate canonical merges. |
| `canonical_materialization` | Final canonical merge, materialization and checkpoint. |
| `rsid_runs` | Canonical reread, initial rsID runs and checkpoint. |
| `rsid_merge` | Intermediate rsID merges. |
| `rsid_materialization` | Final rsID merge, materialization and checkpoint. |
| `publication_preflight` | Full canonical and rsID verification, roots, final checkpoint and final authority checks. |
| `publication` | Final publication RPC and returned-manifest checks. |

For example, `lastCompletedCheckpoint: canonical-materialization` with
`activePhase: rsid_runs` means canonical materialization was acknowledged and
the worker then entered the rsID run stage. It does not place the remaining
delay inside canonical materialization.

## Durations and counts

Every phase records `wallMs` and, where supported, `cpuUserUs` and
`cpuSystemUs`. CPU is the process delta, including other work in that process;
it is not an isolated task or thread measurement. The availability flags must
be checked before using a duration. Bad or backward clocks discard that
delta. Counters saturate at the largest safe integer and `dropped` reports
discarded metric inputs or operations.

Each phase has the same six operation counters:

| Operation | Success boundary |
| --- | --- |
| `artifact_read` | Exact bytes, hash, actual EOF and post-read authority passed. Includes publication preflight reads. |
| `artifact_write` | Exact transport acknowledgement and post-write authority passed. |
| `rpc` | The existing request and JSON body completed without a transport/SDK error. Later schema or binding rejection is still possible. |
| `provider_get` | Existing prepared-artifact GET reached EOF; the writer's verification GET also requires length and hash. The standalone reader checks length, hash and authority in `artifact_read`. |
| `provider_put` | Existing PUT/POST body and provider acknowledgement passed their checks. Later GET, database ACK or authority rejection is still possible. |
| `source_get` | Existing original range reached EOF with the exact range length. Later authority and whole-source checks are separate. |

Operations have `started`, `completed`, `failed`, `incomplete`, `wallMs`, and
`completedBytes`. Bytes count only locally successful operations, never an
estimate of unique objects, storage use, partial transfers or cleanup. A failed
or aborted operation can still have taken effect at the provider. `incomplete`
means it was still open at the final snapshot; a late reply never rewrites that
event. Neither label proves rollback or physical deletion.

An operation belongs to the phase in which it started. Its wall time includes
waiting, body consumption and downstream backpressure until the stated
boundary. RPC and provider durations overlap artifact durations. They must
not be added together as total elapsed time. Parallel operations can also
overlap each other.

## Failure limits and local validation

The collector holds fixed maps and at most 32 open operation records. It does
not save per-object traces, wrap streams, pull extra bytes, retry requests or
await its output sink. Sink throws and rejected promises are contained. There
is no background flush: a hard process kill can lose the whole event, and log
capture is not guaranteed. A stalled synchronous sink can still delay its
caller; the default optional sink is the existing process's stdout.

Synthetic tests compare real pipeline results, bytes, check order and
checkpoint order with metrics enabled and disabled. Fake clocks check exact
durations; transport tests check EOF, failures, cancellation and unchanged
request counts for both artifact versions. These tests prove local instrument
behavior only. Hosted timing and the 768 MiB journey still need a separate,
authorized measurement with all test prerequisites in place.
