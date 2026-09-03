/**
 * The figure / presentation contract (brief §X4, G4.1–G4.2).
 *
 * This module is the single vocabulary authority for every rendered quantity
 * in Inherit. The components in src/components/figures/* and the copy in
 * src/copy/figures/* import from here; nothing else defines these strings.
 *
 * Every rendered quantity is emitted by <Figure> or <RelativeFigure> inside
 * one <ClaimBlock> (`[data-claim-block]`) and carries, on its own node:
 * `data-figure-kind`, `data-figure-class`, `data-figure-basis` and
 * `data-provenance`. Subject attribution (`data-subject-id` or
 * `data-subject-pair`) sits on the ClaimBlock container, so every figure has
 * exactly one attributed ancestor.
 */

export const FIGURE_KINDS = [
  "absolute",
  "relative",
  "difference-pp",
  "natural-frequency",
  "percentile",
  "coverage",
  "interval",
  "ancestry-share",
  "genotype",
  "carrier-status",
] as const;
export type FigureKind = (typeof FIGURE_KINDS)[number];

export const FIGURE_CLASSES = ["variant-call", "estimate", "ancestry", "quality"] as const;
export type FigureClass = (typeof FIGURE_CLASSES)[number];

/**
 * `observed` = read directly from the file (a genotype, a coverage count).
 * `modelled` = any statistical estimate.
 * `exact` = arithmetic that follows from observed inputs with no model in
 *   between (a Mendelian fraction, brief §3 §8.4). It carries EXACT_MARKER
 *   and never MODELLED_MARKER; a block never mixes the two (W9 §3.1).
 */
export const FIGURE_BASES = ["observed", "modelled", "exact"] as const;
export type FigureBasis = (typeof FIGURE_BASES)[number];

export type FigureProvenance =
  | { kind: "citation"; id: string }
  | { kind: "seed"; table: string; id: string }
  | { kind: "computed"; module: string };

/** Serialises provenance to `citation:<id>`, `seed:<table>/<id>` or `computed:<module>`. */
export function provenanceAttribute(provenance: FigureProvenance): string {
  switch (provenance.kind) {
    case "citation":
      return `citation:${provenance.id}`;
    case "seed":
      return `seed:${provenance.table}/${provenance.id}`;
    case "computed":
      return `computed:${provenance.module}`;
  }
}

export type SubjectAttribution = { subjectId: string } | { subjectPair: [string, string] };

/** Serialises attribution to `data-subject-id` or `data-subject-pair="{a}:{b}"`. */
export function subjectAttributes(
  subject: SubjectAttribution,
): { "data-subject-id": string } | { "data-subject-pair": string } {
  if ("subjectId" in subject) return { "data-subject-id": subject.subjectId };
  return { "data-subject-pair": `${subject.subjectPair[0]}:${subject.subjectPair[1]}` };
}

export const DATA_ATTRIBUTES = {
  claimBlock: "data-claim-block",
  figureKind: "data-figure-kind",
  figureClass: "data-figure-class",
  figureBasis: "data-figure-basis",
  provenance: "data-provenance",
  subjectId: "data-subject-id",
  subjectPair: "data-subject-pair",
  modelledMarker: "data-modelled-marker",
  exactMarker: "data-exact-marker",
} as const;

/** Rendered once per claim block that contains at least one modelled figure; never per figure. */
export const MODELLED_MARKER = "This is a model, not an observed outcome.";

/**
 * Rendered once per claim block that contains at least one exact figure and
 * no modelled one (brief line 1254); never per figure.
 */
export const EXACT_MARKER = "This is exact arithmetic, not an estimate.";

/** The unit of an ancestry share whose range is unavailable (G4.4): the explicit statement, never a blank. */
export const ANCESTRY_RANGE_UNAVAILABLE = "no range yet";

export const NATURAL_FREQUENCY_DENOMINATORS = [100, 1_000, 10_000, 100_000, 1_000_000] as const;
export type NaturalFrequencyDenominator = (typeof NATURAL_FREQUENCY_DENOMINATORS)[number];

/** Rendered when no denominator on the ladder can show both figures as whole numbers. */
export const NATURAL_FREQUENCY_FLOOR =
  "Fewer than 1 in a million, both for you and for the comparison group.";

export const REFERENCE_GROUP_SHORT = "people like you";

/**
 * The only terms of art allowed in user copy. Each renders a ≤20-word
 * definition on its first occurrence per page (see src/copy/figures and
 * <TermDefinition>).
 */
export const RETAINED_TERMS = ["baseline", "percentile", "haplogroup"] as const;
export type RetainedTerm = (typeof RETAINED_TERMS)[number];
