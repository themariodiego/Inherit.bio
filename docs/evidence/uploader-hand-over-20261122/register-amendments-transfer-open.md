# Register amendments: the transfer switched on, and a hand-over refused for now (owner decisions of 22 November 2026)

`docs/route-register.json`, edited as text (no re-serialisation; `JSON.parse` succeeds). Line numbers are on top of `beff9d60`. Against that tip the diff is 16 insertions and 4 deletions: three statements amended for the transfer switch (1-3, each marked `registered-2026-11-22-transfer-open`), then for D-158 one response contract added (4), bound to one route (5), and one clause added to each of two statements (6, 7), each marked `registered-2026-11-22-owner-decision-a-hand-over-refused-for-now-says-to-try-later`. Nothing else in the register or the brief changes.

## 1. `lifecycleDispositionContracts.subject-ownership-transfer-v1.uploaderWithdrawalActorCase` (line 8101)

Old (tail of the statement; everything before it unchanged):

> …; the-adult-is-told-through-this-contract's-notices; while-the-transfer-is-closed-until-its-three-notices-are-worded-and-approved-the-case-is-refused-with-resource-not-found-v1-and-nothing-changes

New:

> …; the-adult-is-told-through-this-contract's-notices; registered-2026-11-22-transfer-open: the-transfer-and-this-case-are-open-since-migration-20261122120000 (owner-decision-of-2026-11-22-the-transfer-notices-are-approved-with-one-added-line-and-the-transfer-is-switched-on), and-the-three-notices-carry-their-approved-wording

Why: the statement said the case is refused until the notices are worded and approved; both happened today.

## 2. `routes[api.subject-delete].policy.cases.adult.withdrawal` (line 18502)

Old (the middle clause; the rest unchanged):

> …(registered-2026-11-22-owner-decision-an-uploader's-withdrawal-hands-a-record-its-adult-holds-to-that-adult); while-that-transfer-is-closed-it-is-refused-with-resource-not-found-v1-and-nothing-changes, and-delete_subject_v1-itself-refuses-the-owning-account-on-such-a-record-in-every-state; …

New:

> …(registered-2026-11-22-owner-decision-an-uploader's-withdrawal-hands-a-record-its-adult-holds-to-that-adult); that-transfer-is-open-and-runs-on-the-owning-account's-request (registered-2026-11-22-transfer-open), and-delete_subject_v1-itself-refuses-the-owning-account-on-such-a-record-in-every-state; …

Why: the branch no longer refuses; it runs the transfer.

## 3. `routes[api.consent-revoke].policy.withdrawalRoutes.cases["other-adult-uploader-consent.upload-other-adult"].how` (line 19412)

Old (the middle clause; the rest unchanged):

> …registered-2026-11-22-owner-decision-an-uploader's-withdrawal-hands-a-record-its-adult-holds-to-that-adult): while-the-transfer-is-closed-the-door-refuses-the-uploader-on-it-and-the-card-says-so, and-once-it-is-open-the-card-reads-hand-over-and-the-same-confirmation-sends-it; delete_subject_v1-refuses-…

New:

> …registered-2026-11-22-owner-decision-an-uploader's-withdrawal-hands-a-record-its-adult-holds-to-that-adult): the-transfer-is-open (registered-2026-11-22-transfer-open), so-the-card-reads-hand-over-and-the-same-confirmation-sends-it; delete_subject_v1-refuses-…

Why: the closed half of the statement no longer describes anything.

## 4. New `responseContracts["hand-over-not-now-v1"]` (lines 11145-11155, after `consent-integrity-v1`)

```json
"hand-over-not-now-v1": {
  "status": 409,
  "contentType": "application/json",
  "body": {
    "error": {
      "const": "try_later"
    }
  },
  "unknownFieldsRecursively": "forbidden",
  "when": "registered-2026-11-22-owner-decision-a-hand-over-refused-for-now-says-to-try-later-(D-158): the-owning-uploader's-withdrawal-of-a-record-whose-adult-holds-it-with-their-own-account-(subject-ownership-transfer-v1.uploaderWithdrawalActorCase)-is-refused-at-that-moment-because-a-file-is-still-being-validated-a-file-has-a-shape-the-transfer-does-not-expect-or-the-adult's-account-is-gone; nothing-is-written-and-no-code-is-spent; every-other-refusal-stays-resource-not-found-v1"
}
```

Why: owner decision "A hand-over refused for now says to try later (D-158)". The route answers the database's 55000 `hand_over_not_now` (`20261122160000`) with this body through `closedResponse("api.subject-delete", ["error"], …, 409)`; the card shows "This cannot be done right now. Nothing was deleted. Try again later."

## 5. `responseContractBindings.routes["api.subject-delete"]` (line 14409)

Old: `["lifecycle-accepted-v1", "resource-not-found-v1"]`. New: `["lifecycle-accepted-v1", "resource-not-found-v1", "hand-over-not-now-v1"]`. Why: the route now answers it.

## 6. `routes[api.subject-delete].policy.cases.adult.withdrawal` (line 18502), a second clause

Old (after amendment 2):

> …that-transfer-is-open-and-runs-on-the-owning-account's-request (registered-2026-11-22-transfer-open), and-delete_subject_v1-itself-refuses-…

New:

> …that-transfer-is-open-and-runs-on-the-owning-account's-request (registered-2026-11-22-transfer-open), and-a-hand-over-refused-at-that-moment-answers-hand-over-not-now-v1 (registered-2026-11-22-owner-decision-a-hand-over-refused-for-now-says-to-try-later), and-delete_subject_v1-itself-refuses-…

Why: the branch has a second answer besides 202 and the opaque 404.

## 7. `routes[api.consent-revoke].policy.withdrawalRoutes.cases["other-adult-uploader-consent.upload-other-adult"].how` (line 19412), a second clause

Old (after amendment 3):

> …the-transfer-is-open (registered-2026-11-22-transfer-open), so-the-card-reads-hand-over-and-the-same-confirmation-sends-it; delete_subject_v1-refuses-…

New:

> …the-transfer-is-open (registered-2026-11-22-transfer-open), so-the-card-reads-hand-over-and-the-same-confirmation-sends-it, and-on-hand-over-not-now-v1-says-this-cannot-be-done-right-now-nothing-was-deleted-try-again-later (registered-2026-11-22-owner-decision-a-hand-over-refused-for-now-says-to-try-later); delete_subject_v1-refuses-…

Why: the card's words for that answer.

## Not in the register (for the orchestrator)

- `data/plain-vocabulary.json` gains "done" and "later" (sorted), the two words of the approved line that the short-status rule did not yet know; `pnpm gate:readability` passes (3,552 blocks).
- No register statement describes the export capture of a transferred record, so D-162's fix (`20261122160000`) amends none. `subject-ownership-transfer-v1.oldOwnerAccess` still holds.

## Read and left unchanged

- `routes[api.subject-transfer]` (policy, request contract, `subject-transfer-v1`): says nothing about a closed door; still true.
- `subject-ownership-transfer-v1.notices` (`new-subject-owner`, `former-owning-account`, `every-principal-whose-access-was-revoked`): names recipients, not wording; still true.
- `subject-ownership-transfer-v1.oldOwnerAccess` ("revoke-in-the-same-transaction-every-prior-owner-grant-and-invalidate-download-chat-upload-and-generated-export-credentials"): true of the open transfer (pgTAP `subject_transfer_open.sql`). It says nothing of the new owner's ability to export afterwards; `20261122160000` makes that work for the e-signature flow (D-162), with no register change.
- Every other `transfer` mention (embryo dispositions, account deletion's `ownershipTransferPrecedence`, `policyContracts.adult-subject-account-binding-v1.ownership`'s "after-binding-the-subject-may-separately-call-api.subject-transfer"): unrelated or still true.
