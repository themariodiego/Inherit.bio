# Result input provenance (G4.6)

The result remains readable when historical quality facts are missing. A file
being absent from a position is not a negative finding, a reference call, or
proof that a laboratory did not test it. No genotype or missing quality number
is inferred. This work does not change carrier, ancestry or PRS arithmetic.

## Processing contract

The Tier-1 owner processing route atomically claims an eligible non-active file
with a fresh `processing_run_id`. A second request cannot fetch source bytes or
replace derivatives while the first is active. Completion and failure require
the exact run UUID and `parsing` state; completion must return the affected row
before success or readiness mail. There is no timed takeover of live I/O.

The route clears old provenance before reading source bytes. The SHA256 covers
the actual stored byte stream, including compression. The decoded stream is
observed once using the same array tokenization/row classifier and literal VCF
call classifier as the parser. Counters distinguish called and missing supported
point records, unsupported rows, failed source filters and interval records.
They describe listed records, not unique genomic positions or assay coverage.
Readable literal diploid SNPs do not need an rsID to count toward file quality.
The report-observation wrapper still requires one; this does not expand report
matching, variant-only inputs or reference-call inference.
Ambiguous/multi-sample VCF structure has no one-sample read-rate claim.

The snapshot records source-build declaration versus format assumption, target
build, the exact conversion-chain digest where used, and mapped/unmapped variant
row counts. A source header is a declaration, not an independently verified lab
fact. Completion persists snapshot, digest and completion timestamp together.
Readers require the matching version, digest, annotated state and equivalent
timestamp instant; malformed or historical metadata renders unknown.

The three nullable columns live on `genome_files`: no new data store or retention
clock. Client mutation is denied by grants and a trigger even under a simulated
future grant regression. Failure and deletion preparation clear the snapshot.
Existing exact-file and subject deletion remove the columns with their file.
No historic files are automatically reprocessed; retained-source owner reruns
use the existing processing route. A derivative-only backfill cannot recover
lost source counters, source-build declaration, chain identity or source hash.

## Surface inventory

| Surface | Exact input binding and visible treatment |
| --- | --- |
| Adult report detail | Authorized ready files checked by the report resolver are distinct from files supplying records; absent, no-call and conflict states remain separate. Visible source facts and per-report interpreted/required position coverage stay inside the six-heading body. |
| Report library previews | Each eligible preview points to its exact source-file set and own position coverage in a shared, always-visible on-page section. Filtering does not remove source facts or turn an unrelated file into a contributor. Only existing preview text/qualifier crosses the card boundary. |
| Ancestry | Each stored admixture/maternal/paternal row uses its own `file_id`, not a global latest file. Stored model identity/version are retained. Unknown historic models do not acquire current panel denominators, populations or tree identity. |
| Family health picture | Each authorized displayed row names its own observed-file set, including disagreement; checked-only files remain explicit. Per-adult source facts remain visible under the existing certainty heading. Original genotype/conflict and coverage arithmetic are unchanged. |
| Portrait | Each adult is visibly named above their file facts; per-gene observations distinguish adult/source sets. The carrier long-run input set is tracked separately from genotype observations. No result is fabricated when the classified reference set is unavailable. |
| Expert Data | Stored PRS coverage binds to each row's actual `file_id`; one shared source section lists the exact file mapping. It does not expose withheld scores or manufacture a percentile. |
| Expert Browser | The displayed table's actual source files are distinct from checked files and from the region track's chosen file. Visible provenance appears below the table/track without changing the primary viewport or inferring missing genotypes. |
| Embryo compare/detail | Authorized cohort+ordinal published files yield a closed source-facts DTO; incomplete source sets yield unknown. Inherit's no-imputation policy is distinct from unknown upstream processing. Existing laboratory QC remains unchanged and visible in its existing role. No embryo writer is enabled. |

Source views contain only bounded display facts: never source paths, original
file names, hashes or raw header metadata. The caller authorizes subject and
purpose before metadata loading. A missing metadata row or failed batch returns
an unknown placeholder for each requested authorized ID; metadata failure does
not renew authority or suppress an independently supported result.

## Verification scope

Parser identity tests cover all four array formats, malformed quotes and row
shapes, explicit/missing/failed-filter VCF calls, repeated/multi-sample headers
and interval anchors. Loader tests cover more than two batches, exact subject
filters, partial/error responses, digest/completion matching and legacy facts.
Route tests cover concurrent claims, stale completion/failure, byte hashes,
conversion, idempotent reruns and derivative replacement failures. Rollback-only
SQL tests prove completion constraints, client denial and actual file-deletion
integration. Page tests exercise multi-file, absent, conflicting and exact
per-score attribution. Production browser tests are recorded with their actual
outcome in the test-diff register; acceptance is not inferred from a footer alone.
