# Bounded Embryo carrier producer and remaining scientific inputs

Prepared 2026-10-02 from cc79be42679d0dc5f57d964a3d6216c3aed8137a.
G4.2, G4.5 and every currently unproved route/state pair remain NO. The frozen d98 checkpoint implements the private observed-allele core. The
separate `codex/embryo-carrier-worker-v3` successor now authors the operation-specific
queue, complete per-assertion worker, exact private save, durable intake recovery
and the current saved-hold reader connected to both real product pages. These
new database operations await an owned-clone rehearsal; no clinical output is
admitted. No condition,
review, scientific package or jurisdiction is activated.

The controlling sources are brief §§3.2, 4.4, 4.6, 6.3–6.9 and A.7;
`policyResolvers.analysis-eligibility-v1` and
`policyContracts.embryo-autosomal-only-v1` in `docs/route-register.json`;
ADR0019 and ADR0034; the September28 and September30 carrier decisions in
`docs/protocol/decisions.md`; and the saved-basis note under G4.2 in
`docs/acceptance-matrix.md`. The owner approved importing the carrier reference
as inactive. Each named condition review and separate activation remain
required. The compiled Embryo allow-list is deliberately empty.

## Implemented private measurement

`src/lib/embryos/carrier-observation.ts` counts the exact reviewed allele in one
embryo's own diploid autosomal calls. Its default reader refuses the committed
empty registry before inspecting reference or genomic inputs. Synthetic tests
can inject a registry, as the existing registry tests do; injection confers no
database or clinical authority.

The supported interpretation is one reviewed autosomal-recessive allele for a
registered Having children carrier-only condition. Zero, one or two observed
copies map to the existing `not_detected`, `carrier` or `two_variants` states.
This is OBSERVED sequence evidence and requires confirmation; it gives no
disease probability or diagnosis. Different asserted alleles are not summed.
Dominant, sex-linked, unknown and multi-allele condition interpretations refuse.
Missing, unreadable, mismatched, haploid and disputed calls never become an
inferred reference genotype.

The existing family exact-allele reader reads literal variant calls and
reviewed equivalent indel spellings. Canonical homozygous-reference VCF rows
have REF and ALT=NULL; those are read as reference only when both actually
observed copies equal the assertion's exact reference at a registered spelling.
No alternate allele is invented to adapt these rows. Arrays, multiallelic
records and inputs from another file are refused by this narrow computation.
The original two-embryo VCF fixture passes through the original transport and
per-ordinal parser to this computation; the two ordinals remain separate.

The private result preserves the source tuple, whole assertion, classification,
review status/stars, nullable classification date, release and penetrance
context. A missing date remains missing. This module checks input shapes, not
the provenance of caller-supplied IDs/digests or current authorization. It is
not sufficient to persist or reveal any result. It emits no public finding DTO
and carries no public copy identifier.

## Authored database and worker boundary — rehearsal pending

Reuse the existing `worker_jobs.kind='score_embryo'`,
`output_kind='embryo.carrier-match'`, `source_binding_kind='cohort-source-set'`
and `embryo_scores`; the reserved migration adds one nullable closed `computation_receipt` JSONB column
to `embryo_scores`. Existing rows stay NULL, with no historical backfill and no
new inference from old findings. No new table, secret, provider or configuration
is needed. The column is this embryo’s own scientific record: a closed producer/job/attempt/
capture-digest/source/reference receipt with observed basis and a separate public
disclosure hold. It contains no complete participant authorization capture,
other principal’s encrypted signing name, direction or grant snapshot. That
full capture is confined to the existing credential-excluded `worker_jobs.payload`.
Authorized whole-subject and own-account archive members already serialize
`to_jsonb(score)-embryo_id`; they preserve this own scientific receipt with its
truthful hold. Existing whole-row deletion removes it with the score, with no
new purge participant. The export member plan records this column under the
existing deferred cohort projection; this source stream changes no export
completion claim.

1. A server-owned request capture must resolve the exact compiled conditions
   before enqueue; require current condition-registry membership and current
   active named carrier review/revision, current unretired reference release,
   its pinned source/extract/gene-validity digests, and the whole rule rows.
   Capture the entire reviewed condition library, with the existing 20,000-row
   overall reference bound. Every assertion is measured independently. A
   multi-allele condition interpretation stays held without selecting a subset,
   summing doses, assuming phase or inferring disease probability.
2. Capture the complete current cohort published canonical source set and
   immutable call proof `exact-staged-calls-v1`. Include each file/subject/
   embryo/cohort identity and source SHA/publication/upload/normalization
   revision, full QC receipt, basis case and all five participant sets and
   revisions, donor-neutral state or exact donor/artifact classification, every
   required purpose/direction/consent/artifact/jurisdiction revision and current
   lifecycle. No parent/sibling/reference-panel imputation is permitted.
3. Under the existing subject-first serialization and lock limits, enqueue
   only through operation-specific authority. The full captured source and
   authority revision belongs in the existing source-binding/idempotency tuple;
   regrant of the same bytes must not reuse old authority. Algorithm/reference/
   output schema revisions belong in `computation_revision`. A payload field or
   client hash cannot override any server-owned binding. Freeze this job's
   payload as well as its existing immutable dispatch fields.
4. An operation-specific claim/check/read door must exclude these jobs from
   generic unchecked claiming. Require the exact attempt and token hash;
   re-resolve the full capture at claim, before every bounded locus read,
   before private write and again at publication. Every locus read must be
   bounded to one captured embryo/file and the reviewed allele spellings.
   Enforce the existing QC suppression floors through their single authority.
5. Atomic cohort publication may save only the exact complete supported
   source/condition set under the same attempt and full receipt. No partial
   public rows, source substitution, claimed/detached/stopped subject or
   revoked authority can pass. Changed authority cancels the job, clears
   process data and removes unpublished partials through the existing retention
   contract. A saved reader must prove the current receipt again before use.

The source now contains the complete capture and operation-specific dispatcher
in `20261002132000_embryo_observed_carrier_producer.sql`, with a literal source/
attribute/default/ACL predecessor guard for the only replaced generic claimant.
The QC SQL adapter is generated from the single canonical TypeScript policy;
source-pin tests prevent an independent threshold policy. New jobs freeze the
full capture, compare it before each source read/save, use finite five-minute
claims within captured authority deadlines, and refuse stale attempts/tokens.
Expired process claims can restart under a newly checked fresh attempt up to
the existing bounded maximum. Save independently reads the actual immutable
calls and refuses any worker dose or incomplete cohort that disagrees.

`carrier-worker.ts` runs the original per-file allele core, and its operator
entry point `pnpm worker:embryo-carrier --once` is awaited and TEST-LOCAL only.
Admission hints run after a genuine cohort purpose grant or whole-source
publication commits. An incomplete analysis grant does not invalidate the
valid grant itself. The awaited worker independently reconciles bounded pages
of four published current cohorts before each claim, through the same full
capture/idempotent enqueue. Durable source/grant records recover a lost hint
after a process/request crash; a restart begins a fresh inventory pass. The
private process cursor advances pages and resets after a complete pass. There
is no new credential, provider, recovery table or user-triggered replay.

For complete multi-assertion conditions, each read page contains at most 32
captured assertion IDs and at most 256 own immutable calls per assertion.
Every page is enclosed by full current capture checks. The original exact
primitive counts each allele separately. The compact saved measurements retain
every assertion ID, observed 0/1/2 or named refusal, and exact n/N coverage;
the receipt also pins the complete reviewed assertion rows and review/release
evidence. Condition interpretation remains held. No disease probability,
phase, dose sum or clinical finding is derived from those independent counts.
The actual splitter's haploid, multiallelic and literal-N calls reach the
unchanged core's truthful refusal instead of failing the transport. Independent
SQL validates the entire bounded call page before allele-spelling matching.

A QC-passed observed dose persists as the truthful private observation with
`coverage_state=covered` and `not_covered_reason=NULL`, keeping the complete
original score constraint. Its separate receipt says `publication=held` and
`hold_reason=scientific_disclosures_pending`. Genuine QC failures keep quality_not_measurable; QC-passed unsupported/missing
calls keep not_covered, and partial complete-set coverage keeps partial.
Compare, detail and Copilot explicitly
exclude receipt-bearing private rows. The service-only current saved reader
re-proves the full capture and every saved observation, then returns only the
closed disclosure hold to an authorized live account; it reveals no finding,
DNA or other-principal capture. A strict TypeScript caller rederives the live
account/session after the existing page gates. Both actual detail and comparison
pages show plain saved-review status only when this current reader proves the
complete result. Failed or widened responses remain a read error.

Local focused tests now pass 187 cases, including 65 unchanged core cases,
original QC/projection/Copilot/split regression tests, actual transport/parser
ordinals through the new worker, all cancellation checkpoints, substituted
file/locus/attempt/capture response refusals, true QC reasons and expiry/abort.
The full 781-assertion parser fixture is processed through 50 bounded batch
reads for two embryos, preserving actual 781/781 and 774/781 coverage. The type
check and scoped lint pass. The original real-role SQL test uses the original three-ordinal
split/publication fixture byte-for-byte and the real synthetic importer/review
doors inside rollback. Its owned-clone execution, independent save refusal,
current saved-reader proof and broader revocation/stop races are still pending.
A separate rollback suite now authors genuine source publication/grants with
no enqueue hint, service reconciliation recovery and replay, complete reviewed
set capture, actual unsupported-call persistence and full n/N evidence.
The first two owned rehearsals stopped before this source migration: first at a platform
function parameter ownership difference; second at exact worker CHECK grouping
changed by dump/restore parsing. Both partial clones are preserved unqualified.
The third reviewed clone, `inherit_embryo_carrier_20261002_2000`, passed native
owner restoration, the exact enabled guard recreation, guarded original CHECK
and ACL restoration, complete rollback inverse proof, and independent complete
metadata comparison: 995 functions, 228 relations and 224 migration entries.
The sole event object owner remains `supabase_admin`; its original executing
function owner, source, attributes, grants, event tags and enabled state match.
This is an application metadata proof with an explicit platform ownership
limitation, not a byte-identical whole-platform claim.

The source migration then failed atomically in its first predecessor check:
`pg_get_userbyid` yields `name`, so its aggregated `name[]` could not be compared
with the literal `text[]` role list. No source DDL or SQL suite ran. The private
receipt and raw error remain retained. The successor explicitly casts the
aggregated role names to `text`, preserving the exact owner, grantor,
EXECUTE-only, non-grantable two-role ACL criteria and every other predecessor
check. The rollback fixture now describes source/grant state present in its
transaction; it makes no cross-session committed durability claim.

A separately frozen follow-up plan targets only the existing 2000 clone. It
must first recapture the complete metadata and equal the actual qualified fresh
capture exactly, then apply this revised migration atomically and run the same
seven strict scoped suites. Root review is required before execution; no new
clone, replayed restoration or automatic repair is permitted. The prepared
native TypeScript-to-database proof remains unexecuted and separately held.
Full native publication and mandatory disclosure presentation remain held;
this intermediate source checkpoint does not complete the science flow.

## Presentation prerequisite

The current carrier cell displays a three-state label but lacks the brief's
mandatory variant name, classification/review status and classification date
adjacent to a finding, cited penetrance range or explicit not-established
statement, and exact covered positions n/N for a nonfinding. A public carrier
publication must first add a closed disclosure representation and render these
facts from the same saved assertion receipt. The current eight-key public DTO
cannot be silently widened, and the synthetic display copy identifier must not
be reused as a production identifier. No ranking, per-embryo count, sort,
recommendation or composite may be added. All real jurisdictions remain
research-only/unreviewed under ADR0034.

## Scientific-input handoff for MODELLED and comparison

The repository's weighted PRS sum and reference-frequency distribution are
explicitly unvalidated. `risk_models` supplies baseline metadata, not a fitted
per-embryo predictor, coefficient uncertainty or an admitted interval producer.
Existing exact Mendelian arithmetic and observed QC cannot supply these missing
inputs. No populated baseline, covariance, interval or dossier will be invented.

Before an absolute-risk producer or a quantitative comparison can be admitted,
the scientific review must supply and independently check each item below.

| Required input | Exact evidence needed | Current hold |
| --- | --- | --- |
| Condition and intended use | Allowed disease ID/category, same condition name, output kind, research-only scope and a recorded named review/activation | Compiled conditions remain empty |
| Predictor | Immutable fitted package/version/hash, complete fitted parameters and allele/build mappings, explicit model equation and approved execution reference | No embryo fitted package is admitted |
| Calibration | Combined-sex lifetime/lifetime-risk baseline, stated birth cohort, calibration cohort/count and source-backed strict low/point/high interval with applicability limits | Metadata alone cannot establish fit |
| Uncertainty | Source-backed coefficient covariance or other fitted uncertainty object, interval algorithm/coverage justification and reference predictions spanning ordinary/extreme/poor-coverage inputs | No interval algorithm or covariance is admitted |
| Ancestry/reference | Immutable reference release/hash/license, population applicability and limitations, coverage denominator and exact missing-call policy without parent/sibling imputation | Existing frequency reference is not embryo calibration |
| Within-family | Published sibling-validation citation, actual positive family count, point estimate and strict95% interval; inconclusive evidence must include the no-attenuation null | No invented sibling evidence; not-measured stays disabled and nonnumeric |
| QC effects | Source-backed interaction with the registered call-rate/coverage floors; actual dropout uncertainty and registered unknown-dropout widening/suppression rules | Unknown measurements cannot become estimated inputs |
| Comparison | All four actual comparator baselines/intervals and stored selected comparator; reproducible effect in absolute percentage points/natural frequencies; same source/current grant/basis provenance | No display multiplier or synthetic risk baseline |
| Review and validation | Primary sources with exact supported scope, access dates, licenses and human reviewer decision; deterministic reference outputs and adverse/held cases; no inference from inaccessible full papers | Source access alone is not scientific approval |

Each admitted package must supply reproducible synthetic predictions and strict
negative examples, then pass current authority/QC/lifecycle publication and
revocation tests before actual worker/native proof. An owner choice is needed
only if a new interpretation or architecture is required; the existing empty
registry and inactive-import decisions are not being reopened here.
