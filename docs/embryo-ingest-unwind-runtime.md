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

   **Metadata fence and drain built, 2026-09-28**
   (`20260928100000_embryo_ingest_write_fence.sql`, tested by
   `supabase/tests/embryo_ingest_write_fence.sql`). Test-local only; no route
   or writer uses it yet. What it proves:

   - Every reserved fragment gets one write intent in
     `private.embryo_ingest_write_intents`: its exact object name, byte count
     and a write window of at most 60 seconds, clamped to the session deadline.
   - `guard_embryo_ingest_object` on `storage.objects` owns the namespace:
     bucket `genomes`, four UUID segments and `.vcf` or `.tsv`, matched
     case-insensitively. An INSERT there needs a service-role JWT, an exact
     open and unexpired intent, an open, unfenced, unexpired session that still
     passes `private.embryo_ingest_binding_failure_v1`, a still-reserved chunk,
     a name absent from `public.embryo_ingest_delete_objects`, and the exact
     byte count. Only Storage's rollback-only probe (`version = '1'`,
     `contentLength`) and the real write (UUID-v4 version, `size`) are
     admitted. A deferred constraint refuses to commit the probe shape. Every
     UPDATE touching the namespace is refused. The real write marks the intent
     `landed` with the object id and version in the same transaction.
   - `commit_embryo_ingest_chunk_v1` can no longer store a chunk until every
     fragment's intent is landed and its metadata row still exists with the
     same id, bucket, name, version and size. A chunk with no fragments still
     commits.
   - When a session leaves `open`/`mapping_required`, a row in
     `private.embryo_ingest_write_fences` is stamped. `fence_at` is the later
     of the stamp and the last open write window. A fenced session never
     reopens.
   - `public.settle_embryo_ingest_writes_v1` reports `writable`, `draining`
     (before `fence_at`) or `settled`. Settling classifies every intent
     `landed` or `uncertain` once, and repeats the same receipt after that.
   - `public.embryo_ingest_write_targets_v1` lists each fragment's name, state
     and window. It renews an expired open window, at most three windows, only
     while the session is open, unfenced and authorized, so a crashed chunk
     request can resume. An exhausted window fails the attempt with
     `retry-exhaustion`.

   Why the time bound holds: the guard holds the session row FOR SHARE and the
   intent FOR UPDATE until the Storage transaction ends. A status change needs
   the session row lock, so it either commits first (the guard then refuses) or
   waits and computes the fence after that landing. After `fenced_at` no
   admitted metadata write can still commit. After `fence_at` every window a
   writer was given has closed.

   What it does not prove: physical absence. An `uncertain` intent means no
   metadata row committed inside its windows. The provider may still hold
   bytes at a version no row names, from an upload whose metadata INSERT was
   refused or never ran. A refused retry at a `landed` name can leave the same
   kind of orphan. `uncertain` intents therefore keep the unwind in
   `storage_pending`. At most one chunk's fragments can be uncertain, because
   only one chunk is reserved at a time.

   `private.assert_embryo_unwind_plannable_stores_v1` scans only `public`. The
   two new private tables are covered anyway: intents cascade from
   `public.embryo_ingest_fragments` and fences from
   `public.embryo_ingest_sessions`, both already inventoried by the unwind.
   Both are registered in `public.purge_target_stores`.

   **Owner decision needed:** what evidence is enough to treat an `uncertain`
   write as leaving no provider bytes?
   - **A (recommended).** Prove it. Keep `uncertain` unwinds in
     `storage_pending` on Supabase Storage, and move embryo transport objects
     to a store Inherit can list by version, as ADR 0025 does for prepared
     objects on R2: create-only writes, then a zero-byte tombstone at each
     uncertain key after `fence_at`, verified by listing.
   - **B.** Accept the metadata fence and drain as enough. After `fence_at`, an
     exact Storage API delete and an empty metadata listing count as absence,
     and the no-source notice is sent. Orphan bytes may persist until the
     provider cleans them up, on a schedule Inherit cannot state.
   - **C.** Accept B's evidence, but send cohorts with any `uncertain` intent a
     different notice: the upload stopped mid-write and an unreachable partial
     copy may remain with the storage provider. This needs new approved copy.

   **Answered 28 September 2026: A** (`docs/protocol/decisions.md`). **R2
   backend built, 29 September** (`20260929100000_embryo_ingest_r2_fragments.sql`,
   `supabase/tests/embryo_ingest_r2_fragments.sql`). Each write intent now
   records its backend. An R2 fragment is written create-only to
   `embryo/<object id>` in an `inherit-embryo-*` bucket behind
   `workers/embryo-fragments`. It lands only through
   `ack_embryo_ingest_r2_write_v1`, which shares the Supabase guard's
   admission check, so the fence and drain above hold unchanged. The Supabase
   guard stays as a fence on the `genomes` namespace. No backend is selected
   until an operator sets one. The gateway is not deployed. The interface for
   the chunk route and the worker is `docs/embryo-fragment-storage.md`. The
   markers at uncertain keys, and the deletion acknowledgement, are the next
   change.

   **Exact disposal built, 29 September**
   (`20260929101000_embryo_ingest_unwind_storage.sql`,
   `supabase/tests/embryo_ingest_unwind_storage.sql`,
   `src/lib/embryos/unwind-storage.ts`).
   - Nothing is claimed before the drain has settled.
   - Every R2 key, landed or uncertain, gets a permanent empty marker that the
     gateway reads back.
   - A landed Supabase object is deleted by exact id and version.
   - Each disposal is recorded only with that exact evidence.
   - `storage_confirmed` needs every inventory row proved. A trigger enforces
     this for any writer.
   - An uncertain Supabase write, a vanished object and a lapsed
     acknowledgement stay unresolved, so the unwind stays `storage_pending`.
   - D-130 is fixed for this builder.
   - The terminal graph purge is still missing (item 3).
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
