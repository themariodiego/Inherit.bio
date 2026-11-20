# Register and ledger changes: the uploader's and the non-parent embryo uploader's consent withdrawals (19 November 2026)

Basis: owner decisions of 19 November 2026, "An uploader's withdrawal for another adult's file deletes it, unless that adult holds the record themselves" and "A non-parent uploader's withdrawal for an embryo upload stops analysis and deletes, as they signed", under "G8.5: a withdrawal is built for three kinds of consent". `docs/route-register.json` was edited as text (nothing re-serialised); `docs/register-contract-divergence.json` was serialised with `json.dumps(indent=2, ensure_ascii=True) + "\n"` (it round-trips byte-identical, checked before the edit). Every new register string carries `registered-2026-11-19-owner-decision-...` naming its decision. Old and new values below are quoted from the two files themselves.

No change goes beyond the two decisions: each describes what the code now does for them. Two are not pure additions and are called out: 1c changes what `api.consent-revoke` resolves (one more table, one signature kind), and 3 records that `delete_subject_v1` now refuses the owning uploader on a record its person holds with their own account (the decision's own-account branch: the uploader's whole-record delete was, per the removed ledger row, the only uploader withdrawal and it deleted such a record).

## 1a. `routes[api.consent-revoke].policy.withdrawalRoutes.cases` gains `other-adult-uploader-consent.upload-other-adult`

Old: no key `other-adult-uploader-consent.upload-other-adult` (the kind was a row of `consentWithdrawalNotRegistered`; see 5).

New:

```json
{
  "other-adult-uploader-consent.upload-other-adult": {
    "routes": [
      "api.subject-delete"
    ],
    "doors": [
      "withdraw_other_adult_upload_v1"
    ],
    "how": "registered-2026-11-19-owner-decision-an-uploader's-withdrawal-for-another-adult's-file-deletes-it-unless-that-adult-holds-the-record-themselves: one-control-on-the-uploader's-card-for-that-person-on-files.upload, shown-only-while-the-uploader-holds-a-live-upload_class-consent-on-a-confirmed-active-Path-B-record, says-from-other_adult_withdrawal_readiness_v1-which-outcome-applies-to-that-record, and-for-a-record-whose-adult-holds-no-account-of-their-own-on-it-leads-to-one-confirmation-that-sends-api.subject-delete-for-that-record-with-the-page's-one-time-X-Inherit-Operation-Nonce-and-the-route's-X-Inherit-CSRF-token; the-route-sends-the-owning-account's-request-only-to-withdraw_other_adult_upload_v1, which-runs-delete_subject_v1's-unchanged-Path-B-delete-as-withdrawn (every-file-the-uploader-added-ends-confirmed-or-not, the-record-is-purged, its-contact-shredded, every-upload_class-consent-on-it-marked-withdrawn-and-kept, no-subject-controlled-bar) and-in-the-same-transaction-queues-one-upload-permission-withdrawn-terminal-notice-to-the-adult's-sealed-contact-unless-barred; a-record-the-adult-holds-with-their-own-account-is-not-withdrawn-here-yet: the-door-and-delete_subject_v1-refuse-the-uploader-on-it-and-the-card-says-so, because-who-holds-the-record-after-the-uploader's-withdrawal-is-not-decided; the-adult's-own-delete-everything-about-me-through-api.withdraw-or-api.subject-delete-also-marks-this-consent-withdrawn, as-before"
  }
}
```

## 1b. `routes[api.consent-revoke].policy.withdrawalRoutes.cases` gains `embryo-nonparent-uploader-own-upload-artifact`

Old: no key `embryo-nonparent-uploader-own-upload-artifact` (the kind was a row of `consentWithdrawalNotRegistered`; see 5).

New:

```json
{
  "embryo-nonparent-uploader-own-upload-artifact": {
    "routes": [
      "api.consent-revoke"
    ],
    "doors": [
      "withdraw_embryo_uploader_consent_v1"
    ],
    "how": "registered-2026-11-19-owner-decision-a-non-parent-uploader's-withdrawal-for-an-embryo-upload-stops-analysis-and-deletes-as-they-signed: api.consent-revoke-resolves-the-uploader's-own-consent.upload-embryo-signature-of-purpose-embryo-upload-uploader-class, and-one-control-for-the-account-that-signed-it-as-the-cohort's-or-draft's-non-parent-uploader, on-the-cohort's-card-on-embryos.index-after-finalisation-and-on-embryos.upload-before-it, leads-to-one-confirmation-that-sends-it-with-the-page's-one-time-consent_revoke-X-Inherit-Operation-Nonce-for-that-signature-and-the-route's-X-Inherit-CSRF-token; withdraw_embryo_uploader_consent_v1-records-the-nonce-and-the-legal-audit-event-embryo.upload-consent.withdrawn, then-after-finalisation-runs-private.restrict_embryo_cohort_core_v1-under-cohort-restriction-v1.actorCases.nonparent-required-uploader-basis-loss (bound-to-this-route-alone, the-cohort's-own-current-class-D-non-parent-uploader-principal-in-its-own-withdrawal-transaction, outside-every-participant-set; analysis-stops, derived-rows-and-source-files-are-deleted-as-a-withdrawal, Record-Keys-and-permissions-end, every-current-notice-recipient-is-told) and-before-it-ends-the-draft's-pending-invitations-without-a-notice, cancels-the-draft-and-queues-it-on-the-refused-invitation-draft-purge-that-deletes-its-evidence-objects-signatures-attestations-invitations-contacts-and-draft-principals; neither-gives-the-uploader-a-parent-role-disposition-choice-claim-right-or-say-over-any-other-cohort, and-the-answer-is-lifecycle-accepted-v1"
  }
}
```

Position: each inserted where `dispositionCases` lists it (after `self-upload-class-consent`, and before `consent.embryo-donor-attribution-by-the-current-donor-subject-principal`). The kinds' `dispositionCases` values are unchanged.

## 1c. `routes[api.consent-revoke].policy.withdrawalRoutes.basis`

Old:

```json
"api.consent-revoke-itself-resolves-only-a-public.purpose_grants-row-or-a-public.consent_grants-row-and-answers-resource-not-found-v1-for-any-other-id; cases-names-for-each-dispositionCases-kind-the-routes-that-withdraw-it-today-and-the-database-door-each-of-those-routes-calls, and-a-kind-cases-does-not-name-has-no-registered-withdrawal-route-yet"
```

New:

```json
"api.consent-revoke-itself-resolves-only-a-public.purpose_grants-row-or-a-public.consent_grants-row-or-(registered-2026-11-19-owner-decision-a-non-parent-uploader's-withdrawal-for-an-embryo-upload-stops-analysis-and-deletes-as-they-signed)-a-public.consent_signatures-row-that-is-a-consent.upload-embryo-signature-of-purpose-embryo-upload-uploader-class, exactly-one-of-the-three-must-match, and-answers-resource-not-found-v1-for-any-other-id-including-every-other-signature; cases-names-for-each-dispositionCases-kind-the-routes-that-withdraw-it-today-and-the-database-door-each-of-those-routes-calls, and-a-kind-cases-does-not-name-has-no-registered-withdrawal-route-yet"
```

`scripts/route-register-correspondence.test.ts` asserted that the route reads exactly the two tables the basis named; it now asserts three, and that the third is checked for the one signature kind (see the test-diff entry).

## 2. `routes[api.consent-revoke].requestContract.operationNonce`

Old:

```json
"the-directional-purpose-revocation-recorded-in-account_operation_nonces-before-the-writer-in-the-same-transaction-so-its-legal-audit-event-names-the-actor-G5.6-2026-10-23; since-2026-10-24-G8.5-the-cloud-model-provider-grant-and-the-own-Copilot-permission-record-it-the-same-way-revoke_cloud_model_consent_with_nonce_v1-and-revoke_own_copilot_with_nonce_v1"
```

New:

```json
"the-directional-purpose-revocation-recorded-in-account_operation_nonces-before-the-writer-in-the-same-transaction-so-its-legal-audit-event-names-the-actor-G5.6-2026-10-23; since-2026-10-24-G8.5-the-cloud-model-provider-grant-and-the-own-Copilot-permission-record-it-the-same-way-revoke_cloud_model_consent_with_nonce_v1-and-revoke_own_copilot_with_nonce_v1; registered-2026-11-19-owner-decision-a-non-parent-uploader's-withdrawal-for-an-embryo-upload-stops-analysis-and-deletes-as-they-signed: the-non-parent-uploader's-consent.upload-embryo-signature-records-the-same-consent_revoke-nonce-minted-for-that-signature-the-same-way-withdraw_embryo_uploader_consent_v1"
```

## 3. `routes[api.subject-delete].policy.cases.adult` gains `withdrawal`

Old:

```json
{
  "actorRoleAnyOf": [
    "verified-subject-account",
    "owning-account"
  ],
  "scope": "route-subject-only",
  "dispositionContract": "revocation-and-purge-v1"
}
```

New:

```json
{
  "actorRoleAnyOf": [
    "verified-subject-account",
    "owning-account"
  ],
  "scope": "route-subject-only",
  "dispositionContract": "revocation-and-purge-v1",
  "withdrawal": "registered-2026-11-19-owner-decision-an-uploader's-withdrawal-for-another-adult's-file-deletes-it-unless-that-adult-holds-the-record-themselves: the-owning-account's-request-is-the-withdrawal-of-its-other-adult-uploader-consent.upload-other-adult; the-route-sends-it-only-to-withdraw_other_adult_upload_v1, which-under-the-invitation-transition-lock-runs-delete_subject_v1's-unchanged-Path-B-delete-as-withdrawn-and-in-the-same-transaction-queues-one-upload-permission-withdrawn-terminal-notice-per-spent-nonce-to-the-adult's-own-sealed-contact-bound-to-the-request-they-accepted-unless-that-contact-is-barred-then-or-when-the-notice-is-sent; a-record-the-adult-holds-with-their-own-account-(subject_account_id-set)-is-refused-with-resource-not-found-v1-and-nothing-changes, and-delete_subject_v1-itself-refuses-the-owning-account-on-such-a-record, until-the-owner-decides-who-holds-it-after-the-uploader's-withdrawal; a-record-whose-notice-cannot-be-addressed-is-refused-whole; the-verified-subject-account's-own-delete-is-unchanged"
}
```

Nothing else of `api.subject-delete` changes: request contract (no body, `X-Inherit-Operation-Nonce`), `lifecycle-accepted-v1` and `resource-not-found-v1`, the nonce and resource-authorization bindings already describe the request the card sends.

## 4. `responseContracts.service-unavailable-v1.when`

Old:

```json
"a-database-read-or-door-the-bound-route-depends-on-errored-threw-or-answered-outside-its-closed-shape: api.browse-region's-variant-read-errored; the-own-Copilot-case-of-api.consent-revoke-threw; api.future-person-claim-document-session's-door-failed-with-a-code-other-than-42501-23505-or-22023-or-answered-a-session-it-cannot-read; api.appeal-document-session's-door-failed-with-a-code-other-than-42501-23505-or-22023-answered-neither-a-capacity-limit-nor-a-matching-open-session-threw-or-left-its-intake-runtime-holding-cleanup-or-unsettled-work"
```

New:

```json
"a-database-read-or-door-the-bound-route-depends-on-errored-threw-or-answered-outside-its-closed-shape: api.browse-region's-variant-read-errored; the-own-Copilot-case-of-api.consent-revoke-threw; api.future-person-claim-document-session's-door-failed-with-a-code-other-than-42501-23505-or-22023-or-answered-a-session-it-cannot-read; api.appeal-document-session's-door-failed-with-a-code-other-than-42501-23505-or-22023-answered-neither-a-capacity-limit-nor-a-matching-open-session-threw-or-left-its-intake-runtime-holding-cleanup-or-unsettled-work; (registered-2026-11-19-owner-decision-a-non-parent-uploader's-withdrawal-for-an-embryo-upload-stops-analysis-and-deletes-as-they-signed) the-non-parent-uploader's-embryo-upload-signature-case-of-api.consent-revoke-whose-door-withdraw_embryo_uploader_consent_v1-failed-with-a-code-other-than-42501-or-55000-or-a-nonce-refusal"
```

`api.consent-revoke` already binds `service-unavailable-v1` and `lifecycle-accepted-v1` (`responseContractBindings.routes`), and `consent-revocation-v1` already has the 202 outcome "every other dispositionCases entry whose revocation completes asynchronously", which the embryo withdrawal answers.

## 5. Ledger `consentWithdrawalNotRegistered`: both remaining rows removed (2 rows to 0)

Old (removed verbatim):

```json
[
  {
    "kind": "other-adult-uploader-consent.upload-other-adult",
    "why": "The uploader's consent.upload-other-adult signature and the upload_class public.subject_consents row on the Path B other_adult subject (20260928150000_other_adult_held_upload.sql). Nothing withdraws it on its own: api.consent-revoke cannot address it and api.consents-revoke-all excludes it. The uploader can end it only by deleting the whole record: api.subject-delete by the owning account (delete_path_b_subject_for_route_v1 with state withdrawn) ends every held file revision, purges the subject and deletes the other adult's principal and contact, so it also ends the other adult's own confirmation; no page sends that request. Account deletion ends it too. The register's disposition names revocation-and-purge-v1.",
    "closing": "Owner: say whether the uploader's withdrawal is the whole-record delete (and from which screen) or whether the uploader may withdraw a held file or the consent without ending the other adult's record; engineering then registers it and this row is removed.",
    "closedBy": "owner",
    "evidence": [
      {
        "file": "supabase/migrations/20261016181000_subject_delete.sql",
        "literal": "case when s.subject_account_id is not distinct from p_account_id then 'deleted' else 'withdrawn' end);"
      },
      {
        "file": "supabase/migrations/20261016200000_consents_revoke_all.sql",
        "literal": "-- Excluded, as the register says: class-upload consents"
      }
    ]
  },
  {
    "kind": "embryo-nonparent-uploader-own-upload-artifact",
    "why": "A nonparent uploader's own consent.upload-embryo signature for a cohort uploaded with the genetic parents' permission (upload_class embryo_third_party). Nothing withdraws it: api.cohort-restrict and its alias api.embryo-withdraw act only for a current disposition authority (restrict_embryo_cohort_v1 refuses with 'not a disposition authority'), which a nonparent uploader never is; api.withdraw's embryo-parent-withdrawal session is issued only to a disposition authority; api.consent-revoke cannot address an artifact signature. Only deleting the uploader's account ends it, through the owned-cohort purge (20260930235000_account_cohort_purge.sql). Embryo ingest is TEST-LOCAL, so no such cohort exists in production today.",
    "closing": "Owner: say how a nonparent uploader withdraws their own upload artifact (the register's cohort-restriction-v1 nonparent-required-uploader-basis-loss case); engineering builds and registers it and this row is removed.",
    "closedBy": "owner",
    "evidence": [
      {
        "file": "supabase/migrations/20260930232000_embryo_parent_withdrawal.sql",
        "literal": "raise exception using errcode = '42501', message = 'not a disposition authority';"
      },
      {
        "file": "src/lib/embryos/routes.ts",
        "literal": "uploadSituation: z.literal(\"with-genetic-parents-permission\"),"
      }
    ]
  }
]
```

New: `"consentWithdrawalNotRegistered": []`.

The kind-2 row said only the uploader's whole-record delete and account deletion end the uploader's consent; the other adult's own "Delete everything about me" (api.withdraw `delete`, and api.subject-delete by their own account) also marks it withdrawn (`delete_path_b_subject_v1`, `delete_path_b_subject_for_route_v1`). The row does not survive, so this is now said in the new case's `how` (1a, last clause).

### The note `consentWithdrawalNotRegisteredNote`

Old:

```json
"2026-11-19 (G8.5, owner decision \"the register names where each kind of consent is withdrawn\"). The decision says any kind that turns out to have no way to be withdrawn comes back to the owner and the amendment does not paper over it. api.consent-revoke's policy.withdrawalRoutes.cases names the routes that withdraw nine of the eleven dispositionCases kinds (donor attribution as a consent that cannot be given yet; self-upload-class-consent since the owner decision of 2026-11-19, \"Withdrawing consent for a person's own DNA file deletes the files and all made from them\"). These rows are the other two: nothing withdraws them short of deleting the whole record or the account, which also ends more than the consent. scripts/route-register-correspondence.test.ts compares the kinds the register names with these rows in both directions, so a kind gaining a registered route fails until its row is removed. Listing a kind records it; it does not bless it."
```

New:

```json
"2026-11-19 (G8.5, owner decision \"the register names where each kind of consent is withdrawn\"). The decision says any kind that turns out to have no way to be withdrawn comes back to the owner and the amendment does not paper over it. api.consent-revoke's policy.withdrawalRoutes.cases names the routes that withdraw all eleven dispositionCases kinds (donor attribution as a consent that cannot be given yet; self-upload-class-consent since the owner decision of 2026-11-19, \"Withdrawing consent for a person's own DNA file deletes the files and all made from them\"; other-adult-uploader-consent.upload-other-adult since the owner decision of 2026-11-19, \"An uploader's withdrawal for another adult's file deletes it, unless that adult holds the record themselves\", for a record whose adult holds no account of their own on it, the own-account branch waiting on the owner; and embryo-nonparent-uploader-own-upload-artifact since the owner decision of 2026-11-19, \"A non-parent uploader's withdrawal for an embryo upload stops analysis and deletes, as they signed\"). No row remains: each kind that had no way to be withdrawn short of deleting the whole record or the account now has one. scripts/route-register-correspondence.test.ts compares the kinds the register names with these rows in both directions, so a kind gaining a registered route fails until its row is removed. Listing a kind records it; it does not bless it."
```

## Not register changes, listed for completeness

- No page-level register fact changed: `files.upload`, `embryos.index` and `embryos.upload` keep their state profiles, task-depth entries and resource-authorization rows; `gate:routes` (174 of 174 route states, 462 browser tests) and the form/client census pass with both controls in place.
- `SHELL_CSRF_ROUTES` already renders the session tokens of `api.subject-delete` (since 20261119150000) and `api.consent-revoke`; no CSRF file changed.
- `scripts/route-register-correspondence.test.ts` re-pins the reviewed client form file `src/components/uploads/other-adult-upload-card.tsx` (its two forms unchanged; the card gained the control).
