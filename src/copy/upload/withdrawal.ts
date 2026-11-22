/**
 * The words of the control that withdraws a person's consent to store their
 * own DNA file, on Settings → Consents and on the Files page, and of its
 * confirmation email (owner decision of 19 November 2026, "Withdrawing
 * consent for a person's own DNA file deletes the files and all made from
 * them"; brief §2.7). The withdrawal deletes every DNA file on the person's
 * own record and everything made from them, ends what they share and the
 * family links built on them, keeps a record of the consent marked withdrawn,
 * and keeps the account.
 *
 * APPROVED on 22 November 2026 (docs/protocol/decisions.md, "The wording of
 * the own-file consent withdrawal is approved"), with the last two lines of
 * `deletes` added under "The own-file withdrawal's optional changes are left
 * to engineering". Every string is listed verbatim with where it appears in
 * docs/evidence/consent-withdrawal-design-20261119/own-file-wording.md; none
 * changes the consent text itself (content/legal/consent.upload-self/v1.md),
 * which already says "You can withdraw this permission and ask to delete your
 * file."
 *
 * "Working…" is the pending word the other settings controls already use.
 */

export const OWN_UPLOAD_WITHDRAWAL_COPY = {
  /** The section heading, in both places. */
  heading: "Permission for your own DNA",
  /** Under the heading: when the live consent was signed. */
  signedOn: (date: string) => `You gave this permission on ${date}.`,
  /** What the permission does and what withdrawing it does, before any click. */
  summary:
    "It lets Inherit store and prepare your DNA files. You can withdraw it at any time. Withdrawing it deletes your DNA files and everything made from them.",
  /** The control that opens the confirmation. */
  withdrawButton: "Withdraw permission and delete my DNA files",

  /** The confirmation step. */
  confirmHeading: "Withdraw your permission and delete your DNA files?",
  deletesHeading: "What we delete",
  deletes: [
    "Every DNA file you added to your own record.",
    "Every result and report made from them, and your Copilot chats about them.",
    "What you share with family, and the family links built on your files.",
    "The copies that people you shared with can see.",
    "Every permission you gave for your DNA ends.",
    "Any copy of your record we prepared for you to download. Its download link stops working.",
  ],
  keepsHeading: "What we keep",
  keeps: [
    "Your account. You can still sign in.",
    "A record that you gave this permission and withdrew it.",
  ],
  afterwards: "If you add a file again, we will ask for your permission first.",
  irreversible: "You cannot undo this.",
  confirmButton: "Withdraw and delete",
  cancelButton: "Keep my files",
  working: "Working…",

  /** The receipt, once the request is accepted. */
  receiptHeading: "Your permission has ended",
  receiptBody:
    "We are deleting your DNA files and everything made from them now. Anything left is deleted within 7 days. We will email you to confirm this. If you add a file again, we will ask for your permission first.",

  /** Why the control cannot run yet, read when the page is shown. */
  processingStatus: "One of your files is not ready yet. You can withdraw when it is ready.",
  unsupportedStatus: "We cannot do this here yet, because of other data on your record. Nothing was deleted.",
  unavailableStatus: "You cannot withdraw here right now. Please try again.",

  /** The answers to a request that was sent. */
  refusedStatus: "This did not work. Nothing was deleted. Please try again.",
  uncertainStatus: "We do not know if this finished. Open this page again to see if your files were deleted.",
} as const;

/** The confirmation email (template `upload-consent-withdrawn`). */
export const OWN_UPLOAD_WITHDRAWAL_EMAIL_COPY = {
  emailSubject: "You withdrew your permission to store your DNA",
  heading: "Your permission has ended",
  withdrawnOn: (date: string) => `On ${date}, you withdrew your permission for Inherit to store your DNA.`,
  deleting:
    "We are deleting your DNA files and everything made from them. That includes your results, your reports and your Copilot chats about them.",
  sharing:
    "What you shared with family has ended, and the family links built on your files are gone. People you shared with no longer see any of it.",
  afterwards:
    "Anything left is deleted within 7 days. Your account stays open. If you add a file again, we will ask for your permission first.",
  security: "If you did not do this, change your password now.",
} as const;
