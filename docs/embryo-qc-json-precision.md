# QC JSON precision boundary

The failed native second-seed journey on `2280e7f4` reached the unchanged strict
measured-count ratio validator. Native parser/worker evidence measures 1,184/1,200
and stores the exact double `0.9866666666666667`. Root-owned read-only PostgreSQL
probes confirm the stored binary identity `3fef92c5f92c5f93`; actual
`extra_float_digits=0` serializes it as `0.986666666666667`. A scoped `3` probe returns
`0.9866666666666667` with identical bits. Positive extra_float_digits uses
PostgreSQL's shortest precise decimal representation; see the official
[PostgreSQL numeric-type documentation](https://www.postgresql.org/docs/16/datatype-numeric.html).

## Exact readers

034 adds read_embryo_qc_rows_v1(uuid,uuid[]), service-only SECURITY INVOKER with
both the actual PostgreSQL service role and its genuine JWT required. It accepts
one authorized cohort and 1–64 unique nonnull embryo IDs, returning all 22 QC
columns only if both the exact cohort identities and every QC row are present.
No table privilege, human door, stored number, result provenance or global GUC
changes. The limit comes from docs/route-register.json
payloadBoundaryContract.embryoIngestSessionLimits.maximumSampleColumns and
src/lib/genome/ingest-limits.ts; ingest-binding.ts enforces it before accepted
upload. Existing compare/detail resolve current role/jurisdiction, cohort
capability, both-parent consent and Tier2 acknowledgment before the complete
result reader. Overview reads only qc_verdict and needs no floating JSON change.
The mixed-QC and cross-surface native proofs retain every original assertion.
The pure SDK consumer acquires no credential/client; callers supply their
existing client. Database authorization remains service-only and the product
projection still rejects any nonexact measured ratio or changed provenance.

These existing serializers receive only function-local extra_float_digits=3:

| Exact signature | Original body MD5 |
| --- | --- |
| private.future_person_export_snapshot_v1(text) |7ae505cb92d301a41a2a263be1702547 |
| private.future_person_bound_export_snapshot_v1(jsonb,uuid) |6f202bda0cc049ed12306e4ef5916352 |
| public.future_person_export_members_v1(text,uuid,uuid,text,text) |8510090f140b1680cca24da74fdc48c5 |
| public.export_archive_account_members_v1(text,uuid,uuid,text,uuid,text) |36f818dc8b24f0f7ff9ceb431eb7ce46 |

The actual four row catalog capture independently matches every body, postgres
owner, SECURITY DEFINER flag and search_path="" predecessor. Both public doors
remain service-only; both private captures remain denied to all API roles.
The strict successor configuration is exactly search_path="" plus
extra_float_digits=3, with no fallback or additional configuration. Captures
pin representation too, so request/current/worker receipts cannot vary with a
caller's float setting. Previously captured receipt hashes remain strictly
stale if their underlying representation differs; none is inferred, relabeled
or reissued. Existing export/QC tests and script gates were searched: no relevant
prior exact proconfig assertion requires weakening. Historical compiled release
guards remain immutable and must be recaptured at the actual successor before
any future production apply.

## Evidence limits

Actual root probe evidence lives under /tmp/inherit-integrator-20260930:
qc-seed-b-actual-worker-measurements.json,
qc-seed-b-postgres-float-probe.json,
qc-seed-b-postgres-float-probe-3.log and qc-precision-actual-catalog.log.
The new pgTAP fixture uses the unchanged published synthetic cohort and a
representation-only ratio update; its invented ten-site provider/source fixture
is not a native 1,200-site scientific or provider receipt. It independently checks
all fields, binary roundtrip, restore-on-success/refusal, exact configuration,
ACLs and complete selection. Authored SQL remains unexecuted until root's owned
chronological rehearsal; no database, hosted browser, provider or acceptance
credit can be borrowed from the read-only diagnostic. A fresh complete hosted
suite remains required to prove the actual repaired second-seed journey.
