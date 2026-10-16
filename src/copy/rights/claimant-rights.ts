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
 *
 * The contact is the existing registered rights contact.
 */
export const CLAIMANT_DELETION_DAYS = { complete: 30, source: 7 } as const;

export const CLAIMANT_RIGHTS_COPY = {
  retention: (complete: number, source: number) =>
    `Your record stays until you ask to delete it. Once you ask, we delete it within ${complete} days, and its DNA data within ${source} days. The temporary contact address expires separately. Keep a Recovery Key so you can start a new claim later with fresh identity documents.`,
  contact: "If this page does not work, or you need help with your rights, write to privacy@inherit.bio.",
} as const;
