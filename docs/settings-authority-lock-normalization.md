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

This is source-only and unexecuted. New authored SQL tests pin full original
algorithms, actual API-role refusals, current/invalid live authority equality
and unchanged Auth/profile rows and operation counts. Existing tests are
byte-preserved. Root must reproduce the actual known interleavings before and
after on its owned clone, test single-row writers still block, rehearse exact
predecessor drift/collision refusal and rollback restoration, and qualify the
combined fresh database and full native settings journeys. These changes do
not establish global account-purge lock ordering, actual SDK authentication,
provider delivery or a completed Future Person release. Acceptance is unchanged.
