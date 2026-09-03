# ADR 0014: Third-party adult subject: consent, sharing and revocation model

- Status: Accepted
- Date: 2026-09-03
- G7.1 name: "the third-party-subject consent and revocation model"

## Context

The brief's Family domain (§2 §5, lines 326–368) lets one adult see another
adult's results only with that adult's own consent, given from their own
session, per purpose and per direction, with no reciprocal grant and no
master switch (§5.3, line 340); it makes pause reversible from either side
and stop the one destructive action, with every derived result deleted
within 60 seconds and a tombstone on both accounts (§5.4, line 342); it puts
"any result about another adult" behind one explicit, session-scoped Tier-2
gate whose choice is never written to device storage (§3 §7.2, line 968);
and X3.4 (line 2414) requires access to end on the next query. G7.1 (line
2664) requires this decision to be recorded with the alternatives that were
rejected and the evidence that rejected them.

Two repository facts shaped the model more than the brief's prose did:

- **An accepted invitation binds the invited record to the invitee, but
  every file is bound to its uploader's own `self` subject.** After
  acceptance the invited `other_adult` record has `owner_account_id` null
  and `subject_account_id` = the invitee, so the inviter can neither list
  nor resolve it through `listSubjectsForAccount`, and the invitee's genome
  lives on their `self` subject, never on the invited record
  (`src/app/api/uploads/route.ts`; `docs/design/w9-family-surfaces.md` §0).
- **A grant is one purpose in one direction, as two rows at one revision.**
  `docs/schema-requirements.md` (the grants section): "A purpose grant is
  exactly one purpose. Wildcards and family-wide implicit grants are
  forbidden." `public.purpose_grants` is the base row and
  `public.directional_grants` its mandatory direction extension; neither
  authorises anything without the other at the same `grant_revision`
  (`docs/route-register.json`, `policyContracts.directional-purpose-grant-v1`).

The platform half of this model (the migration
`supabase/migrations/20260903120000_family_sharing_runtime.sql` and its
pgTAP file `supabase/tests/family_sharing.sql`) was built first as W9 part F0
and proven by CI run 33782021006; the surfaces were built as part F1. This
ADR records the model both halves implement.

## Decision

1. **A person is a handle plus a data subject.** `FamilyPerson`
   (`src/lib/family/graph.ts`) separates the record the route names
   (`handle`, always `s-{uuid}`) from the subject whose rows are read
   (`dataSubjectId`, the counterpart's own `self` subject). The graph is
   built from three sources joined in one place: accepted `adult_subject`
   invitations from either side, `other_adult` records the account owns
   (Path B, which no screen creates yet), and live grant pairs in either
   direction. `minor` records are excluded everywhere; a minor segment is a
   404 like an unknown one.

2. **Consent is a directional purpose grant signed from the data subject's
   own session, through a single-use presentation token.** The permissions
   page (`src/app/(app)/family/[person]/permissions/page.tsx`) renders two
   independent columns of the same five rows, all default off, with no
   master switch. The column about the other person is rendered but never
   settable here: every row says "Only {name} can turn this on." The
   settable column carries, per row, a token this server component minted
   for exactly one signer, data subject, recipient principal, purpose,
   artifact version and revision pair (`src/lib/family/grant-token.ts`).
   `POST /api/consents` recomputes every endpoint from the token, never from
   the body, and `grant_directional_purpose_v1` consumes the nonce before
   any write, so a token for the opposite column, another recipient or a
   stale revision cannot be retargeted. Revocation goes through
   `revoke_directional_purpose_v1`, which terminalises both rows together.

3. **Pause is a predicate, stop is a deletion.** `pause_family_sharing_v1`
   writes one current row to `family_sharing_pauses`, keyed by the two
   accounts, and changes no grant row; `private.resource_authorized_v1`
   reads that row on every check, so every derived surface denies on the
   next request while the permissions page still shows each row as On.
   `resume_family_sharing_v1` ends the row and is guarded by the
   jurisdiction, because resuming makes results visible again. Pause, stop
   and revoke are rights and bypass the jurisdiction gate.
   `stop_family_sharing_v1` revokes every grant both ways, deletes the joint
   outputs and the chat context, revokes the pairs, writes the tombstone
   both accounts read (`family_sharing_stops`) and enqueues the
   `purpose.derived-60s` purge for each side (`docs/retention.md`). The
   confirmation dialog is tier 2 of brief line 936: it names the person,
   lists by name what will be deleted, and the confirm button repeats the
   verb. The stop request carries a short-lived operation nonce bound to
   this session's account and counterpart, minted by the page that rendered
   the dialog.

4. **Jurisdiction before consent, and neither is a blank.**
   `familyCapability` (`src/lib/family/access.ts`, over
   `src/lib/legal/jurisdictions.ts`) resolves the acting account and every
   contributor against `data/jurisdictions.json` and returns the strictest
   answer (G5.1b); an unset code is `unreviewed`, never `permitted`. A
   refusal renders the register's own copy. Only after that does the page
   ask which purposes are live.

5. **One Tier-2 gate per session, at the domain boundary, in an httpOnly
   cookie.** `POST /api/family/acknowledge` sets `inherit_family_gate`, an
   httpOnly, Secure, SameSite=Lax session cookie with no Max-Age whose
   value is a keyed digest of the account id and the current auth session
   id (`src/lib/family/tier2.ts`). It is compared in constant time, it
   cannot be forged or read from the browser, `/auth/sign-out` clears it,
   and a cookie carried into a new session no longer verifies because the
   session id changed. While it is unset every page about another adult
   renders the gate and fetches nothing derived.

6. **A record with no live purpose answers 404, before the gate.**
   `resolveSubjectRoute` (`src/lib/family/subject-route.ts`) resolves a
   subject-derived route for both domains in one order: the account's own
   record, then the Family graph, then the jurisdiction, then the live
   grants, then the gate. A Family segment none of whose requested purposes
   is live returns not-found before the gate is consulted, so a paused,
   revoked or stopped relationship is indistinguishable from an unknown
   record, and a reader never passes a gate to find nothing.

7. **Portrait and heritability grants need an independent login.**
   `grant_directional_purpose_v1` refuses `family.heritability` and
   `family.portrait` while the data subject's `independent_login_at` is
   null. `mark_independent_login_v1` stamps it once, from a server-verified
   session of that account that post-dates every accepted invitation for
   the subject, so the session an invitation was accepted in can never
   supply it: an inviter who set up the invitee's account through the link
   cannot sign both columns. The app calls it from the ordinary sign-in
   exchange (`src/app/auth/callback/route.ts`) and, because a password
   sign-in completes in the browser and passes through no server route, on
   the first server-rendered visit to a permissions page
   (`src/lib/family/independent-login.ts`). Until it is stamped the Portrait
   row renders locked with its reason rather than as a control that would
   fail.

8. **Path A only.** The invite screen offers "Invite them." and no Path B:
   the link "They can't use Inherit themselves" renders only once Path B
   exists, because a link to an unbuilt flow is a dead link. The optional
   note travels in the invitation mail as words, never as a link.

## Alternatives rejected, with the evidence

- **Move the invitee's files onto the invited record, so one subject holds
  everything.** Rejected: `subjects_one_self_per_account_idx`
  (`supabase/migrations/20260831221537_subjects_and_principals.sql`) allows
  one `self` subject per account, and the upload path binds every file to
  the uploader's `self` subject; the invited record can hold no file, so the
  handle/data-subject split is the only shape that reads anything.
- **A family-wide or reciprocal grant.** Rejected by
  `docs/schema-requirements.md` ("Wildcards and family-wide implicit grants
  are forbidden") and by `directional-purpose-grant-v1`'s `directionality`
  rule ("family-membership-or-a-purpose-on-one-subject-never-implies-a-global-family-grant-or-the-reverse-direction"),
  and by brief §5.3 ("No reciprocal auto-grant, no master switch").
- **Pause by mutating the grant rows to an inactive status.** Rejected:
  `family-sharing-state-v1` forbids a pause from deleting or terminalising
  any grant row, and `directional_grants` has no reversible inactive
  status; a pause row read at every authorisation check is the one design
  that is reversible from either side and deletes nothing.
- **Remember the Tier-2 acknowledgement in `localStorage`, as the Tier-1
  report gate does.** Rejected by brief §3 §7.2: the Tier-2 choice "is never
  written to device storage" and lasts "for the remainder of the signed-in
  session only".
- **Ask again on every visit (`?reveal=1` with no memory).** Rejected: it
  contradicts the mandated sentence "You won't be asked again until you sign
  out."
- **Render the gate before checking whether anything is shared.** Rejected:
  a gate the reader can pass to find nothing tells them the record exists;
  the 404-before-gate order keeps a revoked or paused relationship
  indistinguishable from an unknown record (register
  `resource-not-found-page-v1`).
- **Stamp the independent-login marker only in the auth callback, as the
  register's `auth.callback.independentLoginMarker` describes.** Rejected
  as insufficient on its own: the password sign-in (`src/app/auth/sign-in/page.tsx`)
  runs `signInWithPassword` in the browser and never reaches that route, so
  the marker would never be set for the common path and every Portrait
  grant would fail. The routine carries the proof, so calling it from a
  later server request loses nothing.
- **Build Path B now.** Deferred, not rejected: it needs the `subject_consents`
  row, the e-signature or uploaded-document evidence and the `/withdraw/[token]`
  deletion without uploader involvement (brief §5.2), none of which exists;
  shipping its link first would be a control without a mechanism.

## Consequences

- Every derived read about another adult passes through one resolver and
  one access module; no page repeats the rules. The unit suites
  `src/lib/family/{graph,access,tier2,grant-token}.test.ts` prove the graph
  branches, the pause suspension, the one-purpose-per-layer mapping, the
  cookie digest and the token binding without a database.
- `e2e/family.spec.ts` proves, against the local stack: the invitation with
  its note as words; a grant from the invitee's own session only; one Tier-2
  gate per session and results attributed to the counterpart's own subject;
  the Portrait row locked in the acceptance session and settable after a
  sign-in of the invitee's own; and pause, resume and stop taking effect on
  the very next request, with zero live grants after stop.
- The database routines are proven by `supabase/tests/family_sharing.sql`,
  first executed in CI run 33782021006.
- Open: Path B, the counsellor directory under the gate (X16.2), and the
  cross-account account-deletion graph (an account with any cross-account
  sharing still fails closed on deletion, by design of
  `assert_supported_self_deletion_graph_v1`).
- The capability register's Family rows and the acceptance matrix's G5.1b
  and G7.1 rows cite this ADR.
