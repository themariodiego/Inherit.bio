# Unpublished ingest unwind: bounded implementation

Status on 2026-09-05: planning and independent mail delivery primitives are
implemented and locally tested. The complete `ingest_abandoned_no_source`
transaction is **not implemented or enabled**. No accepting source route,
Storage deletion acknowledgement or terminal notice producer is added.

## Implemented safeguards

- A fragment reserves an immutable exact bucket and server-owned cohort path
  before upload. An unresolved format/build cannot reserve a physical key.
  Reserved but unacknowledged fragments remain in the deletion inventory.
- `prepare_embryo_ingest_unwind_v1` accepts only the identical failed/expired
  unpublished cohort and ingest revision. It preserves the original session,
  failure denial, due pair and deadline. Repeated dispatch resumes one plan.
- The validator checks all five frozen membership sets, original membership
  revisions, the frozen signature matrix, typed parentage/disposition/Charter
  assertions and the zero-versus-one single-parent rule. It deliberately does
  not require a still-active login or consent version to erase revoked access.
- Issued-Card notice identity is distinct from product access. Revoked original
  members remain the same notice recipients; replacement members/revisions
  fail closed. Recipient references remain internal while planning. No early
  contact copy or owner-account substitution is made.
- An unknown populated target store, contradictory object binding or an
  unsupported pending/evidence source fails closed. This is a bounded known-store
  planner, not full coverage of every prepublication manifest class.
- A separate mail envelope holds no live account, subject, cohort, principal
  or contact foreign key. A random recipient pseudonym is not a product role.
  The data-free template states incomplete upload, no retained source and
  invalidity of every issued Card, but **nothing enqueues it yet**.
- The user explicitly authorized `mail.embryo-ingest-terminal-contact-24h` on
  2026-09-05: email ciphertext only, fixed confirmed-cleanup-plus-24-hour maximum,
  no renewal. A successful persisted provider-acceptance ACK deletes it sooner;
  expiry deletes it even after provider failures or exhausted attempts.
  If provider acceptance succeeds but the database ACK is unavailable, the
  same provider idempotency key is retried; immediate deletion cannot be
  guaranteed during that outage. The fixed expiry remains unchanged.
- Mail and retention workers record a coded terminal-queue failure and continue
  their ordinary independent queues. No address, provider error body, key,
  source label or genotype is logged by the new worker.

## Required before actual unwind or source acceptance

1. A reviewed Storage writer fence and conclusive termination/drain, including
   uncertain uploads and physical object versions. A caller abort, expired
   lease, empty metadata listing or successful deletion of no metadata rows
   does not prove that backing source bytes are absent. Unknown outcomes remain
   `failure_pending`/`storage_pending`; no deadline is renewed and no no-source
   claim is made.
2. Exact selectors and deletion verification for every supported pending,
   evidence, derived and working-state store. Unsupported graph cases cannot
   silently fall through to a partial purge.
3. A tested atomic final graph transaction after verified cleanup. It must
   invalidate every key/print right, enqueue exactly one independent terminal
   notice per frozen issued recipient (or a coded delivery-unavailable slot
   when no valid current contact exists), purge all cohort-only authority,
   signatures, attestations, evidence, subjects, draft, sessions and principals,
   and remove every live target reference from retained outcomes. No rotated
   contact may be revived. Non-identifying legally authorized review/hash
   outcomes are retained separately; no source or identity graph remains.
4. Final transaction and queue-production regressions, due-phase scheduling,
   zero-residual checks, provider retention verification and a reviewed rollout.

The independent mail queue has no source-acceptance or retention authority.
These primitives do not change self-upload/report capabilities or promote an
embryo acceptance gate.

## Combined integration verification

After integrating main through PR 55 on 2026-09-05, root independently ran
all 17 database test files in the isolated local database: **712 assertions
passed**, with rollback and without resetting the shared development stack.
All **1,548 unit tests** passed, followed by full lint, typecheck, readability,
name and repository/history secret gates. All 40 existing main public RPC
signatures are preserved alongside the five added embryo RPCs, including the
new timing return contract. These are local primitive/integration results,
not a production upload, physical Storage-drain or final-purge proof.

After integrating PR 56, the combined branch passes **1,578 unit tests**
across 107 files and typecheck. The database slice is unchanged from the
712-assertion run above.
