/**
 * The vocabulary of an embryo cohort draft (E0 contract §1-§2): what a
 * request calls a situation or a basis, what the schema stores for it, and
 * what each basis means for who must be reached and who decides. This is
 * the TypeScript home of those tables; the migration repeats the schema
 * values and the statement-key arrays, and the legal drift test asserts the
 * two agree. Nothing here reads the network, a cookie or the environment.
 */

export const UPLOAD_SITUATIONS = ["own-embryos", "with-genetic-parents-permission"] as const;
export type UploadSituation = (typeof UPLOAD_SITUATIONS)[number];

export const BASES = [
  "two-evidenced-parents",
  "donor-gamete-anonymous",
  "parent-deceased",
  "sole-legal-disposition-authority",
] as const;
export type Basis = (typeof BASES)[number];

export const BASIS_CASES = ["true_two_parent", "anonymous_donor", "parent_deceased", "sole_legal_authority"] as const;
export type BasisCase = (typeof BASIS_CASES)[number];

export type UploadClass = "embryo_own" | "embryo_third_party";

/**
 * How a disposition is recorded: two evidenced parents propose and confirm
 * in turn; every single-authority basis records it in one step.
 */
export type DispositionMode = "two-parent-propose-confirm" | "single-authority-direct";

const BASIS_CASE_BY_BASIS: Readonly<Record<Basis, BasisCase>> = {
  "two-evidenced-parents": "true_two_parent",
  "donor-gamete-anonymous": "anonymous_donor",
  "parent-deceased": "parent_deceased",
  "sole-legal-disposition-authority": "sole_legal_authority",
};

/** The schema's `basis_case` for a request basis. */
export function basisCaseFor(basis: Basis): BasisCase {
  return BASIS_CASE_BY_BASIS[basis];
}

/** The draft's `upload_situation` column value. */
export function uploadSituationValue(situation: UploadSituation): "own_embryos" | "with_genetic_parents_permission" {
  return situation === "own-embryos" ? "own_embryos" : "with_genetic_parents_permission";
}

/** The cohort's `upload_class` for a situation. */
export function uploadClassFor(situation: UploadSituation): UploadClass {
  return situation === "own-embryos" ? "embryo_own" : "embryo_third_party";
}

export function dispositionModeFor(basisCase: BasisCase): DispositionMode {
  return basisCase === "true_two_parent" ? "two-parent-propose-confirm" : "single-authority-direct";
}

/**
 * Whether the basis names two genetic parents who each sign, or one
 * authority. The uploader of their own embryos is one of the two parents;
 * a third-party uploader is never a parent, so both parents must be
 * reached.
 */
function isTwoParent(basis: Basis): boolean {
  return basisCaseFor(basis) === "true_two_parent";
}

/**
 * How many contact addresses the draft request must carry, exactly: the
 * parents who are not the uploader. The route refuses any other count.
 */
export function requiredContactCount(situation: UploadSituation, basis: Basis): 0 | 1 | 2 {
  const parents = isTwoParent(basis) ? 2 : 1;
  return situation === "own-embryos" ? ((parents - 1) as 0 | 1) : (parents as 1 | 2);
}

/**
 * The slot labels the 201 body lists, one per required contact, in the
 * order the contacts were given. A fresh array on every call.
 */
export function requiredPrincipalSlotLabels(situation: UploadSituation, basis: Basis): string[] {
  const label = situation === "own-embryos" ? "other-genetic-parent" : "genetic-parent";
  return Array.from({ length: requiredContactCount(situation, basis) }, () => label);
}

export const EMBRYO_ARTIFACT_KEYS = [
  "consent.upload-embryo",
  "attestation.embryo-parentage",
  "attestation.embryo-disposition-rights",
  "attestation.embryo-single-parent-basis",
  "charter.future-person",
  "disclosure.insurance-and-discrimination",
] as const;
export type EmbryoArtifactKey = (typeof EMBRYO_ARTIFACT_KEYS)[number];

/**
 * The statement keys each artifact publishes, in the order the signing RPC
 * records them (contract §2). `consent.upload-embryo` here is the form a
 * genetic parent signs; the non-parent uploader's form is separate below.
 */
export const EMBRYO_ARTIFACT_STATEMENT_KEYS: Record<EmbryoArtifactKey, readonly string[]> = {
  "consent.upload-embryo": [
    "genetic-parent-or-authority",
    "no-outcome-data",
    "future-person-charter",
    "withdraw-any-time",
  ],
  "attestation.embryo-parentage": [
    "genetic-parent-of-these-embryos",
    "other-parent-named-truthfully",
    "false-statement-warning-read",
  ],
  "attestation.embryo-disposition-rights": [
    "right-to-decide-disposition",
    "no-dispute-or-proceeding",
    "objection-stops-and-deletes",
  ],
  "attestation.embryo-single-parent-basis": ["basis-is-true", "evidence-is-genuine", "objection-stops-analysis"],
  "charter.future-person": ["read-in-full", "rights-are-enforceable"],
  "disclosure.insurance-and-discrimination": ["understood"],
};

/** `consent.upload-embryo` as signed by someone who is not a genetic parent. */
export const EMBRYO_UPLOAD_UPLOADER_STATEMENT_KEYS: readonly string[] = [
  "uploader-right-to-files",
  "not-a-genetic-parent",
  "parents-permission-held",
  "withdraw-any-time",
];

/** The `embryo.analysis` grant, signed against `consent.upload-embryo`. */
export const EMBRYO_ANALYSIS_GRANT_STATEMENT_KEYS: readonly string[] = [
  "one-purpose",
  "every-parent-must-agree",
  "pause-or-stop-any-time",
];

export const EMBRYO_COUNT_MAXIMUM = 64;

/**
 * A Tier-2 typed name: at least two whitespace-separated tokens of at least
 * two characters each, so a single word or a pair of initials is refused.
 * A shorter token in between (a middle initial) does not count against it.
 */
export function typedNameIsValid(name: string): boolean {
  const tokens = name.trim().split(/\s+/).filter((token) => Array.from(token).length >= 2);
  return tokens.length >= 2;
}
