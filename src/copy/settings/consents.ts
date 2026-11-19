/**
 * The words of the one control on Settings → Consents that turns every
 * permission off at once (api.consents-revoke-all).
 *
 * The control's text is the owner's, exactly (decision 2026-10-22, "Revoke-all
 * control", docs/protocol/decisions.md). It is the button's own label, so no
 * other wording is introduced. The pending and failure lines reuse wording the
 * product already shows: "Working…" from the other settings controls, and the
 * deletion control's expired-confirmation line. After a failure the page is
 * rendered again, which brings a fresh one-time nonce.
 */

export const REVOKE_ALL_CONTROL =
  "Turn off every permission you have given. Results made under them are deleted. Your files stay.";

export const REVOKE_ALL_WORKING = "Working…";

export const REVOKE_ALL_FAILED = "This confirmation expired. Please try again.";

/** The resolved copy id the route's closed body requires. Not shown. */
export const REVOKE_ALL_CONFIRMATION = "consents.revoke-all.confirmation";
