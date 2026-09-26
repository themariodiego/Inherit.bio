/**
 * The EU and UK launch gate that `/legal/gdpr` states, as data (owner
 * decision, 26 September 2026). The hosted service is not offered to new
 * people in the EU/EEA or the UK until the appointments and reviews that page
 * names exist. `service-restrictions.ts` reads this to decide which countries
 * are paused, and `/legal/gdpr` renders exactly what is here, so the page and
 * the product cannot disagree.
 *
 * Every field stays null until the real appointment or sign-off exists: the
 * legal-placeholder gate refuses invented names and addresses. Opening a
 * territory is filling these in with the real details; nothing else changes.
 */

export interface GdprContact {
  /** Legal name of the person or firm. */
  name: string;
  /** Full postal address, as it should be published. */
  postalAddress: string;
  email: string;
  /** ISO date (YYYY-MM-DD) the appointment took effect. */
  appointedOn: string;
}

export interface GdprLaunchState {
  /** GDPR Article 27 representative, established in an EU member state. */
  euRepresentative: GdprContact | null;
  /** UK GDPR Article 27 representative, established in the UK. */
  ukRepresentative: GdprContact | null;
  /** GDPR Article 37 data protection officer. */
  dataProtectionOfficer: GdprContact | null;
  /** ISO date the owner, with counsel, approved `docs/gdpr/dpia.md`. */
  impactAssessmentApprovedOn: string | null;
  /** ISO date the owner, with counsel, approved `docs/gdpr/transfer-impact-assessment.md`. */
  transferReviewApprovedOn: string | null;
}

export const GDPR_LAUNCH: GdprLaunchState = {
  euRepresentative: null,
  ukRepresentative: null,
  dataProtectionOfficer: null,
  impactAssessmentApprovedOn: null,
  transferReviewApprovedOn: null,
};

/** What both territories need: the officer and both approved reviews. */
function sharedPreconditionsMet(state: GdprLaunchState): boolean {
  return state.dataProtectionOfficer !== null
    && state.impactAssessmentApprovedOn !== null
    && state.transferReviewApprovedOn !== null;
}

/** Whether new people in the EU/EEA may be accepted. */
export function euLaunchOpen(state: GdprLaunchState = GDPR_LAUNCH): boolean {
  return state.euRepresentative !== null && sharedPreconditionsMet(state);
}

/** Whether new people in the UK may be accepted. */
export function ukLaunchOpen(state: GdprLaunchState = GDPR_LAUNCH): boolean {
  return state.ukRepresentative !== null && sharedPreconditionsMet(state);
}
