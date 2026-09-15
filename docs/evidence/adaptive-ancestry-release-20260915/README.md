# Adaptive ancestry release verification

Status: release candidate implemented; final database boundary checks, full
clean-tree units, fresh-database browser/CI, merge and hosted verification pending. This
record is not release approval or a new acceptance-gate closure.

## Scope

The owner decisions were committed before implementation (`f8571e1`). The
reference generator was committed next (`2c465ee`), followed by the generated
table and provenance (`8b3f2bc`). New analyses use seven reference regions and
strict unrounded shares above 0.10 to trigger an all-three EUR/MID/CSA row. A
closed disclosure reveals the uncertain components. Captures, display and
exports retain the mixed-ancestry caveat.

Historical five-region estimator, region registry and geometry remain unchanged.
Readers accept saved revisions 1/2/3 and dispatch the new view only for its exact
reference version. The initial 168-marker normal-display policy comes from the
versioned region registry; partial derived rows remain under the unreliable-raw
disclosure and zero-marker captures contain null proportions. There is no tested
seven-region confidence range.

## Scientific evidence

The production-fitter evaluation and subgroup limitations are recorded in
`data/ref/AIMS_SEVEN_REGION_PROVENANCE.md` and the adjacent measurement JSON
under `scripts/ancestry-resolution/`. All 7,800 main fits converged. The full-panel
held-out accepted rule merged 329/1,560 synthetic draws (21.09%); its top-row
agreement was 96.54% with 10/4/2 wrong-row tail counts. Population-present figures
are the ceiling, not the expectation. These are conditional simulation results,
not accuracy or prevalence estimates for real readers. D-122 remains open for
the scientific ambiguity and unequal loss of detail.

## Review and local checks

- Automated independent review checked estimator arithmetic, saved-version
  compatibility, authority rechecks, database validation and presentation. It
  found and fixed v3 lineage-consistency and coverage-roundtrip mismatches.
- Initial new database contract: 86/86 pgTAP checks. Unchanged historical canonical
  ancestry integration: 86/86. Actual TypeScript writer→schema→SQL captures
  passed at 0/1/167/168 markers. All ran inside rolled-back local transactions.
  A final review then aligned SQL's strict merge comparison with JavaScript's
  floating-point parsing. Five boundary decisions and ten full-schema checks
  pass in JavaScript; ten additional SQL assertions await fresh CI because
  local Docker returned stopped-container/runtime I/O errors. No restart or
  unrelated-container change was attempted. The earlier SQL counts do not
  certify this final change.
- Reference generation is deterministic; its 14 reference/rule/artifact checks
  pass. New presentation/component/geometry checks pass 18/18, with 42 related
  new/historical checks passing. A final focused run passed 173 checks across
  11 estimator, capture, reader, export and presentation files; full-suite
  totals will be attached after the clean-tree run.
- Full typecheck and lint pass. Readability, claims, routes, names, secrets,
  legal-source, first-glance, templates, environment and jurisdiction gates
  have been checked; final staged-tree checks remain part of the release run.
- The current local browser databases lack required upload/checkpoint/purpose
  RPCs and contain unrecorded migration applications. A broad migration replay
  could overwrite later installed behavior. No reset or local disposable
  override was used. Fresh CI must prove the actual browser journey.

The two new browser scenarios cover combined/separate real upload and analysis
flows, keyboard disclosure, mobile overflow, figure attribution and withdrawal
that preserves the source. Existing ancestry browser checks retain their
geometry, sum, focus, access and label contracts; their reference-specific range
assertion now requires explicit unavailability for v3. This is not permission
to fabricate intervals or weaken the historical component tests.

## Still required

Attach the reviewed implementation commit, clean unit/static outputs, fresh CI
run, migration receipt, exact deployed commit and hosted checks. Inspect browser
captures and built client bundles before claiming the new surface verified.
G4.4 was already YES and needs regression evidence; its status does not increase
the gate count. G5.5 remains a required human review. WGS capacity, automatic
recovery, deadline delivery and Family's separate ancestry reader are outside
this release's proof.
