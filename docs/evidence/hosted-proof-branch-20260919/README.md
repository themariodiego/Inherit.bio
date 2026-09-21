# The hosted-proof branch: production's schema on a disposable Supabase branch · 19 September 2026

This folder records how the temporary Supabase preview branch for the hosted
proof (task: prove the VCF/VCF.gz/gVCF journey and the hosted capacity on a
preview stack, owner decision 14 of 18 September) was brought to the
production schema, and what was checked afterwards. Nothing here touched the
Inherit project (`zuvloczwgrayonqabnss`) beyond read-only catalog queries.

| Item | Value |
| --- | --- |
| Branch | `hosted-proof`, project ref `iofjhrtcyawjjhuxbgfd`, created by the owner in the dashboard at 23:56:04 UTC on 18 September (no GitHub sync, no production data) |
| Parent | `zuvloczwgrayonqabnss` (production, 117 migrations at the time) |
| Pinned commit | `c78d28743d61486aadc45714d2f9683cd27dee8f` (main after PR #145) |
| Replay window | 00:41:03 to 00:44:34 UTC on 19 September |
| Files | `replay-plan.json` (the 41 entries, sha256 and time of each), `parity.json` (the digest comparison), `align-legacy-grants.sql` (the one branch-only change) |

## Why the platform's own replay stopped

Supabase creates a branch by replaying the parent's migration history. It
applied the first 76 entries and stopped at entry 77,
`health_picture_canonical_results`, with `Hosted migration baseline changed`
(P0001, in the branch's Postgres logs at 23:56:21 UTC). That exception is
raised by the `stage_preflight` block the release discipline wraps around
every hosted apply since 7 September: it compares the count and the md5 of
the production project's own migration-history table, which no copy can
satisfy. The failed entry rolled back whole (its table and functions were
absent), so the branch stood exactly at production's entry 76.

## What was replayed and how

The 41 remaining entries were applied in production order:

- For 40 of them the repository holds the migration file. A comparison of
  each production statement with its repository file showed the file to be
  the DDL production ran: byte-equal for 24, the same statements inside a
  guard wrapper for 6, and the same statements with comment lines removed
  for 10 (the replay records both in `parity.json`). Those 40 files were
  fetched into the branch database itself by `pg_net` from the pinned
  commit's raw URLs, the sha256 of each fetched body was compared with the
  repository file's before anything ran, and each was executed inside the
  branch's own transaction. No file text was retyped.
- `install_own_report_retention_scheduler` has no repository file (an
  operator-only install of 8 September). Its production statement was
  applied as stored: pg_cron 1.6.4 and the inactive job
  `inherit-own-report-retention-15s-v1`. The job was then activated on the
  branch, as it is in production.
- The two `stage_preflight` blocks that name the production history were the
  only clauses not run; every other guard those two entries carry was.

The branch's migration list now reads the 76 platform entries followed by
eight `hosted_proof_replay_*` entries and one alignment entry. The
dashboard's branch status may keep saying the platform replay failed; that
label is the platform's and the schema is what this folder checks.

## Parity with production, checked object by object

One query, run read-only on both databases after the replay, digests every
function (body, owner, definer flag, settings, ACL, volatility, result type,
language), every table and sequence (owner, RLS flags, ACL, columns with
types, nullability and defaults, constraints, indexes), every policy,
trigger, view, enum, extension, cron job, schema ACL, storage bucket, default
ACL and the six application roles. Production has 778 such objects.

The first comparison found 35 differences. Twenty-nine were one cause: the
branch database was created with narrower default privileges for the
`postgres` role in `public` than the Inherit project has (tables gave
`anon` and `authenticated` only REFERENCES, TRIGGER and MAINTAIN, and
`service_role` no DML; sequences and functions granted nothing), so the
nineteen legacy relations that rely on defaults, three sequences and one
reader function came out narrower than production. `align-legacy-grants.sql`
set the branch's default privileges to production's and granted exactly the
production privileges on those objects; two function ACLs differed only in
recorded order and were re-granted in production's order.

After that change (`parity.json`):

| Result | Count | What it is |
| --- | --- | --- |
| Equal | 768 | identical digest on both databases |
| Comment-only body | 9 | functions created from the repository files, whose bodies carry the comment lines production's comment-stripped statements did not; with comment lines, trailing spaces and blank lines removed, the nine bodies hash equal on both sides |
| Platform-owned | 1 | the `postgres` role's memberships: the branch also holds `supabase_functions_admin` |
| Branch-only | 7 | `pg_net` and its three `net` relations (the fetch transport; production does not carry the extension) and three `supabase_admin` default ACLs for the `supabase_functions` schema (platform image) |
| Production-only | 0 | |

No table, column, constraint, index, policy, trigger, view, enum, bucket or
application-role difference remains.

## Limits

- This is schema parity, not data parity: the branch holds no production
  row, by design (synthetic fixtures only).
- The preview Workers' configuration (`workers/prepared-worker/wrangler.json`
  `env.preview` and `workers/prepared-artifacts/wrangler.json` `env.preview`:
  the branch URL and the preview signer's public half) is committed on the
  proof session's own branch, `claude/hosted-proof-20260919`, which also
  dispatches the preview deploy; it is not part of this record.
- The branch's JWT standby key, the preview Workers' two secrets, the Vercel
  Preview variables and the proof session's variables were the owner's steps,
  done on 19 September, and are not recorded here.
- The branch is billed by the hour while it exists and is deleted after the
  proof, by the owner's decision.

## Throughput, measured on the branch · read 21 September 2026

`throughput.json` records three VCF files prepared end to end on this branch,
read directly from `private.own_preparation_jobs` joined to `public.genome_files`.
All three reached `published` on **one attempt**, none froze, and the branch
holds 3 manifests and 37 artifacts.

| Source | Variants | Artifacts | Artifact bytes | Seconds | Artifact : source |
| --- | --- | --- | --- | --- | --- |
| 547 B | 3 | 14 | 26,160 | 31 | 47.8 |
| 836 KiB | 27,170 | 18 | 2,291,605 | 78 | 2.68 |
| 64 MiB | 431,548 | 183 | 58,148,752 | 315 | 0.87 |

**This establishes hosted background dispatch**, which the 17 September
checkpoint listed as unproved: three independent jobs, of increasing size,
dispatched to the Cloudflare container and published without intervention.

**Three ceilings sit at or under ~1.5 GB, and which binds first is not
settled.** The marginal rate between the two largest runs is **279,546 source
bytes per second**, and both solve to the same **~75 s** fixed overhead.
Against that the schema holds three independent limits, none of them reached by
the three runs above:

| Limit, at its schema maximum | Where | Implied source ceiling |
| --- | --- | --- |
| `max_job_seconds` 3600 | `20260908233418_own_preparation_checkpoints.sql:5` | **~902–985 MB** |
| `artifact_count` 4096 | `20260908164616_own_preparation_job_authority.sql:28`, refused at `20260908233337_own_prepared_r2_provider.sql:129` | **~915 MB or ~1.50 GB** |
| `max_artifact_bytes` 1,073,741,824 | `20260908233337_own_prepared_r2_provider.sql:6` | **~1.24 GB** |

The clock is a range because `job_deadline` is `created_at + max_job_seconds`
and `created_at` is stamped at **admission**, not at claim
(`…checkpoints.sql:40-43`): the wait for the five-minute cron wake is spent out
of the job's own hour. 985 MB assumes an instant claim; a job that waits a full
tick gets ~902 MB.

The artifact-count cap is a range because the two runs disagree about artifact
size. The 64 MiB run averaged 317,753 bytes per artifact, or 366,715 source
bytes each, which puts 4096 artifacts at **~1.50 GB**. The 2 GiB run on this
same branch averaged 193,492 bytes per artifact, which at the 0.87 ratio puts
the same cap at **~915 MB**. Artifacts got *smaller* as the source grew, so
this series cannot fix the cap's position.

**The two tightest ceilings overlap, so no order can be stated.** ~915 MB falls
*inside* the clock's own ~902–985 MB range. On the 2 GiB artifact profile, a
job claimed on its first tick is stopped by the artifact count (915 MB before
985 MB), while a job that waits a full tick is stopped by the clock (902 MB
before 915 MB). On the 64 MiB profile the clock binds throughout. Which one a
real file meets therefore depends on both its artifact profile and its tick
alignment, and neither is fixed by three runs.

**What survives every reading.** No ceiling near 2 GiB is supportable, and
raising `max_artifact_bytes` alone would not buy a larger file — it is the
third-loosest of the three. But that conclusion is owed as much to the
4096-artifact count cap as to the hour. The earlier flat claim that "the clock
binds before the artifact budget" is withdrawn: it compared the clock against
the byte ceiling only and never against the count cap.

### What it does not establish, which matters more

**It does not justify a ceiling.** The largest file actually prepared is
**64 MiB**. Owner decision 30 asks for "the largest honestly-supportable size",
and reaching ~1 GB from these three points is a **15× extrapolation**, not a
measurement. A run near the candidate ceiling is still owed before any ceiling
moves. PR #147 reaches this independently and it is the one claim in this
section that needed no correction: its 768 MiB run could not be started, and
the first line of its own "Not yet proved" list is where between 64 MiB and
2 GiB preparation actually stops.

**It fixes no gVCF ceiling.** All three surviving rows are typed `vcf`, which
is narrower than "nothing about gVCF": a 4 MiB gVCF was prepared end to end on
this same branch on 20 September and then withdrawn, and a completed withdrawal
takes the job row with it, so it cannot appear in this query
(`docs/evidence/hosted-proof-20260919/journeys/gvcf-4mib.json`, PR #147). What
does not follow from this series is a gVCF *ceiling*: a gVCF's block structure
gives it a different variant-to-byte profile (D-128). The one gVCF size that is
settled is the far end — 8 GiB never reaches Storage to be prepared at all,
refused by the transport at Supabase's 5 GB standard-upload limit.

**The seconds are not pure processing time.** They run from `created_at`, which
is enqueue, to the last artifact acknowledgement, so they include waiting for
the cron wake. Every figure above is an upper bound on processing time and a
lower bound on throughput.

**None of it is production.** Production has preparation disabled, at
`max_artifact_bytes` 104,857,600 and `max_job_seconds` 900 — both below this
branch's — and holds zero jobs. `frozen_reason` is absent here because the
31(a) migration was applied to the Inherit project only. The *refusal* is not
absent, and the earlier claim that "nothing on this branch exercises the
artifact-budget refusal" was wrong: the branch's 2 GiB job hit it on
20 September at 13:34:53, stopping at 104,485,654 of the then-current
104,857,600 with `artifact_limit_or_sequence`, 371,946 bytes short of its own
average artifact. What 31(a) adds is the recorded reason and the immediate
fail, not the stop.

### One question the reading raised

`own_preparation_monthly_admissions` reads **8** for September 2026 while only
**3** jobs exist. Admissions are counted when a job is admitted, so five have no
surviving job. That is right if the cap is meant to limit *attempts*, and wrong
if someone who deletes a file and retries should not burn quota. Which of the
two the 100-per-month cap means has not been decided, so it is recorded as a
question rather than a defect.

### The branch is still running

`hosted-proof` (`iofjhrtcyawjjhuxbgfd`) was `ACTIVE_HEALTHY` at this reading,
created 18 September and billed by the hour since. Owner decision 29 is that it
is torn down once the proof's evidence is in. It is still needed, for three
reasons rather than one: the ceiling measurement above is not done, and PR #147
leaves two open owner actions on this same branch — reading the container's
memory for the 2 GiB preparation, and repeating the R2 bucket reconciliation
immediately before teardown.

## Correction · 21 September 2026

This section was written on 21 September from a read of the branch's job table
alone. Read afterwards against `docs/evidence/hosted-proof-20260919/STATUS.md`
on PR #147 — the proof session's own record of the same branch, which had run
journeys this query could not see — three of its claims were wrong or too
broad. They are corrected in place above; what was wrong is named here rather
than quietly replaced.

| Claim as merged | Why it was wrong | Corrected to |
| --- | --- | --- |
| "The clock binds before the artifact budget." | It compared the clock against `max_artifact_bytes` only, and never against the separate 4096-row `artifact_count` cap, which shares the same refusal condition. On the 2 GiB run's artifact profile that cap lands at ~915 MB, inside the clock's own ~902–985 MB range, so it binds first whenever a job is claimed early. | Three ceilings, ordering unsettled; the practical conclusion survives but is owed to the count cap as much as the hour. |
| "It says nothing about gVCF. All three runs are VCF." | True of the three *surviving rows*; a 4 MiB gVCF was prepared end to end on this branch on 20 September and then withdrawn, and withdrawal takes the job row with it. | No gVCF *ceiling* follows from this series. The gVCF journey is proved elsewhere; 8 GiB is settled as unreachable by transport. |
| "Nothing on this branch exercises the artifact-budget refusal." | The branch's 2 GiB job raised `artifact_limit_or_sequence` on 20 September at 13:34:53, 371,946 bytes short of the then-current ceiling. | `frozen_reason` is absent, because 31(a) is not on this branch. The refusal is not. |

**One claim needed no correction.** "A run near the candidate ceiling is still
owed before any ceiling moves" is right, and PR #147 reaches it independently:
its 768 MiB run could not be started at all, and its own "Not yet proved" list
opens with the same gap.

### What PR #147 settles that this folder did not

Recorded here because this folder is what the release record reads, and because
the two outer sizes are now measured rather than extrapolated:

- **2 GiB VCF is stored, and cannot be prepared.** The upload finalizes — 503
  `unavailable` with `Retry-After: 60`, then 200 at 340.6 s, bytes sent once —
  and `/process` admits it. Preparation then stops at the artifact ceiling
  after 540 artifacts and 483 seconds, with fifty minutes of its hour unused.
  At 0.87 artifact bytes per source byte a 2 GiB VCF needs ~1.86 GB of
  artifacts against a column maximum of 1,073,741,824, so **no setting of
  `max_artifact_bytes` admits it**.
- **8 GiB gVCF never reaches Storage.** Issuance admits it (201), but the
  single POST the uploader makes is cut with no HTTP response; sent without a
  browser the same file is refused **413 by Cloudflare**. The boundary was
  probed: 5,242,880,000 bytes is accepted, 5,368,708,096 is refused at once —
  Supabase's documented 5 GB limit for the standard upload this product uses.
  A gVCF ceiling above ~5 GB needs a resumable or multipart path first.
- **The monthly cap refuses cleanly**: 429 `preparation_capacity_reached`, file
  kept, no job row created, count unmoved.
- **Withdrawal leaves nothing** in the database, and the frozen 2 GiB job's
  cleanup drained all 540 entries — at sixteen per tick, finishing 1 h 47 m
  past its own `cleanup_deadline`, which is not a stop condition on this stack.

### What still blocks the remaining ceiling run

Not a judgement call — an access boundary. The 768 MiB run needs the preview
stack, and this session holds none of what drives it: the three owner-set
variables `INHERIT_PREVIEW_SUPABASE_SERVICE_ROLE_KEY`,
`INHERIT_PREVIEW_UPLOAD_SIGNING_JWK` and `INHERIT_PREVIEW_VERCEL_BYPASS_TOKEN`,
and the Preview-target `BYOK_ENCRYPTION_KEY` the upload page needs to mint its
consent tokens. PR #147's session held all four and still could not start that
run, for a separate reason it recorded: its auto-mode classifier refused to run
the journey driver against the live preview stack. So the run is owed by a
session with both the variables and the permission to drive them, and no
ceiling moves in production until it exists.
