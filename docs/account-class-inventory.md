# Consumed account class inventory

Migration `20261001029000_account_archive_class_inventory.sql` adds no table,
credential, human authority, analytical grant or public export gate. Its one
public RPC is executable only by `service_role` with genuine service-role
claims. The original authenticated own-source doors remain separate. The
worker must present the actual consumed request, current source receipt,
registered writing attempt and nonce-bound account/session. The original
unsupported account/cohort/joint partition refusals remain in place.

Every account capture includes the exact 29-class inventory: the original 27
public deferred classes and the two integrated Path B stores. Metadata has
independent identity/content hashes and per-subject counts; a same-count source
edit changes the complete authority receipt. Source pages have a fixed 500-row
UUID keyset and named, closed field projections. Both current request and
complete capture are rechecked before and after each page. Unknown operations,
classes, private table names or narrowed context requests are refused.

The ten metadata classes preserve recorded clocks, revisions and status. They
withhold identity/document/contact fields, counterparty account/principal IDs,
internal credentials and private graph counts. Account action history whose
actual target is outside the captured subject set has `subjectId: null`;
assembly must describe it as requester account history, never infer a subject.
Existing metadata projectors and source membership remain independent.

| Classes | Current handling |
| --- | --- |
| attestation_contradictions, directional_grants, family_sharing_pauses, family_sharing_stops, future_person_claim_objections, future_person_claimant_principals, future_person_claims, subject_control_refusal_authorities, subject_relationships, suppressions | Complete named/redacted metadata pages with count, ID, ordered content hash and partition equality |
| embryo_figures, embryo_qc, embryo_scores, embryo_variants, embryos, report_artifacts | Exact existing claimed-bound immutable snapshot and complete historical member readers; arbitrary ordinary/cohort artifacts are refused |
| ancestry_regions, appeal_intakes, correction_requests, embryo_basis_bindings, embryo_cohorts, embryo_disposition_confirmations, embryo_disposition_proposals, embryo_donor_attributions, embryo_participant_sets, family_pairs, portrait_results, other_adult_held_uploads, path_b_report_bindings | Genuine eligible-source presence is counted; any nonzero class refuses the whole request until its complete registered projector and partition authority are proved |

The claimed-bound snapshot must match every captured subject and source file,
source and membership hash, publication and lifecycle/binding/credential
revision, original authority, complete membership and audit metadata. Accepting
these counts supplies no byte proof. The assembler must first consume every
historical member and the distinct current-location complete-EOF source reader.
The final class-completion check also rechecks current consumed authority.

The TypeScript reader applies the existing 30-second bound separately to each
RPC and durable-authority callback. Cancellation or the original job deadline
refuses ignored callbacks before another page can be admitted. It never marks a
class complete until exact EOF, content hash and partition counts are proved.

Focused tests cover three pages with 1,103 actual consumer rows, all ten metadata
classes, six nonzero bound scientific memberships, complete-source equality,
unknown/missing/duplicate/foreign/stale/same-count changes, partition drift,
internal fields, ignored cancellation, fixed operation bounds and final current
authority. The authored pgTAP fixture reuses the original genuine review,
release, own Auth/MFA binding and complete relocation protocols, independently
compares the six actual scientific table memberships, verifies source metadata
IDs/hashes across three pages, and retains service-only/private denial checks.
Synthetic SQL transport metadata establishes no provider evidence.

This is a source prerequisite for the complete assembler, not completed G5.6.
Nonempty unsupported classes still refuse the entire request; there is no
single-member or own/bound subset completion. Database execution, full archive
assembly, asynchronous POST/status/browser proof and final provider delivery
remain independent required verification. Public/READY and provider writes
remain closed while their required complete proof and provider choice are held.
