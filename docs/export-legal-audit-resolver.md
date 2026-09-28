# Legal audit slice in the export: design note and owner question

Status: needs an owner and counsel decision. Nothing here is built. Written
28 September 2026 for G5.6 and L-34.

## What is required

- L-34: "The existing one-click complete account export contains a
  `legal-audit.json` file covering the user's own slice."
- The register (`docs/route-register.json`, `subject-partitioned-archive-v1`)
  says `legal-audit.json` is "the requesting principal's own closed
  `legal_audit_log` slice", and never a second event store.
- The subject export may include "only events whose target is the bound
  subject", with every counterparty identity redacted unless that person
  currently authorizes disclosure.
- L-49: deleting a subject pseudonymises its ledger rows in place. The ledger
  itself never changes; only the link and its key are destroyed.

## What the ledger holds today

Measured from the migrations on 28 September 2026:

- `public.legal_audit_log` rows carry `event_code`, `occurred_at`, `route_id`,
  `outcome_code`, `coded_context`, the chain hashes, and a nullable
  `audit_principal_id`.
- `coded_context` may not carry `account_id`, `subject_id`, an email, a name, a
  token, an IP address or a user agent. A check constraint enforces this.
- There are 65 calls to `private.append_legal_audit_event` across 20
  migrations, covering 30 event codes. **Every one passes a null
  `audit_principal_id`.**
- Nothing inserts into `public.audit_principals`, `audit_principal_links` or
  `audit_principal_link_keys`. The pseudonym tables are empty.
- The coded context keys are purposes, revisions, kinds and counts. None is an
  identifier that could be joined back to a person.

So no row in the ledger can be attributed to anyone. This is by design: the
ledger was built to prove what happened without saying who. A resolver cannot
be written against the current data. Every existing event would stay
unattributable under any option below.

## The decision

Which events may a person's export show them?

The engineering part is the same for every option. Each account gets one
audit pseudonym (`audit_principals`) with an encrypted link to the account
(`audit_principal_links`) and an envelope key (`audit_principal_link_keys`).
Writers pass the acting account's pseudonym instead of null. The export looks
up the requester's pseudonym and reads its events. Deleting the account
destroys the key and the link, and the ledger stays byte-identical (L-49).

What differs is what the slice contains.

### Option A: only events the person caused (recommended)

- `legal-audit.json` lists events whose `audit_principal_id` is the
  requester's own pseudonym: their consents, revocations, jurisdiction
  declarations, invitations they sent, sharing they paused.
- Each row carries `seq`, `occurred_at`, `event_code`, `route_id`,
  `outcome_code` and `coded_context`. `coded_context` already excludes every
  identifier.
- Events other people caused are not included, even when they concern the
  requester. Examples: an invitation someone sent to them, or a pause the
  other family member made.
- Events recorded before attribution began are named as a count-free
  statement: "Events before <date> were recorded without saying who caused
  them, so none of them can be shown as yours."

Why recommended: it discloses nothing about anyone else. It matches the
register's "requesting principal's own slice" word for word. Counterparty
redaction is the register's default.

### Option B: events the person caused, and events about them

- As A, plus events another person caused whose target is the requester or
  one of their subjects. The other person appears only as a role, such as
  "the other family member" or "an inviter".
- Needs a second link on each event: the target's pseudonym as well as the
  actor's.
- Some of these events would tell the person something the product does not
  show them today. The sharpest case is `invitation.blocked`, which L-05
  requires and which is not written yet: it would tell a person that someone
  tried to invite them again after they refused. That may be what they want
  to know, or it may put them at risk.

Why not recommended now: it needs counsel's view on whether the right of
access covers events about a person that another person caused, and on the
blocked-invitation case in particular.

### Option C: ship an honest empty file now, decide later

- `legal-audit.json` appears in every archive with its schema version, an
  empty array, and the statement that no event can yet be attributed to
  anyone.
- The manifest keeps saying that legal audit records are not yet included.
- This can ship with either A or B later, and costs one small change.

C does not meet L-34 on its own. It makes the absence visible inside the
archive rather than only in the manifest.

## Recommendation

A, with C as the interim until A is built. Ask counsel about B separately;
it can be added later without changing A.

## What follows from each answer

- **A or B:** a migration adds pseudonym creation and passes it to all 65
  writers, a reader class `legal-audit` joins the asynchronous history reader,
  and the synchronous route writes `legal-audit.json`. Each needs pgTAP with a
  second account whose events never appear, and a deletion test showing the
  link and key gone with the ledger unchanged. `public.legal_audit_log` moves
  from `deferred` to `exported` in `docs/export-member-plan.json`.
- **C only:** one route change and its unit test. The plan entry stays
  `deferred`.
- **In every case:** existing events stay unattributable. Back-filling them
  is not possible, because nothing recorded who caused them.
