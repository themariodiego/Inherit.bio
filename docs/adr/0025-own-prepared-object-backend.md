# ADR-0025 — Private object backend for existing WGS results

- Status: Accepted for disabled private integration · 2026-09-08
- Deciders: Inherit engineering, within the owner's approved WGS scope
- Extends: ADR-0016; no format or public admission changes in this slice

## Decision

The owner approved existing WGS result files first, raw FASTQ/BAM/CRAM afterward,
an initial target of 100 genomes per month, and one month of original retention.
These are delivery requirements, not evidence of current capacity. No additional
spending is authorized.

Add an opt-in object backend for newly prepared self-owned VCF-family sources.
Keep current files and their database preparation path intact. Store immutable
bounded prepared blocks and indexes privately; PostgreSQL retains authority,
jobs, exact artifact membership, manifest identity and captured report outcomes.
Do not insert one database row per call for this backend.

The initial prototype's sorted parser events are provisional. Canonicalization
must preserve original coordinates, alleles, source lines and observed uncertainty
alongside normalized coordinates, with the existing duplicate-conflict and
liftover rules. Only complete terminal verification permits publication.
Source sorting alone is not a normalized-coordinate index.

`policyContracts.own-prepared-object-v1` owns the private job limits and authority
protocol. Its first SQL slice remains disabled and cannot publish preparation or
start a hosted writer. The finite job budget is an initial private verification
budget, not a promise that every WGS file will fit it. The retention register owns
the independent fixed scratch deadline.

## Background authority and deletion

Enqueue captures the real originating session and exact source/store authority.
The service claims a database-selected job and rechecks that same live authority
on every step. Session expiry, logout or rotation stops processing. This decision
does not create a session-independent genetic-processing delegation. A fresh
session cannot silently replace the job's captured authorization.

Register an immutable artifact identity and byte reservation before each write.
Transport verifies complete stored bytes independently of the database metadata
acknowledgement. Failed or uncertain submissions stay in the cleanup manifest.
Prepared keys use the permanent `prepared/<database-generated UUID>` namespace.
Its metadata trigger rejects unknown keys and all updates, including after job
membership is retired. Storage's rollback-only permission probe is admitted
under the same live reservation; a deferred constraint prevents committing the
probe's weaker metadata shape. Final writes require the exact registered size
and a real object version. This fences metadata, not physical provider bytes.
Freeze registration and publication before deletion. A request already submitted
to Storage can finish after cancellation; lease expiry alone is insufficient to
prove absence. Fence or drain outstanding writes, remove exact frozen identities,
and independently verify absence before acknowledging cleanup. Foreign keys must
not silently erase the only references to outstanding objects.

The initial private protocol is a narrow extension alongside generic worker jobs.
It grants no analytical purpose and sends no report-ready notice. Chosen reports
must retain their own source/grant checks and atomic captured completion.

## Disabled publication transition

The additive publication migration stores an immutable final manifest and exact
ACKed artifact membership. Full byte verifiers read every final canonical and
rsID object before the executor writes separate canonical/rsID roots and a compact
combined root. Intermediate sorting objects remain registered scratch even when
their sequences fall between the final materialization phases.

Initial publication requires the actual originating session, claim and source
under locks and a final deadline fence. A published read or exact replay resolves
the reader's current session and current store/source/lifecycle authority; it
cannot reuse a stale worker token as permission. Published jobs leave temporary
job expiry, and reciprocal serialization prevents legacy normalization on the
same file. No legacy normalization journal is fabricated.

Published coordinate reads use actual authenticated RPC and Storage transports.
The full source/member digest is checked before and after a bounded page; each
selected object also gets an indexed exact-member check, avoiding a complete
membership scan for every range. The reader requires the caller's distinct
current operation check around I/O and at return. It preserves original evidence
and canonical target order, so report projection must still preserve existing
collision semantics. These adapters remain inactive until report claim/commit,
complete exports and deletion share the same published source identity.

The new manifest/member stores are in the purge inventory, with restrictive
foreign keys preserving object identities. Full file/account/expiry deletion and
scratch cleanup still require integration and verification before activation.
The publication function and metadata assertions do not independently prove
provider bytes, report completion or successful cleanup.

## Complete delivery boundary

Before enabling even the private writer, connect and verify the complete journey:
validated upload, bounded job execution, canonical indexed calls, an explicitly
chosen report, complete call export, original download, and exact file/account
deletion with another file preserved. Existing readers, saved reports, mail,
Copilot and exports must dispatch by an exact backend receipt or clearly refuse
an unsupported backend; an empty legacy SQL result is not missing coverage.

The current Files download route returns a temporary signed Storage URL. This
remains a gap against ADR-0016's revocable chunk contract and must be repaired
for the complete larger-file delivery. It is not evidence of per-chunk revocation.

One-month original expiry is a separate compatibility change: existing read and
export predicates require a live original. Retained verified results need a
versioned expiry receipt, honest unavailable-original presentation and exact
quota/deletion handling first. Do not backdate expiry for existing real files.
Raw-read formats similarly need their own closed admission, compute and
scientific validation changes after existing-result capacity is demonstrated.

## Evidence

Require canonical parity, bounded integrity and cancellation checks, SQL and
concurrent authority/freeze tests, then a real larger synthetic Storage journey
with complete results, export and cleanup. Record time, memory, bytes, requests
and retained/intermediate storage. Derive the monthly capacity and cost envelope
from that evidence before raising public limits. Neither the local disk proof
nor a passing primitive test establishes hosted WGS readiness.
