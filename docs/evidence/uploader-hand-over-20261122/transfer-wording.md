# A record transfer's three notices, and the uploader's hand-over: every new string, for the owner

**Approved by the owner on 22 November 2026, with one added line** (owner decision "The transfer notices are approved, with one added line, and the transfer is switched on", `docs/protocol/decisions.md`): every string below is approved as shown, and the two emails to the person who now holds the record (A1, both versions) gain one line, "Any download copy of this record has stopped working. You can make a new one.", after the sentence about files and just before the closing sentence. The tables of A1 show it. The transfer is switched on by migration `20261122120000_subject_transfer_open.sql`, which replaces `private.subject_transfer_open_v1()` with a body answering true; Path B is test mode only.

Drafted under the owner decision of 22 November 2026, "An uploader's withdrawal hands a record its adult holds to that adult": "The transfer is closed until its three notices are worded and approved, so this branch stays refused until engineering brings the owner that wording and the owner approves it." Nothing here changes a signed text or any existing string; every string below is new.

## What the register and the brief ask of them

- Register, `lifecycleDispositionContracts.subject-ownership-transfer-v1.notices`: three notices, to the `new-subject-owner`, the `former-owning-account`, and `every-principal-whose-access-was-revoked`. The contract names no copy id or template. It says what the transfer does, which the notices report: the record and its files move to the person (`databaseTransaction`); every prior-owner grant ends and the old owner's download, chat, upload and export credentials are invalidated (`oldOwnerAccess`); chats are never reassigned, the others' are deleted (`conversations`); no raw contact or token in the audit event (`audit`).
- Register, the amended contract (this change): the uploader's withdrawal is a second actor case; "the adult is told through this contract's notices". So each notice has two variants, one per act, as five kinds (the third notice reads the same for both acts).
- Brief §2.6 item 7 and X3.5: "The subject may also take ownership: a 'Move this to my account' action transferring ... all derived data, leaving the inviter with nothing." Nothing in the brief words the notices.
- House rules carried over from the other terminal notices (`src/emails/invitation-terminal-notice.tsx`): the template takes only the kind; no name, file, record label, address or link.

## Where they live and how they are checked

- The notices: `src/copy/upload/subject-transfer-notices.ts` (one const per kind, and `SUBJECT_TRANSFER_NOTICES` mapping kind to words), rendered by the existing template `invitation-terminal-notice` (`src/emails/invitation-terminal-notice.tsx`), each with its own subject line (`mailSubject` in `src/lib/email.ts`), sent by the existing terminal mail worker (`src/lib/embryos/invitation-terminal-mail.ts`) to the account's own verified address, read only in the worker's memory. The database queues them (`private.queue_subject_transfer_notices_v1`, migration `20261122100000`) only inside a transfer, and the transfer runs only while the switch is open.
- The card: `OTHER_ADULT_HAND_OVER_COPY` in `src/copy/upload/other-adult-withdrawal.ts`, rendered by `src/components/uploads/other-adult-withdrawal.tsx` only when the database's read answers `hand-over` (only while the switch is open). While it is closed the card keeps its existing words for that record.
- `pnpm gate:readability` passes with every string (3,549 blocks; 3,551 with the added line, 22 November 2026). Strings of 15 words or more are graded (Flesch–Kincaid, limit 9); shorter headings, buttons and status lines use only words of `data/plain-vocabulary.json` (unchanged); every sentence under `src/copy/upload/` is at most 25 words. The grade below is computed with "{name}" read as "Sam Lee"; for strings under 15 words it is for information only. "Longest" is the longest sentence in words.

## A. The three notices

Every email has the standard footer of every Inherit email (unchanged). None carries a link.

### A1. To the person who now holds the record (`new-subject-owner`)

Recipient: the person's own Inherit account (the account the record is bound to), at its verified address.

**After the person's own transfer** (kind `subject-transfer-new-owner`, key `SUBJECT_TRANSFER_NEW_OWNER_NOTICE_COPY`):

| Part | Words | Grade | Longest | Text |
|---|---|---|---|---|
| Subject line | 9 | 5.0 | 9 | A DNA record is now in your Inherit account |
| Heading | 5 | — | 5 | This record is now yours |
| Body | 67 | 4.4 | 16 | You moved a DNA record that someone else added for you into your own Inherit account. The files you confirmed are now yours, and so are the results you kept. The person who added them can no longer see anything about it. **Any download copy of this record has stopped working. You can make a new one.** If you did not do this, change your password now. |

**After the uploader withdrew** (kind `withdrawal-transfer-new-owner`, key `WITHDRAWAL_TRANSFER_NEW_OWNER_NOTICE_COPY`):

| Part | Words | Grade | Longest | Text |
|---|---|---|---|---|
| Subject line | 9 | 5.0 | 9 | A DNA record is now in your Inherit account |
| Heading | 5 | — | 5 | This record is now yours |
| Body | 64 | 4.2 | 13 | The person who added your DNA file to Inherit has withdrawn their permission. The record and the files you confirmed are now in your own account. Files you had not confirmed have been deleted. They can no longer see anything about it. **Any download copy of this record has stopped working. You can make a new one.** You do not need to do anything. |

### A2. To the account that held the record (`former-owning-account`)

Recipient: the uploader's own Inherit account (the account that sent the request), at its verified address.

**After the person's own transfer** (kind `subject-transfer-former-owner`, key `SUBJECT_TRANSFER_FORMER_OWNER_NOTICE_COPY`):

| Part | Words | Grade | Longest | Text |
|---|---|---|---|---|
| Subject line | 9 | 5.0 | 9 | A DNA record you added has moved on Inherit |
| Heading | 7 | — | 7 | Your access to a record has ended |
| Body | 45 | 5.6 | 17 | The person you added a DNA file for has moved the record into their own Inherit account. You can no longer see the record, its files or anything made from them. Your conversations about it have been deleted. You do not need to do anything. |

**After its own withdrawal** (kind `withdrawal-transfer-former-owner`, key `WITHDRAWAL_TRANSFER_FORMER_OWNER_NOTICE_COPY`):

| Part | Words | Grade | Longest | Text |
|---|---|---|---|---|
| Subject line | 6 | — | 6 | Your permission on Inherit has ended |
| Heading | 4 | — | 4 | Your permission has ended |
| Body | 57 | 4.2 | 18 | You withdrew your permission for a DNA file you added for someone else. They hold the record in their own account, so it is now theirs, with the files they confirmed. Files they had not confirmed have been deleted. You can no longer see anything about it. If you did not do this, change your password now. |

### A3. To every other account whose access ended (`every-principal-whose-access-was-revoked`)

Recipient: each account, other than the person and the uploader, whose permission or link on the record the transfer ended, once each, at its verified address. Today no door lets a Path B person share with anyone but the uploader, so this notice has no recipient in practice; it is built so the contract's third notice exists when one does. After either act (kind `subject-transfer-access-revoked`, key `SUBJECT_TRANSFER_ACCESS_REVOKED_NOTICE_COPY`):

| Part | Words | Grade | Longest | Text |
|---|---|---|---|---|
| Subject line | 9 | 3.7 | 9 | A record shared with you on Inherit has moved |
| Heading | 7 | — | 7 | Your access to a record has ended |
| Body | 44 | 4.0 | 13 | Your access to a DNA record that was shared with you has ended. The person it is about now holds it in their own Inherit account. You can no longer see it or anything made from it. You do not need to do anything. |

The uploader is not sent this third notice: it is sent the former owner's, so each account receives one email per transfer.

## B. The uploader's card, for a record the person holds (hand-over)

Control: the existing "Your permission" section of the uploader's card for that person on **/files/upload**. Shown only when the database's read answers `hand-over`, that is only while the transfer is open. Recipient: the uploader, on screen.

### Before any click

| Key | Where | Role | Words | Grade | Text |
|---|---|---|---|---|---|
| `summary(name)` | Under the section heading | body | 27 | 4.5 | You can withdraw your permission for {name}'s DNA file at any time. {name} holds the record in their own account, so it then becomes theirs. |

The heading ("Your permission") and the trigger ("Withdraw my permission") are the existing strings.

### The confirmation

| Key | Where | Role | Words | Grade | Text |
|---|---|---|---|---|---|
| `moves(name)[0]` | List item | body | 11 | — | The record and every file {name} confirmed become theirs alone. |
| `moves(name)[1]` | List item | body | 10 | — | Any file {name} has not confirmed yet is deleted. |
| `moves(name)[2]` | List item | body | 14 | — | You can no longer see the record, its results or your conversations about it. |
| `moves(name)[3]` | List item | body | 9 | — | Every permission {name} gave you for it ends. |
| `notice(name)` | Under the list | body | 12 | — | We will email {name} and you to say this has happened. |
| `confirmButton` | Destructive button; sends the request | button | 3 | — | Withdraw my permission |

The dialog heading ("Withdraw your permission for {name}?"), the last line ("You cannot undo this."), "Keep my permission" and "Working…" are the existing strings.

### The receipt (after a 202 answer)

| Key | Where | Role | Words | Grade | Text |
|---|---|---|---|---|---|
| `receiptBody(name)` | Under the existing heading "Your permission has ended" | body | 20 | 3.7 | The record and the files {name} confirmed are now theirs. We are deleting any file they had not confirmed. |

### When a request does not succeed

| Key | When | Role | Words | Grade | Text |
|---|---|---|---|---|---|
| `uncertainStatus` | A 5xx answer, another status, or no answer | status | 16 | 1.5 | We do not know if this finished. Open this page again to see if it did. |

Any 4xx answer shows the existing "This did not work. Nothing was deleted. Please try again." (a refusal changes nothing).

### Unchanged while the switch was closed (before `20261122120000`)

For the same record the card keeps, word for word, the existing "You cannot withdraw your permission for {name} here yet. Nothing has changed." and offers no request (`e2e/other-adult-upload-withdrawal.spec.ts`, second test, passed against `20261122100000`; since `20261122120000` that test runs the hand-over through the screens and the emails instead, and `supabase/tests/uploader_withdrawal_hand_over.sql` keeps the closed branch with the switch closed inside a savepoint).

## Questions for the owner that the wording raises

1. **The card says the person holds the record with their own account.** It already differs on such a record today ("You cannot withdraw ... here yet"); the hand-over says why the record becomes theirs. Keep, or word both cases alike?
2. **Two emails for one withdrawal.** The uploader acted and sees a receipt on screen, and is also emailed (the contract's former-owner notice). Keep the uploader's email, or rely on the receipt?
3. **"If you did not do this, change your password now."** On the two notices sent to the person who acted (A1 own act, A2 withdrawal), as on the own-file withdrawal email. Keep?
4. **The person's own exports of the record end with a transfer.** The transfer revokes every export of the record, including the person's own (they can make a new one at once). None of the notices mentions it. Say it in A1, or leave it out?
5. **The notices name nobody and carry no link**, as every terminal notice. The person knows who added the file; the uploader knows whom it added it for. Keep anonymous?
6. **A3 has no recipient today** (no door lets a Path B person share with a third account). Approve it now so the contract is whole, or leave it until such a door exists?
7. **"Files you had not confirmed have been deleted."** said to the person even when there were none. Say it only when one was?

### Answered on 22 November 2026

The owner approved the wording as shown with one adjustment, "Say exports end" (question 4), which is the added line in A1. Not chosen: "Mention deleted files only if any" (question 7: the sentence is sent whether or not there were any), "No email to the uploader who withdrew" (question 2: it stays) and "Drop the password line" (question 3: it stays). Questions 1, 5 and 6 stand as shown.

Checked against the open transfer before the line was added (`supabase/tests/subject_transfer_open.sql`): every download copy that holds the record stops at its next open or chunk, the person's own included (the export of the record is revoked and stopped; every whole-account export that holds the record, the person's and the uploader's, and another account's that holds its link to the record, fails its authority recheck; live download sessions are revoked). The parenthesis of question 4, "they can make a new one at once", was not borne out by `20261122120000` alone: after either act, the export authority refused the person a new export of the record and of their whole account (42501, `private.path_b_person_v1`, because the record's files still read as Path B files once the person owns them), and "Download your data" listed none of its files (D-162). Migration `20261122160000_transferred_record_exports.sql`, which joins release 4 with the switch, makes it true: at once after either act, before and after the relocation worker's swap, the person can make a new export of the record and of their whole account, each with the record in it, open it and read it, and "Download your data" lists the confirmed file (`supabase/tests/transferred_record_exports.sql`); the former uploader still exports nothing of the record. That holds for a record confirmed through the e-signature request. For a record made from a reviewed permission document (`path-b-reviewed-document`), which the transfer also accepts, the person could not export it before a transfer and still cannot after one; that is drafted as a new defect, not changed here. The approved wording is unchanged.

The hand-over refused at that moment (a file still being validated, a file of an unexpected shape, the person's account gone) shows its own approved line on the card, "This cannot be done right now. Nothing was deleted. Try again later." (owner decision "A hand-over refused for now says to try later (D-158)", `20261122160000`, route response `hand-over-not-now-v1`). Every other refusal keeps "This did not work. Nothing was deleted. Please try again." as above. The line is a short status: its words "done" and "later" are now registered in `data/plain-vocabulary.json`, and `pnpm gate:readability` passes (3,552 blocks).
