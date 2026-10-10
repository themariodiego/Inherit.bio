/** Pure receipt contract shared by the server response and browser assertions. */
/** `cohort-draft-created-v1`; a type alias so it satisfies the closed-shape serializer's record constraint. */
export type CohortDraftCreated = {
  cohortDraftId: string;
  state: "awaiting_uploader_artifacts";
  next: "sign_uploader_artifacts";
  requiredPrincipalSlots: string[];
  optionalAttributionSlots: string[];
  expiresAt: string;
};

export const COHORT_DRAFT_CREATED_KEYS = [
  "cohortDraftId",
  "state",
  "next",
  "requiredPrincipalSlots",
  "optionalAttributionSlots",
  "expiresAt",
] as const satisfies readonly (keyof CohortDraftCreated)[];
