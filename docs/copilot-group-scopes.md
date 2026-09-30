# Copilot group scopes: Family and Embryo

Status, 28 September 2026: the Family scope is built and runs under the
TEST-LOCAL acceptance row on a deployment that attests a same-host model. The
Embryo (cohort) scope is designed here and stays refused with the register's
unavailable page until embryo publication exists. Nothing here is available on
the hosted site: `/copilot/family` renders the registered unavailable page
there, before anything is read.

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

## The Embryo (cohort) scope: designed, refused

`/copilot/c-{cohort}` parses in the register's grammar. A cohort this account
cannot read, or any refused embryo jurisdiction, is the same 404 as an unknown
id. A readable cohort renders the registered `copilotCohortUnavailablePage`
(the same closed fields as the transport page) and reads nothing else. The
Embryos Overview box and hub tile keep landing on `/embryos`
(`copilotGroupScopes().cohort` is false).

When embryo publication exists, the scope should follow `scope-derived-v1`'s
`cohort:*` cases and reuse this Family structure:

- member check: every `requiredUploadPrincipals` member's current
  `embryo.analysis` grant under `embryo-basis-authority-v1`, the donor
  classification of `embryo-donor-attribution-v1`, and each parent's
  `copilot.local` grant for `authorized_parent_carrier_reports`;
- context: `copilotCohortContext` exactly (embryos, findings,
  parent carrier summaries, standing statement), never a genotype or a source
  row, and `EmbryoFinding` leaves only;
- provenance: the basis case, basis revision, five set revisions and donor
  classification as turn dependencies, rechecked at every checkpoint the
  register lists (token mint, each context read, model call, commit, history);
- guard: `scope: "cohort"` with the cohort size, which the guard already
  supports.

## Verification

- `supabase/tests/family_copilot_scope.sql`: 52 rollback-only assertions over
  real grants and generation: purpose isolation, non-members, pause, revocation
  mid-conversation, own-report withdrawal, single-use context, citations.
- Unit: `family-chat.test.ts`, `family-chat-route.test.ts`,
  `family-chat-content.test.ts`, `family-chat-token.test.ts`,
  `group-scopes.test.ts`, `guard-people.test.ts`.
- Browser: `e2e/copilot-group-scopes.spec.ts` (main variant: the registered
  unavailable page, the boxes and the hub tile, 404s),
  `e2e/copilot-group-scopes.nojurisdiction.spec.ts` (`jurisdiction-off`, the
  hosted case: the box, the unavailable page, nothing minted or stored, the
  endpoints, the hub's unchanged refusal) and `e2e/copilot-family.spec.ts`
  (`copilot-local` project: the journey, and `/copilot/[scope]
  jurisdiction-unavailable`). The journey needs the migration applied and the
  synthetic model fixture (`CANONICAL_COPILOT_CONTROL_URL`), which CI has.
