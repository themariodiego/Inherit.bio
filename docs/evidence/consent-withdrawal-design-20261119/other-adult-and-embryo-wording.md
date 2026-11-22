# Two consent withdrawals (19 November 2026): every new string, for the owner

**APPROVED by the owner on 22 November 2026** (`docs/protocol/decisions.md`, "The wording of the two test-mode withdrawals is approved"). The strings below are the approved text; the notes about it are kept as they were written.

Owner decisions of 19 November 2026, "An uploader's withdrawal for another adult's file deletes it, unless that adult holds the record themselves" and "A non-parent uploader's withdrawal for an embryo upload stops analysis and deletes, as they signed": "Wording goes to the owner first." **None of this wording is approved.** Nothing here changes a legal artifact (`content/legal/consent.upload-other-adult/v2.md`, `content/legal/consent.upload-embryo/v1.md` are untouched). Both features exist only in test mode.

All strings live in two copy modules: `src/copy/upload/other-adult-withdrawal.ts` (`OTHER_ADULT_WITHDRAWAL_COPY` for the card, `UPLOAD_PERMISSION_WITHDRAWN_NOTICE_COPY` for the email) and `src/copy/embryos/uploader-withdrawal.ts` (`EMBRYO_UPLOADER_WITHDRAWAL_COPY`). `pnpm gate:readability` passes with every string (3,506 blocks): strings of 15 words or more are graded (Flesch–Kincaid, limit 9), shorter headings, buttons and status lines are checked against `data/plain-vocabulary.json` (unchanged), and every sentence under `src/copy/upload/` is capped at 25 words. The grade below is computed with "{name}" read as "Sam Lee"; for short strings it is for information only. "{name}" is the name the uploader typed for the person (the card already shows it in its heading).

## A. The uploader's permission for another adult's file

Control: `src/components/uploads/other-adult-withdrawal.tsx`, the last part of the uploader's card for that person on **/files/upload** (the "Upload with their written permission" section), on a confirmed person's card only (while a file waits for them, or once they have confirmed and the uploader may add a file), and only while the uploader's own permission is live. The request is api.subject-delete for that person's record.

### Before any click

| Key | Where | Role | Words | Grade | Text |
|---|---|---|---|---|---|
| `heading` | Section heading inside the card (h4) | heading | 2 | 8.8 | Your permission |
| `summary(name)` | Under it, when the withdrawal can run (no account of the person's own on the record) | body | 22 | 4.3 | You can withdraw your permission for {name}'s DNA file at any time. We then delete every file you added for them. |
| `withdrawButton` | The trigger (outline button); opens the confirmation, sends nothing | button | 3 | 9.2 | Withdraw my permission |

### Why it cannot run (instead of the trigger; read from the database when the page renders)

| Key | When | Role | Words | Grade | Text |
|---|---|---|---|---|---|
| `accountHeldStatus(name)` | The person holds the record with their own account (`account-held`): the branch that waits on the owner's decision about who holds the record afterwards | status | 13 | 3.3 | You cannot withdraw your permission for {name} here yet. Nothing has changed. |
| `unsupportedStatus` | The person's contact or the request they accepted cannot be found, so the notice could not be addressed (`unsupported`; not expected to occur) | status | 9 | 3.2 | We cannot do this here yet. Nothing was deleted. |
| `unavailableStatus` | The database could not answer (for example before the migration is hosted) | status | 9 | 1.9 | You cannot withdraw here right now. Please try again. |

### The confirmation (an inline alert dialog; only its destructive button sends)

| Key | Where | Role | Words | Grade | Text |
|---|---|---|---|---|---|
| `confirmHeading(name)` | Dialog heading (h5) | heading | 6 | 4.5 | Withdraw your permission for {name}? |
| `deletes(name)[0]` | List item | body | 13 | — (under 15 words; not graded) | Every file you added for {name}, including any they confirmed as theirs. |
| `deletes(name)[1]` | List item | body | 11 | 2.6 | Your request, and what we hold about {name} for it. |
| `notice(name)` | Under the list | body | 18 | 5.9 | We will email {name} to say this has happened, unless they asked us not to contact them. |
| `irreversible` | Last line; the dialog's description | body | 4 | 3.7 | You cannot undo this. |
| `confirmButton` | Destructive button; sends the request | button | 3 | 5.2 | Withdraw and delete |
| `cancelButton` | Closes the dialog, sends nothing | button | 3 | 5.2 | Keep my permission |
| `working` | The confirm button while the request is in flight (**existing** product word, not new) | button | 1 | — | Working… |

### The receipt (after a 202 answer; the card then shows only this)

| Key | Where | Role | Words | Grade | Text |
|---|---|---|---|---|---|
| `receiptHeading` | First line, `role="status"` | heading | 4 | 6.6 | Your permission has ended |
| `receiptBody(name)` | Under it | body | 14 | 4.0 | We are deleting every file you added for {name}. The request has ended. |

### When a request does not succeed (`role="alert"`)

| Key | When | Role | Words | Grade | Text |
|---|---|---|---|---|---|
| `refusedStatus` | Any 4xx answer (the route's opaque 404 for every database refusal, the session token's 403, 401); each committed nothing | status | 10 | 2.2 | This did not work. Nothing was deleted. Please try again. |
| `uncertainStatus` | A 5xx answer, another status, or no answer | status | 18 | 3.0 | We do not know if this finished. Open this page again to see if the files were deleted. |

### The notice to the other adult (email template `invitation-terminal-notice`, kind `upload-permission-withdrawn`; `src/emails/invitation-terminal-notice.tsx`)

Sent to the person's own contact (sealed; opened only by the mail worker), unless that contact is under the global refusal bar. No name, file, link or address. The standard footer is unchanged.

| Key | Where | Words | Grade | Text |
|---|---|---|---|---|
| (existing) | Subject line: fixed per template in `src/lib/email.ts`, **not new** | 7 | — | An invitation on Inherit has ended |
| `heading` | Email heading | 9 | 3.7 | A DNA file added for you has been deleted |
| `body` | The one paragraph | 38 | 5.8 | The person who added your DNA file to Inherit has withdrawn their permission. We have deleted every file they added for you, and what we held about you for their request. You do not need to do anything. |

## B. A non-parent uploader's permission for an embryo upload

Control: `src/components/embryo/uploader-withdrawal.tsx`. After finalisation it is the last part of that cohort's card on **/embryos** (only for the account that uploaded it as its non-parent uploader; never for a genetic parent). Before finalisation it is on **/embryos/upload**, below the upload steps, once the uploader has signed. The request is api.consent-revoke for the uploader's own signature.

### Before any click

| Key | Where | Role | Words | Grade | Text |
|---|---|---|---|---|---|
| `heading` | Section heading (h3), both places | heading | 3 | 9.2 | Your upload permission |
| `cohortSummary` | Under it, on a cohort's card | body | 22 | 8.0 | You added these embryo files with the genetic parents' permission. You can withdraw your permission at any time, without giving a reason. |
| `draftSummary` | Under it, on the upload page | body | 19 | 4.9 | You signed permission to add these embryo files. You can withdraw it at any time, without giving a reason. |
| `withdrawButton` | The trigger | button | 4 | 9.6 | Withdraw my upload permission |
| `unavailableStatus` | Instead of the trigger when the database could not answer | status | 9 | 1.9 | You cannot withdraw here right now. Please try again. |

### The confirmation

| Key | Where | Role | Words | Grade | Text |
|---|---|---|---|---|---|
| `cohortConfirmHeading` | Dialog heading (h4), after finalisation | heading | 4 | 9.6 | Withdraw your upload permission? |
| `cohortDeletes[0]` | List item | body | 7 | 9.1 | Inherit stops all analysis of these embryos. |
| `cohortDeletes[1]` | List item | body | 8 | 3.8 | We delete the results and the embryo files. |
| `cohortDeletes[2]` | List item | body | 7 | 7.4 | Every permission given for these embryos ends. |
| `cohortDeletes[3]` | List item | body | 5 | 5.2 | We tell the genetic parents. |
| `draftConfirmHeading` | Dialog heading, before finalisation ("draft" is not in the plain vocabulary for a heading, so "upload") | heading | 7 | 7.4 | Withdraw your permission and delete this upload? |
| `draftDeletes[0]` | List item | body | 15 | 4.4 | We delete this draft, what was signed for it and any file attached to it. |
| `draftDeletes[1]` | List item | body | 8 | 6.7 | Any invitation you sent for it stops working. |
| `noRole` | Under the list, both phases | body | 18 | 6.5 | This does not make you a parent of these embryos, or give you a say over any others. |
| `irreversible` | Last line | body | 4 | 3.7 | You cannot undo this. |
| `confirmButton` | Destructive button | button | 3 | 5.2 | Withdraw and delete |
| `cancelButton` | Closes the dialog | button | 3 | 5.2 | Keep my permission |
| `working` | Pending label (**existing** word) | button | 1 | — | Working… |

### The receipt

| Key | Where | Role | Words | Grade | Text |
|---|---|---|---|---|---|
| `receiptHeading` | First line, `role="status"` | heading | 5 | 7.6 | Your upload permission has ended |
| `cohortReceiptBody` | After a cohort's withdrawal | body | 23 | 6.9 | Inherit has stopped all analysis of these embryos. We are deleting the results and the files, and we have told the genetic parents. |
| `draftReceiptBody` | After a draft's withdrawal | body | 14 | 4.8 | We are deleting this draft. Any invitation you sent for it no longer works. |

### When a request does not succeed

| Key | When | Role | Words | Grade | Text |
|---|---|---|---|---|---|
| `refusedStatus` | Any 4xx answer | status | 10 | 2.2 | This did not work. Nothing was deleted. Please try again. |
| `uncertainStatus` | A 5xx answer, another status, or no answer | status | 17 | 2.3 | We do not know if this finished. Open this page again to see if it was withdrawn. |

No email is sent to the non-parent uploader. The genetic parents receive the existing `cohort-restriction-notice` (unchanged wording) after a cohort's withdrawal; before finalisation nobody is emailed.

## Questions for the owner that the wording raises

1. **Saying which outcome applies discloses whether the person has an Inherit account.** The decision makes the outcome depend on whether the other adult holds the record with their own account, and asks the page to say which applies. Today the uploader's card does not reveal that. With the own-account branch not built, the card says only "You cannot withdraw your permission for {name} here yet. Nothing has changed." on such a record, which still differs from the other records' card. Accept that the uploader learns this, or word both cases alike?
2. **The notice's subject line** is the terminal-notice template's fixed "An invitation on Inherit has ended". The person accepted a request, so it is true, but a subject of its own ("A DNA file added for you has been deleted") would need the template's subject to vary by kind. Keep, or change?
3. **The notice names nobody.** The person knows who asked them; naming the uploader would put a name in an email the uploader did not write. Keep anonymous?
4. **"unless they asked us not to contact them"** tells the uploader that a refusal bar may exist, without saying whether it does. Keep, or drop the clause and say only "We will email {name}"?
5. **No confirmation email to the uploader** in either kind (the own-file withdrawal sends one, because the brief says so for that case). Add one?
6. **Embryo, before finalisation, the invited genetic parents are not told**; their invitation links simply stop working. Tell them?
7. **Embryo, "We delete the results and the embryo files."** after finalisation is said even when no file was uploaded yet (a cohort waiting for its file is restricted the same way). Say it differently in that state?
8. **Typed confirmation.** As for the own-file withdrawal, the confirmation is two clicks (trigger, then "Withdraw and delete").
