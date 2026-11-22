# Register amendments of this change (owner decision of 22 November 2026)

## Made

One amendment, one line added, marked `registered-2026-11-22-…` and naming the decision. The full old/new is in `xfer-register-entry.md`.

| # | Where | Old | New | Why |
|---|---|---|---|---|
| 1 | `lifecycleDispositionContracts.subject-ownership-transfer-v1` | (no key; the contract's only actor is `eligibleSubject`: "adult-subject-with-a-server-verified-subject_account_id-equal-to-the-acting-account") | new key `uploaderWithdrawalActorCase`: "registered-2026-11-22-owner-decision-an-uploader's-withdrawal-hands-a-record-its-adult-holds-to-that-adult: a-second-actor-case-besides-eligibleSubject: the-owning-uploader's-withdrawal-of-its-other-adult-uploader-consent.upload-other-adult-sent-as-api.subject-delete's-adult-case-to-withdraw_other_adult_upload_v1-for-a-confirmed-active-path-b-record-whose-server-verified-subject_account_id-is-the-adult's-own-account-runs-this-transfer-on-the-uploader's-act: the-record-and-the-files-the-adult-confirmed-move-to-that-account-under-every-rule-of-this-contract; every-file-the-adult-has-not-confirmed-is-deleted-as-withdrawn; the-uploader's-upload_class-consent-is-marked-withdrawn-and-kept; the-uploader-keeps-no-access; the-adult-is-told-through-this-contract's-notices; while-the-transfer-is-closed-until-its-three-notices-are-worded-and-approved-the-case-is-refused-with-resource-not-found-v1-and-nothing-changes" | The decision adds the uploader's withdrawal as a second actor case of this contract. |

## Made at integration: two statements this decision had left stale

Both still describe the closed state correctly (the branch is refused and nothing changes), but each gives the old reason ("until the owner decides who holds it"), which the decision of 22 November has answered. The brief was "amend the register to describe exactly that, and nothing else", so they are left as they are. Proposed replacements, if you want them carried in the same change:

| # | Where | Clause now | Proposed clause |
|---|---|---|---|
| A | `routes[api.subject-delete].policy.cases.adult.withdrawal` | "…a-record-the-adult-holds-with-their-own-account-(subject_account_id-set)-is-refused-with-resource-not-found-v1-and-nothing-changes, and-delete_subject_v1-itself-refuses-the-owning-account-on-such-a-record, until-the-owner-decides-who-holds-it-after-the-uploader's-withdrawal; …" | "…a-record-the-adult-holds-with-their-own-account-(subject_account_id-set)-is-handed-to-them-under-lifecycleDispositionContracts.subject-ownership-transfer-v1.uploaderWithdrawalActorCase (registered-2026-11-22-owner-decision-an-uploader's-withdrawal-hands-a-record-its-adult-holds-to-that-adult); while-that-transfer-is-closed-it-is-refused-with-resource-not-found-v1-and-nothing-changes, and-delete_subject_v1-itself-refuses-the-owning-account-on-such-a-record-in-every-state; …" |
| B | `routes[api.consent-revoke].policy.withdrawalRoutes.cases["other-adult-uploader-consent.upload-other-adult"].how` | "…a-record-the-adult-holds-with-their-own-account-is-not-withdrawn-here-yet: the-door-and-delete_subject_v1-refuse-the-uploader-on-it-and-the-card-says-so, because-who-holds-the-record-after-the-uploader's-withdrawal-is-not-decided; …" | "…a-record-the-adult-holds-with-their-own-account-is-handed-to-them-through-the-transfer-(subject-ownership-transfer-v1.uploaderWithdrawalActorCase, registered-2026-11-22-…): while-the-transfer-is-closed-the-door-refuses-the-uploader-on-it-and-the-card-says-so, and-once-it-is-open-the-card-reads-hand-over-and-the-same-confirmation-sends-it; delete_subject_v1-refuses-the-uploader-on-such-a-record-in-every-state; …" |

Also unchanged, and still true: `routes[api.subject-transfer].policy.actorRole` ("exact-subject.subject_account_id-from-the-authenticated-session"): that route still serves only the person's own act; the uploader's act arrives on `api.subject-delete`. `subject-ownership-transfer-v1.notices` names the three notices; their wording (`xfer-transfer-wording.md`) is not approved, so no statement says it is.

## When the switch opens (not now)

The change that opens the transfer should amend: `subject-ownership-transfer-v1` (the transfer is open; its notices are approved, with the decision's date), `uploaderWithdrawalActorCase` (drop "while-the-transfer-is-closed…"), and A and B above (the branch runs).
