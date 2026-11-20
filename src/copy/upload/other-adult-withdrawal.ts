/**
 * The words of the control that withdraws an uploader's permission for
 * another adult's DNA file, on that person's card on the upload page, and of
 * the short notice the other adult is sent (owner decision of 19 November
 * 2026, "An uploader's withdrawal for another adult's file deletes it,
 * unless that adult holds the record themselves"). Path B is test mode only.
 *
 * Where the other adult has no account of their own on the record, the
 * withdrawal deletes every file the uploader added for them, confirmed or
 * not, ends the request, and sends them a short notice unless they asked not
 * to be contacted. Where they hold the record with their own account, the
 * control says it cannot run here yet: that branch waits on a decision about
 * who holds the record afterwards, and nothing is changed.
 *
 * NOT APPROVED. The decision says the wording goes to the owner first. Every
 * string here is a draft for that review, listed verbatim with where it
 * appears; none changes the signed text (content/legal/consent.upload-other-adult/v2.md).
 * "Working…" is the pending word the other controls already use.
 */

export const OTHER_ADULT_WITHDRAWAL_COPY = {
  /** The section heading inside the person's card. */
  heading: "Your permission",
  /** What withdrawing does, before any click. */
  summary: (name: string) =>
    `You can withdraw your permission for ${name}'s DNA file at any time. We then delete every file you added for them.`,
  /** The control that opens the confirmation. */
  withdrawButton: "Withdraw my permission",

  /** The confirmation step, for a person with no account of their own on the record. */
  confirmHeading: (name: string) => `Withdraw your permission for ${name}?`,
  deletes: (name: string) => [
    `Every file you added for ${name}, including any they confirmed as theirs.`,
    `Your request, and what we hold about ${name} for it.`,
  ],
  notice: (name: string) => `We will email ${name} to say this has happened, unless they asked us not to contact them.`,
  irreversible: "You cannot undo this.",
  confirmButton: "Withdraw and delete",
  cancelButton: "Keep my permission",
  working: "Working…",

  /** The receipt, once the request is accepted. */
  receiptHeading: "Your permission has ended",
  receiptBody: (name: string) => `We are deleting every file you added for ${name}. The request has ended.`,

  /** Why the control cannot run, read when the page is shown. */
  accountHeldStatus: (name: string) => `You cannot withdraw your permission for ${name} here yet. Nothing has changed.`,
  unsupportedStatus: "We cannot do this here yet. Nothing was deleted.",
  unavailableStatus: "You cannot withdraw here right now. Please try again.",

  /** The answers to a request that was sent. */
  refusedStatus: "This did not work. Nothing was deleted. Please try again.",
  uncertainStatus: "We do not know if this finished. Open this page again to see if the files were deleted.",
} as const;

/**
 * The short notice to the other adult (template `invitation-terminal-notice`,
 * kind `upload-permission-withdrawn`). It names nobody and no file: the
 * person who added the file is the one who asked them, so they know who.
 */
export const UPLOAD_PERMISSION_WITHDRAWN_NOTICE_COPY = {
  heading: "A DNA file added for you has been deleted",
  body: "The person who added your DNA file to Inherit has withdrawn their permission. We have deleted every file they added for you, and what we held about you for their request. You do not need to do anything.",
} as const;
