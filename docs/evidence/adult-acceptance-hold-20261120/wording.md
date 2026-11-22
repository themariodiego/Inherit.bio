# D-141 wording: every new string, verbatim (NOT APPROVED)

**APPROVED by the owner on 22 November 2026** (`docs/protocol/decisions.md`, "The wording of the 72-hour notice and the 30-day reminder is approved"). The strings below are the approved text; the notes about it are kept as they were written.

Neither the signed register nor the brief gives words for the second notice or the re-notice. The register names no mail template or copy id for them (`policyResolvers.other-adult-mitigation-state-v1`, `retentionPhaseManifestClassBindings` `adult.acceptance-hold-72h` / `adult.re-notice-30d`, `docs/retention.md`: "send a second independent notice under `mail-token-delivery-v1`"; "an unconditional notice restating one-click revocation"). The brief (§3, "Three operable mitigations") says only "a second independent notice is sent to the address at that boundary" and "a plain, unconditional re-notice is sent 30 days after acceptance, restating the one-click revoke".

So every string below is a draft for the owner. All live in one copy module, `src/copy/upload/other-adult-acceptance-notices.ts`, and are rendered by the existing template `invitation-terminal-notice` (`src/emails/invitation-terminal-notice.tsx`, heading plus one paragraph, inside the shared `EmailLayout` with its unchanged attribution and "Informational, not medical advice." footer). The subjects are chosen in `mailSubject` (`src/lib/email.ts`) for these two kinds only. No existing string changed; no page changed; no legal artifact or signed text changed.

`pnpm gate:readability` passes (3512 blocks). Grades below are the repository's own Flesch-Kincaid (`scripts/readability.ts`); short headings are checked word by word against `data/plain-vocabulary.json` (every word registered).

## 1. The second notice (`adult-acceptance-second-notice`)

Sent once, 72 hours after the acceptance, only when the accepting account was created after the invitation was sent (Path A and Path B's account branch). Addressed to the account's current verified address, read only in the mail worker's memory. Until the mail provider accepts it, the uploader is denied and nothing is analysed.

| Where | String | Reading level |
|---|---|---|
| Email subject (`ADULT_ACCEPTANCE_SECOND_NOTICE_COPY.subject`) | Did you accept an invitation on Inherit? | short line |
| Email heading (`ADULT_ACCEPTANCE_SECOND_NOTICE_COPY.heading`) | Did you accept an invitation on Inherit? | short heading, all words registered |
| Email body (`ADULT_ACCEPTANCE_SECOND_NOTICE_COPY.body`) | Three days ago, a new Inherit account accepted an invitation sent to this email address. If that was you, you do not need to do anything. Nothing was made from it or shared before this email. If it was not you, or you did not expect this, write to privacy@inherit.bio. | grade 6.3 (52 words) |

## 2. The re-notice (`adult-revocation-renotice`)

Sent once, 30 days after every acceptance through an account (Path A and Path B's account branch), to the account's current verified address. From 30 days until the provider accepts it, the uploader sees nothing more.

| Where | String | Reading level |
|---|---|---|
| Email subject (`ADULT_REVOCATION_RENOTICE_COPY.subject`) | You can still stop this on Inherit | short line |
| Email heading (`ADULT_REVOCATION_RENOTICE_COPY.heading`) | You can still stop this | short heading, all words registered |
| Email body (`ADULT_REVOCATION_RENOTICE_COPY.body`) | About 30 days ago, an Inherit account accepted an invitation sent to this email address. You can stop at any time, and you do not need to give a reason. Sign in to Inherit to turn off any sharing. To have the record deleted, write to privacy@inherit.bio. | grade 7.2 (49 words) |

## Points for the owner on these words

1. **The re-notice does not say "one click".** The register requires it to restate one-click revocation. Neither path has a one-click delete in the person's account today: Path A's place for it (`/settings/people`) is "not built", and a Path B person can turn sharing off per layer on `/files` but has no delete control there (deletion goes through the mailed link or the contact of last resort). The draft therefore names only what exists: turning off sharing in the account, and asking privacy@inherit.bio to delete. Saying "one click" would be untrue today.
2. **One text serves both paths.** The template carries no name, file, record label or link (its contract), so the same words go to a Path A adult (their own record; nothing is shared) and a Path B adult (a file someone added for them). "Turn off any sharing" is true but empty for Path A.
3. **"Nothing was made from it or shared before this email."** True by construction: the hold denies the uploader at every checkpoint and the person's own analysis and derived reads until the provider has accepted this email. It echoes the existing "Nothing is made from it unless you say yes." of the upload notice.
4. **No new page wording.** The register's `invitation-accepted-v1` now answers `hold_72h` for an account created from the invitation, but the Path A receipt page reads only `invitationKind` and `status`, and its existing words ("The reserved subject now belongs to your account. The inviter received no genetic-data access.") stay true during the hold. During the hold a Path B person keeps seeing the existing "Sharing with the person who added your file is not open yet." If the owner wants the hold named on a page, a candidate line (not built, not in the code) for the Path A receipt is: "Because this account is new, we will email this address again in three days. Nothing is made from the record before then." (grade not measured; it would need a browser spec).
