# Fenced original finalization recovery

The previous path could not re-enter validation before its first checkpoint,
could load but never wrote a partial copy-verification checkpoint, and returned
the same expired claim to multiple retries without acquiring a fresh lease.
The shared claim also let a failed old request claim cleanup of current work.

The v2 finalizer gives each invocation an exclusive 60-second lease, renewed
every 20 seconds and at each existing authority boundary. A retry after expiry
rotates the claim under the upload row lock. The new holder can restart initial
validation without a checkpoint or carry forward the exact previous checkpoint.
The upload's account, originating session, consent revisions, source identity
and expiry still have to match. No public upload or preparation limit changes.

Copy verification now saves its digest state and byte offset after each complete
range except the last, before advancing further. The final full hash must still
match the original. A copy completed before its checkpoint can be independently
verified on retry even when another copy request reports an existing destination.
Object existence alone never permits publication.

Transient errors and disconnected requests preserve source bytes and progress.
A preserved-source 503 carries `Retry-After: 60` with the closed
`{"error":"unavailable"}` body. The browser retains the same upload handle
only for this combination; unmarked 503 keeps its previous terminal behavior.
A definite structural or hash failure still claims terminal cleanup before any
provider deletion. The old abort RPC is also fenced: a superseded or expired v2
holder cannot obtain cleanup keys. Once abort marks the upload rejected, a new
finalizer cannot enter while provider cleanup is pending.

## Attempt lifecycle

`private.own_upload_finalization_attempts` is an operational cascade child of
the registered `public.upload_sessions` target. It holds only the upload ID,
claim and lease expiry. Existing parent deletion cascades to this child; no
independent retention clock or provider object is introduced.

Successful promotion retains the upload session and cancels its staging purge.
It therefore retires the exact current attempt atomically when the parent moves
from `validating` to `promoted`, keeps the same claim and binds a finalized file.
The existing completion function still checks current authority, a live lease,
the final object's identity and size, the raw hash, and staging absence before
that transition. Any transaction failure restores the attempt and publication
together. A lost success response retries the retained parent and receives its
existing file without creating another attempt or requesting cleanup keys.

Rejection preserves the attempt until parent cleanup. Removing it at rejection
would bypass the lease check used by repeated abort requests. Expired or stale
holders must still fail that check before receiving provider deletion targets.
No failed or uncertain validation/copy response deletes the current attempt.

This change does not resolve the pre-existing retention gap for promoted
upload-session metadata. The existing checkpoint trigger already retires
checkpoints on transitions out of validation and remains unchanged. No
historical checkpoint residuals were measured in this review.

## Compatibility and limits

- The application route uses v2. Existing v1 contracts and their assertions are
  retained; v1 callers cannot bypass ownership once v2 owns an upload.
- An old deployment's request drains for 300 seconds after its last recorded
  activity before v2 can adopt it. The retry keeps the same source and final key.
- Initial gzip validation restarts from byte zero. It is not a resumable decoder.
- Neither the existing upload-session expiry nor its cleanup deadline extends.
- Recovery requires another request by the same currently authorized session.
  This does not add background dispatch, change prepared-source activation or
  establish a whole-genome latency, capacity or cost claim.
- An external provider request may finish after client cancellation. Publication
  still requires current SQL ownership and independently verified whole bytes;
  existing create-only object and cleanup guards remain in force.

## Verification

The new synthetic route tests exercise actual checkpoint production and digest
restoration, gzip restart, disconnection, heartbeat renewal, competing requests,
the old finalizer's denied cleanup after takeover, and uncertain copy recovery.
The original finalization and phase-machine assertions remain unchanged.
The browser suite adds positive marked-503 and malformed-body cases without
changing its existing unmarked-503 terminal assertion. A browser-to-route test
exercises the actual retryable response and same-upload retry.

On 2026-09-15, 145 tests passed across the five focused suites with one worker.
The six existing retry-policy tests also passed unchanged.
TypeScript passed for the nine changed roots and their dependencies after Next
type generation; ESLint passed with zero warnings. An earlier full TypeScript
invocation encountered missing generated Next route types in the fresh worktree.
After integration with the reviewed ancestry fixes, commit `3a372ad` passed the
full repository suite: 5,062 tests across 303 files, with no skips, in 153.99
seconds with two workers. Full nonincremental TypeScript and scoped ESLint also
passed. An earlier run passed 5,055 tests but its email-capture setup refused
five downstream cases because the new worktree contained an ignored CLI cache
and a top-level dependency symlink. The cache and symlink were preserved outside
the checkout; existing dependencies are now linked inside a real installation
directory. The unchanged guard then passed all ten email-capture tests before
the successful full run. No packages were installed or deleted.

The eleven existing retry-policy and recovery-window checks also pass. The
current migration retains their required explanation that recovery still needs
the originating session. No assertion, guard or timeout was weakened.
Hosted recovery and capacity remain unmeasured.

The original 44 pgTAP assertions cover actual claim rotation, initial-validation restart,
legacy takeover, stale read/write/publication/abort refusal, lease renewal,
terminal cleanup exclusion, session withdrawal, upload expiry and ACLs. It has
not been run locally: database access and DDL were explicitly excluded because
the host is unstable. Fresh CI must run it and the historical SQL suites.
The lifecycle extension preserves those assertions and adds actual publication,
rollback, exact-attempt retirement, unrelated-attempt isolation, parent cascade,
lost-response retry and rejected-owner fencing cases. The route unit adds a lost
successful-publication response followed by a same-upload retry after attempt
retirement. The SQL file now has 66 assertions; all original 44 remain byte-for-byte
unchanged and in order. The focused v2 route suite passed all 12 tests, and scoped
ESLint passed with zero warnings. SQL execution remains pending; no local database
was started.
