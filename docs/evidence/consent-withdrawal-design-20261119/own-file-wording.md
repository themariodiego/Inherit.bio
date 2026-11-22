# Withdrawing consent to store your own DNA file: every new string, for the owner

Owner decision of 19 November 2026, "Withdrawing consent for a person's own DNA file deletes the files and all made from them": "The wording of the control, the confirmation, the receipt and the email is shown to the owner before it ships." **Approved on 22 November 2026** ("The wording of the own-file consent withdrawal is approved", `docs/protocol/decisions.md`), with two lines added to the confirmation's list of what is deleted, `deletes[4]` and `deletes[5]` below, under the next entry, "The own-file withdrawal's optional changes are left to engineering". This file lists what ships. Nothing here changes the consent text (`content/legal/consent.upload-self/v1.md`, which already says "You can withdraw this permission and ask to delete your file.") or any other legal artifact.

All strings live in one copy module, `src/copy/upload/withdrawal.ts` (`OWN_UPLOAD_WITHDRAWAL_COPY` for the screens, `OWN_UPLOAD_WITHDRAWAL_EMAIL_COPY` for the email). The control is one component, `src/components/uploads/own-upload-withdrawal.tsx`, rendered in the same form on **Settings → Consents** (`/settings/consents`, below the "Turn off every permission…" control) and on **My files** (`/files`, below the file list). It appears only while the account holds a live upload consent on its own record.

Reading level: `pnpm gate:readability` passes with every string below (3,465 blocks; 3,527 on 22 November with the two added lines). The gate grades strings of 15 words or more (Flesch–Kincaid, limit 9), checks every heading, button and status line of fewer words against the plain vocabulary (`data/plain-vocabulary.json`, unchanged), and caps every sentence under `src/copy/upload/` at 25 words. Grade is shown for every string; for short ones it is for information only.

## On the page, before any click

| Key | Where it appears | Role | Words | Grade | Text |
|---|---|---|---|---|---|
| `heading` | Section heading (h2), both pages; stays above the receipt | heading | 5 | 2.9 | Permission for your own DNA |
| `signedOn(date)` | Under the heading; date as "2 November 2026" (UTC) | body | 6 | 2.5 | You gave this permission on {date}. |
| `summary` | Under that line | body | 27 | 4.5 | It lets Inherit store and prepare your DNA files. You can withdraw it at any time. Withdrawing it deletes your DNA files and everything made from them. |
| `withdrawButton` | The trigger (outline button); opens the confirmation, sends nothing | button | 7 | 5.7 | Withdraw permission and delete my DNA files |

## Why it cannot run yet (shown instead of the trigger; read from the database when the page renders)

| Key | When | Role | Words | Grade | Text |
|---|---|---|---|---|---|
| `processingStatus` | A file is still uploading or being processed, or a purge is still working on one (`subject_delete_processing`, `file_delete_processing`) | status | 15 | 1.5 | One of your files is not ready yet. You can withdraw when it is ready. |
| `unsupportedStatus` | The emptying would refuse with `subject_delete_unsupported_graph` (a file another account holds on it, or a file tied to embryo records; since D-144 a saved export of the record no longer refuses it, the withdrawal ends the export) | status | 16 | 5.2 | We cannot do this here yet, because of other data on your record. Nothing was deleted. |
| `unavailableStatus` | The database could not answer (for example before the migration is hosted) | status | 9 | 1.9 | You cannot withdraw here right now. Please try again. |

## The confirmation step (an inline alert dialog, the pattern of family "Stop sharing")

| Key | Where | Role | Words | Grade | Text |
|---|---|---|---|---|---|
| `confirmHeading` | Dialog heading (h3) | heading | 8 | 5.2 | Withdraw your permission and delete your DNA files? |
| `deletesHeading` | List heading (h4) | heading | 3 | 1.3 | What we delete |
| `deletes[0]` | List item | body | 9 | 3.7 | Every DNA file you added to your own record. |
| `deletes[1]` | List item | body | 13 | 6.7 | Every result and report made from them, and your Copilot chats about them. |
| `deletes[2]` | List item | body | 13 | 4.9 | What you share with family, and the family links built on your files. |
| `deletes[3]` | List item | body | 9 | 2.3 | The copies that people you shared with can see. |
| `deletes[4]` | List item (added 22 November) | body | 8 | 3.8 | Every permission you gave for your DNA ends. |
| `deletes[5]` | List item (added 22 November) | body | 16 | 4.5 | Any copy of your record we prepared for you to download. Its download link stops working. |
| `keepsHeading` | List heading (h4) | heading | 3 | -2.6 | What we keep |
| `keeps[0]` | List item | body | 7 | -0.7 | Your account. You can still sign in. |
| `keeps[1]` | List item | body | 10 | 4.8 | A record that you gave this permission and withdrew it. |
| `afterwards` | Under the lists | body | 13 | 4.0 | If you add a file again, we will ask for your permission first. |
| `irreversible` | Last line, the dialog's description | body | 4 | 3.7 | You cannot undo this. |
| `confirmButton` | The only destructive button; sends the request | button | 3 | 5.2 | Withdraw and delete |
| `cancelButton` | Closes the dialog, sends nothing | button | 3 | -2.6 | Keep my files |
| `working` | The confirm button's label while the request is in flight (**existing** product word, the other settings controls' "Working…"; not new) | button | 1 | — | Working… |

## The receipt (after a 202 answer; stays in place when the page renders again)

| Key | Where | Role | Words | Grade | Text |
|---|---|---|---|---|---|
| `receiptHeading` | Receipt heading (h3), `role="status"` | heading | 4 | 6.6 | Your permission has ended |
| `receiptBody` | Under it | body | 39 | 4.6 | We are deleting your DNA files and everything made from them now. Anything left is deleted within 7 days. We will email you to confirm this. If you add a file again, we will ask for your permission first. |

## When a request does not succeed (`role="alert"`, above the trigger)

| Key | When | Role | Words | Grade | Text |
|---|---|---|---|---|---|
| `refusedStatus` | Any 4xx answer: the route's opaque 404 (every database refusal, a spent or expired code, no confirmed address), the session token's 403, 401. Each committed nothing. | status | 10 | 2.2 | This did not work. Nothing was deleted. Please try again. |
| `uncertainStatus` | A 5xx answer, another status, or no answer: the page cannot say whether the withdrawal committed | status | 18 | 3.0 | We do not know if this finished. Open this page again to see if your files were deleted. |

## The confirmation email (template `upload-consent-withdrawn`, `src/emails/upload-consent-withdrawn.tsx`)

Sent to the account's own confirmed address; queued in the same transaction as the deletion. No link, no file name, no genetic value. The standard footer of every Inherit email (attribution and "Informational, not medical advice.") is unchanged.

| Key | Where | Words | Grade | Text |
|---|---|---|---|---|
| `emailSubject` | Subject line (`src/lib/email.ts` reads it from the copy module) | 8 | 3.8 | You withdrew your permission to store your DNA |
| `heading` | Email heading | 4 | 6.6 | Your permission has ended |
| `withdrawnOn(date)` | Paragraph 1; date as "19 November 2026" (UTC) | 12 | 5.8 | On {date}, you withdrew your permission for Inherit to store your DNA. |
| `deleting` | Paragraph 2 | 23 | 6.3 | We are deleting your DNA files and everything made from them. That includes your results, your reports and your Copilot chats about them. |
| `sharing` | Paragraph 3 | 27 | 5.0 | What you shared with family has ended, and the family links built on your files are gone. People you shared with no longer see any of it. |
| `afterwards` | Paragraph 4 | 24 | 4.2 | Anything left is deleted within 7 days. Your account stays open. If you add a file again, we will ask for your permission first. |
| `security` | Paragraph 5 (kept; see question 4) | 10 | 1.3 | If you did not do this, change your password now. |

## Questions for the owner that the wording raises

Answered on 22 November 2026 ("The own-file withdrawal's optional changes are left to engineering"): question 1, no typed confirmation; question 3, the line is added as `deletes[4]`, with `deletes[5]` for the exports the withdrawal ends since D-144; question 4, the email keeps its last line. Question 5's premise changed with D-144 (20 November): a saved export no longer blocks the withdrawal. The questions are kept below as they were asked.

1. **Typed confirmation.** The brief makes deleting everything (T8) need a typed confirmation and calls "a three-click path to irreversible destruction … itself a defect". This withdrawal is irreversible but keeps the account, and the decision names no typed step, so the confirmation is two clicks (trigger, then "Withdraw and delete"), like family "Stop sharing". Should it ask the person to type something?
2. **Brief §2.7's frozen-dispute sentence** ("Delete my data removes everything … unless someone has told us this file is theirs …") is said to appear "on the delete page before the click". It is not used here: no freeze exists for a person's own file, so the sentence would promise something the product does not do.
3. **What else ends.** The emptying also ends every other permission on the record (report choices, the Copilot permission, sharing). The confirmation names the results, chats and sharing that go, not the permissions themselves. Add a line such as "Every permission you gave for your DNA ends."?
4. **The email's last line** ("If you did not do this, change your password now.") is a security notice the decision did not ask for. Keep or drop?
5. **"We cannot do this here yet…"** is deliberately general. Its usual cause is a saved export of the record (see the report: an expired export blocks the withdrawal for good today). Once that is fixed or decided, this line should say what the person can do.
6. **Receipt "now … within 7 days".** True of the code: every file is made unreadable in the same transaction, the request then finishes up to 16 files within 40 seconds before answering, and a seven-day backstop finishes anything left (`source.revocation-7d`).
