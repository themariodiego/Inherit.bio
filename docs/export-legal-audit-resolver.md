# Legal audit slice in the export: design note and owner question

Status: decided and built, 28 September 2026. The owner chose A, with C as
the interim (docs/protocol/decisions.md). "What was built" at the end records
what shipped and what still records no one. The analysis below is kept as it
was put to the owner.

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

## What was built

Two changes. The first needs no migration and can ship alone.

**C: the honest, empty file.** The synchronous export writes
`legal-audit.json` in every archive, and the manifest counts it.
`/settings/data` no longer says legal audit records are missing. It says:
"It has a legal audit file of what you did yourself. Records that don't say
who acted are left out." That sentence is true before and after A.

**A: who acted, and the person's own slice.** Migration
`20260928160000_legal_audit_attribution.sql`.

- **Who acted is derived at append time.** Only
  `private.append_legal_audit_event` is redefined. None of the 29 writer
  functions (65 call sites) changes. The writer records an actor only when the
  transaction already carries proof:
  - consuming a session-bound, single-use operation nonce: embryo operation
    nonces, purpose-grant nonces, and account operation nonces when their
    `consumed_at` is set. A trigger on each table records that account for the
    rest of the transaction;
  - a request made with the person's own JWT (role `authenticated`). No writer
    is callable that way today, so this path is dormant.
- **Never guessed.** No proof, two different accounts in one transaction, or a
  nonce and a JWT that disagree: the event records no one.
- **Only a person's own acts.** An actor is recorded only on a closed list of
  21 event codes a person causes: grants and revocations, jurisdiction and
  chromosomal-sex declarations, family sharing pauses, portrait
  acknowledgement, invitations, embryo signatures, cohorts, dispositions and
  record keys, and rights sessions. Never on a job route. Purges, expiries,
  retention, checkpoints and blocked responses are the service's acts and
  record no one, even inside a person's transaction. A new event code records
  no one until it is added to the list.
- **The pseudonym.** Each account that acts gets one random audit pseudonym.
  `private.legal_audit_account_principals` links the account to it. The link
  is deleted with the account, which leaves every ledger row byte-identical
  and no longer linkable to anyone (L-49). It is a registered purge store of
  the `audit-principal-link-key-envelope` target, so the pinned store count
  moves from 125 to 126.
- **The chain hash covers the actor**, so attribution cannot be edited later.
- **The synchronous export** reads `public.own_legal_audit_events_v1`, which
  applies the export's account and session gate and returns the requester's
  own events in pages of 500. Each event carries `seq`, `occurred_at`,
  `event_code`, `route_id`, `outcome_code` and `coded_context`. It never
  carries the pseudonym or the chain hashes. The file states when attribution
  began, and says an empty list is not "nothing happened".
- **The asynchronous export** gains a closed `legal-audit` history class,
  paged by sequence. The receipt becomes `export-authority-v4` and hashes the
  requester's slice, so an event the person causes after capture fails the
  job. The class is account-only: an event records no subject.

**Still records no one.** These writers authenticate without consuming a
nonce, so their events name no one yet:

| Writer | Events |
| --- | --- |
| `declare_jurisdiction_v2` | `jurisdiction.declared`, `jurisdiction.reaffirmed`, `purpose.revoked` |
| `declare_chromosomal_sex_v1` | `demographics.chromosomal-sex` |
| `pause_family_sharing_v1`, `resume_family_sharing_v1`, `stop_family_sharing_v1` | `family.sharing_*` |
| `revoke_directional_purpose_v1` | `purpose.revoked` |
| `acknowledge_portrait_v1` | `portrait.acknowledged` |
| `create_adult_subject_invitation_v1` | `invitation.issued` |
| `adult_subject_invitation_response_v1` | `invitation.accepted`, `invitation.refused`, `invitation.deleted` |
| `activate_rights_session_v1`, `refuse_co_parent_invitation_v1` | rights-session nonces carry no account |

Each closes the same way: have the route issue a session-bound operation
nonce and the writer consume it, or have the writer note its own verified
account. Both change the writer, so each is its own reviewed change.

**Register divergence.** The register names an encrypted link
(`audit_principal_links` with an envelope key in `audit_principal_link_keys`).
Encryption only helps if the key is held outside the database, and an
in-database append cannot reach such a key. The link here is a plain row with
a foreign key, deleted with the account. Holding the key outside the database
would need the application to create each pseudonym before the writer runs.
That is a separate decision.

**Tests.**

- `supabase/tests/legal_audit_attribution.sql`: 67 assertions. They cover each
  kind of proof, conflicts, service events, a real own-report grant, the chain
  hash, the slice and its gate, pages across 1,000 events, unlinking, and the
  asynchronous class and its receipt. Its last section plants a slice without
  the account join and a writer without the closed list, and shows the checks
  catch both.
- Planted copies of the migration were each run against it and fail it: a
  slice that exports another account's event, the same in the asynchronous
  class, a system event attributed to a person, and a second account silently
  replacing the first.
- `src/lib/export/legal-audit.test.ts` and `src/app/api/export/route.test.ts`
  hold the synchronous reader to a closed shape, full paging and a 503 on any
  failure.
- `e2e/export-subject-scope.spec.ts` chooses a report through the real page.
  It then checks that `legal-audit.json` holds exactly the events the ledger
  attributes to one actor, including that grant.


## 1 October 2026 ordinary subject targeting clarification

The owner-approved A slice identifies the actor, not the target of an ordinary
subject event. The existing account reader remains account-only. An ordinary
`subjects/{subject_id}/audit-log.json` therefore has the exact registered
`legal-audit-v1` unrecorded metadata and count-free explanation. Its empty
assigned-event array is not a claim that no historical actions occurred. All
actual requester actor events stay once in the canonical `legal-audit.json`.
No event is copied under a guessed subject, and no actor is backfilled.

The new consumed-job/current-attempt worker reader also includes only genuinely
issued own Future custody/binding events in that canonical ledger, once by
sequence. Each genuinely assigned Future subject keeps its existing exact
subject ledger. The ordinary door refuses actual custody/account-binding
selectors and any unproved current partition. This implements A; it does not
adopt the unapproved events-about-the-person policy B.

This is a TEST-LOCAL producer clarification. It supplies no READY transition,
public route or provider delivery, and does not finish the remaining whole
account/non-self/cohort/joint member inventory.
