/**
 * The words of the control that withdraws a non-parent uploader's permission
 * for an embryo upload (owner decision of 19 November 2026, "A non-parent
 * uploader's withdrawal for an embryo upload stops analysis and deletes, as
 * they signed"). Embryo upload is test mode only. The uploader signed: "I can
 * withdraw at any time without giving a reason. Inherit then stops all
 * analysis of these embryos and deletes what it built from the files."
 * (content/legal/consent.upload-embryo/v1.md, statement 4).
 *
 * After the upload is finalised the control is on the cohort's card on
 * /embryos, and withdrawing restricts the cohort: analysis stops, the results
 * and the files are deleted, everyone's permissions end and the genetic
 * parents are told. Before that it is on /embryos/upload, and withdrawing
 * deletes the draft, what was signed for it and any file attached to it.
 * Neither gives the uploader a parent role or a say over any other embryos.
 *
 * NOT APPROVED. The decision says the wording goes to the owner first. Every
 * string here is a draft for that review, listed verbatim with where it
 * appears; none changes the signed text. "Working…" is the pending word the
 * other controls already use.
 */

export const EMBRYO_UPLOADER_WITHDRAWAL_COPY = {
  /** The section heading, in both places. */
  heading: "Your upload permission",
  /** What withdrawing does, before any click. */
  cohortSummary:
    "You added these embryo files with the genetic parents' permission. You can withdraw your permission at any time, without giving a reason.",
  draftSummary:
    "You signed permission to add these embryo files. You can withdraw it at any time, without giving a reason.",
  /** The control that opens the confirmation. */
  withdrawButton: "Withdraw my upload permission",

  /** The confirmation step, after the upload is finalised. */
  cohortConfirmHeading: "Withdraw your upload permission?",
  cohortDeletes: [
    "Inherit stops all analysis of these embryos.",
    "We delete the results and the embryo files.",
    "Every permission given for these embryos ends.",
    "We tell the genetic parents.",
  ],
  /** The confirmation step, before it. */
  draftConfirmHeading: "Withdraw your permission and delete this upload?",
  draftDeletes: [
    "We delete this draft, what was signed for it and any file attached to it.",
    "Any invitation you sent for it stops working.",
  ],
  noRole: "This does not make you a parent of these embryos, or give you a say over any others.",
  irreversible: "You cannot undo this.",
  confirmButton: "Withdraw and delete",
  cancelButton: "Keep my permission",
  working: "Working…",

  /** The receipt, once the request is accepted. */
  receiptHeading: "Your upload permission has ended",
  cohortReceiptBody:
    "Inherit has stopped all analysis of these embryos. We are deleting the results and the files, and we have told the genetic parents.",
  draftReceiptBody: "We are deleting this draft. Any invitation you sent for it no longer works.",

  /** Why the control cannot run, read when the page is shown. */
  unavailableStatus: "You cannot withdraw here right now. Please try again.",

  /** The answers to a request that was sent. */
  refusedStatus: "This did not work. Nothing was deleted. Please try again.",
  uncertainStatus: "We do not know if this finished. Open this page again to see if it was withdrawn.",
} as const;
