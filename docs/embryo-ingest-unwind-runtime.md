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

   **Added 29 September 2026, from the completion and split-worker changes.**
   It must also:
   - run only on an unwind already `storage_confirmed`;
   - clear `embryo_ingest_sessions.worker_job_id`, then delete the attempt's
     own `split_cohort_vcf` job, the only job
     `assert_embryo_unwind_plannable_stores_v1` admits;
   - delete the split worker's pending rows in `private.embryo_split_ordinals`
     (`embryo-qc`) and `private.embryo_split_variants` (`variant-rows`). Both
     hold `on delete restrict` references to the session and the job, so they
     go first.
   - delete the write intents and fences, the disposal records, and only then
     the inventory rows.
   The storage-disposal migration leaves the plannable-store check untouched,
   so the job admission added with completion stays in force.

   **Built, 30 September 2026**
   (`20260930130000_embryo_ingest_terminal_purge.sql`, tested by
   `supabase/tests/embryo_ingest_terminal_purge.sql`). Test-local only; no
   route or scheduler calls it. `public.complete_embryo_ingest_unwind_v1` is
   the one step after `storage_confirmed`. On an abandoned attempt it runs one
   transaction:

   - It refuses any unwind not yet `storage_confirmed`, and rechecks the frozen
     matrix, the plannable stores, the storage evidence and the exact due tuple.
   - Each frozen Record Key recipient must still be an exact current member.
     Each gets one `embryo_terminal_mail` slot before anything is deleted. The
     slot copies the recipient's single current contact ciphertext. With no
     current contact, or more than one, it is a coded `delivery_unavailable`
     slot. No rotated contact is revived and nothing is decrypted.
   - It deletes, in foreign-key order:
     - the split worker's pending rows, the disposal records and the inventory;
     - the session, which cascades chunks, fragments, write intents, handle
       maps, mapping challenges and the fence;
     - then the attempt's own `split_cohort_vcf` job;
     - key print rights, key hashes and recipients;
     - rights sessions, invitations, reminders, deliveries and outbox rows,
       whose token candidates and hashes cascade;
     - contradictions, attestations, basis bindings, donor attributions,
       signatures and participant sets;
     - the pending embryos, then their quarantined subjects;
     - contacts, the cohort, the draft with its slots, and the cohort-only
       parent or donor principals;
     - operation nonces bound to anything deleted.
   - The uploader's shared account principal and every account are kept.
   - It terminalizes, and does not delete, the exact
     `ingest-abandoned-no-source` phase (`succeeded`,
     `ingest_abandoned_no_source`) and its retention row, as the register's
     zero-residual rule requires. The unwind completes holding no live
     reference, and the audit event carries counts only.
   - `private.embryo_ingest_attempt_residue_v1` then checks every
     `purge_target_stores` entry and every other table in `public` and
     `private`. Any row whose uuid or uuid[] column names a deleted row
     fails the purge. So does Storage metadata at an inventoried key, and so
     does a registered store that cannot be examined. The whole purge rolls
     back and the unwind stays `storage_confirmed`. The skip list is closed:
     - the retained pseudonymized audit targets;
     - the retention control tuple;
     - `private.invitation_terminal_notices.invitation_id`, which the register
       excludes until its own class is due.

   The manifest freeze forbids clearing `worker_job_id`, so deleting the
   session clears the reference. Only the attempt's own job is deleted, and
   exactly one must match.

   Not covered, and failing closed rather than purging partially: any store
   outside the plannable set. The planner already refuses those.

   **Retained single-parent review, 30 September 2026**
   (`20260930131000_embryo_purge_retained_review.sql`, tested by
   `supabase/tests/embryo_ingest_purge_retained_review.sql`). The owner decided
   on 28 September to keep an approved single-parent basis review as a
   retained human review decision. The residual check and the unwind
   planner's store check skip exactly `legal_reviews.target_id`, and only for
   a row with `target_kind = 'single_parent_basis'` and
   `decision = 'approved'`. A parent-deceased attempt now plans and purges to
   completion, and its review and evidence hash survive unchanged. A denied
   review, a review of another kind, and a `target_id` in any other table
   still stop the purge.

   **Published attempts, 30 September 2026** (same migration;
   `supabase/tests/embryo_ingest_published_cleanup.sql`). Publication plans a
   `purpose = 'published'` unwind in the same transaction, with an inventory
   of every fragment object where its write intent says it lives. It never
   lists a published source. The objects go through the same claim, finish
   and confirm doors, with the same exact evidence. After `storage_confirmed`,
   the completion step deletes:
   - the fragment rows, with their write intents;
   - the handle map;
   - the disposal records and the inventory.

   The session, chunks, fence and every published embryo, QC and genotype row
   stay unchanged. A published unwind can never run the abandoned-attempt
   purge. `public.embryo_ingest_unwind_work_v1` lists the unwinds still
   waiting on storage or on completion.

   **Canonical parts and sources, 30 September 2026**
   (`20260930132000_embryo_canonical_part_disposal.sql`, tested by
   `supabase/tests/embryo_canonical_part_disposal.sql` and the two suites
   above). The split worker's canonical parts
   (`20260930123000_embryo_canonical_sources.sql`) are R2 objects under
   `embryo/<uuid>`. They go through the same claim, finish and confirm doors
   as R2 fragments, with the same empty-marker evidence.
   - An abandoned attempt's plan inventories every part of its session,
     landed or not. Planning and the purge both refuse an attempt that holds
     a canonical source or a file row. The purge deletes the part rows before
     the session and the job, whose restrict references they hold.
   - A published cleanup inventories only the parts no canonical source binds:
     those of earlier or failed attempts. It deletes their rows after
     `storage_confirmed`. A bound part is never claimed by any unwind, and
     never counts as disposable.
   - A part is claimed once it landed, or once its write window has closed. An
     open window keeps the unwind `storage_pending`.
   - `private.plan_embryo_source_deletion_v1(files, reason)` is the internal
     planner for the retention-deadline, restriction and withdrawal slices.
     The reason is `retention-deadline`, `restriction` or `withdrawal`. First it
     refuses if anything but the source's own rows names a file. Then, in one
     transaction, it deletes the membership, then the source, then the
     genotypes, then the `genome_files` row, and proves no store names a
     deleted file. The parts stay as rows under a `purpose = 'source'` unwind.
     `complete_embryo_ingest_unwind_v1` deletes them once their markers are
     proved. No caller is wired to it. `restrict_embryo_cohort_v1` is
     unchanged: today it deletes QC and genotypes and keeps the file rows,
     sources and parts.
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
