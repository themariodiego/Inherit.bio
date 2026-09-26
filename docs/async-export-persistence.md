# Archive persistence: an intermediate database slice

This migration first ran on 25 September 2026, on a local stack built from
every migration. After #210 merged, the same day, it was applied to the
production database in one guarded statement
(`docs/evidence/export-persistence-production-apply-20260925/`). It does not
activate a route, worker, scheduler, Storage upload or browser download, and
the ready-publication hold is in place there too. G5.6 remains incomplete. The
existing synchronous export route is unchanged.

The new RPCs extend `generated_exports` and reuse `own_export_source_v1` for
actual Auth, originating session, profile, own subject and source checks.
Account discovery examines the whole registered partition set. A nonself
subject, unsupported bound subject, cohort (including an evidenced parent),
pair or foreign directional grant refuses the whole request. A file that the
current selector cannot read also refuses the request; it is not left out.
Independent rights and reviewer origins explicitly refuse until their real
projection and authority path exist. The original account foreign key remains;
an uploader account is never substituted for an independent claimant.

The reachable path captures own adult metadata and source identities, stores a
queued job, and accepts fresh attempts under the current SQL-derived receipt.
The receipt binds the originating session and account revisions, exact subject
bindings, file source snapshots, grants, signatures, artifacts, consent clocks
and captured analysis rows. It is not an archive member manifest. Complete
account history, every permitted joint partition and the final ZIP member set
still need their real producer and final publication proof.

`export_archive_request_v1` supports capture, create, check and open-ready.
Create consumes the exact verified operation nonce in the same transaction as
the job and stores only the export cookie hash. The server must first verify
the signed token and the separate session-bound CSRF header; SQL rechecks its
scope, current receipt and five-minute lifetime. Check requires that exact
cookie and creates nothing. Open-ready also needs its own fresh nonce and a
separate download cookie hash. Its transaction exists, but the publication
trigger deliberately prevents any segmented export from becoming ready now.
A byte-complete summary must never be presented as a ready archive.

Only one live export for the same principal, concrete target and route can be
created. The profile lock serializes the check, including existing legacy
exports. Failed jobs do not silently restart. A new explicit create operation
needs a fresh nonce and cookie; old attempts and reserved keys remain separate.
An expired writing attempt must be stopped and reconciled. No new attempt
adopts its bytes. The five-minute attempt lease can be renewed while the same
receipt remains current; it never extends the job's original 24-hour deadline.

The core's initial authority hook uses read-only preflight before beginAttempt;
preflight cannot adopt an existing attempt. Subsequent authority hooks can renew
the same live lease and compare the same receipt. Discovery supplies the
database-owned principal hash and fixed deadline for the core's initial options.
The writer RPC reserves exact ordered keys before any object write, checks
actual Storage object ID, bucket, key and size at ACK, and stores pages of at
most 128 exact acknowledged descriptors. Object IDs and keys are unique across
attempts. The whole-stream and canonical manifest hashes remain trusted
producer observations; SQL does not claim to have hashed provider bytes.
Bounded dispatcher discovery returns at most 16 IDs, and grants no content
access. No dispatcher is installed by this change.

The migration creates only the registered private `exports` bucket, with a
4,000,000-byte whole-object limit and an octet-stream MIME type. An incompatible
existing bucket causes migration failure; it is not adopted or altered. No
client Storage policy is added. The surviving upload-only client policy names
`genomes`, and the old authenticated Storage policies were removed by earlier
migrations. The service adapter still writes only an exact reserved key.

Cleanup keeps every reserved key, including an unacknowledged write or a key
whose delete was already acknowledged. A late response can therefore never
hide the key from later reconciliation. A delete ACK alone never marks cleanup
complete. No RPC can yet claim the provider's late-write fence or physical
absence. That missing provider boundary, active retention dispatch, final
completion and account deletion for archives with reserved keys remain required
integration work before deployment.

The existing account purge can remove an empty queued or begun job under exact
job/attempt locks. Any reserved key refuses metadata deletion atomically,
including a key with a delete ACK. For an empty job, nonce records lose every
identity/envelope field and retain only the digest and original short expiry,
so deleting a queue cannot revive the token. A future bounded retention pass
must remove those expired digest-only tombstones. Legacy export deletion is
unchanged.

The new pgTAP file authors authority, nonce, cookie, reservation, manifest,
publication-hold and purge regressions. Its Storage rows are synthetic metadata
inside a rollback transaction. Its first execution, on 25 September, found two
functions reusing a PL/pgSQL row variable name as a table alias:
`export_archive_authority_v1` failed every request with `record "s" is not
assigned yet`, and the worker's `page` operation failed with `42702` ambiguity.
Renaming the four aliases fixed both; all 77 assertions then passed, as did
the full suite of 3,751. Reverting only the worker rename fails assertion 58,
so the suite covers it. These cases are still not evidence of provider upload,
physical deletion, complete archive membership, ZIP64 delivery or
independent-rights support.

## Worker RPC bridge

`archive-persistence.ts` connects the byte core's hooks to the service-only
worker RPC. It copies the discovered job and pins one fresh attempt. Discovery
grants no authority: the first check uses SQL preflight; begin and every later
operation perform the stored-origin checks in SQL. Renewals retain the original
job deadline and the five-minute attempt limit.

Every call is a POST with SDK retries disabled and a cancellation signal. The
bridge bounds each call by 30 seconds, the current lease and the job deadline.
A failed or uncertain operation closes that adapter permanently. Once begin
could have committed, errors keep cleanup responsibility. A late response
cannot resume the attempt, replace its receipt or publish a ready export.

Reservation, acknowledgement and page replies must match their exact copied
inputs. Completion accepts only the byte core's consistent counts and hashes;
its result remains `bytes-complete`. The bridge does not select archive members,
implement a dispatcher, expose a route or remove the database publication hold.
Tests use the installed SDK with an injected transport. They do not execute SQL
or prove a configured provider transport's redirect, origin or response-size
limits; that service transport still needs its own integration checks.

## Content reader

`public.export_archive_content_v1` (migration `20260925130000`) is the first
slice of `docs/export-member-selection-design.md`: a service-only, read-only
reader for one archive attempt. Every call takes origin, route, contract and
target from the stored job, recomputes the full authority graph against the
pinned receipt, and requires the job's exact active `writing` attempt with an
unexpired lease; it checks all of that again before returning. It writes
nothing: no nonce, lease renewal or row change.

- `context` returns the stored origin, route, contract, target, partitions,
  receipt, file count, lease and deadline, for the worker only.
- `files` pages every file in the captured partitions, 100 at a time by id,
  as exact current source snapshots. A file with no exact source refuses the
  whole read; it is never filtered out as the older list does.
- `check`, `variants`, `observed` and `ancestry` delegate to the existing
  per-file projection after the job checks. Prepared sources still refuse raw
  rows with `prepared_object_reader_required`.
- `reports` and `prs` export a completed run only under its purpose's current
  grant on **both** backends. The older helper applied that gate only to
  prepared sources, so on the database backend it still returns a report
  whose grant expired before the export was captured; this reader does not.
  Saved results are returned verbatim, never regenerated.

Its 44 pgTAP assertions ran locally with the full suite (91 files, 3,795
assertions). They cover the stored context, two keyset pages over 105 files
with nothing omitted or repeated, an empty account, malformed payloads, a
caller-supplied or foreign receipt, a foreign attempt, foreign and
out-of-partition files, a stopped attempt, an expired lease, an ended session,
a file added after capture, an unready file, the pre-capture expired grant and
an unchanged job, attempt, export, nonce, segment and download state after
every read. Planting a missing gate, a cursor that repeats its boundary or a
real lease renewal each fails its assertion.

Not covered: drift during a read from another session, which needs an
independent-session test; the prepared backend's reports gate, which is the
existing helper's and has its own suite; and every member class beyond own
genome files and their own results. This reader is not the complete member
selector, and the publication hold remains.

After #211 merged, the reader was applied to production the same day in one
guarded statement, with its five dependencies pinned to the tested definitions
(`docs/evidence/export-content-reader-production-apply-20260925/`). The
deployed application does not call it.

## History reader

Migration `20260925210000` starts step 2 of
`docs/export-member-selection-design.md`: the requester's own history,
readable only under an export job.

**The receipt now covers history.** `export_archive_authority_v1` builds the
`export-authority-v2` graph. It adds these whole rows:

- the account's legacy consents (`consent_grants`);
- its subject principals and subject account bindings;
- its account-keyed subject consents;
- its provider recipient grants;
- the captured subjects' demographics;
- the consent signatures it signed;
- the attestations its principals made or its signatures carry.

A new or revoked legacy consent, or any other revision of these rows after
capture, now fails the job, as a changed source or grant already did. A job
captured under v1 no longer matches its receipt and fails closed.

**One closed `history` operation.** The payload is `{kind, afterId}`. Each kind
reads one class, with the same scoping as the synchronous export's subject
record (`src/lib/export/subject-record.ts`):

| Kind | Rows | Account export | Subject export |
| --- | --- | --- | --- |
| `legacy-consents` | `consent_grants` for this account | all | refused |
| `subjects` | the captured partitions | all | the one subject |
| `demographics` | `subject_demographics` of the captured partitions | all | the one subject |
| `principals` | `subject_principals` for this account | all | that subject's |
| `bindings` | `subject_account_bindings` for this account | all | that subject's |
| `account-consents` | `subject_consents` for this account | all | that subject's |
| `recipient-grants` | `provider_recipient_grants` for this account | all | refused |
| `signatures` | `consent_signatures` this account signed | all | those about the subject |
| `attestations` | `attestations` by its principals or on its signatures | all | those about the subject |

- **Scope.** A subject export refuses the two account-level classes; the
  subject contract excludes unrelated legacy consents.
- **Columns.** Every kind returns a listed set of columns, never a whole row,
  so a column added later is not exported by default. A subject row names no
  account and no cohort. A signature never carries the encrypted signing
  name.
- **Pages.** Pages hold 500 rows in id order (demographics by subject id). A
  full page carries `nextAfterId`, so a class larger than the API's 1,000-row
  cap is read completely.
- **Checks.** The same job, attempt, lease and full-graph checks run before and
  after every read.
- **Writes.** It writes nothing.

`supabase/tests/export_archive_history_reader.sql` holds 60 rollback-only
assertions. It covers:

- 1,003 legacy consents read in three pages, with none missing, repeated or out
  of order;
- another account's rows of every class absent;
- signatures without their encrypted signing name;
- a subject export limited to its subject;
- closed payloads;
- unchanged job, attempt, export, nonce and history state;
- drift after capture (a consent added or revoked, a demographics edit, an
  ended recipient grant, a new attestation), each failing the job, while
  another account's change does not;
- a wrong receipt, a foreign attempt and an expired lease, each refused.

Six planted regressions each fail it: a receipt without history, a cursor that
repeats its boundary, legacy consents unscoped to the account, account classes
allowed in a subject export, the encrypted signing name in a signature row, and
signatures unscoped to the signer. The full suite passes: 93 files, 3,906
assertions.

Signatures other people made about this account's subjects are not included;
they belong to the non-self projections of step 3.

**Not yet:** chats and messages, the legal-audit slice (which has no requester resolver), and the
versioned member plan with its final set-equality check before ready.

## Chat reader

Migration `20260925220000` adds the requester's own Copilot conversations,
readable only under an export job.

**The receipt covers chats (`export-authority-v3`).** It hashes every own chat
on a captured subject, together with a digest of all its messages. A message
added or changed after capture fails the job, and a v2 job fails closed.

**Which chats and turns are exported.** `private.export_archive_chat_messages_v1`
decides this, following the chat-history contract (`chat-history-projection-v1`).
A chat is exported only when all of these hold:

- it belongs to this account and is scoped to a captured subject;
- its scope is `self`;
- it is canonical, not legacy unverified;
- the Copilot grant it was created under is still the same current revision;
- for a cloud model, the provider consent it was created under is too.

The export reads those grants directly, never the provider configuration or
its transport. Changing or deleting the settings supersedes the grants. That
ends the chats here, exactly as it ends them in the chat history, and queues
their deletion.

Within a chat, the first turn answered under a data projection that no longer
holds is omitted whole, together with every later turn. A chat with nothing
left is not listed.

**Two closed operations:**

- `chats` lists exportable chats, 100 per page by id.
- `chat-messages` returns one chat's exportable messages in history order,
  100 turns per page.

Messages carry only the history fields: `id`, `role`, `content`, `citations`,
`embryoFindings` and `createdAt`. No target ids, grant revisions, projections
or provider payloads leave, and there is no model call. The helper is not
callable by any role, including `service_role`.

`supabase/tests/export_archive_chat_reader.sql` holds 37 rollback-only
assertions. Two real conversations are committed through the Copilot protocol,
and the other account has a real one of its own. It covers:

- 103 chats listed across two pages, with none twice;
- a 106-turn chat read in two pages, every message exactly once;
- a stale turn, and the later turn after it, omitted whole;
- the closed message fields;
- a legacy chat, a stale-grant chat, another account's real conversation and
  an unknown id, none of them listed or readable;
- closed payloads;
- unchanged state;
- drift after capture (a new message, a revoked grant, deleted provider
  settings), each failing the job.

Six planted regressions each fail it:

- no stale-turn cutoff;
- no grant check;
- no legacy check;
- no account scoping at any of its four layers;
- chats absent from the receipt;
- the data projection in a message row.

The full suite passes: 94 files, 3,943 assertions.

Chats in other scopes (`subject`, `family`, `cohort` and `report`) are not
exported. Today they cannot occur alongside a capturable job, and they belong
to the non-self projections of step 3.

After #216 merged on 26 September, the migration was applied to production in
one guarded statement
(`docs/evidence/export-chat-reader-production-apply-20260926/`). The owner
confirmed both chat choices first. The statement pinned:

- both replaced functions, and the six existing functions the new code calls;
- the columns of the five tables the chat helper reads;
- no export job existing.

The deployed application does not call any of these functions.
