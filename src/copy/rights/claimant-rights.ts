/**
 * The claimed record's rights page on `/withdraw/session`
 * (`src/components/future-person/claimant-rights.tsx`): its retention line
 * and its contact of last resort.
 *
 * Each number is one the code enforces, and none says more than the Future
 * Person Charter (content/legal/charter.future-person/v1.md, Right 3: deleted
 * completely within 30 days of asking):
 *
 *   - The claimed record's class is `future-person.claimant-reverification-
 *     until-request`: it is kept until the claimant asks to delete it, with no
 *     maximum before then (`future_person_rights_view_v1` answers
 *     `retentionMaximumDays: null`).
 *   - The delete request writes that class's retention row with a fixed
 *     deadline 7 days after the request for the DNA source
 *     (`source.revocation-7d`), and a deletion plan whose completion deadline
 *     is 30 days after it (`prepare_future_person_deletion_v1`,
 *     20260930245000_future_person_claimant_erasure.sql).
 *   - The temporary contact address is a separate class,
 *     `future-person.claimed-unbound-24mo`, defined as exactly 730 days from
 *     the approval that queued the release (owner decision 2026-10-16,
 *     "Claimant retention stated in days (G5.4)";
 *     20261016175000_future_person_claimant_contact_730_days.sql). Account
 *     binding or the record's deletion removes it sooner, hence "at most",
 *     and its expiry never deletes the record.
 *
 * The contact is the existing registered rights contact.
 */
export const CLAIMANT_DELETION_DAYS = { complete: 30, source: 7 } as const;
export const CLAIMANT_CONTACT_KEEP_DAYS = 730;

export const CLAIMANT_RIGHTS_COPY = {
  retention: (complete: number, source: number, contact: number) =>
    `Your record stays until you ask to delete it. Once you ask, we delete it within ${complete} days, and its DNA data within ${source} days. We keep the contact address you gave us for at most ${contact} days after your claim was approved. Deleting it does not delete your record. Keep a Recovery Key so you can start a new claim later with fresh identity documents.`,
  contact: "If this page does not work, or you need help with your rights, write to privacy@inherit.bio.",
  /** The export button (register api.future-person-export), TEST-LOCAL only.
   * A plain label: no notice text goes with it (owner decision 2026-10-22). */
  exportLabel: "Export my claimed record",
} as const;
