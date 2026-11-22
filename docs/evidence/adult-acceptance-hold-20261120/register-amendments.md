# D-141: register and ledger changes (20 November 2026)

Basis: the owner's rule of 19 November 2026, "G8.5: where the register is stricter, engineering codes to it" (`docs/protocol/decisions.md`). `docs/route-register.json` was edited as text (nothing re-serialised; the file still parses, and the edit script asserted each anchor once). No ledger changed: no row of `docs/register-contract-divergence.json`, `docs/route-divergence.json` or any other ledger names the hold, the re-notice or `invitation-accepted-v1`'s origin. Every new register string starts `registered-2026-11-20-G8.5-where-the-register-is-stricter-engineering-codes-to-it-(owner-decision-2026-11-19;D-141;20261120120000)`.

Two statements change, both to describe what is now built. Neither adds a right, a recipient, a purpose or a page; neither changes a requirement. No other statement had to change: `policyResolvers.other-adult-mitigation-state-v1`, `adult-subject-confirmation-v1.authenticatedTransaction`, `invitation-accepted-v1`, `api.invitation-accept` and the retention bindings already describe what the code now does for an account acceptance (the code now meets them).

## 1. `policyContracts.adult-subject-confirmation-v1` gains `accountOriginBinding` (after `authenticatedTransaction`)

Old: no key. `authenticatedTransaction` (unchanged) says "start-adult.acceptance-hold-72h-only-when-a-server-owned-auth-account-creation-binding-proves-this-account-was-created-from-this-exact-invitation-start-adult.re-notice-30d-for-every-account-acceptance … an-existing-account-has-no-72-hour-hold", without saying what the binding is.

New:

```json
"accountOriginBinding": "registered-2026-11-20-G8.5-where-the-register-is-stricter-engineering-codes-to-it-(owner-decision-2026-11-19;D-141;20261120120000): the-server-owned-auth-account-creation-binding-is-read-inside-the-account-acceptance-transaction-from-the-accepting-account's-auth.users.created_at-and-this-exact-invitation's-issuance-time-and-never-from-the-request; only-an-account-the-auth-row-shows-existed-before-this-invitation-was-issued-is-an-existing-account, and-every-other-account-including-one-with-no-recorded-creation-time-is-treated-as-created-from-this-invitation; the-transaction-starts-adult.re-notice-30d-for-every-account-acceptance-and-adult.acceptance-hold-72h-only-for-an-account-treated-as-created-from-this-invitation, each-as-one-retention-row-on-the-accepted-invitation-with-its-one-registered-notice-enqueue-phase-whose-fixed-deadline-is-acceptance-plus-72-hours-or-plus-30-days, and-the-re-notice-phase's-immutable-envelope-records-the-origin-and-the-two-times-it-was-decided-from; api.invitation-accept-answers-invitation-accepted-v1-from-that-record; the-noAccountTransaction-starts-no-adult.re-notice-30d-yet"
```

Called out for the owner: the register says the binding "proves" the account was created from this invitation. What the database can verify is that the account did not exist when this invitation was sent to the address the account controls. An account created after the invitation for an unrelated reason is therefore held too. This is not new: Path B's decision has held such an account (for good) since 30 September; the change is that the hold now ends. The alternative (a binding written when an account is created in a browser holding the invitation's rights session) would hold fewer people but lets an uploader skip the hold by signing up in another browser. Owner to confirm.

## 2. `policyResolvers.path-b-report-queued-v1.unimplementedMitigations`

Old:

```json
"unimplementedMitigations": "adult.non-account-holder-24mo-adult.acceptance-hold-72h-and-adult.re-notice-30d-remain-closed-without-their-required-current-evidence"
```

New (the old statement kept, the built state appended):

```json
"unimplementedMitigations": "adult.non-account-holder-24mo-adult.acceptance-hold-72h-and-adult.re-notice-30d-remain-closed-without-their-required-current-evidence; registered-2026-11-20-G8.5-where-the-register-is-stricter-engineering-codes-to-it-(owner-decision-2026-11-19;D-141;20261120120000): for-an-account-acceptance-both-now-have-their-evidence: the-uploader-is-held-until-72-hours-after-acceptance-and-the-second-notice's-provider-submission-acceptance-when-the-account-was-treated-as-created-from-the-invitation, and-from-the-30-day-boundary-until-the-re-notice's-provider-submission-acceptance; the-normalization-authority-leaves-the-30-day-boundary-to-other-adult-mitigation-state-v1; named-human-reviewed-undeliverability-and-the-no-account-re-notice-are-not-built-so-those-cases-stay-closed"
```

## Not amended (reported instead)

- `retentionPhaseManifestClassBindings.invitation.contact-terminal-30d` requires, for an accepted adult, the re-notice's provider acceptance before the contact is shredded; the code shreds at the fixed deadline regardless (as before this change). For account acceptances the re-notice no longer uses that contact; for no-account acceptances the re-notice is not built. Changing either needs the owner (the register also forbids keeping the contact for a delivery).
- `policyResolvers.other-adult-mitigation-state-v1.cases.no-account-path-b` requires "the same adult.re-notice-30d state"; the code keeps denying that uploader from 30 days (stricter, unchanged).
- The brief's §5 sentence "no-account 24-month, new-account 72-hour and 30-day re-notice cases remain closed until their required evidence exists" is now partly out of date; the brief is not edited here.
