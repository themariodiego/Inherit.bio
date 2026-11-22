# D-156: register changes (22 November 2026)

Basis: the owner decision of 22 November 2026, "The 72-hour hold covers an inviter's reads of the invited adult's own record" (`docs/protocol/decisions.md`). `docs/route-register.json` was edited as text: three anchored edits, nothing re-serialised. The file still parses, and `pnpm gate:routes`, `scripts/route-gate.test.ts` and both correspondence tests pass. No ledger changed: no row of `docs/register-contract-divergence.json`, `docs/route-divergence.json` or any other ledger names D-156, the hold or these readers. Every new register string starts `registered-2026-11-22-the-72-hour-hold-covers-an-inviter's-reads-of-the-invited-adult's-own-record-(owner-decision-2026-11-22;D-156;20261122110000)`.

Three statements change. All three describe that the hold covers these reads. None adds a right, a recipient, a purpose, a state or a page, and none changes another requirement.

1. `policyContracts.other-adult-mitigation-state-v1` gains the key `invitedAdultOwnRecordInviterReads`, placed after `subjectOwnRightsBypass`. The contract decides only for the `other_adult` record (`subjectSource`), but a Path A adult's files are on their own `self` record. The new key applies the same two clocks to the inviter's reads of that record. It names the readers, says they answer as if nothing were shared with no reason shown, and says what is not held.
2. `policyResolvers.scope-derived-v1.cases.subject:adult.principalRelationshipCases.uploader-or-grantee.builtProjections`. Its parenthesis says the Family recipient reader "has never asked" the mitigation contract about a `self` subject. That is no longer true. The old text is kept and the new state is appended.
3. `routes[copilot.scope].policy.pageBranches.subject-adult-uploader-or-grantee`. Its `held` branch applies when the mitigation contract denies an `other_adult` record. Without a note, a reader could take the new key to mean that branch. The appended parenthesis says the inviter sees `permission-missing` (what "not shared" shows) and never `held`.

Each statement below is given old, then new, exactly as in the file (JSON string values).

## 1. `policyContracts.other-adult-mitigation-state-v1.invitedAdultOwnRecordInviterReads`

Old: no key.

New:

```json
"invitedAdultOwnRecordInviterReads": "registered-2026-11-22-the-72-hour-hold-covers-an-inviter's-reads-of-the-invited-adult's-own-record-(owner-decision-2026-11-22;D-156;20261122110000): for-a-path-a-account-acceptance-the-same-adult.acceptance-hold-72h-and-adult.re-notice-30d-state-also-binds-the-inviter's-reads-of-the-invited-adult's-own-self-subject: until-72-hours-after-acceptance-and-the-second-notice's-provider-submission-acceptance-when-the-account-was-treated-as-created-from-the-invitation, and-from-the-30-day-boundary-until-the-re-notice's-provider-submission-acceptance-for-every-account-acceptance, every-family-recipient-read-of-that-subject-by-the-inviter (reports-and-their-confirmation, ancestry, the-inviter's-inbound-family.heritability-direction, the-inviter's-side-of-a-family.portrait-pair, raw.browse-and-every-page-built-on-the-family-graph) and-both-copilot-scopes (the-family-group-member-and-the-subject:adult-grantee-layers, their-conversation-history-unreadable-and-unlisted-with-nothing-deleted) answer-exactly-as-when-nothing-is-shared-with-no-gate-or-reason-shown; the-adult's-own-reads-and-rights (their-own-view-of-a-pair-included), every-other-grantee's-reads, a-path-b-subject-and-its-uploader and-the-inviter's-reads-of-any-other-subject-are-unchanged; a-notice-that-never-reaches-provider-submission-acceptance-keeps-the-inviter's-reads-closed, an-acceptance-recorded-before-20261120120000-keeps-the-creation-time-comparison-and-is-never-released, and-when-a-clock-clears-the-reads-resume-with-no-queued-work"
```

## 2. `policyResolvers.scope-derived-v1.cases.subject:adult.principalRelationshipCases.uploader-or-grantee.builtProjections`

Old (unchanged prefix, ends):

```text
…; every-turn-pair-records-the-subject-in-retrieved_subject_ids-and-copilot.local-plus-each-layer-read-in-retrieved_purpose_keys-with-one-copilot_turn_dependencies-row-per-subject-grant-and-source; cloudProvider-stays-absolute-deny"
```

New (the same, with this appended before the closing quote):

```text
; registered-2026-11-22-the-72-hour-hold-covers-an-inviter's-reads-of-the-invited-adult's-own-record-(owner-decision-2026-11-22;D-156;20261122110000): since-20261122110000-the-family-recipient-reader-asks-other-adult-mitigation-state-v1.invitedAdultOwnRecordInviterReads-for-a-self-subject, so-while-it-holds-the-acting-account-as-the-inviter-of-the-subject's-path-a-acceptance-no-report-layer-is-readable, the-grantee-case-is-permission-missing, and-its-conversations-are-unreadable-and-unlisted-with-nothing-deleted
```

## 3. `routes[copilot.scope].policy.pageBranches.subject-adult-uploader-or-grantee`

Old (the clause the parenthesis follows, unchanged):

```text
…; permission-missing-when-the-person-has-no-current-copilot.local-to-the-acting-account-or-no-shared-report-layer-without-saying-which; the-tier-2-acknowledgement-gate; …
```

New:

```text
…; permission-missing-when-the-person-has-no-current-copilot.local-to-the-acting-account-or-no-shared-report-layer-without-saying-which (registered-2026-11-22-the-72-hour-hold-covers-an-inviter's-reads-of-the-invited-adult's-own-record-(owner-decision-2026-11-22;D-156;20261122110000): a-layer-other-adult-mitigation-state-v1.invitedAdultOwnRecordInviterReads-keeps-from-the-acting-account-is-not-shared-here, so-that-inviter-sees-permission-missing-and-never-held); the-tier-2-acknowledgement-gate; …
```

## Not amended (reported instead)

- `policyContracts.other-adult-mitigation-state-v1.cases.all-class-b-re-notice` says the re-notice denies "every further uploader-or-grantee" read. For the invited adult's own record the decision names only the inviter, so a third account they share with is not held. Left unchanged. The owner may want to say whether the 30-day reminder should also hold other grantees.
- `policyContracts.resource-authorization-v1.otherAdultMitigationDecision` names only an `other_adult` target or contributor. The new key is reached through each named reader. Widening that sentence would require every reader of a `self` subject to ask the contract, which the decision does not ask for.
- The Family routes (`family.index`, `family.person`, `family.permissions`, `family.health-picture`, `family.portrait`) and `copilot.scope`'s other branches already have a "nothing shared" or consent-required state. The hold maps exactly onto those states, so no state or branch changed.
- The account archive's recipient branch (`export.share-link` and `raw.export`, through `private.account_archive_complete_subject_authority_v1`) is not a Family reader and is not covered. No register text changed for it. This is for the owner to decide.
