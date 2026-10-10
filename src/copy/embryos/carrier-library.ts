/** Coverage-only disclosures. A reviewed library is not every possible
 * disease-causing variant, and file coverage never publishes carrier status. */
export const CARRIER_LIBRARY_HEADING = "Reviewed file positions";
export const CARRIER_LIBRARY_NOT_NEGATIVE = "This is not a negative result.";
export const CARRIER_LIBRARY_READ_FAILED = "The reviewed file checks could not be read. Try again later.";
export const CARRIER_LIBRARY_REFERENCE_LABEL = "Reference";
export const CARRIER_LIBRARY_SCOPE =
  "These are the distinct positions in the complete current reviewed reference library, not all variants that can cause this condition.";
export const CARRIER_LIBRARY_HELD =
  "Carrier status is held while its full scientific display is reviewed. These file checks do not tell you whether the embryo is a carrier.";
export const CARRIER_LIBRARY_CONFIRMATION =
  "Before anyone acts on this, it needs confirming in an accredited laboratory. Consumer files are not a clinical test.";
export const CARRIER_LIBRARY_REASONS = {
  not_covered: "Some reviewed positions were not read in this file.",
  source_call_disputed: "Some readings at reviewed positions disagree.",
  invalid_calls: "Some readings at reviewed positions could not be used.",
} as const;
export const CARRIER_LIBRARY_QUALITY = {
  embryo_call_rate: "Too few calls could be read to check this library.",
  embryo_parent_discordant: "The parent checks do not agree with this file.",
  contamination: "This file has signs of mixed DNA.",
  dropout_too_high: "Too much of this file may be missing.",
  qc_review_required: "This file needs a quality review before these checks can be shown.",
} as const;
