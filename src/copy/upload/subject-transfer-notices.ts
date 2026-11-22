/**
 * The three notices of a record transfer (register
 * lifecycleDispositionContracts.subject-ownership-transfer-v1, `notices`:
 * new-subject-owner, former-owning-account,
 * every-principal-whose-access-was-revoked), for each of its two acts: the
 * person's own "Move this to my account" (brief section 2.6, item 7; X3.5),
 * and, since the owner decision of 22 November 2026 ("An uploader's
 * withdrawal hands a record its adult holds to that adult"), the uploader's
 * withdrawal of its permission for a record the person holds with their own
 * account. Five kinds of the terminal-notice queue (template
 * `invitation-terminal-notice`), each sent to an account's own verified
 * address, read only in the mail worker's memory:
 *
 *   - `subject-transfer-new-owner`: to the person, after their own transfer;
 *   - `subject-transfer-former-owner`: to the uploader, after it;
 *   - `withdrawal-transfer-new-owner`: to the person, after the uploader's
 *     withdrawal handed them the record;
 *   - `withdrawal-transfer-former-owner`: to the uploader, after its own
 *     withdrawal;
 *   - `subject-transfer-access-revoked`: to any other account whose access to
 *     the record ended, after either act.
 *
 * The notice names nobody, no file and no record, and carries no link, as
 * every terminal notice: the template accepts only its kind.
 *
 * APPROVED by the owner on 22 November 2026 ("The transfer notices are
 * approved, with one added line, and the transfer is switched on",
 * docs/protocol/decisions.md): every string as listed in
 * docs/evidence/uploader-hand-over-20261122/transfer-wording.md, and the two
 * emails to the person who now holds the record (`subject-transfer-new-owner`
 * and `withdrawal-transfer-new-owner`) gain one line before their closing
 * sentence: "Any download copy of this record has stopped working. You can
 * make a new one." The transfer opened with migration 20261122120000, so the
 * database queues these notices inside every transfer; migration
 * 20261122160000, in the same release, lets the person make that new copy of
 * the record and of their whole account at once (D-162). None changes a
 * signed text.
 */

export const SUBJECT_TRANSFER_NEW_OWNER_NOTICE_COPY = {
  subject: "A DNA record is now in your Inherit account",
  heading: "This record is now yours",
  body: "You moved a DNA record that someone else added for you into your own Inherit account. The files you confirmed are now yours, and so are the results you kept. The person who added them can no longer see anything about it. Any download copy of this record has stopped working. You can make a new one. If you did not do this, change your password now.",
} as const;

export const SUBJECT_TRANSFER_FORMER_OWNER_NOTICE_COPY = {
  subject: "A DNA record you added has moved on Inherit",
  heading: "Your access to a record has ended",
  body: "The person you added a DNA file for has moved the record into their own Inherit account. You can no longer see the record, its files or anything made from them. Your conversations about it have been deleted. You do not need to do anything.",
} as const;

export const WITHDRAWAL_TRANSFER_NEW_OWNER_NOTICE_COPY = {
  subject: "A DNA record is now in your Inherit account",
  heading: "This record is now yours",
  body: "The person who added your DNA file to Inherit has withdrawn their permission. The record and the files you confirmed are now in your own account. Files you had not confirmed have been deleted. They can no longer see anything about it. Any download copy of this record has stopped working. You can make a new one. You do not need to do anything.",
} as const;

export const WITHDRAWAL_TRANSFER_FORMER_OWNER_NOTICE_COPY = {
  subject: "Your permission on Inherit has ended",
  heading: "Your permission has ended",
  body: "You withdrew your permission for a DNA file you added for someone else. They hold the record in their own account, so it is now theirs, with the files they confirmed. Files they had not confirmed have been deleted. You can no longer see anything about it. If you did not do this, change your password now.",
} as const;

export const SUBJECT_TRANSFER_ACCESS_REVOKED_NOTICE_COPY = {
  subject: "A record shared with you on Inherit has moved",
  heading: "Your access to a record has ended",
  body: "Your access to a DNA record that was shared with you has ended. The person it is about now holds it in their own Inherit account. You can no longer see it or anything made from it. You do not need to do anything.",
} as const;

/** Each transfer notice kind of the terminal-notice queue, with its words. */
export const SUBJECT_TRANSFER_NOTICES = {
  "subject-transfer-new-owner": SUBJECT_TRANSFER_NEW_OWNER_NOTICE_COPY,
  "subject-transfer-former-owner": SUBJECT_TRANSFER_FORMER_OWNER_NOTICE_COPY,
  "subject-transfer-access-revoked": SUBJECT_TRANSFER_ACCESS_REVOKED_NOTICE_COPY,
  "withdrawal-transfer-new-owner": WITHDRAWAL_TRANSFER_NEW_OWNER_NOTICE_COPY,
  "withdrawal-transfer-former-owner": WITHDRAWAL_TRANSFER_FORMER_OWNER_NOTICE_COPY,
} as const;

export type SubjectTransferNoticeKind = keyof typeof SUBJECT_TRANSFER_NOTICES;
