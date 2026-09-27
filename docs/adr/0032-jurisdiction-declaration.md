# ADR-0032 — The jurisdiction declaration: one writer, a first-sign-in gate, and re-evaluation without a revision bump

- Status: **Accepted** · 25 September 2026; amended 27 September 2026 (United States state). The owner confirmed the no-bump
  re-evaluation in chat the same day (`docs/protocol/decisions.md`).
- Deciders: Inherit engineering, under the owner's decisions of 25 September 2026
  (`docs/protocol/decisions.md`): declare at first sign-in as specified, and add a
  block-only test jurisdiction row
- Records: how G5.1a and G5.1b are built. It proposes no legal determination and
  contains none; `realJurisdictions` stays empty (ADR 0028).

## The question

The brief (G5.1a, X12.1) makes jurisdiction user-declared and server-enforced:
collected at first sign-in from a required selection with no pre-selected
default, carrying an attestation, changeable in settings, with every change
writing an append-only audit row and re-evaluating every active grant. Until
this change nothing wrote `profiles.jurisdiction_code`. Two things had to be
decided that the brief does not settle: what re-evaluation does to existing
permissions in this schema, and how the acceptance suite can build a
prohibited decision when no real jurisdiction has one.

## What was found first

**The column was browser-writable (D-135).** The table-level profile grants and
the own-row RLS policy let a signed-in browser `UPDATE` its own
`jurisdiction_code` and `jurisdiction_revision`; no guard covered them. Nothing
read the code as authority in SQL, so there was no escalation today, but a
declaration built on top would have been bypassable, and the revision every
consent binds could be moved by its holder.

**A revision bump would erase the own-genome journey.** Every consent signature
and grant records the account's `jurisdiction_revision`, the signature row is
immutable (`consent_signatures_immutable`), and each completed own report stores
that revision in its authority context, which
`private.own_analysis_completion_matches_v1` compares exactly. Production on
25 September held 21 profiles, none declared, all at revision 1, with 10 current
self-direction grants and 0 current non-self grants (read-only query). Bumping
the revision at the first declaration, which every existing person now meets at
their next sign-in, would have ended all 10 own permissions and hidden every
saved report, although adult self-analysis is the one capability no
jurisdiction restricts.

**Family shares already bind both parties' codes.** A family report share's
snapshot (`private.family_report_grant_snapshots.endpoints`) carries the owner's
and the recipient's `jurisdictionCode`, and every read requires the snapshot to
equal the live endpoints. So a share stops being readable the moment either
side's declaration changes.

## The decision

1. **One writer.** `public.declare_jurisdiction_v1` (service-only) is the only
   path that changes a declaration. It requires a live session, refuses an
   account in its deletion notice, serializes on the profile row, and checks
   that the attestation version and hash are the current published
   `attestation.jurisdiction` text. It stores the code with the attestation and
   the declaration time and appends one pseudonymized `jurisdiction.declared`
   event to the canonical legal ledger (no account link, as every existing
   ledger writer does). Repeating the same answer changes nothing.
2. **A guard, not a convention.** `profiles_jurisdiction_server_only` refuses any
   browser-role write to the five declaration columns, and a check constraint
   makes a code without its declaration record impossible.
3. **Re-evaluation ends restricted permissions; it does not bump the revision.**
   A changed code, the first declaration included, ends every current
   restricted grant the account takes part in as signer, data subject or
   recipient, recorded as `jurisdiction_changed`. Where the data subject has an
   account the existing `revoke_directional_purpose_v1` runs, so derived rows,
   pair state and purge jobs follow the ordinary withdrawal path. This is the
   register's "require re-signing" disposition (`jurisdiction-write-v1`): a
   restricted permission's jurisdiction is part of its immutable signature, and
   a share whose either side moved could not be read anyway. Adult
   self-analysis on the account's own subject (own reports, ancestry, raw
   access, own Copilot) and the export right stay current, with their
   signing-time snapshot kept as the historical record.
4. **A first-sign-in gate.** `src/proxy.ts` sends an undeclared, signed-in
   account from any product page to `/settings?next=…`, where the declaration
   form sits at the top. Settings stay open, so export, deletion and consent
   withdrawal are never blocked; endpoints are not redirected, because each one
   already resolves an undeclared account's restricted capabilities as
   `unreviewed`. `/family` is registered public-or-authenticated and sits
   outside the proxy's protected list; for an undeclared account it renders
   the unreviewed refusal in words rather than redirecting. The selection always starts empty, including when changing an
   existing answer, and never offers a test value.
5. **Unset is unreviewed, flag or not.** Under `INHERIT_TEST_JURISDICTION=1` a
   declared account resolves to `TEST-LOCAL`; an undeclared one is `unreviewed`
   as the brief requires, where it used to be permitted.
6. **A block-only test row.** `testJurisdictions["TEST-DENY"]` prohibits every
   restricted capability. A profile holds it as `XX`, an ISO 3166-1
   user-assigned code that names no country and is outside the catalogue. The
   writer accepts `XX` only when the route passes the acceptance flag, which
   production refuses to start with; without the flag `XX` reads as
   unregistered. This makes the two E2E cases the brief names constructible:
   declared-prohibited, and a permitted actor with a prohibited subject.
7. **Account-aware refusals.** Eight write paths decided restricted access from
   the global flag alone: subject drafts, co-parent invitations and acceptance,
   embryo cohort drafts, cohorts, consents and ingest. That was equivalent to
   a per-account check while the flag was all-or-nothing. It is not once people
   declare, so each now also resolves the acting account's own declaration
   when the request arrives (`accountJurisdictionDenied`, and
   `accountCapability` in subject drafts). A declaration changed after a page
   loaded is the one that decides.

## Where this departs from the register's wording, and why

`api.jurisdiction`'s transaction text asks to increment the shared principal
jurisdiction revision and every dependent revision, and for each
still-permitted purpose to "supersede only its jurisdiction binding snapshot
while preserving the original purpose artifact signature". In this schema the
binding snapshot is not separate from the signature. It is a column of the
immutable signature row, and completed results bind it too. So that sentence
cannot be carried out without either rewriting signed rows or forcing every own
permission to be signed again. This decision keeps the register's intent,
that a still-permitted purpose survives with its original signature, for the
one class that is always permitted, and applies its fallback, "enters
consent-required instead of being fabricated", to every restricted one. The
cost is that `jurisdiction_revision` no longer moves. A reviewer who wants the
literal transaction needs a separate jurisdiction-binding table that every
authority check reads; that is a migration of about forty functions and is not
attempted here.

Also not built: the register's broader enumeration of jobs, exports, downloads,
chats and model contexts. Each of those re-checks its grants when it runs, so
ending the grant stops it; nothing cancels them separately. Subject source
consents (`subject_consents`) are not re-evaluated; reading such a file for
analysis requires a restricted grant, which is. Subdivisions stay undeclarable:
none is committed, and the column holds two letters. *(Superseded for the
United States by the amendment below.)*

## Amendment, 27 September 2026: the United States state

The owner decided on 27 September 2026 to keep partner features off in
production while a US launch is prepared (`docs/protocol/decisions.md`). A US
launch has to decide New York, and other restrictive states, separately from
the rest. The resolver has always answered a committed subdivision for itself;
now a person can declare one.

- **Data.** `data/jurisdictions.json` commits the 50 states and DC as
  subdivisions (`US-AL` … `US-WY`). Every capability of every entry is
  `unreviewed` with `review: null`, so nothing opens for anyone. A state is
  permitted only by its own signed review, and never inherits the country's.
- **Storage.** The state lives in its own column,
  `profiles.jurisdiction_subdivision`, not in `jurisdiction_code`. Consent
  signatures and grants copy the country code under two-letter checks, and
  adult self-analysis signs through them. A check ties the state to the declared
  country, and the server-only guard covers the new column.
- **Writer.** `declare_jurisdiction_v2` takes the country and the state and is
  the one writer. A changed state ends restricted grants exactly as a changed
  country does. The audit event records the state only when one is declared,
  so every other event keeps its shape. `declare_jurisdiction_v1` remains, for
  the build that is live when the migration is applied, as a wrapper that
  keeps the recorded state when the country is unchanged and returns only its
  own three keys.
- **Attestation.** Version 2 of `attestation.jurisdiction` names the state
  ("The place I chose is where I live."); version 1 is superseded with its body
  intact.
- **Resolution.** `readJurisdictionCodes` resolves the declared state when there
  is one, else the country (`declaredResolutionCode`). An account that declared
  only "United States" resolves to the fail-closed default for the country.
- **Form and route.** The declaration form shows a required state list only
  once the United States is chosen. `PUT /api/settings/jurisdiction` requires
  exactly one committed state for a country with committed states and refuses
  a state for any other; its response is unchanged. The export includes the
  declared state.

Verified by:
- `supabase/tests/jurisdiction_subdivision.sql`;
- `jurisdiction_declaration.sql`, which now reaches the writer through the
  version 1 wrapper;
- the route and declaration unit tests;
- the new state journey in `e2e/jurisdiction-declaration.spec.ts`.

## Verification

`supabase/tests/jurisdiction_declaration.sql` asserts 51 cases over a real own
report, a real share and its recipient. Seven planted defects each fail it: the
self-exclusion removed, the guard dropped, the recipient role not enumerated,
`XX` accepted without the flag, the attestation hash unchecked, the idempotent
return removed, and a revision bump restored. Unit tests cover the route, the
resolver, the proxy gate and the account-aware refusals. The browser specs are
`e2e/jurisdiction-declaration.spec.ts`,
`e2e/jurisdiction-declaration.nojurisdiction.spec.ts`, the first test of
`e2e/auth.spec.ts`, and the two G5.1b tests in
`e2e/family-health-picture.spec.ts`.
