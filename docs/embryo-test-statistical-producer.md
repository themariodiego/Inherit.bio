# Synthetic statistical coverage: native source boundary

10 October 2026. Authored source only. No installer, native producer, reference
admission or publication has run. The carrier-library draft remains separate.

The first producer implements brief §3.3's original score coverage fraction:
usable matched score rows divided by the complete score panel. Below 0.80 it
can produce only the existing `coverage_failure` finding. At or above 0.80 it
produces no model result. This does not implement the partial-coverage fitted
predictor, does not reinterpret file QC, and does not change a scientific
acceptance row to YES.

The ten-row panel is entirely invented, fixed GRCh38 autosomal SNP reference
data. Its complete source bytes are
`data/embryo/test-statistical-score-panel.json`, SHA-256
`c08fcfea75896e134cfc68ac844bedc0f5aa3b7a4b5623d97806297978df984f`.
Its version is `embryo-statistical-test-panel-v1` and its only condition label
is `SYNTHETIC:9001`. It has no weights, frequency, clinical calibration,
penetrance, risk or interval. The pure matcher grants no source or reference
authority. The real compiled `allowed_conditions.json` stays byte-identical
with an empty `conditions` array.

## Existing authority to retain

`private.capture_embryo_carrier_v1` in migration
`20261002132000_embryo_observed_carrier_producer.sql` is the source of the
native cohort, parent grants, direction, live accounts, jurisdiction
attestations, signed statement/artifact revisions, retention, canonical whole
source, member-part digest, normalization revision and complete QC checks.
Those predicates and locks must remain complete in the new statistical
capture. Its carrier activation/review reference block cannot be used to
pretend the invented panel has clinical approval.

The existing `p_test IS TRUE` and enabled `private.embryo_split_config` checks
are required but insufficient environment authority. Neither identifies a
disposable database. `isTestJurisdictionEnabled()` is only an application
environment flag. A client may not select a reference, condition or allow flag.

## Empty native admission

A new owner-only private singleton table contains no row after migration.
It has RLS enabled, all grants revoked from PUBLIC, anon, authenticated,
inherit_upload_only and service_role, and an unconditional UPDATE/DELETE
refusal trigger. No API or worker role receives an INSERT door. The row binds:

- version, fixed panel ID/version, complete panel JSON and exact source-file
  SHA-256;
- actual `pg_catalog.pg_control_system().system_identifier::text`, database
  name/OID and server version;
- actual source HEAD, complete migration/config source hashes, Docker daemon
  ID, DB container ID, project `sequence` and private network identity;
- runtime kind plus exact owned supervisor nonce/proof digest, or exact
  GitHub run/attempt/job and protected isolated-runtime owner identity.

PostgreSQL's control identifier is cluster-wide, from the control file;
database name/OID also binds the selected database. It is observed inside
the exact DB container, not supplied by the caller. See the
[PostgreSQL 17 control-data contract](https://www.postgresql.org/docs/17/functions-info.html#FUNCTIONS-PG-CONTROL).

The only installation is a fixed owner `docker exec -i supabase_db_sequence
psql -XAtq -U postgres -d postgres --set=ON_ERROR_STOP=1` transaction. It locks
and rechecks the empty admission and relevant queues/configs, observes native
cluster/database identity, then inserts one fixed reference. It refuses an
existing row, mismatch or uncertain attempt; no UPSERT, overwrite, arbitrary
target URL, owner-review record or fixture grant exists. The database is
disposed through its original owned lifecycle; the installer does not erase
or disable a retained admission to recover uncertainty.

## Installer admission using existing runtime ownership

For owned Linux, reuse `assertOwnedLinuxSource()` and the existing admitted
capability (WeakMap plus live UID/GID/boot/supervisor/lease/challenge/socket
checks). Run only after `acquireFreshStack()` has proved the empty daemon,
created distinct resources under its exclusive lock, captured exact config
and all migration bytes, and verified the complete native ledger. Use its
captured resource identities; recheck them before and after the fixed SQL.
Do not mint a capability from JSON, environment strings or an old receipt.

For the normal browser job, reuse `assertCiRuntime()` and
`startCiBrowserRuntime()`'s actual protected owner receipt, exact checkout
mount, DB/storage/gateway network ownership, prepared image, build/source
receipt, isolated policy/TLS probe and unprivileged UID. Require the actual
`browser` job's nonempty run/attempt/source identity, full nonignored source
cleanliness and local-only project configuration. The point of installation
is after the actual runtime preflight, before any browser test child starts.
Reference seeding may already have occurred, but Auth users, cohorts,
subjects, genomic files, consent grants, worker jobs and split/canonical work
must still be empty. Recheck exact DB container identity and complete native
migration ledger against current source.

This normal-CI route uses the existing actual job/runtime/container admission;
it is not a signed OIDC attestation. The existing signed
`attestFreshT6Workflow()` is specifically scoped to the separate
`participant-c-smoke.yml` workflow and cannot be claimed for `ci.yml`.
The reviewed engineering design uses this existing actual normal-CI admission;
it does not require or claim an OIDC issuer proof for `ci.yml`. Owned Linux
uses its separate authenticated capability. No default local Mac or Vercel
preview route is admitted.

## Native producer and current read

New statistical capture/claim/check/save/current-read functions first require
the exact admission row and current cluster/database identity, then the
unchanged split/test, parent/session/Tier-2/current source/QC predicates.
Only owner installation admits the fixed complete panel; API parameters never
contain panel JSON, registry overrides or an allow switch.

The worker reads each embryo's actual canonical calls at all ten panel rows.
Native save independently recomputes the complete matcher and requires whole
capture equality, running claim token/attempt/deadline, source revision and
complete embryo set. A new closed receipt family is explicitly statistical;
it cannot pass as a carrier receipt. The existing carrier fence remains exact
for carrier and NULL legacy rows. Statistical rows are immutable and only
enter under the complete native save, never a direct test score INSERT.

QC failures retain their original QC refusal and no fabricated source/count.
Below-floor eligible embryos expose only matched/required fraction plus the
original insufficient-coverage copy. At/above-floor embryos remain held for
the absent fitted predictor. The app's three surfaces may read this fixed
synthetic coverage through a separate strict current native DTO, labelled
synthetic TEST data; they may not broaden the compiled clinical registry.

Every capture/save/current-read rechecks the row. Default production and
hosted preview refuse because migration creates no admission and their
installer path is unavailable. A privileged database owner can change the
database; no claim of protection from its owner or owner-made cluster clones
is intended.

## Written source and actual proof scope

- Fixed panel, pure matcher and focused test (written; 43 distinct controls
  passed, including the genuine first-run test-wrapper failure and correction).
- One authored migration for admission and the explicitly statistical native
  receipt/worker/current-read contract, preserving carrier and source gates.
- Written installer integration at the existing isolated runtime preflight;
  owned Linux and the reviewed normal-CI route only.
- Written statistical worker/read/projection and three surface additions,
  with strict input/refusal controls and no clinical model output.
- Authored native controls and real upload/parent/native worker browser extension;
  publication proof requires the actual statistical worker/current read,
  not the split worker alone. No fixture grant, direct score seeding, service
  start or native run is authorized in this source checkpoint.

The bounded 10 October unit group passed 41 cases in four whole files: worker
(13), current read (20), native-source/installer ordering controls (5) and
figure contract (3). Together with the earlier 43 distinct pure controls,
84 scoped cases have passed. These are unit/source controls, not SQL or
browser execution. The first pure run's four test-wrapper failures remain
preserved; its corrected four cases passed separately.

After the bounded group, the source added explicit native JSON-string refusal,
an admission-before-current-read check and closed aborted/failure-write error
handling. The complete changed-file group subsequently passed 54 cases in four
files: worker (15), native source (5), component (5) and runtime lifecycle (29).
Together with the earlier unchanged pure/read/figure cases this is 120 distinct
scoped cases across seven files. No single-run 120-case claim is intended.
Route type generation and full app type checking passed; the original compiler
control-flow narrowing failure and corrected worker check remain preserved.

Native SQL controls, actual admission installation, native claim/save/current
read and all three new browser route-state audits remain UNRUN. At the first
source checkpoint, lint, discovery and final source gates were also UNRUN
while Root owned the active native smoke. Subsequent local qualification is
recorded in the ordinary saved check results, including genuine failures and
their narrow corrections. This branch stays separate from the currently
tested release and its real empty clinical registry.

The first scope can exercise three not-covered states. The other three
partial-coverage states need the separate entirely synthetic fitted
predictor/reference-population and valid interval fixture. They remain
unimplemented here; thresholds, prompts and clinical holds remain unchanged.
Their next source milestone is an immutable invented training/reference
population, deterministic fit and complete coefficient/covariance package,
explicit combined-sex synthetic baseline/birth cohort/calibration count and
strict interval transform. Missing own calls must add the brief's
coverage-adjusted variance rather than use parent/sibling imputation. Unknown
dropout must retain the registered widening. No invented sibling-validation
claim can enable a row: not-measured remains disabled by default. Only after
that pure package is validated can the same dedicated disposable admission
and complete native worker/current read publish a synthetic modelled fixture
for the three partial-coverage audits. Clinical approval remains separate.
