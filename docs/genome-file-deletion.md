# Owner file deletion

The legacy button tried authenticated Storage and table deletes after v2 had
removed those privileges. It ignored both errors and refreshed the list.
This fix keeps the security boundary and replaces that broken client path.

`DELETE /api/files/[id]` requires same-origin, a verified signed-in user and a
live matching Auth session. Only a file owned by that account and bound to its
active self subject is eligible. Another adult, a cohort, a shared family or
relationship graph, or an unbound stored report/export needs the subject-level
workflow and returns an explicit error. This bounded route does not purge them.

The service-only prepare function locks the file and its subject, validates
the stored object binding, and refuses an active parser or queued/running
worker. It preserves one exact bucket/key and retry token in a private table.
It marks the file failed with a pending-deletion explanation, so report readers
stop treating it as processed. A trigger freezes file updates; another trigger
takes the parent-file lock and blocks a worker restart after preparation.
The existing Process route returns before fetching bytes if its first status
update fails. File data and derived rows remain until Storage succeeds.

The server calls Storage.remove on that single database-owned key. An API error
or malformed acknowledgement prevents finalization. A successful empty result
is an idempotent acknowledgement after an earlier attempt removed the object.
The finish transaction rechecks authority and bindings, requires the token and
independently verifies that exact Storage metadata row is absent. It removes
download sessions, registered object metadata and worker state, then the file.
Variants, PRS, ancestry and the private deletion record cascade from the file.
The subject, other files, consent records and chat history are not deleted.

This is settled self-upload deletion, not a fence for an in-flight embryo
writer. Source keys are immutable and client creation in the final bucket is
not allowed. No browser Storage or table-write privilege is restored.
The claim is Storage API acknowledgement and removal from application access,
not independently verified physical erasure from every provider backup/version.
The current [Storage deletion implementation](https://github.com/supabase/storage/blob/master/src/storage/object.ts)
awaits the backend request inside the metadata transaction, rather than queuing
it. Its [S3 adapter](https://github.com/supabase/storage/blob/master/src/storage/backend/s3/adapter.ts)
checks rejected delete requests but does not inspect a fulfilled response’s
per-object Errors field. This provider-level limitation is not solved here.

## Retention and tests

`private.genome_file_deletions.file_id` has an exact ON DELETE CASCADE foreign
key. Existing account database purges therefore remove pending file manifests
with their file, without a new public purge class or a retained orphan token.
Pending manifests contain only existing exact object identity, account binding
and retry metadata, never file contents. Legacy object keys may include a
filename. The manifest cascades on completion or account purge.
Completed upload session journals and chat history retain their existing rules;
the button describes file-based results, not whole-account deletion.

Preparation invalidates queued or claimed report-ready notices for this exact
file, including on retry. A separate mail insert guard serializes with the file
lock and refuses a missing, deletion-pending or non-annotated target, closing
the process-finished/late-enqueue gap. Mail claiming also invalidates stale file
readiness and excludes it from selection. Research digests and already-sent
history are untouched. An already-submitted provider request cannot be recalled.

SQL assertions cover live-session/owner/non-self restrictions, unsupported
stored derivatives, processing/worker refusal, exact immutable retries,
premature finalization, update fences, source-before-row order and cascades.
Route units inject Storage failures and malformed manifests. Browser tests
use genuine synthetic uploads and the Storage API; they prove visible error
and retry behavior, source disappearance, database cascades, retained subject,
foreign/non-self refusal and Process refusal after preparation. The browser
error response is intercepted; backend Storage failure is injected in units,
not through a production test switch. No real user's file is changed.

The migration was tested on a disposable local database named
`inherit_file_delete_20260906`, cloned from an isolated zero-user/zero-file base.
The local sequence stack is used only for synthetic end-to-end verification.
Hosted migration application and deployment require the normal reviewed rollout.

Local checks after integration with main: 1,608 unit tests, 71 targeted SQL
assertions, three production-browser tests,
typecheck, targeted lint, readability/name/secret gates and zero error-level
security-advisor findings. The final browser pass includes Process refusal
after deletion preparation and unchanged derived-row counts before retry.
It also proves the queued readiness notice becomes invalidated and that normal
processing still queues one notice without renewing its deadline. One existing
early-stream-close log appeared during navigation, with no failed assertion.
