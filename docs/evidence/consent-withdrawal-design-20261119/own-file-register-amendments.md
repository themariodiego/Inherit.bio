# Register and ledger changes: own-upload consent withdrawal (19 November 2026)

Basis: owner decision of 19 November 2026, "Withdrawing consent for a person's own DNA file deletes the files and all made from them" (`docs/protocol/decisions.md`), under "G8.5: a withdrawal is built for three kinds of consent". `docs/route-register.json` was edited as text (two insertions, nothing re-serialised); `docs/register-contract-divergence.json` was serialised with `json.dumps(indent=2, ensure_ascii=True) + "\n"` (it round-trips byte-identical, checked before the edit). Every new register string starts `registered-2026-11-19-owner-decision-withdrawing-consent-for-a-person's-own-DNA-file-deletes-the-files-and-all-made-from-them:`.

## 1. `routes[api.consent-revoke].policy.withdrawalRoutes.cases` gains `self-upload-class-consent`

Inserted before `adult-data-subject-own-consent.subject-adult`, so the cases follow `dispositionCases` order.

Old: no key `self-upload-class-consent` (the kind was the first row of `consentWithdrawalNotRegistered`).

New:

```json
"self-upload-class-consent": {
  "routes": [
    "api.subject-delete"
  ],
  "doors": [
    "empty_self_subject_with_notice_v1"
  ],
  "how": "registered-2026-11-19-owner-decision-withdrawing-consent-for-a-person's-own-DNA-file-deletes-the-files-and-all-made-from-them: one-control-on-settings.consents-and-on-files.index-shown-only-while-the-account-holds-a-live-upload_class-consent-on-its-own-self-record leads-to-one-confirmation-that-names-what-is-deleted-and-what-is-kept-and-sends-api.subject-delete-for-that-record-with-the-page's-one-time-X-Inherit-Operation-Nonce-and-the-route's-X-Inherit-CSRF-token; the-route-sends-a-self-record-only-to-empty_self_subject_with_notice_v1, which-runs-delete_subject_v1's-unchanged-self-case-private.empty_self_subject_v1 (every-file-on-the-record, every-result-report-and-Copilot-conversation-made-from-them, the-sharing-permissions-family-links-and-other-accounts'-copies-built-on-them-end, every-consent-on-the-record-is-marked-withdrawn-and-kept, the-account-and-its-record-stay) and-queues-the-upload-consent-withdrawn-confirmation-email-to-the-account's-own-confirmed-address-in-the-same-transaction; a-later-upload-asks-for-consent.upload-self-again; api.file-delete-deletes-one-file-and-is-not-a-withdrawal"
}
```

The case's `dispositionCases` value is unchanged: `"self-upload-class-consent": "revocation-and-purge-v1-without-a-contradiction"`. `scripts/route-register-correspondence.test.ts` checks that `empty_self_subject_with_notice_v1` is called by name from shipped code (`src/app/api/subjects/[id]/route.ts`).

## 2. `routes[api.subject-delete].policy.cases.self` gains `withdrawal`

Old:

```json
"self": {
  "actorRole": "owning-account",
  "scope": "route-subject-only",
  "dispositionContract": "revocation-and-purge-v1"
},
```

New:

```json
"self": {
  "actorRole": "owning-account",
  "scope": "route-subject-only",
  "dispositionContract": "revocation-and-purge-v1",
  "withdrawal": "registered-2026-11-19-owner-decision-withdrawing-consent-for-a-person's-own-DNA-file-deletes-the-files-and-all-made-from-them: this-case-is-the-withdrawal-of-the-self-upload-class-consent; the-route-sends-a-self-record-to-empty_self_subject_with_notice_v1-which-runs-this-door's-self-case-unchanged-and-in-the-same-transaction-queues-one-upload-consent-withdrawn-email-per-spent-nonce-to-the-account's-own-principal-at-the-confirmed-address-the-route-sealed-from-the-signed-in-account; no-confirmed-address-or-an-address-changed-since-the-route-read-it-refuses-the-whole-request-with-resource-not-found-v1-and-deletes-nothing"
},
```

Nothing else of `api.subject-delete` changes: `requestContract` (body forbidden, `X-Inherit-Operation-Nonce-from-the-confirmation-page`), `successResponseContract` (`lifecycle-accepted-v1`), `responseContractBindings.routes["api.subject-delete"]` (`lifecycle-accepted-v1`, `resource-not-found-v1`), the nonce binding in `mutationSecurityBindings` and the resource-authorization row already describe the request the control sends; the form/client census reports no divergence for it.

## 3. Ledger `docs/register-contract-divergence.json#consentWithdrawalNotRegistered`: the `self-upload-class-consent` row is removed (3 rows to 2)

Old (removed verbatim):

```json
{
  "kind": "self-upload-class-consent",
  "why": "The consent is the account's consent.upload-self signature and the public.subject_consents row of consent_type upload_class on its self subject (20260906102710_own_upload_consent.sql), which every upload session names (upload_sessions.upload_consent_id). Nothing withdraws it on its own: api.consent-revoke resolves only purpose_grants and consent_grants ids and answers not found for any other; api.consents-revoke-all excludes class-upload consents; api.file-delete deletes one file, leaves the consent row live and is refused while the record has shared or generated material (file_delete_shared_graph), though docs/retention.md (source.revocation-7d) calls it the only withdrawal of a self source's store consent. Only emptying the whole self record ends it: api.subject-delete's self case (private.empty_self_subject_v1) revokes every consent on the record and purges every file, result, chat, permission and relationship on it, and no page sends that request; account deletion ends it too. The register's disposition, revocation-and-purge-v1, is whole-subject, but whether withdrawing this consent means emptying the record, and from which screen, has not been decided.",
  "closing": "Owner: name the withdrawal (per file through api.file-delete, with what happens to the consent row when the last file goes; the whole-record api.subject-delete with a page that offers it; or a withdrawal of the consent itself), then engineering registers it in withdrawalRoutes.cases and this row is removed.",
  "closedBy": "owner",
  "evidence": [
    { "file": "src/app/api/consents/[id]/revoke/route.ts", "literal": "admin.from(\"consent_grants\").select(\"id\").eq(\"id\", id).maybeSingle()," },
    { "file": "supabase/migrations/20261016200000_consents_revoke_all.sql", "literal": "-- Excluded, as the register says: class-upload consents" },
    { "file": "supabase/migrations/20261016181000_subject_delete.sql", "literal": "create function private.empty_self_subject_v1(p_account_id uuid,p_subject_id uuid)" }
  ]
}
```

New: no row. The two other kinds' rows (`other-adult-uploader-consent.upload-other-adult`, `embryo-nonparent-uploader-own-upload-artifact`) are untouched.

## 4. Ledger note `consentWithdrawalNotRegisteredNote`: the counts

Old: "… api.consent-revoke's policy.withdrawalRoutes.cases names the routes that withdraw eight of the eleven dispositionCases kinds (donor attribution as a consent that cannot be given yet). These rows are the other three: nothing withdraws them short of deleting the whole record or the account, which also ends more than the consent. …"

New: "… api.consent-revoke's policy.withdrawalRoutes.cases names the routes that withdraw nine of the eleven dispositionCases kinds (donor attribution as a consent that cannot be given yet; self-upload-class-consent since the owner decision of 2026-11-19, \"Withdrawing consent for a person's own DNA file deletes the files and all made from them\"). These rows are the other two: nothing withdraws them short of deleting the whole record or the account, which also ends more than the consent. …"

(The two other withdrawals being built in parallel will move these counts again; the sentences around them are unchanged.)

## Not register changes, listed for completeness

- `SHELL_CSRF_ROUTES` (`src/lib/security/session-csrf.ts`) gains `api.subject-delete`: the signed-in shell now renders that route's one-time `X-Inherit-CSRF` token, as it does for the other authenticated routes its pages send to. `api.subject-delete` was already in `SESSION_CSRF_ROUTES` and its route already wrapped by `withAccountCsrf`.
- No page-level register fact changed: `settings.consents` and `files.index` keep their state profiles, `notApplicableStates`, task-depth entries and resource-authorization rows; `gate:routes` and the client/form census pass with the control in place.
