# Hosted proof on the preview stack · 19 and 20 September 2026

Runbook steps 4 (finish) and 5 of `docs/hosted-preparation-activation.md`, run
on the temporary preview stack: Supabase preview branch `hosted-proof`
(project `iofjhrtcyawjjhuxbgfd`), the Vercel Preview deployment of branch
`claude/hosted-proof-20260919`, the preview gateway and container Workers,
and the private bucket `inherit-prepared-preview`. Synthetic files only.
Production (`zuvloczwgrayonqabnss`, `www.inherit.bio`) was read twice for
comparison and never written. `STATUS.md` is the live record; this file is
the ordered account. Times are UTC.

## Capacity follow-up · 22 September 2026

The earlier credential-gated skip in `follow-up-20260922.json` is historical.
Preview credentials were recovered through the owner's signed-in provider tools
and verified before a fresh synthetic test. No limits or deployment settings
were changed, and production was not written.

A fresh plain VCF of **805,306,509 bytes** failed during transfer after the page
reached 82%. No stored file or preparation job existed afterward; no HTTP status
or exact network error was captured. This is not a measured storage-size ceiling.
See `journeys/vcf-768mib-upload-failed-20260922.json`.

A gzip copy of the same records, **161,905,161 stored bytes**, uploaded in
**139.296 seconds** and finalized on its first attempt in **64.717 seconds**.
Preparation did **not publish before its one-hour deadline**. The queue used
0.570831 seconds of that hour. At the deadline, 2,065 artifact reservations
accounted for 820,317,668 bytes; 2,064 were acknowledged, totaling 820,301,367
bytes. The last checkpoint was canonical materialization. No report was rendered.
See `journeys/vcfgz-768mib-deadline-20260922.json` for timestamps, partial ratios,
remaining budgets, the browser polling interruption and its corrected reading.

The measured partial ratio is **1.018620063 artifact bytes per decoded byte**
(**5.066554778 per stored byte**). It is not a final ratio: no manifest was
published. The 2,031 unused artifact reservations and 253,424,156 unused bytes
are balances at failure, not successful completion margins. The plain-file
transfer failure and the compressed preparation deadline are separate findings.

**The largest completed plain VCF in this hosted record remains 67,108,990
bytes (64 MiB).** Neither this fixture nor the older rate projection establishes
a universal size guarantee. The old preview deployment is named in both receipts;
these are not measurements of current draft PR deployments. Memory collection,
final R2 reconciliation, teardown and production activation remain owner actions.
The proposed next steps are in `docs/large-file-upload-proposal.md`.

The same attempt also missed its fixed cleanup deadline. At 15:02:23.265684 UTC,
read-only preview SQL still showed cleanup pending, with 192 of 2,065 entries
acknowledged over 12 claims. The deadline was 15:01:56.889531 UTC. The full gzip
receipt preserves this later observation alongside the earlier snapshots.
The deployed worker was unchanged; draft PR #196's serial cleanup drain had
not been deployed. This is a database observation, not final R2 reconciliation
or a later completion time. No cleanup was forced and no bound was changed.

## Cleanup follow-up · 23 September 2026

A later read-only observation at 02:07:03 UTC found the same cleanup complete.
Its database receipt records completion at **00:55:59.618497 UTC**, after
130 claims for 2,065 entries: **9 hours 54 minutes 2.728966 seconds late** and
11 hours 54 minutes 2.728966 seconds after admission. The job, artifact,
checkpoint and cleanup-entry rows are gone. The original remains uploaded,
with the attempt's exact stored byte count and hash; it has no completed
normalization. See `journeys/vcfgz-768mib-cleanup-20260923.json` for the query,
timestamps and interval calculation.

This records eventual database cleanup, not successful preparation or an
independent check of physical R2 erasure. The currently configured image digest
matches the earlier proof. No cleanup, deployment, new upload or bound change
was performed for this observation. The earlier pending snapshots are preserved.


## How this folder reached main · 21 September 2026

This evidence was produced on branch `claude/hosted-proof-20260919` (pull
request #147), which was never merged: it was opened from `main` at `c78d287`
and had gone conflicted by the time the record was read back. Rather than
resolve 27 commits of a stale branch, the owner's decision was to land the
evidence alone, so this folder was taken from that branch onto current `main`
unchanged, together with the two documents it is cited from
(`docs/capability-register.md` and `docs/hosted-own-upload-readiness.md`).

**What was deliberately left behind.** Two files on that branch configure the
*preview* stack — `workers/prepared-artifacts/wrangler.json` and
`workers/prepared-worker/README.md` — by naming the branch project
`iofjhrtcyawjjhuxbgfd` and committing the preview signer's public half. The
`hosted-proof` branch is being torn down under decision 29, so landing them
would point the preview gateway at a project that no longer exists and
document a key that trusts nothing. `main` keeps its empty preview key list.

**What had already landed by another route.** The container defect this proof
found — the image not copying `docs/route-register.json`, so every container
start since 18 September exited before its first request — was fixed on `main`
by pull request #150. The `.dockerignore`, `Dockerfile`,
`scripts/cloudflare-hosting-config.test.ts` and prepared-worker source changes
on branch `claude/hosted-proof-20260919` are byte-identical to `main`'s and
carry nothing new.

**Read `STATUS.md` as of 20 September, not as of now.** It is preserved as
written, including its "In progress" section, which was true when the session
recording it stopped. Two of its owner actions were still open at landing: the
Cloudflare container-memory reading for the 2 GiB job, and the final R2 bucket
reconciliation before teardown. What the numbers here mean for production is
worked out separately, in `docs/evidence/hosted-proof-branch-20260919/`.

## Files

| File | What it holds |
| --- | --- |
| `STATUS.md` | Done, found, in progress, not yet proved, owner actions, with times. |
| `measurements.json` | Every preparation measured, the throughput it gives, what fits inside the schema's one-hour job bound, and the recommendation. |
| `preflight.json` | Read-only state of the branch before any write, with the production comparison. |
| `enable-preparation-receipt.json` | The guard, the exact statements and the postflight of step 4.3. |
| `key-comparison.json` | The preview gateway's committed key against the key the Preview deployment serves (equal). |
| `journeys/` | One receipt per browser journey, plus the tiny file's job rows. |
| `withdrawal-residue.json` | What the withdrawal established, what it did not, and the owner check for the bucket. |
| `cap-refusal-receipt.json` | The monthly cap refusal, with the limit set for the test and restored. |
| `ceiling-finalization-logs.json` | What the branch's edge log says happened inside finalization at 2 GiB, and the claims it corrects. |
| `upload-transport-limit.json` | Where one Storage POST stops being accepted, measured directly, and what that means for the gVCF ceiling. |
| `artifact-ceiling-raise-receipt.json` | Raising `max_artifact_bytes` to the schema maximum on the branch, and the three ceilings that leaves. |
| `follow-up-20260922.json` | Repository fixes and local regression checks, the finalization wording proposal, and why the first 768 MiB attempt was skipped. Historical; the later hosted outcomes are recorded above. |

## What is proved

- **The whole journey works**, in a real browser against the Preview
  deployment: consent, upload with the restricted Storage bearer,
  finalization, admission, preparation by the preview container into R2,
  the prepared result on the page, chosen reports, and withdrawal.
- **All three formats**: a 547-byte VCF, a 4 MiB VCF.gz, a 4 MiB gVCF (stored
  as `file_type` `gvcf`), and a 64 MiB VCF.
- **A 2 GiB VCF is stored and admitted**: uploaded in one POST, finalized
  through the product's own retries, and accepted for preparation. Its
  preparation is the open measurement (below).
- **Withdrawal removes the original and its records**: delete answered 204,
  the Storage listing for the original is empty, its download answers "Object
  not found", and the `genome_files` row is gone (`journeys/gvcf-4mib.json`).
  For the prepared artifacts in R2 the owner reconciled the bucket at 12:53
  on 20 September: 105 zero-byte objects and 238 carrying payload bytes, every
  non-empty one matching an artifact row for a file still retained, none
  unaccounted for. That rules out an orphaned payload by exclusion rather than
  by naming the withdrawn file's former keys, which the database no longer
  holds, and being a later snapshot it times nothing: deletion latency is
  unmeasured. `withdrawal-residue.json` carries both the reconciliation and
  what it does not establish.
- **The monthly cap refuses the admission past its limit**: `/process`
  answered 429 with `preparation_capacity_reached`, the page showed the
  refusal wording, the file was kept and no job row was created. The limit
  was set to the month's admitted count for the test and restored to 100
  afterwards (`cap-refusal-receipt.json`).
- **Throughput and memory at 64 MiB**: 279 seconds of container work, 183
  artifacts and 58.1 MB written to R2, and a maximum sampled container memory
  of 647,372,800 bytes (617.4 MiB), about a tenth of `standard-2`'s 6 GiB and
  inside `standard-1`'s 4 GiB too (`measurements.json`).

## Two defects found, both fixed on this branch

1. **The image never carried the route register.** `src/lib/uploads/
   own-preparation-worker.ts` imports `docs/route-register.json`, which the
   Dockerfile did not copy, so every container start since 18 September
   exited before its first request and no job was ever claimed. Fixed in
   `87ab3fa`; `scripts/cloudflare-hosting-config.test.ts` now follows the
   worker entry's import graph and fails on any file it reaches outside
   `src/` that the image does not copy.
2. **The container was evicted about ninety seconds into every run.** The
   Durable Object returned as soon as it had started the container; an object
   with no pending work is evicted and takes its container with it. Small
   files finished inside that window and a 64 MiB file never could: it died
   twice, on `standard-1` and on `standard-2` alike, and its job then sat
   `claimed` with an expired lease, was passed over by six five-minute ticks,
   and left the person waiting the full hour for "we could not confirm
   whether file preparation finished". Fixed in `a2624b1`: the wake awaits
   the container's exit and re-arms a twenty-second alarm while it runs.

## Three more things the ceilings turned up, none of them fixed here

These are reported rather than changed: each one is a decision about what the
product should promise, not a bug with an obvious patch.

1. **The gVCF ceiling is never disclosed.** `uploadCeilingBytes` reads
   `maximumGvcfBytes` for a gVCF, but the sentence on the upload page is built
   from the array and VCF numbers alone, so with the owner's ceilings set the
   page says "VCF or gVCF files up to 2147 MB" while the product would accept
   a gVCF four times that. The copy and the enforcement disagree from the
   moment the two ceilings differ.
2. **A ceiling can be set above what the upload path can carry, silently.**
   Issuance granted a lease for 8.59 GB; the transport refuses anything past
   about 5 GB. Nothing in the app compares the two.
3. **A 2 GiB finalization always fails first and recovers second.** The
   30-second cap on each storage operation is shorter than one 2 GiB copy
   (37.985 s measured), so the first attempt cannot finish and the person
   meets a failure message before the automatic retries get there. The file
   does arrive, but the first thing a person is told about a large upload is
   that it did not work.

## What ran, in order

1. 19 September 01:38 · Session start; the three owner-set variables present.
2. 01:41 · Step 4.1: the preview signer's public half committed as the
   preview gateway's one key; preview issuer and container project URL set to
   the branch; hosting and guard tests 26/26.
3. 01:41 · Read-only preflight of the branch and of production.
4. 01:45 · Push `b38cc54`; draft pull request #147; `Deploy Cloudflare` for
   `preview`: run 35413646358, success 01:47:59. Vercel Preview
   `dpl_GN9c7UQD98Jp6mnDT5R9KPb4pV7V` READY 01:46:20.
5. 01:47 · Step 4.3 on the branch: the missing `upload_authorization_config`
   row inserted with the branch issuer and the owner's ceilings; preparation
   enabled on `r2` / `inherit-prepared-preview`; `max_job_seconds` 3600.
6. 01:48 · Served key equals committed key.
7. 01:55 · The upload page could not render: `BYOK_ENCRYPTION_KEY` was absent
   from the Vercel Preview target. Raised as an owner action; the owner set it
   at 03:03 on 20 September.
8. 02:03 · The route-register defect found and fixed; preview redeployed
   (run 35414765750). First container wakes that reach the branch, 02:15 and
   02:20.
9. 02:05 · `pnpm seed` against the branch (reference data only).
10. 04:19 · First full journey: the 547-byte VCF, prepared 31 seconds after
    enqueue.
11. 20 September 09:49 to 11:31 · The VCF.gz and gVCF journeys, both
    published, reported and (for the gVCF) withdrawn, with the original
    and its records gone.
12. 11:25 to 12:06 · Two 64 MiB attempts died mid-run, which isolated the
    eviction defect; the preview container was moved to `standard-2`
    (run 35509151886) and the host fix deployed (run 35510939794).
13. 12:39 to 12:45 · The 64 MiB VCF prepared end to end: 183 artifacts,
    58,148,752 bytes in R2, 279 seconds of container work.
14. 12:11 · The monthly cap refusal, with the limit restored afterwards.

## The 2 GiB VCF ceiling: it finalizes, and it takes patience

Three runs, with a fixture 527 bytes under the ceiling. Every one of them:
the lease was issued (201), and Supabase Storage accepted a single 2 GiB POST
in 59, 63 and 65 seconds (about 33 MB/s).

The first finalization attempt is refused, every time, with 503
`unavailable` and `Retry-After: 60`. The branch's edge log names what ran out
of time and it is not the route's 300-second limit: each storage operation in
that path carries a fresh 30-second signal, and one uncached 2 GiB
server-side copy takes 37.985 seconds. No single attempt can both validate
and copy 2 GiB, so the design carries the work across attempts instead — the
validated checkpoint is kept, the staged bytes are kept, and a copy that a
killed attempt left finished is picked up by `storage.info` on the next one.

**Followed through, it works.** The third run let the product do what it
does: three automatic attempts (2, 20 and 70 seconds), then the button. The
file finalized with a 200 at 340.6 seconds, 2,147,483,121 bytes stored as
`vcf`, and `/process` admitted it (202, job `d3431bef…`). The bytes were sent
once. Attempts made while the previous one still held its 60-second lease
answer 404 by design, which is what stops two requests driving one
finalization.

**An earlier version of this file called that first refusal the wall, and
said the person would have to send 2 GiB again. Both were wrong**, and both
are withdrawn: the first was measured only as far as the driver looked, and
the second is contradicted by the page's own words — "Your file already
reached private storage. Finishing it does not send the file again."
`ceiling-finalization-logs.json` carries the attempts line by line.

An earlier fixture that overshot the ceiling by 140 bytes was refused in the
browser before issuance, naming the limit, so the ceiling is enforced against
the disclosed number.

### And then it cannot be prepared, for a reason nothing here predicted

The admitted job ran for 483 seconds, wrote 540 artifacts and 104,485,654
bytes, and stopped — with fifty minutes of its hour unused. It did not run
out of time, and it was not killed: the same `--once` run went on to its
cleanup phase a second later and exited normally. It hit
`own_preparation_config.max_artifact_bytes`, which is **104,857,600** on this
branch, the column's default. `reserve_own_preparation_artifact` refuses with
`artifact_limit_or_sequence` once `reserved_bytes + byteCount` passes it, or
once `artifact_count` reaches 4096. The job stopped 371,946 bytes short, which
is less than one artifact of its own average size.

Nothing retries it. A new claim must start at checkpoint revision 0, so the
483 seconds of work cannot be adopted; the claim lapsed at 13:38:22 and the
ticks at 13:35 and 13:40 both asked for work and were given none. The job sits
`claimed` until its deadline — the same shape as the 64 MiB death before the
container fix, and the same hour of waiting for the person.

**So the hour was never the constraint.** At the measured 0.87 artifact bytes
per source byte, a 2 GiB VCF needs about 1.87 GB of artifacts, and the
column's own check allows at most 1,073,741,824. A 2 GiB VCF cannot be
prepared even with `max_artifact_bytes` raised to its schema maximum. At the
default, the largest source that fits is roughly 120 MB — the 64 MiB file
already used 55% of the budget. Production's 24 MiB ceiling is well inside
that; it is the raise to 2 GiB that cannot work.

## The 8 GiB gVCF ceiling cannot be met by this product

Issuance admits it: the lease came back 201 for 8,589,933,057 bytes declared
gVCF. The bytes then never arrive. Twice, the single POST was cut with
`ERR_CONNECTION_CLOSED` after 328 and 320 seconds, with no HTTP response in
the browser and no entry at all in the branch's edge log.

The reason is the transport. The uploader sends a file as ONE
`XMLHttpRequest` POST — Supabase's standard upload, which Supabase documents
as carrying at most 5 GB; resumable (TUS) and S3 multipart carry up to 50 GB
and the product implements neither. Sending the same file directly, with no
browser, is answered **413 Payload Too Large after about a megabyte**, and
the body is Cloudflare's: the refusal is made at the edge, on the declared
length. Probing the boundary: 5,242,880,000 bytes is accepted and begins
transferring; 5,368,708,096 and above are refused at once. That is the
documented 5 GB limit.

The owner's 9 GB global file size limit does not change this — it governs
what Storage will keep, not what one request may carry.

Two things follow. A gVCF ceiling above about 5 GB needs a resumable or
multipart upload path before it means anything. And until then, nothing tells
the person why: the browser never surfaces the 413, so a person who picks an
8 GiB file watches "Uploading to private storage… 25%" for five and a half
minutes and is then given the generic "could not finish" wording, with no
mention of a size.

## What is not proved

- **Preparation at 8 GiB, which cannot be reached at all.** The file never
  gets past the upload (above), so nothing about the container at that size
  can be measured here.
- **Where between 64 MiB and 2 GiB preparation actually stops.** Two sizes
  were measured, not a boundary: 64 MiB prepared, 2 GiB was refused by the
  artifact ceiling. The "about 120 MB" figure is the measured ratio multiplied
  out, and it rests on one VCF; a gVCF may not produce artifacts at the same
  rate.
- **What the person is shown when a job expires unfinished at this size.**
  The job's deadline had not passed when this was written.
- How container memory grows with source size. The 64 MiB run's 617.4 MiB is
  one point: it cannot be split into fixed overhead and growth per byte
  without a second measurement, so it must not be scaled up to the ceilings.
- Which R2 objects were the withdrawn file's. The bucket reconciles with no
  unaccounted payload (above), but a completed withdrawal removes the cleanup
  rows with the file, so its former keys cannot be named and checked one by
  one. The reconciliation should be repeated immediately before teardown.
- One measurement per size, on one branch, with one fixture generator.
