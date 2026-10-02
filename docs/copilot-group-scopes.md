# Copilot group scopes: Family and Embryo

Status, 28 September 2026: the Family scope is built and runs under the
TEST-LOCAL acceptance row on a deployment that attests a same-host model. The
Embryo (cohort) scope is built too (the same day, later), under TEST-LOCAL
only and read-only over a published cohort; see its section below. Nothing
here is available on the hosted site: `/copilot/family` and a readable
cohort's `/copilot/c-{cohort}` render the registered unavailable page there,
before anything is read.

**Turned on everywhere, 28 September 2026 (owner decision, PR #260).**
`copilotGroupScopes()` answers `family: true` on every deployment, and reads
no environment. Overview's Family Copilot box therefore opens
`/copilot/family` everywhere, as the register's box contract names it. The
Family hub's Copilot tile opens it wherever the hub itself is permitted. What
the scope can do is still decided per request, in this order:

1. The transport. With no attested same-host model, which covers every hosted
   deployment, the page is the closed unavailable page. The chat and history
   endpoints serve nothing.
2. The jurisdiction.
3. The asker's own local model.
4. Each adult's own grants.

No real jurisdiction permits `third_party_adult_analysis` or
`family_heritability` today, so nobody's data is read outside TEST-LOCAL. On
a real jurisdiction the Family hub's own gate is unchanged: its tiles state
the refusal and link nowhere. `e2e/copilot-group-scopes.nojurisdiction.spec.ts`
proves the hosted case.

Register sources: `policyResolvers.copilot-route-scope-v1` (the `family` and
`c-{uuid}` segments), `scope-derived-v1` (`family:individual-risks`,
`cohort:*`), `copilot-transport-availability-v1` (`true-non-self`),
`chat-scope-v1`, the `api.chat` and `api.chat-history` authorization orders,
and the invariant that every Copilot turn needs the conjunction of current
subject, purpose, principal and relationship authority.

## What the Family scope reads

A Family conversation belongs to one asking account. It reads, for each other
adult separately, only the saved reports that adult currently shares with the
asker, and only when all of these hold at that moment:

- a `copilot.local` directional grant from that adult to the asker (the new
  "Copilot" row on their own permissions page);
- a `family.heritability` grant from that adult to the asker ("Health
  picture"), as `scope-derived-v1.family:individual-risks` requires from each
  referenced subject;
- a canonical grant for the result layer itself (`reports.monogenic`,
  `reports.polygenic`), through `private.family_report_recipient_v1`, never
  its legacy-only branch;
- both adults' endpoints current (adult, active, bound, same relationship and
  principal revisions) and no current pause between them;
- `third_party_adult_analysis` and `family_heritability` permitted for both
  accounts (G5.1b), which today means TEST-LOCAL only;
- the asker's own Copilot set to a local model and allowed
  (`own_copilot_authority_v1`, provider class `local`). A cloud model is never
  used for this scope, whatever consent exists.

It does not read the asker's own results (those are `/copilot/me`), ancestry,
Portrait results or any genotype outside a shared report. There is no
`get_genotype` or `search_variants` tool: the model has `list_reports` and
`get_report`, and every row they return names its person. The model never
receives a subject, account or file identifier; people are `person-1`,
`person-2` in name order for that turn.

## How it is enforced

- `supabase/migrations/20260929140000_family_copilot_scope.sql`:
  `private.family_copilot_member_v1` is the member check;
  `public.family_copilot_scope_v1` lists the group; the service-only
  dispatcher `public.family_copilot_chat_v1` rechecks (`check`), lists,
  reads history and commits. Content is still read only through
  `family_shared_report_results_v1` and confirmed with its locked receipt
  check.
- `src/lib/copilot/family-chat.ts` resolves the group per request and joins
  the Family graph for names. `checkFamilyTurn` repeats session, both
  capabilities for everyone, the database member check, the asker's model
  permission and every captured read's confirmation. It runs before and after
  each tool result, inside the pinned model connection, and before and after
  the commit.
- `src/lib/copilot/family-chat-route.ts` follows `api.chat`'s order:
  jurisdiction, transport, model endpoint and scope grants, then the intent
  gate, then reads. The context token (`family-chat-token.ts`) binds the page's
  provider and group and is single use; it never freezes access.
- `src/lib/copilot/guard.ts`: a group scope's display names are read as the
  person the rules already cover, so "Does Bea have diabetes?" is gated like
  "Do I have diabetes?" and "Bea has diabetes." is replaced like "You have
  diabetes.". Scopes without people are unchanged.

## Provenance and revocation

Each turn stores exactly whose data its tools returned:
`retrieved_subject_ids`, `retrieved_purpose_keys` (`copilot.local`,
`family.heritability` and the layers used), `contributor_ids`, and one
`copilot_turn_dependencies` row per grant, subject and source file, on both
rows of the pair. Each answer carries a "Shared by {name}" source per person,
then that person's shared report, then its publications.

- Revoking any of those grants runs the existing
  `private.delete_pair_derived_rows_v1`, which deletes the turn that used it
  and every later turn of that conversation at once. The next turn in the
  same conversation is refused before any model call, and history answers 404
  (brief section 5, item 19).
- A change no Family helper sees (the adult withdraws their own report
  purpose, deletes a file, or a grant expires) ends the dependency; the next
  read deletes the whole dependent chain.
- A pause hides the conversation without deleting it; resume restores it. No
  turn can be appended after a paused one.
- Family chats are not exported (the export already excludes every scope but
  `self`). That is a gap for G5.6 to decide, recorded, not changed here.

## The Embryo (cohort) scope: built under TEST-LOCAL, read-only

Built 28 September 2026 on `claude/copilot-cohort-scope`, over the
whole-cohort publication of #258. `copilotGroupScopes().cohort` is on under
the TEST-LOCAL acceptance row only. Everywhere else a readable cohort's
`/copilot/c-{cohort}` is the registered `copilotCohortUnavailablePage`, and
the Embryos Overview box and hub tile stay on `/embryos`.

### The page's order

1. A cohort this account cannot read, or a refused embryo jurisdiction for
   the account itself, is the same 404 as an unknown id.
2. The transport comes next. With no attested same-host model, or where the
   scope is not built, the page is the registered unavailable page, and
   nothing else about the cohort is read.
3. The cohort's jurisdiction, for the viewer and every required upload
   principal.
4. The embryo pages' own states, in their order (`resolveResultSurfaceState`):
   files still being checked, then a missing analysis grant, then the domain's
   one Tier-2 gate.
5. The asker's own local model and permission.
6. The database authority over the published cohort.

### The authority

`private.cohort_copilot_authority_v1` (migration
`20260929143000_cohort_copilot_scope.sql`) requires all of these:

- the cohort is `active` with a publication revision;
- the reader is a current required upload principal, or the non-parent
  uploader owner of an `embryo_third_party` cohort;
- every required upload principal holds a current `embryo.analysis` grant at
  the current participant-set revision, in both grant tables;
- no attestation contradiction is open;
- each embryo it names is published (`qc_pass`, `qc_marginal`, `qc_fail`) with
  an active subject.

The authority is one closed JSON value. It records the basis case and basis
revision, the participant-set revision, the publication revision, the donor
attribution revision with the explicit `donor-neutral` classification, each
grant, and each embryo subject's lifecycle revision. Its SHA-256 is the
chat's `cohort_authority_fingerprint`, and the page's context token binds it
too.

### What the model reads

Exactly `copilotCohortContext`, built from the same projection
`/embryos/compare` renders, and nothing else. There are no tools.

- `embryos`: each published embryo in ordinal order, with its label, status
  word and quality check.
- `findings`: none while `data/embryo/allowed_conditions.json` is empty.
- `authorized_parent_carrier_reports`: empty. No route yet lets a parent grant
  `copilot.local` over a cohort, and the register's `authorizationRule`
  requires one.
- The standing statement.

No genotype, source row, file name, laboratory or sample identifier reaches
the model. Neither does any sex, karyotype, rank or score field: the context
builder refuses such a key outright, and fails closed if one ever appears
(ADR 0034). The system prompt forbids ranking, choosing, recommending,
disclosure of sex, and any condition claim. Both guard gates refuse selection
and sex questions and answers, and every number in an answer must be in the
context.

### Turns, provenance and revocation

`public.cohort_copilot_chat_v1` is the service-only dispatcher, with four
operations: `authority`, `list`, `history` and `commit`. `commit` re-reads the
authority under `FOR SHARE NOWAIT` locks and stores the turn only if the
authority is exactly the one the turn read under. The context nonce is used
once.

Each turn records:

- every embryo subject it read (`retrieved_subject_ids`);
- the purpose (`embryo.analysis`);
- every parent's grant (`contributor_ids`, `grant_revisions`);
- one dependency row each for the publication, the basis, the participant
  set, the donor classification, each grant and each embryo subject.

Each answer cites the cohort's comparison, then exactly the embryos the
answer names. Nothing else can be cited: the database validator and the
commit refuse any link outside this cohort's pages.

Two things end a conversation:

- Withdrawing any `embryo.analysis` grant for the cohort deletes every
  account's cohort conversation content in the same transaction. A trigger
  on `purpose_grants.revoked_at` does this. Cohort restriction and
  jurisdiction changes revoke grants, so they go the same way.
- Any other change to the authority (an embryo record, the participant set,
  the publication) makes the next read or turn delete that account's stale
  content, and the route answers 404.

### Not built

- Parent carrier summaries.
- Registered findings. A registered statistical estimate would also be
  refused by the forbidden-key rule, because embryo estimates are research
  only (ADR 0034).
- Donor-specific fields: the scope is donor-neutral by construction.
- Any production availability.

## Verification

- `supabase/tests/family_copilot_scope.sql`: 52 rollback-only assertions over
  real grants and generation: purpose isolation, non-members, pause, revocation
  mid-conversation, own-report withdrawal, single-use context, citations.
- Unit: `family-chat.test.ts`, `family-chat-route.test.ts`,
  `family-chat-content.test.ts`, `family-chat-token.test.ts`,
  `group-scopes.test.ts`, `guard-people.test.ts`.
- Cohort: `supabase/tests/cohort_copilot_scope.sql` (over a cohort published
  through the real worker functions, `fixtures/embryo_cohort_published.inc`),
  `cohort-chat.test.ts`, `cohort-chat-route.test.ts`,
  `cohort-chat-content.test.ts`, `cohort-chat-token.test.ts`, and
  `e2e/copilot-cohort.spec.ts` (`copilot-local`: the journey).
- Browser: `e2e/copilot-group-scopes.spec.ts` (main variant: the registered
  unavailable page, the boxes and the hub tiles, 404s),
  `e2e/copilot-group-scopes.nojurisdiction.spec.ts` (`jurisdiction-off`, the
  hosted case: the box, the unavailable page, nothing minted or stored, the
  endpoints, the hub's unchanged refusal) and `e2e/copilot-family.spec.ts`
  (`copilot-local` project: the journey, and `/copilot/[scope]
  jurisdiction-unavailable`). The journey needs the migration applied and the
  synthetic model fixture (`CANONICAL_COPILOT_CONTROL_URL`), which CI has.
