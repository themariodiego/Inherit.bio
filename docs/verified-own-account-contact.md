# Verified own account contact

The positive keyless notice requires the current owner's self-account contact.
The original native cohort producer stores the owner's address only on its
separate genetic-parent principal. The retained diagnostic reproduces that gap;
it passed74 assertions and made no account contact.

The actual draft POST now calls service-only `create_embryo_cohort_draft_v2`.
Its server derives the address from `auth.getUser`, requires confirmation, and
seals/keys that address independently. The database locks current Auth, checks
the live recent own session, confirmation, non-deleting profile, exactly one
current self-account principal/binding, and every held contact HMAC revision.
It executes the unchanged canonical v1 draft producer and establishes the
self-account contact in the same transaction. Its response, nonce, parent slots,
custody and original draft expiry are unchanged.

The nullable `account_mail_contact_revision` column is on the existing contact
store. New contacts bind the independent current profile mail revision and
principal revision. A server-only insert guard makes proven revisions immutable; API service cannot
write proof through direct table access. Legacy contacts remain NULL; a current NULL, stale or
ambiguous contact refuses rather than being promoted or duplicated. Reuse keeps
the contact, indexes and their original expiry byte-exact. New indexes use the
original returned draft deadline; no new retention period is introduced.

A separate Auth email/confirmation transition trigger runs after the existing
readiness trigger. It rotates only proven self-account contacts, revokes their
indexes and invalidates queued/claimed mail for those exact contacts. An old
immutable owner notice loses current contact authority; its identity, package,
delivery clock and deadline are never rewritten. It creates no replacement
contact and leaves genetic-parent contacts unchanged. A fresh v2 draft may
establish new authority from the new current confirmed Auth email.

Existing contact purge selectors delete whole rows by exact principal/contact
identity. Export classifies the whole contact store as excluded-protected. This
adds no store, FK, purge-census count, email body, provider operation or scientific
result. Typed contact rows and the new RPC ABI are updated explicitly.

The SQL v2 fixture variants retain every original publication/transfer/profile/
documentary algorithm and assertion. Only their first native draft producer is
upgraded with explicit synthetic confirmation and actual held HMAC sets. They
exercise v2 production before actual authenticated notice preparation, refused
foreign/stale/duplicate/legacy/expired/deleted authorities, exact contact reuse,
and actual Auth-transition invalidation. These are authored SQL tests, UNRUN
until root's owned rehearsal; synthetic Auth/document/provider metadata confers
no browser-issued Auth, human documentary or provider-delivery credit.

Review POST diagnostics emit only a closed stage and approved SQLSTATE (or fixed
`unavailable`). Both existing bounded browser-log hops accept canonical frames
only. No IDs, emails, raw errors, authority, token, ciphertext, key or body field
is logged; opaque responses and all original browser assertions remain unchanged.

A user with an unproven current self-account contact from an older own-ready or
deletion producer is intentionally refused by v2. Migrating that authority is
remaining scope; it cannot be silently inferred. New schema means the old61
production guard is ineligible and must be regenerated/qualified. No acceptance
row, production availability or scientific/notice-delivery status is promoted.

The corrected migration is one owner-only atomic DO, so a guard/postcondition
failure rolls back its entire schema change without relying on caller transaction
setup. It rejects new-name overloads and trigger collisions, checks every new
function's exact body/typed metadata/owner/ACL and checks all original pg_proc
rows unchanged. The first guarded rehearsal stopped before TAP because one
arguments pin omitted the existing v1 defaults; its evidence is retained.

The separate lifetime successor adds strict source corrections after root's
91-assertion owned checkpoint: an elapsed current contact index cannot be reused,
and no reuse extends its original fixed deadline. A proven contact's ID,
principal, HMAC/key, authority revision and creation instant stay immutable.
Its ciphertext may only change to NULL in the existing shredded state; rotated
or shredded authority cannot return to current. Exact index identity/deadlines
are frozen on the existing store, with status revocation/expiry and child-first
deletion preserved. Legacy NULL rows retain their prior behavior.

Auth transitions also invalidate exact proven-contact mail whose contact was
already rotated by the unchanged readiness trigger or an earlier operation.
They revoke any remaining current indexes for those proven contacts, without
rewriting the historical contact or notice. The new mixed-mail fixture obtains
its readiness event through the real own normalization/report producer and
proves it reuses the existing v2 contact. These additional SQL probes are authored
and unrun until root's owned rehearsal; no scientific or provider credit follows.
