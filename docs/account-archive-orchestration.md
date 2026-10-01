# Complete account member orchestration

The segmentation core accepts a separate `prepareSource` hook after the real
durable attempt INSERT succeeds. The INSERT still has its original 30-second
limit. Source planning may sequence separately bounded reads and validations;
it is fenced by the original job deadline and cancellation signal. Each source
adapter retains its own operation limit, source expiry and before/after current
authority checks. The hook cannot admit ZIP bytes or provider writes until all
required member proofs succeed and the whole authority is checked again.

An ignored cancellation or late planner completion cannot start the source,
reserve an object or write bytes. An uncertain attempt INSERT retains the
existing cleanup hold. Existing callers without the hook keep their original
behavior and all read/write/metadata operation limits remain unchanged.

Focused tests preserve the existing segmentation assertions and prove that two
separate 20-second preparation steps complete after a real attempt, a stalled
INSERT still fails at 30 seconds, cancellation and the original deadline close
an uncooperative planner, and authority revoked during planning prevents source
acquisition. Synthetic operation seams establish orchestration behavior only.

The complete account executor must still connect every actual registered class
and authorized partition, independently prove complete member identities,
counts and bytes, and exercise real POST/status worker flow. Nonempty classes
without a proved producer remain a whole-request refusal. No public or READY
gate, provider choice, source lease, human authority or analytical grant changes.
This prerequisite supplies no database, hosted-browser or provider credit.

## 1 October 2026: consumed account executor source

`buildAccountArchive` now connects the actual consumed request/attempt readers
and complete byte planner for ordinary and claimed-bound own-account partitions.
The bounded durable begin completes before source planning. All nine history
inventories, ten supported metadata classes, six assigned scientific classes,
actual profile/purpose records and complete source descriptors are proved before
any archive segment reservation. Every selected subject has exactly the twelve
registered members, and the requester's actual actor ledger is generated once.
An unknown class, unproved nonempty class, missing member, partial source,
identity/count/hash drift, expired authority or cancellation refuses the whole
account. The thirteen unsupported classes, including both withheld Path B
stores, remain explicit refusals; this is not complete G5.6 coverage.

The saved-chat factory consumes complete100-header and200-message pages through
the existing consumed account content door, retains only canonical own saved
history, checks exact scope/fields/citations and message identity/count/hash to
EOF, and rereads the same current history on member open. It makes no model call
and exports no internal credentials or canonical grant/projection fields.
Ordinary science retains the original saved report/PRS/ancestry output, every
prepared canonical disposition/header and actual source counts. Original bytes
require complete raw and decoded EOF proof and exact fresh read identity.
Genuine prepared original retirement omits that member while retaining canonical
records and saved reports. Bound sources use the distinct audience/current
location proof, exact complete immutable part set and EOF identity; no original
parent source or descriptor is mutated.

When current metadata and retained/scientific records share one required JSON
member, the composer preserves each producer's entire original document inside
`sections: [{kind, content}]` under `subject-partitioned-archive-v1`. It never
flattens, overwrites or drops a historical signature or source record. The
member count is the sum of its actual producers' logical row counts. Global
ledger, raw/text member and same-producer collisions refuse. Root indexes remain
the existing closed pointer documents, and assigned custody audit events retain
their exact subject selector and original privacy rules.

Owned output fragments coalesce to32KiB under backpressure, retaining byte order,
counts, hashes, EOF, caller cancellation and the original invalid-fragment cap.
Original source range transport stays unchanged. Every ZIP boundary rechecks
the durable exact current graph receipt; the SQL current reader recomputes the
complete metadata/class/source frame. Each factory separately rechecks its own
content and complete EOF. Replaying every factory context recursively at each
small punctuation fragment was redundant and made the unchanged five-second
prepared-plus-bound unit case fail under focused parallel pressure. That failed
receipt is retained; no timeout or assertion was changed. The bounded coalescer
and original current receipt checks pass191 focused tests across eight files.

Actual ZIP generation tests independently inspect the complete member set,
byte size and SHA-256 of every artifact, original source equality, current bound
part bytes, saved scientific content, all prepared dispositions and genuine
retirement. They deny each of the thirteen nonempty unsupported classes,
foreign bound actor/subject/file, missing/truncated source, changed report,
current revocation and cancellation. An uncertain writer keeps the cleanup hold
and never records completed bytes. These are synthetic unit seams through the
real code, not genuine Auth/database or live provider execution.

No migration, new store, human JWT, analytical grant, public gate, READY state,
provider implementation, download or email is introduced. The writer remains an
explicit existing internal capability; no live provider write occurred. The
owner's unresolved export delivery/storage choice is held. The actual account
HTTP route remains GET-only: registered POST/status orchestration, native
browser proof, full combined qualification, thirteen remaining class/projector
proofs and live delivery/uncertain-write disposal remain outstanding. No
acceptance row or completion claim changes.
# Consumed request, status and scheduling continuation

The NEXT-RELEASE continuation consumes the existing account request/nonce/job
doors through the actual POST handler in `src/app/api/export/route.ts` and
`src/lib/exports/account-export-http.ts`. Fresh `getUser` and cryptographically
validated `getClaims` select only the actor's own account/session; the complete
SQL capture and create recheck the current session, owner, principal, revisions,
all source/member frames and all unsupported graph refusals. An exact configured
canonical Origin, same-origin fetch metadata, cors mode and bounded closed JSON
precede protected RPCs. The two separately randomized proofs are the explicit
body operation and signed header CSRF. A presentation emits exactly one operation
nonce bound to that CSRF digest. The SQL create transaction consumes that unique
nonce with its exact CSRF digest; swapping proofs from two genuine presentations
cannot create a request. Rendering is read-only and does not mint a job/cookie.

Only a proved internal generation capability may allow create. The current
`approvedAccountArchiveGeneration()` returns null: the export provider remains
an unanswered owner choice. The actual POST refuses before durable create;
the native operator entrypoint refuses before client creation/discovery/begin
with one coded message and no IDs or credentials. This does not select the
existing Supabase adapter, repurpose a source R2 capability, or implement R2
delivery. The action presentation is not connected to public UI while delivery
is closed. A future capability must supply the complete existing executor's
RPC/range/write interfaces plus genuine provider configuration/readiness proof.
No request Boolean or ambient opt-in flag can admit it.

After an authorized create, only the returned server ID and a new random secret
enter the Secure, HttpOnly, SameSite Strict `__Host-inherit-export` cookie. SQL
records a context-separated digest of the secret bound to the originating
account/session. The opaque ID selects one row, and that exact row must have
the matching digest/current origin; it never grants authority. Duplicate,
malformed, foreign or stale cookies refuse without a replacement. A cookie-
present GET invokes only the existing check door and returns the registered
small pending body, with zero enqueue, new nonce, cookie rotation or download
session. The no-cookie synchronous GET remains unchanged for compatibility;
this transition is not claimed as completion of the register's full GET-only-
poll architecture. The existing check door does not supply complete READY
size/hash/member proof, so a ready status refuses instead of inventing metadata.
Explicit open-ready independently verifies current cookie/status/action/CSRF
but remains unavailable with zero open-ready or create writes.

Migration037 adds only `public.export_archive_account_due_v1(uuid DEFAULT NULL)`.
It pins the entire original mixed dispatcher's body/ABI/default/configuration/
ownership/ACL predecessor and leaves that function unchanged. The narrow reader
requires both actual service role and service JWT, joins the exact account origin,
route/contract/owner/target, queued state/no active attempt and original deadline,
and returns at most16 ordered four-field metadata descriptors. It adds no store,
table grant, browser/upload execution or READY. Discovery is not authority: the
complete existing worker independently preflights, begins, checks every member,
streams complete EOF/hash proof and retains uncertain-write cleanup holds.
Scheduling handles one bounded page serially, rechecks capability before every
fresh job, preserves the original30second per-operation bounds and stops without
retrying/skipping a refusal. It never persists or forges a human JWT.

The source units prove the real signed request/header pair, exact cookie/status
behavior, closed capability, source/current-owner races, bounded scheduling and
existing complete ZIP64 generation. RPCs/Auth/provider seams in these units are
synthetic, not native or live provider evidence. The authored pgTAP fixture uses
real role/JWT settings and actual request/nonce/begin producers for its positives,
flushes deferred creation constraints, and tests sixteen plus one exhaustive
jobs, exact fields/cursors, all role denials and exclusion predicates. Owner-only
negative row corruptions roll back and do not represent genuine rights claims.
Its database execution remains root-owned and unproved at this source checkpoint.
All thirteen nonempty unsupported classes still refuse the whole request.
No public delivery, READY, accepted row, full graph or provider proof is claimed.
