# Settings authority lock normalization

The earlier read-only inventory fix closes the reproduced inventory/read cycle,
but its independent source review found two remaining settings lock inversions.
The profile context still acquired subject/cohort/embryo shared locks before
Auth and profile locks. The mutable owner resolver acquired a session shared
lock, then profile and subject exclusive locks, then upgraded the session.
The owner scope getter reused that mutable resolver. Same-session calls could
therefore retain shared session locks while waiting on an exclusive profile
held by the caller attempting the session upgrade. Different current sessions
could also invert the profile and subject order.

`20261002092244_settings_authority_lock_normalization.sql` changes only these
settings profile and owner-objection paths. The ordered prefix is the exact
Auth user, the exact account-owned Auth session, the account profile, then the
existing entity locks. A separate statement acquires each row lock. Readers
use shared locks. Profile writes use an exclusive session and shared profile
lock before the existing exclusive subject lock. That profile SHARE conflicts
with the strong owner resolver's profile UPDATE before either caller can take
an entity lock, including when they use different current account sessions.
It also stays compatible with the unchanged signed-consent fingerprint, which
locks the full current parent user/profile matrix SHARE NOWAIT. A profile UPDATE
in this prefix would introduce a valid other-parent contention refusal, so it
is deliberately avoided. The Auth user is locked first to match the verified
contact producer's user/session/profile prefix.

The profile context adds a shared prefix, then executes its complete existing
body unchanged, including each original clock evaluation and current-parent,
consent, recipient, disposition, deletion, retention and physical-purge check.
The save and delete functions add the stronger prefix immediately before the
original subject lock. Save's input-shape refusal remains earlier. All original
write, nonce, independent-key, expiry, retention, audit and result code remains.

The mutable owner resolver calls an API-denied strong copy of the complete live
validator. That copy changes only the exact session SHARE lock to UPDATE after
the original JWT format/issuer/role checks and separate user SHARE lock. The
original validators remain unchanged; the later original sensitive validator
still checks recent reauthentication and MFA at its original location. The
scope getter uses a separate read resolver, retaining the same complete notice,
owner, delivery, expiry and current-authority checks with shared locks. The
objection submit function retains its complete original source and250ms bound.

The single owner-only migration DO pins16 predecessor functions: the actual15
complete target/dependency definitions captured from the diagnostic clone,
plus the already-qualified owner inventory successor. Every semantic ABI,
default, result, owner, flag, configuration, ACL/grantor, effective API privilege
and body digest must match. Full runtime pg_proc metadata is compared after
replacement, allowing only each reviewed prosrc change. Four new helpers are
API-denied, owner-only with pinned full metadata; any same-name helper overload
collision refuses before DDL. There are no new stores, retention clocks,
provider contracts, public routes or data/registry writes.

## Actual local diagnostics, 2026-10-02

Root applied the exact66 pending source migrations and the new SQL suite inside
one rollback transaction on the preserved155 baseline: all74 assertions passed.
Six guard probes passed: accepted source, changed cost, extra API grant, valid
full-body comment drift, helper overload and service-role owner refusal. The
entire original database and raw function metadata were exact after rollback.
The original database SHA256 was
`652f6ba27ac4cbbd0dbc9a3b4ebf985c8f031d0ba7d37231b673f09bcb481e07`.
The first malformed diagnostic comment and failed run are retained.

Receipts are under `integration-evidence/20261001/`:

- `settings-authority-normalization-actual-first-append/receipt.json`: query
  `b70ac6dc29d28801bd6e80750d1fb7277a619eee95c95d37545c760f10e01bee`, log
  `7293398f04505bd43a9745204ac74c8b7e7b6da82b57970553833c5ba7d1d0fa`.
- `settings-authority-normalization-actual-guard-corrected-probes/receipt.json`:
  query `05f562200aa56bd931f16a5b6be4ebc7181864dd1f9f1bb4302d58f25e6d792f`,
  log `e6293004ab67e3abff5fa4b07a5047fc4a0b5f1b7d33cd522c0675bba060ae23`.

A separate disposable database, `inherit_settings041_20261002_1001`, contained
the exact66-migration `c21aacaeca9f40977ae6c01631304bd0221cc2f8` prefix. Its
settings migration is byte-identical to frozen
`f6931815327f3cac95873d7579799de6069f6517` and the integrated source. Its95
passing setup assertions executed the original synthetic publication,
two-parent disposition, documentary, owner-notice and callback SQL producers.
Distinct current synthetic SQL Auth sessions and a separately confirmed
prospective embryo allowed real profile writes without invalidating the notice.
Historical metadata, JWT-shaped SQL context and provider ACK metadata are
explicitly synthetic; they prove no SDK, native MAC or physical delivery.

Five corrected controlled interleavings completed through the actual functions:

| Actual call pair | Controlled order | Result |
| --- | --- | --- |
| Profile save / owner scope and inventory | Same session; reader first behind an owned profile gate | Writer waits on reader; both complete after release |
| Profile save / owner scope and inventory | Distinct sessions; reader first behind profile gate | Writer waits before entity lock; both complete |
| Objection submit / profile context read | Distinct-session reader first behind its session gate | Submit completes while reader is gated; read completes after release |
| Objection submit / profile context read | Same-session reader first | Submit waits on reader, then completes after its rollback |
| Objection submit / profile context read | Submit first; distinct reader | Reader waits on submitter, then completes after its rollback |

Observed waits name exact backend/blocker pairs. Each successful submission
also proves its consumed operation nonce, current objection and exact new review
assignment inside the transaction. Each pair rolled back to the complete same
catalog/data/sequence snapshot. The same-session submit controller took281ms in
total; the actual function retained its original250ms lock timeout and completed
successfully. This is not a whole-transaction latency claim below250ms.

Replacing only the five functions with their original captured definitions
reproduced a reciprocal wait between actual profile save and owner read.
One cancellation of the exact owned reader returned57014. No40P01 was forced
and no timeout changed. Restoring the successor definitions reproduced every
complete raw pg_proc record, including OIDs, owners, ACLs and source. The entire
committed synthetic setup snapshot returned exactly to SHA256
`0ce389102a841d87dea0cd71e111c334df0830e24223ee52d057accd8e357e1b`.

The durable packet is
`integration-evidence/20261002/settings-authority-lock-normalization/controlled-probes/inherit_settings041_20261002_1001/durable-final-review-receipt.json`
(SHA256 `e55b127ca6c2d1333f42557720197970793ee8f0625eaa3bd50ba6be5edc6656`).
It retains full host snapshots, blocker observations, raw function captures,
sequence restoration receipts and first fixture failures. Root's local stack
reset at10:23:33 subsequently removed this database and its container-local
backups. The later final-backup attempt stopped on the missing database;
no retained final binary backup is claimed. No immutable guard was bypassed
to erase setup. Known restore-platform differences preclude full platform parity.

## Remaining scope

Combined fresh-database and complete native settings qualification remain
separate. The unchanged due account-purge consumer takes profile UPDATE before
deleting Auth sessions. A newly current session on an already deleting account
therefore still needs a separately scoped purge-order review. An early
committed-hold denial must preserve original refusal semantics and all later
authority validation; this migration does not implement it. No global purge
ordering, actual SDK authentication, provider delivery, elapsed period or
completed Future Person release follows. Acceptance is unchanged.
