# D-156 follow-up: register change (22 November 2026)

Basis: the owner decision of 22 November 2026, "The 72-hour hold covers an inviter's reads of the invited adult's own record" (`docs/protocol/decisions.md`). The decision says that during either window the inviter sees nothing the adult shares with them. `docs/route-register.json` was edited as text, with one anchored edit and nothing re-serialised. The file still parses. `pnpm gate:routes`, `scripts/route-gate.test.ts` and both correspondence tests pass. No ledger changed: no row of `docs/register-contract-divergence.json`, `docs/route-divergence.json` or any other ledger names the account archive's recipient branch or this hold.

One statement changes. The edit names the archive reader under the existing key; it adds no right, recipient, purpose, state or page, and changes no other requirement. The appended text starts `registered-2026-11-22-D-156`.

## `policyContracts.other-adult-mitigation-state-v1.invitedAdultOwnRecordInviterReads`

Old (unchanged; it ends):

```text
…, an-acceptance-recorded-before-20261120120000-keeps-the-creation-time-comparison-and-is-never-released, and-when-a-clock-clears-the-reads-resume-with-no-queued-work"
```

New: the same text, with the following appended before the closing quote:

```text
; registered-2026-11-22-D-156-the-inviter's-own-account-archive-is-held-too-(20261122140000): the-native-complete-archive's-recipient-branch (export.share-link-and-raw.export, read-through-account_archive_complete_subjects_v1, account_archive_complete_subject_authority_v1, account_archive_export_recipient_v1-and-account_archive_raw_authority_v1) answers-the-held-inviter-exactly-as-with-no-grant: the-subject-is-not-listed-through-its-grants-to-the-inviter, a-subject-listed-by-another-link (a-family-pair) is-excluded-as-export-recipient-consent-required-with-no-raw-authority, and-the-recipient-and-raw-authorities-answer-not_found; an-archive-queued-building-or-ready-when-a-hold-or-a-due-reminder-starts-is-refused-at-build, readiness, delivery, every-manifest-page-and-every-chunk-issue-and-acknowledgement-by-its-existing-authority-receipt-currentness, and-is-current-again-with-no-job-run-when-the-clock-clears; the-preserved-account-export-already-refuses-any-account-holding-a-live-recipient-grant-and-is-unchanged, and-the-inviter's-own-directional_grants-class (the-grants-it-received, with-no-purpose-and-no-subject-named) is-unchanged
```

Why: the key named the Family readers and Copilot (`20261122110000`). The inviter's account archive is a third read of what the adult shares (`export.share-link`, `raw.export`). From `20261122140000` it answers the held inviter as with no grant. The appended text names its four checkpoints and says what refuses an archive made before the window. It also says what is unchanged: the preserved export, which already reads nothing shared, and the inviter's own class of grants received.

Not changed: `policyResolvers.other-adult-mitigation-state-v1`, every `routes[…]` entry (no page, route or wording changes), and the two Copilot statements amended by `20261122110000`.
