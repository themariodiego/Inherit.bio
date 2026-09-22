# Prepared scratch cleanup drain · 22 September 2026

The unchanged hosted preview left 2,065 registered artifacts after the synthetic
768 MiB decoded VCF comparison reached its preparation deadline. Cleanup was
queued at 14:06:08.874598 UTC with the original deadline of 15:01:56.889531 UTC.
A read-only observation at 14:20:42 UTC found three cleanup claims and 48
acknowledged entries. Acknowledgments 32 through 47 spanned
14:16:18.743835–14:16:22.676928 UTC. This measures one successful page's
acknowledgment span; it is not a worst-case provider latency or final deletion
reconciliation. The full journey is recorded in draft PR #185.

The source explains the slow cadence: a five-minute hosted wake ran one
preparation followed by one page of at most 16 cleanup entries. Even without
another preparation, 2,065 entries require 130 successful pages, at least
645 minutes after the first page at that cadence. Another hour-long preparation
could defer the next cleanup further. No running preview retention cron was
established by this observation.

## Change and bounds

Scratch orchestration now drains serial pages before considering a new
preparation. It stops after 256 pages or a new 150-second aggregate envelope,
including due-work selection. Existing page limits remain: at most 16 entries
per page, a 25-second page timeout, a fresh 30-second SQL claim, exact current
per-entry authorization, payload tombstone evidence, acknowledgment, and
finish/release. All database, artifact, preparation and retention ceilings stay
unchanged. The 150 seconds are an explicit aggregate orchestration change,
not a longer page claim, preparation deadline or scratch retention period.

An error, unresolved provider version, cancellation or zero-progress page stops
the drain without repeating that operation. A later invocation uses SQL's
existing durable eligibility. Owner and account deletion still use their
existing single-page paths. The retention route retains its existing shared
150-second signal and 300-second invocation bound.

The worker admits at most one preparation per iteration, and only when the
cleanup drain reaches a null SQL claim. A pending or bounded drain defers that
preparation. A null claim means no cleanup is currently eligible; it does not
prove global emptiness, absence of competing claims, physical erasure or deadline
compliance. Scratch created by the subsequent preparation waits for the next
existing scheduled wake. No preparation restart, cross-attempt adoption or
upload transport change is introduced.

## Validation and limits

Targeted tests cover 33 entries over multiple serial pages, the page cap, the
aggregate deadline, shorter caller cancellation, selection errors, partial
failure, unresolved providers, no progress and retained acknowledgment counts.
Worker tests hold cleanup before admission, reject new preparation on every
non-idle stop, allow it after a later successful drain, and retain shutdown,
operator withdrawal, one-attempt and failure-reporting checks. Existing page,
worker authority and both retention-route suites remain in the targeted run.
The targeted run passed 142 tests across eight suites. Changed-file ESLint,
typecheck and the readability gate passed locally.

No provider write, deployment, hosted retry or final R2 reconciliation was made
for this change. Unit tests establish orchestration and cancellation contracts;
they do not establish that provider throughput meets the fixed two-hour scratch
deadline. Sustained cleanup backlog can defer preparation admission, and shared
retention work can consume its existing request budget. Hosted capacity and
deadline compliance need a separately authorized synthetic measurement.
