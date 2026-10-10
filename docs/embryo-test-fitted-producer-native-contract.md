# Fitted synthetic TEST producer — source draft, 10 October 2026

This is an invented algorithm experiment. It supplies a real fitted artifact and uncertainty calculation to a separately admitted TEST pipeline. It supplies no clinical model, human sibling evidence, jurisdiction activation, recommendation or release qualification. Every native and browser control below is authored and **UNRUN** at this draft.

The unchanged population source is `data/embryo/test-statistical-fit-population.json`, SHA256 `5355327cfe90cda24ca2d27cd3afab2e53d26b5d6995b69cb296d3b975c6d408`. Its disjoint invented groups are 64 training rows, 48 holdout rows, 96 reference rows, 32 arbitrary paired controls and 200 binary calibration rows. The unchanged ten-row score panel has SHA256 `c08fcfea75896e134cfc68ac844bedc0f5aa3b7a4b5623d97806297978df984f`. No scientific citation or clinical registry entry is created.

## Admission and migration safety

Migration `20261010155222_embryo_test_statistical_fit.sql` adds four nullable columns to the existing protected-excluded `private.embryo_test_statistical_admission`: `fit_artifact_sha256`, `fit_artifact`, `fit_package`, and `fit_package_digest`. All four default to NULL. The existing unconditional UPDATE/DELETE refusal and owner-only privileges remain. No new table, registry entry or deletion/export disposition is needed. The existing table remains protected excluded data; no prior export classification changes.

The migration installs no admission row and never upgrades an old row. Default absence and an older coverage-only admission both deny the fitted producer. The original installer retains its complete clean-source, runtime, owner, cluster/system identifier, database, container, network, complete migration ledger, empty queues/users/subjects/files/grants, disabled split and unconfigured object-provider checks. It additionally reads the exact invented artifact bytes, compares the complete independently calculated app and PostgreSQL package and digest, and inserts all fitted fields in the original owner transaction. App, worker and API roles cannot initialize or change this row. There is no caller-selected artifact, model or admission flag.

The original coverage admission projection is preserved by one predecessor-body-guarded return-expression change: subtract only the four new columns from `to_jsonb(a)`. All original predicates and output fields remain. Therefore coverage-v1 reference/capture/receipt values do not acquire new NULL fields. The fitted admission first runs that original validation, then reads the immutable full row and independently recomputes its entire package and digest.

The original score dispatch receives one predecessor-body-guarded fitted branch. Its entire old carrier, NULL-receipt, coverage-v1 and immutable-update logic remains. The existing closed receipt constraint additionally admits the distinct fitted syntax; the native score guard independently verifies its complete receipt. No clinical finding constraint is weakened. Existing coverage-only scores are never changed into fitted or clinical scores. A separate trigger preserves fitted job payload/owner/file immutability.

## Numerical representation

Fitting and interval intermediates remain unrounded double-precision values in fixed input/loop order. Both engines use the unchanged pure algorithm: centered 11-parameter ordinary least squares, complete coefficient covariance with 53 residual degrees of freedom, complete ten-position reference covariance, deterministic 256-resample holdout interval, and Wilson baseline from the invented binary controls. The paired controls explicitly remain invented pairs, not human siblings.

Every fitted floating output is encoded once as a decimal string with exactly nine fractional digits. For finite `x` with `abs(x) < 1000000`, compute `units = floor(abs(x) * 1000000000 + 0.5)`, refuse `units >= 1000000000000000`, and emit the sign only for a nonzero negative result, followed by `units / 1000000000` and a zero-padded nine-digit remainder. This is half-away-from-zero rounding with normalized negative zero. Integer metadata such as counts, degrees of freedom and sample ordinals stays integer. Native save and read compare the complete canonical values exactly; no epsilon, guessed JSONB object digest or numeric tolerance admits a result. Cross-engine disagreement refuses installation/save/read.

The complete canonical package retains the unchanged pure package keys and all false/NULL clinical and sibling fields. Only its floating leaves become fixed-nine strings. Its SHA256 projection is compact UTF-8 JSON for this explicit ordered array:

```
[version, fit.coefficients, fit.covariance, fit.residualVariance,
 holdout.r2, holdout.interval, reference.centers, reference.covariance,
 baseline.point, baseline.interval, internalInventedPairControls.r2]
```

All projection leaves are strings or arrays; separators contain no whitespace. PostgreSQL recursively encodes the same strings and arrays. The digest establishes correspondence, not source or runtime authority: the entire artifact, full package, current runtime admission and actual own calls must also match independently.

## Native doors and exact envelopes

The old coverage-v1 public doors stay unchanged. The new service-role-only doors are:

| Door | Arguments | Result |
| --- | --- | --- |
| `enqueue_embryo_test_statistical_fit_v1` | `p_cohort_id uuid, p_test_jurisdiction boolean` | Original queued/held envelope; distinct fitted revision |
| `embryo_test_statistical_fit_worker_v1` | Original `p_operation, p_job_id, p_attempt, p_claim_token_hash, p_payload, p_test_jurisdiction` | Fitted claim/check/calls/save versions below |
| `current_embryo_test_statistical_fit_v1` | Original `p_account, p_session, p_cohort, p_test` | Complete current fitted TEST DTO or NULL/refusal |

The job retains `kind = score_embryo`, `output_kind = embryo.statistical-estimate`, and complete cohort source binding. Its distinct `computation_revision` is `embryo-test-statistical-fit-v1`. The capture wraps the original full native cohort capture after every original authority/source/QC lock and predicate. Its version is `embryo-test-statistical-fit-capture-v1`; original `cohortId`, `publicationRevision`, `panel`, `authority`, `conditions` and `embryos` remain. Only the one fixed condition's `reference_receipt` becomes the full fitted admission; `fitArtifact`, `fitPackage`, and `fitPackageDigest` are added.

Claim/check/calls retain every original field with distinct versions `embryo-test-statistical-fit-claim-v1`, `embryo-test-statistical-fit-check-v1`, and `embryo-test-statistical-fit-calls-v1`. Read still selects the complete actual own calls from current native source rows. No caller supplies a reference subset. The original attempt, claim-token, deadline, cancellation, reconciliation, current full-capture equality and complete cohort save bounds remain.

Save accepts exactly `{ measurements: [...] }`. In original capture order each row has exactly `embryoId`, `conditionId`, `measurement`, `finding`, `reason`, and `result`. Native code independently recomputes every whole row from the immutable complete artifact and current actual own calls, compares the entire array, and lets the existing score trigger recompute the full receipt again. The saved response is exactly the original `{ status: saved_held, jobId, attempt, captureSha256, saved }` envelope plus `publication: synthetic-fitted-test-only`.

The fitted receipt has the original eleven fields (`version`, `producer`, `job_id`, `attempt`, `capture_sha256`, `condition_id`, `source`, `reference_receipt`, `measurement`, `publication`, `interpretation`) plus `clinicalPublication: false`, `fitPackage`, and `fitPackageDigest`. Producer is `embryo-test-statistical-fit-v1`; publication is `synthetic-fitted-test-only`; interpretation is `held`. `measurement` is the complete six-field expected row, not a caller-selected scalar.

## Coverage, QC, intervals and current read

Below 0.80 observed own-call coverage, `result` is NULL and the original OBSERVED coverage-failure finding remains. Original file QC, parent concordance, contamination and dropout refusals remain separate nonnumeric states. At/above the floor a valid toy result is separate from the clinical `finding`, which remains NULL; persisted `coverage_state` remains `not_covered` and `not_covered_reason` remains `sex_combined_model_unavailable`. This preserves the original score-table consistency and clinical hold.

The separate result contains exactly `version: 1`, `kind: synthetic-test-probability`, MODELLED `figureBasis`, OBSERVED `coverageBasis`, `point`, `interval: [low, high]`, four named `varianceComponents`, `totalVariance`, `dropoutMultiplier`, `logPoint`, `logBounds`, the fixed `withinFamily` record and `clinicalPublication: false`. All floating leaves are fixed-nine strings. Unavailable own calls are zero-centered without invented allele dosage and add their complete covariance to missing-coverage variance. Unmeasured dropout uses the unchanged canonical 1.5 multiplier; measured dropout uses 1.

Current read retains original live account/session, Tier-2, grant, complete publication and source/QC checks. It selects only an exactly bound finished fitted job and independently re-evaluates all embryos/receipts/current own calls. NULL is allowed only for absent fitted admission, or a cohort with no fitted job after all original live authority/capture checks succeed. An existing fitted job without an exactly current completed result, denied authority/capture, or missing/extra/stale/altered rows raises the fixed `42501` refusal. This prevents coverage-v1 fallback from concealing a denied or stale fitted result. The complete outer DTO retains the original version/cohort/publication/job/attempt/capture/jurisdiction/held fields, adds `publication: synthetic-fitted-test-only` and `clinicalPublication: false`, and uses the fitted producer discriminator. Every original row field remains; `result` and full `receipt` are added.

Every package/result carries sibling `status: not_measured`, `enabledByDefault: false`, and NULL `betaRatio`, `interval`, `familyCount`, and `citation`. Neither synthetic fitting nor its TEST rendering supplies human sibling evidence or production/clinical authority.

## Authored proof scope

The new native test file checks default admission/ACL refusal, canonical decimal controls, complete-artifact tampering, real native fitted covariance and normal equations, full package digest recomputation, own-call coverage, missing covariance, full-file QC, dropout and foreign/disputed source refusals. These are pure/default-boundary controls, not an admitted current cohort or positive publication proof.

The separately authored second-cohort browser journey must preserve the first complete journey graph, upload the fixed partial VCF through the original two-parent consent/upload/split/publication path, finish the real fitted worker, and obtain the exact native current read on all three surfaces. Its eight panel positions and 1,200 unchanged neutral rows distinguish 8/10 statistical coverage from passing full-file QC. Direct score insertion or a fixture grant shortcut does not qualify. Actual installer/claim/save/current-read/browser execution, cross-engine canonical equality and complete G4.2 closure remain UNRUN; G4.5 and clinical/human sibling validation remain held.
