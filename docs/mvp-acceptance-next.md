# MVP-first acceptance sequence

Original plan audit: 2026-09-06; current checkpoint: 2026-09-08.
Full-plan acceptance is **19/65**, after exact-route Lighthouse gate G1.14.
The Lighthouse evidence is in `docs/local-upload-browser-verification.md`.
This is a delivery order, not a replacement specification or a whole-project pass.

## Current production checkpoint · 8 September 2026

PR81 merge `5e642a678cdeb8e3f17343146181d53acf81899f` is production READY as
`dpl_BgPP2ibjzYQiHQ7EZ9E9uY4tXUvF` at **16:19:20.081 UTC**, on all six aliases.
It distinguishes a confirmed prepared file from a later selected-report failure,
with a retry path that does not require another upload. No database, environment,
scheduler, plan or admission-limit changes accompanied this release.

Exact head `36093080` passed **3,346 units (205 files), 85 fresh migrations,
2,120 SQL assertions (56 files), 30 lock checks and 232 browser cases**, with
57 actual Storage uploads and zero skipped or automatically retried cases. CI
`34245372159` attempt one had one pre-response sign-out socket failure, 222 passes
and nine dependent cases not run. The unchanged whole-job second attempt passed,
including all those cases; the original failure and unproved cause are retained.

Automatic main CI `34250269387` also passed on the exact production merge:
3,346 units, 85 fresh migrations, 2,120 SQL assertions, 30 lock checks and all
232 browser cases in 14.2 minutes, with 57 actual uploads and zero skips or
automatic retries. The previously affected Health Picture case and both cleanup
steps passed. No further rerun was requested.

Desktop and mobile inspection used the actual shared recovery component in an
isolated fixture. Production smoke at **16:20:27.648 UTC** verified authenticated
synthetic-only `/files` and `/files/upload` HTTP 200 responses and all three new
recovery strings in the served client asset; the account remained empty and its
test session was signed out. This did not force or observe another hosted report
failure. Receipt details: parent task `work/wgs-release-pr80/recovery-*`.
Acceptance remains **19/65**.

### Local larger-file preparation prototype (not deployed)

Local engine commit `ba35b15d60f970aa1cfd018faa1107c8143a9720` adds bounded,
lossless provisional blocks, sorted runs, eight-way merging and grouped immutable
containers. **139 distinct focused tests** plus 24 existing parser tests passed;
module lint/type checks and independent run review passed. No application upload,
job, authorization, index, report or retention integration is implied.

One actual filesystem proof used a synthetic **2,000,000-record VCF** (82,000,210
decoded / 9,743,598 gzip bytes). Both source hashes verified before terminal
acceptance. It preserved all **4,000,000 events** exactly, including the sole
caffeine locus, across **125 → 16 → 2 → 1** runs. Initial preparation took
49.951 seconds; total merge/readback/cleanup proof took **241.013 seconds**.
There were 173 container writes and 8,000 filesystem range reads. Peak temporary
storage was **30,010,188 bytes** and sampled test-process RSS **333,889,536 bytes**.
All generated artifacts/bytes were removed; the original inode, size and raw hash
were rechecked. Root independently confirmed the owned directory was absent.

This repetitive synthetic filesystem result is not hosted Storage performance,
full-WGS capacity or a 100-genomes/month allowance. Next: integrate current
source authority, durable jobs, indexes/read adapters and complete lifecycle,
then verify an actual larger-file application journey. Public limits and
one-month original-expiry behavior remain unchanged. Receipts: parent task
`work/wgs-next-backend/disk-integration-attempt-1/` and
`work/wgs-next-backend/prototype-review-receipt.json`.

### Canonical data and private job authority · local only

Local commits `1d7834f` and `89b6098` add parity with the current canonical
normalizer, preservation of original evidence, a bounded private Storage range
reader, and a canonical codec that avoids duplicating unchanged long alleles.
There are **240 distinct focused engine tests** (139 earlier engine cases plus
32 canonical, 28 reader and 41 canonical-codec cases); scoped TypeScript/lint and
independent review passed. The reader's provider boundary is tested with
synthetic responses, not hosted Storage. The secret gate and its 19 regression
cases passed with one exact, reviewed synthetic URL fixture.

The disabled private job migration
`20260908164616_own_preparation_job_authority.sql` passed **67 rollback-only SQL
assertions** on the existing owned local database. Its exact source and corrected
fixture hashes are in parent task `work/wgs-next-backend/job-authority-attempt-3/`.
The first two attempts exposed invalid fixture mutations; neither disabled an
existing protection. Final verification used real consent expiry and actual
source deletion preparation in a rolled-back savepoint. After the complete
migration/test transaction rolled back, original file/object fingerprints,
row counts, the 117-store runtime registry and absence of all new schema objects
matched the baseline. No migration was committed to that runtime or a provider.

The draft contract and ADR-0025 preserve originating-session checks and define
finite job, claim, write and scratch deadlines. Dispatch defaults off. Metadata
freeze preserves registered outstanding writes and never claims deletion success.
Concurrency, actual artifact transport/fencing, durable checkpoints, target and
rsID indexes, backend-aware chosen reports/exports/readers and complete cleanup
remain integration requirements. The updated 119-store inventory assertion is
prepared for fresh replay; the complete existing SQL suite was not rerun here.
The current signed original-download link remains an explicit ADR-0016 gap.
Original expiry, public limits, production PR81 and **19/65** acceptance are unchanged.

### Canonical ordering and registered writes · local only

Canonical runs and eight-way merging now preserve every original disposition
while ordering normalized calls by target coordinates, with stable source ties.
Their **45 focused cases** and independent review pass. Whole-source terminal
verification remains distinct from a merge receipt; no target/rsID index or
application publication is implied.

The private Storage adapter reserves a database-generated `prepared/<UUID>` key
before its create-only upload, checks live job authority, reads and hashes the
entire stored object through EOF, then acknowledges the exact registered identity.
Failures close that writer without automatic retry; uncertain reservations remain
owned by cleanup. **60 mocked transport tests** and **31 range-reader tests**
pass, including a reviewed cancellation race between response resolution and its
awaiting continuation. Scoped TypeScript/lint pass. Across the existing engine
and these additions there are **348 distinct focused cases**, not a full CI run.

The unapplied migration's permanent namespace and rollback-probe commit fence
passed **85 rollback-only SQL assertions** in `job-authority-attempt-4/`.
All source/object fingerprints, counts and schema absence again match baseline.
Storage v1.70.3 source review confirms finalization may outlive client abort and
failure cleanup may enqueue physical deletion. Metadata refusal is therefore
insufficient evidence of byte removal. The actual local provider interruption
proof is next; its synthetic source setup and exact reversal must be complete
before temporarily installing the draft migration. No provider writes or runtime
migration commits occurred in this batch. Dispatch and public limits stay unchanged.

Canonical grouped containers and range reads are now connected locally. They
preserve exact encoded bytes and original/normalized evidence with the same
1 MiB target, 8 MiB ceiling and 128-block bound as parser containers. The shared
range transport retains the existing 31 reader cases; 38 canonical-container and
13 canonical-reader cases pass, with scoped TypeScript/lint and independent review.
The focused engine inventory is now **399 distinct cases**. These are still
provisional data adapters: target/rsID indexes, publication and the complete
application journey remain pending. Actual Storage proof uses a tiny original
through the existing ephemeral local signing setup, then targets the unchanged
Storage service for prepared writes and interruption cleanup.

### Actual local Storage write/freeze proof · 8 September 2026

At source `93e5fda24e27ab98952a044ed1ddeb0ff62aed69`, the first actual provider
attempt passed in **4.823 seconds** (18:01:14.490–18:01:19.313 UTC). A 547-byte
synthetic VCF used real signing, issuance, structural validation and finalization
through the existing ephemeral local provider setup. Preparation then used the
unchanged Storage v1.70.3 service and its existing queue configuration.

The actual registered writer stored a 554-byte provisional container, verified
the complete readback hash and exact ACK, and matched an independent physical
file hash. An overwrite returned HTTP 400 and preserved the object/version/hash.
A second upload was paused after its one-byte physical file appeared. The real
job freeze occurred with almost 30 seconds remaining on its write lease; after
the remaining bytes were sent, finalization returned HTTP 400, no object metadata
remained, and the exact physical version and `.info` companion were absent.

Cleanup removed both prepared memberships and the original through the actual
file/Storage deletion contracts, settled both test processes, then reversed the
temporary additive migration without `CASCADE`. Existing file/object fingerprints,
33-file/33-object counts, upload configuration, registry, migration history and
Storage triggers matched the baseline. Root independently checked database
restoration and all eight candidate prepared version/companion paths absent.
One explicitly declared synthetic Auth/session/consent fixture remains locally;
this is not an account-deletion proof. Receipts and frozen driver pins are in
parent task `work/wgs-next-backend/storage-integration-attempt-1/`.

This closes the actual **local file-backend** write/freeze prerequisite. It does
not establish hosted S3 cleanup, full-size throughput, canonical indexed reads,
or the complete application lifecycle. Next: durable manifest/index membership,
target/rsID lookups, backend-aware report/export/download and cleanup integration,
then the larger synthetic application journey. Production PR81, public limits,
original expiry, subscriptions and **19/65** acceptance remain unchanged.

### Indexed canonical materialization · local only

The coordinate index derives bounded, inclusive target ranges from fully decoded,
hash-verified canonical blocks. Original rsID pointers preserve observations,
duplicates, unmapped and unsupported dispositions; reference events without an
rsID are not assigned one. Sorted pointer runs and eight-way merging retain
separate completion evidence. Their 41 coordinate and 36 rsID cases pass.

The materializer now connects sorted canonical output to the registered writer,
coordinate pages and paged container directories. It checks the exact job,
attempt, contiguous artifact sequence, unique object identities and byte hashes.
Directory pages are bounded at 1 MiB; the root receipt at 4 MB. The true canonical
terminal, separate merge terminal, exact record counts and actual upstream EOF
are required. All outputs remain provisional pending final index/publication and
current authority checks. Its 27 cases include real parser → canonical → merge →
materialized-byte → selected-coordinate and rsID-pointer roundtrips using an
in-memory transport, plus malformed receipts, cancellation and artifact limits.
This composition test is not another provider or application proof.

Independent review corrected a mismatch between unique unmapped source positions
and unmapped record dispositions. Real GRCh37 regressions now preserve these
separate quantities, including unsupported alleles at an unmapped position. An
rsID receipt-size check also moved before schema cloning. Scoped TypeScript/lint
pass; the focused engine inventory is **503 distinct cases**, not full CI.

The first materializer test attempt omitted a required canonicalizer fixture
option and failed before exercising the materializer; fixing the fixture restored
the intended checks. No production behavior or assertion was weakened.

Next: validate immutable directory/manifest membership, connect indexed reads to
chosen reports and exports, persist checkpoints and complete cleanup, then verify
the larger-file application journey before release. No foundation-only PR or
runtime activation was made. Production PR81 and **19/65** acceptance remain.
The approved targets remain existing WGS results first, FASTQ/BAM/CRAM afterward,
100 genomes/month and one-month original retention; capacity and expiry are not
enabled or proven, and no additional spending is authorized.

### Verified indexed reads · local only

The new reader follows an exact provisional root through its coordinate pages,
container directories and selected canonical byte ranges. It verifies object
membership metadata, hashes and descriptors; preserves all matching normalized
records across bounded cursors; and performs per-object and final source-authority
callbacks before returning a page. Missing/corrupt objects and late withdrawal
fail the response, including empty queries. Reverse-strand GRCh37 tests retain
original A/C evidence beside the normalized G/T call at its GRCh38 coordinate.

**73 manifest, 17 coordinate-reader and 24 rsID-container cases** pass, as do
27 existing materializer cases after shared fixture extraction. Independent review
and scoped TypeScript/lint pass. Review added a cross-directory artifact-sequence
check and a two-directory regression; metadata preflight rejects getters without
executing them. The focused engine inventory is now **617 distinct cases**.
These use synthetic/in-memory range transport, not a newly verified provider or
application journey. No running source, schema, limits or subscriptions changed.

The report seam is identified: normalized call fields plus original usability,
with existing source-line/collision behavior preserved. It is **not activated**:
a real published backend receipt must bind report begin/check/commit, and full
publication must validate every unseen directory member and total data bytes.
Next is final index persistence/publication/checkpoints and lifecycle integration,
then the larger-file application proof and a coherent PR. Production stays PR81;
acceptance stays **19/65**, with original expiry and larger admission still off.

### Complete final-object verification and publication · local only

The final rsID materializer now persists bounded index containers and directories.
Full canonical and rsID verifiers read every final object through exact hashes
and EOF, checking order, actual index bounds, counts and unique membership.
The publication assembler writes separate canonical/rsID roots and a compact
combined root through the registered writer, then returns the exact final subset.
Temporary rsID sorting objects remain registered scratch even when allocated
between final phases. This corrects an assumption found by independent review.

The four new suites pass **109 focused cases** (31 materializer, 43 complete
canonical verification, 17 complete rsID verification, 18 publication assembly).
Scoped TypeScript/lint and independent review pass. The focused engine inventory
is **726 distinct cases**; only the changed four suites were rerun this batch.
Transport composition remains synthetic/in-memory, distinct from the earlier
actual local Storage primitive proof.

The additive disabled publication migration passed **51 rollback-only SQL
assertions** in `publication-authority-attempt-2/`. Initial publication uses the
actual originating session and finite claim; subsequent reads and exact replay
use the current reader's source/store/lifecycle authority. Published membership
is immutable, ordinary job expiry cannot freeze it, legacy normalization cannot
steal its file, and current withdrawal denies reading it. Review added exact
current file-type identity. No legacy normalization rows are fabricated.

The first SQL attempt passed 46 assertions before a synthetic consent withdrawal
omitted its required reason. The corrected fixture sets the exact captured
consent's timestamp and reason, then asserts valid withdrawal and the same denial.
Both transactions fully rolled back: file/object fingerprints, Auth/data counts,
configuration, migration history and schema absence match baseline. The actual
runtime registry remains 117; the updated 121-store/24-assertion contract fixture
is prepared for fresh replay. No provider writes, schema commits or activation.

This closes the local byte-verification and atomic publication prerequisite.
Next: connect real published membership to indexed report/read/export access,
complete file/account/scratch deletion with unrelated-file preservation, and
integrate bounded worker recovery before the larger synthetic application proof.
The final publication transport and worker are not connected yet. Checkpoint
adoption, revocable original download and one-month expiry remain open. No new
PR is opened for this disabled foundation. Production PR81, public limits,
subscriptions and **19/65** whole-plan acceptance are unchanged.

### Authenticated published-coordinate reads · local only

The published coordinate reader now connects exact actor/file/manifest selection
to service RPCs and authenticated Storage GET/range transports. It loads the
actual serialized combined/canonical roots, verifies hashes and source/count
bindings, and preserves full canonical evidence through bounded cursors. Every
selected object rechecks exact published membership and the caller's distinct
current operation. Exhaustive full-source checks at both page boundaries detect
loss of an unread member during I/O; this was added after independent review.

**17 reader composition and 41 transport tests pass**, with scoped TypeScript,
lint and independent review. These use real synthetic parser/materializer roots
and synthetic HTTP responses. The cumulative focused engine inventory is now
**784 cases**, not a rerun of full CI or a provider journey. Existing application
report readers remain unchanged until claim/completion bind the same manifest.

The additive member-authorization migration factors the existing source gate
without changing its source/session/store/file-type predicates. A point check
uses exact indexed final membership plus actual Storage metadata identity; it
does not rescan every member. Full source reads retain exhaustive validation.
**36 rollback-only SQL assertions pass** in `member-authority-attempt-3/`; all
file/object hashes, counts, config/history and absence of new schema match the
baseline. One earlier driver attempt stopped during preflight before migration
execution; the next SQL run found an invalid partial-revision fixture. The final
fixture preserves that constraint-refusal assertion and separately proves a
coherent changed revision invalidates the captured source. Earlier outcomes stay
recorded. No runtime migration, hosted request, admission or retention change.

Next is actual local Storage composition of preparation → publication → current
indexed read. Report claim/detail/mail binding, complete export, worker recovery
and exact file/account/scratch deletion are still required before activation.
The deletion assessment identifies one shared exact-artifact cleanup protocol:
include all attempts, distinguish published nonmembers from final members, and
retire members → manifests → artifacts → jobs before the existing file graph.
Unacknowledged provider writes require durable physical-absence evidence; metadata
absence alone is insufficient. See parent task `prepared-deletion-integration.md`.
Production PR81 and whole-plan acceptance **19/65** remain unchanged.


### Actual publication composition: RPC transport correction

Two bounded local attempts at `47698d2` completed actual signing/finalization,
parser and canonical/rsID preparation, registered writes and SQL publication:
**14 objects, six scratch artifacts and eight final members** per attempt, from
the same 547-byte synthetic GRCh38 VCF. Neither attempt returned a coordinate
page. The diagnostic retry identified a runtime defect before any Storage read:
PostgREST returned HTTP 200 with valid single-result `Content-Range: 0-0/*`,
which the new scalar RPC transport incorrectly rejected.

The corrected reader accepts absent or exact single-result item-count metadata
(`0-0/*`, `0-0/1`) with HTTP 200. Partial/byte ranges, multiple results, malformed
metadata and non-scalar JSON remain refused. **31 focused reader tests pass**;
scoped TypeScript and lint pass. This adds 14 cases to the cumulative focused
engine inventory (**798**); it does not establish a successful provider read yet.

Both attempts settled their requests, removed every registered physical version
and sidecar, retired only their exact synthetic rows, removed the original, and
reversed all three temporary migrations. Existing 33 files/33 objects and schema,
config, migration-history and registry fingerprints were preserved. Root checks
independently confirmed physical absence and removed only the empty synthetic
prepared namespace. Two synthetic Auth/audit fixtures remain, each with two
sessions. Earlier failure receipts stay in parent task
`work/wgs-next-backend/storage-published-integration-attempt-{1,2}/` and diagnosis
in `storage-published-diagnosis.json`. The next run requires the reviewed fix at
a new clean source commit. No hosted changes or scale/cleanup-implementation
claim; production PR81 and full-plan acceptance **19/65** are unchanged.

### Earlier PR80 dense preparation and report recovery

PR80 merge `b27ad1acb23abdfeb68e31b2315acb0a41b87384` is production READY as
`dpl_BxHac7ME2J5Ms8u7KAGL1NsBzAcZ` at **15:12:14.085 UTC**, on all six aliases.
CI `34240644001` passed **3,310 units (204 files), 85 fresh migrations, 2,120 SQL
assertions (56 files), 30 independent lock checks and 232 browser cases in 16.0
minutes**, with 57 actual Storage uploads and zero skips/retries. Both compatible
hosted migrations are installed; application flags, upload caps and plans are unchanged.

A native hosted synthetic VCF upload prepared **500,000 variants and 500,000
observations in 220.357201 seconds**. The subsequent report attempt failed; the
page incorrectly labelled this as failed preparation despite the completed source.
One explicit report-only retry returned **200** and displayed exact-source **A/C**
with one provenance source. The original download event occurred in the browser;
a separate authenticated application download verified both original hashes.
Application DELETE returned **204**; independent **15:27:20 UTC** checks found
all nine selected source/working/analysis/Storage counts zero, including both exact
Storage keys. The other four files' metadata fingerprint and variant/observation/
analysis counts were unchanged. Native JavaScript deletion confirmation remains
unverified because the browser control could not operate its prompt.

This proves hosted preparation plus report recovery, not an uninterrupted pass.
PR81 now distinguishes report failure from acknowledged preparation. Automatic statistics refreshed between failure and retry; that timing
is a clue, not proof of the first report failure's cause. Full-size WGS, 100 genomes
per month and one-month original expiry remain approved, unproved scope. No cap or
subscription was increased; acceptance remains **19/65**. Receipts: parent task
`work/wgs-release-pr80/`.

### Earlier PR79 and local preparation evidence

Actual abandoned staging cleanup finished **50.367195 seconds after real lease
expiry**, with its original deadline unchanged and exact residuals zero. A fresh
native public 425-byte upload prepared five variants with no analysis before
choice, then generated only the chosen traits. Bitter taste correctly showed
A/A at `rs1726866` and 1-of-2 coverage with `rs713598` absent. Authenticated app
download matched the original hash; app DELETE returned 204 and independent
checks found exact source/derivative/Storage-ledger counts zero with the account
preserved. Native JavaScript deletion confirmation remains unproved. Detailed
receipts and timestamps are in `docs/hosted-own-upload-readiness.md` and parent
task `work/current-retention-release/production-pr79/`.

The earlier local WGS streaming verification is retained below. Source `75a1a05`, build
`1D0A_d2kzmT7TFNSpjf3L`, passed one small native Storage → chosen reports →
download → deletion case (17.6 seconds; 20.1 seconds total), three fresh Storage
POSTs and zero skips/retries. A prepared 1,999 variants / 2,002 observations;
B's five variants survived A's processing/deletion; later-batch C was refused
with 415 and no public/private working rows. Six synthetic files were deleted
natively, and independent 13:51:50 UTC checks found all exact source/derived/
working rows and 12 Storage keys zero, preserving the other 33 files' fingerprint.
The wrapper's exit 1 was a scratch report-path mismatch: the exact unmodified
report contract passed separately, with no browser rerun. Earlier two selector
failures remain preserved in the evidence history.

The newly found long-allele registration-envelope defect is now fixed locally:
one-MB batch targets, the unchanged four-MB stage cap, and 1,024 bytes of bounded
registration metadata headroom. All 80 focused checks across three files and 71
actual SQL assertions pass; rollback metadata is identical. Evidence is in parent
task `work/wgs-position-registration-verification/byte-bound/byte-fix-receipt.json`.
Dense v3 (`138bb6f`, application `d722225`, build
`wi0PVIbQtedwR6Zm8lKOp`) prepared **500,000 variants / 500,000 observations** in
**103.304 seconds**, completing at 14:37:36.179692 UTC; direct SQL took 37.929564
seconds. Its report request then failed in 8.482 seconds on an unindexed observed
point scan. Migration `20260908143927` adds `(file_id, chrom, pos, source_line)`;
the local lookup probe became 0.515 ms.

A **separate continuation on that same prepared source** passed in 10.4 seconds /
13.4 seconds total, zero uploads/skips/retries: report POST 200 in 1.159 seconds,
exact-source A/C and one provenance source, raw/decoded original hashes matching,
and native DELETE 204 in 2.580 seconds. At 14:45:06.892 UTC all 11 selected counts,
including both Storage keys, were zero; the other 33 files' fingerprints/counts
were unchanged. Exit 0, listeners closed, resource flags false. Preparation app/
DB sampled peaks were 529,740,596 / 404,121,191 bytes; continuation DB peak was
512,753,664 bytes. Cluster-wide WAL grew approximately 1.007 GB / 277.5 MB across
the two phases; this is not isolated per-file or steady-state capacity evidence.
See parent task `work/wgs-dense-continuation/` and dense v3 preparation receipts.

The prior fetch-lifetime and local-proxy timeout failures remain historical;
their originals/working rows are cleaned. The earlier native 409 was followed by
exact-claim expiry and successful recovery at 14:34:15 UTC. Keep the small-browser
proof and failed-run receipts; do not describe the split preparation/continuation
as one uninterrupted pass. The subsequent PR80 release and hosted recovery are
recorded above; **19/65** acceptance is unchanged. Full-size WGS,
100-genomes/month and one-month original retention are not enabled/proven by this
local result; no additional spending is authorized.
Earlier dated release descriptions below are historical, not current blockers.

## Owner-directed next scope · 8 September 2026

PR81 is deployed with corrected report-recovery messaging. The next approved work is ordinary full-size existing WGS result
files, followed by
raw FASTQ/BAM/CRAM processing. The owner targets **100 genomes per month** and
**one-month retention of original source files**. These are implementation and
workload targets, not measured capacity or capabilities already delivered.
Raw formats remain refused until their format/compute/lifecycle contracts and
verified execution path are updated. Do not silently alter existing retention
obligations. **No additional spending is authorized**; any necessary resources
outside verified existing allowances require a separate cost decision.
This changes the next delivery priority, not the **19/65** acceptance count.

## Why the count looks stuck

There is both real progress and a real bottleneck. PR72 released useful,
source-backed report improvements, but its evidence covers eight reports,
not the catalog-wide G1.11/G4.7 gates. The new own-upload implementation has
local consent, transport, complete-source validation and cleanup receipts.
The latest local browser checkpoint now proves file selection through chosen
personal results, withdrawal, retained source browsing and original download.
The protected hosted journey now also proves actual signing, chosen findings,
inbox delivery, withdrawal, retained download and exact source deletion. A real
25 MB / million-row local array journey now passes preparation, a chosen finding,
byte-identical download and deletion after fixing a measured database timeout.
A near-24 MiB local VCF/gzip journey also passes format limits, exact-source
selection, byte-identical originals and deletion preserving the second source.
The final local recovery at `9ef7fca` also passed chosen findings, exact original
bytes and two-file deletion isolation; its full CI passed 3,247 units, 2,008 SQL
assertions and 232 browser cases. The public-CA adapter preserves certificate
and hostname verification; hosted million-row preparation, the chosen report
and native original download now pass. Temporary hosted limits are restored.
PR79 now enables bounded canonical public uploads. Scheduled derivative retry
and actual expired-staging cleanup have separate successful receipts; a fresh
public native upload/result and app download/deletion also pass. These bounded
results do not establish full-size WGS throughput or every rights/retention scope.

Many NO rows are whole-product conjunctions: G2.6 requires all four upload
journeys; G1.12 requires every registered route/state; G4.7 requires every
scientific claim. One completed slice cannot truthfully turn such a row YES.
Use the milestone table below alongside, never instead of, the 65-item ledger.

## Delivery milestones, in priority order

| Journey | Useful outcome | Required proof before calling the milestone delivered | Full-plan relation |
| --- | --- | --- | --- |
| 1. My file → my first findings | Choose an ordinary supported file, understand progress, select report purposes once, open a covered source-backed finding. | Production-build browser test through real restricted Storage, complete-source finalization, exact-source normalization, one selected purpose and real rendered result. A second purpose remains off; denied/expired consent produces no analytic output. Retry does not duplicate a source or grant. Deployed signer/capacity configuration and retention execution are verified. | Own-genome part of G2.6; partial G5.2/G2.2. Other three journeys still required. |
| 2. Find and understand what my file says | Locate a useful finding, distinguish no coverage from a negative result, inspect its source, return to the same search. | Covered and genuinely uncovered synthetic inputs; mobile and desktop; keyboard recovery from empty filters; meaningful first heading and source/input facts; no fabricated risk or percentile. Keep report-layer counts separate. | Builds on accepted G4.3/G4.6. Contributes to G2.4, G3.5, G4.7; none becomes YES from one library test. |
| 3. Control my files without getting trapped | Download or delete a chosen file, see a clear failure, retry safely, retain unrelated files and their results. | Two synthetic files in one account; deleting one removes its exact object and derivatives while the other remains usable; failed provider deletion stays visible and retryable. Verify free export and account notice/cancellation separately. | Existing deletion regression is valuable, not full G5.3a/G5.6. Broader adult/embryo graphs remain necessary. |
| 4. Another adult participates willingly | Invite an adult, complete the appropriate upload/confirmation path, grant one purpose and see only the shared result. | Actual file journey, exact uploader/subject ownership, pre-confirmation unreadability, purpose-specific output, accountless refusal, revocation and deadline-bound physical cleanup. Positive and refused contributor jurisdictions must be exercised. | Adult part of G2.6; closes only the proved slices of G5.3/G5.4/G5.1b. Existing invitation acceptance alone is insufficient. |
| 5. Parents understand embryo results | Complete both permitted embryo uploader paths, see per-embryo QC and supported comparisons, with clear missing-data states and no ranking. | Real synthetic source ingestion and all required signers; complete ordinal publication or named QC failure; useful comparison and trade-off output; failure notices and exact retention/purge proof. Neither a placeholder nor a refusal-only test counts as the positive workflow. | Remaining two G2.6 paths; embryo half of G4.5 and broader G5 rights gates. |

### Keep the first journey simple

The canonical `analysis-eligibility-v1` matrix explicitly permits
`ingest.normalize` under current upload/store consent with **no analytic
purpose grant**. Basic preparation must not request a second upload permission.
Monogenic reports, polygenic reports and ancestry have separate purposes;
turning one on must not require turning on the other two. Normalization and
storage success must not be described as reports ready.

Keep the existing usable report catalog available. Prioritize reviewed
takeaways and understandable coverage over adding unsupported numerical
claims. A genuinely unavailable score can be honest and useful when it
explains what was checked and what is missing; a dead-end generic refusal is
not the intended MVP.

## Parallel lanes and acceptance closure

- **Integration lane:** finish milestone 1 as one vertical slice. Parent owns
  browser/API wiring and real provider trust; normalization and report-choice
  agents own separate modules. Test this boundary before expanding uploads.
- **UX lane:** report-library filter recovery and browser-back regression,
  scoped to existing authorized cards. No new data permission, purpose or
  report meaning. This is independently reviewable, but not a new G gate.
- **Completed bounded gate:** G1.14 passes at `60c122e` with three runs each
  on the landing page, authenticated Overview and an actual uploaded-source
  report. Performance medians are 96/98/97; all accessibility scores are 100.
  This closes one exact gate, not full accessibility or required CI wiring.
- **Current release prerequisite:** exact `0d05e1c` CI `34206586233` passes
  3,190 units, 1,989 SQL assertions across 53 files, 30 locks and 232 browser
  cases, with 57 actual Storage uploads and no skips/retries. The tiny protected
  hosted findings/inbox-link/withdrawal/download/deletion journey remains valid,
  but the later million-row hosted preparation timed out despite the installed
  capacity fix. Resolve that measured bottleneck and verify recurring retention;
  keep incompatible cutover deferred until the legacy pause/drain/application
  transition. Local format-capacity success is not hosted capacity approval.
- **After the core flow stabilizes:** finish complete route/state coverage and
  route dispositions for G1.12/G2.2/G2.3, then their required CI integration.
  Repeatedly rerunning incomplete full suites does not close those gates.

The comprehension lane requires actual independent simulations and blind
grading under G3.1–G3.3. A written protocol or invented transcripts cannot
close it. Human recruitment remains an explicitly recorded launch condition.

## Reporting after each PR

### 2026-09-08 · Million-row preparation passes; report lookup repair under verification

Typed direct completion at `848a834` returns 200 in 49.753 seconds with the
actual connection observed, one million published variants and a complete
normalization journal. Explicit report generation then times out after
8.413 seconds. Its original and prepared rows are preserved for browser recovery.
The query-only locus lookup migration passes 65 local rollback assertions;
it uses existing indexes and retains source, permission and pagination checks.
Browser recovery, hosted capacity, exact CI and coordinated release remain
pending. Production PR77 and **19/65** are unchanged. The earlier failed attempts
remain separate evidence, not passing full journeys.

### 2026-09-08 · Direct-completion attempt failed; JSON binding defect isolated

The opt-in adapter's first actual local browser run at `7605b0b` failed
preparation with 503 after 18.222 seconds. Zero variants were published and the
original synthetic source remains available for diagnosis. The failed receipt
is preserved; the namespace was restored and owned listeners closed.

A read-only rollback probe with `postgres` 3.4.9 proved that the existing
`JSON.stringify(payload)` binding becomes a JSONB string. `tx.json(payload)`
produces the required object and preserves nested fields. The correction and
new browser run remain pending. The probe did not retry completion or modify
an upload. See parent-task `work/hosted-capacity-20260908/direct-json-binding-receipt.json`
and `work/canonical-family-runtime-adapter/direct-capacity/`. This does not
supersede the earlier local passes or resolve the separate hosted timeout;
production PR77 and **19/65** remain unchanged.


### 2026-09-08 · Local format capacity passes; hosted capacity still fails

The local plain VCF and gzip cases each prepared **541,341 variants and one
observation** at a temporary 24 MiB decoded ceiling, with no analysis before
choice. Only the older source produced the chosen A/C report; the newer source
remained ungenerated. Both originals passed byte/hash checks, deleting the first
preserved the second, and final source cleanup passed. Over-limit raw input was
refused before Storage; over-limit decoded gzip was rejected and cleaned. The
one browser case used three actual uploads with zero skips/retries; local limits
were restored. This is bounded local evidence, not WGS or concurrency capacity.

Hosted migration `20260908091926` installed the exact reviewed capacity fix at
09:19:26 UTC; normalization settings/ACLs were verified. The protected `f0ab225`
canary then uploaded and finalized the 24,562,693-byte million-row array but
failed preparation with a database statement timeout at 09:23:52 UTC (log
`407db189-0f62-46f7-bf4f-10f56f4770f0`). Source
`7011928e-9c9d-47c5-82b4-72ebd1e5d844` is retained, with zero published variants
and zero batches. No report choice or ready-mail generation occurred. Hosted
limits were restored at 09:25:09 UTC. Preserve the failed receipt and diagnose
before retrying; production **PR77** and the **19/65** acceptance count are
unchanged. Exact CI and evidence paths are recorded in
`docs/hosted-own-upload-readiness.md`.


### 2026-09-08 · Protected hosted own-file journey completed

One actual synthetic upload reached a chosen source-backed finding, a ready
notice delivered to Zoho and followed back to the result, timely purpose
withdrawal, byte-identical downloads before/after withdrawal and exact source
removal. Current `fa26e1a` CI passes all 232 browser cases with 57 actual local
uploads. The complete hosted receipts and remaining production capacity,
recurring retention and coordinated cutover conditions are in
`docs/hosted-own-upload-readiness.md`. Production remains PR77 and acceptance
remains **19/65**; no broader gate is promoted from this single hosted slice.

### 2026-09-08 · Authentication return protection released separately

PR77 ships the six auth files onto the existing production runtime. Exact-head
CI passes 2,289 units, 1,044 SQL assertions, 30 locks and 220 browser tests.
The merged tree matches that head. Both public domains serve merge `3c59ac1`;
actual synthetic sign-in preserves a valid Settings query/fragment and sends
an off-site return to fully rendered Overview. Cron schedules remain enabled
and unchanged. No migration, private-key handoff or genome mutation was needed.
Acceptance remains **19/65**. PR76's exact `e97fa21` CI also passes all 232
browser cases with 57 real Storage uploads; integrating PR77 needs its own
head check. The hosted canonical notice/upload step still waits for the
extension file-URL permission. Use PR77 as its legacy rollback baseline.


### 2026-09-07 · Health Picture and exact saved-source reports verified locally

At `7ebabc5`, a fresh production build (`ZtFdEBSPtsfwjGkWXRtjE`) passes all
**16 Health Picture/Family cases**, with **three actual Storage uploads**, no
skips or retries. Both adults upload and generate their own chosen reports,
accept the invitation and explicitly share. Health Picture shows separately
attributed saved calls; actual links open the selected own and shared source
with A/C and input provenance. Per-layer and joint withdrawal preserve the
independent sources and own permissions. Five desktop/phone captures were
inspected after fixing narrow columns and making You/Invited adult visible.

Local schema has 79 migrations; Health Picture's 46 and own-detail's 29 SQL
assertions pass. Full units pass **3,121** at `085dc9b`; the latest focused
53- and 39-test checks, full typecheck and readability pass at `7ebabc5`.
The two additive schemas are also hosted and metadata-verified as
`20260907211300` and `20260907211345`: all eight new functions match, with all
11 dependencies unchanged. This is schema staging, not a hosted app journey.

The earlier return-to-gate fixture failure and passing pre-visual run remain
in the local verification ledger. Clinical carrier/ROH computation, Portrait
trait tables and parent lineages remain unsupported. Production stays PR75,
PR76 CI awaits the environment correction and detailed runtime diagnostics,
and acceptance stays **18/65**. Hosted application, required notification and
worker proof, and the coordinated upload cutover remain separate release work.

### 2026-09-07 · Earlier Portrait hosted prerequisite and Health Picture local integration

Portrait's additive migration is now installed hosted as `20260907204441`.
Its five function bodies, owners, execution privileges and security settings,
private table constraints/access and full stored SQL SHA-256 match the locally
verified source. All six dependency fingerprints remain unchanged; the new
private grant table is empty. No application RPC, generation or worker ran.
Production remains PR75; this is schema staging, not deployed Portrait proof.

Health Picture's data migration is installed on the owned synthetic local
stack (78 migrations). Its original 46 SQL assertions pass there and roll
back. Page integration and actual browser verification remain open. Review
caught own report detail ignoring the selected source; an exact captured-source
reader is being implemented before that link is released.

CI `34159990877` on `acb7c30` stopped at TypeScript: the new isolated shell
regression environment omitted Next's required `NODE_ENV`. Correction
`fe429bf` adds only `NODE_ENV: "test"`; its 16 focused tests, lint and full
local type check pass. The earlier namespace startup failure remains
unresolved until CI reaches its new diagnostics. Acceptance stays **18/65**.

### 2026-09-07 · Portrait permissions and public reference-file journey verified locally

All 14 Portrait/GIAB browser cases pass together at `f0e1b5f`, with four real
provider uploads and no skips/retries. The same application build at `c894915`
separately passes all six Family cases. Family controls now consume and check
the complete signed-operation receipt before refreshing; actual browser proof
retains the response-body assertion. Desktop/phone Portrait captures and its
budget/accessibility case pass. Canonical clinical/ROH computations, five
Portrait trait tables and parent lineages remain unavailable; these results
do not close their scientific gates. Exact failed and passing scopes are in
the local verification ledger.

CI at published `c155a78` passes preceding gates, database checks and build,
but fails before browser cases in namespace setup. Bounded phase/exit
diagnostics are integrated; network policy and the ten-second setup deadline
are unchanged. The underlying Linux command failure remains unproved.
Health Picture's separate data layer passes 86 units and 46 rollback SQL
assertions; page integration is underway and its migration is not installed.
Portrait's migration is local only. Production remains PR75; acceptance is
still **18/65**. Compatible hosted staging is complete for the preceding eight
migrations; full CI, coordinated cutover and notification authorization/allowance
remain open.

### 2026-09-07 · Family sharing and account deletion verified locally

At `fb43083`, seven production-build cases pass together with two real Storage
uploads and no skips/retries: independent-adult invitation, chosen own report,
explicit sharing, recipient reading, withdrawal and zero-residual account
purge. Desktop/mobile Family views were inspected. Account-purge corrections
remove owned grant nonces and upload sessions in the required dependency order
while preserving Storage acknowledgement and foreign-owner refusals.
The final consolidated batch passes 2,981 units, secret and readability gates; exact SQL, race and browser scopes
are recorded in the local verification ledger. This closes useful local
journeys, not the full adult or deletion acceptance gates.

Earlier full CI on `6679ad2` is 131 passed, 9 failed and 92 not run, including
passing Family/account purge. The newer `001b72e` run `34137537643` stopped
at the name gate on a negative-test hostname, before browser execution; its
reserved-domain correction preserves the assertion. Search/count has complete
local proof. Both file-deletion cases now pass inside a six-case run that then
failed on a GIAB selector (2 passed, 1 failed, 3 not run). This includes the
foreign-account, processing, canonical-file and legacy-other-adult guards;
the failed suite did not emit its aggregate upload-counter receipt.

Portrait now has canonical source readiness and preserves independently valid
legacy inputs. Its local migration is installed (77 total); 198 focused units,
32 rollback SQL assertions and typecheck pass. A fresh-build 14-case
Portrait/GIAB run passed the first actual-upload/invitation case, then failed
because A's test route used B's self ID instead of the accepted invitation
handle. The fixture correction is integrated; remaining cases need rerunning.
Canonical clinical and lineage computation remain unavailable.

All eight compatible hosted migrations are installed and verified against
their complete SQL hashes and 55 final function bodies/privileges. Existing
grant API, retention registry and legacy upload policy are preserved. This
closes the compatible schema prerequisite, not deployed user-journey proof.
Portrait's new migration remains local only. PR76 stays draft, production
stays PR75, and acceptance stays **18/65**. Full CI, the coordinated upload
cutover and the existing notification recipient/allowance question remain.

### 2026-09-07 · Canonical ancestry journey verified locally

The canonical ancestry journey now passes five production-build browser cases
at `0e0d99e`, including three actual Storage uploads, honest low-coverage output,
the existing broad-region estimate, ancestry-only Overview readiness and mobile
navigation. Inspected desktop/mobile results show source facts once beneath
the computed result; parent lineages remain explicitly uncomputed. The new
migrations replay with all 73 migrations on a fresh database; all 47 SQL fixtures
pass 1,746 assertions. Local installation preserves existing data, history and
function privileges, and all 15 changed/new function definitions match the
fresh database. Full application verification passes 2,921 units at `e3ebdb6`;
the final display correction passes browser, TypeScript and scoped lint.

This closes the local ancestry prerequisite recorded below. It does not close
whole ancestry/scientific acceptance or the complete browser suite. Four legacy
`ingestFileAs` call sites remain in portrait, Health Picture, Family and
other-adult deletion. Accepted ADR0016 excludes BAM/CRAM; the historical success
test is explicitly retired with its evidence preserved, and both current refusal
cases pass at `b72c1e4` with two actual Storage uploads and exact cleanup proof. Hosted ancestry migrations,
notification allowance/recipient authorization, complete CI and coordinated
cutover remain open. Production stays PR75; acceptance stays **18/65**.

### 2026-09-07 · Canonical ancestry display integrated locally

At `3677dfc`, ancestry and Overview read the checked completed journal, confirm
the same captured result after other awaited reads, and show ancestry-only
readiness without inventing report counts. Canonical lineage analysis remains
explicitly uncomputed. Ninety-six focused units pass; scoped lint, TypeScript
and diff checks pass, including the final Overview confirmation adjustment.
The new ancestry generation and export/notice migrations have not run in a
fresh database or been installed locally or hosted. Independent review found
premature predecessor notices and cross-source export buffering; repair
`abadca9` is preserved in its worktree and awaits rereview/integration.

Next: integrate the reviewed repair, run a fresh isolated migration replay and
affected rollback SQL fixtures, then verify ancestry/Overview through actual
Storage in the production-build browser harness. Do not claim the new ancestry
journey from focused unit checks. PR76 remains draft at remote `6fa1eaa` with
failed CI; production remains PR75 and formal acceptance **18/65**.

### 2026-09-07 · PR76 CI reaches name classification gate

CI `34115365058` at `6fa1eaa` passes typecheck, lint, the production build,
all **2,822 units in 181 files**, and the legal gate. It then stops at the
name gate on 43 external-host findings; later gates and browser tests are
unrun. The URL classifier now uses actual hostnames, recognizes reserved
synthetic domains and loopback, and rejects malformed authorities before any
allowed-suffix comparison. Existing private-name scanning is unchanged.
The PostgreSQL documentation and special-use registry have cited allowlist
entries. Twenty-five focused scanner tests and lint pass; the whole public
scan has no findings. The full gate still correctly refuses the absent local
private denylist and must be reverified using the existing CI secret.
This does not waive the failed CI run or authorize merge. See ADR0007.

### 2026-09-07 · Draft PR76 and released-main integration

The replacement branch is pushed and tracked by draft PR76. Its first automatic
Vercel preview is READY at `65bcc12` (`dpl_G2K7NpmHQVPiob7k1DPKEMdfpmpD`);
that build status is not hosted journey verification. Public production remains
PR75. Initial GitHub Actions absence coincided with merge conflicts against the
released PR74/PR75 commits; these are resolved without changing the verified
application runtime. The stronger released Overview layout assertions remain,
and the test register maps retired legacy pause checks to canonical coverage.

At `8787a4c`, the repository/history secret gate passes: 1,116 tracked files,
343 authored commits, nine genome fixtures. Five reviewed synthetic fixtures
are bound to exact values, paths and complete source-line hashes, including
historical occurrences; detectors and the history baseline remain unchanged.
The merge resolution passes 114 focused units, scoped lint and full TypeScript,
and standard discovery remains 231 cases/44 files. It does not establish a new
full browser pass. The PR remains draft pending complete CI and coordinated
hosted verification/cutover; no merge or production promotion occurred.
Formal acceptance stays **18/65**.

### 2026-09-07 · Personal Copilot journey verified locally

At `763fbf1`, one isolated production-build run passes **73/73 Copilot browser
cases**, no skips/retries, with 10 actual Storage uploads. It proves useful
source-backed answers, captured citations, saved conversations, 64 output cases,
input refusals, live permission/model changes and exact source/history cleanup
while independent data remains usable. Desktop/mobile captures were inspected.
The preceding empty-chat defect has a 77-assertion rollback SQL proof; only its
reviewed private dispatcher was replaced locally with preserved data/owners.

The integrated runtime passes 2,811 units and full lint. The standard suite
discovers 231 cases in 44 files; full CI remains open.
Production stays PR75, no hosted Copilot migration/release occurred, and formal
acceptance stays **18/65**. Next canonical runtime prerequisite is ancestry:
selected generation, exact-purpose cleanup/export and honest existing-panel
output must land together. Hosted notices still need the previously requested
recipient authorization and verified allowance. See the local verification
record for exact receipts and historical failed attempts.

### 2026-09-07 · Personal Copilot integration and compatibility repair

The local canonical chat path now binds provider permission, exact sources,
captured reports and saved history. SQL verification also repaired a deletion
regression for accounts with historical conversations: file deletion preserves
unattributed history while exact canonical dependencies are removed. The three
affected rollback fixtures pass 126 assertions, and local installation preserves
existing data and deletion-function ownership/permissions.

The production-build browser run now passes permission granting and all three
conflicting-source, missing-position and ungenerated-report questions. Missing
report lookup acknowledges a verified catalog identity without permitting an
invented identifier or borrowing scientific metadata. All 2,808 unit tests and
full lint pass at `0003d87`. The next browser case reaches the expected withdrawal
refusal, but needs native response capture before its exact body can be checked;
the rest of the 73-case integration remains open. The observer is now integrated
at `6f066f1` and independently reviewed. Attempt v7 verifies the exact withdrawal
response, then exposes a product defect: a fully purged canonical conversation
returns empty history instead of refusing access. Repair `c4e414d` now passes
77 rollback SQL assertions and focused application checks. V8 confirms history
denial, exact message cleanup and preserved raw data, then finds a stale raw-call
format expectation (`AC` versus canonical `A/C`). Both affected test assertions
are corrected; the 73-case run still needs to complete. See the local
verification record. No release or new whole-plan gate is claimed: production remains PR75 and
acceptance **18/65**. Hosted notices still require the previously requested
recipient authorization and verified allowance.

### 2026-09-07 · Replacement protected source-control journey verified

Candidate `85fe7c4` is READY on the dedicated protected canary alias. Actual
browser upload through restricted hosted Storage, preparation, original download,
canonical ZIP content and selected-file deletion pass. Independent database
checks confirm exact source hashes, no generated analysis or ready notices,
complete scoped source cleanup and preservation of the other file. Export proof
uses the actual API from the browser; the hosted export button was not exercised.
See [the hosted receipt](hosted-own-upload-readiness.md).

Production remains PR75, schedules and legacy Storage policy are unchanged,
and acceptance remains **18/65**. No PR merged. Hosted report generation needs
explicit test-delivery authorization and a verified email allowance first;
Resend currently requires owner sign-in. Operational cleanup, remaining canonical
runtime prerequisites for full CI and coordinated public cutover remain open.

### 2026-09-07 · Compatible notice/export/cleanup schema staged hosted

The three reviewed additive migrations are staged and independently match
their committed SQL, function bodies, owners/ACLs, columns and triggers.
Legacy Storage remains intact; no generation, worker or provider call ran.
Production is still PR75 and acceptance **18/65**. Next: one protected
candidate build and source-only preparation/export checks, followed by the
separately authorized synthetic notification and operational cleanup checks.

### 2026-09-07 · Own ready notices and control regressions verified locally

At `6e9acd6`, one actual-provider run passes all **69 selected browser cases**
with no skips/retries and 33 real Storage uploads. It combines the earlier
65-case scope with durable chosen-report notices, immutable expiry/replay,
three-page exact export, account notice/cancellation, and self-file deletion
that preserves a second source. Runtime `6c25379` passes 2,702 units and
typecheck; all 68 migrations install fresh and eleven SQL fixtures pass 299
assertions. See [the local receipt](local-upload-browser-verification.md).

No PR was merged. Production and the protected hosted canary remain unchanged;
acceptance stays **18/65**. The production mail worker can consume canonical
notices queued by a replacement candidate, so missing preview mail credentials
do not isolate delivery. Next: compatible hosted staging and a protected build,
then an explicitly authorized synthetic delivery check and operational cleanup.
Full CI also needs canonical ancestry, Copilot, recipient/joint workflows and
resumable BAM support; replacing their helpers cannot close those product gaps.

### 2026-09-07 · Canonical export and fresh-install prerequisites verified locally

The actual ZIP journey now preserves both originals and all prepared calls,
includes completed findings only for the selected source, and removes findings
after withdrawal while keeping raw access. Runtime `5ee7121` has passing
evidence for each of 65 selected browser cases across documented test-only
corrections; this is neither one clean 65-case run nor the full 226-case gate.
The revocation executor has synchronous manifest-before-delete and truthful
historical-job handling, with no claim of deadline compliance from delayed work.

An isolated fresh database replayed all 67 migrations at `a2ae65a`; four
corrected, self-contained SQL fixtures at `48b28ac` pass 124 assertions.
The consent-language migration now keeps its unchanged operations atomic
without relying on an installer's outer transaction. This does not require
reapplying the already staged hosted migration. Existing fixtures are preserved.

These close export-content and fresh-install prerequisites locally. No PR was
merged or candidate replaced in this batch. Next: durable chosen-report ready
notices, retained expiry/deletion regressions, then compatible hosted staging
and synthetic verification. Whole-plan acceptance remains **18/65**.

### 2026-09-06 · Protected hosted own-file canary verified

Candidate `dpl_9W634MRCEadvBBvoB4tHg5KhEU5p` at `9ffb68a` runs the unchanged
`8166c3b` runtime. Its custom preview environment uses selected production app
configuration without worker/mail credentials; public aliases and active cron
jobs remain on PR75. No private upload signing key was retrieved.

One fresh synthetic account completed real UI declarations/consent, two native
restricted Storage uploads (972 bytes total), finalization/preparation, explicit
trait-report choice and source-backed personal findings. Both original downloads
matched; selecting one file for deletion preserved the other and its useful
report. Desktop/mobile visuals were inspected. Independent database/Storage
checks confirmed source/revision/grant/analysis bindings and exact cleanup,
with no unchosen analysis, ancestry, mail or workers.

A second bounded run verified eight explicit restricted-token refusals with an
independent unchanged-state SQL checkpoint, followed by the same-token successful
upload and exact third-file deletion. Real report withdrawal changed direct
owner PRS reads from three rows to zero while preserving the raw download and
rendered source region. Final database checks confirmed cleanup and revoked
analysis. One expected revoke-purge job remains queued/unstarted; one unused
object-free lease retains its normal expiry/cleanup deadline. A first checkpoint
timeout is recorded as setup failure, not hidden as a passing test.

This closes the first real hosted signer/Storage and two-file journey checkpoint.
It does not release the canonical app on the public domain or prove the complete
restricted authorization matrix. Operational review found that no current worker handles the queued
`revoke_purge` job, despite inline analytic cleanup succeeding. Next: implement
its exact-purpose manifest/executor, canonical export content and the actual
Storage setup for full standard regressions in separate worktrees. Required
notices and broader product behaviors remain release blockers. Existing generic file labels and tiny-size rounding remain
usability limitations. Whole-plan acceptance stays **18/65**.

### 2026-09-06 · Signing activation and compatible hosted schema verified

The owner activated the replacement signing key and retained the older keys.
Twelve compatible migrations are now staged in hosted Supabase. Independent
poststage checks confirmed exact SQL-body hashes, current consent artifacts,
service-only public RPCs, private-table RLS and the unchanged legacy staging
policy. Temporary tiny-file capacity is configured; canonical source rows remain empty. This
closes activation and compatible-schema prerequisites, not the hosted journey.

Generated Vercel deployment URLs now require authentication; public custom
domains retain the PR75 release. The candidate source is frozen at `8166c3b`.
A protected custom preview environment now isolates scheduled jobs and shares
only necessary app configuration. Its first deployment was blocked before build
by the machine-only Git author email; a documentation-only attribution update
is prepared. Next: a successful candidate build and two tiny synthetic files
through real hosted authorization, Storage and rendered results. No hosted
signing-success claim has been made yet.
Acceptance remains **18/65**; recurring retention, required notices and broader
journey regressions still remain beyond this canary.

### Current local rollout prerequisite: verified pause and recovery

At `9b45b75`, all 24 selected actual-provider browser cases pass with 18
uploads and zero skips/retries; desktop/mobile layouts were inspected. The
unchanged runtime passed 2,661 units at `a8d82b5`. New canonical issuance can
be paused while an acknowledged source still finalizes, prepares and downloads,
preserving another file. The server-only cron GET adapter also passes its
credential/body/selector refusal and unchanged-worker delegation tests.
Neither capability is hosted verification, and the adapter has not invoked
the composite production retention worker. PR75's separate legacy bridge is
now released as recorded below. Signing activation and compatible schema staging
are now verified above. Acceptance remains **18/65**.

### 2026-09-06 · PR75 production transition bridge verified

PR75 merged at `a7d5a8e6ac827beb2db464e4dbe34b2bfed8507b`, deployed as
`dpl_GdFqNrewbxF28SCT23LuR5qwxGVJ` on both production aliases. Corrected CI
`34050146592` passed 2,236 units, 220 browser cases with zero skips/retries,
and database/build/repository gates. The new case proves real staged bytes
can complete, process and download while new legacy issuance is refused.
Independent local desktop/mobile pause visuals and no-lease/no-Storage refusal
checks passed on the unchanged release runtime.

Authenticated live `/files/upload` and `/files` show an enabled picker after
deployment: the default-off behavior is verified. No hosted pause was enabled,
no Storage policy was removed, and no real file was changed. The broad canonical
branch remains local; this release supplies its compatible transition control.
Acceptance stays **18/65**. Signing activation and compatible schema staging
are verified above; the
capacity/authorization canary, recurring cleanup, report-ready notifications
and remaining regressions still prevent calling the own-file milestone delivered.

### 2026-09-06 · PR73 released

PR73 (`a6b68a9d79e2901d9665cc2a4b5a4bcb58c489bc`) improves milestone 2:
clear empty search/results-only filters, restore search focus, and retain the
same filters on browser Back without putting the search in a URL or persistent
browser storage. CI run `34038938075` passed **219 browser cases, no skips or
retries**, plus its unit, database, build and repository gates. Vercel reports
production deployment `dpl_8J7MvprofssBdKKqGJvdVcPjQ2cz` READY on that exact
commit, with `www.inherit.bio` assigned. This is a deployed usability slice,
not completion of another whole-plan gate: acceptance stays **18/65**.

### 2026-09-06 · Local MVP journey verified, not released

Milestones 1–2 now have an integrated actual-provider browser receipt at
`bc31011`: **4/4 cases passed, no skips or retries**, with three actual uploads.
This includes independent report choice, a real source-backed MCM6 finding,
filter/Back recovery, withdrawal, retained raw-data browsing and exact original
download. Overview offers the report-choice entry before generation, shows
covered starter links only after generation, and removes those links after
withdrawal. Only ready report layers have counts; no genotype or personal
interpretation is serialized by Overview. The full unit suite passes
**2,602 tests in 163 files**; secret and readability gates pass. See
[the local receipt](local-upload-browser-verification.md) for exact scope.

This advances milestones 1–3 locally, but does not prove the two-file deletion
journey or hosted deployment. It is not part of PR73. Hosted signing/capacity,
scheduled retention and the migrated full browser regression remain release
prerequisites. No additional whole-plan gate is claimed; acceptance is **18/65**.

### 2026-09-06 · Own findings and two-file controls verified locally

At `784efbf`, **5/5 browser cases** pass with five actual provider uploads,
zero skips/retries, including the previous four journeys. Own starter reports
now precede Family/Embryos. Prepared-file rows link to report choices. Two
conflicting sources download exactly; after a visible simulated HTTP failure,
the real deletion retry removes only the selected source and its derivatives,
preserves the other source's exact rows/bytes and restores its useful finding.
See the local receipt for the distinction between UI failure injection and
real provider deletion. Desktop/mobile layouts were inspected.

Milestone 3 now has local two-file evidence, while hosted signing/capacity,
recurring cleanup, source provenance and migrated regressions remain. The
Overview ordering can be released separately on PR73 without importing the
upload cutover. This does not close another broad gate: **18/65**.

### 2026-09-06 · PR74 production and expanded local report proof

PR74 is merged at `ed0bdc257ff5e515b0c182c966b1a7728a744e5b` and deployed as
`dpl_DRBcMWz4mqNXNPjbhiBqSgpVkYZF`. Authenticated production Overview was
read after deployment: My Genome → five starter reports → Family → Embryos.
CI `34046637446` passed 219 browser cases without skips/retries and 2,221
units plus the database/build/repository gates. This isolated ordering release
does not include the canonical upload branch.

Locally, `5d755c9` passes all 2,619 units and 23 actual-provider browser cases
with 16 uploads, zero skips/retries. Source conversion and listed-call rates
now use recorded canonical metadata under exact authority. Study scope,
sensitive reveal/SSR denial, previews, two-file controls and withdrawal all
pass; desktop/mobile source explanations were inspected. See the local
receipt. This closes a local provenance prerequisite, not hosted reliability.

Acceptance remains **18/65**. Next: a compatible upload pause/drain transition,
hosted signing/capacity canary and recurring retention verification. Required
report-ready mail, remaining legacy regression integrations, ancestry,
other-adult and embryo positive paths still need their own complete evidence.

Report: the user-visible outcome; merged/deployed/locally tested status;
which milestone advanced; exact G gate IDs newly proved (if any); and the
next user-visible blocker. Keep **18/65** until a complete gate has its actual
required proof. Do not equate PR, test, migration or report counts with a
whole-project percentage.

## Evidence inspected

- `docs/acceptance-matrix.md`: G1–G8 ledger and PR72 scope.
- `docs/route-register.json`: `analysis-eligibility-v1`, canonical report paths.
- Original plan attachment: G1.12–G1.17, G2 and G3 requirements, read alongside
  the canonical register and overriding ADRs rather than replacing them.
- `src/app/(app)/genome/[subject]/reports/page.tsx`: authorized library,
  preview-first ordering within categories, separate layers, input provenance.
- `src/components/reports/report-library.tsx`: local filtering; missing clear
  action at audit time. Browser-back preservation requires a runtime receipt.
- `e2e/report-previews.spec.ts`: actual covered/uncovered preview assertions.
- `e2e/file-deletion.spec.ts`: exact source/derivative deletion, failure/retry
  and foreign-account guards. Its ingestion helper must migrate with the new
  upload API before this branch can claim a fresh passing deletion run.

No hosted project, real account, genome file or acceptance status changed in
this audit. The proposed sequence does not waive any legal or safety gate.
