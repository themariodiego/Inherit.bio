/**
 * The exact words the claimed-record browser journey
 * (`e2e/future-person-claimed-record-journey.spec.ts`) asserts, kept free of
 * imports so the component test can hold the rendered page to the same text.
 *
 * They are written out here, not imported from `src/copy`, so a change to the
 * page's copy fails the browser journey and the component test until the
 * decision behind the words changes too:
 *
 *   - "Claimant retention stated in days (G5.4)", 2026-10-16: the claimant's
 *     temporary contact is kept for exactly 730 days, and the page says so; a
 *     claimed record stays until the claimant asks, then goes within 30 days
 *     and its DNA data within 7 days (the Charter's Right 3).
 *   - "G5.4 is judged on the brief's minimum under TEST-LOCAL", 2026-10-16:
 *     a contact of last resort, privacy@inherit.bio.
 *   - "How G5.4's claimant delete is proven", 2026-10-22: on the standard app
 *     the delete control is closed, so its words must not render there.
 */
export const CLAIMANT_PAGE = Object.freeze({
  heading: "Your claimed record",
  intro: "You control this record. Its genetic information is not shown on this page. You do not need an account.",
  retention: "Your record stays until you ask to delete it. Once you ask, we delete it within 30 days, and its DNA data "
    + "within 7 days. We keep the contact address you gave us for at most 730 days after your claim was approved. "
    + "Deleting it does not delete your record. Keep a Recovery Key so you can start a new claim later with fresh "
    + "identity documents.",
  contact: "If this page does not work, or you need help with your rights, write to privacy@inherit.bio.",
  recoveryLegend: "Keep access without an account",
  recoveryAcknowledgement: "I will save my Recovery Key before I close this page.",
  recoveryButton: "Show my Recovery Key",
  recoveryShown: "Your Recovery Key is shown once. Save it on paper or print this page before leaving.",
});

/** The delete control's words. None of them may render where the TEST deletion
 * executor is not configured, which is every standard CI app. */
export const CLAIMANT_DELETE_CONTROL = Object.freeze({
  legend: "Delete this claimed record",
  warning: "This removes only your claimed record. It does not delete parental or sibling records. This cannot be undone.",
  acknowledgement: "I want to delete this claimed record.",
  button: "Delete my claimed record",
});

/** The release mail (`src/emails/future-person-release.tsx`). */
export const RELEASE_MAIL = Object.freeze({
  subject: "Your Inherit request is ready",
  approved: "Your claim has been approved. Open your private link to view your record and use your rights. "
    + "You do not need an account.",
  once: "This link expires in seven days and works once. If it expires, start a new claim with your Recovery Key, "
    + "or with fresh identity documents if you do not have a key.",
});

/** The one-use link's second opening, on the generic interstitial. */
export const RELEASE_LINK_SPENT = "This link is unavailable. It may have expired or already been used.";
