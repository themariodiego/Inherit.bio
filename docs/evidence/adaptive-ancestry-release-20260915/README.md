# Adaptive ancestry release verification

Status: release candidate implemented; full clean-tree units and component
browser review pass. Final database boundary checks, fresh-database journey CI,
merge and hosted verification remain pending. This
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
  suite at `64ab970` passed 5,040 tests across 301 files, with no skips.
  The earlier run exposed a stale report-choice assertion and blocked email
  capture because ignored runtime files were present. The assertion now states
  the implemented lineage coverage limit; the runtime files were preserved
  outside the checkout. No guard, timeout or assertion was weakened.
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

## Component browser review

The actual new component and stylesheet passed 24 Chromium checks and four
touch-emulation checks at 1280×900 and 390×844. The checks cover both merge
branches, exact caveats, native disclosure, map keyboard and outside-click
focus, filter behavior, all share attribution, 1/167/0-marker states, overflow
and external requests. Review fixed missing muted continents under the filter
and lost focus after outside clicks. The filter now describes hiding small
estimates without implying validated confidence. After the map correction,
33 focused new/historical checks passed; the final component's eight checks
and touched-file lint passed again after the focus and wording changes.

Four inspected synthetic screenshots and source hashes are retained in
[`component-review/receipt.json`](component-review/receipt.json). This harness
uses local Arial/Georgia fallbacks and does not certify production fonts,
physical devices, the authenticated journey or the final Next client bundle.
Its 246,558-byte client bundle contains no estimator or marker-table input.

## Still required

The first PR run, `34965226260`, stopped at TypeScript validation before SQL
or browser execution: the generator passed generic coordinate arrays to a
library requiring two-number tuples. The generator now validates and converts
those coordinates explicitly. Nonincremental TypeScript and generator lint
pass; regeneration preserves the exact 54,102-byte geometry and manifest.
The failed run remains evidence, not a completed journey check.

The next run, `34965659515` at `2ebbf6c`, passed TypeScript and lint but failed
two exact-byte synthetic-fixture checks: the gzip compressor recorded a
different host OS byte on Linux. Both fixtures now use the unspecified OS byte;
only that metadata byte changes. Complete-byte assertions remain unchanged,
and all four focused fixture/pipeline tests pass.

The corresponding Vercel build stopped at the reference integrity check.
An isolated Next.js 16.3.3 production build reproduced 122 changed frequency
doubles in the JSON import, with key order unchanged. The generated runtime
JSON string now preserves the original decimal text through bundling. The
table, manifest hash, version and measured reference inputs are unchanged.
The isolated build now initializes the actual v3 capture module, retains the
exact table hash and produces the same complete synthetic fitted result as
native execution (SHA-256
`e15dbcd0606c5cece86660c9151092242ec9700d0c45d383aeafd966e9b2a9fd`).
Its 168-marker result converges in 435 iterations. Twenty-one focused tests,
generator checks, scoped lint and nonincremental TypeScript pass. This probe
does not replace the full application build, fresh SQL tests or browser suite.

Attach the final reviewed commit, fresh CI run, migration receipt, exact
deployed commit and hosted checks. Inspect the built Next client bundles and
actual authenticated journey before claiming the release verified.
G4.4 was already YES and needs regression evidence; its status does not increase
the gate count. G5.5 remains a required human review. WGS capacity, automatic
recovery, deadline delivery and Family's separate ancestry reader are outside
this release's proof.
