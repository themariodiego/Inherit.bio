/**
 * What a reviewed carrier finding says about its own evidence (brief §4,
 * lines 1329-1335; docs/carrier-importer-design.md), shared by the Family
 * health picture and Portrait. The two strings the brief quotes ship
 * character-for-character.
 */

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September",
  "October", "November", "December"];

/** An ISO date as "3 March 2004", the same in every time zone and locale. */
export function writtenDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return `${day} ${MONTH_NAMES[month - 1]} ${year}`;
}

/**
 * One line per person for a reviewed assertion (brief lines 346 and 1335):
 * the variant by its ClinVar name, the classification, and ClinVar's review
 * status and last-evaluated date as text, next to the finding.
 */
export function reviewedVariantLine(
  name: string,
  evidence: { variantName: string; reviewStatus: string; lastEvaluated: string | null },
  gene: string,
  classification: string,
): string {
  const evaluated = evidence.lastEvaluated ? `last evaluated ${writtenDate(evidence.lastEvaluated)}` : "no date recorded";
  return `${name}: ${evidence.variantName} in ${gene}. ClinVar classifies it as ${classification.toLowerCase()} `
    + `(review status: ${evidence.reviewStatus}; ${evaluated}).`;
}

/** Character-for-character (brief line 1334): on every pathogenic or likely pathogenic finding. */
export const LAB_CONFIRMATION_LINE =
  "Before anyone acts on this, it needs confirming in an accredited laboratory. Consumer files are not a clinical test.";

/** Character-for-character (brief line 1332): no penetrance range has been cited for these conditions. */
export const PENETRANCE_NOT_ESTABLISHED = "Penetrance for this variant has not been established.";

/**
 * The attribution ClinVar and ClinGen ask for, under every reviewed finding.
 * The release is ClinVar's month; the ClinGen access date is the snapshot's.
 */
export function assertionSourceLine(releaseId: string, geneValidityReadOn: string): string {
  const release = /^clinvar-(\d{4}-\d{2})$/.exec(releaseId)?.[1];
  return release
    ? `Classifications from ClinVar (NCBI), release ${release}. Gene links from ClinGen, read ${writtenDate(geneValidityReadOn)}.`
    : "Classifications from a test release, not from ClinVar.";
}
