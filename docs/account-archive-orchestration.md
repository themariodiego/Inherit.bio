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
