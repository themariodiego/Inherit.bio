/**
 * The two notices to an adult who accepted an invitation through their own
 * Inherit account (D-141; register other-adult-mitigation-state-v1 and
 * docs/retention.md adult.acceptance-hold-72h and adult.re-notice-30d; brief
 * §3, "three operable mitigations"). Both go through the terminal-notice
 * queue (template `invitation-terminal-notice`) to the person's account
 * address, read only in the mail worker's memory.
 *
 *   - `adult-acceptance-second-notice`: sent 72 hours after the acceptance,
 *     only when the account was created after the invitation was sent. Until
 *     the mail provider accepts it, nothing about the record is analysed and
 *     nothing is shared.
 *   - `adult-revocation-renotice`: sent 30 days after every acceptance through
 *     an account. Until the mail provider accepts it, the person who added the
 *     file can see nothing more.
 *
 * The notice names nobody, no file and no record: the template accepts no
 * name, address, label or link. The same words serve Path A (the person's own
 * record) and Path B (a file someone added for them), so they name only what
 * both can do today: turn off sharing in their account (Path B's choices on
 * the files page; Path A shares nothing) and ask the contact of last resort
 * to delete the record. Neither path has a one-click delete in the account
 * yet, so the re-notice does not promise one (see the release notes).
 *
 * NOT APPROVED. Neither the register nor the brief gives these words. Every
 * string here is a draft for the owner's review, listed verbatim with where
 * it appears; none changes a signed text.
 */

export const ADULT_ACCEPTANCE_SECOND_NOTICE_COPY = {
  subject: "Did you accept an invitation on Inherit?",
  heading: "Did you accept an invitation on Inherit?",
  body: "Three days ago, a new Inherit account accepted an invitation sent to this email address. If that was you, you do not need to do anything. Nothing was made from it or shared before this email. If it was not you, or you did not expect this, write to privacy@inherit.bio.",
} as const;

export const ADULT_REVOCATION_RENOTICE_COPY = {
  subject: "You can still stop this on Inherit",
  heading: "You can still stop this",
  body: "About 30 days ago, an Inherit account accepted an invitation sent to this email address. You can stop at any time, and you do not need to give a reason. Sign in to Inherit to turn off any sharing. To have the record deleted, write to privacy@inherit.bio.",
} as const;
