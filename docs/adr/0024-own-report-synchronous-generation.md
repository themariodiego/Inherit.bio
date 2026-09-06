# ADR 0024: bounded synchronous own-report generation

Status: implementation decision for review; no hosted-release or whole-plan acceptance claim.

## Context

The register already permits `file-processing-v1` synchronous Tier-1 success,
but its explicit synchronous orchestration only names normalization. Meanwhile,
`analysis-eligibility-v1` names monogenic and polygenic purposes without matching
report operation rows in `worker-job-dispatch-v1`. Treating those statements as
an existing generic queue implementation would be inaccurate.

The useful next own-account journey is concrete: upload a single-source genome,
prepare it, choose trait reports, then see the file's MCM6/lactase reading with
its evidence and limitations. That does not require a new generic job framework.

## Decision

Register `policyResolvers.own-report-synchronous-v1` as a narrow exception for
the current own-account Tier-1 process route. It supports only the independently
selected `reports.monogenic` and `reports.polygenic` operations. Monogenic means
the `variant_call` finding layer; polygenic includes the `estimate` layer's
single-variant trait reports. Existing PGS computation remains coverage-only at
every publication boundary: this does not add validated personal scores or risk.

Every operation uses the same exact live canonical grant pair, current legal
artifact, normalized source identity, principal/binding revisions, jurisdiction
and lifecycle resolver before each bounded genetic read and in its terminal
transaction. The server selects operations; the bodyless browser request cannot
select a weaker permission case or grant a purpose.

Each selected purpose receives its own exact-source, exact-grant completion
record. Materialized interpretation results and PGS rows commit atomically with
that record. The file stays `stored`; a global `annotated` flag cannot authorize
unselected result layers. Result readers require both current authority and the
matching completed-purpose record. Withdrawal clears only the affected grant's
report marker and polygenic rows; no source is deleted by a report withdrawal.

The route returns the existing strict synchronous `processed` or
`already_processed` receipt only when selected supported operations are complete.
Without a supported selected operation it returns preparation complete and
`not_generated`. An ancestry-only selection remains saved but not generated.

## Boundaries and consequences

- No worker job is invented. Existing queued-operation identities, idempotency
  formulas and contracts remain unchanged.
- Ancestry, other adults, embryo and family processing are not included.
- No consent is created, assumed, widened or restored by processing.
- No outside model or report-ready email is invoked by this slice.
- Retry replaces only the exact stale/expired purpose run; completed outputs
  remain protected by current source/grant checks across normal login refreshes.
- This is a specific MVP delivery decision, not permission to weaken queued
  analysis or scientific output requirements elsewhere in the whole plan.

## Required evidence

Focused runtime and SQL tests must prove independent choices, correct MCM6
interpretation, zero unselected outputs, exact completed markers, idempotence,
revocation before reads/publication, and no access before generation. The real
browser test must cross consent, Storage, normalization, generation and report
display without mocked genomic boundaries. Release and acceptance follow that
evidence, not the existence of this ADR.
